import type { BrowserContext, Page } from "playwright";
import type { Logger } from "pino";

export interface PageSession {
  readonly browserContext: BrowserContext;
  readonly page: Page;
  readonly createdNewPage: boolean;
}

export interface PageSessionOptions {
  readonly allowNewPage: boolean;
  readonly preferNewPage: boolean;
  readonly requiredExistingPageHostSuffix: string | undefined;
}

export async function createPageSession(
  browserContext: BrowserContext,
  logger: Logger,
  options: PageSessionOptions = {
    allowNewPage: true,
    preferNewPage: false,
    requiredExistingPageHostSuffix: undefined
  }
): Promise<PageSession> {
  const existingPage = findExistingPage(browserContext, options);

  if (existingPage === undefined && !options.allowNewPage) {
    logger.warn(
      {
        module: "context",
        stage: "page_session_selection_failed",
        pageCount: browserContext.pages().length,
        requiredExistingPageHostSuffix: options.requiredExistingPageHostSuffix
      },
      "No acceptable existing page was found."
    );

    throw new Error(
      "No existing Xiaohongshu page was found in the connected Chrome process. " +
        "Open Xiaohongshu in the intended Chrome profile before running connect mode."
    );
  }

  const page = existingPage ?? (await browserContext.newPage());
  const createdNewPage = existingPage === undefined;

  logger.info(
    {
      module: "context",
      stage: "page_session_created",
      createdNewPage,
      pageCount: browserContext.pages().length,
      pageUrl: page.url()
    },
    "Page session is ready."
  );

  return {
    browserContext,
    page,
    createdNewPage
  };
}

function findExistingPage(
  browserContext: BrowserContext,
  options: PageSessionOptions
): Page | undefined {
  const openPages = browserContext.pages().filter((page) => !page.isClosed());

  const requiredExistingPageHostSuffix = options.requiredExistingPageHostSuffix;

  if (requiredExistingPageHostSuffix !== undefined) {
    return openPages.find((page) =>
      pageHostMatchesSuffix(page.url(), requiredExistingPageHostSuffix)
    );
  }

  if (options.preferNewPage) {
    return undefined;
  }

  return openPages[0];
}

function pageHostMatchesSuffix(pageUrl: string, requiredHostSuffix: string): boolean {
  let parsedPageUrl: URL;

  try {
    parsedPageUrl = new URL(pageUrl);
  } catch {
    return false;
  }

  return (
    parsedPageUrl.hostname === requiredHostSuffix ||
    parsedPageUrl.hostname.endsWith(`.${requiredHostSuffix}`)
  );
}

export async function closePageSession(
  pageSession: PageSession,
  logger: Logger
): Promise<void> {
  if (!pageSession.createdNewPage || pageSession.page.isClosed()) {
    return;
  }

  logger.info(
    {
      module: "context",
      stage: "page_session_close_started"
    },
    "Closing page session."
  );

  await pageSession.page.close();

  logger.info(
    {
      module: "context",
      stage: "page_session_close_completed"
    },
    "Page session closed."
  );
}
