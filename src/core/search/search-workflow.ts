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

  // 尽量切到「最新」排序:结果按时间倒序,近期帖在最前面,源头就近似过滤。
  let sortedByTime = false;
  if (siteAdapter.sortByLatest !== undefined) {
    sortedByTime = await siteAdapter.sortByLatest(pageSession);
    logger.info(
      {
        module: "core_search",
        stage: sortedByTime ? "sorted_latest" : "sort_latest_failed",
        siteKey: siteAdapter.siteKey,
        keyword: input.keyword
      },
      sortedByTime
        ? "Switched to latest (time-descending) sort."
        : "Could not switch to latest sort; using default order."
    );
    if (sortedByTime) {
      await siteAdapter.waitForSearchResults(pageSession);
    }
  }

  for (let scrollIndex = 0; scrollIndex < input.scrollCount; scrollIndex += 1) {
    await pageSession.page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 1.8));
    });
    await pageSession.page.waitForTimeout(1_200);
    await siteAdapter.dismissKnownNotices(pageSession);

    if (input.recentDays > 0) {
      const { inRange, pastWindow } = await scanLoadedItems(
        pageSession,
        siteAdapter,
        input.recentDays
      );
      // 够了就停;或在「最新」排序下已经滚过时间窗口(后面只会更旧)就停。
      const enough =
        input.limitPerKeyword > 0 && inRange >= input.limitPerKeyword;
      const pastWindow2 = sortedByTime && pastWindow;

      if (enough || pastWindow2) {
        logger.info(
          {
            module: "core_search",
            stage: "scroll_early_stop",
            siteKey: siteAdapter.siteKey,
            keyword: input.keyword,
            scrolls: scrollIndex + 1,
            inRange,
            reason: enough ? "enough" : "past_window"
          },
          "Stopped scrolling early."
        );
        break;
      }
    }
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
      url: rawItem.url,
      xsecToken: rawItem.xsecToken
    });
  }

  return items.sort((left, right) => {
    const leftTime = left.publishedAt === "" ? 0 : Date.parse(left.publishedAt);
    const rightTime = right.publishedAt === "" ? 0 : Date.parse(right.publishedAt);
    return rightTime - leftTime;
  });
}

// 扫描当前已加载卡片的发布时间,统计:范围内条数、以及是否已经出现明显超出
// 时间窗口的旧帖(用于「最新」排序下的滚动早停)。
async function scanLoadedItems(
  pageSession: PageSession,
  siteAdapter: SearchSiteAdapter,
  recentDays: number
): Promise<{ inRange: number; pastWindow: boolean }> {
  const times = await pageSession.page
    .evaluate(() =>
      Array.from(document.querySelectorAll("section.note-item .time")).map(
        (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()
      )
    )
    .catch(() => [] as string[]);

  const now = new Date();
  let inRange = 0;
  let past = 0;

  for (const text of times) {
    if (text === "") {
      continue;
    }
    const parsed = siteAdapter.parsePublishedAtText(text, now);
    if (parsed === undefined) {
      continue;
    }
    if (calculateAgeDays(parsed, now) <= recentDays) {
      inRange += 1;
    } else {
      past += 1;
    }
  }

  // 需要至少 2 条超窗口才判定"已滚过窗口",避免个别置顶/异常项误触发。
  return { inRange, pastWindow: past >= 2 };
}

function calculateAgeDays(publishedAt: Date, now: Date): number {
  const ageMilliseconds =
    startOfLocalDay(now).getTime() - startOfLocalDay(publishedAt).getTime();
  return Math.max(0, Math.floor(ageMilliseconds / 86_400_000));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
