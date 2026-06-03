import {
  ConfigurationError,
  loadRuntimeConfig as loadCoreRuntimeConfig
} from "../core/config/runtime-config.js";
import type { RuntimeConfig } from "../core/types/runtime.js";
import { getRuntimeSiteAdapter } from "../sites/site-registry.js";

const legacyEnvironmentAliases: readonly [
  legacyName: string,
  genericName: string
][] = [
  ["XHS_SITE", "APP_SITE"],
  ["XHS_USER_DATA_DIR", "APP_USER_DATA_DIR"],
  ["XHS_PROFILE_NAME", "APP_PROFILE_NAME"],
  ["XHS_BROWSER_MODE", "APP_BROWSER_MODE"],
  ["XHS_CDP_URL", "APP_CDP_URL"],
  ["XHS_HEADLESS", "APP_HEADLESS"],
  ["XHS_BROWSER_CHANNEL", "APP_BROWSER_CHANNEL"],
  ["XHS_EXECUTABLE_PATH", "APP_EXECUTABLE_PATH"],
  ["XHS_PROFILE_DIRECTORY", "APP_PROFILE_DIRECTORY"],
  ["XHS_LOCALE", "APP_LOCALE"],
  ["XHS_TIMEZONE_ID", "APP_TIMEZONE_ID"],
  ["XHS_VIEWPORT_WIDTH", "APP_VIEWPORT_WIDTH"],
  ["XHS_VIEWPORT_HEIGHT", "APP_VIEWPORT_HEIGHT"],
  ["XHS_DEVICE_SCALE_FACTOR", "APP_DEVICE_SCALE_FACTOR"],
  ["XHS_BROWSER_FLAGS", "APP_BROWSER_FLAGS"],
  ["XHS_IGNORE_DEFAULT_ARGS", "APP_IGNORE_DEFAULT_ARGS"],
  ["XHS_START_URL", "APP_START_URL"],
  ["XHS_LOG_LEVEL", "APP_LOG_LEVEL"],
  ["XHS_KEEP_BROWSER_ALIVE", "APP_KEEP_BROWSER_ALIVE"],
  [
    "XHS_INTERACTIVE_LOGIN_ON_MISSING_USER",
    "APP_INTERACTIVE_LOGIN_ON_MISSING_USER"
  ]
];

export { ConfigurationError };

export function loadRuntimeConfig(
  environmentVariables: NodeJS.ProcessEnv
): RuntimeConfig {
  return loadCoreRuntimeConfig(normalizeRuntimeEnvironment(environmentVariables));
}

function normalizeRuntimeEnvironment(
  environmentVariables: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const normalizedEnvironment: NodeJS.ProcessEnv = {
    ...environmentVariables
  };

  for (const [legacyName, genericName] of legacyEnvironmentAliases) {
    if (
      normalizedEnvironment[genericName] === undefined &&
      normalizedEnvironment[legacyName] !== undefined
    ) {
      normalizedEnvironment[genericName] = normalizedEnvironment[legacyName];
    }
  }

  if (
    normalizedEnvironment.APP_SITE === undefined &&
    normalizedEnvironment.XHS_SITE === undefined
  ) {
    normalizedEnvironment.APP_SITE = "xiaohongshu";
  }

  if (
    normalizedEnvironment.APP_START_URL === undefined &&
    normalizedEnvironment.XHS_START_URL === undefined
  ) {
    normalizedEnvironment.APP_START_URL = getRuntimeSiteAdapter(
      normalizedEnvironment.APP_SITE ?? "xiaohongshu"
    ).defaultStartUrl;
  }

  return normalizedEnvironment;
}
