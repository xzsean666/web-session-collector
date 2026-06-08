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
import {
  BackgroundBrowserService,
  type WebSessionOperationResult
} from "../runtime/background-browser-service.js";
import type { SessionState } from "../core/types/session-monitor.js";
import { loadApiConfig, type ApiConfig } from "./api-config.js";

const searchRequestSchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
    keyword: z.string().trim().min(1).optional(),
    q: z.string().trim().min(1).optional(),
    keywords: z.array(z.string().trim().min(1)).max(20).optional(),
    recentDays: z.coerce.number().int().min(0).max(3650).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    limitPerKeyword: z.coerce.number().int().min(1).max(100).optional(),
    scrollCount: z.coerce.number().int().min(0).max(20).optional(),
    fetchContent: z.boolean().optional(),
    excludeItemIds: z.array(z.string().min(1)).max(50_000).optional()
  })
  .strict();

const createSessionRequestSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    activate: z.boolean().optional(),
    idleNovnc: z.boolean().optional()
  })
  .strict();

const sessionStateSchema = z.enum([
  "unknown",
  "logged_in",
  "logged_out",
  "challenge_required",
  "browser_closed",
  "error"
]);

const updateSessionStateRequestSchema = z
  .object({
    state: sessionStateSchema,
    updatedBy: z.string().trim().min(1).max(100).optional()
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
      apiActiveSessionId: status.apiActiveSessionId,
      idleNovncSessionId: status.idleNovncSessionId,
      activeTask: status.activeTask
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    writeJson(response, 200, {
      ok: true,
      status: await context.browserService.getStatus(),
      noVnc: noVncStatus(context.apiConfig)
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/sessions") {
    const status = await context.browserService.getStatus();
    writeJson(response, 200, {
      ok: true,
      apiActiveSessionId: status.apiActiveSessionId,
      idleNovncSessionId: status.idleNovncSessionId,
      noVnc: noVncStatus(context.apiConfig),
      sessions: status.sessions
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/sessions") {
    await handleCreateSession(request, response, context);
    return;
  }

  const sessionRoute = matchSessionRoute(requestUrl.pathname);

  if (sessionRoute !== undefined) {
    await handleSessionRoute(request, response, context, sessionRoute);
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
    const sessionCheck = await context.browserService.requestSessionCheck(
      "api",
      requestUrl.searchParams.get("sessionId") ?? undefined
    );

    if (!sessionCheck.accepted) {
      writeJson(response, sessionCheck.statusCode, {
        ok: false,
        error: {
          code: sessionCheckErrorCode(sessionCheck.statusCode),
          message: sessionCheck.message
        },
        activeTask: sessionCheck.activeTask,
        session: sessionCheck.session,
        webSession: sessionCheck.webSession
      });
      return;
    }

    writeJson(response, 200, {
      ok: true,
      session: sessionCheck.session,
      webSession: sessionCheck.webSession
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

interface SessionRoute {
  readonly sessionId: string;
  readonly action: "delete" | "activate" | "idle-novnc" | "state";
}

function matchSessionRoute(pathname: string): SessionRoute | undefined {
  const routeMatch = /^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);

  if (routeMatch === null) {
    return undefined;
  }

  const sessionId = decodeURIComponent(routeMatch[1]);
  const rawAction = routeMatch[2];

  if (rawAction === undefined) {
    return {
      sessionId,
      action: "delete"
    };
  }

  if (
    rawAction === "activate" ||
    rawAction === "idle-novnc" ||
    rawAction === "state"
  ) {
    return {
      sessionId,
      action: rawAction
    };
  }

  return undefined;
}

async function handleCreateSession(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  const body = await readRequestBodyOrWriteError(request, response, context);

  if (body.readFailed) {
    return;
  }

  const parsedBody = createSessionRequestSchema.safeParse(body.value);

  if (!parsedBody.success) {
    writeValidationError(response, "Create session request body is invalid.", parsedBody.error);
    return;
  }

  const createResult = await context.browserService.createSession(parsedBody.data);

  if (!createResult.accepted) {
    writeJson(response, createResult.statusCode, {
      ok: false,
      error: {
        code: createResult.code,
        message: createResult.message
      },
      session: createResult.session,
      status: createResult.status
    });
    return;
  }

  writeJson(response, 201, {
    ok: true,
    session: createResult.session,
    status: createResult.status
  });
}

async function handleSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  route: SessionRoute
): Promise<void> {
  if (route.action === "delete") {
    if (request.method !== "DELETE") {
      writeMethodNotAllowed(response);
      return;
    }

    const deleteResult = await context.browserService.deleteSession(route.sessionId);
    writeSessionOperationResult(response, deleteResult, deleteResult.accepted ? 200 : undefined);
    return;
  }

  if (route.action === "activate") {
    if (request.method !== "POST") {
      writeMethodNotAllowed(response);
      return;
    }

    const activateResult = await context.browserService.activateSession(route.sessionId);
    writeSessionOperationResult(response, activateResult);
    return;
  }

  if (route.action === "idle-novnc") {
    if (request.method !== "POST") {
      writeMethodNotAllowed(response);
      return;
    }

    const idleNovncResult = await context.browserService.setIdleNovncSession(
      route.sessionId
    );
    writeSessionOperationResult(response, idleNovncResult);
    return;
  }

  if (request.method !== "PATCH") {
    writeMethodNotAllowed(response);
    return;
  }

  const body = await readRequestBodyOrWriteError(request, response, context);

  if (body.readFailed) {
    return;
  }

  const parsedBody = updateSessionStateRequestSchema.safeParse(body.value);

  if (!parsedBody.success) {
    writeValidationError(response, "Update session state request body is invalid.", parsedBody.error);
    return;
  }

  const stateResult = await context.browserService.setSessionState(
    route.sessionId,
    parsedBody.data.state as SessionState,
    parsedBody.data.updatedBy ?? "api"
  );
  writeSessionOperationResult(response, stateResult);
}

function writeSessionOperationResult(
  response: ServerResponse,
  result: WebSessionOperationResult,
  successStatusCode = 200
): void {
  if (!result.accepted) {
    writeJson(response, result.statusCode, {
      ok: false,
      error: {
        code: result.code,
        message: result.message
      },
      session: result.session,
      status: result.status
    });
    return;
  }

  writeJson(response, successStatusCode, {
    ok: true,
    session: result.session,
    status: result.status
  });
}

async function handleXiaohongshuSearch(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  const body = await readRequestBodyOrWriteError(request, response, context);

  if (body.readFailed) {
    return;
  }

  const parsedBody = searchRequestSchema.safeParse(body.value);

  if (!parsedBody.success) {
    writeValidationError(response, "Search request body is invalid.", parsedBody.error);
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
      context.apiConfig.searchDefaults.fetchContent,
    excludeItemIds: parsedBody.data.excludeItemIds ?? []
  }, parsedBody.data.sessionId);

  if (!dispatchResult.accepted) {
    writeJson(response, dispatchResult.statusCode, {
      ok: false,
      error: {
        code: responseErrorCode(dispatchResult.reason, dispatchResult.session?.state),
        message: dispatchResult.message
      },
      activeTask: dispatchResult.activeTask,
      session: dispatchResult.session,
      webSession: dispatchResult.webSession
    });
    return;
  }

  writeJson(response, 200, {
    ok: true,
    task: dispatchResult.task,
    session: dispatchResult.session,
    webSession: dispatchResult.webSession,
    data: dispatchResult.result
  });
}

async function readRequestBodyOrWriteError(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<
  | { readonly readFailed: false; readonly value: unknown }
  | { readonly readFailed: true }
> {
  try {
    return {
      readFailed: false,
      value: await readJsonBody(
        request,
        context.apiConfig.requestBodyLimitBytes
      )
    };
  } catch (error) {
    if (error instanceof RequestBodyError) {
      writeJson(response, error.statusCode, {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
      return {
        readFailed: true
      };
    }

    throw error;
  }
}

function writeValidationError(
  response: ServerResponse,
  message: string,
  error: z.ZodError
): void {
  writeJson(response, 400, {
    ok: false,
    error: {
      code: "invalid_request",
      message,
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    }
  });
}

function writeMethodNotAllowed(response: ServerResponse): void {
  writeJson(response, 405, {
    ok: false,
    error: {
      code: "method_not_allowed",
      message: "Method not allowed."
    }
  });
}

function noVncStatus(apiConfig: ApiConfig): {
  readonly active: { readonly port: number; readonly path: string };
  readonly idle: { readonly port: number; readonly path: string };
} {
  return {
    active: {
      port: apiConfig.activeNoVncPort,
      path: "/vnc.html"
    },
    idle: {
      port: apiConfig.idleNoVncPort,
      path: "/vnc.html"
    }
  };
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
    | "session_not_found"
    | "task_failed",
  sessionState: string | undefined
): string {
  if (reason === "busy") {
    return "task_busy";
  }

  if (reason === "session_not_found") {
    return "session_not_found";
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

function sessionCheckErrorCode(statusCode: number): string {
  if (statusCode === 409) {
    return "task_busy";
  }

  if (statusCode === 404) {
    return "session_not_found";
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
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(body, null, 2));
}

function writeEmpty(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
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
