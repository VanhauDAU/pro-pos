import React, { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentRuntimeState } from '../../core/agent-runtime';
import type {
  DesktopAgentInfo,
  DesktopPrintJobState,
  DesktopSettingsInput,
} from '../shared/desktop-api';
import '../shared/desktop-api';
import {
  formatPairingCode,
  presentCloudStatus,
  presentFriendlyError,
  presentOverallStatus,
  presentPrinterStatus,
  type StatusTone,
} from './presentation';
import './styles.css';

const initialState: AgentRuntimeState = {
  status: 'STOPPED',
  printer: 'UNKNOWN',
  pairing: { code: null, expiresAt: null },
  lastError: null,
  updatedAt: 0,
};

type Action =
  'pair' | 'cancel-pair' | 'test' | 'reconnect' | 'autostart' | 'save' | 'logs' | 'reset' | null;
type ConfirmAction = 'repair' | 'reset' | null;

interface ToastState {
  tone: 'success' | 'danger' | 'info';
  message: string;
  detail?: string | undefined;
}

function Icon({
  name,
  size = 20,
}: {
  name:
    | 'printer'
    | 'cloud'
    | 'settings'
    | 'refresh'
    | 'power'
    | 'check'
    | 'close'
    | 'folder'
    | 'shield';
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    printer: (
      <>
        <path d="M7 9V3h10v6" />
        <path d="M7 18H4V9h16v9h-3" />
        <path d="M7 14h10v7H7z" />
        <path d="M17 12h.01" />
      </>
    ),
    cloud: <path d="M17.5 19H6a4 4 0 0 1-.8-7.92A7 7 0 0 1 18.7 9.1 5 5 0 0 1 17.5 19Z" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M18.5 15a7 7 0 1 1-.8-7.8L20 10" />
      </>
    ),
    power: (
      <>
        <path d="M12 2v10" />
        <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),
    folder: <path d="M3 6h7l2 2h9v11H3z" />,
    shield: (
      <>
        <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function StatusDot({ tone }: { tone: StatusTone }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

function Header({ version }: { version: string }) {
  return (
    <header className="app-header">
      <div className="brand-mark">
        <Icon name="printer" size={21} />
      </div>
      <div className="brand-copy">
        <strong>PRO POS Print Agent</strong>
        <span>v{version}</span>
      </div>
    </header>
  );
}

function Button({
  children,
  kind = 'secondary',
  loading = false,
  icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button className={`button button--${kind}`} disabled={loading || props.disabled} {...props}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className={`toggle ${disabled ? 'toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
      <div className="toast-icon">
        {toast.tone === 'success' ? <Icon name="check" size={18} /> : '!'}
      </div>
      <div className="toast-copy">
        <strong>{toast.message}</strong>
        {toast.detail && (
          <details>
            <summary>Xem chi tiết</summary>
            <code>{toast.detail}</code>
          </details>
        )}
      </div>
      <button className="icon-button" onClick={onClose} aria-label="Đóng thông báo">
        <Icon name="close" size={17} />
      </button>
    </div>
  );
}

function PairingView({
  state,
  version,
  action,
  onStart,
  onCancel,
  onSettings,
}: {
  state: AgentRuntimeState;
  version: string;
  action: Action;
  onStart: () => void;
  onCancel: () => void;
  onSettings: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const code = state.pairing.code;
  const remainingSeconds = state.pairing.expiresAt
    ? Math.max(0, Math.ceil((state.pairing.expiresAt - now) / 1000))
    : null;
  useEffect(() => {
    if (!state.pairing.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.pairing.expiresAt]);
  const remaining =
    remainingSeconds === null
      ? ''
      : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  return (
    <main className="shell shell--pairing">
      <Header version={version} />
      <section className="pairing-panel">
        <div className="pairing-illustration">
          <Icon name="shield" size={34} />
        </div>
        <p className="eyebrow">Thiết lập lần đầu</p>
        <h1>Kết nối Print Agent với cửa hàng</h1>
        <p className="lead">
          Ghép nối một lần để nhận lệnh in an toàn từ PRO POS. Bạn không cần tài khoản hoặc mật
          khẩu.
        </p>
        {state.status === 'PAIRING' ? (
          <div className="pairing-active">
            {code ? (
              <>
                <span className="pairing-label">Mã ghép nối của bạn</span>
                <div className="pairing-code" aria-label={`Mã ghép nối ${code}`}>
                  {formatPairingCode(code)}
                </div>
                <div className={`countdown ${remainingSeconds === 0 ? 'countdown--expired' : ''}`}>
                  {remainingSeconds === 0 ? (
                    'Mã đã hết hạn'
                  ) : (
                    <>
                      Còn hiệu lực <strong>{remaining}</strong>
                    </>
                  )}
                </div>
                <div className="instruction">
                  <span>1</span>
                  <p>
                    Mở <strong>PRO POS → Cài đặt máy in → Print Agent</strong>
                  </p>
                </div>
                <div className="instruction">
                  <span>2</span>
                  <p>Nhập mã 6 số đang hiển thị phía trên</p>
                </div>
                <div className="button-row pairing-actions">
                  <Button
                    kind="secondary"
                    onClick={onStart}
                    loading={action === 'pair'}
                    icon={<Icon name="refresh" size={17} />}
                  >
                    Tạo mã mới
                  </Button>
                  <Button kind="ghost" onClick={onCancel} loading={action === 'cancel-pair'}>
                    Hủy
                  </Button>
                </div>
              </>
            ) : (
              <div className="pairing-loading">
                <Spinner />
                <strong>Đang tạo mã ghép nối…</strong>
                <span>Quá trình này thường chỉ mất vài giây.</span>
                <Button kind="ghost" onClick={onCancel}>
                  Hủy
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Button kind="primary" onClick={onStart} loading={action === 'pair'}>
              Bắt đầu ghép nối
            </Button>
            <button className="text-button" onClick={onSettings}>
              <Icon name="settings" size={16} /> Cài đặt kết nối
            </button>
          </>
        )}
      </section>
      <footer className="security-note">
        <Icon name="shield" size={16} /> Thông tin ghép nối được mã hóa trên thiết bị này
      </footer>
    </main>
  );
}

function Dashboard({
  state,
  info,
  lastJob,
  action,
  onTest,
  onReconnect,
  onAutostart,
  onSettings,
}: {
  state: AgentRuntimeState;
  info: DesktopAgentInfo;
  lastJob: DesktopPrintJobState | null;
  action: Action;
  onTest: () => void;
  onReconnect: () => void;
  onAutostart: (enabled: boolean) => void;
  onSettings: () => void;
}) {
  const overall = presentOverallStatus(state);
  const cloud = presentCloudStatus(state);
  const printer = presentPrinterStatus(state);
  const friendlyError = presentFriendlyError(state);
  const jobLabel =
    lastJob?.status === 'SENDING'
      ? 'Đang gửi'
      : lastJob?.status === 'COMPLETED'
        ? 'Đã gửi tới máy in'
        : 'In thất bại';
  const jobTone: StatusTone =
    lastJob?.status === 'COMPLETED' ? 'success' : lastJob?.status === 'FAILED' ? 'danger' : 'info';

  return (
    <main className="shell">
      <Header version={info.version} />
      <section className={`hero hero--${overall.tone}`}>
        <div className="hero-status">
          <StatusDot tone={overall.tone} />
          <div>
            <h1>{overall.label}</h1>
            <p>{overall.description}</p>
          </div>
        </div>
      </section>
      {friendlyError && (
        <div className="inline-error" role="status">
          <span>!</span>
          <div>
            <strong>{friendlyError}</strong>
            {state.lastError && (
              <details>
                <summary>Xem chi tiết</summary>
                <code>{state.lastError}</code>
              </details>
            )}
          </div>
        </div>
      )}
      <section className="card connection-card">
        <div className="card-heading">
          <h2>Kết nối</h2>
          <span>Cập nhật tự động</span>
        </div>
        <div className="connection-grid">
          <div className="connection-item">
            <div className="connection-icon">
              <Icon name="cloud" />
            </div>
            <div>
              <span>Cloud</span>
              <strong>
                <StatusDot tone={cloud.tone} />
                {cloud.label}
              </strong>
              <small>{cloud.description}</small>
            </div>
          </div>
          <div className="connection-divider" />
          <div className="connection-item">
            <div className="connection-icon">
              <Icon name="printer" />
            </div>
            <div>
              <span>Máy in</span>
              <strong>
                <StatusDot tone={printer.tone} />
                {printer.label}
              </strong>
              <small>{printer.description}</small>
            </div>
          </div>
        </div>
      </section>
      <section className="card printer-card">
        <div className="card-heading">
          <div>
            <h2>Máy in hóa đơn</h2>
            <p>{info.config.printerIp || 'Chưa cấu hình địa chỉ IP'}</p>
          </div>
          <span className="paper-badge">{info.config.paperSize}</span>
        </div>
        <div className="printer-meta">
          <span>
            {info.config.printerIp || '—'}:{info.config.printerPort}
          </span>
          <i>•</i>
          <span>LAN · TCP</span>
          <i>•</i>
          <span>ESC/POS</span>
        </div>
        <div className="button-row">
          <Button
            kind="primary"
            onClick={onTest}
            loading={action === 'test'}
            icon={<Icon name="printer" size={17} />}
          >
            In thử
          </Button>
          <Button
            kind="secondary"
            onClick={onReconnect}
            loading={action === 'reconnect'}
            icon={<Icon name="refresh" size={17} />}
          >
            Kết nối lại
          </Button>
        </div>
      </section>
      <section className="card last-job-card">
        <div className="card-heading">
          <h2>Lệnh in gần nhất</h2>
          {lastJob && (
            <time>
              {new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(lastJob.updatedAt)}
            </time>
          )}
        </div>
        {lastJob ? (
          <div className="job-row">
            <div>
              <span>
                {lastJob.documentType === 'invoice'
                  ? 'Hóa đơn'
                  : lastJob.documentType === 'provisional'
                    ? 'Tạm tính'
                    : 'Lệnh in'}
              </span>
              <strong title={lastJob.jobId}>{lastJob.jobId}</strong>
            </div>
            <span className={`job-status job-status--${jobTone}`}>
              <StatusDot tone={jobTone} />
              {jobLabel}
            </span>
          </div>
        ) : (
          <div className="empty-job">
            <Icon name="printer" size={19} /> Chưa có lệnh in trong phiên này
          </div>
        )}
      </section>
      <section className="system-row">
        <Toggle
          checked={info.autostart}
          disabled={action === 'autostart'}
          onChange={onAutostart}
          label="Khởi động cùng Windows"
        />
        <button className="text-button" onClick={onSettings}>
          <Icon name="settings" size={16} /> Cài đặt nâng cao
        </button>
      </section>
    </main>
  );
}

function SettingsDialog({
  info,
  action,
  onClose,
  onSave,
  onAutostart,
  onLogs,
  onConfirm,
}: {
  info: DesktopAgentInfo;
  action: Action;
  onClose: () => void;
  onSave: (settings: DesktopSettingsInput) => void;
  onAutostart: (enabled: boolean) => void;
  onLogs: () => void;
  onConfirm: (action: Exclude<ConfirmAction, null>) => void;
}) {
  const [form, setForm] = useState<DesktopSettingsInput>({
    serverUrl: info.config.serverUrl,
    printerIp: info.config.printerIp,
    printerPort: info.config.printerPort,
    paperSize: info.config.paperSize,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(form);
  };
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Hệ thống</p>
            <h2 id="settings-title">Cài đặt nâng cao</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng cài đặt">
            <Icon name="close" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="settings-content">
            <div className="settings-section">
              <h3>Kết nối PRO POS</h3>
              <label className="field">
                <span>Server URL</span>
                <input
                  type="url"
                  required
                  readOnly={Boolean(info.config.agentId)}
                  value={form.serverUrl}
                  onChange={(event) => setForm({ ...form, serverUrl: event.target.value })}
                />
              </label>
              {info.config.agentId && (
                <p className="field-help">Ghép nối lại trước nếu cần chuyển sang máy chủ khác.</p>
              )}
              <div className="readonly-grid">
                <div>
                  <span>Agent ID</span>
                  <code>{info.config.agentId || 'Chưa ghép nối'}</code>
                </div>
                <div>
                  <span>Store ID</span>
                  <code>{info.config.storeId || 'Chưa ghép nối'}</code>
                </div>
              </div>
            </div>
            <div className="settings-section">
              <h3>Máy in hóa đơn</h3>
              <div className="field-grid">
                <label className="field field--wide">
                  <span>Địa chỉ IP / hostname</span>
                  <input
                    required
                    value={form.printerIp}
                    onChange={(event) => setForm({ ...form, printerIp: event.target.value })}
                    placeholder="192.168.1.73"
                  />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    required
                    value={form.printerPort}
                    onChange={(event) =>
                      setForm({ ...form, printerPort: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Khổ giấy</span>
                  <select
                    value={form.paperSize}
                    onChange={(event) =>
                      setForm({ ...form, paperSize: event.target.value as 'K58' | 'K80' })
                    }
                  >
                    <option value="K80">K80 · 80 mm</option>
                    <option value="K58">K58 · 58 mm</option>
                  </select>
                </label>
              </div>
              <p className="field-help">Kết nối LAN · TCP, chuẩn lệnh ESC/POS</p>
            </div>
            <div className="settings-section settings-section--rows">
              <div>
                <div>
                  <strong>Khởi động cùng Windows</strong>
                  <p>Chạy ẩn trong khay hệ thống sau khi đăng nhập.</p>
                </div>
                <Toggle
                  checked={info.autostart}
                  disabled={action === 'autostart'}
                  onChange={onAutostart}
                  label=""
                />
              </div>
              <button
                type="button"
                className="settings-link"
                onClick={onLogs}
                disabled={action === 'logs'}
              >
                <Icon name="folder" size={18} /> Mở thư mục nhật ký
              </button>
            </div>
            <div className="settings-section danger-zone">
              <h3>Thiết lập lại</h3>
              <div className="danger-actions">
                <button type="button" onClick={() => onConfirm('repair')}>
                  Ghép nối lại
                </button>
                <button type="button" onClick={() => onConfirm('reset')}>
                  Xóa cấu hình
                </button>
              </div>
              <p>Các thao tác này luôn yêu cầu xác nhận.</p>
            </div>
          </div>
          <div className="dialog-footer">
            <Button type="button" kind="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" kind="primary" loading={action === 'save'}>
              Lưu & khởi động lại
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDialog({
  action,
  loading,
  onCancel,
  onConfirm,
}: {
  action: Exclude<ConfirmAction, null>;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const repair = action === 'repair';
  return (
    <div className="overlay overlay--confirm">
      <section
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="confirm-icon">
          <Icon name={repair ? 'refresh' : 'power'} size={25} />
        </div>
        <h2 id="confirm-title">{repair ? 'Ghép nối lại Print Agent?' : 'Xóa toàn bộ cấu hình?'}</h2>
        <p>
          {repair
            ? 'Print Agent sẽ xóa liên kết với cửa hàng hiện tại, giữ cài đặt máy in và khởi động lại.'
            : 'Liên kết cửa hàng và toàn bộ cài đặt máy in trên thiết bị này sẽ bị xóa.'}
        </p>
        <div className="button-row">
          <Button kind="secondary" onClick={onCancel} disabled={loading}>
            Hủy
          </Button>
          <Button kind="danger" onClick={onConfirm} loading={loading}>
            {repair ? 'Ghép nối lại' : 'Xóa cấu hình'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [state, setState] = useState(initialState);
  const [info, setInfo] = useState<DesktopAgentInfo | null>(null);
  const [lastJob, setLastJob] = useState<DesktopPrintJobState | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const refreshInfo = async () => setInfo(await window.proposPrintAgent.getInfo());
  useEffect(() => {
    void Promise.all([
      window.proposPrintAgent.getState(),
      window.proposPrintAgent.getInfo(),
      window.proposPrintAgent.getLastJob(),
    ])
      .then(([nextState, nextInfo, nextJob]) => {
        setState(nextState);
        setInfo(nextInfo);
        setLastJob(nextJob);
      })
      .catch((error: unknown) =>
        setToast({
          tone: 'danger',
          message: 'Không thể tải trạng thái Print Agent.',
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    const removeStateListener = window.proposPrintAgent.onStateChanged((nextState) => {
      setState(nextState);
      if (nextState.pairing.code) setAction((current) => (current === 'pair' ? null : current));
    });
    const removeJobListener = window.proposPrintAgent.onJobChanged(setLastJob);
    return () => {
      removeStateListener();
      removeJobListener();
    };
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmAction) setConfirmAction(null);
      else setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirmAction]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const isUnpaired = state.status === 'UNPAIRED' || state.status === 'PAIRING';
  const startPairing = async () => {
    setAction('pair');
    setToast(null);
    if (state.status === 'PAIRING') await window.proposPrintAgent.cancelPairing();
    void window.proposPrintAgent
      .startPairing()
      .then(refreshInfo)
      .catch((error: unknown) =>
        setToast({
          tone: 'danger',
          message: 'Không thể tạo mã ghép nối. Kiểm tra kết nối Internet.',
          detail: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setAction(null));
  };
  const cancelPairing = async () => {
    setAction('cancel-pair');
    await window.proposPrintAgent.cancelPairing();
    setAction(null);
  };
  const testPrinter = async () => {
    setAction('test');
    setToast(null);
    try {
      const [result] = await Promise.all([
        window.proposPrintAgent.testPrinter(),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);
      setToast(
        result.ok
          ? { tone: 'success', message: 'Đã gửi lệnh in thử tới máy in' }
          : {
              tone: 'danger',
              message: 'Không thể kết nối máy in. Kiểm tra nguồn, dây mạng hoặc địa chỉ IP.',
              detail: result.error,
            },
      );
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể gửi lệnh in thử.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAction(null);
    }
  };
  const reconnect = async () => {
    setAction('reconnect');
    setToast(null);
    try {
      await Promise.all([
        window.proposPrintAgent.reconnect(),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      setToast({ tone: 'info', message: 'Đang kết nối lại tới máy chủ…' });
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể kết nối lại.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAction(null);
    }
  };
  const setAutostart = async (enabled: boolean) => {
    if (!info) return;
    setAction('autostart');
    try {
      const confirmed = await window.proposPrintAgent.setAutostart(enabled);
      setInfo({ ...info, autostart: confirmed });
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể cập nhật khởi động cùng Windows.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAction(null);
    }
  };
  const saveSettings = async (settings: DesktopSettingsInput) => {
    setAction('save');
    try {
      await window.proposPrintAgent.saveSettings(settings);
      setToast({ tone: 'info', message: 'Đã lưu. Print Agent đang khởi động lại…' });
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể lưu cài đặt.',
        detail: error instanceof Error ? error.message : String(error),
      });
      setAction(null);
    }
  };
  const openLogs = async () => {
    setAction('logs');
    try {
      await window.proposPrintAgent.openLogs();
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể mở thư mục nhật ký.',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAction(null);
    }
  };
  const reset = async () => {
    if (!confirmAction) return;
    setAction('reset');
    try {
      if (confirmAction === 'repair') await window.proposPrintAgent.resetPairing();
      else await window.proposPrintAgent.resetAll();
    } catch (error) {
      setToast({
        tone: 'danger',
        message: 'Không thể thiết lập lại Print Agent.',
        detail: error instanceof Error ? error.message : String(error),
      });
      setAction(null);
      setConfirmAction(null);
    }
  };

  const version = info?.version || '0.2.0';
  const content = useMemo(
    () =>
      isUnpaired ? (
        <PairingView
          state={state}
          version={version}
          action={action}
          onStart={() => void startPairing()}
          onCancel={() => void cancelPairing()}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : info ? (
        <Dashboard
          state={state}
          info={info}
          lastJob={lastJob}
          action={action}
          onTest={() => void testPrinter()}
          onReconnect={() => void reconnect()}
          onAutostart={(enabled) => void setAutostart(enabled)}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <div className="app-loading">
          <Spinner /> Đang tải Print Agent…
        </div>
      ),
    [action, info, isUnpaired, lastJob, state, version],
  );

  return (
    <>
      {content}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      {settingsOpen && info && (
        <SettingsDialog
          info={info}
          action={action}
          onClose={() => setSettingsOpen(false)}
          onSave={(settings) => void saveSettings(settings)}
          onAutostart={(enabled) => void setAutostart(enabled)}
          onLogs={() => void openLogs()}
          onConfirm={setConfirmAction}
        />
      )}
      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          loading={action === 'reset'}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void reset()}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
