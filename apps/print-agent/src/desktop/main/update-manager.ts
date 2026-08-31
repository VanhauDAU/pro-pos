import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { autoUpdater as electronAutoUpdater, type AppUpdater } from 'electron-updater';
import log from 'electron-log';
import type { ShutdownCoordinator } from './shutdown-coordinator';
import type { DesktopUpdateErrorCode, DesktopUpdateState } from './update-state';

export interface UpdateManagerDependencies {
  autoUpdater?: AppUpdater | undefined;
  logger?: typeof log | undefined;
  currentVersion?: string | undefined;
  isPackaged?: boolean | undefined;
  isPortable?: boolean | undefined;
  shutdownCoordinator?: ShutdownCoordinator | undefined;
}

export class UpdateManager extends EventEmitter {
  private readonly autoUpdater: AppUpdater;
  private readonly logger: typeof log;
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly isPortable: boolean;
  private readonly shutdownCoordinator?: ShutdownCoordinator | undefined;

  private state: DesktopUpdateState;
  private checkPromise: Promise<DesktopUpdateState> | null = null;
  private downloadPromise: Promise<DesktopUpdateState> | null = null;
  private installPromise: Promise<void> | null = null;
  private startupCheckTimer: NodeJS.Timeout | null = null;
  private periodicCheckTimer: NodeJS.Timeout | null = null;

  constructor(dependencies: UpdateManagerDependencies = {}) {
    super();
    this.currentVersion =
      dependencies.currentVersion ?? (app?.getVersion ? app.getVersion() : '0.5.0');
    this.isPackaged = dependencies.isPackaged ?? app?.isPackaged ?? false;
    this.isPortable = dependencies.isPortable ?? Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    this.shutdownCoordinator = dependencies.shutdownCoordinator;
    this.logger = dependencies.logger ?? log;
    this.autoUpdater = dependencies.autoUpdater ?? electronAutoUpdater;

    const isDisabled = !this.isPackaged || this.isPortable;

    this.state = {
      status: isDisabled ? 'DISABLED' : 'IDLE',
      currentVersion: this.currentVersion,
      availableVersion: null,
      progressPercent: null,
      downloadedBytes: null,
      totalBytes: null,
      releaseNotes: null,
      checkedAt: null,
      errorCode: isDisabled
        ? this.isPortable
          ? 'UPDATE_UNSUPPORTED_PORTABLE'
          : 'UPDATE_DISABLED'
        : null,
      errorMessage: isDisabled
        ? this.isPortable
          ? 'Bản Portable không hỗ trợ cập nhật tự động.'
          : 'Cập nhật tự động tắt ở môi trường phát triển.'
        : null,
    };

    if (!isDisabled) {
      this.configureAutoUpdater();
    }
  }

  private configureAutoUpdater(): void {
    try {
      this.autoUpdater.autoDownload = false;
      this.autoUpdater.autoInstallOnAppQuit = false;
      this.autoUpdater.allowDowngrade = false;
      this.autoUpdater.allowPrerelease = false;
      this.autoUpdater.logger = this.logger;
    } catch {
      // ignore if test mock doesn't support all properties
    }

    this.autoUpdater.on('checking-for-update', () => {
      this.logger.info(
        JSON.stringify({
          event: 'update_check_started',
          currentVersion: this.currentVersion,
          timestamp: Date.now(),
        }),
      );
      this.setState({
        status: 'CHECKING',
        errorCode: null,
        errorMessage: null,
      });
    });

    this.autoUpdater.on('update-available', (info) => {
      const availableVersion = info?.version ?? null;
      const releaseNotes =
        typeof info?.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info?.releaseNotes)
            ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
            : null;

      this.logger.info(
        JSON.stringify({
          event: 'update_available',
          currentVersion: this.currentVersion,
          availableVersion,
          timestamp: Date.now(),
        }),
      );

      this.setState({
        status: 'AVAILABLE',
        availableVersion,
        releaseNotes,
        checkedAt: Date.now(),
        errorCode: null,
        errorMessage: null,
      });

      // Automatically trigger background download
      void this.downloadUpdate();
    });

    this.autoUpdater.on('update-not-available', () => {
      this.logger.info(
        JSON.stringify({
          event: 'update_not_available',
          currentVersion: this.currentVersion,
          timestamp: Date.now(),
        }),
      );

      this.setState({
        status: 'UP_TO_DATE',
        availableVersion: null,
        checkedAt: Date.now(),
        errorCode: null,
        errorMessage: null,
      });
    });

    this.autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.min(100, Math.max(0, Math.round(progressObj?.percent ?? 0)));
      this.logger.info(
        JSON.stringify({
          event: 'update_download_progress',
          currentVersion: this.currentVersion,
          targetVersion: this.state.availableVersion,
          progressPercent: percent,
          transferred: progressObj?.transferred,
          total: progressObj?.total,
          timestamp: Date.now(),
        }),
      );

      this.setState({
        status: 'DOWNLOADING',
        progressPercent: percent,
        downloadedBytes: progressObj?.transferred ?? null,
        totalBytes: progressObj?.total ?? null,
      });
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      const version = info?.version ?? this.state.availableVersion;
      this.logger.info(
        JSON.stringify({
          event: 'update_download_completed',
          currentVersion: this.currentVersion,
          targetVersion: version,
          timestamp: Date.now(),
        }),
      );

      this.setState({
        status: 'DOWNLOADED',
        availableVersion: version,
        progressPercent: 100,
        errorCode: null,
        errorMessage: null,
      });
    });

    this.autoUpdater.on('error', (err) => {
      const rawMessage = err?.message || String(err);
      const { code, message } = this.mapError(rawMessage);

      this.logger.error(
        JSON.stringify({
          event: 'update_error',
          currentVersion: this.currentVersion,
          targetVersion: this.state.availableVersion,
          errorCode: code,
          errorMessage: message,
          rawError: rawMessage,
          timestamp: Date.now(),
        }),
      );

      this.setState({
        status: 'ERROR',
        errorCode: code,
        errorMessage: message,
      });
    });
  }

  private mapError(rawMessage: string): { code: DesktopUpdateErrorCode; message: string } {
    const lower = rawMessage.toLowerCase();
    if (lower.includes('checksum') || lower.includes('sha512') || lower.includes('hash mismatch')) {
      return {
        code: 'UPDATE_CHECKSUM_FAILED',
        message: 'Xác thực gói cập nhật thất bại (mã băm không khớp).',
      };
    }
    if (
      lower.includes('net::') ||
      lower.includes('enotfound') ||
      lower.includes('etimedout') ||
      lower.includes('network')
    ) {
      return {
        code: 'UPDATE_NETWORK_ERROR',
        message: 'Không thể kết nối máy chủ cập nhật. Vui lòng kiểm tra kết nối mạng.',
      };
    }
    if (
      lower.includes('signature') ||
      lower.includes('certificate') ||
      lower.includes('authenticode')
    ) {
      return {
        code: 'UPDATE_SIGNATURE_FAILED',
        message: 'Chữ ký số của bản cập nhật không hợp lệ.',
      };
    }
    if (lower.includes('yaml') || lower.includes('manifest') || lower.includes('parse')) {
      return {
        code: 'UPDATE_MANIFEST_INVALID',
        message: 'Thông tin bản cập nhật máy chủ không hợp lệ.',
      };
    }
    if (lower.includes('download')) {
      return {
        code: 'UPDATE_DOWNLOAD_FAILED',
        message: 'Tải bản cập nhật thất bại. Vui lòng thử lại.',
      };
    }
    return {
      code: 'UPDATE_INSTALL_FAILED',
      message: 'Có lỗi xảy ra trong quá trình cập nhật.',
    };
  }

  getState(): DesktopUpdateState {
    return { ...this.state };
  }

  start(): void {
    if (this.state.status === 'DISABLED') {
      return;
    }

    // Schedule initial check after 45s, regardless of realtime online/offline status
    this.startupCheckTimer = setTimeout(() => {
      this.startupCheckTimer = null;
      void this.checkForUpdates();
      this.schedulePeriodicCheck();
    }, 45_000);
  }

  stop(): void {
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }
    if (this.periodicCheckTimer) {
      clearTimeout(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }
  }

  private schedulePeriodicCheck(): void {
    if (this.periodicCheckTimer) {
      clearTimeout(this.periodicCheckTimer);
    }
    // 6 hours ± 15 mins jitter
    const jitterMs = (Math.random() * 30 - 15) * 60_000;
    const intervalMs = 6 * 3600_000 + jitterMs;

    this.periodicCheckTimer = setTimeout(() => {
      this.periodicCheckTimer = null;
      void this.checkForUpdates();
      this.schedulePeriodicCheck();
    }, intervalMs);
  }

  async checkForUpdates(): Promise<DesktopUpdateState> {
    if (this.state.status === 'DISABLED') {
      return this.getState();
    }

    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.checkPromise = (async () => {
      try {
        await this.autoUpdater.checkForUpdates();
      } catch (err: any) {
        const rawMessage = err?.message || String(err);
        const { code, message } = this.mapError(rawMessage);
        this.setState({
          status: 'ERROR',
          errorCode: code,
          errorMessage: message,
          checkedAt: Date.now(),
        });
      }
      return this.getState();
    })().finally(() => {
      this.checkPromise = null;
    });

    return this.checkPromise;
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    if (this.state.status === 'DISABLED') {
      return this.getState();
    }

    if (this.state.status === 'DOWNLOADED') {
      return this.getState();
    }

    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    this.downloadPromise = (async () => {
      try {
        this.logger.info(
          JSON.stringify({
            event: 'update_download_started',
            currentVersion: this.currentVersion,
            targetVersion: this.state.availableVersion,
            timestamp: Date.now(),
          }),
        );
        this.setState({
          status: 'DOWNLOADING',
          progressPercent: 0,
          errorCode: null,
          errorMessage: null,
        });
        await this.autoUpdater.downloadUpdate();
      } catch (err: any) {
        const rawMessage = err?.message || String(err);
        const { code, message } = this.mapError(rawMessage);
        this.setState({
          status: 'ERROR',
          errorCode: code,
          errorMessage: message,
        });
      }
      return this.getState();
    })().finally(() => {
      this.downloadPromise = null;
    });

    return this.downloadPromise;
  }

  async installUpdate(): Promise<void> {
    if (this.state.status === 'DISABLED') {
      throw new Error('Chức năng cập nhật tự động không khả dụng trên phiên bản này.');
    }

    if (this.state.status === 'INSTALLING' || this.state.status === 'WAITING_FOR_IDLE') {
      return;
    }

    if (this.state.status !== 'DOWNLOADED') {
      throw new Error('Bản cập nhật chưa được tải xong.');
    }

    if (this.installPromise) {
      return this.installPromise;
    }

    this.installPromise = this.performInstall().finally(() => {
      this.installPromise = null;
    });

    return this.installPromise;
  }

  private async performInstall(): Promise<void> {
    this.logger.info(
      JSON.stringify({
        event: 'update_install_requested',
        currentVersion: this.currentVersion,
        targetVersion: this.state.availableVersion,
        timestamp: Date.now(),
      }),
    );

    this.setState({ status: 'WAITING_FOR_IDLE' });

    if (!this.shutdownCoordinator) {
      this.setState({ status: 'INSTALLING' });
      this.autoUpdater.quitAndInstall(false, true);
      return;
    }

    const permitted = await this.shutdownCoordinator.requestQuit(
      'UPDATE',
      () => {
        this.logger.info(
          JSON.stringify({
            event: 'update_install_started',
            currentVersion: this.currentVersion,
            targetVersion: this.state.availableVersion,
            timestamp: Date.now(),
          }),
        );
        this.setState({ status: 'INSTALLING' });
        this.autoUpdater.quitAndInstall(false, true);
      },
      30_000,
    );

    if (!permitted) {
      this.logger.warn(
        JSON.stringify({
          event: 'update_waiting_for_print_queue_timeout',
          currentVersion: this.currentVersion,
          targetVersion: this.state.availableVersion,
          timestamp: Date.now(),
        }),
      );
      this.setState({
        status: 'ERROR',
        errorCode: 'UPDATE_DRAIN_TIMEOUT',
        errorMessage: 'Chưa thể cập nhật vì Print Agent vẫn đang xử lý lệnh in.',
      });
    }
  }

  private setState(partial: Partial<DesktopUpdateState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.emit('stateChanged', this.getState());
  }
}
