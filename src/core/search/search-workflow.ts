import type { Logger } from "pino";
import type { PageSession } from "../context/page-session.js";
import type {
  RawSearchItem,
  SearchInput,
  SearchItem,
  SearchResult,
  SearchSiteAdapter
} from "./search-types.js";

export async function runSearchWorkflow(
  pageSession: PageSession,
  siteAdapter: SearchSiteAdapter,
  input: SearchInput,
  logger: Logger
): Promise<SearchResult> {
  const searchUrl = siteAdapter.buildSearchUrl(input.keyword);

  logger.info(
    {
      module: "core_search",
      stage: "started",
      siteKey: siteAdapter.siteKey,
      keyword: input.keyword,
      scrollCount: input.scrollCount,
      searchUrl
    },
    "Search workflow started."
  );

  await pageSession.page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000
  });
  await siteAdapter.dismissKnownNotices(pageSession);
  await siteAdapter.waitForSearchResults(pageSession);

  for (let scrollIndex = 0; scrollIndex < input.scrollCount; scrollIndex += 1) {
    await pageSession.page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 1.8));
    });
    await pageSession.page.waitForTimeout(1_200);
    await siteAdapter.dismissKnownNotices(pageSession);
  }

  const rawItems = await siteAdapter.extractSearchItems(pageSession);
  const items = normalizeAndSortItems(input.keyword, rawItems, siteAdapter);

  logger.info(
    {
      module: "core_search",
      stage: "completed",
      siteKey: siteAdapter.siteKey,
      keyword: input.keyword,
      collectedCount: rawItems.length,
      normalizedCount: items.length
    },
    "Search workflow completed."
  );

  return {
    siteKey: siteAdapter.siteKey,
    keyword: input.keyword,
    searchUrl,
    collectedCount: rawItems.length,
    items
  };
}

function normalizeAndSortItems(
  keyword: string,
  rawItems: readonly RawSearchItem[],
  siteAdapter: SearchSiteAdapter
): readonly SearchItem[] {
  const now = new Date();
  const seenItemKeys = new Set<string>();
  const items: SearchItem[] = [];

  for (const rawItem of rawItems) {
    const itemKey = rawItem.itemId || rawItem.url;

    if (seenItemKeys.has(itemKey)) {
      continue;
    }

    seenItemKeys.add(itemKey);

    const parsedDate = siteAdapter.parsePublishedAtText(
      rawItem.publishedAtText,
      now
    );

    items.push({
      keyword,
      title: rawItem.title,
      author: rawItem.author,
      publishedAtText: rawItem.publishedAtText,
      publishedAt: parsedDate?.toISOString() ?? "",
      ageDays: parsedDate === undefined ? undefined : calculateAgeDays(parsedDate, now),
      likeCountText: rawItem.likeCountText,
      itemId: rawItem.itemId,
      url: rawItem.url
    });
  }

  return items.sort((left, right) => {
    const leftTime = left.publishedAt === "" ? 0 : Date.parse(left.publishedAt);
    const rightTime = right.publishedAt === "" ? 0 : Date.parse(right.publishedAt);
    return rightTime - leftTime;
  });
}

function calculateAgeDays(publishedAt: Date, now: Date): number {
  const ageMilliseconds =
    startOfLocalDay(now).getTime() - startOfLocalDay(publishedAt).getTime();
  return Math.max(0, Math.floor(ageMilliseconds / 86_400_000));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
