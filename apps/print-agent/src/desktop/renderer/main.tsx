import React, { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentRuntimeState } from '../../core/agent-runtime';
import type {
  DesktopAgentInfo,
  DesktopPrinterItem,
  DesktopPrintJobState,
  DesktopSettingsInput,
} from '../shared/desktop-api';
import '../shared/desktop-api';
import {
  formatPairingCode,
  presentCloudStatus,
  presentFriendlyError,
  presentOverallStatus,
  presentPrinterErrorDetails,
  presentPrinterStatus,
  type StatusTone,
} from './presentation';
import './styles.css';

const initialState: AgentRuntimeState = {
  status: 'STOPPED',
  printer: 'UNKNOWN',
  pairing: { code: null, expiresAt: null },
  lastError: null,
  printerDiagnostics: null,
  updatedAt: 0,
};

type Action = 'pair' | 'cancel-pair' | 'test' | 'autostart' | 'save' | 'logs' | 'reset' | null;
type ConfirmAction = 'repair' | 'reset' | null;

interface ToastState {
  tone: 'success' | 'danger' | 'info';
  message: string;
  detail?: string | undefined;
}

function Icon({
  name,
  size = 18,
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
    | 'shield'
    | 'arrow-right'
    | 'arrow-left';
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
    'arrow-right': (
      <>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </>
    ),
    'arrow-left': (
      <>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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

function Header({
  version,
  status,
}: {
  version: string;
  status?: { label: string; tone: StatusTone };
}) {
  return (
    <header className="app-header">
      <div className="brand-wrapper">
        <div className="brand-mark">
          <img src="./icon.png" alt="PRO POS" className="brand-logo-img" />
        </div>
        <div className="brand-copy">
          <strong>PRO POS Print Agent</strong>
          <span>v{version}</span>
        </div>
      </div>
      {status && (
        <div className="status-pill">
          <StatusDot tone={status.tone} />
          <span>{status.label}</span>
        </div>
      )}
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
    <label className="toggle">
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
      <span>{toast.message}</span>
      <button className="icon-button" onClick={onClose} aria-label="Đóng thông báo">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** Step 1: Printer Setup & Test Print */
function PrinterSetupView({
  info,
  state,
  action,
  onSaveAndTest,
  onProceedToPairing,
}: {
  info: DesktopAgentInfo;
  state: AgentRuntimeState;
  action: Action;
  onSaveAndTest: (settings: DesktopSettingsInput) => Promise<boolean>;
  onProceedToPairing: () => void;
}) {
  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
  const [form, setForm] = useState<DesktopSettingsInput>({
    serverUrl: info.config.serverUrl,
    connectionType: info.config.connectionType || (isMac ? 'NETWORK_TCP' : 'WINDOWS_PRINTER'),
    printerName: info.config.printerName || '',
    printerIp: info.config.printerIp || '',
    printerPort: info.config.printerPort || 9100,
    paperSize: info.config.paperSize || 'K80',
    autoCut: info.config.autoCut ?? true,
    openCashDrawer: info.config.openCashDrawer ?? false,
    printableDots: info.config.printableDots,
  });

  const [printers, setPrinters] = useState<DesktopPrinterItem[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testedOk, setTestedOk] = useState(state.printer === 'READY');

  const refreshPrinters = async () => {
    if (!window.proposPrintAgent?.listPrinters) return;
    setLoadingPrinters(true);
    try {
      const list = await window.proposPrintAgent.listPrinters();
      setPrinters(list);
      setForm((current) => {
        if (!current.printerName && list.length > 0) {
          const virtualPatterns = /pdf|xps|onenote|fax|document writer|root print queue/i;
          const candidate = list.find((p) => !virtualPatterns.test(p.name)) || list[0];
          if (candidate?.name) {
            return { ...current, printerName: candidate.name };
          }
        }
        return current;
      });
    } catch {
      setPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    if (!isMac) {
      void refreshPrinters();
    }
  }, [isMac]);

  const handleTest = async () => {
    const success = await onSaveAndTest(form);
    if (success) setTestedOk(true);
  };

  const friendlyError = presentFriendlyError(state);
  const errorDetails = presentPrinterErrorDetails(
    state.lastError,
    state.printerDiagnostics ?? undefined,
  );

  return (
    <main className="shell">
      <Header version={info.version} />

      <div className="panel">
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Kết nối máy in</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
            Chọn cách máy in được kết nối với máy tính này:
          </p>
        </div>

        {!isMac && (
          <div className="connection-choice-grid">
            <button
              type="button"
              className={`connection-choice-card ${form.connectionType === 'WINDOWS_PRINTER' ? 'connection-choice-card--active' : ''}`}
              onClick={() => {
                setForm({ ...form, connectionType: 'WINDOWS_PRINTER' });
                setTestedOk(false);
              }}
            >
              <strong>Máy in trên Windows</strong>
              <span>Máy in cắm trực tiếp vào máy tính (USB)</span>
            </button>

            <button
              type="button"
              className={`connection-choice-card ${form.connectionType === 'NETWORK_TCP' ? 'connection-choice-card--active' : ''}`}
              onClick={() => {
                setForm({ ...form, connectionType: 'NETWORK_TCP' });
                setTestedOk(false);
              }}
            >
              <strong>Mạng LAN</strong>
              <span>Máy in kết nối qua router hoặc mạng nội bộ</span>
            </button>
          </div>
        )}

        {form.connectionType === 'WINDOWS_PRINTER' && !isMac ? (
          <div>
            <label className="field">
              <span>Chọn máy in</span>
              <div className="printer-select-row">
                <select
                  value={form.printerName}
                  onChange={(event) => {
                    setForm({ ...form, printerName: event.target.value });
                    setTestedOk(false);
                  }}
                >
                  {printers.length === 0 ? (
                    <option value="">(Chưa tìm thấy máy in)</option>
                  ) : (
                    <>
                      <option value="" disabled>
                        -- Chọn máy in --
                      </option>
                      {printers.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.displayName || p.name} {p.isDefault ? ' (Mặc định)' : ''}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <Button
                  type="button"
                  kind="secondary"
                  loading={loadingPrinters}
                  onClick={() => void refreshPrinters()}
                  title="Làm mới danh sách máy in"
                >
                  <Icon name="refresh" size={14} />
                </Button>
              </div>
              <p className="field-help">
                Dùng khi máy in được cắm USB trực tiếp vào máy tính hoặc đã được cài trong Windows.
              </p>
            </label>

            {printers.length === 0 && (
              <div className="notice notice--warning">
                <div>
                  <strong>Chưa tìm thấy máy in.</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    <li>Kiểm tra nguồn và cáp USB máy in.</li>
                    <li>Cài đặt driver máy in nếu cần.</li>
                    <li>Bấm nút làm mới bên cạnh danh sách.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="field-grid field-grid--wide-left">
              <label className="field">
                <span>Địa chỉ IP máy in</span>
                <input
                  value={form.printerIp}
                  onChange={(event) => {
                    setForm({ ...form, printerIp: event.target.value });
                    setTestedOk(false);
                  }}
                  placeholder="192.168.1.73"
                />
              </label>
              <label className="field">
                <span>Cổng</span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.printerPort}
                  onChange={(event) => {
                    setForm({ ...form, printerPort: Number(event.target.value) });
                    setTestedOk(false);
                  }}
                />
              </label>
            </div>
            <p className="field-help">Kết nối qua mạng LAN nội bộ, cổng 9100</p>
          </div>
        )}

        <label className="field" style={{ marginTop: 12 }}>
          <span>Khổ giấy</span>
          <select
            value={form.paperSize}
            onChange={(event) =>
              setForm({ ...form, paperSize: event.target.value as 'K58' | 'K80' })
            }
          >
            <option value="K80">K80 (80 mm · Chuẩn hóa đơn phổ biến)</option>
            <option value="K58">K58 (58 mm · Khổ nhỏ)</option>
          </select>
        </label>

        {/* Collapsible Advanced Settings */}
        <details className="collapsible-section">
          <summary>Cài đặt nâng cao</summary>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              <Toggle
                checked={Boolean(form.autoCut)}
                onChange={(checked) => setForm({ ...form, autoCut: checked })}
                label="Tự động cắt giấy"
              />
              <Toggle
                checked={Boolean(form.openCashDrawer)}
                onChange={(checked) => setForm({ ...form, openCashDrawer: checked })}
                label="Mở két tiền"
              />
            </div>
            <label className="field" style={{ margin: 0 }}>
              <span style={{ fontSize: 12 }}>Vùng in tùy chỉnh (Printable dots - tùy chọn)</span>
              <input
                type="number"
                placeholder={form.paperSize === 'K58' ? '384' : '576'}
                value={form.printableDots || ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    printableDots: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
          </div>
        </details>

        {/* Status / Error feedback */}
        {friendlyError && (
          <div className="notice notice--danger" style={{ marginTop: 14 }}>
            <div>
              <strong>{friendlyError}</strong>
              {errorDetails && (
                <details>
                  <summary>Xem chi tiết</summary>
                  <code>{errorDetails}</code>
                </details>
              )}
            </div>
          </div>
        )}

        {testedOk && !friendlyError && (
          <div className="notice notice--success" style={{ marginTop: 14 }}>
            <span>✓ Máy in hoạt động tốt</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button
            type="button"
            kind={testedOk ? 'secondary' : 'primary'}
            loading={action === 'test' || action === 'save'}
            onClick={handleTest}
            icon={<Icon name="printer" size={15} />}
          >
            {testedOk ? 'In thử lại' : 'Kiểm tra & In thử'}
          </Button>

          {testedOk && (
            <Button
              type="button"
              kind="primary"
              onClick={onProceedToPairing}
              icon={<Icon name="arrow-right" size={15} />}
            >
              Tiếp tục kết nối PRO POS
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

/** Step 2: Pairing with PRO POS */
function PairingView({
  state,
  version,
  action,
  onStart,
  onBackToPrinter,
}: {
  state: AgentRuntimeState;
  version: string;
  action: Action;
  onStart: () => void;
  onBackToPrinter: () => void;
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
    <main className="shell">
      <Header version={version} />

      <div className="panel pairing-box">
        <h1 className="pairing-title">Kết nối với PRO POS</h1>
        <p className="pairing-subtitle">Nhập mã 6 chữ số này trên màn hình POS của cửa hàng:</p>

        {code ? (
          <div>
            <div className="pairing-code" aria-label={`Mã ghép nối ${code}`}>
              {formatPairingCode(code)}
            </div>
            <div
              className={`pairing-timer ${remainingSeconds === 0 ? 'pairing-timer--expired' : ''}`}
            >
              {remainingSeconds === 0 ? (
                'Mã đã hết hạn'
              ) : (
                <>
                  Mã còn hiệu lực <strong>{remaining}</strong>
                </>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px 0' }}>
            <Spinner />
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              Đang tạo mã ghép nối…
            </div>
          </div>
        )}

        <div className="pairing-steps">
          <ol>
            <li>
              Mở <strong>PRO POS → Cài đặt máy in → Thêm Print Agent</strong>
            </li>
            <li>Nhập mã 6 số đang hiển thị phía trên</li>
          </ol>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="text-button" onClick={onBackToPrinter}>
            <Icon name="arrow-left" size={14} /> Chỉnh sửa máy in
          </button>

          <Button
            kind="secondary"
            onClick={onStart}
            loading={action === 'pair'}
            icon={<Icon name="refresh" size={14} />}
          >
            Tạo mã mới
          </Button>
        </div>
      </div>
    </main>
  );
}

/** Daily Operational Dashboard */
function Dashboard({
  state,
  info,
  lastJob,
  action,
  onTest,
  onAutostart,
  onSettings,
  onLogs,
}: {
  state: AgentRuntimeState;
  info: DesktopAgentInfo;
  lastJob: DesktopPrintJobState | null;
  action: Action;
  onTest: () => void;
  onAutostart: (enabled: boolean) => void;
  onSettings: () => void;
  onLogs: () => void;
}) {
  const isWindows = info.config.connectionType === 'WINDOWS_PRINTER';
  const overall = presentOverallStatus(state);
  const cloud = presentCloudStatus(state, info.config.storeName);
  const printer = presentPrinterStatus(state, info.config);
  const friendlyError = presentFriendlyError(state);
  const errorDetails = presentPrinterErrorDetails(
    state.lastError,
    state.printerDiagnostics ?? undefined,
  );

  return (
    <main className="shell">
      <Header
        version={info.version}
        status={{
          label: state.status === 'ONLINE' ? 'Đang hoạt động' : overall.label,
          tone: overall.tone,
        }}
      />

      {/* Main minimal panel */}
      <div className="panel">
        {/* Section 1: Cloud Connection */}
        <div className="panel-row">
          <div>
            <div className="section-label">Kết nối PRO POS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot tone={cloud.tone} />
              <span className="section-value">{cloud.label}</span>
            </div>
            <div className="section-desc">{info.config.storeName || 'Cửa hàng PRO POS'}</div>
          </div>
        </div>

        <div className="panel-divider" />

        {/* Section 2: Physical Printer */}
        <div className="panel-row">
          <div>
            <div className="section-label">Máy in</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot tone={printer.tone} />
              <span className="section-value">{printer.label}</span>
            </div>
            <div className="section-desc">
              {isWindows
                ? `${info.config.printerName || 'Chưa chọn máy in'} · USB · Windows · ${info.config.paperSize}`
                : `${info.config.printerIp || '—'}:${info.config.printerPort} · LAN · ${info.config.paperSize}`}
            </div>
          </div>

          <Button
            kind="secondary"
            onClick={onTest}
            loading={action === 'test'}
            icon={<Icon name="printer" size={14} />}
          >
            In thử
          </Button>
        </div>

        {/* Error Notice if any */}
        {friendlyError && (
          <div className="notice notice--danger" style={{ marginTop: 10 }}>
            <div>
              <strong>{friendlyError}</strong>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button
                  kind="secondary"
                  onClick={onTest}
                  loading={action === 'test'}
                  style={{ fontSize: 11.5, padding: '4px 8px' }}
                >
                  Kiểm tra lại
                </Button>
                {errorDetails && (
                  <details>
                    <summary>Xem chi tiết</summary>
                    <code>{errorDetails}</code>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="panel-divider" />

        {/* Section 3: Last Job */}
        <div className="panel-row">
          <div>
            <div className="section-label">Lệnh in gần nhất</div>
            {lastJob ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {lastJob.status === 'COMPLETED' ? '✓ ' : '✕ '}
                  {lastJob.documentType === 'invoice'
                    ? 'Hóa đơn'
                    : lastJob.documentType === 'provisional'
                      ? 'Tạm tính'
                      : 'Lệnh in'}{' '}
                  #{lastJob.jobId}
                </div>
                <div className="section-desc">
                  {new Intl.DateTimeFormat('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }).format(lastJob.updatedAt)}{' '}
                  ·{' '}
                  {lastJob.status === 'COMPLETED'
                    ? 'Đã gửi thành công'
                    : lastJob.status === 'SENDING'
                      ? 'Đang gửi...'
                      : 'In thất bại'}
                </div>
              </div>
            ) : (
              <div className="section-desc">Chưa có lệnh in trong phiên này</div>
            )}
          </div>
        </div>

        <div className="panel-divider" />

        {/* Section 4: System Footer */}
        <div className="panel-row">
          <Toggle
            checked={info.autostart}
            disabled={action === 'autostart'}
            onChange={onAutostart}
            label={
              typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
                ? 'Khởi động cùng macOS'
                : 'Khởi động cùng Windows'
            }
          />

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="text-button" onClick={onLogs}>
              <Icon name="folder" size={14} /> Nhật ký
            </button>
            <button type="button" className="text-button" onClick={onSettings}>
              <Icon name="settings" size={14} /> Cài đặt
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Settings Dialog: Maximum 3 Clear Groups */
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
  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
  const [form, setForm] = useState<DesktopSettingsInput>({
    serverUrl: info.config.serverUrl,
    connectionType: info.config.connectionType || (isMac ? 'NETWORK_TCP' : 'WINDOWS_PRINTER'),
    printerName: info.config.printerName || '',
    printerIp: info.config.printerIp || '',
    printerPort: info.config.printerPort || 9100,
    paperSize: info.config.paperSize || 'K80',
    autoCut: info.config.autoCut ?? true,
    openCashDrawer: info.config.openCashDrawer ?? false,
    printableDots: info.config.printableDots,
  });

  const [printers, setPrinters] = useState<DesktopPrinterItem[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);

  const refreshPrinters = async () => {
    if (!window.proposPrintAgent?.listPrinters) return;
    setLoadingPrinters(true);
    try {
      const list = await window.proposPrintAgent.listPrinters();
      setPrinters(list);
      setForm((current) => {
        if (!current.printerName && list.length > 0) {
          const virtualPatterns = /pdf|xps|onenote|fax|document writer|root print queue/i;
          const candidate = list.find((p) => !virtualPatterns.test(p.name)) || list[0];
          if (candidate?.name) {
            return { ...current, printerName: candidate.name };
          }
        }
        return current;
      });
    } catch {
      setPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    if (!isMac) {
      void refreshPrinters();
    }
  }, [isMac]);

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
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-header">
          <h2 id="settings-title">Cài đặt Print Agent</h2>
          <button className="icon-button" onClick={onClose} aria-label="Đóng cài đặt">
            <Icon name="close" size={16} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div className="dialog-body">
            {/* Nhóm 1: Máy in */}
            <div className="settings-group">
              <div className="settings-group-title">1. Máy in</div>

              {!isMac && (
                <div className="connection-choice-grid">
                  <button
                    type="button"
                    className={`connection-choice-card ${form.connectionType === 'WINDOWS_PRINTER' ? 'connection-choice-card--active' : ''}`}
                    onClick={() => setForm({ ...form, connectionType: 'WINDOWS_PRINTER' })}
                  >
                    <strong>Máy in Windows (USB)</strong>
                    <span>Cắm trực tiếp</span>
                  </button>
                  <button
                    type="button"
                    className={`connection-choice-card ${form.connectionType === 'NETWORK_TCP' ? 'connection-choice-card--active' : ''}`}
                    onClick={() => setForm({ ...form, connectionType: 'NETWORK_TCP' })}
                  >
                    <strong>Mạng LAN</strong>
                    <span>Qua router/IP</span>
                  </button>
                </div>
              )}

              {form.connectionType === 'WINDOWS_PRINTER' && !isMac ? (
                <label className="field">
                  <span>Máy in trên Windows</span>
                  <div className="printer-select-row">
                    <select
                      value={form.printerName}
                      onChange={(event) => setForm({ ...form, printerName: event.target.value })}
                    >
                      {printers.length === 0 ? (
                        <option value="">(Chưa tìm thấy máy in)</option>
                      ) : (
                        <>
                          <option value="" disabled>
                            -- Chọn máy in --
                          </option>
                          {printers.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.displayName || p.name} {p.isDefault ? ' (Mặc định)' : ''}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                    <Button
                      type="button"
                      kind="secondary"
                      loading={loadingPrinters}
                      onClick={() => void refreshPrinters()}
                      title="Làm mới danh sách máy in"
                    >
                      <Icon name="refresh" size={14} />
                    </Button>
                  </div>
                </label>
              ) : (
                <div className="field-grid field-grid--wide-left">
                  <label className="field">
                    <span>Địa chỉ IP</span>
                    <input
                      required
                      value={form.printerIp}
                      onChange={(event) => setForm({ ...form, printerIp: event.target.value })}
                      placeholder="192.168.1.73"
                    />
                  </label>
                  <label className="field">
                    <span>Cổng</span>
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
                </div>
              )}

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

            {/* Nhóm 2: Tùy chọn nâng cao */}
            <div className="settings-group">
              <div className="settings-group-title">2. Tùy chọn nâng cao</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                <Toggle
                  checked={Boolean(form.autoCut)}
                  onChange={(checked) => setForm({ ...form, autoCut: checked })}
                  label="Tự động cắt giấy"
                />
                <Toggle
                  checked={Boolean(form.openCashDrawer)}
                  onChange={(checked) => setForm({ ...form, openCashDrawer: checked })}
                  label="Mở két tiền"
                />
              </div>

              <label className="field">
                <span>Vùng in (Printable dots - tùy chọn)</span>
                <input
                  type="number"
                  placeholder={form.paperSize === 'K58' ? '384' : '576'}
                  value={form.printableDots || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      printableDots: event.target.value ? Number(event.target.value) : undefined,
                    })
                  }
                />
              </label>
            </div>

            {/* Nhóm 3: Ứng dụng & Thiết lập lại */}
            <div className="settings-group">
              <div className="settings-group-title">3. Ứng dụng</div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <Toggle
                  checked={info.autostart}
                  disabled={action === 'autostart'}
                  onChange={onAutostart}
                  label={
                    typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
                      ? 'Khởi động cùng macOS'
                      : 'Khởi động cùng Windows'
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={onLogs}
                  disabled={action === 'logs'}
                >
                  <Icon name="folder" size={14} /> Mở thư mục nhật ký
                </button>
              </div>

              <div className="danger-box">
                <p>Thiết lập lại Print Agent:</p>
                <div className="danger-actions">
                  <Button
                    type="button"
                    kind="secondary"
                    onClick={() => onConfirm('repair')}
                    style={{ fontSize: 12 }}
                  >
                    Ghép nối lại
                  </Button>
                  <Button
                    type="button"
                    kind="danger"
                    onClick={() => onConfirm('reset')}
                    style={{ fontSize: 12 }}
                  >
                    Xóa cấu hình
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="dialog-footer">
            <Button type="button" kind="ghost" onClick={onClose}>
              Hủy
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
  const isReset = action === 'reset';
  return (
    <div className="overlay" role="presentation">
      <div className="dialog" style={{ width: 380 }} role="alertdialog">
        <div className="dialog-body" style={{ textAlign: 'center', padding: '24px 20px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
            {isReset ? 'Xác nhận xóa toàn bộ cấu hình?' : 'Xác nhận ghép nối lại?'}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
            {isReset
              ? 'Print Agent sẽ xóa toàn bộ cài đặt máy in, thông tin ghép nối và trở về trạng thái ban đầu.'
              : 'Print Agent sẽ hủy ghép nối với cửa hàng hiện tại và tạo mã ghép nối mới.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <Button type="button" kind="secondary" onClick={onCancel} disabled={loading}>
              Hủy
            </Button>
            <Button
              type="button"
              kind={isReset ? 'danger' : 'primary'}
              loading={loading}
              onClick={onConfirm}
            >
              {isReset ? 'Xóa cấu hình' : 'Ghép nối lại'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Root Desktop Application */
function App() {
  const [state, setState] = useState<AgentRuntimeState>(initialState);
  const [info, setInfo] = useState<DesktopAgentInfo | null>(null);
  const [lastJob, setLastJob] = useState<DesktopPrintJobState | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [step, setStep] = useState<'printer' | 'pairing'>('printer');
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (tone: ToastState['tone'], message: string, detail?: string) => {
    setToast({ tone, message, detail });
    window.setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    let unmounted = false;
    const api = window.proposPrintAgent;
    if (!api) return;

    api.getState().then((s) => !unmounted && setState(s));
    api.getInfo().then((i) => !unmounted && setInfo(i));
    api.getLastJob().then((j) => !unmounted && setLastJob(j));

    const unsubscribeState = api.onStateChanged((s) => !unmounted && setState(s));
    const unsubscribeJob = api.onJobChanged((j) => !unmounted && setLastJob(j));

    return () => {
      unmounted = true;
      unsubscribeState();
      unsubscribeJob();
    };
  }, []);

  const isPaired = Boolean(info?.config.agentId);

  const handleSaveAndTest = async (newSettings: DesktopSettingsInput): Promise<boolean> => {
    const api = window.proposPrintAgent;
    if (!api) return false;
    setAction('test');
    try {
      const result = await api.testPrinter(newSettings);
      if (result.ok) {
        if (info) {
          setInfo({
            ...info,
            config: {
              ...info.config,
              ...newSettings,
              printerName: newSettings.printerName || '',
              printerIp: newSettings.printerIp || '',
              printerPort: newSettings.printerPort || 9100,
            },
          });
        }
        showToast('success', 'In thử thành công!');
        return true;
      } else {
        showToast('danger', result.error || 'In thử thất bại.');
        return false;
      }
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'In thử thất bại.');
      return false;
    } finally {
      setAction(null);
    }
  };

  const handleTestPrint = async () => {
    const api = window.proposPrintAgent;
    if (!api) return;
    setAction('test');
    try {
      const result = await api.testPrinter();
      if (result.ok) {
        showToast('success', 'In thử thành công!');
      } else {
        showToast('danger', result.error || 'In thử thất bại.');
      }
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'In thử thất bại.');
    } finally {
      setAction(null);
    }
  };

  const handleStartPairing = async () => {
    const api = window.proposPrintAgent;
    if (!api) return;
    setAction('pair');
    try {
      await api.startPairing();
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'Không thể bắt đầu ghép nối.');
    } finally {
      setAction(null);
    }
  };

  const handleAutostart = async (enabled: boolean) => {
    const api = window.proposPrintAgent;
    if (!api || !info) return;
    setAction('autostart');
    try {
      const actual = await api.setAutostart(enabled);
      setInfo({ ...info, autostart: actual });
      showToast('info', actual ? 'Đã bật tự khởi động' : 'Đã tắt tự khởi động');
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'Thay đổi tự khởi động thất bại.');
    } finally {
      setAction(null);
    }
  };

  const handleSaveSettings = async (settings: DesktopSettingsInput) => {
    const api = window.proposPrintAgent;
    if (!api) return;
    setAction('save');
    try {
      await api.saveSettings(settings);
      setSettingsOpen(false);
      showToast('success', 'Đã lưu cài đặt và đang khởi động lại...');
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'Lưu cài đặt thất bại.');
      setAction(null);
    }
  };

  const handleOpenLogs = async () => {
    const api = window.proposPrintAgent;
    if (!api) return;
    setAction('logs');
    try {
      await api.openLogs();
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'Không thể mở thư mục nhật ký.');
    } finally {
      setAction(null);
    }
  };

  const handleConfirmAction = async () => {
    const api = window.proposPrintAgent;
    if (!api || !confirmAction) return;
    setAction('reset');
    try {
      if (confirmAction === 'reset') {
        await api.resetAll();
      } else {
        await api.resetPairing();
      }
    } catch (err: unknown) {
      showToast('danger', err instanceof Error ? err.message : 'Thao tác thất bại.');
      setAction(null);
      setConfirmAction(null);
    }
  };

  if (!info) {
    return (
      <div className="shell" style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  // Not Paired: First-Run Wizard
  if (!isPaired) {
    if (step === 'printer') {
      return (
        <>
          <PrinterSetupView
            info={info}
            state={state}
            action={action}
            onSaveAndTest={handleSaveAndTest}
            onProceedToPairing={() => {
              setStep('pairing');
              void handleStartPairing();
            }}
          />
          {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
        </>
      );
    }

    return (
      <>
        <PairingView
          state={state}
          version={info.version}
          action={action}
          onStart={handleStartPairing}
          onBackToPrinter={() => setStep('printer')}
        />
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  // Paired: Clean Daily Dashboard
  return (
    <>
      <Dashboard
        state={state}
        info={info}
        lastJob={lastJob}
        action={action}
        onTest={handleTestPrint}
        onAutostart={handleAutostart}
        onSettings={() => setSettingsOpen(true)}
        onLogs={handleOpenLogs}
      />

      {settingsOpen && (
        <SettingsDialog
          info={info}
          action={action}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          onAutostart={handleAutostart}
          onLogs={handleOpenLogs}
          onConfirm={(act) => setConfirmAction(act)}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          loading={action === 'reset'}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleConfirmAction}
        />
      )}

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
