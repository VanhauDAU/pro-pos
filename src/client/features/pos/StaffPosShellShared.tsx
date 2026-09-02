import {
  BellFilled,
  BellOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DownOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MessageOutlined,
  PhoneOutlined,
  QrcodeOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Modal,
  Skeleton,
  Spin,
  Tag,
  Tooltip,
} from 'antd';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import type { AuthContextResponse } from '@contracts/auth';
import type { PosStaffContext } from '@contracts/pos';
import type {
  GuestOrderRequestDto,
  ServiceRequestDto,
  StaffNotificationAuditResponse,
  StaffNotificationEventType,
  StaffNotificationStatus,
  TableOpenRequestDto,
} from '@contracts/qr-order';

import areaIcon from '@client/assets/navigation/nav-khu-vuc.webp';
import qrIcon from '@client/assets/navigation/nav-qr-order.webp';
import moreIcon from '@client/assets/navigation/nav-them.webp';
import { apiRequest } from '@client/lib/api';
import { playPosSound, warmPosSounds } from '@client/lib/sound';
import { usePosPollingInterval, useRealtime } from '@client/realtime/RealtimeProvider';

import { PosNotificationTracker } from './pos-notification-tracker';

const QrOrderConfirmModal = lazy(async () => {
  const module = await import('./QrOrderConfirmModal');
  return { default: module.QrOrderConfirmModal };
});

const BRAND = '#0975f7';
const logoBlack = '/pro-pos-logo-black.svg';
type StaffContext = PosStaffContext;

function notificationTypeLabel(type: StaffNotificationEventType) {
  const labels: Record<StaffNotificationEventType, string> = {
    QR_ORDER: 'QR Order gọi món',
    CALL_STAFF: 'Gọi nhân viên',
    CHECKOUT_REQUEST: 'Yêu cầu thanh toán',
    ORDER_CREATED: 'Đơn hàng mới được tạo',
    ITEM_ADDED: 'Thêm mặt hàng vào đơn',
    ITEM_UPDATED: 'Thay đổi mặt hàng trong đơn',
    ITEM_REMOVED: 'Xóa mặt hàng khỏi đơn',
    ORDER_SAVED: 'Lưu thay đổi đơn hàng',
    TABLE_TRANSFERRED: 'Thay đổi bàn của đơn',
    TIME_PAUSED: 'Tạm dừng tính giờ',
    TIME_RESUMED: 'Tiếp tục tính giờ',
    TIME_UPDATED: 'Điều chỉnh thời gian',
    CHECKOUT_PENDING: 'Chốt giờ chờ thanh toán',
    CHECKOUT: 'Hoàn tất thanh toán',
    ORDER_CANCELLED: 'Hủy đơn hàng',
  };
  return labels[type] || 'Hoạt động POS';
}

function notificationStatusMeta(status: StaffNotificationStatus) {
  const values: Record<StaffNotificationStatus, { label: string; color: string }> = {
    PENDING: { label: 'Chờ xác nhận', color: 'processing' },
    OPEN: { label: 'Chưa tiếp nhận', color: 'warning' },
    ACKNOWLEDGED: { label: 'Đã tiếp nhận', color: 'blue' },
    ACCEPTED: { label: 'Đã xác nhận', color: 'success' },
    REJECTED: { label: 'Đã từ chối', color: 'error' },
    COMPLETED: { label: 'Hoàn tất', color: 'success' },
    CANCELLED: { label: 'Đã hủy', color: 'default' },
    EXPIRED: { label: 'Hết hiệu lực', color: 'default' },
    INFO: { label: 'Hoạt động POS', color: 'magenta' },
  };
  return values[status];
}

function formatPreciseTime(timestamp: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${hours}:${minutes} ${day}/${month}/${year}`;
}

interface PosNotificationSummary {
  guestOrders: GuestOrderRequestDto[];
  serviceRequests: ServiceRequestDto[];
  tableOpenRequests: TableOpenRequestDto[];
  counts: {
    guestOrders: number;
    serviceRequests: number;
    tableOpenRequests: number;
  };
  serverNowMs: number;
}

interface PosNotificationsContextValue {
  data: PosNotificationSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  qrConfirmModalOpen: boolean;
  setQrConfirmModalOpen: (open: boolean) => void;
}

const PosNotificationsContext = createContext<PosNotificationsContextValue | null>(null);

function PosNotificationWatcher() {
  const navigate = useNavigate();
  const notifications = usePosNotifications();
  const trackerRef = useRef(new PosNotificationTracker());

  useEffect(() => {
    const data = notifications.data;
    if (!data) return;

    for (const event of trackerRef.current.observe(data)) {
      playPosSound(event.sound, { dedupeKey: event.dedupeKey });

      if (event.kind === 'GUEST_ORDER') {
        const req = event.request;
        // Automatically pop up the QR order confirmation modal
        notifications.setQrConfirmModalOpen(true);
        const itemCount =
          req.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || req.items?.length || 0;
        toast.info(
          `🔔 Yêu cầu gọi món - ${req.tableName}${req.customerName ? ` (${req.customerName})` : ''}`,
          {
            description: `${req.customerName ? `Khách: ${req.customerName} • ` : ''}${req.tableName} (${req.areaName}) vừa gửi yêu cầu gọi món (${itemCount} món)`,
            duration: 8000,
            action: {
              label: 'Xem ngay',
              onClick: () => {
                notifications.setQrConfirmModalOpen(true);
              },
            },
          },
        );
      } else if (event.kind === 'SERVICE_REQUEST') {
        const sr = event.request;
        if (sr.type === 'CALL_STAFF') {
          toast.warning(
            `🔔 Gọi nhân viên - ${sr.tableName}${sr.customerName ? ` (${sr.customerName})` : ''}`,
            {
              description: `${sr.customerName ? `Khách: ${sr.customerName} • ` : ''}${sr.tableName} (${sr.areaName}) đang gọi nhân viên hỗ trợ`,
              duration: 8000,
              action: {
                label: 'Xem ngay',
                onClick: () => navigate('/pos/qr-order'),
              },
            },
          );
        } else if (sr.type === 'CHECKOUT_REQUEST') {
          toast.info(
            `💳 Yêu cầu thanh toán - ${sr.tableName}${sr.customerName ? ` (${sr.customerName})` : ''}`,
            {
              description: `${sr.customerName ? `Khách: ${sr.customerName} • ` : ''}${sr.tableName} (${sr.areaName}) vừa yêu cầu thanh toán`,
              duration: 8000,
              action: {
                label: 'Xem ngay',
                onClick: () => navigate('/pos/qr-order'),
              },
            },
          );
        }
      } else {
        const tor = event.request;
        toast.info(
          `🪑 Yêu cầu mở bàn - ${tor.tableName}${tor.customerName ? ` (${tor.customerName})` : ''}`,
          {
            description: `${tor.customerName ? `Khách: ${tor.customerName} • ` : ''}Yêu cầu mở ${tor.tableName} (${tor.areaName})`,
            duration: 8000,
            action: {
              label: 'Xem ngay',
              onClick: () => navigate('/pos/qr-order'),
            },
          },
        );
      }
    }
  }, [notifications.data, navigate, notifications]);

  return null;
}

export function PosNotificationsProvider({ children }: { children: React.ReactNode }) {
  const pollingInterval = usePosPollingInterval(15_000);
  const { status: realtimeStatus } = useRealtime();
  const [qrConfirmModalOpen, setQrConfirmModalOpen] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const canHandleQr =
    context.data?.permissions?.includes('qr_order.handle') ||
    context.data?.permissions?.includes('order.manage');
  const summary = useQuery({
    queryKey: ['pos-notification-summary'],
    queryFn: ({ signal }) =>
      apiRequest<PosNotificationSummary>('/api/v1/pos/qr-orders/summary', { signal }),
    enabled: Boolean(canHandleQr && backgroundReady),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchInterval: pollingInterval,
  });
  const value = useMemo<PosNotificationsContextValue>(
    () => ({
      data: summary.data,
      isLoading: summary.isLoading,
      isError: summary.isError,
      isFetching: summary.isFetching,
      refetch: summary.refetch,
      qrConfirmModalOpen,
      setQrConfirmModalOpen,
    }),
    [
      summary.data,
      summary.isError,
      summary.isFetching,
      summary.isLoading,
      summary.refetch,
      qrConfirmModalOpen,
    ],
  );
  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(() => setBackgroundReady(true), { timeout: 2_000 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setBackgroundReady(true), 750);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (realtimeStatus !== 'CONNECTED') return undefined;
    const warm = () => warmPosSounds(['NEW_QR_ORDER', 'TABLE_OPEN_REQUEST', 'CHECKOUT_REQUEST']);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warm, { timeout: 5_000 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 1_000);
    return () => window.clearTimeout(id);
  }, [realtimeStatus]);
  return (
    <PosNotificationsContext.Provider value={value}>
      <PosNotificationWatcher />
      {qrConfirmModalOpen ? (
        <Suspense
          fallback={
            <Modal
              open
              title="Xác nhận gọi món"
              footer={null}
              centered
              onCancel={() => setQrConfirmModalOpen(false)}
            >
              <div style={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                <Spin tip="Đang tải danh sách gọi món..." />
              </div>
            </Modal>
          }
        >
          <QrOrderConfirmModal open onClose={() => setQrConfirmModalOpen(false)} />
        </Suspense>
      ) : null}
      {children}
    </PosNotificationsContext.Provider>
  );
}

export function usePosNotifications() {
  const value = useContext(PosNotificationsContext);
  if (!value) throw new Error('Missing PosNotificationsProvider');
  return value;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value));
}

function StaffUserMenuPopup({
  displayName,
  roleName,
  storeName,
  loggingOut,
  onClose,
  onLogout,
}: {
  displayName: string;
  roleName: string;
  storeName?: string | undefined;
  loggingOut: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const initial = displayName ? displayName.slice(0, 1).toUpperCase() : 'U';

  return (
    <div className="staff-user-menu-pop">
      {/* Header Profile Card */}
      <div className="staff-user-menu-pop__profile">
        <Avatar
          size={40}
          className="staff-user-menu-pop__avatar"
          style={{
            background: 'linear-gradient(135deg, #0975f7 0%, #0052cc 100%)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            boxShadow: '0 2px 8px rgba(9, 117, 247, 0.25)',
          }}
        >
          {initial}
        </Avatar>
        <div className="staff-user-menu-pop__info">
          <div className="staff-user-menu-pop__name" title={displayName}>
            {displayName}
          </div>
          <div className="staff-user-menu-pop__meta">
            <span className="staff-user-menu-pop__role">
              <span className="staff-user-menu-pop__role-dot" />
              <span>{roleName}</span>
            </span>
            {storeName ? (
              <span className="staff-user-menu-pop__store" title={storeName}>
                · {storeName}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="staff-user-menu-pop__divider" />

      {/* Support / Contact Section */}
      <div className="staff-user-menu-pop__section-title">Hỗ trợ kỹ thuật 24/7</div>

      <div className="staff-user-menu-pop__links">
        <a
          href="tel:0777464347"
          className="staff-user-menu-pop__link staff-user-menu-pop__link--phone"
          onClick={onClose}
        >
          <div className="staff-user-menu-pop__link-icon staff-user-menu-pop__link-icon--phone">
            <PhoneOutlined />
          </div>
          <div className="staff-user-menu-pop__link-content">
            <span className="staff-user-menu-pop__link-label">Gọi hỗ trợ trực tiếp</span>
            <strong className="staff-user-menu-pop__link-val">0777 464 347</strong>
          </div>
        </a>

        <a
          href="https://zalo.me/0816548150"
          target="_blank"
          rel="noopener noreferrer"
          className="staff-user-menu-pop__link staff-user-menu-pop__link--zalo"
          onClick={onClose}
        >
          <div className="staff-user-menu-pop__link-icon staff-user-menu-pop__link-icon--zalo">
            <MessageOutlined />
          </div>
          <div className="staff-user-menu-pop__link-content">
            <span className="staff-user-menu-pop__link-label">Nhắn tin qua Zalo</span>
            <strong className="staff-user-menu-pop__link-val">0816 548 150</strong>
          </div>
        </a>
      </div>

      <div className="staff-user-menu-pop__divider" />

      {/* Logout Action */}
      <button
        type="button"
        className="staff-user-menu-pop__logout"
        onClick={() => {
          onClose();
          onLogout();
        }}
        disabled={loggingOut}
      >
        <span className="staff-user-menu-pop__logout-icon">
          <LogoutOutlined />
        </span>
        <span className="staff-user-menu-pop__logout-text">
          {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
        </span>
      </button>
    </div>
  );
}

export function StaffHeader({
  context,
  searchSlot,
  onOpenNotifications,
}: {
  context: AuthContextResponse | undefined;
  searchSlot?: React.ReactNode;
  onOpenNotifications: () => void;
}) {
  const { status } = useRealtime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, holder] = Modal.useModal();
  const [loggingOut, setLoggingOut] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { data: notificationsData, setQrConfirmModalOpen } = usePosNotifications();
  const pendingQrCount =
    (notificationsData?.counts.guestOrders ?? 0) +
    (notificationsData?.counts.tableOpenRequests ?? 0);
  const showQrBell = pendingQrCount > 0;

  const pendingNotificationCount =
    (notificationsData?.counts.guestOrders ?? 0) +
    (notificationsData?.counts.serviceRequests ?? 0) +
    (notificationsData?.counts.tableOpenRequests ?? 0);

  const logout = () => {
    modal.confirm({
      title: 'Đăng xuất tài khoản',
      icon: <LogoutOutlined style={{ color: '#ff4d4f' }} />,
      content: 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống POS?',
      okText: 'Đăng xuất',
      okButtonProps: { danger: true, loading: loggingOut },
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          setLoggingOut(true);
          const csrfToken = context?.csrfToken;
          if (csrfToken) {
            await apiRequest('/api/v1/auth/logout', {
              method: 'POST',
              headers: { 'X-CSRF-Token': csrfToken },
            });
          }
          await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
          queryClient.clear();
          navigate('/?tab=employee', { replace: true });
        } catch {
          await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
          queryClient.clear();
          navigate('/?tab=employee', { replace: true });
        } finally {
          setLoggingOut(false);
        }
      },
    });
  };

  return (
    <header className="staff-pos-header">
      {holder}
      <div className="staff-pos-header__left">
        <div className="staff-pos-brand" title="Pro POS">
          <img src={logoBlack} alt="Pro POS" className="staff-pos-brand__logo" />
        </div>
        {searchSlot ? <div className="staff-pos-header__search">{searchSlot}</div> : null}
      </div>
      <Tooltip
        title={
          status === 'CONNECTED'
            ? 'Đồng bộ trực tiếp (Realtime)'
            : status === 'DISABLED'
              ? 'Cập nhật định kỳ'
              : 'Đang kết nối lại...'
        }
      >
        <div
          className={`staff-pos-sync-badge staff-pos-sync-badge--${status.toLowerCase()}`}
          aria-label="Trạng thái kết nối"
          role="status"
          aria-live="polite"
        >
          <span className="staff-pos-sync-dot" />
          <span className="staff-pos-sync-label">
            {status === 'CONNECTED'
              ? 'Trực tiếp'
              : status === 'DISABLED'
                ? 'Định kỳ'
                : 'Kết nối lại'}
          </span>
        </div>
      </Tooltip>
      {showQrBell ? (
        <button
          type="button"
          className={`pos-qr-bell-btn pos-qr-bell-btn--header ${pendingQrCount > 0 ? 'pos-qr-bell-btn--shake' : ''}`}
          onClick={() => setQrConfirmModalOpen(true)}
          title="Xác nhận gọi món qua QR"
        >
          <span className="pos-qr-bell-btn__icon">
            <BellFilled />
          </span>
          <span className="pos-qr-bell-btn__text">Gọi món qua QR</span>
          {pendingQrCount > 0 ? (
            <span className="pos-qr-bell-btn__badge">{pendingQrCount}</span>
          ) : null}
        </button>
      ) : null}
      <Tooltip title="Trung tâm thông báo">
        <Button
          type="text"
          className="staff-header-notification-btn"
          icon={<BellOutlined />}
          aria-label={
            pendingNotificationCount > 0
              ? `Thông báo, ${pendingNotificationCount} yêu cầu chưa xử lý`
              : 'Thông báo'
          }
          onClick={onOpenNotifications}
        >
          {pendingNotificationCount > 0 ? (
            <b className="staff-header-notification-badge">
              {pendingNotificationCount > 99 ? '99+' : pendingNotificationCount}
            </b>
          ) : null}
        </Button>
      </Tooltip>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        arrow={{ pointAtCenter: true }}
        open={userMenuOpen}
        onOpenChange={setUserMenuOpen}
        dropdownRender={() => (
          <StaffUserMenuPopup
            displayName={context?.actor?.displayName ?? 'Nhân viên'}
            roleName={context?.actor?.kind === 'EMPLOYEE' ? 'Nhân viên' : 'Quản trị viên'}
            storeName={context?.device?.storeName}
            loggingOut={loggingOut}
            onClose={() => setUserMenuOpen(false)}
            onLogout={logout}
          />
        )}
      >
        <Button
          type="text"
          className="staff-pos-account-button"
          loading={loggingOut}
          aria-label="Tài khoản nhân viên"
        >
          <Avatar style={{ background: '#d9ecff', color: BRAND, fontWeight: 700 }}>
            {context?.actor?.displayName
              ? context.actor.displayName.slice(0, 1).toUpperCase()
              : 'U'}
          </Avatar>
          <div className="staff-pos-account__copy">
            <strong>{context?.actor?.displayName ?? 'Nhân viên'}</strong>
            <small>{context?.actor?.kind === 'EMPLOYEE' ? 'Nhân viên' : 'Quản trị viên'}</small>
          </div>
          <DownOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />
        </Button>
      </Dropdown>
    </header>
  );
}

const navItems = [
  { key: 'areas', label: 'Khu vực', icon: areaIcon, path: '/pos/areas' },
  { key: 'qr', label: 'QR Order', icon: qrIcon, path: '/pos/qr-order' },
  { key: 'more', label: 'Thêm', icon: moreIcon, path: '/pos/more' },
] as const;

export function StaffBottomNav({ active }: { active: (typeof navItems)[number]['key'] }) {
  const navigate = useNavigate();
  const notifications = usePosNotifications();
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const canHandleQr =
    context.data?.permissions?.includes('qr_order.handle') ||
    context.data?.permissions?.includes('order.manage');
  const visibleNavItems = navItems.filter((item) => item.key !== 'qr' || canHandleQr);
  const pendingNotificationCount =
    (notifications.data?.counts.guestOrders ?? 0) +
    (notifications.data?.counts.serviceRequests ?? 0) +
    (notifications.data?.counts.tableOpenRequests ?? 0);
  return (
    <nav className="staff-pos-bottom-nav" aria-label="Điều hướng POS nhân viên">
      {visibleNavItems.map((item) => (
        <button
          key={item.key}
          type="button"
          data-nav-key={item.key}
          className={active === item.key ? 'is-active' : ''}
          aria-label={
            item.key === 'qr' && pendingNotificationCount > 0
              ? `${item.label}, ${pendingNotificationCount} yêu cầu chưa xử lý`
              : item.label
          }
          onClick={() => navigate(item.path)}
        >
          <span className="staff-pos-nav-icon">
            <img
              src={item.icon}
              alt=""
              width={26}
              height={26}
              className="staff-pos-nav-img"
              draggable={false}
              aria-hidden="true"
            />
            {item.key === 'qr' && pendingNotificationCount > 0 ? (
              <b className="staff-pos-nav-badge">
                {pendingNotificationCount > 99 ? '99+' : pendingNotificationCount}
              </b>
            ) : null}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function StaffNotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const pollingInterval = usePosPollingInterval(30_000);
  const notificationAudit = useQuery({
    queryKey: ['staff-notification-audit'],
    queryFn: () =>
      apiRequest<StaffNotificationAuditResponse>('/api/v1/pos/qr-orders/audit?limit=50'),
    enabled: open,
    refetchInterval: open ? pollingInterval : false,
  });
  const retentionDays = notificationAudit.data?.retentionDays ?? 3;

  return (
    <Drawer
      title={
        <div className="staff-notification-audit-title">
          <HistoryOutlined />
          <div>
            <strong>Thông báo</strong>
            <span>
              Lưu tối đa {retentionDays} ngày · {notificationAudit.data?.items.length ?? 0}/50 sự
              kiện gần nhất
            </span>
          </div>
        </div>
      }
      placement="right"
      size={520}
      open={open}
      onClose={onClose}
      className="staff-notification-audit-drawer"
    >
      {notificationAudit.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : notificationAudit.isError ? (
        <Alert
          type="error"
          showIcon
          title="Chưa tải được nhật ký"
          action={<Button onClick={() => void notificationAudit.refetch()}>Thử lại</Button>}
        />
      ) : (notificationAudit.data?.items.length ?? 0) === 0 ? (
        <Empty description={`Chưa có thông báo nào trong ${retentionDays} ngày gần đây`} />
      ) : (
        <div className="staff-notification-audit-list">
          {(notificationAudit.data?.items ?? []).map((event) => {
            const status = notificationStatusMeta(event.status);
            return (
              <article
                key={event.id}
                className="staff-notification-audit-item"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onClose();
                  navigate('/pos/qr-order');
                }}
              >
                <div
                  className={`staff-notification-audit-icon is-${event.eventType.toLowerCase()}`}
                >
                  {event.eventType === 'QR_ORDER' ? (
                    <QrcodeOutlined />
                  ) : event.eventType === 'CALL_STAFF' ? (
                    <BellOutlined />
                  ) : event.eventType === 'CHECKOUT_PENDING' ? (
                    <ClockCircleOutlined />
                  ) : event.eventType === 'CHECKOUT_REQUEST' || event.eventType === 'CHECKOUT' ? (
                    <CreditCardOutlined />
                  ) : (
                    <FileTextOutlined />
                  )}
                </div>
                <div className="staff-notification-audit-body">
                  <div className="staff-notification-audit-row">
                    <strong>{notificationTypeLabel(event.eventType)}</strong>
                    <Tag color={status.color}>{status.label}</Tag>
                  </div>
                  <b>
                    {event.tableName} · {event.areaName}
                  </b>
                  <p>{event.summary}</p>
                  {event.note ? <small className="is-note">Ghi chú: {event.note}</small> : null}
                  <div className="staff-notification-audit-meta">
                    <span>{formatDateTime(event.createdAt)}</span>
                    {event.itemCount > 0 ? <span>{event.itemCount} món</span> : null}
                    {event.totalVnd > 0 ? <span>{formatMoney(event.totalVnd)}</span> : null}
                  </div>
                  {event.actorName ? (
                    <small>
                      {status.label} bởi <b>{event.actorName}</b>
                      {event.deviceName ? ` · ${event.deviceName}` : ''}
                      {event.handledAt ? ` lúc ${formatPreciseTime(event.handledAt)}` : ''}
                    </small>
                  ) : null}
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, marginTop: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      navigate('/pos/qr-order');
                    }}
                  >
                    Mở tab QR Order →
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
