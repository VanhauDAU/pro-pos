export type ShutdownReason = 'NORMAL' | 'UPDATE' | 'RESET' | 'SETTINGS_RESTART' | 'SYSTEM';

export type ShutdownState = 'RUNNING' | 'QUIESCING' | 'DRAINING' | 'READY_TO_QUIT' | 'QUITTING';

export interface ShutdownRuntimeTarget {
  start?(): Promise<void>;
  stop(): Promise<void>;
  stopGracefully(options?: { timeoutMs?: number }): Promise<'SUCCESS' | 'DRAIN_TIMEOUT'>;
  getPendingPrintJobCount(): number;
  isPrintIdle(): boolean;
}

export class ShutdownCoordinator {
  private state: ShutdownState = 'RUNNING';
  private permittedToQuit = false;
  private activeQuitPromise: Promise<boolean> | null = null;

  constructor(
    private readonly runtime: ShutdownRuntimeTarget,
    private readonly quitApp: () => void = () => {},
  ) {}

  getState(): ShutdownState {
    return this.state;
  }

  isPermittedToQuit(): boolean {
    return this.permittedToQuit;
  }

  async requestQuit(
    reason: ShutdownReason,
    onReadyToQuit?: () => Promise<void> | void,
    timeoutMs = 30_000,
    canProceed?: () => boolean,
  ): Promise<boolean> {
    if (this.state === 'QUITTING') {
      return true;
    }

    if (this.activeQuitPromise) {
      return this.activeQuitPromise;
    }

    this.activeQuitPromise = this.performQuit(reason, onReadyToQuit, timeoutMs, canProceed).finally(
      () => {
        this.activeQuitPromise = null;
      },
    );

    return this.activeQuitPromise;
  }

  private async performQuit(
    reason: ShutdownReason,
    onReadyToQuit?: () => Promise<void> | void,
    timeoutMs = 30_000,
    canProceed?: () => boolean,
  ): Promise<boolean> {
    if (reason === 'UPDATE') {
      if (canProceed && !canProceed()) {
        return false;
      }

      this.state = 'DRAINING';
      const drainResult = await this.runtime.stopGracefully({ timeoutMs });

      if (drainResult === 'DRAIN_TIMEOUT') {
        this.state = 'RUNNING';
        this.permittedToQuit = false;
        return false;
      }

      // A scheduled install may finish draining after its maintenance window
      // closed (for example when Windows slept during the drain). Restore the
      // runtime instead of restarting outside the approved window.
      if (canProceed && !canProceed()) {
        await this.runtime.start?.();
        this.state = 'RUNNING';
        this.permittedToQuit = false;
        return false;
      }

      this.state = 'READY_TO_QUIT';
      this.permittedToQuit = true;

      if (onReadyToQuit) {
        try {
          await onReadyToQuit();
        } catch (error) {
          this.permittedToQuit = false;
          await this.runtime.start?.();
          this.state = 'RUNNING';
          throw error;
        }
      } else {
        this.state = 'QUITTING';
        this.quitApp();
      }
      return true;
    }

    // For other shutdown reasons (NORMAL, SYSTEM, SETTINGS_RESTART, RESET)
    this.state = 'DRAINING';
    try {
      if (reason === 'NORMAL' || reason === 'SYSTEM') {
        // Try short graceful drain for normal quit
        const drainResult = await this.runtime.stopGracefully({
          timeoutMs: Math.min(timeoutMs, 5_000),
        });
        if (drainResult === 'DRAIN_TIMEOUT') {
          await this.runtime.stop();
        }
      } else {
        await this.runtime.stop();
      }
    } catch {
      await this.runtime.stop().catch(() => {});
    }

    this.state = 'READY_TO_QUIT';
    this.permittedToQuit = true;

    if (onReadyToQuit) {
      await onReadyToQuit();
    } else {
      this.state = 'QUITTING';
      this.quitApp();
    }

    return true;
  }
}
