import assert from "node:assert/strict";
import { test } from "node:test";
import type { Logger } from "pino";
import type { PageSession } from "../src/core/context/page-session.js";
import { getCurrentAccountAction } from "../src/sites/xiaohongshu/current-user-action.js";

test("getCurrentAccountAction can use a visible profile link as login evidence when profile lookup hits Xiaohongshu 300011", async () => {
  let currentUrl = "https://www.xiaohongshu.com/explore";
  const profilePath = "/user/profile/6a228a4d0000000002001c01";

  const pageSession = {
    page: {
      locator(selector: string) {
        assert.equal(selector, 'a[href*="/user/profile/"]');

        return {
          filter() {
            return {
              first() {
                return {
                  async getAttribute() {
                    return profilePath;
                  }
                };
              }
            };
          }
        };
      },
      async goto(url: string) {
        assert.equal(url, "https://www.xiaohongshu.com/user/profile/6a228a4d0000000002001c01");
        currentUrl =
          "https://www.xiaohongshu.com/website-login/error?error_code=300011";
      },
      async waitForSelector() {
        throw new Error("page.waitForSelector: Timeout 10000ms exceeded");
      },
      url() {
        return currentUrl;
      }
    }
  } as unknown as PageSession;

  const logger = {
    info() {},
    warn() {}
  } as unknown as Logger;

  const result = await getCurrentAccountAction(pageSession, logger, {
    allowPartialFromProfileLink: true
  });

  assert.equal(result.found, true);
  assert.equal(
    result.profileUrl,
    "https://www.xiaohongshu.com/user/profile/6a228a4d0000000002001c01"
  );
  assert.equal(result.accountId, "6a228a4d0000000002001c01");
  assert.equal(result.metadata.partial, "true");
  assert.equal(result.metadata.partialReason, "profile_safety_restriction");
});
