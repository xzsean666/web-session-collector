export interface CurrentAccountResult {
  readonly siteKey: string;
  readonly displayName: string;
  readonly profileUrl: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly accountHandle: string;
  readonly description: string;
  readonly found: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}
