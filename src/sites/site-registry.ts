import type { RuntimeSiteAdapter } from "../core/types/site-runtime.js";
import type { SearchSiteAdapter } from "../core/search/search-types.js";
import { xiaohongshuRuntimeAdapter } from "./xiaohongshu/runtime-adapter.js";
import { xiaohongshuSearchAdapter } from "./xiaohongshu/search-adapter.js";

const runtimeSiteAdapters = new Map<string, RuntimeSiteAdapter>([
  [xiaohongshuRuntimeAdapter.siteKey, xiaohongshuRuntimeAdapter]
]);

const searchSiteAdapters = new Map<string, SearchSiteAdapter>([
  [xiaohongshuSearchAdapter.siteKey, xiaohongshuSearchAdapter]
]);

export function getRuntimeSiteAdapter(siteKey: string): RuntimeSiteAdapter {
  const adapter = runtimeSiteAdapters.get(siteKey);

  if (adapter === undefined) {
    throw new Error(
      `Unsupported runtime site "${siteKey}". Available sites: ${listRuntimeSiteKeys().join(", ")}`
    );
  }

  return adapter;
}

export function getSearchSiteAdapter(siteKey: string): SearchSiteAdapter {
  const adapter = searchSiteAdapters.get(siteKey);

  if (adapter === undefined) {
    throw new Error(
      `Unsupported site "${siteKey}". Available sites: ${listSearchSiteKeys().join(", ")}`
    );
  }

  return adapter;
}

export function listRuntimeSiteKeys(): readonly string[] {
  return Array.from(runtimeSiteAdapters.keys()).sort();
}

export function listSearchSiteKeys(): readonly string[] {
  return Array.from(searchSiteAdapters.keys()).sort();
}
