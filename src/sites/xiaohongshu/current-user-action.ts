import type { Logger } from "pino";
import type { PageSession } from "../../core/context/page-session.js";
import type { CurrentAccountResult } from "../../core/types/current-account.js";

interface GetCurrentAccountOptions {
  readonly allowPartialFromProfileLink?: boolean;
}

export async function getCurrentAccountAction(
  pageSession: PageSession,
  logger: Logger,
  options: GetCurrentAccountOptions = {}
): Promise<CurrentAccountResult> {
  const startedAt = new Date().toISOString();

  logger.info(
    {
      module: "actions",
      action: "print_current_user",
      stage: "started"
    },
    "Current user lookup started."
  );

  const profileUrl = await findCurrentUserProfileUrl(pageSession);

  if (profileUrl === "") {
    const missingResult: CurrentAccountResult = {
      siteKey: "xiaohongshu",
      displayName: "小红书",
      profileUrl: "",
      accountId: "",
      accountName: "",
      accountHandle: "",
      description: "",
      found: false,
      startedAt,
      completedAt: new Date().toISOString(),
      metadata: {}
    };

    logger.warn(
      {
        module: "actions",
        action: "print_current_user",
        stage: "not_found",
        found: missingResult.found
      },
      "Current user profile link was not found."
    );

    return missingResult;
  }

  try {
    await pageSession.page.goto(profileUrl, {
      waitUntil: "domcontentloaded"
    });
    await pageSession.page.waitForSelector(".user-name", {
      timeout: 10_000
    });
  } catch (error) {
    if (
      options.allowPartialFromProfileLink === true &&
      isRecoverableProfileLookupRestriction(pageSession.page.url())
    ) {
      const partialResult = createPartialAccountResult(startedAt, profileUrl);

      logger.warn(
        {
          module: "actions",
          action: "print_current_user",
          stage: "partial_profile_lookup_blocked",
          found: partialResult.found,
          accountId: partialResult.accountId,
          profileUrl: partialResult.profileUrl,
          pageUrl: pageSession.page.url(),
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        "Current user profile details were blocked; using visible profile link as login evidence."
      );

      return partialResult;
    }

    throw error;
  }

  const userDetails = {
    nickname: await readLocatorText(pageSession, ".user-name"),
    redIdText: await readLocatorText(pageSession, ".user-redId"),
    description: await readLocatorText(pageSession, ".user-desc")
  };

  const userId = readUserIdFromProfileUrl(pageSession.page.url());
  const redId = normalizeRedId(userDetails.redIdText);

  const result: CurrentAccountResult = {
    siteKey: "xiaohongshu",
    displayName: "小红书",
    profileUrl: pageSession.page.url(),
    accountId: userId,
    accountName: userDetails.nickname,
    accountHandle: redId,
    description: userDetails.description,
    found: userDetails.nickname !== "",
    startedAt,
    completedAt: new Date().toISOString(),
    metadata: {
      nickname: userDetails.nickname,
      redId,
      userId
    }
  };

  logger.info(
    {
      module: "actions",
      action: "print_current_user",
      stage: "completed",
      found: result.found,
      accountName: result.accountName,
      accountHandle: result.accountHandle,
      description: result.description,
      accountId: result.accountId,
      profileUrl: result.profileUrl,
      siteKey: result.siteKey,
      startedAt: result.startedAt,
      completedAt: result.completedAt
    },
    "Current user lookup completed."
  );

  return result;
}

function createPartialAccountResult(
  startedAt: string,
  profileUrl: string
): CurrentAccountResult {
  const userId = readUserIdFromProfileUrl(profileUrl);

  return {
    siteKey: "xiaohongshu",
    displayName: "小红书",
    profileUrl,
    accountId: userId,
    accountName: "Xiaohongshu account",
    accountHandle: "",
    description: "",
    found: true,
    startedAt,
    completedAt: new Date().toISOString(),
    metadata: {
      partial: "true",
      partialReason: "profile_safety_restriction",
      userId
    }
  };
}

async function findCurrentUserProfileUrl(
  pageSession: PageSession
): Promise<string> {
  const currentUserLink = pageSession.page
    .locator('a[href*="/user/profile/"]')
    .filter({ hasText: /^我$/ })
    .first();

  let href: string | null;

  try {
    href = await currentUserLink.getAttribute("href", {
      timeout: 5_000
    });
  } catch {
    return "";
  }

  if (href === null) {
    return "";
  }

  return new URL(href, pageSession.page.url()).toString();
}

function readUserIdFromProfileUrl(profileUrl: string): string {
  try {
    const url = new URL(profileUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] ?? "";
  } catch {
    return "";
  }
}

function normalizeRedId(redIdText: string): string {
  return redIdText.replace(/^小红书号[:：]\s*/, "").trim();
}

function isRecoverableProfileLookupRestriction(pageUrl: string): boolean {
  return (
    /\/website-login\/error/.test(pageUrl) &&
    /(?:[?&]error_code=300011\b|300011)/.test(pageUrl)
  );
}

async function readLocatorText(
  pageSession: PageSession,
  selector: string
): Promise<string> {
  const textContent = await pageSession.page.locator(selector).first().textContent();
  return textContent?.replace(/\s+/g, " ").trim() ?? "";
}
