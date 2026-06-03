import type { Locator } from "playwright";
import type { PageSession } from "../../core/context/page-session.js";
import type {
  RawSearchItem,
  SearchSiteAdapter
} from "../../core/search/search-types.js";

export const xiaohongshuSearchAdapter: SearchSiteAdapter = {
  siteKey: "xiaohongshu",
  displayName: "小红书",
  targetHostSuffix: "xiaohongshu.com",
  buildSearchUrl,
  waitForSearchResults,
  dismissKnownNotices,
  extractSearchItems,
  parsePublishedAtText: parseXiaohongshuDate
};

function buildSearchUrl(keyword: string): string {
  const searchUrl = new URL("https://www.xiaohongshu.com/search_result");
  searchUrl.searchParams.set("keyword", keyword);
  searchUrl.searchParams.set("source", "web_search_result_notes");
  searchUrl.searchParams.set("type", "51");
  return searchUrl.toString();
}

async function waitForSearchResults(pageSession: PageSession): Promise<void> {
  try {
    await pageSession.page.waitForSelector("section.note-item", {
      timeout: 15_000
    });
  } catch {
    await pageSession.page
      .waitForLoadState("networkidle", {
        timeout: 10_000
      })
      .catch(() => undefined);
  }
}

async function dismissKnownNotices(pageSession: PageSession): Promise<void> {
  await pageSession.page
    .getByText("我知道了", { exact: true })
    .last()
    .click({ timeout: 1_000 })
    .catch(() => undefined);
}

async function extractSearchItems(
  pageSession: PageSession
): Promise<readonly RawSearchItem[]> {
  const itemLocator = pageSession.page.locator("section.note-item");
  const itemCount = await itemLocator.count();
  const rawItems: RawSearchItem[] = [];

  for (let itemIndex = 0; itemIndex < Math.min(itemCount, 200); itemIndex += 1) {
    const item = itemLocator.nth(itemIndex);
    const exploreHref = await readLocatorAttribute(
      item.locator('a[href^="/explore/"]').first(),
      "href"
    );
    const titleHref = await readLocatorAttribute(
      item.locator("a.title").first(),
      "href"
    );
    const url = normalizeUrl(exploreHref ?? titleHref, pageSession.page.url());
    const title = await readLocatorText(item.locator("a.title").first());

    if (title === "" || url === "") {
      continue;
    }

    rawItems.push({
      title,
      author: await readLocatorText(item.locator(".name").first()),
      publishedAtText: await readLocatorText(item.locator(".time").first()),
      likeCountText: await readLocatorText(item.locator(".count").first()),
      itemId: readItemId(url),
      url
    });
  }

  return rawItems;
}

async function readLocatorText(locator: Locator): Promise<string> {
  const textContent = await locator.textContent({ timeout: 1_500 }).catch(() => "");
  return textContent?.replace(/\s+/g, " ").trim() ?? "";
}

async function readLocatorAttribute(
  locator: Locator,
  attributeName: string
): Promise<string | null> {
  return locator.getAttribute(attributeName, { timeout: 1_500 }).catch(() => null);
}

function normalizeUrl(href: string | null, baseUrl: string): string {
  if (href === null || href.trim() === "") {
    return "";
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function readItemId(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] ?? "";
  } catch {
    return "";
  }
}

function parseXiaohongshuDate(
  publishedAtText: string,
  now: Date
): Date | undefined {
  const value = publishedAtText.trim();

  if (value === "") {
    return undefined;
  }

  if (value === "刚刚") {
    return new Date(now);
  }

  const minuteMatch = /^(\d+)\s*分钟前$/.exec(value);

  if (minuteMatch !== null) {
    return addMilliseconds(now, -Number(minuteMatch[1]) * 60 * 1_000);
  }

  const hourMatch = /^(\d+)\s*小时前$/.exec(value);

  if (hourMatch !== null) {
    return addMilliseconds(now, -Number(hourMatch[1]) * 60 * 60 * 1_000);
  }

  if (value === "今天") {
    return startOfLocalDay(now);
  }

  if (value === "昨天") {
    return addDays(startOfLocalDay(now), -1);
  }

  if (value === "前天") {
    return addDays(startOfLocalDay(now), -2);
  }

  const dayMatch = /^(\d+)\s*天前$/.exec(value);

  if (dayMatch !== null) {
    return addDays(startOfLocalDay(now), -Number(dayMatch[1]));
  }

  const weekMatch = /^(\d+)\s*周前$/.exec(value);

  if (weekMatch !== null) {
    return addDays(startOfLocalDay(now), -Number(weekMatch[1]) * 7);
  }

  const fullDateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);

  if (fullDateMatch !== null) {
    return new Date(
      Number(fullDateMatch[1]),
      Number(fullDateMatch[2]) - 1,
      Number(fullDateMatch[3])
    );
  }

  const monthDayMatch = /^(\d{1,2})-(\d{1,2})$/.exec(value);

  if (monthDayMatch !== null) {
    return new Date(
      now.getFullYear(),
      Number(monthDayMatch[1]) - 1,
      Number(monthDayMatch[2])
    );
  }

  return undefined;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, dayCount: number): Date {
  return addMilliseconds(date, dayCount * 86_400_000);
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
