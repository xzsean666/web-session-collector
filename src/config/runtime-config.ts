import {
  ConfigurationError,
  loadRuntimeConfig as loadCoreRuntimeConfig
} from "../core/config/runtime-config.js";
import type { RuntimeConfig } from "../core/types/runtime.js";
import { getRuntimeSiteAdapter } from "../sites/site-registry.js";

export { ConfigurationError };

export function loadRuntimeConfig(
  environmentVariables: NodeJS.ProcessEnv
): RuntimeConfig {
  return loadCoreRuntimeConfig(applyProjectDefaults(environmentVariables));
}

function applyProjectDefaults(
  environmentVariables: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const normalizedEnvironment: NodeJS.ProcessEnv = {
    ...environmentVariables
  };

  if (normalizedEnvironment.APP_SITE === undefined) {
    normalizedEnvironment.APP_SITE = "xiaohongshu";
  }

  if (normalizedEnvironment.APP_START_URL === undefined) {
    normalizedEnvironment.APP_START_URL = getRuntimeSiteAdapter(
      normalizedEnvironment.APP_SITE ?? "xiaohongshu"
    ).defaultStartUrl;
  }

  return normalizedEnvironment;
}
