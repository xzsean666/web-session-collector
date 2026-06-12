import type { Logger } from "pino";
import type { PageSession } from "../../core/context/page-session.js";
import type { CurrentAccountResult } from "../../core/types/current-account.js";
import type {
  SessionIndicator,
  SessionInspectionResult,
  SessionState
} from "../../core/types/session-monitor.js";
import { serializeError } from "../../core/monitoring/logger.js";
import { getCurrentAccountAction } from "./current-user-action.js";

interface IndicatorRule {
  readonly code: string;
  readonly severity: SessionIndicator["severity"];
  readonly message: string;
  readonly pattern: RegExp;
}

interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

const challengeRules: readonly IndicatorRule[] = [
  {
    code: "security_verification",
    severity: "critical",
    message: "页面出现安全验证或身份验证提示，需要人工处理。",
    pattern: /安全验证|身份验证|请完成验证|验证身份/
  },
  {
    code: "captcha",
    severity: "critical",
    message: "页面出现验证码、滑块或拖动验证提示，需要人工处理。",
    pattern: /验证码|滑块|拖动|拼图|captcha/i
  },
  {
    code: "rate_limited",
    severity: "critical",
    message: "页面出现访问频繁或操作频繁提示，建议暂停任务。",
    pattern: /访问频繁|操作频繁|请求频繁|请稍后再试|too many requests/i
  },
  {
    code: "account_risk",
    severity: "critical",
    message: "页面出现账号异常、风险或访问受限提示，需要人工检查账号状态。",
    pattern: /账号异常|账号存在风险|账号风险|环境异常|异常流量|访问受限|限制访问|拒绝访问/
  }
];

const loginRules: readonly IndicatorRule[] = [
  {
    code: "login_required",
    severity: "warning",
    message: "页面出现登录提示，账号可能已退出或登录态失效。",
    pattern: /请登录|登录后|扫码登录|手机号登录|验证码登录|登录小红书|登录已过期/
  },
  {
    code: "login_url",
    severity: "warning",
    message: "当前 URL 看起来是登录或认证页面。",
    pattern: /\/login|passport|signin|auth/i
  }
];

const urlChallengeRule: IndicatorRule = {
  code: "challenge_url",
  severity: "critical",
  message: "当前 URL 看起来是验证或安全挑战页面。",
  pattern: /captcha|verify|verification|security|challenge/i
};

export async function inspectXiaohongshuSession(
  pageSession: PageSession,
  logger: Logger
): Promise<SessionInspectionResult> {
  const checkedAt = new Date().toISOString();

  if (pageSession.page.isClosed()) {
    return {
      siteKey: "xiaohongshu",
      state: "browser_closed",
      checkedAt,
      pageUrl: "",
      pageTitle: "",
      currentAccount: undefined,
      indicators: [
        {
          code: "page_closed",
          severity: "critical",
          message: "浏览器页面已经关闭。"
        }
      ],
      errorMessage: undefined
    };
  }

  let pageSnapshot = await readPageSnapshot(pageSession);

  if (await returnHomeFromSafetyRestrictionIfNeeded(pageSession, pageSnapshot, logger)) {
    pageSnapshot = await readPageSnapshot(pageSession);
  }

  const indicators = findSessionIndicators(pageSnapshot);
  const challengeDetected = indicators.some(
    (indicator) => indicator.severity === "critical"
  );
  let currentAccount: CurrentAccountResult | undefined;
  let accountErrorMessage: string | undefined;

  if (!challengeDetected) {
    try {
      currentAccount = await getCurrentAccountAction(pageSession, logger);
    } catch (error) {
      accountErrorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          module: "session_monitor",
          siteKey: "xiaohongshu",
          stage: "current_account_lookup_failed",
          error: serializeError(error)
        },
        "Current account lookup failed during session inspection."
      );
    }
  }

  let refreshedPageSnapshot = await readPageSnapshot(pageSession);

  if (
    await returnHomeFromSafetyRestrictionIfNeeded(
      pageSession,
      refreshedPageSnapshot,
      logger
    )
  ) {
    refreshedPageSnapshot = await readPageSnapshot(pageSession);
    accountErrorMessage = undefined;
  }

  const refreshedIndicators = mergeIndicators(
    indicators,
    findSessionIndicators(refreshedPageSnapshot)
  );

  return {
    siteKey: "xiaohongshu",
    state: decideSessionState(
      currentAccount,
      refreshedIndicators,
      accountErrorMessage
    ),
    checkedAt,
    pageUrl: refreshedPageSnapshot.url,
    pageTitle: refreshedPageSnapshot.title,
    currentAccount,
    indicators: refreshedIndicators,
    errorMessage: accountErrorMessage
  };
}

async function readPageSnapshot(pageSession: PageSession): Promise<PageSnapshot> {
  const [title, text] = await Promise.all([
    pageSession.page.title().catch(() => ""),
    pageSession.page
      .locator("body")
      .innerText({ timeout: 2_000 })
      .catch(() => "")
  ]);

  return {
    url: pageSession.page.url(),
    title,
    text: normalizeVisibleText(text)
  };
}

async function returnHomeFromSafetyRestrictionIfNeeded(
  pageSession: PageSession,
  snapshot: PageSnapshot,
  logger: Logger
): Promise<boolean> {
  if (!isReturnHomeSafetyRestriction(snapshot)) {
    return false;
  }

  try {
    logger.warn(
      {
        module: "session_monitor",
        siteKey: "xiaohongshu",
        stage: "safety_restriction_return_home_started",
        pageUrl: snapshot.url,
        pageTitle: snapshot.title
      },
      "Xiaohongshu safety restriction page detected; clicking return home once."
    );

    await pageSession.page.getByText("返回首页", { exact: true }).click({
      timeout: 3_000
    });
    await pageSession.page
      .waitForURL((pageUrl) => !isSafetyRestrictionUrl(pageUrl.toString()), {
        timeout: 10_000
      })
      .catch(() => undefined);
    await pageSession.page
      .waitForLoadState("domcontentloaded", { timeout: 10_000 })
      .catch(() => undefined);
    await pageSession.page.waitForTimeout(1_000);

    logger.info(
      {
        module: "session_monitor",
        siteKey: "xiaohongshu",
        stage: "safety_restriction_return_home_completed",
        pageUrl: pageSession.page.url()
      },
      "Returned from Xiaohongshu safety restriction page."
    );

    return true;
  } catch (error) {
    logger.warn(
      {
        module: "session_monitor",
        siteKey: "xiaohongshu",
        stage: "safety_restriction_return_home_failed",
        pageUrl: snapshot.url,
        pageTitle: snapshot.title,
        error: serializeError(error)
      },
      "Failed to click return home on Xiaohongshu safety restriction page."
    );

    return false;
  }
}

function isReturnHomeSafetyRestriction(snapshot: PageSnapshot): boolean {
  const haystack = `${snapshot.url}\n${snapshot.title}\n${snapshot.text}`;

  return (
    isSafetyRestrictionUrl(snapshot.url) &&
    /(?:[?&]error_code=300011\b|300011)/.test(haystack) &&
    /安全限制/.test(haystack) &&
    /返回首页/.test(snapshot.text)
  );
}

function isSafetyRestrictionUrl(pageUrl: string): boolean {
  return /\/website-login\/error/.test(pageUrl);
}

function normalizeVisibleText(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 20_000);
}

function findSessionIndicators(snapshot: PageSnapshot): readonly SessionIndicator[] {
  const haystack = `${snapshot.url}\n${snapshot.title}\n${snapshot.text}`;
  const indicators: SessionIndicator[] = [];

  if (urlChallengeRule.pattern.test(snapshot.url)) {
    indicators.push(indicatorFromRule(urlChallengeRule));
  }

  for (const rule of [...challengeRules, ...loginRules]) {
    if (rule.pattern.test(haystack)) {
      indicators.push(indicatorFromRule(rule));
    }
  }

  return mergeIndicators(indicators);
}

function indicatorFromRule(rule: IndicatorRule): SessionIndicator {
  return {
    code: rule.code,
    severity: rule.severity,
    message: rule.message
  };
}

function mergeIndicators(
  ...indicatorGroups: readonly (readonly SessionIndicator[])[]
): readonly SessionIndicator[] {
  const byCode = new Map<string, SessionIndicator>();

  for (const indicators of indicatorGroups) {
    for (const indicator of indicators) {
      byCode.set(indicator.code, indicator);
    }
  }

  return Array.from(byCode.values()).sort((left, right) =>
    left.code.localeCompare(right.code)
  );
}

function decideSessionState(
  currentAccount: CurrentAccountResult | undefined,
  indicators: readonly SessionIndicator[],
  accountErrorMessage: string | undefined
): SessionState {
  if (indicators.some((indicator) => indicator.severity === "critical")) {
    return "challenge_required";
  }

  if (currentAccount?.found) {
    return "logged_in";
  }

  if (indicators.some((indicator) => indicator.severity === "warning")) {
    return "logged_out";
  }

  if (accountErrorMessage !== undefined) {
    return "error";
  }

  return "unknown";
}
