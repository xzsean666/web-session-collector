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
}

export type SearchRecentNotesInput = SearchInput;
export type SearchRecentNote = SearchItem & {
  readonly noteId?: string;
};
export type SearchRecentNotesResult = Omit<SearchResult, "items"> & {
  readonly notes: readonly SearchRecentNote[];
};
