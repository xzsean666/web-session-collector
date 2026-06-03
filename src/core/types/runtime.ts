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
  readonly flags: readonly string[];
  readonly ignoredDefaultArgs: readonly string[];
}

export interface RuntimeBehaviorConfig {
  readonly keepBrowserAlive: boolean;
  readonly interactiveLoginOnMissingUser: boolean;
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
