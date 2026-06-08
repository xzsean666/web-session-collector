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
import type {
  SearchItem,
  SearchResult,
  SearchSiteAdapter
} from "../core/search/search-types.js";
import { runSearchWorkflow } from "../core/search/search-workflow.js";
import type { RuntimeConfig } from "../core/types/runtime.js";
import { getSearchSiteAdapter } from "../sites/site-registry.js";

export interface SearchTaskOptions {
  readonly siteKey: string;
  readonly keywords: readonly string[];
  readonly recentDays: number;
  readonly limitPerKeyword: number;
  readonly scrollCount: number;
  readonly fetchContent: boolean;
}

// 详情页富集之间的间隔,降低触发验证码的概率。
const DETAIL_FETCH_DELAY_MS = 1_000;

export interface SearchKeywordResult {
  readonly siteKey: string;
  readonly keyword: string;
  readonly searchUrl: string;
  readonly collectedCount: number;
  readonly normalizedCount: number;
  readonly inRangeCount: number;
  readonly unknownDateCount: number;
  readonly matchedItems: readonly SearchItem[];
  readonly usedFallback: boolean;
}

export interface SearchTaskResult {
  readonly generatedAt: string;
  readonly siteKey: string;
  readonly recentDays: number;
  readonly limitPerKeyword: number;
  readonly scrollCount: number;
  readonly results: readonly SearchKeywordResult[];
}

export async function runSearchTaskWithNewBrowser(
  runtimeConfig: RuntimeConfig,
  options: SearchTaskOptions,
  logger: Logger
): Promise<SearchTaskResult> {
  const siteAdapter = getSearchSiteAdapter(options.siteKey);
  let browserSession: BrowserSession | undefined;
  let pageSession: PageSession | undefined;

  try {
    browserSession = await createBrowserSession(
      runtimeConfig.profile,
      runtimeConfig.browser,
      logger
    );
    pageSession = await createPageSession(
      browserSession.browserContext,
      logger,
      {
        allowNewPage: runtimeConfig.browser.connectionMode !== "connect",
        preferNewPage: false,
        requiredExistingPageHostSuffix:
          runtimeConfig.browser.connectionMode === "connect"
            ? siteAdapter.targetHostSuffix
            : undefined
      }
    );

    return runSearchTaskOnPage(pageSession, options, logger);
  } finally {
    if (pageSession !== undefined) {
      await closePageSession(pageSession, logger);
    }

    if (browserSession !== undefined) {
      await closeBrowserSession(browserSession, logger);
    }
  }
}

export async function runSearchTaskOnPage(
  pageSession: PageSession,
  options: SearchTaskOptions,
  logger: Logger
): Promise<SearchTaskResult> {
  if (options.keywords.length === 0) {
    throw new Error("At least one keyword is required.");
  }

  const siteAdapter = getSearchSiteAdapter(options.siteKey);
  const results: SearchKeywordResult[] = [];

  for (const keyword of options.keywords) {
    const searchResult = await runSearchWorkflow(
      pageSession,
      siteAdapter,
      {
        keyword,
        scrollCount: options.scrollCount
      },
      logger
    );

    let keywordResult = buildSearchKeywordResult(searchResult, options);

    // 紧跟该关键词的搜索做详情富集,xsec_token 仍新鲜;只对最终入选项开详情页。
    if (options.fetchContent && siteAdapter.fetchNoteDetail !== undefined) {
      keywordResult = await enrichKeywordResult(
        pageSession,
        siteAdapter,
        keywordResult,
        logger
      );
    }

    results.push(keywordResult);
  }

  return {
    generatedAt: new Date().toISOString(),
    siteKey: siteAdapter.siteKey,
    recentDays: options.recentDays,
    limitPerKeyword: options.limitPerKeyword,
    scrollCount: options.scrollCount,
    results
  };
}

async function enrichKeywordResult(
  pageSession: PageSession,
  siteAdapter: SearchSiteAdapter,
  keywordResult: SearchKeywordResult,
  logger: Logger
): Promise<SearchKeywordResult> {
  const fetchNoteDetail = siteAdapter.fetchNoteDetail;

  if (fetchNoteDetail === undefined) {
    return keywordResult;
  }

  const enrichedItems: SearchItem[] = [];
  let enrichedCount = 0;

  for (let index = 0; index < keywordResult.matchedItems.length; index += 1) {
    const item = keywordResult.matchedItems[index];

    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, DETAIL_FETCH_DELAY_MS));
    }

    let detail;
    try {
      detail = await fetchNoteDetail(pageSession, item);
    } catch {
      detail = undefined;
    }

    if (detail === undefined) {
      logger.warn(
        {
          module: "core_search",
          stage: "enrich_skipped",
          siteKey: keywordResult.siteKey,
          keyword: keywordResult.keyword,
          itemId: item.itemId
        },
        "Note detail unavailable; keeping item without content."
      );
      enrichedItems.push(item);
      continue;
    }

    enrichedItems.push({
      ...item,
      content: detail.content,
      tags: detail.tags,
      images: detail.images,
      commentCountText: detail.commentCountText
    });
    enrichedCount += 1;
  }

  logger.info(
    {
      module: "core_search",
      stage: "enriched",
      siteKey: keywordResult.siteKey,
      keyword: keywordResult.keyword,
      matchedCount: keywordResult.matchedItems.length,
      enrichedCount
    },
    "Note detail enrichment completed."
  );

  return {
    ...keywordResult,
    matchedItems: enrichedItems
  };
}

export function buildSearchKeywordResult(
  result: SearchResult,
  options: Pick<SearchTaskOptions, "recentDays" | "limitPerKeyword">
): SearchKeywordResult {
  const unknownDateCount = result.items.filter(
    (item) => item.ageDays === undefined
  ).length;
  const filteredItems =
    options.recentDays === 0
      ? result.items
      : result.items.filter(
          (item) =>
            item.ageDays !== undefined && item.ageDays <= options.recentDays
        );
  const matchedItems =
    filteredItems.length > 0
      ? filteredItems
      : result.items.slice(0, options.limitPerKeyword);

  return {
    siteKey: result.siteKey,
    keyword: result.keyword,
    searchUrl: result.searchUrl,
    collectedCount: result.collectedCount,
    normalizedCount: result.items.length,
    inRangeCount: filteredItems.length,
    unknownDateCount,
    matchedItems: matchedItems.slice(0, options.limitPerKeyword),
    usedFallback: filteredItems.length === 0 && result.items.length > 0
  };
}
