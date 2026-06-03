import { runMvpRuntime } from "./runtime/runtime.js";
import { createBootstrapLogger, serializeError } from "./core/monitoring/logger.js";
import { loadLocalEnvFile } from "./core/config/local-env-file.js";

loadLocalEnvFile();

const bootstrapLogger = createBootstrapLogger();

runMvpRuntime(process.env).catch((error: unknown) => {
  bootstrapLogger.error(
    {
      module: "main",
      stage: "failed",
      error: serializeError(error)
    },
    "Application failed."
  );

  process.exitCode = 1;
});
