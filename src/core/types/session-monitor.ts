import type { CurrentAccountResult } from "./current-account.js";

export type SessionState =
  | "unknown"
  | "logged_in"
  | "logged_out"
  | "challenge_required"
  | "browser_closed"
  | "error";

export interface SessionIndicator {
  readonly code: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
}

export interface SessionInspectionResult {
  readonly siteKey: string;
  readonly state: SessionState;
  readonly checkedAt: string;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly currentAccount: CurrentAccountResult | undefined;
  readonly indicators: readonly SessionIndicator[];
  readonly errorMessage: string | undefined;
}
