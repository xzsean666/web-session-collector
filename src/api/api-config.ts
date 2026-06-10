import { z } from "zod";
import { ConfigurationError } from "../core/config/runtime-config.js";

export interface ApiSearchDefaults {
  readonly recentDays: number;
  readonly limitPerKeyword: number;
  readonly scrollCount: number;
  readonly fetchContent: boolean;
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly activeNoVncPort: number;
  readonly idleNoVncPort: number;
  readonly activeVncPort: number;
  readonly idleVncPort: number;
  readonly idleNoVncSwitchEnabled: boolean;
  readonly requestBodyLimitBytes: number;
  readonly accountCheckIntervalMs: number;
  readonly searchDefaults: ApiSearchDefaults;
}

const apiEnvironmentSchema = z.object({
  APP_API_HOST: z.string().optional(),
  APP_API_PORT: z.string().optional(),
  ACTIVE_NOVNC_PORT: z.string().optional(),
  IDLE_NOVNC_PORT: z.string().optional(),
  ACTIVE_VNC_PORT: z.string().optional(),
  IDLE_VNC_PORT: z.string().optional(),
  APP_IDLE_NOVNC_SWITCH: z.string().optional(),
  APP_API_REQUEST_BODY_LIMIT_BYTES: z.string().optional(),
  APP_ACCOUNT_CHECK_INTERVAL_MS: z.string().optional(),
  APP_SEARCH_RECENT_DAYS: z.string().optional(),
  APP_SEARCH_LIMIT: z.string().optional(),
  APP_SEARCH_SCROLLS: z.string().optional(),
  APP_SEARCH_FETCH_CONTENT: z.string().optional()
});

export function loadApiConfig(
  environmentVariables: NodeJS.ProcessEnv
): ApiConfig {
  const parsedEnvironment = apiEnvironmentSchema.safeParse(environmentVariables);

  if (!parsedEnvironment.success) {
    throw new ConfigurationError(
      "API configuration is invalid.",
      parsedEnvironment.error.issues.map((issue) => {
        const variableName = issue.path.join(".") || "environment";
        return `${variableName}: ${issue.message}`;
      })
    );
  }

  const config: ApiConfig = {
    host: parseHost(parsedEnvironment.data.APP_API_HOST),
    port: parseIntegerInRange(
      parsedEnvironment.data.APP_API_PORT,
      10085,
      1,
      65_535,
      "APP_API_PORT"
    ),
    activeNoVncPort: parseIntegerInRange(
      parsedEnvironment.data.ACTIVE_NOVNC_PORT,
      10086,
      1,
      65_535,
      "ACTIVE_NOVNC_PORT"
    ),
    idleNoVncPort: parseIntegerInRange(
      parsedEnvironment.data.IDLE_NOVNC_PORT,
      10087,
      1,
      65_535,
      "IDLE_NOVNC_PORT"
    ),
    activeVncPort: parseIntegerInRange(
      parsedEnvironment.data.ACTIVE_VNC_PORT,
      5900,
      1,
      65_535,
      "ACTIVE_VNC_PORT"
    ),
    idleVncPort: parseIntegerInRange(
      parsedEnvironment.data.IDLE_VNC_PORT,
      5901,
      1,
      65_535,
      "IDLE_VNC_PORT"
    ),
    idleNoVncSwitchEnabled: parseBoolean(
      parsedEnvironment.data.APP_IDLE_NOVNC_SWITCH,
      false,
      "APP_IDLE_NOVNC_SWITCH"
    ),
    requestBodyLimitBytes: parseIntegerInRange(
      parsedEnvironment.data.APP_API_REQUEST_BODY_LIMIT_BYTES,
      1_048_576,
      1,
      10 * 1_048_576,
      "APP_API_REQUEST_BODY_LIMIT_BYTES"
    ),
    accountCheckIntervalMs: parseIntegerInRange(
      parsedEnvironment.data.APP_ACCOUNT_CHECK_INTERVAL_MS,
      60_000,
      0,
      86_400_000,
      "APP_ACCOUNT_CHECK_INTERVAL_MS"
    ),
    searchDefaults: {
      recentDays: parseIntegerInRange(
        parsedEnvironment.data.APP_SEARCH_RECENT_DAYS,
        30,
        0,
        3650,
        "APP_SEARCH_RECENT_DAYS"
      ),
      limitPerKeyword: parseIntegerInRange(
        parsedEnvironment.data.APP_SEARCH_LIMIT,
        30,
        1,
        100,
        "APP_SEARCH_LIMIT"
      ),
      scrollCount: parseIntegerInRange(
        parsedEnvironment.data.APP_SEARCH_SCROLLS,
        5,
        0,
        20,
        "APP_SEARCH_SCROLLS"
      ),
      fetchContent: parseBoolean(
        parsedEnvironment.data.APP_SEARCH_FETCH_CONTENT,
        false,
        "APP_SEARCH_FETCH_CONTENT"
      )
    }
  };

  validateNoVncSwitchConfig(config);

  return config;
}

function validateNoVncSwitchConfig(config: ApiConfig): void {
  if (!config.idleNoVncSwitchEnabled) {
    return;
  }

  const conflicts = [
    config.activeNoVncPort === config.idleNoVncPort
      ? "ACTIVE_NOVNC_PORT must differ from IDLE_NOVNC_PORT when APP_IDLE_NOVNC_SWITCH=true."
      : undefined,
    config.idleNoVncPort === config.activeVncPort
      ? "IDLE_NOVNC_PORT must differ from ACTIVE_VNC_PORT when APP_IDLE_NOVNC_SWITCH=true."
      : undefined,
    config.idleNoVncPort === config.idleVncPort
      ? "IDLE_NOVNC_PORT must differ from IDLE_VNC_PORT when APP_IDLE_NOVNC_SWITCH=true."
      : undefined
  ].filter((conflict): conflict is string => conflict !== undefined);

  if (conflicts.length > 0) {
    throw new ConfigurationError("API noVNC switch configuration is invalid.", conflicts);
  }
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  variableName: string
): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (["true", "1", "yes", "y"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(normalizedValue)) {
    return false;
  }

  throw new ConfigurationError(`${variableName} must be a boolean value.`, [
    `Received: ${value}`
  ]);
}

function parseHost(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    return "0.0.0.0";
  }

  return value.trim();
}

function parseIntegerInRange(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  variableName: string
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsedValue = Number(value.trim());

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    throw new ConfigurationError(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
      [`Received: ${value}`]
    );
  }

  return parsedValue;
}
