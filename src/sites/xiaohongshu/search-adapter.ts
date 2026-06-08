import type { Locator } from "playwright";
import type { PageSession } from "../../core/context/page-session.js";
import type {
  NoteDetail,
  RawSearchItem,
  SearchItem,
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
  parsePublishedAtText: parseXiaohongshuDate,
  fetchNoteDetail
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
  // 卡片的 DOM 里没有 xsec_token,token 只在 __INITIAL_STATE__.search.feeds 里,
  // 这里读一次构建 id -> token 映射,供下面给每条 item 附上可打开详情页的链接。
  const tokenMap = await readSearchTokenMap(pageSession);

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
    const cardUrl = normalizeUrl(exploreHref ?? titleHref, pageSession.page.url());
    const title = await readLocatorText(item.locator("a.title").first());

    if (title === "" || cardUrl === "") {
      continue;
    }

    const itemId = readItemId(cardUrl);
    const xsecToken = tokenMap.get(itemId) ?? "";
    // 有 token 时存可直接打开的详情链接(裸 /explore/<id> 会被重定向到首页)。
    const url = xsecToken === "" ? cardUrl : buildDetailUrl(itemId, xsecToken);

    rawItems.push({
      title,
      author: await readLocatorText(item.locator(".name").first()),
      publishedAtText: await readLocatorText(item.locator(".time").first()),
      likeCountText: await readLocatorText(item.locator(".count").first()),
      itemId,
      url,
      xsecToken
    });
  }

  return rawItems;
}

// 从搜索页的 window.__INITIAL_STATE__.search.feeds 提取 笔记id -> xsecToken。
async function readSearchTokenMap(
  pageSession: PageSession
): Promise<Map<string, string>> {
  const entries = await pageSession.page
    .evaluate(() => {
      const unwrap = (value: unknown): any =>
        value && typeof value === "object" && "_rawValue" in (value as object)
          ? (value as { _rawValue: unknown })._rawValue
          : value;
      const state = (window as unknown as { __INITIAL_STATE__?: any })
        .__INITIAL_STATE__;
      if (!state) {
        return [] as [string, string][];
      }
      const search = unwrap(state.search);
      const feeds = unwrap(search && search.feeds);
      if (!Array.isArray(feeds)) {
        return [] as [string, string][];
      }
      const out: [string, string][] = [];
      for (const feed of feeds) {
        if (!feed || typeof feed !== "object") {
          continue;
        }
        const id =
          feed.id || (feed.noteCard && (feed.noteCard.noteId || feed.noteCard.id));
        const token =
          feed.xsecToken || (feed.noteCard && feed.noteCard.xsecToken);
        if (id && token) {
          out.push([String(id), String(token)]);
        }
      }
      return out;
    })
    .catch(() => [] as [string, string][]);

  return new Map(entries);
}

function buildDetailUrl(itemId: string, xsecToken: string): string {
  const detailUrl = new URL(`https://www.xiaohongshu.com/explore/${itemId}`);
  detailUrl.searchParams.set("xsec_token", xsecToken);
  detailUrl.searchParams.set("xsec_source", "pc_search");
  return detailUrl.toString();
}

// 打开笔记详情页,从 __INITIAL_STATE__.note.noteDetailMap 读取正文/标签/图片。
// 返回 undefined 表示无法获取(无 token、被重定向到首页、验证码或解析失败)。
async function fetchNoteDetail(
  pageSession: PageSession,
  item: SearchItem
): Promise<NoteDetail | undefined> {
  const xsecToken = item.xsecToken ?? "";

  if (item.itemId === "" || xsecToken === "") {
    return undefined;
  }

  try {
    await pageSession.page.goto(buildDetailUrl(item.itemId, xsecToken), {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
  } catch {
    return undefined;
  }

  // 等到该笔记真正出现在 state 里;被重定向/验证码时它不会出现 -> 视为失败。
  const ready = await pageSession.page
    .waitForFunction(
      (id: string) => {
        const unwrap = (value: unknown): any =>
          value && typeof value === "object" && "_rawValue" in (value as object)
            ? (value as { _rawValue: unknown })._rawValue
            : value;
        const state = (window as unknown as { __INITIAL_STATE__?: any })
          .__INITIAL_STATE__;
        if (!state) {
          return false;
        }
        const note = unwrap(state.note);
        const map = unwrap(note && note.noteDetailMap);
        return Boolean(map && map[id] && map[id].note);
      },
      item.itemId,
      { timeout: 8_000 }
    )
    .then(() => true)
    .catch(() => false);

  if (!ready) {
    return undefined;
  }

  return pageSession.page
    .evaluate((id: string) => {
      const unwrap = (value: unknown): any =>
        value && typeof value === "object" && "_rawValue" in (value as object)
          ? (value as { _rawValue: unknown })._rawValue
          : value;
      const state = (window as unknown as { __INITIAL_STATE__?: any })
        .__INITIAL_STATE__;
      const note = unwrap(state.note);
      const map = unwrap(note && note.noteDetailMap);
      const detailNote = map && map[id] && map[id].note;
      if (!detailNote) {
        return undefined;
      }
      const tags = Array.isArray(detailNote.tagList)
        ? detailNote.tagList
            .map((tag: any) => (tag && tag.name) || "")
            .filter((name: string) => name !== "")
        : [];
      const images = Array.isArray(detailNote.imageList)
        ? detailNote.imageList
            .map((image: any) => {
              if (!image) {
                return "";
              }
              if (image.urlDefault) {
                return String(image.urlDefault);
              }
              if (image.url) {
                return String(image.url);
              }
              if (Array.isArray(image.infoList) && image.infoList.length > 0) {
                return String(image.infoList[image.infoList.length - 1].url || "");
              }
              return "";
            })
            .filter((url: string) => url !== "")
        : [];
      const interactInfo = detailNote.interactInfo || {};
      return {
        content: typeof detailNote.desc === "string" ? detailNote.desc : "",
        tags,
        images,
        commentCountText:
          interactInfo.commentCount != null
            ? String(interactInfo.commentCount)
            : ""
      };
    }, item.itemId)
    .catch(() => undefined);
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
