import type { RuntimeSiteAdapter } from "../../core/types/site-runtime.js";
import { getCurrentAccountAction } from "./current-user-action.js";

export const xiaohongshuRuntimeAdapter: RuntimeSiteAdapter = {
  siteKey: "xiaohongshu",
  displayName: "小红书",
  targetHostSuffix: "xiaohongshu.com",
  defaultStartUrl: "https://www.xiaohongshu.com/",
  getCurrentAccount: getCurrentAccountAction
};
