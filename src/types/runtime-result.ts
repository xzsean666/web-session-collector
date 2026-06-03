import type { CurrentAccountResult } from "../core/types/current-account.js";
import type { ProfileVerificationResult } from "../core/types/profile-verification.js";
import type { StartPageNavigationResult } from "../core/types/start-page-navigation.js";

export interface RuntimeExecutionResult {
  readonly profileVerification: ProfileVerificationResult;
  readonly startPageNavigation: StartPageNavigationResult;
  readonly currentUser: CurrentAccountResult;
}
