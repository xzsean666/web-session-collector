import {
  closeBrowserSession,
  createBrowserSession,
  type BrowserSession
} from "../core/browser/browser-session.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import {
  closePageSession,
  createPageSession,
  type PageSession
} from "../core/context/page-session.js";
import { openStartPageAction } from "../core/actions/open-start-page-action.js";
import { verifyProfileAction } from "../core/actions/verify-profile-action.js";
import { createLogger, serializeError } from "../core/monitoring/logger.js";
import type { BrowserRuntimeConfig, RuntimeConfig } from "../core/types/runtime.js";
import type { RuntimeSiteAdapter } from "../core/types/site-runtime.js";
import type { RuntimeExecutionResult } from "../types/runtime-result.js";
import { getRuntimeSiteAdapter } from "../sites/site-registry.js";

export async function runMvpRuntime(
  environmentVariables: NodeJS.ProcessEnv
): Promise<RuntimeExecutionResult> {
  const runtimeConfig = loadRuntimeConfig(environmentVariables);
  const runtimeSiteAdapter = getRuntimeSiteAdapter(runtimeConfig.site.siteKey);
  const logger = createLogger(runtimeConfig.logging);
  let browserSession: BrowserSession | undefined;
  let pageSession: PageSession | undefined;

  const closeActiveBrowserSession = async (reason: string): Promise<void> => {
    if (browserSession === undefined) {
      return;
    }

    logger.info(
      {
        module: "runtime",
        stage: "shutdown_started",
        reason
      },
      "Runtime shutdown started."
    );

    if (pageSession !== undefined) {
      await closePageSession(pageSession, logger);
    }

    await closeBrowserSession(browserSession, logger);

    pageSession = undefined;
    browserSession = undefined;

    logger.info(
      {
        module: "runtime",
        stage: "shutdown_completed",
        reason
      },
      "Runtime shutdown completed."
    );
  };

  try {
    logger.info(
      {
        module: "runtime",
        stage: "configuration_loaded",
        siteKey: runtimeSiteAdapter.siteKey,
        siteDisplayName: runtimeSiteAdapter.displayName,
        profileName: runtimeConfig.profile.profileName,
        userDataDir: runtimeConfig.profile.userDataDir,
        headless: runtimeConfig.browser.headless,
        browserChannel: runtimeConfig.browser.channel,
        executablePath: runtimeConfig.browser.executablePath,
        profileDirectory: runtimeConfig.browser.profileDirectory,
        locale: runtimeConfig.browser.locale,
        timezoneId: runtimeConfig.browser.timezoneId,
        viewport: runtimeConfig.browser.viewport,
        deviceScaleFactor: runtimeConfig.browser.deviceScaleFactor,
        connectionMode: runtimeConfig.browser.connectionMode,
        cdpUrl: runtimeConfig.browser.cdpUrl,
        startUrl: runtimeConfig.navigation.startUrl,
        keepBrowserAlive: runtimeConfig.runtime.keepBrowserAlive,
        interactiveLoginOnMissingUser:
          runtimeConfig.runtime.interactiveLoginOnMissingUser
      },
      "Runtime configuration loaded."
    );

    let runtimeResult = await runRuntimePass(
      runtimeConfig,
      runtimeConfig.browser,
      runtimeSiteAdapter,
      logger,
      (activeBrowserSession, activePageSession) => {
        browserSession = activeBrowserSession;
        pageSession = activePageSession;
      }
    );

    if (shouldOpenInteractiveLoginWindow(runtimeConfig, runtimeResult)) {
      await closeActiveBrowserSession("interactive_login_required");
      await runInteractiveLoginPass(
        runtimeConfig,
        logger,
        (activeBrowserSession, activePageSession) => {
          browserSession = activeBrowserSession;
          pageSession = activePageSession;
        }
      );
      await closeActiveBrowserSession("interactive_login_completed");

      runtimeResult = await runRuntimePass(
        runtimeConfig,
        runtimeConfig.browser,
        runtimeSiteAdapter,
        logger,
        (activeBrowserSession, activePageSession) => {
          browserSession = activeBrowserSession;
          pageSession = activePageSession;
        }
      );
    }

    if (runtimeConfig.runtime.keepBrowserAlive) {
      logger.info(
        {
          module: "runtime",
          stage: "keep_alive_started"
        },
        "Browser keep-alive mode is active. Press Enter to shutdown cleanly."
      );

      await waitForKeepAliveRelease(logger);
    }

    return runtimeResult;
  } catch (error) {
    logger.error(
      {
        module: "runtime",
        stage: "failed",
        error: serializeError(error)
      },
      "Runtime failed."
    );

    throw error;
  } finally {
    await closeActiveBrowserSession("runtime_finished");
  }
}

type ActiveSessionSetter = (
  browserSession: BrowserSession,
  pageSession: PageSession
) => void;

async function runRuntimePass(
  runtimeConfig: RuntimeConfig,
  browserConfig: BrowserRuntimeConfig,
  runtimeSiteAdapter: RuntimeSiteAdapter,
  logger: ReturnType<typeof createLogger>,
  setActiveSession: ActiveSessionSetter
): Promise<RuntimeExecutionResult> {
  const activeBrowserSession = await createBrowserSession(
    runtimeConfig.profile,
    browserConfig,
    logger
  );

  const activePageSession = await createPageSession(
    activeBrowserSession.browserContext,
    logger,
    {
      allowNewPage: browserConfig.connectionMode !== "connect",
      preferNewPage: false,
      requiredExistingPageHostSuffix:
        browserConfig.connectionMode === "connect"
          ? runtimeSiteAdapter.targetHostSuffix
          : undefined
    }
  );

  setActiveSession(activeBrowserSession, activePageSession);

  const profileVerification = await verifyProfileAction(
    activePageSession,
    runtimeConfig.profile,
    logger
  );
  const startPageNavigation = await openStartPageAction(
    activePageSession,
    runtimeConfig.navigation,
    logger
  );
  const currentUser = await runtimeSiteAdapter.getCurrentAccount(
    activePageSession,
    logger
  );

  return {
    profileVerification,
    startPageNavigation,
    currentUser
  };
}

async function runInteractiveLoginPass(
  runtimeConfig: RuntimeConfig,
  logger: ReturnType<typeof createLogger>,
  setActiveSession: ActiveSessionSetter
): Promise<void> {
  const headedBrowserConfig: BrowserRuntimeConfig = {
    ...runtimeConfig.browser,
    headless: false
  };

  const activeBrowserSession = await createBrowserSession(
    runtimeConfig.profile,
    headedBrowserConfig,
    logger
  );

  const activePageSession = await createPageSession(
    activeBrowserSession.browserContext,
    logger,
    {
      allowNewPage: true,
      preferNewPage: false,
      requiredExistingPageHostSuffix: undefined
    }
  );

  setActiveSession(activeBrowserSession, activePageSession);

  await verifyProfileAction(activePageSession, runtimeConfig.profile, logger);
  await openStartPageAction(activePageSession, runtimeConfig.navigation, logger);

  logger.info(
    {
      module: "runtime",
      stage: "interactive_login_started"
    },
    "Interactive login window is open. Log in, then press Enter or close the browser window."
  );

  await waitForInteractiveLoginRelease(
    activeBrowserSession,
    activePageSession,
    logger
  );
}

function shouldOpenInteractiveLoginWindow(
  runtimeConfig: RuntimeConfig,
  runtimeResult: RuntimeExecutionResult
): boolean {
  return (
    runtimeConfig.runtime.interactiveLoginOnMissingUser &&
    runtimeConfig.browser.connectionMode === "launch" &&
    runtimeConfig.browser.headless &&
    !runtimeResult.currentUser.found
  );
}

function waitForKeepAliveRelease(
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  return new Promise((resolve) => {
    let releaseReceived = false;

    const finishKeepAlive = (
      source: "stdin" | "signal",
      signal?: NodeJS.Signals
    ): void => {
      if (releaseReceived) {
        return;
      }

      releaseReceived = true;
      process.off("SIGINT", handleShutdownSignal);
      process.off("SIGTERM", handleShutdownSignal);

      if (process.stdin.isTTY) {
        process.stdin.off("data", handleStdinData);
        process.stdin.pause();
      }

      logger.info(
        {
          module: "runtime",
          stage: "keep_alive_release_received",
          source,
          signal
        },
        "Keep-alive release received."
      );

      resolve();
    };

    const handleShutdownSignal = (signal: NodeJS.Signals): void => {
      finishKeepAlive("signal", signal);
    };

    const handleStdinData = (): void => {
      finishKeepAlive("stdin");
    };

    process.once("SIGINT", handleShutdownSignal);
    process.once("SIGTERM", handleShutdownSignal);

    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.once("data", handleStdinData);
    }
  });
}

function waitForInteractiveLoginRelease(
  browserSession: BrowserSession,
  pageSession: PageSession,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  return new Promise((resolve) => {
    let releaseReceived = false;

    const finishInteractiveLogin = (
      source: "stdin" | "signal" | "page_close" | "context_close",
      signal?: NodeJS.Signals
    ): void => {
      if (releaseReceived) {
        return;
      }

      releaseReceived = true;
      process.off("SIGINT", handleShutdownSignal);
      process.off("SIGTERM", handleShutdownSignal);
      pageSession.page.off("close", handlePageClose);
      browserSession.browserContext.off("close", handleContextClose);

      if (process.stdin.isTTY) {
        process.stdin.off("data", handleStdinData);
        process.stdin.pause();
      }

      logger.info(
        {
          module: "runtime",
          stage: "interactive_login_release_received",
          source,
          signal
        },
        "Interactive login release received."
      );

      resolve();
    };

    const handleShutdownSignal = (signal: NodeJS.Signals): void => {
      finishInteractiveLogin("signal", signal);
    };

    const handleStdinData = (): void => {
      finishInteractiveLogin("stdin");
    };

    const handlePageClose = (): void => {
      finishInteractiveLogin("page_close");
    };

    const handleContextClose = (): void => {
      finishInteractiveLogin("context_close");
    };

    process.once("SIGINT", handleShutdownSignal);
    process.once("SIGTERM", handleShutdownSignal);
    pageSession.page.once("close", handlePageClose);
    browserSession.browserContext.once("close", handleContextClose);

    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.once("data", handleStdinData);
    }
  });
}
