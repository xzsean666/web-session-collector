import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError } from "../src/core/config/runtime-config.js";
import { loadApiConfig } from "../src/api/api-config.js";

test("loadApiConfig parses idle noVNC switch settings", () => {
  const apiConfig = loadApiConfig({
    APP_API_HOST: "127.0.0.1",
    APP_API_PORT: "18085",
    ACTIVE_NOVNC_PORT: "18086",
    IDLE_NOVNC_PORT: "18087",
    ACTIVE_VNC_PORT: "15900",
    IDLE_VNC_PORT: "15901",
    APP_IDLE_NOVNC_SWITCH: "true"
  });

  assert.equal(apiConfig.host, "127.0.0.1");
  assert.equal(apiConfig.port, 18085);
  assert.equal(apiConfig.activeNoVncPort, 18086);
  assert.equal(apiConfig.idleNoVncPort, 18087);
  assert.equal(apiConfig.activeVncPort, 15900);
  assert.equal(apiConfig.idleVncPort, 15901);
  assert.equal(apiConfig.idleNoVncSwitchEnabled, true);
});

test("loadApiConfig keeps idle noVNC switch disabled by default", () => {
  const apiConfig = loadApiConfig({});

  assert.equal(apiConfig.activeNoVncPort, 10086);
  assert.equal(apiConfig.idleNoVncPort, 10087);
  assert.equal(apiConfig.activeVncPort, 5900);
  assert.equal(apiConfig.idleVncPort, 5901);
  assert.equal(apiConfig.idleNoVncSwitchEnabled, false);
});

test("loadApiConfig rejects noVNC switch port conflicts", () => {
  assert.throws(
    () =>
      loadApiConfig({
        ACTIVE_NOVNC_PORT: "10086",
        IDLE_NOVNC_PORT: "5901",
        IDLE_VNC_PORT: "5901",
        APP_IDLE_NOVNC_SWITCH: "true"
      }),
    ConfigurationError
  );
});
