import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigurationError,
  loadRuntimeConfig
} from "../src/config/runtime-config.js";

test("loadRuntimeConfig parses the complete MVP environment", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    const runtimeConfig = loadRuntimeConfig({
      APP_SITE: "xiaohongshu",
      APP_USER_DATA_DIR: userDataDir,
      APP_PROFILE_NAME: "automation-profile",
      APP_BROWSER_MODE: "connect",
      APP_CDP_URL: "http://127.0.0.1:9222",
      APP_HEADLESS: "true",
      APP_BROWSER_CHANNEL: "bundled",
      APP_EXECUTABLE_PATH: process.execPath,
      APP_PROFILE_DIRECTORY: "Profile 7",
      APP_LOCALE: "zh-CN",
      APP_TIMEZONE_ID: "Asia/Shanghai",
      APP_VIEWPORT_WIDTH: "1440",
      APP_VIEWPORT_HEIGHT: "900",
      APP_DEVICE_SCALE_FACTOR: "1.25",
      APP_BROWSER_FLAGS: "[\"--no-first-run\"]",
      APP_IGNORE_DEFAULT_ARGS: "[\"--disable-extensions\"]",
      APP_START_URL: "https://www.xiaohongshu.com/explore",
      APP_LOG_LEVEL: "debug",
      APP_KEEP_BROWSER_ALIVE: "yes",
      APP_INTERACTIVE_LOGIN_ON_MISSING_USER: "true"
    });

    assert.equal(runtimeConfig.site.siteKey, "xiaohongshu");
    assert.equal(runtimeConfig.profile.userDataDir, userDataDir);
    assert.equal(runtimeConfig.profile.profileName, "automation-profile");
    assert.equal(runtimeConfig.browser.connectionMode, "connect");
    assert.equal(runtimeConfig.browser.cdpUrl, "http://127.0.0.1:9222/");
    assert.equal(runtimeConfig.browser.headless, true);
    assert.equal(runtimeConfig.browser.channel, "bundled");
    assert.equal(runtimeConfig.browser.executablePath, process.execPath);
    assert.equal(runtimeConfig.browser.profileDirectory, "Profile 7");
    assert.equal(runtimeConfig.browser.locale, "zh-CN");
    assert.equal(runtimeConfig.browser.timezoneId, "Asia/Shanghai");
    assert.deepEqual(runtimeConfig.browser.viewport, {
      width: 1440,
      height: 900
    });
    assert.equal(runtimeConfig.browser.deviceScaleFactor, 1.25);
    assert.deepEqual(runtimeConfig.browser.flags, ["--no-first-run"]);
    assert.deepEqual(runtimeConfig.browser.ignoredDefaultArgs, [
      "--disable-extensions"
    ]);
    assert.equal(
      runtimeConfig.navigation.startUrl,
      "https://www.xiaohongshu.com/explore"
    );
    assert.equal(runtimeConfig.logging.level, "debug");
    assert.equal(runtimeConfig.runtime.keepBrowserAlive, true);
    assert.equal(runtimeConfig.runtime.interactiveLoginOnMissingUser, true);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig applies safe defaults", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    const runtimeConfig = loadRuntimeConfig({
      APP_USER_DATA_DIR: userDataDir,
      APP_PROFILE_NAME: "automation-profile"
    });

    assert.equal(runtimeConfig.browser.headless, false);
    assert.equal(runtimeConfig.site.siteKey, "xiaohongshu");
    assert.equal(runtimeConfig.browser.connectionMode, "launch");
    assert.equal(runtimeConfig.browser.cdpUrl, undefined);
    assert.equal(runtimeConfig.browser.channel, "chrome");
    assert.equal(runtimeConfig.browser.executablePath, undefined);
    assert.equal(runtimeConfig.browser.profileDirectory, undefined);
    assert.equal(runtimeConfig.browser.locale, "zh-CN");
    assert.equal(runtimeConfig.browser.timezoneId, "Asia/Shanghai");
    assert.deepEqual(runtimeConfig.browser.viewport, {
      width: 1366,
      height: 768
    });
    assert.equal(runtimeConfig.browser.deviceScaleFactor, 1);
    assert.deepEqual(runtimeConfig.browser.flags, []);
    assert.deepEqual(runtimeConfig.browser.ignoredDefaultArgs, []);
    assert.equal(
      runtimeConfig.navigation.startUrl,
      "https://www.xiaohongshu.com/"
    );
    assert.equal(runtimeConfig.logging.level, "info");
    assert.equal(runtimeConfig.runtime.keepBrowserAlive, false);
    assert.equal(runtimeConfig.runtime.interactiveLoginOnMissingUser, false);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig parses comma-separated browser flags", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    const runtimeConfig = loadRuntimeConfig({
      APP_USER_DATA_DIR: userDataDir,
      APP_PROFILE_NAME: "automation-profile",
      APP_BROWSER_FLAGS: "--disable-gpu, --no-sandbox"
    });

    assert.deepEqual(runtimeConfig.browser.flags, [
      "--disable-gpu",
      "--no-sandbox"
    ]);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig rejects missing required values", () => {
  assert.throws(
    () => loadRuntimeConfig({ APP_PROFILE_NAME: "automation-profile" }),
    ConfigurationError
  );
});

test("loadRuntimeConfig rejects relative profile paths", () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        APP_USER_DATA_DIR: "relative/path",
        APP_PROFILE_NAME: "automation-profile"
      }),
    ConfigurationError
  );
});

test("loadRuntimeConfig rejects invalid boolean values", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_HEADLESS: "sometimes"
        }),
      ConfigurationError
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig rejects invalid start URLs", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_START_URL: "not-a-url"
        }),
      ConfigurationError
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig rejects invalid CDP URLs", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_CDP_URL: "not-a-url"
        }),
      ConfigurationError
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig rejects invalid viewport values", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_VIEWPORT_WIDTH: "wide"
        }),
      ConfigurationError
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig reports invalid ignore-default-args JSON with the right option name", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_IGNORE_DEFAULT_ARGS: "[not-json"
        }),
      /APP_IGNORE_DEFAULT_ARGS/
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("loadRuntimeConfig rejects relative executable paths", () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "app-profile-"));

  try {
    assert.throws(
      () =>
        loadRuntimeConfig({
          APP_USER_DATA_DIR: userDataDir,
          APP_PROFILE_NAME: "automation-profile",
          APP_EXECUTABLE_PATH: "relative/chrome"
        }),
      ConfigurationError
    );
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
