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
  readonly requestBodyLimitBytes: number;
  readonly accountCheckIntervalMs: number;
  readonly searchDefaults: ApiSearchDefaults;
}

const apiEnvironmentSchema = z.object({
  APP_API_HOST: z.string().optional(),
  APP_API_PORT: z.string().optional(),
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

  return {
    host: parseHost(parsedEnvironment.data.APP_API_HOST),
    port: parseIntegerInRange(
      parsedEnvironment.data.APP_API_PORT,
      10085,
      1,
      65_535,
      "APP_API_PORT"
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
