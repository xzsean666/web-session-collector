import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { z } from "zod";
import { loadLocalEnvFile } from "../core/config/local-env-file.js";
import { createBootstrapLogger, createLogger, serializeError } from "../core/monitoring/logger.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { listSearchSiteKeys } from "../sites/site-registry.js";
import { BackgroundBrowserService } from "../runtime/background-browser-service.js";
import { loadApiConfig, type ApiConfig } from "./api-config.js";

const searchRequestSchema = z
  .object({
    keyword: z.string().trim().min(1).optional(),
    q: z.string().trim().min(1).optional(),
    keywords: z.array(z.string().trim().min(1)).max(20).optional(),
    recentDays: z.coerce.number().int().min(0).max(3650).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    limitPerKeyword: z.coerce.number().int().min(1).max(100).optional(),
    scrollCount: z.coerce.number().int().min(0).max(20).optional(),
    fetchContent: z.boolean().optional()
  })
  .strict();

loadLocalEnvFile();

const bootstrapLogger = createBootstrapLogger();

main().catch((error: unknown) => {
  bootstrapLogger.error(
    {
      module: "api",
      stage: "failed",
      error: serializeError(error)
    },
    "API service failed."
  );

  process.exitCode = 1;
});

async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig(process.env);
  const apiConfig = loadApiConfig(process.env);
  const logger = createLogger(runtimeConfig.logging);
  const browserService = new BackgroundBrowserService({
    runtimeConfig,
    accountCheckIntervalMs: apiConfig.accountCheckIntervalMs,
    logger
  });

  await browserService.start();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, {
      apiConfig,
      browserService,
      logger
    }).catch((error: unknown) => {
      logger.error(
        {
          module: "api",
          stage: "request_failed",
          method: request.method,
          url: request.url,
          error: serializeError(error)
        },
        "API request failed."
      );
      writeJson(response, 500, {
        ok: false,
        error: {
          code: "internal_error",
          message: "Internal server error."
        }
      });
    });
  });

  await listen(server, apiConfig);

  logger.info(
    {
      module: "api",
      stage: "listening",
      host: apiConfig.host,
      port: apiConfig.port
    },
    "API service is listening."
  );

  installShutdownHandlers(server, browserService, logger);
}

interface RequestContext {
  readonly apiConfig: ApiConfig;
  readonly browserService: BackgroundBrowserService;
  readonly logger: ReturnType<typeof createLogger>;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  if (request.method === "OPTIONS") {
    writeEmpty(response, 204);
    return;
  }

  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    const status = await context.browserService.getStatus();
    writeJson(response, 200, {
      ok: status.lifecycle === "running",
      lifecycle: status.lifecycle,
      activeTask: status.activeTask
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    writeJson(response, 200, {
      ok: true,
      status: await context.browserService.getStatus()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/sites/search") {
    writeJson(response, 200, {
      ok: true,
      sites: listSearchSiteKeys()
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/api/session/check"
  ) {
    const sessionCheck = await context.browserService.requestSessionCheck("api");

    if (!sessionCheck.accepted) {
      writeJson(response, sessionCheck.statusCode, {
        ok: false,
        error: {
          code: sessionCheck.statusCode === 409 ? "task_busy" : "service_not_ready",
          message: sessionCheck.message
        },
        activeTask: sessionCheck.activeTask,
        session: sessionCheck.session
      });
      return;
    }

    writeJson(response, 200, {
      ok: true,
      session: sessionCheck.session
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/api/xiaohongshu/search"
  ) {
    await handleXiaohongshuSearch(request, response, context);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: {
      code: "not_found",
      message: "Route not found."
    }
  });
}

async function handleXiaohongshuSearch(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  let body: unknown;

  try {
    body = await readJsonBody(
      request,
      context.apiConfig.requestBodyLimitBytes
    );
  } catch (error) {
    if (error instanceof RequestBodyError) {
      writeJson(response, error.statusCode, {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    throw error;
  }

  const parsedBody = searchRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "invalid_request",
        message: "Search request body is invalid.",
        details: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    });
    return;
  }

  const keywords = normalizeKeywords(parsedBody.data);

  if (keywords.length === 0) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "missing_keywords",
        message: "Provide keyword, q, or keywords."
      }
    });
    return;
  }

  const dispatchResult = await context.browserService.runSearch({
    siteKey: "xiaohongshu",
    keywords,
    recentDays:
      parsedBody.data.recentDays ??
      context.apiConfig.searchDefaults.recentDays,
    limitPerKeyword:
      parsedBody.data.limitPerKeyword ??
      parsedBody.data.limit ??
      context.apiConfig.searchDefaults.limitPerKeyword,
    scrollCount:
      parsedBody.data.scrollCount ??
      context.apiConfig.searchDefaults.scrollCount,
    fetchContent:
      parsedBody.data.fetchContent ??
      context.apiConfig.searchDefaults.fetchContent
  });

  if (!dispatchResult.accepted) {
    writeJson(response, dispatchResult.statusCode, {
      ok: false,
      error: {
        code: responseErrorCode(dispatchResult.reason, dispatchResult.session?.state),
        message: dispatchResult.message
      },
      activeTask: dispatchResult.activeTask,
      session: dispatchResult.session
    });
    return;
  }

  writeJson(response, 200, {
    ok: true,
    task: dispatchResult.task,
    session: dispatchResult.session,
    data: dispatchResult.result
  });
}

function normalizeKeywords(
  data: z.infer<typeof searchRequestSchema>
): readonly string[] {
  const rawKeywords = [
    ...(data.keywords ?? []),
    ...(data.keyword === undefined ? [] : [data.keyword]),
    ...(data.q === undefined ? [] : [data.q])
  ];
  const seenKeywords = new Set<string>();
  const keywords: string[] = [];

  for (const rawKeyword of rawKeywords) {
    const keyword = rawKeyword.trim();

    if (keyword === "" || seenKeywords.has(keyword)) {
      continue;
    }

    seenKeywords.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
}

function responseErrorCode(
  reason:
    | "busy"
    | "service_not_ready"
    | "account_attention_required"
    | "task_failed",
  sessionState: string | undefined
): string {
  if (reason === "busy") {
    return "task_busy";
  }

  if (reason === "account_attention_required") {
    if (sessionState === "logged_out") {
      return "login_required";
    }

    if (sessionState === "challenge_required") {
      return "verification_required";
    }

    return "account_attention_required";
  }

  if (reason === "task_failed") {
    return "search_failed";
  }

  return "service_not_ready";
}

function readJsonBody(
  request: IncomingMessage,
  limitBytes: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;

      if (totalBytes > limitBytes) {
        reject(
          new RequestBodyError(
            "request_body_too_large",
            "Request body is too large.",
            413
          )
        );
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          new RequestBodyError(
            "invalid_json",
            "Request body must be valid JSON.",
            400
          )
        );
      }
    });

    request.on("error", reject);
  });
}

class RequestBodyError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = "RequestBodyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  if (response.headersSent) {
    return;
  }

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(body, null, 2));
}

function writeEmpty(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end();
}

function listen(server: Server, apiConfig: ApiConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiConfig.port, apiConfig.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function installShutdownHandlers(
  server: Server,
  browserService: BackgroundBrowserService,
  logger: ReturnType<typeof createLogger>
): void {
  let shutdownStarted = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(
      {
        module: "api",
        stage: "shutdown_started",
        signal
      },
      "API shutdown started."
    );

    server.close((error?: Error) => {
      void (async () => {
        if (error !== undefined) {
          logger.warn(
            {
              module: "api",
              stage: "server_close_failed",
              error: serializeError(error)
            },
            "HTTP server close failed."
          );
        }

        await browserService.stop(signal);
        logger.info(
          {
            module: "api",
            stage: "shutdown_completed",
            signal
          },
          "API shutdown completed."
        );
      })().catch((shutdownError: unknown) => {
        logger.error(
          {
            module: "api",
            stage: "shutdown_failed",
            error: serializeError(shutdownError)
          },
          "API shutdown failed."
        );
        process.exitCode = 1;
      });
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
