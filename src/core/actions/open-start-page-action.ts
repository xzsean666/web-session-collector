import type { Logger } from "pino";
import type { PageSession } from "../context/page-session.js";
import type { NavigationConfig } from "../types/runtime.js";
import type { StartPageNavigationResult } from "../types/start-page-navigation.js";

export async function openStartPageAction(
  pageSession: PageSession,
  navigationConfig: NavigationConfig,
  logger: Logger
): Promise<StartPageNavigationResult> {
  const startedAt = new Date().toISOString();

  logger.info(
    {
      module: "actions",
      action: "open_start_page",
      stage: "started",
      startUrl: navigationConfig.startUrl
    },
    "Opening start page."
  );

  await pageSession.page.goto(navigationConfig.startUrl, {
    waitUntil: "domcontentloaded"
  });

  const result: StartPageNavigationResult = {
    startUrl: navigationConfig.startUrl,
    finalUrl: pageSession.page.url(),
    pageTitle: await safeReadPageTitle(pageSession),
    pageReadyState: await safeReadPageReadyState(pageSession),
    startedAt,
    completedAt: new Date().toISOString()
  };

  logger.info(
    {
      module: "actions",
      action: "open_start_page",
      stage: "completed",
      startUrl: result.startUrl,
      finalUrl: result.finalUrl,
      pageTitle: result.pageTitle,
      pageReadyState: result.pageReadyState,
      startedAt: result.startedAt,
      completedAt: result.completedAt
    },
    "Start page opened."
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
