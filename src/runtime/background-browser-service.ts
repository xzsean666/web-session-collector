import { mkdirSync } from "node:fs";
import path from "node:path";
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
import type {
  SessionInspectionResult,
  SessionState
} from "../core/types/session-monitor.js";
import type { ProfileConfig, RuntimeConfig } from "../core/types/runtime.js";
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

export interface WebSessionSnapshot {
  readonly id: string;
  readonly state: SessionState;
  readonly isApiActive: boolean;
  readonly isIdleNovncTarget: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stateUpdatedAt: string | undefined;
  readonly stateUpdatedBy: string | undefined;
  readonly browser: {
    readonly connectionMode: string;
    readonly headless: boolean;
    readonly channel: string;
    readonly executablePath: string | undefined;
    readonly userDataDir: string;
    readonly profileName: string;
    readonly profileDirectory: string | undefined;
    readonly viewport: RuntimeConfig["browser"]["viewport"];
    readonly ready: boolean;
  };
  readonly page: {
    readonly closed: boolean;
    readonly url: string;
    readonly title: string;
  };
  readonly activeTask: BackgroundTaskSnapshot | undefined;
  readonly lastTask: BackgroundTaskSnapshot | undefined;
  readonly lastInspection: SessionInspectionResult | undefined;
  readonly monitor: {
    readonly running: boolean;
    readonly lastCheckStartedAt: string | undefined;
    readonly lastCheckCompletedAt: string | undefined;
    readonly lastSkippedReason: string | undefined;
  };
  readonly error: Readonly<Record<string, unknown>> | undefined;
}

export type SearchDispatchResult =
  | {
      readonly accepted: true;
      readonly task: BackgroundTaskSnapshot;
      readonly result: SearchTaskResult;
      readonly session: SessionInspectionResult | undefined;
      readonly webSession: WebSessionSnapshot;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | "busy"
        | "service_not_ready"
        | "account_attention_required"
        | "session_not_found"
        | "task_failed";
      readonly statusCode: number;
      readonly message: string;
      readonly activeTask: BackgroundTaskSnapshot | undefined;
      readonly session: SessionInspectionResult | undefined;
      readonly webSession: WebSessionSnapshot | undefined;
    };

export type SessionCheckDispatchResult =
  | {
      readonly accepted: true;
      readonly session: SessionInspectionResult;
      readonly webSession: WebSessionSnapshot;
    }
  | {
      readonly accepted: false;
      readonly statusCode: number;
      readonly message: string;
      readonly activeTask: BackgroundTaskSnapshot | undefined;
      readonly session: SessionInspectionResult | undefined;
      readonly webSession: WebSessionSnapshot | undefined;
    };

export interface BackgroundServiceStatus {
  readonly lifecycle: BackgroundServiceLifecycle;
  readonly startedAt: string | undefined;
  readonly stoppedAt: string | undefined;
  readonly siteKey: string;
  readonly apiActiveSessionId: string | undefined;
  readonly idleNovncSessionId: string | undefined;
  readonly sessions: readonly WebSessionSnapshot[];
  readonly activeSession: WebSessionSnapshot | undefined;
  readonly idleNovncSession: WebSessionSnapshot | undefined;
  readonly browser: WebSessionSnapshot["browser"];
  readonly page: WebSessionSnapshot["page"];
  readonly activeTask: BackgroundTaskSnapshot | undefined;
  readonly lastTask: BackgroundTaskSnapshot | undefined;
  readonly session: SessionInspectionResult | undefined;
  readonly monitor: {
    readonly intervalMs: number;
  };
  readonly error: Readonly<Record<string, unknown>> | undefined;
}

export interface BackgroundBrowserServiceOptions {
  readonly runtimeConfig: RuntimeConfig;
  readonly accountCheckIntervalMs: number;
  readonly logger: Logger;
}

export interface CreateWebSessionOptions {
  readonly id?: string;
  readonly activate?: boolean;
  readonly idleNovnc?: boolean;
}

export type WebSessionOperationResult =
  | {
      readonly accepted: true;
      readonly session: WebSessionSnapshot;
      readonly status: BackgroundServiceStatus;
    }
  | {
      readonly accepted: false;
      readonly statusCode: number;
      readonly code: string;
      readonly message: string;
      readonly session: WebSessionSnapshot | undefined;
      readonly status: BackgroundServiceStatus;
    };

interface ManagedWebSession {
  id: string;
  profile: ProfileConfig;
  browserSession: BrowserSession | undefined;
  pageSession: PageSession | undefined;
  createdAt: string;
  updatedAt: string;
  stateUpdatedAt: string | undefined;
  stateUpdatedBy: string | undefined;
  activeTask: BackgroundTaskSnapshot | undefined;
  lastTask: BackgroundTaskSnapshot | undefined;
  sessionInspection: SessionInspectionResult | undefined;
  monitorRunning: boolean;
  lastMonitorCheckStartedAt: string | undefined;
  lastMonitorCheckCompletedAt: string | undefined;
  lastMonitorSkippedReason: string | undefined;
  lastError: Readonly<Record<string, unknown>> | undefined;
}

const DEFAULT_SESSION_ID = "default";

export class BackgroundBrowserService {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly runtimeSiteAdapter: RuntimeSiteAdapter;
  private readonly accountCheckIntervalMs: number;
  private readonly logger: Logger;
  private readonly sessions = new Map<string, ManagedWebSession>();
  private lifecycle: BackgroundServiceLifecycle = "created";
  private startedAt: string | undefined;
  private stoppedAt: string | undefined;
  private apiActiveSessionId: string | undefined;
  private idleNovncSessionId: string | undefined;
  private monitorTimer: NodeJS.Timeout | undefined;
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
      await this.createSessionInternal({
        id: DEFAULT_SESSION_ID,
        activate: true,
        idleNovnc: true,
        useBaseProfile: true
      });

      this.lifecycle = "running";
      this.startMonitor();
    } catch (error) {
      this.lifecycle = "failed";
      this.lastError = serializeError(error);
      await this.closeAllSessions("startup_failed");
      throw error;
    }
  }

  async stop(reason = "service_stop"): Promise<void> {
    if (this.lifecycle === "stopped" || this.lifecycle === "stopping") {
      return;
    }

    this.lifecycle = "stopping";
    this.stopMonitor();
    await this.closeAllSessions(reason);
    this.stoppedAt = new Date().toISOString();
    this.lifecycle = "stopped";
  }

  async createSession(
    options: CreateWebSessionOptions = {}
  ): Promise<WebSessionOperationResult> {
    if (this.lifecycle !== "running") {
      return {
        accepted: false,
        statusCode: 503,
        code: "service_not_ready",
        message: "Background browser service is not ready.",
        session: undefined,
        status: await this.getStatus()
      };
    }

    if (
      this.runtimeConfig.browser.connectionMode === "connect" &&
      this.sessions.size > 0
    ) {
      return {
        accepted: false,
        statusCode: 409,
        code: "unsupported_in_connect_mode",
        message:
          "Creating additional web sessions is only supported in launch mode.",
        session: undefined,
        status: await this.getStatus()
      };
    }

    try {
      const session = await this.createSessionInternal({
        id: options.id,
        activate: options.activate ?? false,
        idleNovnc: options.idleNovnc ?? false,
        useBaseProfile: false
      });

      return {
        accepted: true,
        session: await this.snapshotSession(session),
        status: await this.getStatus()
      };
    } catch (error) {
      this.lastError = serializeError(error);
      return {
        accepted: false,
        statusCode: 400,
        code: "session_create_failed",
        message: error instanceof Error ? error.message : String(error),
        session: undefined,
        status: await this.getStatus()
      };
    }
  }

  async deleteSession(sessionId: string): Promise<WebSessionOperationResult> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return this.sessionNotFoundResult(sessionId);
    }

    if (session.activeTask !== undefined || session.monitorRunning) {
      return {
        accepted: false,
        statusCode: 409,
        code: "session_busy",
        message: "Session is busy.",
        session: await this.snapshotSession(session),
        status: await this.getStatus()
      };
    }

    await this.closeSession(session, "session_deleted");
    this.sessions.delete(sessionId);

    if (this.apiActiveSessionId === sessionId) {
      this.apiActiveSessionId = undefined;
    }

    if (this.idleNovncSessionId === sessionId) {
      this.idleNovncSessionId = undefined;
    }

    return {
      accepted: true,
      session: await this.snapshotClosedSession(session),
      status: await this.getStatus()
    };
  }

  async activateSession(sessionId: string): Promise<WebSessionOperationResult> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return this.sessionNotFoundResult(sessionId);
    }

    this.apiActiveSessionId = sessionId;
    session.updatedAt = new Date().toISOString();
    await this.bringSessionToFront(session);

    return {
      accepted: true,
      session: await this.snapshotSession(session),
      status: await this.getStatus()
    };
  }

  async setIdleNovncSession(
    sessionId: string
  ): Promise<WebSessionOperationResult> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return this.sessionNotFoundResult(sessionId);
    }

    this.idleNovncSessionId = sessionId;
    session.updatedAt = new Date().toISOString();
    await this.bringSessionToFront(session);

    return {
      accepted: true,
      session: await this.snapshotSession(session),
      status: await this.getStatus()
    };
  }

  async setSessionState(
    sessionId: string,
    state: SessionState,
    updatedBy = "api"
  ): Promise<WebSessionOperationResult> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return this.sessionNotFoundResult(sessionId);
    }

    const now = new Date().toISOString();
    session.sessionInspection = this.createSyntheticInspection(session, state, now);
    session.stateUpdatedAt = now;
    session.stateUpdatedBy = updatedBy;
    session.updatedAt = now;

    return {
      accepted: true,
      session: await this.snapshotSession(session),
      status: await this.getStatus()
    };
  }

  async runSearch(
    options: SearchTaskOptions,
    sessionId = this.apiActiveSessionId
  ): Promise<SearchDispatchResult> {
    const session = this.resolveRunnableSession(sessionId);

    if (!session.accepted) {
      return session;
    }

    const webSession = session.session;
    const pageSession = webSession.pageSession;

    if (pageSession === undefined || pageSession.page.isClosed()) {
      return {
        accepted: false,
        reason: "service_not_ready",
        statusCode: 503,
        message: `Session "${webSession.id}" is not ready.`,
        activeTask: webSession.activeTask,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    if (webSession.activeTask !== undefined) {
      return {
        accepted: false,
        reason: "busy",
        statusCode: 409,
        message: "Previous task is still running in this session.",
        activeTask: webSession.activeTask,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    if (webSession.monitorRunning) {
      return {
        accepted: false,
        reason: "busy",
        statusCode: 409,
        message: "Session monitor is still running in this session.",
        activeTask: undefined,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    const blockedMessage = this.readAccountAttentionMessage(webSession);

    if (blockedMessage !== undefined) {
      return {
        accepted: false,
        reason: "account_attention_required",
        statusCode:
          webSession.sessionInspection?.state === "logged_out" ? 428 : 423,
        message: blockedMessage,
        activeTask: undefined,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    await this.bringSessionToFront(webSession);

    const task = this.createRunningTask("search", {
      sessionId: webSession.id,
      siteKey: options.siteKey,
      keywords: options.keywords,
      recentDays: options.recentDays,
      limitPerKeyword: options.limitPerKeyword,
      scrollCount: options.scrollCount,
      fetchContent: options.fetchContent
    });
    webSession.activeTask = task;
    webSession.updatedAt = new Date().toISOString();

    try {
      const result = await runSearchTaskOnPage(
        pageSession,
        options,
        this.logger
      );
      const completedTask = this.completeTask(webSession, task, {
        keywordCount: result.results.length,
        itemCount: result.results.reduce(
          (totalCount, keywordResult) =>
            totalCount + keywordResult.matchedItems.length,
          0
        )
      });

      await this.refreshSessionStatus(webSession, "after_search");

      return {
        accepted: true,
        task: completedTask,
        result,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    } catch (error) {
      const failedTask = this.failTask(webSession, task, error);
      webSession.lastError = serializeError(error);
      await this.refreshSessionStatus(webSession, "after_search_error").catch(
        (monitorError: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "post_error_session_check_failed",
              sessionId: webSession.id,
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
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    } finally {
      webSession.activeTask = undefined;
      webSession.updatedAt = new Date().toISOString();
    }
  }

  async requestSessionCheck(
    reason = "manual",
    sessionId = this.apiActiveSessionId
  ): Promise<SessionCheckDispatchResult> {
    const session = this.resolveRunnableSession(sessionId);

    if (!session.accepted) {
      return {
        accepted: false,
        statusCode: session.statusCode,
        message: session.message,
        activeTask: session.activeTask,
        session: session.session,
        webSession: session.webSession
      };
    }

    const webSession = session.session;

    if (webSession.activeTask !== undefined) {
      return {
        accepted: false,
        statusCode: 409,
        message: "Task is still running in this session.",
        activeTask: webSession.activeTask,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    if (webSession.monitorRunning) {
      return {
        accepted: false,
        statusCode: 409,
        message: "Session monitor is still running in this session.",
        activeTask: undefined,
        session: webSession.sessionInspection,
        webSession: await this.snapshotSession(webSession)
      };
    }

    webSession.monitorRunning = true;

    try {
      return {
        accepted: true,
        session: await this.refreshSessionStatus(webSession, reason),
        webSession: await this.snapshotSession(webSession)
      };
    } finally {
      webSession.monitorRunning = false;
    }
  }

  async getStatus(): Promise<BackgroundServiceStatus> {
    const sessions = await Promise.all(
      Array.from(this.sessions.values()).map((session) =>
        this.snapshotSession(session)
      )
    );
    const activeSession = sessions.find(
      (session) => session.id === this.apiActiveSessionId
    );
    const idleNovncSession = sessions.find(
      (session) => session.id === this.idleNovncSessionId
    );

    return {
      lifecycle: this.lifecycle,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      siteKey: this.runtimeSiteAdapter.siteKey,
      apiActiveSessionId: this.apiActiveSessionId,
      idleNovncSessionId: this.idleNovncSessionId,
      sessions,
      activeSession,
      idleNovncSession,
      browser: activeSession?.browser ?? this.emptyBrowserStatus(),
      page: activeSession?.page ?? this.emptyPageStatus(),
      activeTask: activeSession?.activeTask,
      lastTask: activeSession?.lastTask,
      session: activeSession?.lastInspection,
      monitor: {
        intervalMs: this.accountCheckIntervalMs
      },
      error: this.lastError
    };
  }

  private async createSessionInternal(options: {
    readonly id: string | undefined;
    readonly activate: boolean;
    readonly idleNovnc: boolean;
    readonly useBaseProfile: boolean;
  }): Promise<ManagedWebSession> {
    const sessionId = this.normalizeSessionId(options.id ?? randomUUID());

    if (this.sessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" already exists.`);
    }

    const profile = this.createProfileForSession(sessionId, options.useBaseProfile);
    mkdirSync(profile.userDataDir, { recursive: true });

    const createdAt = new Date().toISOString();
    const session: ManagedWebSession = {
      id: sessionId,
      profile,
      browserSession: undefined,
      pageSession: undefined,
      createdAt,
      updatedAt: createdAt,
      stateUpdatedAt: undefined,
      stateUpdatedBy: undefined,
      activeTask: undefined,
      lastTask: undefined,
      sessionInspection: undefined,
      monitorRunning: false,
      lastMonitorCheckStartedAt: undefined,
      lastMonitorCheckCompletedAt: undefined,
      lastMonitorSkippedReason: undefined,
      lastError: undefined
    };

    this.sessions.set(sessionId, session);

    try {
      session.browserSession = await createBrowserSession(
        profile,
        this.runtimeConfig.browser,
        this.logger
      );
      session.pageSession = await createPageSession(
        session.browserSession.browserContext,
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
        session.pageSession,
        profile,
        this.logger
      );
      await openStartPageAction(
        session.pageSession,
        this.runtimeConfig.navigation,
        this.logger
      );

      if (options.activate) {
        this.apiActiveSessionId = sessionId;
      }

      if (options.idleNovnc) {
        this.idleNovncSessionId = sessionId;
      }

      await this.refreshSessionStatus(session, "startup");
      await this.bringSessionToFront(session);

      this.logger.info(
        {
          module: "background_service",
          stage: "web_session_created",
          sessionId,
          userDataDir: profile.userDataDir,
          isApiActive: this.apiActiveSessionId === sessionId,
          isIdleNovncTarget: this.idleNovncSessionId === sessionId
        },
        "Web session created."
      );

      return session;
    } catch (error) {
      session.lastError = serializeError(error);
      await this.closeSession(session, "session_create_failed").catch(
        (closeError: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "session_create_cleanup_failed",
              sessionId,
              error: serializeError(closeError)
            },
            "Failed to clean up partially created web session."
          );
        }
      );
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  private createProfileForSession(
    sessionId: string,
    useBaseProfile: boolean
  ): ProfileConfig {
    if (useBaseProfile) {
      return this.runtimeConfig.profile;
    }

    return {
      profileName: `${this.runtimeConfig.profile.profileName}-${sessionId}`,
      userDataDir: path.join(
        this.runtimeConfig.profile.userDataDir,
        "sessions",
        sessionId
      )
    };
  }

  private normalizeSessionId(sessionId: string): string {
    const normalizedSessionId = sessionId.trim();

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalizedSessionId)) {
      throw new Error(
        "Session id must be 1-64 characters and contain only letters, numbers, underscore, or dash."
      );
    }

    return normalizedSessionId;
  }

  private resolveRunnableSession(
    sessionId: string | undefined
  ):
    | { readonly accepted: true; readonly session: ManagedWebSession }
    | {
        readonly accepted: false;
        readonly reason: "service_not_ready" | "session_not_found";
        readonly statusCode: number;
        readonly message: string;
        readonly activeTask: BackgroundTaskSnapshot | undefined;
        readonly session: SessionInspectionResult | undefined;
        readonly webSession: WebSessionSnapshot | undefined;
      } {
    if (this.lifecycle !== "running") {
      return {
        accepted: false,
        reason: "service_not_ready",
        statusCode: 503,
        message: "Background browser service is not ready.",
        activeTask: undefined,
        session: undefined,
        webSession: undefined
      };
    }

    if (sessionId === undefined) {
      return {
        accepted: false,
        reason: "service_not_ready",
        statusCode: 409,
        message: "No API-active session is selected.",
        activeTask: undefined,
        session: undefined,
        webSession: undefined
      };
    }

    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return {
        accepted: false,
        reason: "session_not_found",
        statusCode: 404,
        message: `Session "${sessionId}" was not found.`,
        activeTask: undefined,
        session: undefined,
        webSession: undefined
      };
    }

    if (session.pageSession === undefined || session.pageSession.page.isClosed()) {
      return {
        accepted: false,
        reason: "service_not_ready",
        statusCode: 503,
        message: `Session "${sessionId}" is not ready.`,
        activeTask: session.activeTask,
        session: session.sessionInspection,
        webSession: undefined
      };
    }

    return {
      accepted: true,
      session
    };
  }

  private async refreshSessionStatus(
    session: ManagedWebSession,
    reason = "manual"
  ): Promise<SessionInspectionResult> {
    if (session.pageSession === undefined) {
      const checkedAt = new Date().toISOString();
      session.sessionInspection = {
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
      session.updatedAt = checkedAt;
      return session.sessionInspection;
    }

    session.lastMonitorCheckStartedAt = new Date().toISOString();
    session.lastMonitorSkippedReason = undefined;

    try {
      session.sessionInspection =
        this.runtimeSiteAdapter.inspectSession === undefined
          ? await this.inspectSessionWithCurrentAccountFallback(session)
          : await this.runtimeSiteAdapter.inspectSession(
              session.pageSession,
              this.logger
            );
      session.lastMonitorCheckCompletedAt = new Date().toISOString();
      session.updatedAt = session.lastMonitorCheckCompletedAt;

      this.logger.info(
        {
          module: "background_service",
          stage: "session_status_checked",
          sessionId: session.id,
          reason,
          state: session.sessionInspection.state,
          indicatorCodes: session.sessionInspection.indicators.map(
            (indicator) => indicator.code
          )
        },
        "Session status checked."
      );

      return session.sessionInspection;
    } catch (error) {
      session.lastMonitorCheckCompletedAt = new Date().toISOString();
      session.lastError = serializeError(error);
      session.updatedAt = session.lastMonitorCheckCompletedAt;
      session.sessionInspection = {
        siteKey: this.runtimeSiteAdapter.siteKey,
        state: "error",
        checkedAt: new Date().toISOString(),
        pageUrl: session.pageSession.page.url(),
        pageTitle: await session.pageSession.page.title().catch(() => ""),
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
      return session.sessionInspection;
    }
  }

  private async inspectSessionWithCurrentAccountFallback(
    session: ManagedWebSession
  ): Promise<SessionInspectionResult> {
    if (session.pageSession === undefined) {
      throw new Error("Page session is not available.");
    }

    const currentAccount = await this.runtimeSiteAdapter.getCurrentAccount(
      session.pageSession,
      this.logger
    );

    return {
      siteKey: this.runtimeSiteAdapter.siteKey,
      state: currentAccount.found ? "logged_in" : "unknown",
      checkedAt: new Date().toISOString(),
      pageUrl: session.pageSession.page.url(),
      pageTitle: await session.pageSession.page.title().catch(() => ""),
      currentAccount,
      indicators: [],
      errorMessage: undefined
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
    if (this.lifecycle !== "running") {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session.monitorRunning) {
        session.lastMonitorSkippedReason = "previous_monitor_still_running";
        continue;
      }

      if (session.activeTask !== undefined) {
        session.lastMonitorSkippedReason = "task_running";
        continue;
      }

      if (session.pageSession === undefined || session.pageSession.page.isClosed()) {
        session.lastMonitorSkippedReason = "page_not_ready";
        continue;
      }

      session.monitorRunning = true;

      try {
        await this.refreshSessionStatus(session, "scheduled");
      } finally {
        session.monitorRunning = false;
      }
    }
  }

  private readAccountAttentionMessage(
    session: ManagedWebSession
  ): string | undefined {
    if (session.sessionInspection === undefined) {
      return undefined;
    }

    if (session.sessionInspection.state === "challenge_required") {
      return "Current browser session needs manual verification through idle noVNC before more search tasks run.";
    }

    if (session.sessionInspection.state === "logged_out") {
      return "Current browser session appears logged out. Log in through idle noVNC before searching.";
    }

    if (session.sessionInspection.state === "browser_closed") {
      return "Browser page is closed. Restart or recreate the session.";
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
    session: ManagedWebSession,
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

    session.lastTask = completedTask;
    return completedTask;
  }

  private failTask(
    session: ManagedWebSession,
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

    session.lastTask = failedTask;
    return failedTask;
  }

  private createSyntheticInspection(
    session: ManagedWebSession,
    state: SessionState,
    checkedAt: string
  ): SessionInspectionResult {
    return {
      siteKey: this.runtimeSiteAdapter.siteKey,
      state,
      checkedAt,
      pageUrl: session.pageSession?.page.url() ?? "",
      pageTitle:
        session.pageSession === undefined || session.pageSession.page.isClosed()
          ? ""
          : "",
      currentAccount: session.sessionInspection?.currentAccount,
      indicators: [
        {
          code: "api_state_update",
          severity: "info",
          message: "Session state was updated through the API."
        }
      ],
      errorMessage: undefined
    };
  }

  private async bringSessionToFront(session: ManagedWebSession): Promise<void> {
    if (session.pageSession === undefined || session.pageSession.page.isClosed()) {
      return;
    }

    await session.pageSession.page.bringToFront().catch((error: unknown) => {
      this.logger.warn(
        {
          module: "background_service",
          stage: "bring_to_front_failed",
          sessionId: session.id,
          error: serializeError(error)
        },
        "Failed to bring web session page to front."
      );
    });
  }

  private async closeAllSessions(reason: string): Promise<void> {
    this.logger.info(
      {
        module: "background_service",
        stage: "shutdown_started",
        reason,
        sessionCount: this.sessions.size
      },
      "Background browser service shutdown started."
    );

    for (const session of this.sessions.values()) {
      await this.closeSession(session, reason);
    }

    this.sessions.clear();
    this.apiActiveSessionId = undefined;
    this.idleNovncSessionId = undefined;

    this.logger.info(
      {
        module: "background_service",
        stage: "shutdown_completed",
        reason
      },
      "Background browser service shutdown completed."
    );
  }

  private async closeSession(
    session: ManagedWebSession,
    reason: string
  ): Promise<void> {
    this.logger.info(
      {
        module: "background_service",
        stage: "session_shutdown_started",
        reason,
        sessionId: session.id
      },
      "Web session shutdown started."
    );

    if (session.pageSession !== undefined) {
      await closePageSession(session.pageSession, this.logger).catch(
        (error: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "page_close_failed",
              sessionId: session.id,
              error: serializeError(error)
            },
            "Failed to close page session during shutdown."
          );
        }
      );
    }

    if (session.browserSession !== undefined) {
      await closeBrowserSession(session.browserSession, this.logger).catch(
        (error: unknown) => {
          this.logger.warn(
            {
              module: "background_service",
              stage: "browser_close_failed",
              sessionId: session.id,
              error: serializeError(error)
            },
            "Failed to close browser session during shutdown."
          );
        }
      );
    }

    session.pageSession = undefined;
    session.browserSession = undefined;
    session.sessionInspection = this.createSyntheticInspection(
      session,
      "browser_closed",
      new Date().toISOString()
    );
    session.updatedAt = new Date().toISOString();

    this.logger.info(
      {
        module: "background_service",
        stage: "session_shutdown_completed",
        reason,
        sessionId: session.id
      },
      "Web session shutdown completed."
    );
  }

  private async snapshotSession(
    session: ManagedWebSession
  ): Promise<WebSessionSnapshot> {
    const page = session.pageSession?.page;

    return {
      id: session.id,
      state: session.sessionInspection?.state ?? "unknown",
      isApiActive: this.apiActiveSessionId === session.id,
      isIdleNovncTarget: this.idleNovncSessionId === session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      stateUpdatedAt: session.stateUpdatedAt,
      stateUpdatedBy: session.stateUpdatedBy,
      browser: {
        connectionMode: this.runtimeConfig.browser.connectionMode,
        headless: this.runtimeConfig.browser.headless,
        channel: this.runtimeConfig.browser.channel,
        executablePath: this.runtimeConfig.browser.executablePath,
        userDataDir: session.profile.userDataDir,
        profileName: session.profile.profileName,
        profileDirectory: this.runtimeConfig.browser.profileDirectory,
        viewport: this.runtimeConfig.browser.viewport,
        ready: session.browserSession !== undefined
      },
      page: {
        closed: page === undefined || page.isClosed(),
        url: page?.url() ?? "",
        title:
          page === undefined || page.isClosed()
            ? ""
            : await page.title().catch(() => "")
      },
      activeTask: session.activeTask,
      lastTask: session.lastTask,
      lastInspection: session.sessionInspection,
      monitor: {
        running: session.monitorRunning,
        lastCheckStartedAt: session.lastMonitorCheckStartedAt,
        lastCheckCompletedAt: session.lastMonitorCheckCompletedAt,
        lastSkippedReason: session.lastMonitorSkippedReason
      },
      error: session.lastError
    };
  }

  private async snapshotClosedSession(
    session: ManagedWebSession
  ): Promise<WebSessionSnapshot> {
    return this.snapshotSession(session);
  }

  private async sessionNotFoundResult(
    sessionId: string
  ): Promise<WebSessionOperationResult> {
    return {
      accepted: false,
      statusCode: 404,
      code: "session_not_found",
      message: `Session "${sessionId}" was not found.`,
      session: undefined,
      status: await this.getStatus()
    };
  }

  private emptyBrowserStatus(): WebSessionSnapshot["browser"] {
    return {
      connectionMode: this.runtimeConfig.browser.connectionMode,
      headless: this.runtimeConfig.browser.headless,
      channel: this.runtimeConfig.browser.channel,
      executablePath: this.runtimeConfig.browser.executablePath,
      userDataDir: this.runtimeConfig.profile.userDataDir,
      profileName: this.runtimeConfig.profile.profileName,
      profileDirectory: this.runtimeConfig.browser.profileDirectory,
      viewport: this.runtimeConfig.browser.viewport,
      ready: false
    };
  }

  private emptyPageStatus(): WebSessionSnapshot["page"] {
    return {
      closed: true,
      url: "",
      title: ""
    };
  }
}
