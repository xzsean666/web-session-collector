export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export type BrowserChannel =
  | "bundled"
  | "chromium"
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "msedge"
  | "msedge-beta"
  | "msedge-dev"
  | "msedge-canary";

export type BrowserConnectionMode = "launch" | "connect";

export interface ProfileConfig {
  readonly userDataDir: string;
  readonly profileName: string;
}

export interface SiteConfig {
  readonly siteKey: string;
}

export interface BrowserRuntimeConfig {
  readonly connectionMode: BrowserConnectionMode;
  readonly cdpUrl: string | undefined;
  readonly headless: boolean;
  readonly channel: BrowserChannel;
  readonly executablePath: string | undefined;
  readonly profileDirectory: string | undefined;
  readonly locale: string;
  readonly timezoneId: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly deviceScaleFactor: number;
  readonly activeDisplay: string | undefined;
  readonly idleDisplay: string | undefined;
  readonly flags: readonly string[];
  readonly ignoredDefaultArgs: readonly string[];
  // 反自动化遮蔽 + 人性化行为的总开关(APP_HUMANIZE,默认开)。
  readonly humanize: boolean;
  // 桌面 UA/平台伪装(APP_UA_SPOOF,默认开):把 Linux aarch64 伪装成 Windows Chrome。
  // 仅在 humanize 同时开启、且 launch 模式下生效。是最易因不一致而招事的一项,故单独开关。
  readonly uaSpoof: boolean;
}

export interface RuntimeBehaviorConfig {
  readonly keepBrowserAlive: boolean;
  readonly interactiveLoginOnMissingUser: boolean;
  readonly startupSessionId: string;
  readonly startupIdleSessionId: string | undefined;
}

export interface NavigationConfig {
  readonly startUrl: string;
}

export interface LoggingConfig {
  readonly level: LogLevel;
}

export interface RuntimeConfig {
  readonly site: SiteConfig;
  readonly profile: ProfileConfig;
  readonly browser: BrowserRuntimeConfig;
  readonly navigation: NavigationConfig;
  readonly runtime: RuntimeBehaviorConfig;
  readonly logging: LoggingConfig;
}
