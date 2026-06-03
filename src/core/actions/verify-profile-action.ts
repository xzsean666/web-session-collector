import type { Logger } from "pino";
import type { PageSession } from "../context/page-session.js";
import type { ProfileConfig } from "../types/runtime.js";
import type { ProfileVerificationResult } from "../types/profile-verification.js";

export async function verifyProfileAction(
  pageSession: PageSession,
  profileConfig: ProfileConfig,
  logger: Logger
): Promise<ProfileVerificationResult> {
  const startedAt = new Date().toISOString();

  logger.info(
    {
      module: "actions",
      action: "verify_profile",
      stage: "started",
      profileName: profileConfig.profileName,
      userDataDir: profileConfig.userDataDir
    },
    "Profile verification started."
  );

  const pageAvailable = !pageSession.page.isClosed();
  const pageUrl = pageAvailable ? pageSession.page.url() : "";
  const pageTitle = pageAvailable ? await safeReadPageTitle(pageSession) : "";
  const pageReadyState = pageAvailable
    ? await safeReadPageReadyState(pageSession)
    : "unavailable";

  const result: ProfileVerificationResult = {
    profileName: profileConfig.profileName,
    userDataDir: profileConfig.userDataDir,
    contextAvailable: true,
    pageAvailable,
    pageUrl,
    pageTitle,
    pageReadyState,
    startedAt,
    completedAt: new Date().toISOString()
  };

  logger.info(
    {
      module: "actions",
      action: "verify_profile",
      stage: "completed",
      profileName: result.profileName,
      userDataDir: result.userDataDir,
      contextAvailable: result.contextAvailable,
      pageAvailable: result.pageAvailable,
      pageUrl: result.pageUrl,
      pageTitle: result.pageTitle,
      pageReadyState: result.pageReadyState,
      startedAt: result.startedAt,
      completedAt: result.completedAt
    },
    "Profile verification completed."
  );

  return result;
}

async function safeReadPageTitle(pageSession: PageSession): Promise<string> {
  try {
    return await pageSession.page.title();
  } catch {
    return "";
  }
}

async function safeReadPageReadyState(pageSession: PageSession): Promise<string> {
  try {
    return await pageSession.page.evaluate(() => document.readyState);
  } catch {
    return "unknown";
  }
}
