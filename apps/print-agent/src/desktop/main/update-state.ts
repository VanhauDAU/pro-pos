export type DesktopUpdateStatus =
  | 'DISABLED'
  | 'IDLE'
  | 'CHECKING'
  | 'UP_TO_DATE'
  | 'AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'WAITING_FOR_IDLE'
  | 'INSTALLING'
  | 'ERROR';

export type DesktopUpdateErrorCode =
  | 'UPDATE_DISABLED'
  | 'UPDATE_SERVER_NOT_FOUND'
  | 'UPDATE_FEED_NOT_FOUND'
  | 'UPDATE_FORBIDDEN'
  | 'UPDATE_TIMEOUT'
  | 'UPDATE_TLS_ERROR'
  | 'UPDATE_NETWORK_ERROR'
  | 'UPDATE_MANIFEST_INVALID'
  | 'UPDATE_CHECKSUM_FAILED'
  | 'UPDATE_DOWNLOAD_FAILED'
  | 'UPDATE_SIGNATURE_FAILED'
  | 'UPDATE_NOT_DOWNLOADED'
  | 'UPDATE_ALREADY_INSTALLING'
  | 'UPDATE_DRAIN_TIMEOUT'
  | 'UPDATE_INSTALL_FAILED'
  | 'UPDATE_UNSUPPORTED_PORTABLE';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  automaticInstallScheduled?: boolean;
  maintenanceWindowActive?: boolean;
  availableVersion?: string | null;
  progressPercent?: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  releaseNotes?: string | null;
  checkedAt?: number | null;
  errorCode?: DesktopUpdateErrorCode | null;
  errorMessage?: string | null;
}
