import type { Logger } from "pino";
import type { PageSession } from "../../core/context/page-session.js";
import type { CurrentAccountResult } from "../../core/types/current-account.js";

export async function getCurrentAccountAction(
  pageSession: PageSession,
  logger: Logger
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

  await pageSession.page.goto(profileUrl, {
    waitUntil: "domcontentloaded"
  });
  await pageSession.page.waitForSelector(".user-name", {
    timeout: 10_000
  });

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

async function readLocatorText(
  pageSession: PageSession,
  selector: string
): Promise<string> {
  const textContent = await pageSession.page.locator(selector).first().textContent();
  return textContent?.replace(/\s+/g, " ").trim() ?? "";
}
