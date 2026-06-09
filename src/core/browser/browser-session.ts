import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Logger } from "pino";
import type { BrowserRuntimeConfig, ProfileConfig } from "../types/runtime.js";
import { serializeError } from "../monitoring/logger.js";

export interface BrowserSession {
  readonly browserContext: BrowserContext;
  readonly connectedBrowser: Browser | undefined;
  readonly closeMode: "context" | "disconnect";
}

export interface CreateBrowserSessionOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export async function createBrowserSession(
  profileConfig: ProfileConfig,
  browserConfig: BrowserRuntimeConfig,
  logger: Logger,
  options: CreateBrowserSessionOptions = {}
): Promise<BrowserSession> {
  if (browserConfig.connectionMode === "connect") {
    return connectToExistingBrowserContext(browserConfig, logger);
  }

  return launchPersistentBrowserContext(
    profileConfig,
    browserConfig,
    logger,
    options
  );
}

async function launchPersistentBrowserContext(
  profileConfig: ProfileConfig,
  browserConfig: BrowserRuntimeConfig,
  logger: Logger,
  options: CreateBrowserSessionOptions
): Promise<BrowserSession> {
  logger.info(
    {
      module: "browser",
      stage: "context_creation_started",
      connectionMode: browserConfig.connectionMode,
      profileName: profileConfig.profileName,
      userDataDir: profileConfig.userDataDir,
      headless: browserConfig.headless,
      browserChannel: browserConfig.channel,
      executablePath: browserConfig.executablePath,
      profileDirectory: browserConfig.profileDirectory,
      locale: browserConfig.locale,
      timezoneId: browserConfig.timezoneId,
      viewport: browserConfig.viewport,
      deviceScaleFactor: browserConfig.deviceScaleFactor,
      display: options.environment?.DISPLAY,
      browserFlagCount: browserConfig.flags.length,
      ignoredDefaultArgCount: browserConfig.ignoredDefaultArgs.length
    },
    "Creating persistent browser context."
  );

  const browserArgs = [...browserConfig.flags];

  if (browserConfig.profileDirectory !== undefined) {
    browserArgs.push(`--profile-directory=${browserConfig.profileDirectory}`);
  }

  const launchOptions: Parameters<
    typeof chromium.launchPersistentContext
  >[1] = {
    headless: browserConfig.headless,
    locale: browserConfig.locale,
    timezoneId: browserConfig.timezoneId,
    viewport: browserConfig.viewport,
    screen: browserConfig.viewport,
    deviceScaleFactor: browserConfig.deviceScaleFactor,
    isMobile: false,
    hasTouch: false,
    args: browserArgs
  };

  if (options.environment !== undefined) {
    launchOptions.env = {
      ...process.env,
      ...options.environment
    };
  }

  if (browserConfig.ignoredDefaultArgs.length > 0) {
    launchOptions.ignoreDefaultArgs = [...browserConfig.ignoredDefaultArgs];
  }

  if (browserConfig.executablePath !== undefined) {
    launchOptions.executablePath = browserConfig.executablePath;
  } else if (browserConfig.channel !== "bundled") {
    launchOptions.channel = browserConfig.channel;
  }

  const browserContext = await chromium.launchPersistentContext(
    profileConfig.userDataDir,
    launchOptions
  );

  logger.info(
    {
      module: "browser",
      stage: "context_creation_completed",
      pageCount: browserContext.pages().length
    },
    "Persistent browser context created."
  );

  return {
    browserContext,
    connectedBrowser: undefined,
    closeMode: "context"
  };
}

async function connectToExistingBrowserContext(
  browserConfig: BrowserRuntimeConfig,
  logger: Logger
): Promise<BrowserSession> {
  const cdpUrl = browserConfig.cdpUrl ?? "http://127.0.0.1:9222";

  logger.info(
    {
      module: "browser",
      stage: "browser_connect_started",
      connectionMode: browserConfig.connectionMode,
      cdpUrl
    },
    "Connecting to existing browser over CDP."
  );

  const browser = await chromium.connectOverCDP(cdpUrl);
  const browserContext = browser.contexts()[0];

  if (browserContext === undefined) {
    await browser.close();
    throw new Error("Connected browser did not expose a default context.");
  }

  logger.info(
    {
      module: "browser",
      stage: "browser_connect_completed",
      contextCount: browser.contexts().length,
      pageCount: browserContext.pages().length
    },
    "Connected to existing browser over CDP."
  );

  return {
    browserContext,
    connectedBrowser: browser,
    closeMode: "disconnect"
  };
}

export async function closeBrowserSession(
  browserSession: BrowserSession,
  logger: Logger
): Promise<void> {
  if (browserSession.closeMode === "disconnect") {
    logger.info(
      {
        module: "browser",
        stage: "browser_disconnect_started"
      },
      "Disconnecting from existing browser."
    );

    await browserSession.connectedBrowser?.close();

    logger.info(
      {
        module: "browser",
        stage: "browser_disconnect_completed"
      },
      "Disconnected from existing browser."
    );

    return;
  }

  logger.info(
    {
      module: "browser",
      stage: "context_close_started"
    },
    "Closing persistent browser context."
  );

  try {
    await browserSession.browserContext.close();
  } catch (error) {
    if (!isAlreadyClosedError(error)) {
      throw error;
    }

    logger.warn(
      {
        module: "browser",
        stage: "context_already_closed",
        error: serializeError(error)
      },
      "Persistent browser context was already closed."
    );
  }

  logger.info(
    {
      module: "browser",
      stage: "context_close_completed"
    },
    "Persistent browser context closed."
  );
}

function isAlreadyClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Target page, context or browser has been closed") ||
    error.message.includes("Browser has been closed")
  );
}
