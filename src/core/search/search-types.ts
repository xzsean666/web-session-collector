export interface SearchInput {
  readonly keyword: string;
  readonly scrollCount: number;
}

export interface RawSearchItem {
  readonly title: string;
  readonly author: string;
  readonly publishedAtText: string;
  readonly likeCountText: string;
  readonly itemId: string;
  readonly url: string;
  readonly xsecToken: string;
}

export interface SearchItem {
  readonly keyword: string;
  readonly title: string;
  readonly author: string;
  readonly publishedAtText: string;
  readonly publishedAt: string;
  readonly ageDays: number | undefined;
  readonly likeCountText: string;
  readonly itemId: string;
  readonly url: string;
  readonly xsecToken?: string;
  // 以下字段仅在开启详情页富集(fetchContent)后才会填充。
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly images?: readonly string[];
  readonly commentCountText?: string;
}

// 笔记详情页(/explore/<id>?xsec_token=...)富集出的字段。
export interface NoteDetail {
  readonly content: string;
  readonly tags: readonly string[];
  readonly images: readonly string[];
  readonly commentCountText: string;
}

export interface SearchResult {
  readonly siteKey: string;
  readonly keyword: string;
  readonly searchUrl: string;
  readonly collectedCount: number;
  readonly items: readonly SearchItem[];
}

export interface SearchSiteAdapter {
  readonly siteKey: string;
  readonly displayName: string;
  readonly targetHostSuffix: string | undefined;
  buildSearchUrl(keyword: string): string;
  waitForSearchResults(pageSession: import("../context/page-session.js").PageSession): Promise<void>;
  dismissKnownNotices(pageSession: import("../context/page-session.js").PageSession): Promise<void>;
  extractSearchItems(pageSession: import("../context/page-session.js").PageSession): Promise<readonly RawSearchItem[]>;
  parsePublishedAtText(publishedAtText: string, now: Date): Date | undefined;
  // 打开笔记详情页提取正文/标签/图片;只有支持的站点实现。返回 undefined 表示无法获取(被重定向/验证码/无 token)。
  fetchNoteDetail?(
    pageSession: import("../context/page-session.js").PageSession,
    item: SearchItem
  ): Promise<NoteDetail | undefined>;
}

export type SearchRecentNotesInput = SearchInput;
export type SearchRecentNote = SearchItem & {
  readonly noteId?: string;
};
export type SearchRecentNotesResult = Omit<SearchResult, "items"> & {
  readonly notes: readonly SearchRecentNote[];
};
