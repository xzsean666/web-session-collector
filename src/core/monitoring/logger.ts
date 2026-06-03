import pino, { type Logger } from "pino";
import type { LoggingConfig } from "../types/runtime.js";

export function createLogger(loggingConfig: LoggingConfig): Logger {
  return pino({
    level: loggingConfig.level,
    base: {
      app: "web-session-collector"
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export function createBootstrapLogger(): Logger {
  return createLogger({ level: "info" });
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serializedError: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };

    if (hasErrorDetails(error)) {
      serializedError.details = error.details;
    }

    return serializedError;
  }

  return {
    message: String(error)
  };
}

function hasErrorDetails(
  error: Error
): error is Error & { readonly details: readonly string[] } {
  return (
    "details" in error &&
    Array.isArray((error as { readonly details?: unknown }).details)
  );
}
