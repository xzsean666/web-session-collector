import { statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  BrowserChannel,
  BrowserConnectionMode,
  LogLevel,
  RuntimeConfig
} from "../types/runtime.js";

const logLevels = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent"
] as const satisfies readonly LogLevel[];

const browserChannels = [
  "bundled",
  "chromium",
  "chrome",
  "chrome-beta",
  "chrome-dev",
  "chrome-canary",
  "msedge",
  "msedge-beta",
  "msedge-dev",
  "msedge-canary"
] as const satisfies readonly BrowserChannel[];

const browserConnectionModes = [
  "launch",
  "connect"
] as const satisfies readonly BrowserConnectionMode[];

const runtimeEnvironmentSchema = z.object({
  APP_SITE: z.string().optional(),
  APP_USER_DATA_DIR: z.string().trim().min(1),
  APP_PROFILE_NAME: z.string().trim().min(1),
  APP_BROWSER_MODE: z.string().optional(),
  APP_CDP_URL: z.string().optional(),
  APP_HEADLESS: z.string().optional(),
  APP_BROWSER_CHANNEL: z.string().optional(),
  APP_EXECUTABLE_PATH: z.string().optional(),
  APP_PROFILE_DIRECTORY: z.string().optional(),
  APP_LOCALE: z.string().optional(),
  APP_TIMEZONE_ID: z.string().optional(),
  APP_VIEWPORT_WIDTH: z.string().optional(),
  APP_VIEWPORT_HEIGHT: z.string().optional(),
  APP_DEVICE_SCALE_FACTOR: z.string().optional(),
  APP_BROWSER_FLAGS: z.string().optional(),
  APP_IGNORE_DEFAULT_ARGS: z.string().optional(),
  APP_START_URL: z.string().optional(),
  APP_LOG_LEVEL: z.string().optional(),
  APP_KEEP_BROWSER_ALIVE: z.string().optional(),
  APP_INTERACTIVE_LOGIN_ON_MISSING_USER: z.string().optional()
});

export class ConfigurationError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = "ConfigurationError";
    this.details = details;
  }
}

export function loadRuntimeConfig(
  environmentVariables: NodeJS.ProcessEnv
): RuntimeConfig {
  const parsedEnvironment =
    runtimeEnvironmentSchema.safeParse(environmentVariables);

  if (!parsedEnvironment.success) {
    throw new ConfigurationError(
      "Runtime configuration is invalid.",
      parsedEnvironment.error.issues.map((issue) => {
        const variableName = issue.path.join(".") || "environment";
        return `${variableName}: ${issue.message}`;
      })
    );
  }

  const userDataDir = validateUserDataDir(
    parsedEnvironment.data.APP_USER_DATA_DIR
  );

  return {
    site: {
      siteKey: parseOptionalNonEmptyString(parsedEnvironment.data.APP_SITE) ?? "default"
    },
    profile: {
      userDataDir,
      profileName: parsedEnvironment.data.APP_PROFILE_NAME
    },
    browser: {
      connectionMode: parseBrowserConnectionMode(
        parsedEnvironment.data.APP_BROWSER_MODE
      ),
      cdpUrl: parseCdpUrl(parsedEnvironment.data.APP_CDP_URL),
      headless: parseBoolean(
        parsedEnvironment.data.APP_HEADLESS,
        false,
        "APP_HEADLESS"
      ),
      channel: parseBrowserChannel(parsedEnvironment.data.APP_BROWSER_CHANNEL),
      executablePath: parseExecutablePath(
        parsedEnvironment.data.APP_EXECUTABLE_PATH
      ),
      profileDirectory: parseOptionalNonEmptyString(
        parsedEnvironment.data.APP_PROFILE_DIRECTORY
      ),
      locale: parseOptionalString(
        parsedEnvironment.data.APP_LOCALE,
        "zh-CN"
      ),
      timezoneId: parseOptionalString(
        parsedEnvironment.data.APP_TIMEZONE_ID,
        "Asia/Shanghai"
      ),
      viewport: {
        width: parsePositiveInteger(
          parsedEnvironment.data.APP_VIEWPORT_WIDTH,
          1366,
          "APP_VIEWPORT_WIDTH"
        ),
        height: parsePositiveInteger(
          parsedEnvironment.data.APP_VIEWPORT_HEIGHT,
          768,
          "APP_VIEWPORT_HEIGHT"
        )
      },
      deviceScaleFactor: parsePositiveNumber(
        parsedEnvironment.data.APP_DEVICE_SCALE_FACTOR,
        1,
        "APP_DEVICE_SCALE_FACTOR"
      ),
      flags: parseBrowserFlags(
        parsedEnvironment.data.APP_BROWSER_FLAGS,
        "APP_BROWSER_FLAGS"
      ),
      ignoredDefaultArgs: parseBrowserFlags(
        parsedEnvironment.data.APP_IGNORE_DEFAULT_ARGS,
        "APP_IGNORE_DEFAULT_ARGS"
      )
    },
    navigation: {
      startUrl: parseStartUrl(parsedEnvironment.data.APP_START_URL)
    },
    runtime: {
      keepBrowserAlive: parseBoolean(
        parsedEnvironment.data.APP_KEEP_BROWSER_ALIVE,
        false,
        "APP_KEEP_BROWSER_ALIVE"
      ),
      interactiveLoginOnMissingUser: parseBoolean(
        parsedEnvironment.data.APP_INTERACTIVE_LOGIN_ON_MISSING_USER,
        false,
        "APP_INTERACTIVE_LOGIN_ON_MISSING_USER"
      )
    },
    logging: {
      level: parseLogLevel(parsedEnvironment.data.APP_LOG_LEVEL)
    }
  };
}

function validateUserDataDir(userDataDir: string): string {
  if (!path.isAbsolute(userDataDir)) {
    throw new ConfigurationError("APP_USER_DATA_DIR must be an absolute path.", [
      `Received: ${userDataDir}`
    ]);
  }

  let directoryStats;

  try {
    directoryStats = statSync(userDataDir);
  } catch {
    throw new ConfigurationError("APP_USER_DATA_DIR does not exist.", [
      `Received: ${userDataDir}`
    ]);
  }

  if (!directoryStats.isDirectory()) {
    throw new ConfigurationError("APP_USER_DATA_DIR must be a directory.", [
      `Received: ${userDataDir}`
    ]);
  }

  return userDataDir;
}

function parseExecutablePath(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const executablePath = value.trim();

  if (!path.isAbsolute(executablePath)) {
    throw new ConfigurationError("APP_EXECUTABLE_PATH must be an absolute path.", [
      `Received: ${value}`
    ]);
  }

  let fileStats;

  try {
    fileStats = statSync(executablePath);
  } catch {
    throw new ConfigurationError("APP_EXECUTABLE_PATH does not exist.", [
      `Received: ${value}`
    ]);
  }

  if (!fileStats.isFile()) {
    throw new ConfigurationError("APP_EXECUTABLE_PATH must be a file.", [
      `Received: ${value}`
    ]);
  }

  return executablePath;
}

function parseOptionalNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return value.trim();
}

function parseOptionalString(value: string | undefined, defaultValue: string): string {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return value.trim();
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

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value.trim() === "") {
    return "info";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (isLogLevel(normalizedValue)) {
    return normalizedValue;
  }

  throw new ConfigurationError("APP_LOG_LEVEL is not supported.", [
    `Received: ${value}`,
    `Allowed: ${logLevels.join(", ")}`
  ]);
}

function parseBrowserConnectionMode(
  value: string | undefined
): BrowserConnectionMode {
  if (value === undefined || value.trim() === "") {
    return "launch";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (isBrowserConnectionMode(normalizedValue)) {
    return normalizedValue;
  }

  throw new ConfigurationError("APP_BROWSER_MODE is not supported.", [
    `Received: ${value}`,
    `Allowed: ${browserConnectionModes.join(", ")}`
  ]);
}

function parseBrowserChannel(value: string | undefined): BrowserChannel {
  if (value === undefined || value.trim() === "") {
    return "chrome";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (isBrowserChannel(normalizedValue)) {
    return normalizedValue;
  }

  throw new ConfigurationError("APP_BROWSER_CHANNEL is not supported.", [
    `Received: ${value}`,
    `Allowed: ${browserChannels.join(", ")}`
  ]);
}

function parseCdpUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const trimmedValue = value.trim();

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new ConfigurationError("APP_CDP_URL must be a valid URL.", [
      `Received: ${value}`
    ]);
  }

  if (!["http:", "https:", "ws:", "wss:"].includes(parsedUrl.protocol)) {
    throw new ConfigurationError(
      "APP_CDP_URL must use http, https, ws, or wss.",
      [`Received: ${value}`]
    );
  }

  return parsedUrl.toString();
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  variableName: string
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsedValue = Number(value.trim());

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new ConfigurationError(`${variableName} must be a positive integer.`, [
      `Received: ${value}`
    ]);
  }

  return parsedValue;
}

function parsePositiveNumber(
  value: string | undefined,
  defaultValue: number,
  variableName: string
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsedValue = Number(value.trim());

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new ConfigurationError(`${variableName} must be a positive number.`, [
      `Received: ${value}`
    ]);
  }

  return parsedValue;
}

function parseBrowserFlags(
  value: string | undefined,
  variableName: string
): readonly string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const trimmedValue = value.trim();

  if (trimmedValue.startsWith("[")) {
    return parseJsonBrowserFlags(trimmedValue, variableName);
  }

  return trimmedValue
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

function parseStartUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    return "https://example.com/";
  }

  const trimmedValue = value.trim();

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new ConfigurationError("APP_START_URL must be a valid URL.", [
      `Received: ${value}`
    ]);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new ConfigurationError("APP_START_URL must use http or https.", [
      `Received: ${value}`
    ]);
  }

  return parsedUrl.toString();
}

function parseJsonBrowserFlags(
  value: string,
  variableName: string
): readonly string[] {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch {
    throw new ConfigurationError(
      `${variableName} must be valid JSON or a comma-separated list.`,
      [`Received: ${value}`]
    );
  }

  if (
    !Array.isArray(parsedValue) ||
    !parsedValue.every((flag) => typeof flag === "string")
  ) {
    throw new ConfigurationError(`${variableName} JSON must be a string array.`);
  }

  return parsedValue
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

function isLogLevel(value: string): value is LogLevel {
  return logLevels.includes(value as LogLevel);
}

function isBrowserConnectionMode(value: string): value is BrowserConnectionMode {
  return browserConnectionModes.includes(value as BrowserConnectionMode);
}

function isBrowserChannel(value: string): value is BrowserChannel {
  return browserChannels.includes(value as BrowserChannel);
}
