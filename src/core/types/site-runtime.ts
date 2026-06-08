import type { Logger } from "pino";
import type { PageSession } from "../context/page-session.js";
import type { CurrentAccountResult } from "./current-account.js";
import type { SessionInspectionResult } from "./session-monitor.js";

export interface RuntimeSiteAdapter {
  readonly siteKey: string;
  readonly displayName: string;
  readonly targetHostSuffix: string | undefined;
  readonly defaultStartUrl: string;
  getCurrentAccount(
    pageSession: PageSession,
    logger: Logger
  ): Promise<CurrentAccountResult>;
  inspectSession?(
    pageSession: PageSession,
    logger: Logger
  ): Promise<SessionInspectionResult>;
}
