import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Logger } from "pino";
import type { BrowserRuntimeConfig, ProfileConfig } from "../types/runtime.js";
import { serializeError } from "../monitoring/logger.js";
import {
  applyDesktopUaSpoof,
  applyStealthInitScript,
  STEALTH_EXTRA_FLAGS,
  STEALTH_IGNORED_DEFAULT_ARGS
} from "./stealth.js";

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

  // 反自动化参数(总开关 humanize 控制):去掉「受自动化控制」的硬特征。
  const ignoredDefaultArgs = [...browserConfig.ignoredDefaultArgs];

  if (browserConfig.humanize) {
    for (const flag of STEALTH_EXTRA_FLAGS) {
      if (!browserArgs.includes(flag)) {
        browserArgs.push(flag);
      }
    }
    for (const arg of STEALTH_IGNORED_DEFAULT_ARGS) {
      if (!ignoredDefaultArgs.includes(arg)) {
        ignoredDefaultArgs.push(arg);
      }
    }
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

  if (ignoredDefaultArgs.length > 0) {
    launchOptions.ignoreDefaultArgs = ignoredDefaultArgs;
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

  if (browserConfig.humanize) {
    await applyStealthInitScript(browserContext, logger);
    if (browserConfig.uaSpoof) {
      // 按容器架构选伪装目标,做到「架构不撒谎」:arm64 → macOS(Apple Silicon 即 arm),
      // x64 → Windows(小红书 PC 用户绝大多数,且 x86 真实)。
      const uaTarget = process.arch === "arm64" ? "macos" : "windows";
      await applyDesktopUaSpoof(browserContext, uaTarget, logger);
    }
  }

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

  // connect 模式下追加的浏览器参数无法控制(浏览器是外部启动的),但 init script
  // 仍会对后续导航/新开页面生效,可抹掉 navigator.webdriver 等标记。
  if (browserConfig.humanize) {
    await applyStealthInitScript(browserContext, logger);
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
