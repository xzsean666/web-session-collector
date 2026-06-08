import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  closeBrowserSession,
  createBrowserSession,
  type BrowserSession
} from "../core/browser/browser-session.js";
import {
  closePageSession,
  createPageSession,
  type PageSession
} from "../core/context/page-session.js";
import { openStartPageAction } from "../core/actions/open-start-page-action.js";
import { verifyProfileAction } from "../core/actions/verify-profile-action.js";
import { serializeError } from "../core/monitoring/logger.js";
import type { SessionInspectionResult } from "../core/types/session-monitor.js";
import type { RuntimeConfig } from "../core/types/runtime.js";
import type { RuntimeSiteAdapter } from "../core/types/site-runtime.js";
import { getRuntimeSiteAdapter } from "../sites/site-registry.js";
import {
  runSearchTaskOnPage,
  type SearchTaskOptions,
  type SearchTaskResult
} from "./search-task.js";

export type BackgroundServiceLifecycle =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type BackgroundTaskType = "search";
export type BackgroundTaskState = "running" | "completed" | "failed";

export interface BackgroundTaskSnapshot {
  readonly id: string;
  readonly type: BackgroundTaskType;
  readonly state: BackgroundTaskState;
  readonly startedAt: string;
  readonly completedAt: string | undefined;
  readonly input: Readonly<Record<string, unknown>>;
  readonly resultSummary: Readonly<Record<string, unknown>> | undefined;
  readonly error: Readonly<Record<string, unknown>> | undefined;
}

export type SearchDispatchResult =
  | {
      readonly accepted: true;
      readonly task: BackgroundTaskSnapshot;
      readonly result: SearchTaskResult;
      readonly session: SessionInspectionResult | undefined;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | "busy"
        | "service_not_ready"
        | "account_attention_required"
        | "task_failed";
      readonly statusCode: number;
      readonly message: string;
      readonly activeTask: BackgroundTaskSnapshot | undefined;
      readonly session: SessionInspectionResult | undefined;
    };

export type SessionCheckDispatchResult =
  | {
      readonly accepted: true;
      readonly session: SessionInspectionResult;
    }
  | {
      readonly accepted: false;
      readonly statusCode: number;
      readonly message: string;
      readonly activeTask: BackgroundTaskSnapshot | undefined;
      readonly session: SessionInspectionResult | undefined;
    };

export interface BackgroundServiceStatus {
  readonly lifecycle: BackgroundServiceLifecycle;
  readonly startedAt: string | undefined;
  readonly stoppedAt: string | undefined;
  readonly siteKey: string;
  readonly browser: {
    readonly connectionMode: string;
    readonly headless: boolean;
    readonly channel: string;
    readonly executablePath: string | undefined;
    readonly userDataDir: string;
    readonly profileDirectory: string | undefined;
    readonly viewport: RuntimeConfig["browser"]["viewport"];
  };
  readonly page: {
    readonly closed: boolean;
    readonly url: string;
    readonly title: string;
  };
  readonly activeTask: BackgroundTaskSnapshot | undefined;
  readonly lastTask: BackgroundTaskSnapshot | undefined;
  readonly session: SessionInspectionResult | undefined;
  readonly monitor: {
    readonly intervalMs: number;
    readonly lastCheckStartedAt: string | undefined;
    readonly lastCheckCompletedAt: string | undefined;
    readonly lastSkippedReason: string | undefined;
  };
  readonly error: Readonly<Record<string, unknown>> | undefined;
}

export interface BackgroundBrowserServiceOptions {
  readonly runtimeConfig: RuntimeConfig;
  readonly accountCheckIntervalMs: number;
  readonly logger: Logger;
}

export class BackgroundBrowserService {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly runtimeSiteAdapter: RuntimeSiteAdapter;
  private readonly accountCheckIntervalMs: number;
  private readonly logger: Logger;
  private browserSession: BrowserSession | undefined;
  private pageSession: PageSession | undefined;
  private lifecycle: BackgroundServiceLifecycle = "created";
  private startedAt: string | undefined;
  private stoppedAt: string | undefined;
  private activeTask: BackgroundTaskSnapshot | undefined;
  private lastTask: BackgroundTaskSnapshot | undefined;
  private sessionInspection: SessionInspectionResult | undefined;
  private monitorTimer: NodeJS.Timeout | undefined;
  private monitorRunning = false;
  private lastMonitorCheckStartedAt: string | undefined;
  private lastMonitorCheckCompletedAt: string | undefined;
  private lastMonitorSkippedReason: string | undefined;
  private lastError: Readonly<Record<string, unknown>> | undefined;

  constructor(options: BackgroundBrowserServiceOptions) {
    this.runtimeConfig = options.runtimeConfig;
    this.runtimeSiteAdapter = getRuntimeSiteAdapter(
      options.runtimeConfig.site.siteKey
    );
    this.accountCheckIntervalMs = options.accountCheckIntervalMs;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    if (this.lifecycle === "running" || this.lifecycle === "starting") {
      return;
    }

    this.lifecycle = "starting";
    this.startedAt = new Date().toISOString();
    this.stoppedAt = undefined;
    this.lastError = undefined;

    try {
      this.browserSession = await createBrowserSession(
        this.runtimeConfig.profile,
        this.runtimeConfig.browser,
        this.logger
      );
      this.pageSession = await createPageSession(
        this.browserSession.browserContext,
        this.logger,
        {
          allowNewPage: this.runtimeConfig.browser.connectionMode !== "connect",
          preferNewPage: false,
          requiredExistingPageHostSuffix:
            this.runtimeConfig.browser.connectionMode === "connect"
              ? this.runtimeSiteAdapter.targetHostSuffix
              : undefined
        }
      );

      await verifyProfileAction(
        this.pageSession,
        this.runtimeConfig.profile,
        this.logger
      );
      await openStartPageAction(
        this.pageSession,
        this.runtimeConfig.navigation,
        this.logger
      );

      this.lifecycle = "running";
      await this.refreshSessionStatus("startup");
      this.startMonitor();
    } catch (error) {
      this.lifecycle = "failed";
      this.lastError = serializeError(error);
      await this.closeSessions("startup_failed");
      throw error;
    }
  }

  async stop(reason = "service_stop"): Promise<void> {
    if (this.lifecycle === "stopped" || this.lifecycle === "stopping") {
      return;
    }

    this.lifecycle = "stopping";
    this.stopMonitor();
    await this.closeSessions(reason);
    this.stoppedAt = new Date().toISOString();
    this.lifecycle = "stopped";
  }

  async runSearch(options: SearchTaskOptions): Promise<SearchDispatchResult> {
    if (this.lifecycle !== "running" || this.pageSession === undefined) {
      return {
        accepted: false,
        reason: "service_not_ready",
        statusCode: 503,
        message: "Background browser service is not ready.",
        activeTask: this.activeTask,
        session: this.sessionInspection
      };
    }

    if (this.activeTask !== undefined) {
      return {
        accepted: false,
        reason: "busy",
        statusCode: 409,
        message: "Previous search task is still running.",
        activeTask: this.activeTask,
        session: this.sessionInspection
      };
    }

    if (this.monitorRunning) {
      return {
        accepted: false,
        reason: "busy",
        statusCode: 409,
        message: "Session monitor is still running.",
        activeTask: undefined,
        session: this.sessionInspection
      };
    }

    const blockedMessage = this.readAccountAttentionMessage();

    if (blockedMessage !== undefined) {
      return {
        accepted: false,
        reason: "account_attention_required",
        statusCode: this.sessionInspection?.state === "logged_out" ? 428 : 423,
        message: blockedMessage,
        activeTask: undefined,
        session: this.sessionInspection
      };
    }

    const task = this.createRunningTask("search", {
      siteKey: options.siteKey,
      keywords: options.keywords,
      recentDays: options.recentDays,
      limitPerKeyword: options.limitPerKeyword,
      scrollCount: options.scrollCount,
      fetchContent: options.fetchContent
    });
    this.activeTask = task;

    try {
      const result = await runSearchTaskOnPage(
        this.pageSession,
        options,
        this.logger
      );
      const completedTask = this.completeTask(task, {
        keywordCount: result.results.length,
        itemCount: result.results.reduce(
          (totalCount, keywordResult) =>
            totalCount + keywordResult.matchedItems.length,
          0
        )
      });

      await this.refreshSessionStatus("after_search");

      return {
        accepted: true,
        task: completedTask,
        result,
        session: this.sessionInspection
      };
    } catch (error) {
      const failedTask = this.failTask(task, error);
      this.lastError = serializeError(error);
      await this.refreshSessionStatus("after_search_error").catch(
        (monitorError: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "post_error_session_check_failed",
              error: serializeError(monitorError)
            },
            "Session inspection failed after search error."
          );
        }
      );

      return {
        accepted: false,
        reason: "task_failed",
        statusCode: 500,
        message: "Search task failed.",
        activeTask: failedTask,
        session: this.sessionInspection
      };
    } finally {
      this.activeTask = undefined;
    }
  }

  async requestSessionCheck(reason = "manual"): Promise<SessionCheckDispatchResult> {
    if (this.lifecycle !== "running" || this.pageSession === undefined) {
      return {
        accepted: false,
        statusCode: 503,
        message: "Background browser service is not ready.",
        activeTask: this.activeTask,
        session: this.sessionInspection
      };
    }

    if (this.activeTask !== undefined) {
      return {
        accepted: false,
        statusCode: 409,
        message: "Search task is still running.",
        activeTask: this.activeTask,
        session: this.sessionInspection
      };
    }

    if (this.monitorRunning) {
      return {
        accepted: false,
        statusCode: 409,
        message: "Session monitor is still running.",
        activeTask: undefined,
        session: this.sessionInspection
      };
    }

    this.monitorRunning = true;

    try {
      return {
        accepted: true,
        session: await this.refreshSessionStatus(reason)
      };
    } finally {
      this.monitorRunning = false;
    }
  }

  async refreshSessionStatus(reason = "manual"): Promise<SessionInspectionResult> {
    if (this.pageSession === undefined) {
      const checkedAt = new Date().toISOString();
      this.sessionInspection = {
        siteKey: this.runtimeSiteAdapter.siteKey,
        state: "browser_closed",
        checkedAt,
        pageUrl: "",
        pageTitle: "",
        currentAccount: undefined,
        indicators: [
          {
            code: "browser_not_started",
            severity: "critical",
            message: "浏览器服务尚未启动或已经关闭。"
          }
        ],
        errorMessage: undefined
      };
      return this.sessionInspection;
    }

    this.lastMonitorCheckStartedAt = new Date().toISOString();
    this.lastMonitorSkippedReason = undefined;

    try {
      this.sessionInspection =
        this.runtimeSiteAdapter.inspectSession === undefined
          ? await this.inspectSessionWithCurrentAccountFallback()
          : await this.runtimeSiteAdapter.inspectSession(
              this.pageSession,
              this.logger
            );
      this.lastMonitorCheckCompletedAt = new Date().toISOString();

      this.logger.info(
        {
          module: "background_service",
          stage: "session_status_checked",
          reason,
          state: this.sessionInspection.state,
          indicatorCodes: this.sessionInspection.indicators.map(
            (indicator) => indicator.code
          )
        },
        "Session status checked."
      );

      return this.sessionInspection;
    } catch (error) {
      this.lastMonitorCheckCompletedAt = new Date().toISOString();
      this.lastError = serializeError(error);
      this.sessionInspection = {
        siteKey: this.runtimeSiteAdapter.siteKey,
        state: "error",
        checkedAt: new Date().toISOString(),
        pageUrl: this.pageSession.page.url(),
        pageTitle: await this.pageSession.page.title().catch(() => ""),
        currentAccount: undefined,
        indicators: [
          {
            code: "session_inspection_failed",
            severity: "warning",
            message: "会话状态检测失败。"
          }
        ],
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      return this.sessionInspection;
    }
  }

  async getStatus(): Promise<BackgroundServiceStatus> {
    const page = this.pageSession?.page;

    return {
      lifecycle: this.lifecycle,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      siteKey: this.runtimeSiteAdapter.siteKey,
      browser: {
        connectionMode: this.runtimeConfig.browser.connectionMode,
        headless: this.runtimeConfig.browser.headless,
        channel: this.runtimeConfig.browser.channel,
        executablePath: this.runtimeConfig.browser.executablePath,
        userDataDir: this.runtimeConfig.profile.userDataDir,
        profileDirectory: this.runtimeConfig.browser.profileDirectory,
        viewport: this.runtimeConfig.browser.viewport
      },
      page: {
        closed: page === undefined || page.isClosed(),
        url: page?.url() ?? "",
        title:
          page === undefined || page.isClosed()
            ? ""
            : await page.title().catch(() => "")
      },
      activeTask: this.activeTask,
      lastTask: this.lastTask,
      session: this.sessionInspection,
      monitor: {
        intervalMs: this.accountCheckIntervalMs,
        lastCheckStartedAt: this.lastMonitorCheckStartedAt,
        lastCheckCompletedAt: this.lastMonitorCheckCompletedAt,
        lastSkippedReason: this.lastMonitorSkippedReason
      },
      error: this.lastError
    };
  }

  private startMonitor(): void {
    if (this.accountCheckIntervalMs <= 0 || this.monitorTimer !== undefined) {
      return;
    }

    this.monitorTimer = setInterval(() => {
      void this.runScheduledMonitor();
    }, this.accountCheckIntervalMs);
    this.monitorTimer.unref();
  }

  private stopMonitor(): void {
    if (this.monitorTimer === undefined) {
      return;
    }

    clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
  }

  private async runScheduledMonitor(): Promise<void> {
    if (this.monitorRunning) {
      this.lastMonitorSkippedReason = "previous_monitor_still_running";
      return;
    }

    if (this.activeTask !== undefined) {
      this.lastMonitorSkippedReason = "task_running";
      return;
    }

    if (this.lifecycle !== "running") {
      this.lastMonitorSkippedReason = "service_not_running";
      return;
    }

    this.monitorRunning = true;

    try {
      await this.refreshSessionStatus("scheduled");
    } finally {
      this.monitorRunning = false;
    }
  }

  private async inspectSessionWithCurrentAccountFallback(): Promise<SessionInspectionResult> {
    if (this.pageSession === undefined) {
      throw new Error("Page session is not available.");
    }

    const currentAccount = await this.runtimeSiteAdapter.getCurrentAccount(
      this.pageSession,
      this.logger
    );

    return {
      siteKey: this.runtimeSiteAdapter.siteKey,
      state: currentAccount.found ? "logged_in" : "unknown",
      checkedAt: new Date().toISOString(),
      pageUrl: this.pageSession.page.url(),
      pageTitle: await this.pageSession.page.title().catch(() => ""),
      currentAccount,
      indicators: [],
      errorMessage: undefined
    };
  }

  private readAccountAttentionMessage(): string | undefined {
    if (this.sessionInspection === undefined) {
      return undefined;
    }

    if (this.sessionInspection.state === "challenge_required") {
      return "Current browser session needs manual verification before more search tasks run.";
    }

    if (this.sessionInspection.state === "logged_out") {
      return "Current browser session appears logged out. Log in through noVNC before searching.";
    }

    if (this.sessionInspection.state === "browser_closed") {
      return "Browser page is closed. Restart the API service.";
    }

    return undefined;
  }

  private createRunningTask(
    type: BackgroundTaskType,
    input: Readonly<Record<string, unknown>>
  ): BackgroundTaskSnapshot {
    return {
      id: randomUUID(),
      type,
      state: "running",
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      input,
      resultSummary: undefined,
      error: undefined
    };
  }

  private completeTask(
    task: BackgroundTaskSnapshot,
    resultSummary: Readonly<Record<string, unknown>>
  ): BackgroundTaskSnapshot {
    const completedTask: BackgroundTaskSnapshot = {
      ...task,
      state: "completed",
      completedAt: new Date().toISOString(),
      resultSummary,
      error: undefined
    };

    this.lastTask = completedTask;
    return completedTask;
  }

  private failTask(
    task: BackgroundTaskSnapshot,
    error: unknown
  ): BackgroundTaskSnapshot {
    const failedTask: BackgroundTaskSnapshot = {
      ...task,
      state: "failed",
      completedAt: new Date().toISOString(),
      resultSummary: undefined,
      error: serializeError(error)
    };

    this.lastTask = failedTask;
    return failedTask;
  }

  private async closeSessions(reason: string): Promise<void> {
    this.logger.info(
      {
        module: "background_service",
        stage: "shutdown_started",
        reason
      },
      "Background browser service shutdown started."
    );

    if (this.pageSession !== undefined) {
      await closePageSession(this.pageSession, this.logger).catch(
        (error: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "page_close_failed",
              error: serializeError(error)
            },
            "Failed to close page session during shutdown."
          );
        }
      );
    }

    if (this.browserSession !== undefined) {
      await closeBrowserSession(this.browserSession, this.logger).catch(
        (error: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "browser_close_failed",
              error: serializeError(error)
            },
            "Failed to close browser session during shutdown."
          );
        }
      );
    }

    this.pageSession = undefined;
    this.browserSession = undefined;

    this.logger.info(
      {
        module: "background_service",
        stage: "shutdown_completed",
        reason
      },
      "Background browser service shutdown completed."
    );
  }
}
