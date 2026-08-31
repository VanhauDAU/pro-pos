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
  platform?: NodeJS.Platform | undefined;
  shutdownCoordinator?: ShutdownCoordinator | undefined;
}

export const UPDATE_MAINTENANCE_START_HOUR = 0;
export const UPDATE_MAINTENANCE_END_HOUR = 2;
export const UPDATE_PREFLIGHT_HOUR = 23;
export const UPDATE_PREFLIGHT_MINUTE = 45;
export const UPDATE_INSTALL_RETRY_MS = 5 * 60_000;

export function isUpdateMaintenanceWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= UPDATE_MAINTENANCE_START_HOUR && hour < UPDATE_MAINTENANCE_END_HOUR;
}

export function nextLocalOccurrence(now: Date, hour: number, minute = 0): Date {
  const next = new Date(now.getTime());
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function maintenanceWindowEnd(now: Date): Date {
  const end = new Date(now.getTime());
  end.setHours(UPDATE_MAINTENANCE_END_HOUR, 0, 0, 0);
  return end;
}

function nextAutomaticRetry(now: Date): Date {
  const windowStart = new Date(now.getTime());
  windowStart.setHours(UPDATE_MAINTENANCE_START_HOUR, 0, 0, 0);
  const elapsedMs = Math.max(0, now.getTime() - windowStart.getTime());
  const nextSlot = Math.floor(elapsedMs / UPDATE_INSTALL_RETRY_MS) + 1;
  return new Date(windowStart.getTime() + nextSlot * UPDATE_INSTALL_RETRY_MS);
}

export class UpdateManager extends EventEmitter {
  private readonly autoUpdater: AppUpdater;
  private readonly logger: typeof log;
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly isPortable: boolean;
  private readonly automaticMaintenanceEnabled: boolean;
  private readonly shutdownCoordinator?: ShutdownCoordinator | undefined;

  private state: DesktopUpdateState;
  private checkPromise: Promise<DesktopUpdateState> | null = null;
  private downloadPromise: Promise<DesktopUpdateState> | null = null;
  private installPromise: Promise<void> | null = null;
  private startupCheckTimer: NodeJS.Timeout | null = null;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private preflightCheckTimer: NodeJS.Timeout | null = null;
  private maintenanceBoundaryTimer: NodeJS.Timeout | null = null;
  private automaticInstallRetryTimer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(dependencies: UpdateManagerDependencies = {}) {
    super();
    this.currentVersion =
      dependencies.currentVersion ?? (app?.getVersion ? app.getVersion() : '0.5.0');
    this.isPackaged = dependencies.isPackaged ?? app?.isPackaged ?? false;
    this.isPortable = dependencies.isPortable ?? Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    this.automaticMaintenanceEnabled = (dependencies.platform ?? process.platform) === 'win32';
    this.shutdownCoordinator = dependencies.shutdownCoordinator;
    this.logger = dependencies.logger ?? log;
    this.autoUpdater = dependencies.autoUpdater ?? electronAutoUpdater;

    const isDisabled = !this.isPackaged || this.isPortable;

    this.state = {
      status: isDisabled ? 'DISABLED' : 'IDLE',
      currentVersion: this.currentVersion,
      automaticInstallScheduled: !isDisabled && this.automaticMaintenanceEnabled,
      maintenanceWindowActive:
        !isDisabled && this.automaticMaintenanceEnabled && isUpdateMaintenanceWindow(new Date()),
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
        maintenanceWindowActive:
          this.automaticMaintenanceEnabled && isUpdateMaintenanceWindow(new Date()),
        progressPercent: 100,
        errorCode: null,
        errorMessage: null,
      });

      if (this.automaticMaintenanceEnabled && isUpdateMaintenanceWindow(new Date())) {
        void this.requestAutomaticInstall();
      }
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

    // 1. Checksum / Hash validation failure
    if (lower.includes('checksum') || lower.includes('sha512') || lower.includes('hash mismatch')) {
      return {
        code: 'UPDATE_CHECKSUM_FAILED',
        message: 'Xác thực gói cập nhật thất bại (mã băm SHA512 không khớp).',
      };
    }

    // 2. DNS / Domain not found
    if (lower.includes('enotfound') || lower.includes('getaddrinfo') || lower.includes('dns')) {
      return {
        code: 'UPDATE_SERVER_NOT_FOUND',
        message: 'Không tìm thấy máy chủ cập nhật (lỗi phân giải tên miền updates.propos.vn).',
      };
    }

    // 3. HTTP 404 Feed / Manifest missing
    if (
      lower.includes('404') ||
      lower.includes('cannot find') ||
      lower.includes('not found') ||
      lower.includes('status code 404')
    ) {
      return {
        code: 'UPDATE_FEED_NOT_FOUND',
        message: 'Máy chủ cập nhật chưa có file manifest latest.yml (HTTP 404).',
      };
    }

    // 4. HTTP 403 Forbidden / Access denied
    if (
      lower.includes('403') ||
      lower.includes('forbidden') ||
      lower.includes('access denied') ||
      lower.includes('status code 403')
    ) {
      return {
        code: 'UPDATE_FORBIDDEN',
        message: 'Truy cập máy chủ cập nhật bị từ chối (HTTP 403 Forbidden).',
      };
    }

    // 5. Connection Timeout
    if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('timed out')) {
      return {
        code: 'UPDATE_TIMEOUT',
        message: 'Quá thời gian kết nối tới máy chủ cập nhật (Connection Timeout).',
      };
    }

    // 6. TLS / SSL Certificate failure
    if (
      lower.includes('cert_') ||
      lower.includes('tls') ||
      lower.includes('ssl') ||
      lower.includes('unable to verify') ||
      lower.includes('self signed')
    ) {
      return {
        code: 'UPDATE_TLS_ERROR',
        message: 'Lỗi xác thực chứng chỉ bảo mật SSL/TLS máy chủ cập nhật.',
      };
    }

    // 7. Signature / Authenticode failure
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

    // 8. Manifest / YAML parsing error
    if (lower.includes('yaml') || lower.includes('manifest') || lower.includes('parse')) {
      return {
        code: 'UPDATE_MANIFEST_INVALID',
        message: 'Thông tin bản cập nhật máy chủ (latest.yml) không hợp lệ.',
      };
    }

    // 9. Download stream error
    if (lower.includes('download')) {
      return {
        code: 'UPDATE_DOWNLOAD_FAILED',
        message: 'Tải bản cập nhật thất bại. Vui lòng thử lại.',
      };
    }

    // 10. General network failure
    if (lower.includes('net::') || lower.includes('network') || lower.includes('econnrefused')) {
      return {
        code: 'UPDATE_NETWORK_ERROR',
        message: 'Không thể kết nối máy chủ cập nhật. Vui lòng kiểm tra kết nối mạng.',
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
    if (this.state.status === 'DISABLED' || this.started) {
      return;
    }

    this.started = true;

    // Schedule initial check after 45s, regardless of realtime online/offline status
    this.startupCheckTimer = setTimeout(() => {
      this.startupCheckTimer = null;
      void this.checkForUpdates();
      this.schedulePeriodicCheck();
    }, 45_000);

    if (this.automaticMaintenanceEnabled) {
      this.schedulePreflightCheck();
      this.refreshMaintenanceSchedule(true);
    }
  }

  stop(): void {
    this.started = false;
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }
    if (this.periodicCheckTimer) {
      clearTimeout(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }
    if (this.preflightCheckTimer) {
      clearTimeout(this.preflightCheckTimer);
      this.preflightCheckTimer = null;
    }
    if (this.maintenanceBoundaryTimer) {
      clearTimeout(this.maintenanceBoundaryTimer);
      this.maintenanceBoundaryTimer = null;
    }
    this.clearAutomaticInstallRetry();
  }

  /** Recalculate local wall-clock timers after Windows wakes from sleep. */
  handleResume(): void {
    if (!this.started || this.state.status === 'DISABLED' || !this.automaticMaintenanceEnabled) {
      return;
    }
    this.schedulePreflightCheck();
    this.refreshMaintenanceSchedule(true);
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

  private schedulePreflightCheck(): void {
    if (this.preflightCheckTimer) {
      clearTimeout(this.preflightCheckTimer);
    }

    const now = new Date();
    const next = nextLocalOccurrence(now, UPDATE_PREFLIGHT_HOUR, UPDATE_PREFLIGHT_MINUTE);
    this.preflightCheckTimer = setTimeout(() => {
      this.preflightCheckTimer = null;
      void this.checkForUpdates();
      this.schedulePreflightCheck();
    }, next.getTime() - now.getTime());
  }

  private refreshMaintenanceSchedule(checkImmediately: boolean): void {
    if (this.maintenanceBoundaryTimer) {
      clearTimeout(this.maintenanceBoundaryTimer);
      this.maintenanceBoundaryTimer = null;
    }

    const now = new Date();
    const maintenanceWindowActive = isUpdateMaintenanceWindow(now);
    if (this.state.maintenanceWindowActive !== maintenanceWindowActive) {
      this.setState({ maintenanceWindowActive });
    }

    if (!maintenanceWindowActive) {
      this.clearAutomaticInstallRetry();
    } else if (this.state.status === 'DOWNLOADED') {
      void this.requestAutomaticInstall();
    } else if (checkImmediately) {
      void this.checkForUpdates();
    }

    const boundary = maintenanceWindowActive
      ? maintenanceWindowEnd(now)
      : nextLocalOccurrence(now, UPDATE_MAINTENANCE_START_HOUR);
    this.maintenanceBoundaryTimer = setTimeout(
      () => {
        this.maintenanceBoundaryTimer = null;
        this.refreshMaintenanceSchedule(true);
      },
      Math.max(1, boundary.getTime() - now.getTime()),
    );
  }

  private clearAutomaticInstallRetry(): void {
    if (this.automaticInstallRetryTimer) {
      clearTimeout(this.automaticInstallRetryTimer);
      this.automaticInstallRetryTimer = null;
    }
  }

  private scheduleAutomaticInstallRetry(): void {
    this.clearAutomaticInstallRetry();
    const now = new Date();
    if (!isUpdateMaintenanceWindow(now)) return;

    const retryAt = nextAutomaticRetry(now);
    if (retryAt.getTime() >= maintenanceWindowEnd(now).getTime()) return;

    this.automaticInstallRetryTimer = setTimeout(() => {
      this.automaticInstallRetryTimer = null;
      if (isUpdateMaintenanceWindow(new Date()) && this.state.status === 'DOWNLOADED') {
        void this.requestAutomaticInstall();
      }
    }, retryAt.getTime() - now.getTime());
  }

  async checkForUpdates(): Promise<DesktopUpdateState> {
    if (this.state.status === 'DISABLED') {
      return this.getState();
    }

    if (this.checkPromise) {
      return this.checkPromise;
    }

    // Never disturb a downloaded package or an active download/install with a
    // second feed check. The daily preflight becomes a no-op in these states.
    if (
      this.state.status === 'AVAILABLE' ||
      this.state.status === 'DOWNLOADING' ||
      this.state.status === 'DOWNLOADED' ||
      this.state.status === 'WAITING_FOR_IDLE' ||
      this.state.status === 'INSTALLING'
    ) {
      return this.getState();
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

    this.clearAutomaticInstallRetry();
    const scheduledInstall =
      this.automaticMaintenanceEnabled && isUpdateMaintenanceWindow(new Date());
    this.installPromise = this.performInstall(scheduledInstall).finally(() => {
      this.installPromise = null;
    });

    return this.installPromise;
  }

  private requestAutomaticInstall(): Promise<void> {
    if (!isUpdateMaintenanceWindow(new Date()) || this.state.status !== 'DOWNLOADED') {
      return Promise.resolve();
    }
    if (this.installPromise) return this.installPromise;

    this.installPromise = this.performInstall(true).finally(() => {
      this.installPromise = null;
    });
    return this.installPromise;
  }

  private async performInstall(automatic: boolean): Promise<void> {
    if (automatic && !isUpdateMaintenanceWindow(new Date())) return;

    this.logger.info(
      JSON.stringify({
        event: 'update_install_requested',
        mode: automatic ? 'AUTOMATIC' : 'MANUAL',
        currentVersion: this.currentVersion,
        targetVersion: this.state.availableVersion,
        timestamp: Date.now(),
      }),
    );

    this.setState({ status: 'WAITING_FOR_IDLE' });

    if (!this.shutdownCoordinator) {
      if (automatic && !isUpdateMaintenanceWindow(new Date())) {
        this.setState({ status: 'DOWNLOADED', maintenanceWindowActive: false });
        return;
      }
      this.setState({ status: 'INSTALLING' });
      this.autoUpdater.quitAndInstall(false, true);
      return;
    }

    const now = new Date();
    const timeoutMs = automatic
      ? Math.max(1, Math.min(30_000, maintenanceWindowEnd(now).getTime() - now.getTime()))
      : 30_000;

    const onReadyToQuit = () => {
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
    };
    let permitted: boolean;
    try {
      permitted = automatic
        ? await this.shutdownCoordinator.requestQuit('UPDATE', onReadyToQuit, timeoutMs, () =>
            isUpdateMaintenanceWindow(new Date()),
          )
        : await this.shutdownCoordinator.requestQuit('UPDATE', onReadyToQuit, timeoutMs);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'update_install_failed',
          currentVersion: this.currentVersion,
          targetVersion: this.state.availableVersion,
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }),
      );
      if (automatic) {
        const maintenanceWindowActive = isUpdateMaintenanceWindow(new Date());
        this.setState({
          status: 'DOWNLOADED',
          maintenanceWindowActive,
          errorCode: null,
          errorMessage: null,
        });
        if (maintenanceWindowActive) this.scheduleAutomaticInstallRetry();
      } else {
        this.setState({
          status: 'ERROR',
          errorCode: 'UPDATE_INSTALL_FAILED',
          errorMessage: 'Không thể bắt đầu cài đặt bản cập nhật. Print Agent đã hoạt động lại.',
        });
      }
      return;
    }

    if (!permitted) {
      this.logger.warn(
        JSON.stringify({
          event: 'update_waiting_for_print_queue_timeout',
          currentVersion: this.currentVersion,
          targetVersion: this.state.availableVersion,
          timestamp: Date.now(),
        }),
      );
      if (automatic) {
        const maintenanceWindowActive = isUpdateMaintenanceWindow(new Date());
        this.setState({
          status: 'DOWNLOADED',
          maintenanceWindowActive,
          errorCode: null,
          errorMessage: null,
        });
        if (maintenanceWindowActive) this.scheduleAutomaticInstallRetry();
      } else {
        this.setState({
          status: 'ERROR',
          errorCode: 'UPDATE_DRAIN_TIMEOUT',
          errorMessage: 'Chưa thể cập nhật vì Print Agent vẫn đang xử lý lệnh in.',
        });
      }
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
