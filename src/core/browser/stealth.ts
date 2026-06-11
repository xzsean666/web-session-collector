import type { BrowserContext } from "playwright";
import type { Logger } from "pino";
import { serializeError } from "../monitoring/logger.js";

// 反自动化:抹掉 Playwright/CDP 留下的、最容易被风控识别的「自动化」痕迹。
//
// 这里刻意只做「最小遮蔽」:浏览器本身是带真实持久化 profile 的真 Chrome,
// 指纹(UA / WebGL / 字体 / 时区 …)已经是真的。过度伪造反而会和真实环境
// 冲突、制造新的不一致破绽。所以只处理自动化特有、且与真实环境矛盾的几项。
export async function applyStealthInitScript(
  browserContext: BrowserContext,
  logger: Logger
): Promise<void> {
  try {
    await browserContext.addInitScript(() => {
      // 1) navigator.webdriver:自动化下为 true,真实浏览器为 false。
      //    优先改原型上的 getter,失败再退而其次直接定义到实例。
      const fakeWebdriver = () => false;
      try {
        Object.defineProperty(
          Object.getPrototypeOf(navigator),
          "webdriver",
          { get: fakeWebdriver, configurable: true }
        );
      } catch {
        try {
          Object.defineProperty(navigator, "webdriver", {
            get: fakeWebdriver,
            configurable: true
          });
        } catch {
          /* 忽略:个别环境不可重定义,不影响主流程。 */
        }
      }

      // 2) window.chrome:真实 Chrome 一定存在;自动化/无头下可能缺失。
      const chromeCarrier = window as unknown as { chrome?: unknown };
      if (!chromeCarrier.chrome) {
        chromeCarrier.chrome = { runtime: {} };
      }

      // 3) permissions.query 对 notifications 的一致性:自动化下其 state 与
      //    Notification.permission 容易对不上,这是常见的检测点。
      try {
        const permissions = window.navigator.permissions;
        const originalQuery = permissions?.query?.bind(permissions);
        if (originalQuery) {
          permissions.query = ((parameters: PermissionDescriptor) =>
            parameters && parameters.name === "notifications"
              ? Promise.resolve({
                  state: Notification.permission
                } as PermissionStatus)
              : originalQuery(parameters)) as typeof permissions.query;
        }
      } catch {
        /* 忽略:permissions 不可用时直接跳过。 */
      }
    });

    logger.info(
      { module: "browser", stage: "stealth_init_applied" },
      "Applied stealth init script to browser context."
    );
  } catch (error) {
    logger.warn(
      {
        module: "browser",
        stage: "stealth_init_failed",
        error: serializeError(error)
      },
      "Failed to apply stealth init script; continuing without it."
    );
  }
}

// launch 模式下应额外忽略 / 追加的浏览器参数,去掉「受自动化控制」的硬特征:
// - 忽略 --enable-automation:它会置 navigator.webdriver=true 并显示自动化信息条。
// - 追加 --disable-blink-features=AutomationControlled:进一步关闭 Blink 暴露的标记。
export const STEALTH_IGNORED_DEFAULT_ARGS: readonly string[] = [
  "--enable-automation"
];

export const STEALTH_EXTRA_FLAGS: readonly string[] = [
  "--disable-blink-features=AutomationControlled"
];

// 桌面 UA/平台伪装的目标系统。按容器架构自动选,做到「架构不撒谎」:
// - macos:Apple Silicon Mac 本身就是 arm64,架构报 "arm" 是真实的 → 给 arm64 用。
// - windows:x86_64 报 "x86" 是真实的,且 Windows 是小红书 PC 用户的绝大多数 → 给 x64 用。
export type UaSpoofTarget = "windows" | "macos";

interface UaSpoofPreset {
  // 替换进 UA 第一个括号段的平台标识。
  readonly uaPlatform: string;
  // navigator.platform 的值(Mac 上即便是 M 系列也报 MacIntel)。
  readonly navigatorPlatform: string;
  // userAgentData.platform。
  readonly uaDataPlatform: string;
  // sec-ch-ua-platform 头(带引号)。
  readonly secChUaPlatform: string;
  // 高熵 architecture / bitness:与真实容器架构一致(arm64→arm,x64→x86)。
  readonly architecture: string;
  readonly bitness: string;
  // 高熵 platformVersion(Win10≈"10.0.0";macOS Sonoma≈"14.5.0")。
  readonly platformVersion: string;
  // WebGL UNMASKED 厂商/渲染器:服务器无 GPU 时是软件渲染(SwiftShader/llvmpipe),
  // 与「真实桌面用户」矛盾,是最大破绽。伪装成与平台自洽的常见 GPU。
  readonly webglVendor: string;
  readonly webglRenderer: string;
  // 常见桌面取值,避免服务器异常的核数/内存暴露。
  readonly hardwareConcurrency: number;
  readonly deviceMemory: number;
}

const UA_SPOOF_PRESETS: Readonly<Record<UaSpoofTarget, UaSpoofPreset>> = {
  windows: {
    uaPlatform: "Windows NT 10.0; Win64; x64",
    navigatorPlatform: "Win32",
    uaDataPlatform: "Windows",
    secChUaPlatform: '"Windows"',
    architecture: "x86",
    bitness: "64",
    platformVersion: "10.0.0",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    hardwareConcurrency: 8,
    deviceMemory: 8
  },
  macos: {
    // M 系列 Mac 上 Chrome 的 UA 仍写 "Intel Mac OS X"(苹果为兼容故意保留)。
    uaPlatform: "Macintosh; Intel Mac OS X 10_15_7",
    navigatorPlatform: "MacIntel",
    uaDataPlatform: "macOS",
    secChUaPlatform: '"macOS"',
    architecture: "arm",
    bitness: "64",
    platformVersion: "14.5.0",
    // Apple Silicon 上 Chrome 走 ANGLE/Metal,渲染器报 Apple M 系列,与 arm/macOS 自洽。
    webglVendor: "Google Inc. (Apple)",
    webglRenderer:
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    hardwareConcurrency: 8,
    deviceMemory: 8
  }
};

// 桌面 UA/平台伪装:服务器无论 x86_64 还是 aarch64,浏览器 UA 里都是 Linux,
// 而小红书 PC 用户绝大多数是 Windows/Mac —— Linux 桌面是个明显的少数派指纹。
// 这里按容器架构伪装成 Windows / macOS,保持真实 Chrome 版本号不变,并让所有相关
// 信号一致:navigator.userAgent / appVersion / platform / userAgentData,以及
// User-Agent / sec-ch-ua* 请求头。任何一处对不上反而是新破绽,所以一次改全。
export async function applyDesktopUaSpoof(
  browserContext: BrowserContext,
  target: UaSpoofTarget,
  logger: Logger
): Promise<void> {
  const preset = UA_SPOOF_PRESETS[target];

  try {
    // 先读出当前浏览器的真实 UA(拿到真实 Chrome 版本号,避免硬编码导致版本不符)。
    const pages = browserContext.pages();
    let probePage = pages[0];
    let createdProbePage = false;
    if (probePage === undefined) {
      probePage = await browserContext.newPage();
      createdProbePage = true;
    }

    const realUserAgent = await probePage
      .evaluate(() => navigator.userAgent)
      .catch(() => "");

    if (createdProbePage) {
      await probePage.close().catch(() => undefined);
    }

    const majorVersion = /Chrome\/(\d+)/.exec(realUserAgent)?.[1];
    const fullVersion = /Chrome\/([\d.]+)/.exec(realUserAgent)?.[1];

    if (
      realUserAgent === "" ||
      majorVersion === undefined ||
      fullVersion === undefined
    ) {
      logger.warn(
        { module: "browser", stage: "ua_spoof_skipped", realUserAgent },
        "Could not read a Chrome user agent; skipping desktop UA spoof."
      );
      return;
    }

    // 只替换 UA 里的「平台」括号段(第一个括号),其余(含 Chrome 版本)原样保留;
    // 并把 HeadlessChrome 兜底改成 Chrome(正常有头模式不会出现,纯属防意外无头回退)。
    const spoofedUserAgent = realUserAgent
      .replace(/\([^)]*\)/, `(${preset.uaPlatform})`)
      .replace(/HeadlessChrome/g, "Chrome");

    // header 与 JS 的 brands 用同一份,保证 sec-ch-ua 与 userAgentData 一致。
    const brands = [
      { brand: "Chromium", version: majorVersion },
      { brand: "Google Chrome", version: majorVersion },
      { brand: "Not?A_Brand", version: "99" }
    ];
    const secChUa = brands
      .map((entry) => `"${entry.brand}";v="${entry.version}"`)
      .join(", ");

    // 1) 请求头:覆盖 User-Agent + 客户端提示(sec-ch-ua*),让服务端看到的也一致。
    await browserContext.setExtraHTTPHeaders({
      "User-Agent": spoofedUserAgent,
      "sec-ch-ua": secChUa,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": preset.secChUaPlatform
    });

    // 2) JS 侧:navigator 各处与上面保持一致。
    await browserContext.addInitScript(
      (data: {
        userAgent: string;
        navigatorPlatform: string;
        uaDataPlatform: string;
        architecture: string;
        bitness: string;
        platformVersion: string;
        brands: { brand: string; version: string }[];
        fullVersion: string;
        webglVendor: string;
        webglRenderer: string;
        hardwareConcurrency: number;
        deviceMemory: number;
      }) => {
        const proto = Object.getPrototypeOf(navigator);
        const define = (prop: string, getter: () => unknown): void => {
          try {
            Object.defineProperty(proto, prop, {
              get: getter,
              configurable: true
            });
          } catch {
            /* 个别属性不可重定义时跳过。 */
          }
        };

        define("userAgent", () => data.userAgent);
        define("appVersion", () => data.userAgent.replace(/^Mozilla\//, ""));
        define("platform", () => data.navigatorPlatform);
        define("hardwareConcurrency", () => data.hardwareConcurrency);
        define("deviceMemory", () => data.deviceMemory);

        // WebGL UNMASKED 厂商/渲染器:把软件渲染伪装成与平台自洽的真实 GPU。
        // 37445 = UNMASKED_VENDOR_WEBGL,37446 = UNMASKED_RENDERER_WEBGL。
        const patchWebgl = (
          glProto: { getParameter?: (param: number) => unknown } | undefined
        ): void => {
          if (!glProto || typeof glProto.getParameter !== "function") {
            return;
          }
          const original = glProto.getParameter;
          glProto.getParameter = function (param: number): unknown {
            if (param === 37445) {
              return data.webglVendor;
            }
            if (param === 37446) {
              return data.webglRenderer;
            }
            return original.call(this, param);
          };
        };
        const globalScope = window as unknown as {
          WebGLRenderingContext?: { prototype: { getParameter?: (p: number) => unknown } };
          WebGL2RenderingContext?: { prototype: { getParameter?: (p: number) => unknown } };
        };
        try {
          patchWebgl(globalScope.WebGLRenderingContext?.prototype);
          patchWebgl(globalScope.WebGL2RenderingContext?.prototype);
        } catch {
          /* WebGL 不可用时跳过。 */
        }

        const lowEntropyBrands = data.brands.map((entry) => ({
          brand: entry.brand,
          version: entry.version
        }));
        const fullVersionList = data.brands.map((entry) => ({
          brand: entry.brand,
          version: entry.brand.includes("Brand")
            ? entry.version
            : data.fullVersion
        }));

        const uaData = {
          brands: lowEntropyBrands,
          mobile: false,
          platform: data.uaDataPlatform,
          getHighEntropyValues: (_hints: string[]) =>
            Promise.resolve({
              architecture: data.architecture,
              bitness: data.bitness,
              brands: lowEntropyBrands,
              fullVersionList,
              mobile: false,
              model: "",
              platform: data.uaDataPlatform,
              platformVersion: data.platformVersion,
              uaFullVersion: data.fullVersion,
              wow64: false
            }),
          toJSON: () => ({
            brands: lowEntropyBrands,
            mobile: false,
            platform: data.uaDataPlatform
          })
        };
        define("userAgentData", () => uaData);
      },
      {
        userAgent: spoofedUserAgent,
        navigatorPlatform: preset.navigatorPlatform,
        uaDataPlatform: preset.uaDataPlatform,
        architecture: preset.architecture,
        bitness: preset.bitness,
        platformVersion: preset.platformVersion,
        brands,
        fullVersion,
        webglVendor: preset.webglVendor,
        webglRenderer: preset.webglRenderer,
        hardwareConcurrency: preset.hardwareConcurrency,
        deviceMemory: preset.deviceMemory
      }
    );

    logger.info(
      {
        module: "browser",
        stage: "ua_spoof_applied",
        target,
        spoofedUserAgent,
        chromeMajor: majorVersion,
        webglRenderer: preset.webglRenderer
      },
      "Applied desktop UA / platform / WebGL spoof."
    );
  } catch (error) {
    logger.warn(
      {
        module: "browser",
        stage: "ua_spoof_failed",
        target,
        error: serializeError(error)
      },
      "Failed to apply desktop UA spoof; continuing without it."
    );
  }
}
