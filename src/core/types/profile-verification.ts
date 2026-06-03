export interface ProfileVerificationResult {
  readonly profileName: string;
  readonly userDataDir: string;
  readonly contextAvailable: boolean;
  readonly pageAvailable: boolean;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly pageReadyState: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

