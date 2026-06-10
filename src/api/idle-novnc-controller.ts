import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { serializeError } from "../core/monitoring/logger.js";

export type IdleNoVncTargetRole = "active" | "idle";

export interface IdleNoVncControllerOptions {
  readonly noVncPort: number;
  readonly activeVncPort: number;
  readonly idleVncPort: number;
  readonly logger: Logger;
}

export class IdleNoVncController {
  private readonly noVncPort: number;
  private readonly activeVncPort: number;
  private readonly idleVncPort: number;
  private readonly logger: Logger;
  private process: ChildProcessWithoutNullStreams | undefined;
  private targetRole: IdleNoVncTargetRole | undefined;
  private switching = Promise.resolve();

  constructor(options: IdleNoVncControllerOptions) {
    this.noVncPort = options.noVncPort;
    this.activeVncPort = options.activeVncPort;
    this.idleVncPort = options.idleVncPort;
    this.logger = options.logger;
  }

  async setTargetRole(
    targetRole: IdleNoVncTargetRole,
    reason: string
  ): Promise<void> {
    this.switching = this.switching
      .catch(() => undefined)
      .then(() => this.setTargetRoleInternal(targetRole, reason));

    await this.switching;
  }

  async stop(reason: string): Promise<void> {
    await this.stopProcess(reason);
  }

  private async setTargetRoleInternal(
    targetRole: IdleNoVncTargetRole,
    reason: string
  ): Promise<void> {
    if (this.process !== undefined && this.targetRole === targetRole) {
      return;
    }

    await this.stopProcess(reason);

    const vncPort = this.vncPortForTargetRole(targetRole);
    const childProcess = spawn("websockify", [
      "--web=/usr/share/novnc",
      String(this.noVncPort),
      `127.0.0.1:${vncPort}`
    ]);

    this.process = childProcess;
    this.targetRole = targetRole;

    childProcess.stdout.on("data", (chunk: Buffer) => {
      this.logger.debug(
        {
          module: "idle_novnc_controller",
          stage: "websockify_stdout",
          output: chunk.toString("utf8").trim()
        },
        "idle noVNC websockify stdout."
      );
    });

    childProcess.stderr.on("data", (chunk: Buffer) => {
      this.logger.debug(
        {
          module: "idle_novnc_controller",
          stage: "websockify_stderr",
          output: chunk.toString("utf8").trim()
        },
        "idle noVNC websockify stderr."
      );
    });

    childProcess.once("exit", (code, signal) => {
      if (this.process === childProcess) {
        this.process = undefined;
        this.targetRole = undefined;
      }

      this.logger.info(
        {
          module: "idle_novnc_controller",
          stage: "websockify_exited",
          reason,
          code,
          signal,
          targetRole,
          noVncPort: this.noVncPort,
          vncPort
        },
        "idle noVNC websockify exited."
      );
    });

    this.logger.info(
      {
        module: "idle_novnc_controller",
        stage: "websockify_started",
        reason,
        targetRole,
        noVncPort: this.noVncPort,
        vncPort
      },
      "idle noVNC websockify started."
    );

    await this.rejectIfProcessExitsImmediately(childProcess, targetRole, vncPort);
  }

  private async stopProcess(reason: string): Promise<void> {
    const childProcess = this.process;

    if (childProcess === undefined) {
      return;
    }

    this.process = undefined;
    this.targetRole = undefined;

    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return;
    }

    this.logger.info(
      {
        module: "idle_novnc_controller",
        stage: "websockify_stop_started",
        reason,
        pid: childProcess.pid
      },
      "Stopping idle noVNC websockify."
    );

    await new Promise<void>((resolve) => {
      const terminateTimeout = setTimeout(() => {
        childProcess.kill("SIGKILL");
      }, 2_000);
      const giveUpTimeout = setTimeout(resolve, 5_000);

      childProcess.once("exit", () => {
        clearTimeout(terminateTimeout);
        clearTimeout(giveUpTimeout);
        resolve();
      });

      childProcess.kill("SIGTERM");
    });
  }

  private async rejectIfProcessExitsImmediately(
    childProcess: ChildProcessWithoutNullStreams,
    targetRole: IdleNoVncTargetRole,
    vncPort: number
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 250);

      childProcess.once("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      childProcess.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `idle noVNC websockify exited immediately for ${targetRole} target ` +
              `(noVNC ${this.noVncPort} -> VNC ${vncPort}; code=${String(code)}, signal=${String(signal)}).`
          )
        );
      });
    }).catch((error: unknown) => {
      this.logger.warn(
        {
          module: "idle_novnc_controller",
          stage: "websockify_start_failed",
          targetRole,
          noVncPort: this.noVncPort,
          vncPort,
          error: serializeError(error)
        },
        "idle noVNC websockify failed to start."
      );

      throw error;
    });
  }

  private vncPortForTargetRole(targetRole: IdleNoVncTargetRole): number {
    return targetRole === "active" ? this.activeVncPort : this.idleVncPort;
  }
}
