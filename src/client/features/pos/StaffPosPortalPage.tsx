import {
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloseCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  HistoryOutlined,
  LeftOutlined,
  LogoutOutlined,
  MessageOutlined,
  MinusOutlined,
  PauseCircleOutlined,
  PhoneOutlined,
  PlayCircleOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  QrcodeOutlined,
  RightOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  SwapOutlined,
  SyncOutlined,
  TagsOutlined,
  UnorderedListOutlined,
  UnlockOutlined,
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Result,
  Segmented,
  Select,
  Skeleton,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import QRCode from 'qrcode';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  GuestOrderRequestDto,
  ServiceRequestDto,
  StaffNotificationAuditResponse,
  StaffNotificationEventType,
  StaffNotificationStatus,
  TableOpenRequestDto,
} from '@contracts/qr-order';
import type { StorePrintSettings } from '@contracts/store';
import type { PricingConfigSnapshot } from '@domain/pricing/types';
import {
  buildPrintDataFromInvoice,
  buildPrintDataFromQuote,
  printReceipt,
} from '@client/lib/pos-receipt-printer';
import { OrderDetailPage } from './OrderDetailPage';
import { StaffOnboarding } from './StaffOnboarding';
import { StaffPrinterSettingsPage } from './StaffPrinterSettingsPage';
import { PosCustomerSelector } from './PosCustomerSelector';
import { ReceiptPreviewModal, ReceiptPreviewPaper } from './ReceiptPreviewModal';
import { TableQrModal } from '@client/components/TableQrModal';
import type { CustomerSummary } from '@contracts/customer';
import { PushNotificationControl } from '@client/features/pwa/PushNotificationControl';
import { OwnerInvoicesPage } from '@client/features/owner/OwnerInvoicesPage';
import {
  OwnerCategoryDetailPage,
  OwnerCategoryListPage,
  OwnerProductFormPage,
  OwnerProductListPage,
} from '@client/features/owner/OwnerCatalogPages';

import { apiRequest, jsonRequest } from '@client/lib/api';
import { playPosSound } from '@client/lib/sound';
import {
  RealtimeProvider,
  usePosPollingInterval,
  useRealtime,
} from '@client/realtime/RealtimeProvider';

const BRAND = '#0975f7';

interface StaffContext {
  storeId: string;
  storeName: string;
  employeeId: string;
  employeeName: string;
  storePhone?: string | null;
  storeAddress?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  permissions?: string[];
  capabilities?: { posRealtime: boolean };
}

interface PosOrder {
  id: string;
  displayCode: string | null;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  status: 'OPEN' | 'PAYMENT_PENDING';
  version: number;
  openedAt: number;
  tableId: string | null;
  tableName: string | null;
  areaId: string | null;
  areaName: string | null;
  itemCount: number;
  totalVnd: number;
}

interface PosTable {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  version: number;
  areaId: string;
  areaName: string;
  areaSortOrder: number;
  sortOrder: number;
  timeProductId?: string | null;
  timeProductName?: string | null;
  defaultPriceVnd?: number | null;
  defaultDurationSeconds?: number | null;
  activeOrderId: string | null;
  occupiedSince: number | null;
}

interface CatalogVariant {
  id: string;
  name: string;
  salePriceVnd: number | null;
  promptPrice: 0 | 1;
}

interface CatalogProduct {
  productId: string;
  productName: string;
  productType: 'QUANTITY' | 'WEIGHT';
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitName: string | null;
  variants: CatalogVariant[];
}

interface OrderQuote {
  order: {
    id: string;
    displayCode: string | null;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    tableId: string | null;
    tableName: string | null;
    areaName: string | null;
    version: number;
    openedAt: number;
    openedByName?: string | null;
    status: 'OPEN' | 'PAYMENT_PENDING';
    note: string | null;
    guestCount?: number;
    customerName?: string | null;
    customerPhone?: string | null;
    customerId?: string | null;
  };
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    productType: 'QUANTITY' | 'WEIGHT';
    productName: string;
    variantName: string | null;
    unitName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    note: string | null;
    discountType: 'FIXED' | 'PERCENT' | null;
    discountInputValue: number | null;
    grossLineTotalVnd: number;
    discountAmountVnd: number;
    netLineTotalVnd: number;
  }>;
  time: null | {
    status: 'RUNNING' | 'PAUSED' | 'ENDED';
    startedAtMs: number;
    endedAtMs: number | null;
    elapsedSeconds: number;
    amountBeforeRoundingVnd: number;
    amountAfterRoundingVnd: number;
    segments: Array<{
      type: 'FIRST_PERIOD' | 'SPECIAL' | 'BASE';
      name: string;
      startedAtMs: number;
      endedAtMs: number;
      elapsedSeconds: number;
      priceVnd: number;
      durationSeconds: number;
      amountBeforeRoundingVnd: number;
    }>;
    pricingConfig: PricingConfigSnapshot;
    tableSegments?: Array<{
      tableId: string;
      tableName: string;
      startedAtMs: number;
      endedAtMs: number | null;
      elapsedSeconds: number;
      amountBeforeRoundingVnd: number;
      amountAfterRoundingVnd: number;
      pricingConfig: PricingConfigSnapshot;
    }>;
  };
  subtotalVnd: number;
  discountTotalVnd: number;
  totalVnd: number;
  bankSettings?: {
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
  } | null;
}

interface DraftLine {
  id: string;
  product: CatalogProduct;
  variant: CatalogVariant;
  quantityMilli: number;
  note: string | null;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
}

interface EditingOrderItem {
  source: 'DRAFT' | 'SAVED';
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT';
  productName: string;
  variantName: string | null;
  unitName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  note: string;
  grossLineTotalVnd: number;
  discountAmountVnd: number;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  netLineTotalVnd: number;
  discardOnCancel?: boolean | undefined;
}

interface InvoiceDetail {
  invoice: {
    id: string;
    orderId: string;
    displayCode: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    status: 'COMPLETED' | 'CANCELLED';
    issuedAt: number;
    snapshotJson: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
  };
  lines: Array<{
    id: string;
    lineType: 'PRODUCT' | 'TIME';
    description: string;
    quantityMilli: number;
    unitPrice: number;
    discountAmount: number;
    lineTotal: number;
    grossLineTotal: number;
    snapshotJson: string;
  }>;
  payment: {
    id: string;
    method: 'CASH' | 'BANK_TRANSFER';
    amount: number;
    cashReceived: number | null;
    cashChange: number | null;
    status: 'SUCCEEDED' | 'FAILED';
    createdAt: number;
  };
  allocations: Array<{
    id: string;
    method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
    amountVnd: number;
    tenderedVnd: number | null;
    createdAt: number;
  }>;
  snapshot: Record<string, unknown> | null;
}

function calculateLineTotal(unitPriceVnd: number, quantityMilli: number) {
  return Math.round((unitPriceVnd * quantityMilli) / 1000);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

function calculateDiscountAmount(
  grossLineTotalVnd: number,
  type: 'FIXED' | 'PERCENT' | null | undefined,
  inputValue: number | null,
) {
  if (!type || inputValue === null) return 0;
  const amount =
    type === 'PERCENT' ? Math.floor((grossLineTotalVnd * inputValue + 50) / 100) : inputValue;
  return Math.min(grossLineTotalVnd, amount);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function getWeightUnit(unitName: string | null | undefined): string {
  if (!unitName) return 'kg';
  const lower = unitName.trim().toLowerCase();
  if (['kg', 'g', 'lạng', 'gram', 'kilogram', 'kg.'].includes(lower)) {
    return unitName.trim();
  }
  return 'kg';
}

function getProductInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const p0 = parts[0];
  const p1 = parts[1];
  if (p0 && p1) {
    return (p0.slice(0, 1) + p1.slice(0, 1)).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

function formatItemQuantity(
  productType: 'QUANTITY' | 'WEIGHT',
  quantityMilli: number,
  unitName: string | null,
) {
  const value = formatDecimal(quantityMilli / 1000);
  if (productType === 'WEIGHT') {
    return `${value} ${getWeightUnit(unitName)}`;
  }
  return `${value}x`;
}

function formatMinuteOfDay(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function formatWeekdays(mask: number) {
  if (mask === 127) return 'Tất cả các ngày';
  const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  return labels.filter((_, index) => (mask & (1 << index)) !== 0).join(', ');
}

function formatPriceRate(priceVnd: number, durationSeconds: number) {
  const duration = durationSeconds === 3600 ? 'giờ' : formatElapsed(durationSeconds);
  return `${formatMoney(priceVnd)}/${duration}`;
}

function formatDuration(openedAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : `${minutes} phút`;
}

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatRequestAge(createdAt: number, now: number) {
  return formatElapsed(Math.max(0, Math.floor((now - createdAt) / 1000)));
}

function requestUrgency(createdAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds >= 300)
    return { className: 'is-critical', color: 'error' as const, label: 'Quá 5 phút' };
  if (seconds >= 120)
    return { className: 'is-warning', color: 'warning' as const, label: 'Cần xử lý' };
  return { className: 'is-fresh', color: 'processing' as const, label: 'Mới nhận' };
}

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

function useServerNow(serverTimeOffsetMs: number) {
  const [now, setNow] = useState(() => Date.now() + serverTimeOffsetMs);
  useEffect(() => {
    const update = () => setNow(Date.now() + serverTimeOffsetMs);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [serverTimeOffsetMs]);
  return now;
}

function formatDurationVietnamese(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '0 giây';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  if (s > 0 || parts.length === 0) parts.push(`${s} giây`);
  return parts.join(' ');
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

function formatDateTimeInput(timestamp: number) {
  const date = new Date(timestamp);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ];
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];
  return `${parts.join('-')}T${time.join(':')}`;
}

function errorText(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
}

function mutationHeaders(csrfToken: string) {
  return { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': crypto.randomUUID() };
}

function paymentReturnKey(orderId: string) {
  return `pos-payment-return:${orderId}`;
}

interface PaymentReturnMarker {
  enteredAt: number;
  pendingVersion: number | null;
  returnArmed: boolean;
}

// Module state is intentionally scoped to one browser tab/runtime. Persisted
// storage can be copied when a tab is duplicated and must not grant another tab
// permission to resume an order it did not leave from checkout.
const activePaymentReturns = new Map<string, PaymentReturnMarker>();

function markPaymentNavigationStarted(orderId: string) {
  activePaymentReturns.set(paymentReturnKey(orderId), {
    enteredAt: Date.now(),
    pendingVersion: null,
    returnArmed: false,
  });
}

function armPaymentReturn(orderId: string, pendingVersion: number | null = null) {
  const key = paymentReturnKey(orderId);
  const current = activePaymentReturns.get(key);
  activePaymentReturns.set(paymentReturnKey(orderId), {
    enteredAt: current?.enteredAt ?? Date.now(),
    pendingVersion,
    returnArmed: true,
  });
}

function clearPaymentPageActive(orderId: string) {
  activePaymentReturns.delete(paymentReturnKey(orderId));
}

function isReturningFromPayment(orderId: string, pendingVersion: number) {
  const marker = activePaymentReturns.get(paymentReturnKey(orderId));
  if (!marker?.returnArmed) return false;
  if (marker.pendingVersion !== null) {
    return marker.pendingVersion === pendingVersion;
  }
  return Date.now() - marker.enteredAt < 120_000;
}

function StaffHeader({
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
  const pollingInterval = usePosPollingInterval(15_000);
  const guestRequests = useQuery({
    queryKey: ['guest-order-requests'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/pos/qr-orders?status=PENDING'),
    refetchInterval: pollingInterval,
  });
  const serviceRequests = useQuery({
    queryKey: ['service-requests'],
    queryFn: () => apiRequest<ServiceRequestDto[]>('/api/v1/pos/qr-orders/service-requests/list'),
    refetchInterval: pollingInterval,
  });
  const tableOpenRequests = useQuery({
    queryKey: ['table-open-requests'],
    queryFn: () =>
      apiRequest<TableOpenRequestDto[]>('/api/v1/pos/qr-orders/table-open-requests/list'),
    refetchInterval: pollingInterval,
  });
  const pendingNotificationCount =
    (guestRequests.data?.length ?? 0) +
    (serviceRequests.data?.filter((request) => request.status === 'OPEN').length ?? 0) +
    (tableOpenRequests.data?.length ?? 0);

  const logout = () => {
    modal.confirm({
      title: 'Xác nhận đăng xuất',
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

  const menuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 700 }}>{context?.actor?.displayName ?? 'Nhân viên'}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
            {context?.actor?.kind === 'EMPLOYEE' ? 'Nhân viên' : 'Quản trị viên'}
          </div>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider',
    },
    {
      key: 'help-phone',
      icon: <PhoneOutlined style={{ color: '#10b981' }} />,
      label: (
        <a href="tel:0777464347">
          Gọi hỗ trợ: <strong>0777 464 347</strong>
        </a>
      ),
    },
    {
      key: 'help-zalo',
      icon: <MessageOutlined style={{ color: '#0975F7' }} />,
      label: (
        <a href="https://zalo.me/0816548150" target="_blank" rel="noopener noreferrer">
          Chat Zalo: <strong>0816 548 150</strong>
        </a>
      ),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Đăng xuất',
      danger: true,
      onClick: logout,
    },
  ];

  return (
    <header className="staff-pos-header">
      {holder}
      <div className="staff-pos-header__left">
        <div className="staff-pos-brand">
          <span className="staff-pos-brand__mark">P</span>
          <strong>Pro POS</strong>
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
      <Tooltip title="Mở trung tâm thông báo 3 ngày gần nhất">
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
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="bottomRight"
        arrow={{ pointAtCenter: true }}
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
            <small>Nhân viên</small>
          </div>
          <DownOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />
        </Button>
      </Dropdown>
    </header>
  );
}

const navItems = [
  { key: 'orders', label: 'Đơn hàng', icon: <UnorderedListOutlined />, path: '/pos' },
  { key: 'areas', label: 'Khu vực', icon: <AppstoreOutlined />, path: '/pos/areas' },
  { key: 'qr', label: 'QR Order', icon: <QrcodeOutlined />, path: '/pos/qr-order' },
  { key: 'more', label: 'Thêm', icon: <ShopOutlined />, path: '/pos/more' },
] as const;

function StaffBottomNav({ active }: { active: (typeof navItems)[number]['key'] }) {
  const navigate = useNavigate();
  const pollingInterval = usePosPollingInterval(15_000);
  const guestRequests = useQuery({
    queryKey: ['guest-order-requests'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/pos/qr-orders?status=PENDING'),
    refetchInterval: pollingInterval,
  });
  const serviceRequests = useQuery({
    queryKey: ['service-requests'],
    queryFn: () => apiRequest<ServiceRequestDto[]>('/api/v1/pos/qr-orders/service-requests/list'),
    refetchInterval: pollingInterval,
  });
  const tableOpenRequests = useQuery({
    queryKey: ['table-open-requests'],
    queryFn: () =>
      apiRequest<TableOpenRequestDto[]>('/api/v1/pos/qr-orders/table-open-requests/list'),
    refetchInterval: pollingInterval,
  });
  const pendingNotificationCount =
    (guestRequests.data?.length ?? 0) +
    (serviceRequests.data?.filter((request) => request.status === 'OPEN').length ?? 0) +
    (tableOpenRequests.data?.length ?? 0);
  return (
    <nav className="staff-pos-bottom-nav" aria-label="Điều hướng POS nhân viên">
      {navItems.map((item) => (
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
            {item.icon}
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

function OrdersPage({ search }: { search: string }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY'>('ALL');
  const pollingInterval = usePosPollingInterval(30_000);
  const orders = useQuery({
    queryKey: ['pos-orders'],
    queryFn: () => apiRequest<PosOrder[]>('/api/v1/pos/orders'),
    refetchInterval: pollingInterval,
  });
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi-VN');
    return (orders.data ?? []).filter((order) => {
      const matchesType = filter === 'ALL' || order.orderType === filter;
      const label = `${order.displayCode ?? ''} ${order.areaName ?? ''} ${order.tableName ?? ''}`;
      return matchesType && label.toLocaleLowerCase('vi-VN').includes(term);
    });
  }, [filter, orders.data, search]);
  const counts = {
    ALL: orders.data?.length ?? 0,
    DINE_IN: orders.data?.filter((order) => order.orderType === 'DINE_IN').length ?? 0,
    TAKEAWAY: orders.data?.filter((order) => order.orderType === 'TAKEAWAY').length ?? 0,
  };

  return (
    <div className="staff-orders-page">
      <div className="staff-orders-layout">
        <aside className="staff-order-filters">
          {(
            [
              ['ALL', 'Tất cả', <AppstoreOutlined key="all" />],
              ['DINE_IN', 'Tại chỗ', <ShopOutlined key="dine" />],
              ['TAKEAWAY', 'Mang đi', <ShoppingCartOutlined key="take" />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? 'is-active' : ''}
              onClick={() => setFilter(key)}
            >
              {icon}
              <span>{label}</span>
              {counts[key] > 0 ? <b>{counts[key]}</b> : null}
            </button>
          ))}
        </aside>
        <main className="staff-order-results">
          <div className="staff-mobile-segmented">
            <Segmented
              block
              value={filter}
              options={[
                { value: 'ALL', label: counts.ALL > 0 ? `Tất cả (${counts.ALL})` : 'Tất cả' },
                {
                  value: 'DINE_IN',
                  label: counts.DINE_IN > 0 ? `Tại chỗ (${counts.DINE_IN})` : 'Tại chỗ',
                },
                {
                  value: 'TAKEAWAY',
                  label: counts.TAKEAWAY > 0 ? `Mang đi (${counts.TAKEAWAY})` : 'Mang đi',
                },
              ]}
              onChange={(value) => setFilter(value as typeof filter)}
            />
          </div>
          {orders.isLoading ? (
            <div className="staff-order-grid">
              <Skeleton active />
              <Skeleton active />
            </div>
          ) : orders.isError ? (
            <Alert type="error" showIcon title="Chưa tải được danh sách đơn" />
          ) : filtered.length === 0 ? (
            <Empty description="Chưa có đơn hàng đang mở" />
          ) : (
            <div className="staff-order-grid">
              {filtered.map((order) => (
                <button
                  type="button"
                  className="staff-order-card"
                  key={order.id}
                  onClick={() => navigate(`/pos/orders/${order.id}`)}
                >
                  <div className="staff-order-card__title">
                    {order.orderType === 'DINE_IN' ? <ShopOutlined /> : <ShoppingCartOutlined />}
                    <strong>
                      {order.orderType === 'DINE_IN'
                        ? [order.areaName, order.tableName].filter(Boolean).join(' - ')
                        : order.displayCode}
                    </strong>
                  </div>
                  <div className="staff-order-card__meta">
                    <ClockCircleOutlined /> {formatDuration(order.openedAt)}
                    <span>SL: {order.itemCount}</span>
                  </div>
                  <b className="staff-order-card__total">{formatMoney(order.totalVnd)}</b>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
      <Button
        type="primary"
        size="large"
        icon={<PlusOutlined />}
        className="staff-create-order-button"
        onClick={() => {
          if (filter === 'TAKEAWAY') {
            navigate('/pos/orders/new?type=TAKEAWAY');
          } else {
            navigate('/pos/orders/new');
          }
        }}
      >
        Tạo đơn mới
      </Button>
    </div>
  );
}

function AreasPage() {
  const navigate = useNavigate();
  const pollingInterval = usePosPollingInterval(20_000);
  const tables = useQuery({
    queryKey: ['pos-tables'],
    queryFn: () => apiRequest<PosTable[]>('/api/v1/pos/tables'),
    refetchInterval: pollingInterval,
  });
  const areas = useMemo(() => {
    const map = new Map<string, { id: string; name: string; tables: PosTable[] }>();
    for (const table of tables.data ?? []) {
      const area = map.get(table.areaId) ?? { id: table.areaId, name: table.areaName, tables: [] };
      area.tables.push(table);
      map.set(table.areaId, area);
    }
    return [...map.values()];
  }, [tables.data]);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [status, setStatus] = useState<'ALL' | 'OCCUPIED' | 'AVAILABLE'>('ALL');
  const area = areas.find((item) => item.id === selectedArea) ?? areas[0];
  const visibleTables =
    area?.tables.filter((table) => status === 'ALL' || table.status === status) ?? [];
  const available = area?.tables.filter((table) => table.status === 'AVAILABLE').length ?? 0;

  return (
    <div className="staff-areas-page">
      {tables.isLoading ? <Spin fullscreen description="Đang tải khu vực" /> : null}
      {tables.isError ? <Alert type="error" showIcon title="Chưa tải được khu vực và bàn" /> : null}
      <aside className="staff-area-list">
        {areas.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === area?.id ? 'is-active' : ''}
            onClick={() => setSelectedArea(item.id)}
          >
            {item.name}
          </button>
        ))}
      </aside>
      <main className="staff-area-content">
        <Segmented
          size="large"
          value={status}
          options={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'OCCUPIED', label: 'Có khách' },
            { value: 'AVAILABLE', label: 'Trống' },
          ]}
          onChange={(value) => setStatus(value as typeof status)}
        />
        <Typography.Title level={4} className="staff-area-summary">
          Bàn trống: {available}/{area?.tables.length ?? 0}
        </Typography.Title>
        {visibleTables.length === 0 ? (
          <Empty description="Khu vực chưa có bàn phù hợp" />
        ) : (
          <div className="staff-table-grid">
            {visibleTables.map((table) => (
              <button
                type="button"
                key={table.id}
                disabled={table.status === 'DISABLED'}
                className={`staff-table-card staff-table-card--${table.status.toLocaleLowerCase()}`}
                onClick={() => {
                  if (table.activeOrderId) navigate(`/pos/orders/${table.activeOrderId}`);
                  else navigate(`/pos/orders/new?tableId=${table.id}`);
                }}
              >
                <strong>{table.name}</strong>
                {table.status === 'DISABLED' ? (
                  <span>Tạm ngưng phục vụ</span>
                ) : table.occupiedSince ? (
                  <span>
                    <ClockCircleOutlined /> {formatDuration(table.occupiedSince)}
                  </span>
                ) : (
                  <span>Trống · Chạm để tạo đơn</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="staff-table-legend">
          <span>
            <i className="is-available" /> Trống
          </span>
          <span>
            <i className="is-occupied" /> Bàn có khách
          </span>
          <span>
            <i className="is-disabled" /> Tạm ngưng
          </span>
        </div>
      </main>
    </div>
  );
}

function StaffNotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const pollingInterval = usePosPollingInterval(30_000);
  const notificationAudit = useQuery({
    queryKey: ['staff-notification-audit'],
    queryFn: () =>
      apiRequest<StaffNotificationAuditResponse>('/api/v1/pos/qr-orders/audit?limit=50'),
    refetchInterval: pollingInterval,
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
              <article key={event.id} className="staff-notification-audit-item">
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
                    onClick={() => {
                      onClose();
                      navigate(`/pos/orders/${event.orderId}`);
                    }}
                  >
                    Mở đơn liên quan
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

function QrOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const realtime = useRealtime();
  const pollingInterval = usePosPollingInterval(15_000);
  const now = useServerNow(realtime.serverTimeOffsetMs);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [updatingServiceId, setUpdatingServiceId] = useState<string | null>(null);
  const [updatingTableOpenId, setUpdatingTableOpenId] = useState<string | null>(null);
  const previousPendingCount = useRef<number | null>(null);
  const previousCallStaffRequestCount = useRef<number | null>(null);
  const previousCheckoutRequestCount = useRef<number | null>(null);
  const previousTableOpenRequestCount = useRef<number | null>(null);
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const requests = useQuery({
    queryKey: ['guest-order-requests'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/pos/qr-orders?status=PENDING'),
    refetchInterval: pollingInterval,
  });
  const serviceRequests = useQuery({
    queryKey: ['service-requests'],
    queryFn: () => apiRequest<ServiceRequestDto[]>('/api/v1/pos/qr-orders/service-requests/list'),
    refetchInterval: pollingInterval,
  });
  const tableOpenRequests = useQuery({
    queryKey: ['table-open-requests'],
    queryFn: () =>
      apiRequest<TableOpenRequestDto[]>('/api/v1/pos/qr-orders/table-open-requests/list'),
    refetchInterval: pollingInterval,
  });

  const pendingRequests = useMemo(
    () => (requests.data ?? []).toSorted((a, b) => a.createdAt - b.createdAt),
    [requests.data],
  );
  const activeServiceRequests = useMemo(
    () =>
      (serviceRequests.data ?? []).toSorted((a, b) => {
        if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
        return a.createdAt - b.createdAt;
      }),
    [serviceRequests.data],
  );
  const openServiceCount = activeServiceRequests.filter((item) => item.status === 'OPEN').length;
  const totalPendingValue = pendingRequests.reduce(
    (sum, request) => sum + request.items.reduce((itemSum, item) => itemSum + item.lineTotalVnd, 0),
    0,
  );

  useEffect(() => {
    const count = requests.data?.length;
    if (count === undefined) return;
    if (
      realtime.status !== 'CONNECTED' &&
      previousPendingCount.current !== null &&
      count > previousPendingCount.current
    ) {
      playPosSound('NEW_QR_ORDER');
    }
    previousPendingCount.current = count;
  }, [realtime.status, requests.data?.length]);

  useEffect(() => {
    const callStaffCount = serviceRequests.data?.filter(
      (sr) => sr.type === 'CALL_STAFF' && sr.status === 'OPEN',
    ).length;
    const checkoutCount = serviceRequests.data?.filter(
      (sr) => sr.type === 'CHECKOUT_REQUEST' && sr.status === 'OPEN',
    ).length;
    if (callStaffCount === undefined || checkoutCount === undefined) return;
    if (
      realtime.status !== 'CONNECTED' &&
      previousCallStaffRequestCount.current !== null &&
      callStaffCount > previousCallStaffRequestCount.current
    ) {
      playPosSound('NEW_QR_ORDER');
    }
    if (
      realtime.status !== 'CONNECTED' &&
      previousCheckoutRequestCount.current !== null &&
      checkoutCount > previousCheckoutRequestCount.current
    ) {
      playPosSound('CHECKOUT_REQUEST');
    }
    previousCallStaffRequestCount.current = callStaffCount;
    previousCheckoutRequestCount.current = checkoutCount;
  }, [realtime.status, serviceRequests.data]);
  useEffect(() => {
    const count = tableOpenRequests.data?.length;
    if (count === undefined) return;
    if (
      realtime.status !== 'CONNECTED' &&
      previousTableOpenRequestCount.current !== null &&
      count > previousTableOpenRequestCount.current
    ) {
      playPosSound('TABLE_OPEN_REQUEST');
    }
    previousTableOpenRequestCount.current = count;
  }, [realtime.status, tableOpenRequests.data?.length]);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['guest-order-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['service-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['table-open-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
      queryClient.invalidateQueries({ queryKey: ['staff-notification-audit'] }),
    ]);
  const accept = useMutation({
    mutationFn: (request: GuestOrderRequestDto) =>
      jsonRequest(
        `/api/v1/pos/qr-orders/${request.id}/accept`,
        { expectedOrderVersion: request.orderVersion },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      ),
    onSuccess: async () => {
      messageApi.success('Đã xác nhận món vào hóa đơn.');
      await refresh();
    },
    onError: async (error) => {
      messageApi.error(errorText(error));
      await refresh();
    },
  });
  const rejectRequest = (request: GuestOrderRequestDto) => {
    let reason = '';
    modal.confirm({
      title: `Từ chối yêu cầu ${request.tableName}`,
      content: (
        <Input.TextArea
          autoFocus
          placeholder="Nhập lý do để khách biết"
          maxLength={300}
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: 'Từ chối',
      okButtonProps: { danger: true },
      cancelText: 'Quay lại',
      onOk: async () => {
        if (!reason.trim()) throw new Error('Vui lòng nhập lý do.');
        setRejectingId(request.id);
        try {
          await jsonRequest(
            `/api/v1/pos/qr-orders/${request.id}/reject`,
            { reason: reason.trim() },
            { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
          );
          messageApi.success('Đã từ chối yêu cầu.');
          await refresh();
        } finally {
          setRejectingId(null);
        }
      },
    });
  };
  const updateService = async (request: ServiceRequestDto, action: 'ACKNOWLEDGE' | 'COMPLETE') => {
    setUpdatingServiceId(request.id);
    try {
      await jsonRequest(
        `/api/v1/pos/qr-orders/service-requests/${request.id}/status`,
        { action },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      );
      await refresh();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setUpdatingServiceId(null);
    }
  };
  const acceptTableOpen = async (request: TableOpenRequestDto) => {
    setUpdatingTableOpenId(request.id);
    try {
      await jsonRequest(
        `/api/v1/pos/qr-orders/table-open-requests/${request.id}/accept`,
        {},
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      );
      messageApi.success(`Đã mở ${request.tableName}.`);
      await refresh();
    } catch (error) {
      messageApi.error(errorText(error));
      await refresh();
    } finally {
      setUpdatingTableOpenId(null);
    }
  };
  const cancelTableOpen = (request: TableOpenRequestDto) => {
    let reason = '';
    modal.confirm({
      title: `Từ chối mở ${request.tableName}`,
      content: (
        <Input.TextArea
          autoFocus
          placeholder="Nhập lý do từ chối"
          maxLength={300}
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: 'Từ chối',
      okButtonProps: { danger: true },
      cancelText: 'Quay lại',
      onOk: async () => {
        if (!reason.trim()) throw new Error('Vui lòng nhập lý do.');
        setUpdatingTableOpenId(request.id);
        try {
          await jsonRequest(
            `/api/v1/pos/qr-orders/table-open-requests/${request.id}/cancel`,
            { reason: reason.trim() },
            { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
          );
          messageApi.success('Đã từ chối yêu cầu mở bàn.');
          await refresh();
        } finally {
          setUpdatingTableOpenId(null);
        }
      },
    });
  };

  const realtimeLabel =
    realtime.status === 'CONNECTED'
      ? 'Realtime đang hoạt động'
      : realtime.status === 'CONNECTING'
        ? 'Đang kết nối realtime'
        : realtime.status === 'RECONNECTING'
          ? 'Đang kết nối lại'
          : 'Realtime đang tắt';
  const realtimeColor = realtime.status === 'CONNECTED' ? 'success' : 'warning';
  const isRefreshing =
    requests.isFetching || serviceRequests.isFetching || tableOpenRequests.isFetching;

  return (
    <main className="staff-qr-order-page">
      {holder}
      {modalHolder}

      <section className="staff-qr-order-hero">
        <div>
          <div className="staff-qr-order-hero__eyebrow">
            <QrcodeOutlined /> Trung tâm yêu cầu tại bàn
          </div>
        </div>
        <div className="staff-qr-order-hero__actions">
          <Tag color={realtimeColor} className="staff-qr-realtime-tag">
            <span className={`staff-qr-realtime-dot is-${realtime.status.toLowerCase()}`} />
            {realtimeLabel}
          </Tag>
          <Button
            icon={<SyncOutlined spin={isRefreshing} />}
            disabled={isRefreshing}
            onClick={() => void refresh()}
          >
            Làm mới
          </Button>
        </div>
      </section>

      <section className="staff-qr-order-summary" aria-label="Tổng quan QR Order">
        <article>
          <span>Đơn chờ xác nhận</span>
          <strong>{pendingRequests.length}</strong>
          <small>{formatMoney(totalPendingValue)}</small>
        </article>
        <article>
          <span>Yêu cầu tại bàn</span>
          <strong>{openServiceCount + (tableOpenRequests.data?.length ?? 0)}</strong>
          <small>{tableOpenRequests.data?.length ?? 0} bàn chờ mở</small>
        </article>
        <article>
          <span>Đồng bộ dữ liệu</span>
          <strong>{realtime.status === 'CONNECTED' ? 'Tức thì' : '15 giây'}</strong>
          <small>Giờ máy chủ {formatPreciseTime(now)}</small>
        </article>
      </section>

      {requests.isError || serviceRequests.isError || tableOpenRequests.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không thể tải đầy đủ yêu cầu"
          description="Hệ thống vẫn sẽ tự thử lại. Bạn có thể bấm Làm mới để kiểm tra ngay."
          className="staff-qr-order-error"
        />
      ) : null}

      <section className="staff-qr-order-section">
        <div className="staff-qr-order-section__heading">
          <div>
            <Typography.Title level={3}>Yêu cầu mở bàn</Typography.Title>
            <Typography.Text type="secondary">
              Khách đã quét QR và đang chọn món trong lúc chờ.
            </Typography.Text>
          </div>
          <Tag color={(tableOpenRequests.data?.length ?? 0) > 0 ? 'processing' : 'default'}>
            {tableOpenRequests.data?.length ?? 0} đang chờ
          </Tag>
        </div>

        {tableOpenRequests.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (tableOpenRequests.data?.length ?? 0) === 0 ? (
          <div className="staff-qr-order-empty staff-qr-order-empty--compact">
            <CheckCircleOutlined /> Không có bàn đang chờ mở
          </div>
        ) : (
          <div className="staff-qr-service-grid">
            {tableOpenRequests.data?.map((request) => {
              const urgency = requestUrgency(request.createdAt, now);
              const isUpdating = updatingTableOpenId === request.id;
              return (
                <article key={request.id} className={`staff-qr-service-card ${urgency.className}`}>
                  <div className="staff-qr-service-card__icon">
                    <UnlockOutlined />
                  </div>
                  <div className="staff-qr-service-card__body">
                    <div className="staff-qr-service-card__title">
                      <strong>Yêu cầu mở bàn</strong>
                      <Tag color={urgency.color}>{urgency.label}</Tag>
                    </div>
                    <b>
                      {request.tableName} · {request.areaName}
                    </b>
                    <div className="staff-qr-request-timing">
                      <ClockCircleOutlined /> Gửi lúc {formatPreciseTime(request.createdAt)} · chờ{' '}
                      <strong>{formatRequestAge(request.createdAt, now)}</strong>
                    </div>
                  </div>
                  <div className="staff-qr-service-card__actions">
                    <Button
                      danger
                      disabled={updatingTableOpenId !== null}
                      onClick={() => cancelTableOpen(request)}
                    >
                      Từ chối
                    </Button>
                    <Button
                      type="primary"
                      icon={<UnlockOutlined />}
                      loading={isUpdating}
                      disabled={updatingTableOpenId !== null && !isUpdating}
                      onClick={() => void acceptTableOpen(request)}
                    >
                      Mở bàn
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="staff-qr-order-section">
        <div className="staff-qr-order-section__heading">
          <div>
            <Typography.Title level={3}>Yêu cầu hỗ trợ</Typography.Title>
            <Typography.Text type="secondary">
              Ưu tiên yêu cầu chưa có nhân viên tiếp nhận.
            </Typography.Text>
          </div>
          <Tag>{activeServiceRequests.length} đang mở</Tag>
        </div>

        {serviceRequests.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : activeServiceRequests.length === 0 ? (
          <div className="staff-qr-order-empty staff-qr-order-empty--compact">
            <CheckCircleOutlined /> Không có yêu cầu hỗ trợ đang chờ
          </div>
        ) : (
          <div className="staff-qr-service-grid">
            {activeServiceRequests.map((request) => {
              const urgency = requestUrgency(request.createdAt, now);
              const isUpdating = updatingServiceId === request.id;
              return (
                <article key={request.id} className={`staff-qr-service-card ${urgency.className}`}>
                  <div className="staff-qr-service-card__icon">
                    {request.type === 'CALL_STAFF' ? <BellOutlined /> : <CreditCardOutlined />}
                  </div>
                  <div className="staff-qr-service-card__body">
                    <div className="staff-qr-service-card__title">
                      <strong>
                        {request.type === 'CALL_STAFF' ? 'Gọi nhân viên' : 'Yêu cầu thanh toán'}
                      </strong>
                      <Tag color={request.status === 'OPEN' ? urgency.color : 'success'}>
                        {request.status === 'OPEN' ? urgency.label : 'Đã tiếp nhận'}
                      </Tag>
                    </div>
                    <b>
                      {request.tableName} · {request.areaName}
                    </b>
                    <div className="staff-qr-request-timing">
                      <ClockCircleOutlined /> Gửi lúc {formatPreciseTime(request.createdAt)} · chờ{' '}
                      <strong>{formatRequestAge(request.createdAt, now)}</strong>
                    </div>
                    {request.acknowledgedAt ? (
                      <small>Tiếp nhận lúc {formatPreciseTime(request.acknowledgedAt)}</small>
                    ) : null}
                  </div>
                  <div className="staff-qr-service-card__actions">
                    <Button size="small" onClick={() => navigate(`/pos/orders/${request.orderId}`)}>
                      Mở đơn
                    </Button>
                    {request.status === 'OPEN' ? (
                      <Button
                        type="primary"
                        loading={isUpdating}
                        disabled={updatingServiceId !== null && !isUpdating}
                        onClick={() => void updateService(request, 'ACKNOWLEDGE')}
                      >
                        Tiếp nhận
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        loading={isUpdating}
                        disabled={updatingServiceId !== null && !isUpdating}
                        onClick={() => void updateService(request, 'COMPLETE')}
                      >
                        Hoàn tất
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="staff-qr-order-section staff-qr-order-section--orders">
        <div className="staff-qr-order-section__heading">
          <div>
            <Typography.Title level={3}>Đơn chờ xác nhận</Typography.Title>
            <Typography.Text type="secondary">
              Xếp theo thời gian chờ lâu nhất để không bỏ sót yêu cầu.
            </Typography.Text>
          </div>
          <Tag color={pendingRequests.length > 0 ? 'processing' : 'default'}>
            {pendingRequests.length} yêu cầu
          </Tag>
        </div>

        {requests.isLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : pendingRequests.length === 0 ? (
          <Empty
            className="staff-qr-order-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Chưa có yêu cầu gọi món mới"
          />
        ) : (
          <div className="staff-qr-request-list">
            {pendingRequests.map((request) => {
              const urgency = requestUrgency(request.createdAt, now);
              const itemQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
              const requestTotal = request.items.reduce((sum, item) => sum + item.lineTotalVnd, 0);
              const isAccepting = accept.isPending && accept.variables?.id === request.id;
              const isRejecting = rejectingId === request.id;
              const anotherActionPending =
                (accept.isPending && !isAccepting) || (rejectingId !== null && !isRejecting);

              return (
                <article key={request.id} className={`staff-qr-request-card ${urgency.className}`}>
                  <header className="staff-qr-request-card__header">
                    <div className="staff-qr-request-card__table">
                      <span className="staff-qr-request-card__table-icon">
                        <ShopOutlined />
                      </span>
                      <div>
                        <Typography.Title level={4}>{request.tableName}</Typography.Title>
                        <span>{request.areaName}</span>
                      </div>
                    </div>
                    <div className="staff-qr-request-card__status">
                      <Tag color={urgency.color}>{urgency.label}</Tag>
                      <div className="staff-qr-request-card__age">
                        <ClockCircleOutlined />
                        <strong>{formatRequestAge(request.createdAt, now)}</strong>
                      </div>
                      <small>Gửi lúc {formatPreciseTime(request.createdAt)}</small>
                    </div>
                  </header>

                  <div className="staff-qr-request-card__meta">
                    <span>{request.items.length} dòng món</span>
                    <span>{formatDecimal(itemQuantity)} sản phẩm</span>
                    <span>Mã #{request.id.slice(0, 8).toUpperCase()}</span>
                  </div>

                  <div className="staff-qr-request-items">
                    {request.items.map((item) => (
                      <div key={item.id} className="staff-qr-request-item">
                        <strong className="staff-qr-request-item__quantity">
                          {item.quantity}×
                        </strong>
                        <div className="staff-qr-request-item__name">
                          <b>{item.productName}</b>
                          {item.variantName && item.variantName !== 'Mặc định' ? (
                            <span>{item.variantName}</span>
                          ) : null}
                          {item.note ? <small>Ghi chú món: {item.note}</small> : null}
                        </div>
                        <div className="staff-qr-request-item__price">
                          <span>{formatMoney(item.unitPriceVnd)} / đơn vị</span>
                          <strong>{formatMoney(item.lineTotalVnd)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  {request.note ? (
                    <div className="staff-qr-request-note">
                      <MessageOutlined />
                      <div>
                        <span>Ghi chú toàn đơn</span>
                        <strong>{request.note}</strong>
                      </div>
                    </div>
                  ) : null}

                  <footer className="staff-qr-request-card__footer">
                    <div className="staff-qr-request-total">
                      <span>Tổng yêu cầu</span>
                      <strong>{formatMoney(requestTotal)}</strong>
                    </div>
                    <div className="staff-qr-request-actions">
                      <Button onClick={() => navigate(`/pos/orders/${request.orderId}`)}>
                        Xem đơn hiện tại
                      </Button>
                      <Button
                        danger
                        loading={isRejecting}
                        disabled={anotherActionPending || isAccepting}
                        onClick={() => rejectRequest(request)}
                      >
                        Từ chối
                      </Button>
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        loading={isAccepting}
                        disabled={anotherActionPending || isRejecting}
                        onClick={() => accept.mutate(request)}
                      >
                        Xác nhận vào hóa đơn
                      </Button>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function MorePage({
  auth,
  onStartOnboarding,
}: {
  auth: AuthContextResponse;
  onStartOnboarding: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });

  const permissions = context.data?.permissions ?? [];
  const isOwner = auth.actor?.kind === 'OWNER';
  const hasPermission = (key: string) => isOwner || permissions.includes(key);

  const logout = useMutation({
    mutationFn: () =>
      apiRequest<{ loggedOut: boolean; accessLogoutUrl: string | null }>('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': auth.csrfToken! },
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      queryClient.clear();
      if (data?.accessLogoutUrl) {
        window.location.assign(data.accessLogoutUrl);
      } else {
        navigate('/?tab=employee', { replace: true });
      }
    },
    onError: (error) => messageApi.error(errorText(error)),
  });

  return (
    <div className="staff-more-page">
      {holder}
      <section className="staff-profile-hero">
        <Avatar size={76} icon={<UserOutlined />} />
        <div>
          <Typography.Title level={2}>{auth.actor!.displayName}</Typography.Title>
          <Typography.Text>
            {isOwner ? 'Chủ cửa hàng (Quản trị viên)' : 'Nhân viên cửa hàng'}
          </Typography.Text>
        </div>
      </section>

      {/* ── Sales management ───────────────────────────────────────── */}
      <div style={{ marginBottom: 16, marginTop: 20 }}>
        <Typography.Title
          level={5}
          style={{
            margin: '0 0 10px 4px',
            color: '#475569',
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Quản lý bán hàng
        </Typography.Title>

        <Card
          styles={{ body: { padding: 0 } }}
          style={{
            overflow: 'hidden',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          }}
        >
          {hasPermission('catalog.manage') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/catalog')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#fdf2f8',
                    color: '#db2777',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <TagsOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Mặt hàng & Danh mục
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Thêm món mới, điều chỉnh giá bán, quản lý danh mục và bảng giá
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          {hasPermission('invoice.view') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/invoices')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#eff6ff',
                    color: '#0975f7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <FileTextOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Hóa đơn & Biên lai
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Xem lịch sử hóa đơn bán hàng, in lại bill, tra cứu đơn đã thanh toán
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}
        </Card>
      </div>

      {/* ── Device & POS settings ───────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Title
          level={5}
          style={{
            margin: '0 0 10px 4px',
            color: '#475569',
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Thiết lập
        </Typography.Title>

        <Card
          styles={{ body: { padding: 0 } }}
          style={{
            overflow: 'hidden',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          }}
        >
          {hasPermission('order.manage') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/printers')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#ecfdf5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <PrinterOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Máy in</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Dò tìm và thiết lập máy in hóa đơn trên thiết bị POS này
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          <button
            type="button"
            className="staff-more-nav-item staff-onboarding-entry"
            onClick={onStartOnboarding}
          >
            <span className="staff-onboarding-entry__icon">
              <QuestionCircleOutlined />
            </span>
            <span className="staff-onboarding-entry__copy">
              <strong>Hướng dẫn sử dụng POS</strong>
              <small>Xem lại cách chọn khu vực, bàn, gọi món, lưu đơn và QR Order</small>
            </span>
            <RightOutlined />
          </button>

          {/* Push Notification Setup */}
          <div style={{ padding: '14px 18px' }}>
            <PushNotificationControl csrfToken={auth.csrfToken} showGuide />
          </div>
        </Card>
      </div>

      {/* ── Store Info Section ────────────────────────────────────────── */}
      <Card
        className="staff-store-card"
        loading={context.isLoading}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <ShopOutlined />
        <div>
          <strong>{context.data?.storeName ?? 'Cửa hàng'}</strong>
          <span>Mã cửa hàng: {context.data?.storeId ?? '—'}</span>
          {context.data?.storeAddress ? <span>Địa chỉ: {context.data.storeAddress}</span> : null}
          {context.data?.storePhone ? <span>Điện thoại: {context.data.storePhone}</span> : null}
        </div>
      </Card>

      {/* ── Logout Section ───────────────────────────────────────────── */}
      <Card
        className="staff-more-actions"
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <button type="button" onClick={() => logout.mutate()}>
          <LogoutOutlined />
          <span>Đăng xuất tài khoản</span>
        </button>
      </Card>

      <Typography.Text type="secondary" className="staff-version">
        Pro POS · Cổng nhân viên bán hàng
      </Typography.Text>
    </div>
  );
}

interface StaffTablePickerModalProps {
  open: boolean;
  title?: string;
  initialTableId?: string | null;
  tables: PosTable[];
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (table: PosTable) => void;
}

function formatTableElapsed(occupiedSince: number | null, now: number) {
  if (!occupiedSince) return '';
  const totalSecs = Math.max(0, Math.floor((now - occupiedSince) / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function StaffTablePickerModal({
  open,
  title = 'Chọn khu vực',
  initialTableId,
  tables,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: StaffTablePickerModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedTableId(initialTableId ?? null);
    if (initialTableId) {
      const match = tables.find((t) => t.id === initialTableId);
      if (match) {
        setSelectedAreaId(match.areaId);
      }
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [open, initialTableId, tables]);

  const areas = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; tables: PosTable[] }
    >();
    for (const table of tables) {
      const existing = map.get(table.areaId);
      if (existing) {
        existing.tables.push(table);
      } else {
        map.set(table.areaId, {
          id: table.areaId,
          name: table.areaName,
          sortOrder: table.areaSortOrder,
          tables: [table],
        });
      }
    }
    return [...map.values()].toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
    );
  }, [tables]);

  const activeArea = areas.find((item) => item.id === selectedAreaId) ?? areas[0];

  const sortedTables = useMemo(() => {
    return (activeArea?.tables ?? []).toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }),
    );
  }, [activeArea]);

  const availableCount = sortedTables.filter((table) => table.status === 'AVAILABLE').length;
  const totalCount = sortedTables.length;
  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? null;

  return (
    <Modal
      open={open}
      title={<div className="staff-area-modal__title">{title}</div>}
      footer={
        <div className="staff-area-modal__footer">
          <Button
            type="primary"
            size="large"
            block
            disabled={!selectedTable}
            loading={confirmLoading}
            onClick={() => {
              if (selectedTable) onConfirm(selectedTable);
            }}
            className="staff-area-modal__continue-btn"
          >
            Tiếp tục
          </Button>
        </div>
      }
      width={940}
      centered
      destroyOnHidden
      onCancel={onCancel}
      className="staff-area-picker-modal"
      styles={{
        body: { padding: 0 },
      }}
    >
      <div className="staff-area-modal__body">
        <aside className="staff-area-modal__sidebar">
          {areas.map((areaItem) => {
            const isActive = areaItem.id === activeArea?.id;
            return (
              <button
                key={areaItem.id}
                type="button"
                className={`staff-area-modal__tab ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedAreaId(areaItem.id);
                  setSelectedTableId(null);
                }}
              >
                {areaItem.name}
              </button>
            );
          })}
        </aside>
        <main className="staff-area-modal__content">
          <div className="staff-area-modal__summary">
            Bàn trống: {availableCount}/{totalCount}
          </div>
          {sortedTables.length === 0 ? (
            <Empty description="Khu vực chưa có bàn" style={{ padding: '60px 0' }} />
          ) : (
            <div className="staff-area-modal__grid">
              {sortedTables.map((table) => {
                const isOccupied = table.status === 'OCCUPIED';
                const isAvailable = table.status === 'AVAILABLE';
                const isDisabled = table.status === 'DISABLED';
                const isSelected = selectedTableId === table.id;

                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={isDisabled}
                    className={[
                      'staff-area-modal__card',
                      isOccupied && 'staff-area-modal__card--occupied',
                      isAvailable && 'staff-area-modal__card--available',
                      isDisabled && 'staff-area-modal__card--disabled',
                      isSelected && 'is-selected',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (isAvailable) {
                        setSelectedTableId(isSelected ? null : table.id);
                      }
                    }}
                    onDoubleClick={() => {
                      if (isAvailable) {
                        onConfirm(table);
                      }
                    }}
                  >
                    <strong className="staff-area-modal__card-name">{table.name}</strong>
                    {isOccupied ? (
                      <span className="staff-area-modal__card-time">
                        <ClockCircleOutlined /> {formatTableElapsed(table.occupiedSince, now)}
                      </span>
                    ) : isAvailable ? (
                      <span className="staff-area-modal__card-state">
                        {isSelected ? 'Đang chọn' : ''}
                      </span>
                    ) : (
                      <span className="staff-area-modal__card-state">Tạm ngưng</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </Modal>
  );
}

interface StaffTableTransferModalProps {
  open: boolean;
  currentTable: PosTable | null;
  currentQuote: OrderQuote | null;
  tables: PosTable[];
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (targetTable: PosTable) => Promise<void>;
}

function StaffTableTransferModal({
  open,
  currentTable,
  currentQuote,
  tables,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: StaffTableTransferModalProps) {
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [confirmTargetTable, setConfirmTargetTable] = useState<PosTable | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmTargetTable(null);
      setIsTransferring(false);
    }
  }, [open]);

  const areas = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; tables: PosTable[] }
    >();
    for (const table of tables) {
      const existing = map.get(table.areaId);
      if (existing) {
        existing.tables.push(table);
      } else {
        map.set(table.areaId, {
          id: table.areaId,
          name: table.areaName,
          sortOrder: table.areaSortOrder,
          tables: [table],
        });
      }
    }
    return [...map.values()].toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
    );
  }, [tables]);

  const activeArea = areas.find((item) => item.id === selectedAreaId) ?? areas[0];

  const sortedTables = useMemo(() => {
    return (activeArea?.tables ?? []).toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }),
    );
  }, [activeArea]);

  const availableCount = sortedTables.filter(
    (table) => table.status === 'AVAILABLE' && table.id !== currentTable?.id,
  ).length;
  const totalCount = sortedTables.length;

  const currentPriceText = useMemo(() => {
    if (currentQuote?.time?.pricingConfig) {
      const cfg = currentQuote.time.pricingConfig;
      const productName = currentTable?.timeProductName ? `${currentTable.timeProductName} · ` : '';
      return `${productName}${formatMoney(cfg.basePriceVnd)}/giờ`;
    }
    if (currentTable?.defaultPriceVnd) {
      const productName = currentTable.timeProductName ? `${currentTable.timeProductName} · ` : '';
      return `${productName}${formatMoney(currentTable.defaultPriceVnd)}/giờ`;
    }
    return 'Chưa có cấu hình giá';
  }, [currentQuote, currentTable]);

  const handleExecuteTransfer = async () => {
    if (!confirmTargetTable) return;
    setIsTransferring(true);
    try {
      await onConfirm(confirmTargetTable);
      setConfirmTargetTable(null);
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <>
      <Modal
        open={open && !confirmTargetTable}
        title={
          <div className="staff-transfer-modal__title">
            <SwapOutlined />
            <span>Chuyển bàn</span>
          </div>
        }
        footer={null}
        width={920}
        centered
        destroyOnHidden
        onCancel={onCancel}
        className="staff-transfer-picker-modal"
        styles={{
          body: { padding: 0 },
        }}
      >
        <div className="staff-transfer-modal__container">
          {/* Current Table Card */}
          {currentTable ? (
            <div className="staff-transfer-source-card">
              <div className="staff-transfer-source-card__left">
                <span className="staff-transfer-source-card__badge">Bàn hiện tại</span>
                <strong className="staff-transfer-source-card__name">{currentTable.name}</strong>
                <span className="staff-transfer-source-card__area">{currentTable.areaName}</span>
              </div>
              <div className="staff-transfer-source-card__right">
                <span className="staff-transfer-source-card__label">Giá hiện tại</span>
                <span className="staff-transfer-source-card__price">{currentPriceText}</span>
              </div>
            </div>
          ) : null}

          <div className="staff-transfer-modal__layout">
            <aside className="staff-transfer-modal__sidebar">
              {areas.map((areaItem) => {
                const isActive = areaItem.id === activeArea?.id;
                return (
                  <button
                    key={areaItem.id}
                    type="button"
                    className={`staff-transfer-modal__tab ${isActive ? 'is-active' : ''}`}
                    onClick={() => setSelectedAreaId(areaItem.id)}
                  >
                    {areaItem.name}
                  </button>
                );
              })}
            </aside>

            <main className="staff-transfer-modal__content">
              <div className="staff-transfer-modal__summary">
                <span>Chọn bàn đích:</span>
                <span className="staff-transfer-modal__count">
                  Bàn trống khả dụng:{' '}
                  <strong>
                    {availableCount}/{totalCount}
                  </strong>
                </span>
              </div>

              {sortedTables.length === 0 ? (
                <Empty description="Khu vực chưa có bàn" style={{ padding: '60px 0' }} />
              ) : (
                <div className="staff-transfer-modal__grid">
                  {sortedTables.map((table) => {
                    const isCurrent = table.id === currentTable?.id;
                    const isOccupied = table.status === 'OCCUPIED';
                    const isAvailable = table.status === 'AVAILABLE' && !isCurrent;
                    const isDisabled = table.status === 'DISABLED' || isCurrent || isOccupied;

                    const priceText = table.defaultPriceVnd
                      ? `${table.timeProductName ? `${table.timeProductName} · ` : ''}${formatMoney(table.defaultPriceVnd)}/giờ`
                      : 'Mặc định';

                    return (
                      <button
                        key={table.id}
                        type="button"
                        disabled={isDisabled}
                        className={[
                          'staff-transfer-card',
                          isAvailable && 'staff-transfer-card--available',
                          isOccupied && 'staff-transfer-card--occupied',
                          isCurrent && 'staff-transfer-card--current',
                          isDisabled && 'staff-transfer-card--disabled',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          if (isAvailable) {
                            setConfirmTargetTable(table);
                          }
                        }}
                      >
                        <div className="staff-transfer-card__header">
                          <strong className="staff-transfer-card__name">{table.name}</strong>
                          <span
                            className={`staff-transfer-card__status-badge ${
                              isCurrent ? 'is-current' : isOccupied ? 'is-occupied' : 'is-available'
                            }`}
                          >
                            {isCurrent ? 'Bàn hiện tại' : isOccupied ? 'Đang chơi' : 'Bàn trống'}
                          </span>
                        </div>
                        <div className="staff-transfer-card__price">{priceText}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        open={Boolean(confirmTargetTable)}
        title={
          <div className="staff-transfer-confirm-title">
            <SwapOutlined />
            <span>
              Chuyển {currentTable?.name ?? 'Bàn'} → {confirmTargetTable?.name ?? 'Bàn mới'}?
            </span>
          </div>
        }
        okText="Xác nhận chuyển bàn"
        cancelText="Hủy"
        okButtonProps={{
          size: 'large',
          className: 'staff-transfer-confirm-ok-btn',
        }}
        cancelButtonProps={{
          size: 'large',
        }}
        confirmLoading={isTransferring || confirmLoading}
        onOk={() => void handleExecuteTransfer()}
        onCancel={() => {
          if (!isTransferring) setConfirmTargetTable(null);
        }}
        centered
        width={480}
        destroyOnHidden
      >
        {confirmTargetTable && currentTable ? (
          <div className="staff-transfer-confirm-body">
            <div className="staff-transfer-comparison">
              <div className="staff-transfer-comparison__item">
                <span className="staff-transfer-comparison__tag">Bàn hiện tại</span>
                <strong className="staff-transfer-comparison__name">{currentTable.name}</strong>
                <span className="staff-transfer-comparison__rate">{currentPriceText}</span>
              </div>

              <div className="staff-transfer-comparison__arrow">
                <SwapOutlined />
              </div>

              <div className="staff-transfer-comparison__item staff-transfer-comparison__item--target">
                <span className="staff-transfer-comparison__tag staff-transfer-comparison__tag--target">
                  Bàn mới
                </span>
                <strong className="staff-transfer-comparison__name">
                  {confirmTargetTable.name}
                </strong>
                <span className="staff-transfer-comparison__rate">
                  {confirmTargetTable.defaultPriceVnd
                    ? `${confirmTargetTable.timeProductName ? `${confirmTargetTable.timeProductName} · ` : ''}${formatMoney(confirmTargetTable.defaultPriceVnd)}/giờ`
                    : 'Theo cấu hình bàn mới'}
                </span>
              </div>
            </div>

            <div className="staff-transfer-confirm-notes">
              <div className="staff-transfer-confirm-note-item">
                <span className="staff-transfer-dot">•</span>
                <span>Giá mới sẽ áp dụng từ thời điểm chuyển.</span>
              </div>
              <div className="staff-transfer-confirm-note-item">
                <span className="staff-transfer-dot">•</span>
                <span>Thời gian đã chơi, món đã gọi và hóa đơn hiện tại được giữ nguyên.</span>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

interface StaffItemDetailModalProps {
  item: EditingOrderItem | null;
  catalog: CatalogProduct[];
  onCancel: () => void;
  onSave: (updated: EditingOrderItem, selectedVariant?: CatalogVariant) => void;
  onDelete: () => void;
}

function StaffItemDetailModal({
  item,
  catalog,
  onCancel,
  onSave,
  onDelete,
}: StaffItemDetailModalProps) {
  if (!item) return null;

  const product = catalog.find(
    (p) =>
      p.productId === item.productId ||
      p.productName === item.productName ||
      (item.variantId && p.variants.some((v) => v.id === item.variantId)),
  );

  const variants: CatalogVariant[] =
    product?.variants && product.variants.length > 0
      ? product.variants
      : [
          {
            id: item.variantId ?? 'default',
            name: item.variantName || 'Giá thường',
            salePriceVnd: item.unitPriceVnd,
            promptPrice: 0,
          },
        ];

  return (
    <OrderItemDetailModal
      key={item.id}
      item={item}
      product={product}
      variants={variants}
      onCancel={onCancel}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
}

function WeightInputSection({
  unitName,
  unitPriceVnd,
  quantityMilli,
  onChangeQuantityMilli,
  grossTotal,
}: {
  unitName?: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  onChangeQuantityMilli: (milli: number) => void;
  grossTotal: number;
}) {
  const unit = getWeightUnit(unitName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Buffer input as text so typing "0.", "1,", "0.5" works smoothly without premature clamping or jumping
  const [inputText, setInputText] = useState<string>(() => {
    const qty = quantityMilli / 1000;
    return qty > 0 ? qty.toString() : '';
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto focus & select text when mounted so user can immediately type without backspacing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  const handleInputChange = (raw: string) => {
    // Only allow digits, comma, period
    const cleaned = raw.replace(/[^\d.,]/g, '');
    setInputText(cleaned);

    const normalized = cleaned.replace(',', '.');
    if (!normalized || normalized === '.') {
      setErrorMsg('Vui lòng nhập trọng lượng');
      onChangeQuantityMilli(0);
      return;
    }

    const val = parseFloat(normalized);
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Trọng lượng phải lớn hơn 0');
      onChangeQuantityMilli(0);
    } else if (val > 9999.999) {
      setErrorMsg('Trọng lượng vượt quá giới hạn (tối đa 9.999)');
      onChangeQuantityMilli(0);
    } else {
      setErrorMsg(null);
      onChangeQuantityMilli(Math.round(val * 1000));
    }
  };

  const handleApplyPreset = (presetVal: number) => {
    setInputText(presetVal.toString());
    setErrorMsg(null);
    onChangeQuantityMilli(Math.round(presetVal * 1000));
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleAdjust = (delta: number) => {
    const currentVal = quantityMilli / 1000;
    const newVal = Math.max(0.001, Math.round((currentVal + delta) * 1000) / 1000);
    setInputText(newVal.toString());
    setErrorMsg(null);
    onChangeQuantityMilli(Math.round(newVal * 1000));
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const isKg = unit.toLowerCase() === 'kg';
  const presets = isKg ? [0.1, 0.2, 0.5, 1, 1.5, 2, 3, 5] : [50, 100, 200, 500, 1000];

  return (
    <div className="staff-weight-section">
      <div className="staff-weight-section__header">
        <div className="staff-item-modal__section-title">Trọng lượng ({unit})</div>
        <div className="staff-item-modal__section-subtitle">
          Nhập trực tiếp hoặc bấm chọn nhanh mức cân bên dưới
        </div>
      </div>

      {/* Main Large Input */}
      <div className="staff-weight-input-wrapper">
        <div className={`staff-weight-input-box ${errorMsg ? 'has-error' : ''}`}>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="staff-weight-input-field"
            value={inputText}
            placeholder="0.000"
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <span className="staff-weight-input-unit-badge">{unit}</span>
          {inputText ? (
            <button
              type="button"
              className="staff-weight-input-clear-btn"
              onClick={() => {
                setInputText('');
                setErrorMsg('Vui lòng nhập trọng lượng');
                onChangeQuantityMilli(0);
                inputRef.current?.focus();
              }}
              title="Xóa nhập lại"
            >
              <CloseCircleFilled />
            </button>
          ) : null}
        </div>

        {/* Stepper adjustment buttons */}
        <div className="staff-weight-stepper-row">
          <button
            type="button"
            className="staff-weight-adjust-btn"
            onClick={() => handleAdjust(-0.5)}
            title="Giảm 0.5"
          >
            -0.5
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn"
            onClick={() => handleAdjust(-0.1)}
            title="Giảm 0.1"
          >
            -0.1
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn staff-weight-adjust-btn--add"
            onClick={() => handleAdjust(0.1)}
            title="Tăng 0.1"
          >
            +0.1
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn staff-weight-adjust-btn--add"
            onClick={() => handleAdjust(0.5)}
            title="Tăng 0.5"
          >
            +0.5
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn staff-weight-adjust-btn--add"
            onClick={() => handleAdjust(1.0)}
            title="Tăng 1.0"
          >
            +1.0
          </button>
        </div>
      </div>

      {errorMsg ? <div className="staff-weight-error-alert">{errorMsg}</div> : null}

      {/* Quick Presets */}
      <div className="staff-weight-presets-wrap">
        <div className="staff-weight-presets-label">Mức cân nhanh:</div>
        <div className="staff-weight-presets-list">
          {presets.map((p) => {
            const isSelected = Math.abs(quantityMilli / 1000 - p) < 0.0001;
            return (
              <button
                key={p}
                type="button"
                className={`staff-weight-preset-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => handleApplyPreset(p)}
              >
                {p} {unit}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Calculation Preview Banner */}
      <div className="staff-weight-calc-summary">
        <div className="staff-weight-calc-formula">
          {quantityMilli > 0 ? (
            <>
              <span className="staff-weight-calc-qty">
                {(quantityMilli / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{' '}
                {unit}
              </span>
              <span className="staff-weight-calc-cross">×</span>
              <span className="staff-weight-calc-rate">
                {formatMoney(unitPriceVnd)}/{unit}
              </span>
            </>
          ) : (
            <span className="staff-weight-calc-empty">Chưa có trọng lượng</span>
          )}
        </div>
        <div className="staff-weight-calc-result">
          <span className="staff-weight-calc-equals">=</span>
          <strong className="staff-weight-calc-total">{formatMoney(grossTotal)}</strong>
        </div>
      </div>
    </div>
  );
}

function OrderItemDetailModal({
  item,
  product,
  variants,
  onCancel,
  onSave,
  onDelete,
}: {
  item: EditingOrderItem;
  product?: CatalogProduct | undefined;
  variants: CatalogVariant[];
  onCancel: () => void;
  onSave: (updated: EditingOrderItem, selectedVariant?: CatalogVariant) => void;
  onDelete: () => void;
}) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
    if (item.variantId && variants.some((v) => v.id === item.variantId)) {
      return item.variantId;
    }
    return variants[0]?.id ?? 'default';
  });
  const [itemNote, setItemNote] = useState<string>(item.note ?? '');
  const [itemQuantityMilli, setItemQuantityMilli] = useState<number>(item.quantityMilli);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT' | null>(item.discountType);
  const [discountValue, setDiscountValue] = useState<number | null>(item.discountInputValue);
  const [showDiscountInput, setShowDiscountInput] = useState<boolean>(
    Boolean(item.discountType && item.discountInputValue),
  );

  const currentVariant = variants.find((v) => v.id === selectedVariantId) ?? variants[0];
  const unitPriceVnd = currentVariant?.salePriceVnd ?? item.unitPriceVnd;

  const grossTotal = calculateLineTotal(unitPriceVnd, itemQuantityMilli);
  const discountAmount = calculateDiscountAmount(grossTotal, discountType, discountValue);
  const netTotal = grossTotal - discountAmount;

  const handleSave = () => {
    if (item.productType === 'WEIGHT' && itemQuantityMilli <= 0) {
      message.warning('Vui lòng nhập trọng lượng lớn hơn 0');
      return;
    }

    const saveDiscountAmount = calculateDiscountAmount(grossTotal, discountType, discountValue);
    const saveNetTotal = grossTotal - saveDiscountAmount;

    onSave(
      {
        ...item,
        variantId:
          currentVariant?.id !== 'default'
            ? (currentVariant?.id ?? null)
            : (item.variantId ?? null),
        variantName:
          currentVariant?.id !== 'default' ? (currentVariant?.name ?? null) : item.variantName,
        unitPriceVnd,
        quantityMilli: itemQuantityMilli,
        note: itemNote.trim(),
        grossLineTotalVnd: grossTotal,
        discountAmountVnd: saveDiscountAmount,
        discountType,
        discountInputValue: discountValue,
        netLineTotalVnd: saveNetTotal,
      },
      currentVariant,
    );
  };

  const isNewPick = Boolean(item.discardOnCancel);

  return (
    <Modal
      open
      title={<div className="staff-item-modal__header-title">{item.productName}</div>}
      width={540}
      centered
      destroyOnHidden
      onCancel={onCancel}
      footer={null}
      className="staff-item-detail-modal-v2"
    >
      <div className="staff-item-modal__body">
        <div className="staff-item-modal__avatar-wrap">
          <div
            className={`staff-item-modal__avatar-box ${product?.avatarType === 'IMAGE' && product?.mediaId ? 'has-image' : 'has-color'} ${product?.avatarColor ? 'has-custom-color' : ''}`}
            style={{
              background: product?.avatarColor || '#f8fafc',
            }}
          >
            {product?.avatarType === 'IMAGE' && product?.mediaId ? (
              <img
                src={`/api/v1/media/${product.mediaId}`}
                alt={item.productName}
                className="staff-item-modal__avatar-img"
              />
            ) : (
              <span className="staff-item-modal__avatar-letter">
                {getProductInitials(item.productName)}
              </span>
            )}
          </div>
        </div>

        <div className="staff-item-modal__section">
          <div className="staff-item-modal__section-title">Phiên bản giá</div>
          <div className="staff-item-modal__section-subtitle">Chọn một phiên bản giá</div>
          <div className="staff-item-modal__variants">
            {variants.map((v) => {
              const isChecked = v.id === selectedVariantId;
              return (
                <div
                  key={v.id}
                  className={`staff-item-modal__variant-row ${isChecked ? 'is-selected' : ''}`}
                  onClick={() => {
                    setSelectedVariantId(v.id);
                  }}
                >
                  <div className="staff-item-modal__variant-left">
                    <div className={`staff-item-modal__radio ${isChecked ? 'is-checked' : ''}`}>
                      {isChecked ? <div className="staff-item-modal__radio-inner" /> : null}
                    </div>
                    <span className="staff-item-modal__variant-name">{v.name}</span>
                  </div>
                  <strong className="staff-item-modal__variant-price">
                    {formatMoney(v.salePriceVnd ?? unitPriceVnd)}
                    {item.productType === 'WEIGHT' ? `/${getWeightUnit(item.unitName)}` : ''}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dedicated Weight Input Section for WEIGHT items */}
        {item.productType === 'WEIGHT' ? (
          <WeightInputSection
            unitName={item.unitName}
            unitPriceVnd={unitPriceVnd}
            quantityMilli={itemQuantityMilli}
            onChangeQuantityMilli={setItemQuantityMilli}
            grossTotal={grossTotal}
          />
        ) : null}

        <div className="staff-item-modal__section">
          <div className="staff-item-modal__section-title">Ghi chú</div>
          <Input.TextArea
            rows={3}
            placeholder="Nhập ghi chú"
            value={itemNote}
            onChange={(e) => setItemNote(e.target.value)}
            className="staff-item-modal__note-input"
          />
        </div>

        <div className="staff-item-modal__section">
          <div className="staff-item-modal__section-title">Giảm giá sản phẩm</div>
          {!showDiscountInput && discountAmount === 0 ? (
            <button
              type="button"
              className="staff-item-modal__discount-toggle"
              onClick={() => {
                setShowDiscountInput(true);
                setDiscountType('FIXED');
              }}
            >
              <span>Giảm giá thủ công</span>
              <PlusCircleOutlined className="staff-item-modal__plus-icon" />
            </button>
          ) : (
            <div className="staff-item-modal__discount-box">
              <div className="staff-item-modal__discount-row">
                <Radio.Group
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                  size="middle"
                  buttonStyle="solid"
                >
                  <Radio.Button value="FIXED">VNĐ</Radio.Button>
                  <Radio.Button value="PERCENT">%</Radio.Button>
                </Radio.Group>
                <InputNumber
                  min={0}
                  max={discountType === 'PERCENT' ? 100 : grossTotal}
                  value={discountValue}
                  onChange={(val) => setDiscountValue(val === null ? null : Number(val))}
                  placeholder="0"
                  suffix={discountType === 'PERCENT' ? '%' : 'đ'}
                  formatter={(val) => `${val ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')}
                  parser={(val) => Number((val ?? '').replaceAll('.', ''))}
                  style={{ flex: 1 }}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  className="staff-item-modal__discount-delete-btn"
                  onClick={() => {
                    setDiscountType(null);
                    setDiscountValue(null);
                    setShowDiscountInput(false);
                  }}
                />
              </div>
              {discountAmount > 0 ? (
                <div className="staff-item-modal__discount-preview">
                  Giảm: -{formatMoney(discountAmount)} (Còn {formatMoney(netTotal)})
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="staff-item-modal__footer">
          <div className="staff-item-modal__qty-row">
            <span className="staff-item-modal__qty-label">
              {item.productType === 'WEIGHT' ? `Tổng trọng lượng:` : 'Số lượng:'}
            </span>
            {item.productType === 'WEIGHT' ? (
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0877ee' }}>
                {(itemQuantityMilli / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{' '}
                {getWeightUnit(item.unitName)}
              </span>
            ) : (
              <div className="staff-item-modal__stepper">
                <button
                  type="button"
                  className="staff-item-modal__stepper-btn"
                  disabled={itemQuantityMilli <= 1000}
                  onClick={() => setItemQuantityMilli((prev) => Math.max(1000, prev - 1000))}
                >
                  <MinusOutlined />
                </button>
                <span className="staff-item-modal__stepper-val">{itemQuantityMilli / 1000}</span>
                <button
                  type="button"
                  className="staff-item-modal__stepper-btn"
                  onClick={() => setItemQuantityMilli((prev) => prev + 1000)}
                >
                  <PlusOutlined />
                </button>
              </div>
            )}
          </div>

          <div className="staff-item-modal__actions">
            {isNewPick ? (
              <Button
                size="large"
                className="staff-item-modal__cancel-action-btn"
                onClick={onCancel}
              >
                Hủy
              </Button>
            ) : (
              <Button
                danger
                size="large"
                icon={<DeleteOutlined />}
                className="staff-item-modal__delete-action-btn"
                onClick={onDelete}
              >
                {item.source === 'SAVED' ? 'Xóa món' : 'Xóa khỏi giỏ'}
              </Button>
            )}
            <Button
              type="primary"
              size="large"
              className="staff-item-modal__save-btn"
              disabled={item.productType === 'WEIGHT' && itemQuantityMilli <= 0}
              onClick={handleSave}
            >
              {isNewPick ? 'Thêm vào đơn' : 'Lưu'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function OrderEditor({ auth }: { auth: AuthContextResponse }) {
  const location = useLocation();
  const orderId = location.pathname.match(/^\/pos\/orders\/([^/]+)$/u)?.[1];
  const isNew = !orderId || orderId === 'new';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const quotePollingInterval = usePosPollingInterval(5_000);
  const { serverTimeOffsetMs } = useRealtime();
  const [messageApi, holder] = message.useMessage();
  const preselectedTableId = searchParams.get('tableId');
  const typeParam = searchParams.get('type');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>(() => {
    if (typeParam === 'TAKEAWAY') return 'TAKEAWAY';
    return 'DINE_IN';
  });
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableAction, setTableAction] = useState<'SELECT' | 'SAVE' | 'CHECKOUT'>('SELECT');
  const [saving, setSaving] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [variantProduct, setVariantProduct] = useState<CatalogProduct | null>(null);
  const [promptTarget, setPromptTarget] = useState<{
    product: CatalogProduct;
    variant: CatalogVariant;
  } | null>(null);
  const [promptPrice, setPromptPrice] = useState<number | null>(null);
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [editingItem, setEditingItem] = useState<EditingOrderItem | null>(null);
  const [timeDetailOpen, setTimeDetailOpen] = useState(false);
  const [timeRangeDraft, setTimeRangeDraft] = useState({ startedAt: '', endedAt: '' });
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteItemModalOpen, setDeleteItemModalOpen] = useState(false);
  const [deleteItemTarget, setDeleteItemTarget] = useState<{
    id: string;
    name: string;
    source: 'DRAFT' | 'SAVED';
  } | null>(null);
  const [deleteItemReason, setDeleteItemReason] = useState('');
  const [deletingItem, setDeletingItem] = useState(false);
  const [deleteTimeModalOpen, setDeleteTimeModalOpen] = useState(false);
  const [deleteTimeReason, setDeleteTimeReason] = useState('');
  const [deletingTime, setDeletingTime] = useState(false);
  const [timeRestoringDraft, setTimeRestoringDraft] = useState(false);
  const [timeRemoved, setTimeRemoved] = useState(false);
  const [orderedItemsCollapsed, setOrderedItemsCollapsed] = useState(false);
  const [cartTab, setCartTab] = useState<'DETAILS' | 'CUSTOMER' | 'ACTIONS'>('DETAILS');
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [provisionalBillOpen, setProvisionalBillOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [autoResumeRetryToken, setAutoResumeRetryToken] = useState(0);
  const [stoppingTime, setStoppingTime] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false,
  );
  const [mobileView, setMobileView] = useState<'CART' | 'PRODUCTS'>('CART');
  const [pickingCart, setPickingCart] = useState<DraftLine[]>([]);
  const [cartPreviewOpen, setCartPreviewOpen] = useState(false);
  const [editingNoteItemIndex, setEditingNoteItemIndex] = useState<number | null>(null);
  const [itemNoteDraft, setItemNoteDraft] = useState('');
  const cartIconRef = useRef<HTMLButtonElement>(null);
  const autoResumePaymentInFlightRef = useRef(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [guestCount, setGuestCount] = useState<number>(1);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [tableQrModalOpen, setTableQrModalOpen] = useState(false);
  const [tableQrData, setTableQrData] = useState<{
    tableName: string;
    url: string;
    image: string;
    orderCode?: string;
  } | null>(null);
  const [tableQrLoading, setTableQrLoading] = useState(false);
  const [cartWidth, setCartWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('pos_cart_width');
      return saved ? Math.max(360, Math.min(800, Number(saved))) : 480;
    } catch {
      return 480;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const csrf = auth.csrfToken!;

  const navigateToPayment = (targetOrderId: string, replace = false) => {
    markPaymentNavigationStarted(targetOrderId);
    navigate(`/pos/orders/${targetOrderId}/payment`, replace ? { replace: true } : undefined);
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDownResizer = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = cartWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(360, Math.min(window.innerWidth - 380, startWidth + deltaX));
      setCartWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const deltaX = startX - upEvent.clientX;
      const finalWidth = Math.max(360, Math.min(window.innerWidth - 380, startWidth + deltaX));
      try {
        localStorage.setItem('pos_cart_width', String(finalWidth));
      } catch {
        // ignore
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleExit = () => {
    if (draftLines.length > 0) {
      setDiscardModalOpen(true);
    } else {
      navigate('/pos');
    }
  };

  const catalog = useQuery({
    queryKey: ['pos-catalog'],
    queryFn: () => apiRequest<CatalogProduct[]>('/api/v1/pos/catalog'),
  });
  const tables = useQuery({
    queryKey: ['pos-tables'],
    queryFn: () => apiRequest<PosTable[]>('/api/v1/pos/tables'),
  });
  const quote = useQuery({
    queryKey: ['pos-order-quote', orderId],
    queryFn: () => apiRequest<OrderQuote>(`/api/v1/pos/orders/${orderId}/quote`),
    enabled: !isNew,
    refetchInterval: quotePollingInterval,
  });
  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
  });
  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });

  const selectedTable = useMemo(
    () => tables.data?.find((item) => item.id === preselectedTableId),
    [tables.data, preselectedTableId],
  );

  useEffect(() => {
    const hasRunningTime = quote.data?.time?.status === 'RUNNING';
    if (!hasRunningTime) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now() + serverTimeOffsetMs), 1000);
    return () => window.clearInterval(timer);
  }, [quote.data?.time?.status, serverTimeOffsetMs]);

  useEffect(() => {
    if (!isNew && quote.data && searchParams.get('checkout') === '1') {
      navigateToPayment(quote.data.order.id, true);
    }
  }, [isNew, quote.data, searchParams, navigate]);

  useEffect(() => {
    if (!isNew && quote.data) {
      setOrderNote(quote.data.order.note ?? '');
      if (quote.data.order.guestCount !== undefined) {
        setGuestCount(quote.data.order.guestCount);
      }
      if (quote.data.order.customerName !== undefined) {
        setCustomerName(quote.data.order.customerName ?? '');
      }
      if (quote.data.order.customerPhone !== undefined) {
        setCustomerPhone(quote.data.order.customerPhone ?? '');
      }
      if (quote.data.order.customerId !== undefined)
        setCustomerId(quote.data.order.customerId ?? null);
    }
  }, [isNew, quote.data]);

  const saveGuestCount = async (count: number) => {
    setGuestCount(count);
    if (!isNew && orderId && quote.data) {
      try {
        await jsonRequest(
          `/api/v1/pos/orders/${orderId}/guest`,
          {
            expectedOrderVersion: quote.data.order.version,
            guestCount: Math.max(1, count),
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerId,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        void queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      } catch (err) {
        messageApi.error(errorText(err));
      }
    }
  };

  const saveCustomerInfo = async (customer: CustomerSummary | null) => {
    const name = customer?.name ?? '';
    const phone = customer?.phone ?? '';
    setCustomerId(customer?.id ?? null);
    setCustomerName(name);
    setCustomerPhone(phone);
    if (!isNew && orderId && quote.data) {
      try {
        await jsonRequest(
          `/api/v1/pos/orders/${orderId}/guest`,
          {
            expectedOrderVersion: quote.data.order.version,
            guestCount: Math.max(1, guestCount),
            customerName: name.trim() || null,
            customerPhone: phone.trim() || null,
            customerId: customer?.id ?? null,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        void queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
        messageApi.success(customer ? 'Đã chọn khách hàng.' : 'Đã bỏ chọn khách hàng.');
      } catch (err) {
        messageApi.error(errorText(err));
      }
    }
  };

  const printProvisionalReceipt = async () => {
    if (!quote.data) return;
    const result = await printReceipt({
      data: buildPrintDataFromQuote(quote.data, 'PROVISIONAL'),
      printSettings: printSettings.data,
      storeInfo: {
        storeName: staffContext.data?.storeName ?? null,
        phone: staffContext.data?.storePhone ?? null,
        address: staffContext.data?.storeAddress ?? null,
        bankName: staffContext.data?.bankName ?? null,
        bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
        bankAccountName: staffContext.data?.bankAccountName ?? null,
      },
    });
    if (result.success) messageApi.success('Đã gửi lệnh in phiếu tạm tính!');
    else messageApi.error(result.message ?? 'Không thể in phiếu tạm tính.');
  };

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of catalog.data ?? []) {
      if (product.categoryId && product.categoryName) {
        map.set(product.categoryId, product.categoryName);
      }
    }
    return [...map].map(([id, name]) => ({ id, name }));
  }, [catalog.data]);

  const visibleCatalog = (catalog.data ?? []).filter((product) => {
    const haystack = `${product.productName} ${product.variants.map((variant) => variant.name).join(' ')}`;
    const matchesSearch = haystack
      .toLocaleLowerCase('vi-VN')
      .includes(catalogSearch.trim().toLocaleLowerCase('vi-VN'));
    return matchesSearch && (selectedCategory === 'ALL' || product.categoryId === selectedCategory);
  });
  const isPaymentPending = !isNew && quote.data?.order.status === 'PAYMENT_PENDING';

  const addDraftVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    enteredPrice?: number,
  ) => {
    if (isPaymentPending) {
      messageApi.warning(
        'Đơn hàng đang chờ thanh toán (đã dừng giờ). Bấm "Tiếp tục chơi" để thêm món.',
      );
      return;
    }
    const effectiveVariant =
      variant.promptPrice === 1 ? { ...variant, salePriceVnd: enteredPrice ?? null } : variant;
    if (effectiveVariant.salePriceVnd === null) return;
    if (product.productType === 'WEIGHT') {
      const id = crypto.randomUUID();
      const line: DraftLine = {
        id,
        product,
        variant: effectiveVariant,
        quantityMilli: 1000,
        note: null,
        discountType: null,
        discountInputValue: null,
      };
      setDraftLines((lines) => [...lines, line]);
      setEditingItem({
        source: 'DRAFT',
        id,
        productId: product.productId,
        variantId: effectiveVariant.id,
        productType: product.productType,
        productName: product.productName,
        variantName: effectiveVariant.name,
        unitName: product.unitName,
        unitPriceVnd: effectiveVariant.salePriceVnd,
        quantityMilli: 1000,
        note: '',
        grossLineTotalVnd: effectiveVariant.salePriceVnd,
        discountAmountVnd: 0,
        discountType: null,
        discountInputValue: null,
        netLineTotalVnd: effectiveVariant.salePriceVnd,
        discardOnCancel: true,
      });
      return;
    }
    setDraftLines((lines) => {
      const found = lines.find(
        (line) =>
          line.variant.id === effectiveVariant.id &&
          line.variant.salePriceVnd === effectiveVariant.salePriceVnd,
      );
      if (found) {
        return lines.map((line) =>
          line === found ? { ...line, quantityMilli: line.quantityMilli + 1000 } : line,
        );
      }
      return [
        ...lines,
        {
          id: crypto.randomUUID(),
          product,
          variant: effectiveVariant,
          quantityMilli: 1000,
          note: null,
          discountType: null,
          discountInputValue: null,
        },
      ];
    });
  };

  const addPickingVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    enteredPrice?: number,
  ) => {
    const effectiveVariant =
      variant.promptPrice === 1 ? { ...variant, salePriceVnd: enteredPrice ?? null } : variant;
    if (effectiveVariant.salePriceVnd === null) return;
    if (product.productType === 'WEIGHT') {
      const id = crypto.randomUUID();
      const line: DraftLine = {
        id,
        product,
        variant: effectiveVariant,
        quantityMilli: 1000,
        note: null,
        discountType: null,
        discountInputValue: null,
      };
      setPickingCart((lines) => [...lines, line]);
      return;
    }
    setPickingCart((lines) => {
      const found = lines.find(
        (line) =>
          line.variant.id === effectiveVariant.id &&
          line.variant.salePriceVnd === effectiveVariant.salePriceVnd,
      );
      if (found) {
        return lines.map((line) =>
          line === found ? { ...line, quantityMilli: line.quantityMilli + 1000 } : line,
        );
      }
      return [
        ...lines,
        {
          id: crypto.randomUUID(),
          product,
          variant: effectiveVariant,
          quantityMilli: 1000,
          note: null,
          discountType: null,
          discountInputValue: null,
        },
      ];
    });
  };

  const refreshOrder = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
    ]);
  };

  const chooseProduct = (product: CatalogProduct, event?: React.MouseEvent) => {
    if (product.variants.length > 1) {
      setVariantProduct(product);
      return;
    }
    if (event && isMobile && mobileView === 'PRODUCTS') {
      triggerFlyAnimation(event, product);
    }
    const variant = product.variants[0];
    if (!variant) return;
    chooseVariant(product, variant);
  };

  const triggerFlyAnimation = (e: React.MouseEvent, product: CatalogProduct) => {
    if (!cartIconRef.current) return;
    const target = e.currentTarget as HTMLElement;
    const startRect = target.getBoundingClientRect();
    const cartRect = cartIconRef.current.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - 24;
    const startY = startRect.top + startRect.height / 2 - 24;
    const endX = cartRect.left + cartRect.width / 2 - 24;
    const endY = cartRect.top + cartRect.height / 2 - 24;

    const flyer = document.createElement('div');
    flyer.className = 'staff-flying-item';

    if (product.avatarType === 'IMAGE' && product.mediaId) {
      const img = document.createElement('img');
      img.src = `/api/v1/media/${product.mediaId}`;
      img.alt = product.productName;
      flyer.appendChild(img);
    } else {
      flyer.style.backgroundColor = product.avatarColor || '#0975f7';
      flyer.textContent = getProductInitials(product.productName);
    }

    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyer.style.setProperty('--end-x', `${endX}px`);
    flyer.style.setProperty('--end-y', `${endY}px`);

    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
      flyer.classList.add('is-flying');
    });

    setTimeout(() => {
      flyer.remove();
      cartIconRef.current?.classList.add('staff-cart-bounce');
      setTimeout(() => cartIconRef.current?.classList.remove('staff-cart-bounce'), 450);
    }, 550);
  };

  const chooseVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    event?: React.MouseEvent,
  ) => {
    if (event && isMobile && mobileView === 'PRODUCTS') {
      triggerFlyAnimation(event, product);
    }
    setVariantProduct(null);
    if (variant.promptPrice === 1 || variant.salePriceVnd === null) {
      setPromptTarget({ product, variant });
      setPromptPrice(null);
    } else if (isMobile && mobileView === 'PRODUCTS') {
      addPickingVariant(product, variant);
    } else {
      addDraftVariant(product, variant);
    }
  };

  const confirmPromptPrice = () => {
    if (!promptTarget || promptPrice === null || promptPrice < 0) return;
    if (isMobile && mobileView === 'PRODUCTS') {
      addPickingVariant(promptTarget.product, promptTarget.variant, promptPrice);
    } else {
      addDraftVariant(promptTarget.product, promptTarget.variant, promptPrice);
    }
    setPromptTarget(null);
    setPromptPrice(null);
  };

  const persistLines = async (createdOrderId: string, startingVersion: number) => {
    let version = startingVersion;
    for (const line of draftLines) {
      // Items are intentionally sequential because each command advances the order version.
      // eslint-disable-next-line no-await-in-loop
      await jsonRequest(
        `/api/v1/pos/orders/${createdOrderId}/items`,
        {
          productId: line.product.productId,
          variantId: line.variant.id,
          enteredUnitPriceVnd:
            line.variant.promptPrice === 1 ? line.variant.salePriceVnd : undefined,
          quantityMilli: line.quantityMilli,
          expectedOrderVersion: version,
          note: line.note,
          discount:
            line.discountType && line.discountInputValue !== null
              ? { type: line.discountType, value: line.discountInputValue }
              : null,
        },
        { headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    return version;
  };

  const completeCreatedOrder = async (createdOrderId: string, checkoutAfterSave: boolean) => {
    await refreshOrder();
    await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
    await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
    if (checkoutAfterSave) {
      navigate(`/pos/orders/${createdOrderId}?checkout=1`, { replace: true });
    } else {
      messageApi.success('Lưu đơn hàng thành công.');
      navigate('/pos', { replace: true });
    }
  };

  const saveWithTable = async (table: PosTable, checkoutAfterSave = false) => {
    setSaving(true);
    try {
      const opened = await jsonRequest<{ orderId: string }>(
        '/api/v1/pos/tables/open',
        { tableId: table.id, expectedTableVersion: table.version },
        { headers: mutationHeaders(csrf) },
      );
      let version = await persistLines(opened.orderId, 1);
      if (orderNote.trim()) {
        await jsonRequest(
          `/api/v1/pos/orders/${opened.orderId}/note`,
          { expectedOrderVersion: version, note: orderNote.trim() },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        version += 1;
      }
      if (guestCount > 1 || customerName.trim() || customerPhone.trim()) {
        await jsonRequest(
          `/api/v1/pos/orders/${opened.orderId}/guest`,
          {
            expectedOrderVersion: version,
            guestCount: Math.max(1, guestCount),
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerId,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        version += 1;
      }
      await completeCreatedOrder(opened.orderId, checkoutAfterSave);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
      setTableModalOpen(false);
    }
  };

  const saveOrder = async () => {
    if (isNew && orderType === 'TAKEAWAY' && draftLines.length === 0) {
      messageApi.warning('Vui lòng chọn ít nhất một mặt hàng cho đơn mang đi.');
      return;
    }
    if (orderType === 'DINE_IN') {
      const table = selectedTable ?? tables.data?.find((item) => item.id === preselectedTableId);
      if (table?.status === 'AVAILABLE') return saveWithTable(table, false);
      setTableAction('SAVE');
      setTableModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      const created = await jsonRequest<{ orderId: string }>(
        '/api/v1/pos/orders',
        { note: orderNote.trim() || null },
        { headers: mutationHeaders(csrf) },
      );
      let version = await persistLines(created.orderId, 1);
      if (guestCount > 1 || customerName.trim() || customerPhone.trim()) {
        await jsonRequest(
          `/api/v1/pos/orders/${created.orderId}/guest`,
          {
            expectedOrderVersion: version,
            guestCount: Math.max(1, guestCount),
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerId,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        version += 1;
      }
      await completeCreatedOrder(created.orderId, false);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const saveAdditionalItems = async (openPaymentAfterSave = false) => {
    if (!quote.data) return;
    if (draftLines.length === 0) {
      if (openPaymentAfterSave) {
        navigateToPayment(quote.data.order.id);
      } else {
        messageApi.success('Lưu đơn hàng thành công.');
        navigate('/pos', { replace: true });
      }
      return;
    }
    setSaving(true);
    try {
      await persistLines(quote.data.order.id, quote.data.order.version);
      setDraftLines([]);
      await refreshOrder();
      await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
      messageApi.success('Lưu đơn hàng thành công.');
      if (openPaymentAfterSave) {
        navigateToPayment(quote.data.order.id);
      } else {
        navigate('/pos', { replace: true });
      }
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const handleResumeCheckout = async (automatic = false) => {
    if (!quote.data || resuming) return false;
    const frozenQuote = quote.data;
    setResuming(true);
    try {
      const sendResume = (expectedOrderVersion: number) =>
        jsonRequest<{
          orderId: string;
          status: 'OPEN';
          resumedAt: number;
          quote: OrderQuote;
        }>(
          `/api/v1/pos/orders/${frozenQuote.order.id}/resume-checkout`,
          { expectedOrderVersion },
          { headers: mutationHeaders(csrf) },
        );

      let result;
      try {
        result = await sendResume(frozenQuote.order.version);
      } catch (error) {
        const refreshed = await apiRequest<OrderQuote>(
          `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
        );
        if (!refreshed.time || refreshed.order.status === 'OPEN') {
          queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], (cached) =>
            !cached || refreshed.order.version >= cached.order.version ? refreshed : cached,
          );
          clearPaymentPageActive(frozenQuote.order.id);
          void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
          void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
          setResumeModalOpen(false);
          return true;
        }
        if (
          refreshed.order.status !== 'PAYMENT_PENDING' ||
          refreshed.order.version === frozenQuote.order.version
        ) {
          throw error;
        }
        result = await sendResume(refreshed.order.version);
      }
      const openQuote: OrderQuote = {
        ...result.quote,
        order: {
          ...result.quote.order,
          status: 'OPEN',
        },
      };
      queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], (cached) =>
        !cached || openQuote.order.version >= cached.order.version ? openQuote : cached,
      );
      clearPaymentPageActive(frozenQuote.order.id);
      void queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
      messageApi.success(`Đã tiếp tục tính giờ cho ${frozenQuote.order.tableName}`);
      setResumeModalOpen(false);
      return true;
    } catch (error) {
      if (!automatic) messageApi.error(errorText(error));
      return false;
    } finally {
      setResuming(false);
    }
  };

  useEffect(() => {
    const currentQuote = quote.data;
    if (
      !currentQuote?.time ||
      currentQuote.order.status !== 'PAYMENT_PENDING' ||
      !isReturningFromPayment(currentQuote.order.id, currentQuote.order.version) ||
      autoResumePaymentInFlightRef.current
    ) {
      return;
    }
    let retryTimer: number | null = null;
    autoResumePaymentInFlightRef.current = true;
    void handleResumeCheckout(true)
      .then((resumed) => {
        if (!resumed) {
          retryTimer = window.setTimeout(
            () => setAutoResumeRetryToken((token) => token + 1),
            1_000,
          );
        }
      })
      .finally(() => {
        autoResumePaymentInFlightRef.current = false;
      });
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [autoResumeRetryToken, quote.data]);

  const handleOpenTableQrModal = async () => {
    const tableId = quote.data?.order.tableId ?? selectedTable?.id ?? preselectedTableId;
    const tableName = quote.data?.order.tableName ?? selectedTable?.name ?? 'Bàn';
    if (!tableId) {
      messageApi.warning('Vui lòng chọn bàn/phòng để lấy mã QR Order.');
      return;
    }
    setTableQrLoading(true);
    try {
      const result = await apiRequest<{ token: string; path: string }>(
        `/api/v1/pos/tables/${tableId}/qr-code`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrf ?? '' },
        },
      );
      const url = new URL(result.path, window.location.origin).toString();
      const qrImage = await QRCode.toDataURL(url, {
        width: 640,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      setTableQrData({
        tableName,
        url,
        image: qrImage,
        ...(quote.data?.order.displayCode || (orderId && orderId !== 'new')
          ? {
              orderCode: quote.data?.order.displayCode || `D-${orderId!.slice(0, 8).toUpperCase()}`,
            }
          : {}),
      });
      setTableQrModalOpen(true);
    } catch (error) {
      messageApi.error(errorText(error) || 'Không thể tạo mã QR Order của bàn.');
    } finally {
      setTableQrLoading(false);
    }
  };

  const beginCheckout = async () => {
    if (isNew && orderType === 'TAKEAWAY' && draftLines.length === 0) {
      messageApi.warning('Vui lòng chọn ít nhất một mặt hàng cho đơn mang đi.');
      return;
    }
    if (!isNew) {
      if (isPaymentPending) {
        navigateToPayment(quote.data!.order.id);
        return;
      }
      if (quote.data?.time) {
        setStoppingTime(true);
        try {
          let currentVersion = quote.data.order.version;
          if (draftLines.length > 0) {
            currentVersion = await persistLines(quote.data.order.id, currentVersion);
            setDraftLines([]);
          }
          const result = await jsonRequest<{
            orderId: string;
            status: 'PAYMENT_PENDING';
            stoppedAt: number;
            quote: OrderQuote;
          }>(
            `/api/v1/pos/orders/${quote.data.order.id}/stop-time`,
            { expectedOrderVersion: currentVersion },
            { headers: mutationHeaders(csrf) },
          );
          const pendingQuote: OrderQuote = {
            ...result.quote,
            order: {
              ...result.quote.order,
              status: 'PAYMENT_PENDING',
            },
          };
          queryClient.setQueryData<OrderQuote>(
            ['pos-order-quote', quote.data.order.id],
            (cached) =>
              !cached || pendingQuote.order.version >= cached.order.version ? pendingQuote : cached,
          );
          void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
          void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
          navigateToPayment(quote.data.order.id);
        } catch (error) {
          messageApi.error(errorText(error));
        } finally {
          setStoppingTime(false);
        }
        return;
      }
      await saveAdditionalItems(true);
      return;
    }
    if (orderType === 'DINE_IN') {
      const table = selectedTable ?? tables.data?.find((item) => item.id === preselectedTableId);
      if (table?.status === 'AVAILABLE') {
        await saveWithTable(table, true);
        return;
      }
      setTableAction('CHECKOUT');
      setTableModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      const created = await jsonRequest<{ orderId: string }>(
        '/api/v1/pos/orders',
        { note: orderNote.trim() || null },
        { headers: mutationHeaders(csrf) },
      );
      await persistLines(created.orderId, 1);
      await completeCreatedOrder(created.orderId, true);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const updateExistingItem = async (input: {
    id: string;
    quantityMilli: number;
    variantId?: string | null | undefined;
    discount?: null | { type: 'FIXED' | 'PERCENT'; value: number } | undefined;
    note: string | null;
  }) => {
    if (!quote.data) return;
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/items/${input.id}`,
        {
          expectedOrderVersion: quote.data.order.version,
          quantityMilli: input.quantityMilli,
          variantId: input.variantId,
          discount: input.discount,
          note: input.note,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      setEditingItem(null);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    }
  };

  const handleDeleteItemConfirm = async () => {
    if (!deleteItemTarget || !deleteItemReason.trim()) return;
    try {
      setDeletingItem(true);
      const isDraftItem =
        deleteItemTarget.source === 'DRAFT' ||
        isNew ||
        draftLines.some((line) => line.id === deleteItemTarget.id);

      if (isDraftItem) {
        setDraftLines((lines) => lines.filter((line) => line.id !== deleteItemTarget.id));
        setDeleteItemModalOpen(false);
        setDeleteItemTarget(null);
        setDeleteItemReason('');
        messageApi.success('Đã xóa mặt hàng khỏi đơn.');
      } else {
        if (!quote.data) {
          setDeleteItemModalOpen(false);
          setDeleteItemTarget(null);
          setDeleteItemReason('');
          return;
        }
        await jsonRequest(
          `/api/v1/pos/orders/${quote.data.order.id}/items/${deleteItemTarget.id}`,
          { expectedOrderVersion: quote.data.order.version, reason: deleteItemReason.trim() },
          { method: 'DELETE', headers: mutationHeaders(csrf) },
        );
        setDeleteItemModalOpen(false);
        setDeleteItemTarget(null);
        setDeleteItemReason('');
        messageApi.success('Đã xóa mặt hàng khỏi đơn.');
        await refreshOrder();
      }
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setDeletingItem(false);
    }
  };

  const handleDeleteTimeConfirm = async () => {
    if (!deleteTimeReason.trim()) return;
    if (isNew || !quote.data) {
      setDeleteTimeModalOpen(false);
      setDeleteTimeReason('');
      setTimeDetailOpen(false);
      setTimeRemoved(true);
      return;
    }
    try {
      setDeletingTime(true);
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/time`,
        { expectedOrderVersion: quote.data.order.version, reason: deleteTimeReason.trim() },
        { method: 'DELETE', headers: mutationHeaders(csrf) },
      );
      setDeleteTimeModalOpen(false);
      setDeleteTimeReason('');
      setTimeDetailOpen(false);
      setTimeRestoringDraft(false);
      messageApi.success('Đã xóa tiền giờ mặc định của bàn.');
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setDeletingTime(false);
    }
  };

  const saveOrderNote = async () => {
    if (isNew || !quote.data) {
      setOrderNoteOpen(false);
      return;
    }
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/note`,
        { expectedOrderVersion: quote.data.order.version, note: orderNote.trim() || null },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      setOrderNoteOpen(false);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    }
  };

  const handlePauseTimeInModal = () => {
    const nowStr = formatDateTimeInput(Date.now());
    setTimeRangeDraft((prev) => ({ ...prev, endedAt: nowStr }));
    messageApi.info('Đã điền giờ hiện tại vào ô Giờ ra. Hãy bấm "Lưu thay đổi" để lưu lại.');
  };

  const handleResumeTimeInModal = () => {
    setTimeRangeDraft((prev) => ({ ...prev, endedAt: '' }));
    messageApi.info('Đã xóa Giờ ra để tiếp tục tính giờ. Hãy bấm "Lưu thay đổi" để lưu lại.');
  };

  const openTimeDetails = () => {
    if (quote.data?.time) {
      setTimeRangeDraft({
        startedAt: formatDateTimeInput(quote.data.time.startedAtMs),
        endedAt: quote.data.time.endedAtMs ? formatDateTimeInput(quote.data.time.endedAtMs) : '',
      });
      setTimeDetailOpen(true);
    } else if (timeRestoringDraft) {
      setTimeDetailOpen(true);
    }
  };

  const saveTimeRange = async () => {
    if (!quote.data) return;
    if (!timeRangeDraft.startedAt) {
      messageApi.warning('Vui lòng chọn giờ vào.');
      return;
    }
    const startedAtMs = new Date(timeRangeDraft.startedAt).getTime();
    const endedAtMs = timeRangeDraft.endedAt ? new Date(timeRangeDraft.endedAt).getTime() : null;
    if (
      !Number.isFinite(startedAtMs) ||
      (endedAtMs !== null && (!Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs))
    ) {
      messageApi.warning('Giờ ra phải sau giờ vào.');
      return;
    }
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/time/range`,
        {
          expectedOrderVersion: quote.data.order.version,
          startedAtMs,
          endedAtMs,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      await refreshOrder();
      setTimeDetailOpen(false);
      setTimeRestoringDraft(false);
      messageApi.success('Đã lưu thông tin tính giờ thành công.');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const transferTo = async (table: PosTable) => {
    if (!quote.data?.order.tableId) return;
    const source = tables.data?.find((item) => item.id === quote.data!.order.tableId);
    if (!source) return;
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/transfer`,
        {
          targetTableId: table.id,
          expectedOrderVersion: quote.data.order.version,
          expectedSourceTableVersion: source.version,
          expectedTargetTableVersion: table.version,
        },
        { headers: mutationHeaders(csrf) },
      );
      setTransferOpen(false);
      messageApi.success(`Đã chuyển ${source.name} → ${table.name}`);
      await Promise.all([
        refreshOrder(),
        queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      ]);
    } catch (error) {
      messageApi.error(errorText(error));
      throw error;
    }
  };

  const cancelOrder = async () => {
    if (!quote.data || !cancelReason.trim()) return;
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/cancel`,
        { expectedOrderVersion: quote.data.order.version, reason: cancelReason.trim() },
        { headers: mutationHeaders(csrf) },
      );
      await refreshOrder();
      navigate('/pos', { replace: true });
    } catch (error) {
      messageApi.error(errorText(error));
    }
  };

  const draftDisplayItems = draftLines.map((line) => {
    const quantityMilli = line.quantityMilli;
    const unitPriceVnd = line.variant.salePriceVnd ?? 0;
    const gross = calculateLineTotal(unitPriceVnd, quantityMilli);
    const discount = calculateDiscountAmount(gross, line.discountType, line.discountInputValue);
    const net = gross - discount;
    return {
      id: line.id,
      productId: line.product.productId,
      variantId: line.variant.id,
      productType: line.product.productType,
      productName: line.product.productName,
      variantName: line.variant.name,
      unitName: line.product.unitName,
      unitPriceVnd,
      quantityMilli,
      grossLineTotalVnd: gross,
      discountAmountVnd: discount,
      discountType: line.discountType,
      discountInputValue: line.discountInputValue,
      netLineTotalVnd: net,
      note: line.note,
    };
  });
  const allCurrentItems = isNew
    ? draftDisplayItems
    : [...(quote.data?.items ?? []), ...draftDisplayItems];
  const displayedItems = isNew ? draftDisplayItems : (quote.data?.items ?? []);

  // 1. Tiền hàng (mặt hàng số lượng và trọng lượng)
  const regularProductGross = allCurrentItems.reduce(
    (sum, item) => sum + item.grossLineTotalVnd,
    0,
  );
  const regularProductDiscount = allCurrentItems.reduce(
    (sum, item) => sum + item.discountAmountVnd,
    0,
  );
  const regularProductCount = allCurrentItems.length;

  // Tiền trong giỏ hàng tạm khi chọn món
  const pickingCartTotal = useMemo(() => {
    return pickingCart.reduce(
      (sum, line) => sum + calculateLineTotal(line.variant.salePriceVnd ?? 0, line.quantityMilli),
      0,
    );
  }, [pickingCart]);

  const pickingCartCount = useMemo(() => {
    return pickingCart.reduce((sum, line) => sum + line.quantityMilli / 1000, 0);
  }, [pickingCart]);

  // 2. Tiền giờ (phiên tính giờ của bàn)
  const totalTimeGross = quote.data?.time ? quote.data.time.amountAfterRoundingVnd : 0;

  // 3. Giảm giá và Tổng khách phải trả
  const totalDiscount = regularProductDiscount;
  const pendingTotal = draftDisplayItems.reduce((sum, item) => sum + item.netLineTotalVnd, 0);
  const displayedTotal = isNew ? pendingTotal : (quote.data?.totalVnd ?? 0) + pendingTotal;
  const liveElapsedSeconds = quote.data?.time
    ? quote.data.time.elapsedSeconds +
      (quote.data.time.status === 'RUNNING'
        ? Math.max(0, Math.floor((clockNow - quote.dataUpdatedAt) / 1000))
        : 0)
    : 0;

  return (
    <div className="staff-order-editor">
      {holder}

      {isMobile ? (
        mobileView === 'PRODUCTS' ? (
          <div className="staff-product-picker-mobile">
            {/* Header with Close Button */}
            <header className="staff-product-picker-mobile__header">
              <button
                type="button"
                className="staff-product-picker-mobile__close-btn"
                onClick={() => {
                  setPickingCart([]);
                  setCartPreviewOpen(false);
                  setMobileView('CART');
                }}
                aria-label="Thoát chọn món"
              >
                <CloseOutlined />
              </button>
              <div className="staff-product-picker-mobile__title">Chọn mặt hàng</div>
              <div className="staff-product-picker-mobile__header-space" />
            </header>

            {/* Search Bar */}
            <div className="staff-product-picker-mobile__search">
              <Input
                size="large"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="Tìm kiếm mặt hàng"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
            </div>

            {/* Categories & Products Layout */}
            <div className="staff-product-picker-mobile__body-split">
              <aside className="staff-product-picker-mobile__cats-col">
                <button
                  type="button"
                  className={`staff-product-picker-cat-btn ${selectedCategory === 'ALL' ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory('ALL')}
                >
                  <AppstoreOutlined className="staff-product-picker-cat-btn__icon" />
                  <span>Tất cả</span>
                </button>
                {categories.map((cat) => (
                  <button
                    type="button"
                    key={cat.id}
                    className={`staff-product-picker-cat-btn ${selectedCategory === cat.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <ShopOutlined className="staff-product-picker-cat-btn__icon" />
                    <span>{cat.name}</span>
                  </button>
                ))}
              </aside>

              <main className="staff-product-picker-mobile__products-col">
                <div className="staff-product-picker-mobile__section-heading">
                  <span>
                    {selectedCategory === 'ALL'
                      ? 'Tất cả'
                      : (categories.find((c) => c.id === selectedCategory)?.name ?? 'Danh sách')}
                  </span>
                  {auth.actor?.kind === 'OWNER' ||
                  (staffContext.data?.permissions ?? []).includes('catalog.manage') ? (
                    <Button
                      type="link"
                      size="small"
                      icon={<TagsOutlined />}
                      onClick={() => navigate('/pos/catalog')}
                    >
                      Quản lý món
                    </Button>
                  ) : null}
                </div>
                {catalog.isLoading ? (
                  <Skeleton active />
                ) : visibleCatalog.length === 0 ? (
                  <Empty description="Không tìm thấy sản phẩm" style={{ marginTop: 40 }} />
                ) : (
                  <div className="staff-product-picker-mobile__grid">
                    {visibleCatalog.map((product) => {
                      const prices = product.variants
                        .map((v) => v.salePriceVnd)
                        .filter((p): p is number => p !== null);
                      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                      const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
                      return (
                        <button
                          type="button"
                          key={product.productId}
                          className="staff-product-mobile-card"
                          onClick={(e) => chooseProduct(product, e)}
                        >
                          <div
                            className={`staff-product-mobile-card__visual ${product.avatarType === 'IMAGE' && product.mediaId ? 'has-image' : 'has-color'} ${product.avatarColor ? 'has-custom-color' : ''}`}
                            style={{
                              background: product.avatarColor || '#f8fafc',
                            }}
                          >
                            {product.avatarType === 'IMAGE' && product.mediaId ? (
                              <img src={`/api/v1/media/${product.mediaId}`} alt="" />
                            ) : (
                              getProductInitials(product.productName)
                            )}
                          </div>
                          <strong className="staff-product-mobile-card__name">
                            {product.productName}
                          </strong>
                          {product.variants.length > 1 ? (
                            <small className="staff-product-mobile-card__variant">
                              {product.variants.length} phiên bản
                            </small>
                          ) : null}
                          <b className="staff-product-mobile-card__price">
                            {minPrice === null
                              ? 'Nhập giá'
                              : minPrice === maxPrice
                                ? `${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`
                                : `Từ ${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`}
                          </b>
                        </button>
                      );
                    })}
                  </div>
                )}
              </main>
            </div>

            {/* Bottom Bar: [ 🛒 6 ] | 370,000đ | [ Tiếp tục ] */}
            <div className="staff-product-picker-mobile__bottom-bar">
              <button
                type="button"
                className="staff-product-picker-mobile__cart-btn"
                ref={cartIconRef}
                onClick={() => {
                  if (pickingCart.length === 0) {
                    messageApi.info('Chưa có món nào trong giỏ hàng.');
                    return;
                  }
                  setCartPreviewOpen(true);
                }}
              >
                <ShoppingCartOutlined />
                <span className="staff-product-picker-mobile__cart-count">{pickingCartCount}</span>
              </button>
              <div className="staff-product-picker-mobile__bottom-actions">
                <b className="staff-product-picker-mobile__bottom-price">
                  {formatMoney(pickingCartTotal)}
                </b>
                <Button
                  type="primary"
                  size="large"
                  onClick={() => {
                    if (pickingCart.length === 0) {
                      messageApi.warning('Vui lòng chọn ít nhất một món vào giỏ hàng.');
                      return;
                    }
                    // Xác nhận thêm các món từ pickingCart vào đơn hàng (draftLines)
                    setDraftLines((prev) => {
                      const next = [...prev];
                      for (const line of pickingCart) {
                        const found = next.find(
                          (l) =>
                            l.variant.id === line.variant.id &&
                            l.variant.salePriceVnd === line.variant.salePriceVnd &&
                            l.note === line.note,
                        );
                        if (found && line.product.productType !== 'WEIGHT') {
                          found.quantityMilli += line.quantityMilli;
                        } else {
                          next.push(line);
                        }
                      }
                      return next;
                    });
                    setPickingCart([]);
                    setCartPreviewOpen(false);
                    setMobileView('CART');
                    messageApi.success('Đã thêm các món vào đơn hàng.');
                  }}
                  className="staff-product-picker-mobile__done-btn"
                >
                  Tiếp tục
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="staff-order-mobile-view">
            {/* Mobile Header */}
            <header className="staff-order-mobile-header">
              <button
                type="button"
                className="staff-order-mobile-back-btn"
                onClick={handleExit}
                aria-label="Quay lại danh sách"
              >
                <LeftOutlined />
              </button>
              <div className="staff-order-mobile-title-wrap">
                <div className="staff-order-mobile-code">
                  {isNew
                    ? orderType === 'DINE_IN' && selectedTable
                      ? selectedTable.name
                      : 'Tạo đơn mới'
                    : quote.data?.order.displayCode ||
                      (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                </div>
                <div className="staff-order-mobile-sub">
                  <span className="staff-order-mobile-type-icon">
                    <ShopOutlined />
                  </span>
                  <span>
                    {orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang đi'} -{' '}
                    {formatDateTime(isNew ? clockNow : (quote.data?.order.openedAt ?? clockNow))}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="staff-order-mobile-dots-btn"
                onClick={() => setMobileActionsOpen(true)}
                aria-label="Thao tác khác"
              >
                <EllipsisOutlined />
              </button>
            </header>

            {/* Mobile Quick Pills Row: Order Type, Area/Table & Guest Count */}
            <div className="staff-order-mobile-pills">
              <Select
                size="middle"
                value={isNew ? orderType : quote.data?.order.orderType}
                options={[
                  { value: 'DINE_IN', label: 'Tại chỗ' },
                  { value: 'TAKEAWAY', label: 'Mang đi' },
                ]}
                disabled={!isNew}
                onChange={(value) => {
                  const nextType = value as 'DINE_IN' | 'TAKEAWAY';
                  setOrderType(nextType);
                  if (nextType === 'TAKEAWAY') {
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('tableId');
                        return next;
                      },
                      { replace: true },
                    );
                  }
                }}
                className="staff-order-mobile-type-select"
                aria-label="Loại đơn"
              />

              {orderType === 'DINE_IN' && (
                <button
                  type="button"
                  className="staff-order-pill"
                  onClick={() => {
                    if (isNew) {
                      setTableAction('SELECT');
                      setTableModalOpen(true);
                    }
                  }}
                >
                  <span className="staff-order-pill__label">
                    {quote.data?.order.tableName
                      ? `${quote.data.order.areaName ? `${quote.data.order.areaName} - ` : ''}${quote.data.order.tableName}`
                      : selectedTable
                        ? `${selectedTable.areaName ? `${selectedTable.areaName} - ` : ''}${selectedTable.name}`
                        : 'Chọn bàn / khu vực'}
                  </span>
                  <span className="staff-order-pill__tag">+1</span>
                  <DownOutlined className="staff-order-pill__arrow" />
                </button>
              )}

              <button
                type="button"
                className="staff-order-pill staff-order-pill--guest"
                onClick={() => setGuestModalOpen(true)}
              >
                <span>{guestCount} khách</span>
                <DownOutlined className="staff-order-pill__arrow" />
              </button>
            </div>

            {/* Mobile Customer Row */}
            <div className="staff-order-mobile-customer" onClick={() => setCustomerModalOpen(true)}>
              <div className="staff-order-mobile-customer__info">
                {customerName ? (
                  <>
                    <strong>{customerName}</strong>
                    {customerPhone && <small>{customerPhone}</small>}
                  </>
                ) : (
                  <span>Thêm khách hàng</span>
                )}
              </div>
              <PlusCircleOutlined className="staff-order-mobile-customer__icon" />
            </div>

            {/* Mobile Ordered Items Section */}
            <div className="staff-order-mobile-items-section">
              <div
                className="staff-order-mobile-section-header"
                onClick={() => setOrderedItemsCollapsed((prev) => !prev)}
              >
                <span className="staff-order-mobile-section-title">
                  Mặt hàng đã gọi (
                  {allCurrentItems.length +
                    (quote.data?.time ||
                    (isNew &&
                      orderType === 'DINE_IN' &&
                      selectedTable?.timeProductId &&
                      !timeRemoved) ||
                    timeRestoringDraft
                      ? 1
                      : 0)}
                  )
                </span>
                <button
                  type="button"
                  className="staff-order-mobile-collapse-btn"
                  aria-label="Thu gọn/Mở rộng"
                >
                  {orderedItemsCollapsed ? <DownOutlined /> : <UpOutlined />}
                </button>
              </div>

              {!orderedItemsCollapsed && (
                <div className="staff-order-mobile-items-list">
                  {/* Small restore button if default time was deleted */}
                  {(!isNew &&
                    quote.data?.order.orderType === 'DINE_IN' &&
                    !quote.data?.time &&
                    !timeRestoringDraft) ||
                  (isNew &&
                    orderType === 'DINE_IN' &&
                    selectedTable?.timeProductId &&
                    timeRemoved) ? (
                    <div style={{ padding: '8px 16px 4px' }}>
                      <Button
                        size="small"
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          if (isNew) {
                            setTimeRemoved(false);
                          } else {
                            setTimeRestoringDraft(true);
                            setTimeRangeDraft({ startedAt: '', endedAt: '' });
                            setTimeDetailOpen(true);
                          }
                        }}
                        style={{
                          fontSize: 12.5,
                          color: '#0975F7',
                          borderColor: '#91caff',
                          borderRadius: 6,
                          fontWeight: 500,
                        }}
                      >
                        Khôi phục tính giờ
                      </Button>
                    </div>
                  ) : null}

                  {/* 1. Time line item (if present or new dine-in table with pricing configured or restoring) */}
                  {quote.data?.time ? (
                    <div
                      className="staff-order-mobile-item staff-order-mobile-item--time"
                      onClick={openTimeDetails}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-qty-badge">1 x</span>
                        <span className="staff-order-mobile-item__name">
                          <strong>
                            {quote.data.time.tableSegments &&
                            quote.data.time.tableSegments.length > 1
                              ? 'Tiền giờ (Chuyển bàn)'
                              : 'Giờ'}
                          </strong>
                        </span>
                        <span className="staff-order-mobile-item__price">
                          {formatMoney(quote.data.time.amountAfterRoundingVnd)}
                        </span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: {formatDateTime(quote.data.time.startedAtMs)}</div>
                        <div>
                          Tới:{' '}
                          {quote.data.time.endedAtMs
                            ? formatDateTime(quote.data.time.endedAtMs)
                            : 'Hiện tại'}
                        </div>
                        <div>
                          Tổng thời gian tạm tính: {formatDurationVietnamese(liveElapsedSeconds)}
                        </div>
                        {quote.data.time.tableSegments &&
                          quote.data.time.tableSegments.length > 1 && (
                            <div className="staff-order-mobile-item__chain">
                              Bàn:{' '}
                              {quote.data.time.tableSegments.map((s) => s.tableName).join(' → ')}
                            </div>
                          )}
                      </div>
                    </div>
                  ) : isNew &&
                    orderType === 'DINE_IN' &&
                    selectedTable?.timeProductId &&
                    !timeRemoved ? (
                    <div
                      className="staff-order-mobile-item staff-order-mobile-item--time"
                      onClick={() => {
                        setTableAction('SELECT');
                        setTableModalOpen(true);
                      }}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-qty-badge">1 x</span>
                        <span className="staff-order-mobile-item__name">
                          <strong>Giờ</strong>
                        </span>
                        <span className="staff-order-mobile-item__price">0 đ</span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: --:--:--</div>
                        <div>Tới: --:--:--</div>
                        <div>Tổng thời gian tạm tính: --:--:--</div>
                      </div>
                    </div>
                  ) : timeRestoringDraft ? (
                    <div
                      className="staff-order-mobile-item staff-order-mobile-item--time"
                      onClick={openTimeDetails}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-qty-badge">1 x</span>
                        <span className="staff-order-mobile-item__name">
                          <strong>Giờ</strong>
                        </span>
                        <span className="staff-order-mobile-item__price">0 đ</span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: --:--:--</div>
                        <div>Tới: --:--:--</div>
                        <div>Tổng thời gian tạm tính: --:--:--</div>
                      </div>
                    </div>
                  ) : null}

                  {/* 2. Draft items (Sản phẩm gọi thêm) */}
                  {draftDisplayItems.map((item) => (
                    <div
                      key={item.id}
                      className="staff-order-mobile-item staff-order-mobile-item--draft"
                      onClick={() =>
                        setEditingItem({
                          source: 'DRAFT',
                          ...item,
                          note: item.note ?? '',
                        })
                      }
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-qty-badge">
                          {formatItemQuantity(item.productType, item.quantityMilli, item.unitName)}
                        </span>
                        <span className="staff-order-mobile-item__name">
                          <strong>{item.productName}</strong>
                          {item.variantName && item.variantName !== 'Mặc định' && (
                            <small> · {item.variantName}</small>
                          )}
                          <span className="staff-order-mobile-draft-tag">Mới gọi</span>
                          {item.note && (
                            <div className="staff-order-mobile-item__note">
                              Ghi chú: {item.note}
                            </div>
                          )}
                        </span>
                        <span className="staff-order-mobile-item__price">
                          {formatMoney(item.netLineTotalVnd)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* 3. Saved items */}
                  {(quote.data?.items ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="staff-order-mobile-item"
                      onClick={() =>
                        setEditingItem({
                          source: 'SAVED',
                          id: item.id,
                          productId: item.productId,
                          variantId: item.variantId,
                          productType: item.productType,
                          productName: item.productName,
                          variantName: item.variantName,
                          unitName: item.unitName,
                          unitPriceVnd: item.unitPriceVnd,
                          quantityMilli: item.quantityMilli,
                          note: item.note ?? '',
                          grossLineTotalVnd: item.grossLineTotalVnd,
                          discountAmountVnd: item.discountAmountVnd,
                          discountType: item.discountType,
                          discountInputValue: item.discountInputValue,
                          netLineTotalVnd: item.netLineTotalVnd,
                        })
                      }
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-qty-badge">
                          {formatItemQuantity(item.productType, item.quantityMilli, item.unitName)}
                        </span>
                        <span className="staff-order-mobile-item__name">
                          <strong>{item.productName}</strong>
                          {item.variantName && item.variantName !== 'Mặc định' && (
                            <small> · {item.variantName}</small>
                          )}
                          {item.note && (
                            <div className="staff-order-mobile-item__note">
                              Ghi chú: {item.note}
                            </div>
                          )}
                        </span>
                        <span className="staff-order-mobile-item__price">
                          {formatMoney(item.netLineTotalVnd)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {allCurrentItems.length === 0 &&
                    !(
                      isNew &&
                      orderType === 'DINE_IN' &&
                      selectedTable?.timeProductId &&
                      !timeRemoved
                    ) &&
                    !quote.data?.time &&
                    !timeRestoringDraft && (
                      <div className="staff-order-mobile-empty">
                        <p>Chưa có mặt hàng nào trong đơn</p>
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setPickingCart([]);
                            setCartPreviewOpen(false);
                            setMobileView('PRODUCTS');
                          }}
                        >
                          Chọn món ngay
                        </Button>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Mobile Order Note Row */}
            <div className="staff-order-mobile-note" onClick={() => setOrderNoteOpen(true)}>
              <div className="staff-order-mobile-note__content">
                <strong>Ghi chú đơn hàng</strong>
                {orderNote ? (
                  <div className="staff-order-mobile-note__text">{orderNote}</div>
                ) : null}
              </div>
              <EditOutlined className="staff-order-mobile-note__icon" />
            </div>

            {/* Floating "+ Thêm món" Button */}
            <button
              type="button"
              className="staff-order-mobile-fab"
              onClick={() => {
                setPickingCart([]);
                setCartPreviewOpen(false);
                setMobileView('PRODUCTS');
              }}
            >
              <PlusOutlined />
              <span>Thêm món</span>
            </button>

            {/* Sticky Bottom Billing Summary & Actions */}
            <div className="staff-order-mobile-footer">
              <div className="staff-order-mobile-summary">
                <div className="staff-order-mobile-summary__title">Tổng tiền</div>
                <div className="staff-order-mobile-summary__row">
                  <span>Tổng tiền hàng ({regularProductCount} món)</span>
                  <span>{formatMoney(regularProductGross)}</span>
                </div>
                {totalTimeGross > 0 && (
                  <div className="staff-order-mobile-summary__row">
                    <span>Tiền giờ</span>
                    <span>{formatMoney(totalTimeGross)}</span>
                  </div>
                )}
                {totalDiscount > 0 && (
                  <div className="staff-order-mobile-summary__row">
                    <span>Giảm giá</span>
                    <span className="text-danger">-{formatMoney(totalDiscount)}</span>
                  </div>
                )}
                <div className="staff-order-mobile-summary__total-row">
                  <strong>Khách phải trả</strong>
                  <strong>{formatMoney(displayedTotal)}</strong>
                </div>
              </div>

              <div className="staff-order-mobile-actions">
                {isPaymentPending ? (
                  <>
                    <Button
                      size="large"
                      icon={<PlayCircleOutlined />}
                      loading={resuming}
                      onClick={() => setResumeModalOpen(true)}
                      className="staff-order-mobile-btn-resume"
                    >
                      Tiếp tục chơi
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => navigateToPayment(quote.data!.order.id)}
                      className="staff-order-mobile-btn-pay"
                    >
                      Thanh toán
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="large"
                      disabled={isNew && orderType === 'TAKEAWAY' && draftLines.length === 0}
                      loading={saving}
                      onClick={isNew ? saveOrder : () => void saveAdditionalItems(false)}
                      className="staff-order-mobile-btn-save"
                    >
                      Lưu đơn
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : displayedItems.length === 0 && !quote.data?.time
                      }
                      loading={saving || stoppingTime}
                      onClick={() => void beginCheckout()}
                      className="staff-order-mobile-btn-pay"
                    >
                      Thanh toán
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      ) : (
        <>
          <header className="staff-order-editor__header">
            <Button
              type="text"
              size="large"
              aria-label="Đóng trang tạo đơn"
              icon={<CloseOutlined />}
              onClick={handleExit}
            />
            <div className="staff-order-editor__heading">
              <Typography.Title level={3}>
                {isNew ? 'Tạo đơn mới' : 'Chi tiết đơn hàng'}
              </Typography.Title>
              {!isNew && quote.data ? (
                <Typography.Text type="secondary">
                  {[
                    quote.data.order.orderType === 'DINE_IN'
                      ? [quote.data.order.areaName, quote.data.order.tableName]
                          .filter(Boolean)
                          .join(' - ')
                      : 'Mang đi',
                    quote.data.order.displayCode ||
                      (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : null),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography.Text>
              ) : isNew && orderType === 'DINE_IN' && selectedTable ? (
                <Typography.Text type="secondary">
                  {[selectedTable.areaName, selectedTable.name].filter(Boolean).join(' - ')}
                </Typography.Text>
              ) : null}
            </div>
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Tìm kiếm sản phẩm"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
            <div className="staff-order-header-meta">
              <Select
                size="large"
                value={isNew ? orderType : quote.data?.order.orderType}
                options={[
                  { value: 'DINE_IN', label: 'Tại chỗ' },
                  { value: 'TAKEAWAY', label: 'Mang đi' },
                ]}
                disabled={!isNew}
                onChange={(value) => {
                  const nextType = value as 'DINE_IN' | 'TAKEAWAY';
                  setOrderType(nextType);
                  if (nextType === 'TAKEAWAY') {
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('tableId');
                        return next;
                      },
                      { replace: true },
                    );
                  }
                }}
                aria-label="Loại đơn"
                title={
                  isNew
                    ? 'Chọn loại đơn'
                    : 'Chưa cho phép đổi loại khi đơn đã chạy để tránh sai tiền giờ'
                }
              />
              <div className="staff-order-code">
                <small>Mã đơn</small>
                <strong style={{ color: '#0975F7', fontFamily: 'monospace' }}>
                  {isNew
                    ? 'Sinh khi lưu'
                    : quote.data?.order.displayCode ||
                      (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                </strong>
              </div>
              {!isNew && orderId && (
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => navigate(`/pos/orders/${orderId}/detail`)}
                  title="Xem chi tiết và lịch sử đơn hàng"
                  className="staff-order-detail-btn"
                >
                  Chi tiết
                </Button>
              )}
            </div>
          </header>
          <div
            className={`staff-order-editor__body ${isResizing ? 'is-resizing' : ''}`}
            style={{
              gridTemplateColumns: `205px minmax(0, 1fr) auto ${cartWidth}px`,
            }}
          >
            <aside className="staff-category-sidebar">
              <button
                type="button"
                className={selectedCategory === 'ALL' ? 'is-active' : ''}
                onClick={() => setSelectedCategory('ALL')}
              >
                <AppstoreOutlined />
                <span>Tất cả</span>
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  className={selectedCategory === category.id ? 'is-active' : ''}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <AppstoreOutlined />
                  <span>{category.name}</span>
                </button>
              ))}
            </aside>
            <section className="staff-product-picker">
              <Typography.Title level={3}>
                {selectedCategory === 'ALL'
                  ? 'Tất cả sản phẩm'
                  : categories.find((category) => category.id === selectedCategory)?.name}
              </Typography.Title>
              {catalog.isLoading ? (
                <Skeleton active />
              ) : visibleCatalog.length === 0 ? (
                <Empty description="Không có sản phẩm phù hợp" />
              ) : (
                <div className="staff-product-grid">
                  {visibleCatalog.map((product) => {
                    const prices = product.variants
                      .map((variant) => variant.salePriceVnd)
                      .filter((price): price is number => price !== null);
                    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
                    return (
                      <button
                        type="button"
                        key={product.productId}
                        onClick={() => chooseProduct(product)}
                      >
                        <span
                          className={`staff-product-card__visual ${product.avatarType === 'IMAGE' && product.mediaId ? 'has-image' : 'has-color'} ${product.avatarColor ? 'has-custom-color' : ''}`}
                          style={{
                            background: product.avatarColor || '#f8fafc',
                          }}
                        >
                          {product.avatarType === 'IMAGE' && product.mediaId ? (
                            <img src={`/api/v1/media/${product.mediaId}`} alt="" />
                          ) : (
                            getProductInitials(product.productName)
                          )}
                        </span>
                        <strong>{product.productName}</strong>
                        {product.variants.length > 1 ? (
                          <small>{product.variants.length} phiên bản</small>
                        ) : null}
                        <b>
                          {minPrice === null
                            ? 'Nhập giá'
                            : minPrice === maxPrice
                              ? `${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`
                              : `Từ ${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`}
                        </b>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            <div
              className="staff-order-editor__resizer"
              onMouseDown={handleMouseDownResizer}
              title="Kéo thả để thay đổi độ rộng cột chi tiết đơn"
              role="separator"
              aria-orientation="vertical"
            >
              <div className="staff-order-editor__resizer-handle" />
            </div>
            <aside className="staff-cart-panel" style={{ width: cartWidth }}>
              {isPaymentPending ? (
                <div className="staff-order-pending-banner">
                  <div className="staff-order-pending-banner__badge">
                    <CheckCircleOutlined /> ĐÃ DỪNG TÍNH GIỜ
                  </div>
                  <div className="staff-order-pending-banner__text">
                    {quote.data?.time?.endedAtMs
                      ? `Đã dừng lúc ${formatClock(quote.data.time.endedAtMs)}`
                      : 'Đã dừng giờ'}{' '}
                    · Đang chờ thanh toán
                  </div>
                </div>
              ) : null}
              <div className="staff-cart-tabs">
                <button
                  type="button"
                  className={cartTab === 'DETAILS' ? 'is-active' : ''}
                  onClick={() => setCartTab('DETAILS')}
                >
                  Chi tiết đơn
                </button>
                <button
                  type="button"
                  className={cartTab === 'CUSTOMER' ? 'is-active' : ''}
                  onClick={() => setCartTab('CUSTOMER')}
                >
                  Khách hàng
                </button>
                <button
                  type="button"
                  className={cartTab === 'ACTIONS' ? 'is-active' : ''}
                  onClick={() => setCartTab('ACTIONS')}
                >
                  Thao tác khác
                </button>
              </div>
              <div className="staff-cart-scroll-region">
                {cartTab === 'DETAILS' ? (
                  <div className="staff-cart-tab-content">
                    {!isNew && draftDisplayItems.length > 0 ? (
                      <section className="staff-additional-products">
                        <div className="staff-order-section-heading">
                          <Typography.Title level={4}>Sản phẩm gọi thêm</Typography.Title>
                          <Button
                            type="text"
                            icon={<DeleteOutlined />}
                            aria-label="Xóa tất cả sản phẩm gọi thêm"
                            onClick={() => setDraftLines([])}
                          />
                        </div>
                        <div className="staff-compact-order-list">
                          {draftDisplayItems.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className="staff-compact-order-row staff-compact-order-row--editable"
                              onClick={() =>
                                setEditingItem({
                                  source: 'DRAFT',
                                  ...item,
                                  note: item.note ?? '',
                                })
                              }
                            >
                              <span className="staff-order-quantity">
                                {formatItemQuantity(
                                  item.productType,
                                  item.quantityMilli,
                                  item.unitName,
                                )}
                              </span>
                              <span className="staff-order-item-name">
                                <strong>{item.productName}</strong>
                                <small>{item.variantName}</small>
                              </span>
                              <b>{formatMoney(item.netLineTotalVnd)}</b>
                            </button>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <div className="staff-cart-section-header">
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        Sản phẩm đã gọi (
                        {displayedItems.length +
                          (quote.data?.time ||
                          (isNew &&
                            orderType === 'DINE_IN' &&
                            selectedTable?.timeProductId &&
                            !timeRemoved) ||
                          timeRestoringDraft
                            ? 1
                            : 0)}
                        )
                      </Typography.Title>
                      <Button
                        type="text"
                        size="small"
                        className="staff-cart-collapse-btn"
                        icon={orderedItemsCollapsed ? <DownOutlined /> : <UpOutlined />}
                        aria-label={
                          orderedItemsCollapsed
                            ? 'Mở rộng sản phẩm đã gọi'
                            : 'Thu gọn sản phẩm đã gọi'
                        }
                        onClick={() => setOrderedItemsCollapsed((prev) => !prev)}
                      />
                    </div>
                    {!orderedItemsCollapsed ? (
                      <>
                        {/* Small restore button if default time was deleted */}
                        {(!isNew &&
                          quote.data?.order.orderType === 'DINE_IN' &&
                          !quote.data?.time &&
                          !timeRestoringDraft) ||
                        (isNew &&
                          orderType === 'DINE_IN' &&
                          selectedTable?.timeProductId &&
                          timeRemoved) ? (
                          <div style={{ margin: '0 0 14px' }}>
                            <Button
                              size="small"
                              type="dashed"
                              icon={<PlusOutlined />}
                              onClick={() => {
                                if (isNew) {
                                  setTimeRemoved(false);
                                } else {
                                  setTimeRestoringDraft(true);
                                  setTimeRangeDraft({ startedAt: '', endedAt: '' });
                                  setTimeDetailOpen(true);
                                }
                              }}
                              style={{
                                fontSize: 12.5,
                                color: '#0975F7',
                                borderColor: '#91caff',
                                borderRadius: 6,
                                fontWeight: 500,
                              }}
                            >
                              Khôi phục tính giờ
                            </Button>
                          </div>
                        ) : null}

                        {quote.data?.time ? (
                          quote.data.time.tableSegments &&
                          quote.data.time.tableSegments.length > 1 ? (
                            <button
                              type="button"
                              className="staff-time-line staff-time-line--editable staff-time-line--transfer"
                              onClick={openTimeDetails}
                            >
                              <div className="staff-time-line__heading">
                                <span className="staff-order-quantity">1x</span>
                                <span className="staff-order-item-name">
                                  <div className="staff-time-line__title-row">
                                    <strong>Tiền giờ</strong>
                                    <span className="staff-time-transfer-badge">
                                      <SwapOutlined /> Chuyển bàn
                                    </span>
                                  </div>
                                  <small className="staff-time-transfer-chain">
                                    {quote.data.time.tableSegments
                                      .map((s) => s.tableName)
                                      .join(' → ')}
                                  </small>
                                </span>
                                <b className="staff-time-line__price">
                                  {formatMoney(quote.data.time.amountAfterRoundingVnd)}
                                </b>
                              </div>

                              {/* Detailed transfer breakdown in Cart */}
                              <div className="staff-time-cart-breakdown">
                                {quote.data.time.tableSegments.map((tSeg, idx) => (
                                  <div
                                    key={`${tSeg.tableId}-${tSeg.startedAtMs}-${idx}`}
                                    className="staff-time-cart-row"
                                  >
                                    <div className="staff-time-cart-row__left">
                                      <span className="staff-time-cart-dot">•</span>
                                      <strong className="staff-time-cart-tbl-name">
                                        {tSeg.tableName}
                                      </strong>
                                      <span className="staff-time-cart-tbl-time">
                                        {formatClock(tSeg.startedAtMs)}–
                                        {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'}{' '}
                                        ({formatElapsed(tSeg.elapsedSeconds)})
                                      </span>
                                      <span className="staff-time-cart-tbl-rate">
                                        {formatMoney(tSeg.pricingConfig.basePriceVnd)}/h
                                      </span>
                                    </div>
                                    <b className="staff-time-cart-row__amount">
                                      {formatMoney(tSeg.amountAfterRoundingVnd)}
                                    </b>
                                  </div>
                                ))}
                              </div>

                              <div className="staff-time-line__summary">
                                <span>
                                  Tổng thời gian:{' '}
                                  <strong>{formatElapsed(liveElapsedSeconds)}</strong>
                                </span>
                              </div>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="staff-time-line staff-time-line--editable"
                              onClick={openTimeDetails}
                            >
                              <div className="staff-time-line__heading">
                                <span className="staff-order-quantity">1x</span>
                                <span className="staff-order-item-name">
                                  <strong>Tiền giờ · {quote.data.order.tableName}</strong>
                                  <small>
                                    {quote.data.time.pricingConfig
                                      ? `${formatMoney(quote.data.time.pricingConfig.basePriceVnd)}/giờ`
                                      : ''}
                                  </small>
                                </span>
                                <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
                              </div>
                              <div className="staff-time-line__details">
                                <span>
                                  {formatClock(quote.data.time.startedAtMs)}–
                                  {quote.data.time.endedAtMs
                                    ? formatClock(quote.data.time.endedAtMs)
                                    : quote.data.time.status === 'PAUSED'
                                      ? formatClock(
                                          quote.data.time.startedAtMs +
                                            quote.data.time.elapsedSeconds * 1000,
                                        )
                                      : 'Hiện tại'}{' '}
                                  · Tổng: <strong>{formatElapsed(liveElapsedSeconds)}</strong>
                                </span>
                              </div>
                            </button>
                          )
                        ) : isNew &&
                          orderType === 'DINE_IN' &&
                          selectedTable?.timeProductId &&
                          !timeRemoved ? (
                          <button
                            type="button"
                            className="staff-time-line staff-time-line--editable"
                            onClick={() => {
                              setTableAction('SELECT');
                              setTableModalOpen(true);
                            }}
                          >
                            <div className="staff-time-line__heading">
                              <span className="staff-order-quantity">1x</span>
                              <span className="staff-order-item-name">
                                <strong>Tiền giờ · {selectedTable.name}</strong>
                                <small>
                                  {selectedTable.defaultPriceVnd
                                    ? `${formatMoney(selectedTable.defaultPriceVnd)}/giờ`
                                    : (selectedTable.timeProductName ?? '')}
                                </small>
                              </span>
                              <b>0 đ</b>
                            </div>
                            <div className="staff-time-line__details">
                              <span>
                                --:--:--–--:--:-- · Tổng: <strong>--:--:--</strong>
                              </span>
                            </div>
                          </button>
                        ) : timeRestoringDraft ? (
                          <button
                            type="button"
                            className="staff-time-line staff-time-line--editable"
                            onClick={openTimeDetails}
                          >
                            <div className="staff-time-line__heading">
                              <span className="staff-order-quantity">1x</span>
                              <span className="staff-order-item-name">
                                <strong>
                                  Tiền giờ ·{' '}
                                  {quote.data?.order.tableName ?? selectedTable?.name ?? 'Bàn'}
                                </strong>
                                <small>
                                  {selectedTable?.defaultPriceVnd
                                    ? `${formatMoney(selectedTable.defaultPriceVnd)}/giờ`
                                    : (selectedTable?.timeProductName ?? '')}
                                </small>
                              </span>
                              <b>0 đ</b>
                            </div>
                            <div className="staff-time-line__details">
                              <span>
                                --:--:--–--:--:-- · Tổng: <strong>--:--:--</strong>
                              </span>
                            </div>
                          </button>
                        ) : null}
                        {quote.isLoading && !isNew ? (
                          <Skeleton active />
                        ) : displayedItems.length === 0 &&
                          !(
                            isNew &&
                            orderType === 'DINE_IN' &&
                            selectedTable?.timeProductId &&
                            !timeRemoved
                          ) &&
                          !timeRestoringDraft ? (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có mặt hàng"
                          />
                        ) : (
                          <div className="staff-compact-order-list">
                            {displayedItems.map((item) => (
                              <button
                                type="button"
                                key={item.id}
                                className="staff-compact-order-row staff-compact-order-row--editable"
                                onClick={() =>
                                  setEditingItem({
                                    source: 'SAVED',
                                    id: item.id,
                                    productId: item.productId,
                                    variantId: item.variantId,
                                    productType: item.productType,
                                    productName: item.productName,
                                    variantName: item.variantName,
                                    unitName: item.unitName,
                                    unitPriceVnd: item.unitPriceVnd,
                                    quantityMilli: item.quantityMilli,
                                    note: item.note ?? '',
                                    grossLineTotalVnd: item.grossLineTotalVnd,
                                    discountAmountVnd: item.discountAmountVnd,
                                    discountType: item.discountType,
                                    discountInputValue: item.discountInputValue,
                                    netLineTotalVnd: item.netLineTotalVnd,
                                  })
                                }
                              >
                                <span className="staff-order-quantity">
                                  {formatItemQuantity(
                                    item.productType,
                                    item.quantityMilli,
                                    item.unitName,
                                  )}
                                </span>
                                <span className="staff-order-item-name">
                                  <strong>{item.productName}</strong>
                                  <small>{item.variantName}</small>
                                  {item.note ? <small>Ghi chú: {item.note}</small> : null}
                                </span>
                                <b>{formatMoney(item.netLineTotalVnd)}</b>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : cartTab === 'CUSTOMER' ? (
                  <div className="staff-cart-tab-content staff-customer-tab">
                    <PosCustomerSelector
                      customerId={customerId}
                      csrfToken={csrf}
                      allowCreate
                      onSelect={saveCustomerInfo}
                    />
                  </div>
                ) : (
                  <div className="staff-cart-tab-content staff-actions-tab">
                    <div className="staff-order-info-section">
                      <Typography.Title level={5} style={{ marginBottom: 12 }}>
                        Thông tin đơn hàng
                      </Typography.Title>
                      <div className="staff-order-info-grid">
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <ClockCircleOutlined /> Thời gian tạo đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {isNew ? 'Chưa tạo' : formatDateTime(quote.data?.order.openedAt ?? 0)}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <UserOutlined /> Người tạo đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {isNew
                              ? (auth.actor?.displayName ?? 'Nhân viên')
                              : (quote.data?.order.openedByName ??
                                auth.actor?.displayName ??
                                'Nhân viên')}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <ShopOutlined /> Loại đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {orderType === 'DINE_IN'
                              ? `Tại chỗ · ${quote.data?.order.tableName ?? selectedTable?.name ?? 'Chưa chọn bàn'}`
                              : 'Mang đi'}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <FileTextOutlined /> Mã đơn
                          </span>
                          <strong
                            className="staff-order-info-value"
                            style={{ color: '#0975F7', fontFamily: 'monospace' }}
                          >
                            {isNew
                              ? 'Sinh khi lưu'
                              : quote.data?.order.displayCode ||
                                (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="staff-order-action-buttons">
                      <Typography.Title level={5} style={{ marginBottom: 12 }}>
                        Thao tác khác
                      </Typography.Title>
                      <div className="staff-action-buttons-group">
                        {(quote.data?.order.tableId || selectedTable?.id || preselectedTableId) && (
                          <Button
                            size="large"
                            block
                            icon={<QrcodeOutlined />}
                            loading={tableQrLoading}
                            onClick={() => void handleOpenTableQrModal()}
                            className="staff-action-qr-btn"
                            style={{
                              borderColor: '#0975F7',
                              color: '#0975F7',
                              fontWeight: 600,
                            }}
                          >
                            Lấy mã QR Order của bàn
                          </Button>
                        )}
                        {!isNew ? (
                          <>
                            <Button
                              size="large"
                              block
                              icon={<PrinterOutlined />}
                              disabled={printSettings.data?.allowProvisionalPrint === false}
                              onClick={() => void printProvisionalReceipt()}
                              className="staff-action-provisional-btn"
                            >
                              In phiếu tạm tính
                            </Button>
                            <Button
                              size="large"
                              block
                              icon={<FileTextOutlined />}
                              disabled={printSettings.data?.allowProvisionalPrint === false}
                              onClick={() => setProvisionalBillOpen(true)}
                            >
                              Xem trước phiếu tạm tính
                            </Button>
                            {quote.data?.order.orderType === 'DINE_IN' ? (
                              <Button
                                size="large"
                                block
                                icon={<SwapOutlined />}
                                onClick={() => setTransferOpen(true)}
                                className="staff-action-transfer-btn"
                              >
                                Chuyển bàn/phòng
                              </Button>
                            ) : null}
                            <Button
                              danger
                              size="large"
                              block
                              icon={<StopOutlined />}
                              onClick={() => setCancelOpen(true)}
                              className="staff-action-cancel-btn"
                            >
                              Hủy đơn hàng
                            </Button>
                          </>
                        ) : (
                          <Alert
                            type="info"
                            showIcon
                            description="In phiếu tạm tính, Chuyển bàn và Hủy đơn sẽ khả dụng sau khi đơn hàng được lưu."
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="staff-cart-billing">
                {cartTab === 'DETAILS' ? (
                  <button
                    type="button"
                    className="staff-cart-note"
                    onClick={() => setOrderNoteOpen(true)}
                  >
                    <span>
                      <strong>Ghi chú đơn hàng</strong>
                      {orderNote ? <small>{orderNote}</small> : null}
                    </span>
                    <EditOutlined />
                  </button>
                ) : null}
                <div className="staff-cart-summary">
                  <Typography.Title level={4}>Tổng tiền</Typography.Title>
                  <div>
                    <span>Tổng tiền hàng ({regularProductCount} món)</span>
                    <b>{formatMoney(regularProductGross)}</b>
                  </div>
                  {totalTimeGross > 0 ? (
                    <div>
                      <span>Tiền giờ</span>
                      <b>{formatMoney(totalTimeGross)}</b>
                    </div>
                  ) : null}
                  <div>
                    <span>Giảm giá</span>
                    <b>{totalDiscount > 0 ? `-${formatMoney(totalDiscount)}` : '0đ'}</b>
                  </div>
                  <div className="staff-cart-total">
                    <span>Khách phải trả</span>
                    <b>{formatMoney(displayedTotal)}</b>
                  </div>
                </div>
              </div>
              <div className="staff-cart-actions">
                {isPaymentPending ? (
                  <>
                    <Button
                      size="large"
                      icon={<PlayCircleOutlined />}
                      loading={resuming}
                      onClick={() => setResumeModalOpen(true)}
                      className="staff-payment-resume-btn"
                    >
                      Tiếp tục chơi
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => {
                        navigateToPayment(quote.data!.order.id);
                      }}
                    >
                      Tiếp tục thanh toán
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="large"
                      disabled={isNew && orderType === 'TAKEAWAY' && draftLines.length === 0}
                      loading={saving}
                      onClick={isNew ? saveOrder : () => void saveAdditionalItems(false)}
                    >
                      Lưu đơn
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : displayedItems.length === 0 && !quote.data?.time
                      }
                      loading={saving || stoppingTime}
                      onClick={() => {
                        void beginCheckout();
                      }}
                    >
                      Thanh toán
                    </Button>
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      <Modal
        open={Boolean(variantProduct)}
        title={`Chọn phiên bản · ${variantProduct?.productName ?? ''}`}
        footer={null}
        onCancel={() => setVariantProduct(null)}
      >
        <div className="staff-variant-picker">
          {variantProduct?.variants.map((variant) => (
            <button
              type="button"
              key={variant.id}
              onClick={(e) => chooseVariant(variantProduct, variant, e)}
            >
              <span>{variant.name}</span>
              <b>
                {variant.salePriceVnd === null
                  ? 'Nhập giá'
                  : `${formatMoney(variant.salePriceVnd)}${variantProduct.productType === 'WEIGHT' ? `/${getWeightUnit(variantProduct.unitName)}` : ''}`}
              </b>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        open={Boolean(promptTarget)}
        title={`Nhập giá bán · ${promptTarget?.product.productName ?? ''}`}
        okText="Thêm vào đơn"
        cancelText="Hủy"
        okButtonProps={{ disabled: promptPrice === null || promptPrice < 0 }}
        onOk={confirmPromptPrice}
        onCancel={() => setPromptTarget(null)}
      >
        <InputNumber
          autoFocus
          min={0}
          step={1000}
          value={promptPrice}
          onFocus={(e) => e.target.select()}
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')}
          parser={(value) => Number((value ?? '').replaceAll('.', ''))}
          onChange={(value) => setPromptPrice(value === null ? null : Number(value))}
          suffix="đ"
          style={{ width: '100%' }}
        />
      </Modal>
      <StaffTablePickerModal
        open={tableModalOpen}
        initialTableId={preselectedTableId}
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTableModalOpen(false)}
        onConfirm={(table) => {
          if (tableAction === 'SAVE') {
            void saveWithTable(table, false);
          } else if (tableAction === 'CHECKOUT') {
            void saveWithTable(table, true);
          } else {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set('tableId', table.id);
                return next;
              },
              { replace: true },
            );
            setOrderType('DINE_IN');
            setTableModalOpen(false);
          }
        }}
      />
      <Modal
        open={orderNoteOpen}
        title="Ghi chú đơn hàng"
        okText="Lưu ghi chú"
        cancelText="Hủy"
        onOk={saveOrderNote}
        onCancel={() => setOrderNoteOpen(false)}
      >
        <Input.TextArea
          rows={4}
          maxLength={500}
          showCount
          value={orderNote}
          onChange={(event) => setOrderNote(event.target.value)}
        />
      </Modal>
      <StaffItemDetailModal
        item={editingItem}
        catalog={catalog.data ?? []}
        onCancel={() => {
          if (editingItem?.discardOnCancel) {
            setDraftLines((lines) => lines.filter((line) => line.id !== editingItem.id));
          }
          setEditingItem(null);
        }}
        onSave={(updated, selectedVariant) => {
          if (!editingItem) return;
          if (editingItem.source === 'DRAFT') {
            setDraftLines((lines) =>
              lines.map((line) => {
                if (line.id !== editingItem.id) return line;
                return {
                  ...line,
                  variant:
                    selectedVariant && selectedVariant.id !== 'default'
                      ? selectedVariant
                      : line.variant,
                  quantityMilli: updated.quantityMilli,
                  note: updated.note.trim() || null,
                  discountType: updated.discountType,
                  discountInputValue: updated.discountInputValue,
                };
              }),
            );
            setEditingItem(null);
          } else {
            void updateExistingItem({
              id: editingItem.id,
              quantityMilli: updated.quantityMilli,
              variantId:
                selectedVariant && selectedVariant.id !== 'default'
                  ? selectedVariant.id
                  : (updated.variantId ?? null),
              discount:
                updated.discountType &&
                updated.discountInputValue !== null &&
                updated.discountInputValue !== undefined
                  ? { type: updated.discountType, value: updated.discountInputValue }
                  : null,
              note: updated.note.trim() || null,
            });
          }
        }}
        onDelete={() => {
          if (!editingItem) return;
          if (editingItem.discardOnCancel || editingItem.source === 'DRAFT') {
            setDraftLines((lines) => lines.filter((line) => line.id !== editingItem.id));
            setEditingItem(null);
            return;
          }
          setDeleteItemTarget({
            id: editingItem.id,
            name: editingItem.productName,
            source: editingItem.source,
          });
          setDeleteItemReason('');
          setDeleteItemModalOpen(true);
          setEditingItem(null);
        }}
      />
      <Modal
        open={timeDetailOpen && (Boolean(quote.data?.time) || timeRestoringDraft)}
        title={
          <div className="staff-time-modal-header">
            <ClockCircleOutlined />
            <span>
              {timeRestoringDraft && !quote.data?.time ? 'Khôi phục tính giờ' : 'Chi tiết tính giờ'}
            </span>
          </div>
        }
        width={620}
        centered
        destroyOnHidden
        className="staff-time-detail-dialog"
        onCancel={() => setTimeDetailOpen(false)}
        footer={
          quote.data?.time
            ? [
                <Button
                  key="toggle"
                  icon={timeRangeDraft.endedAt ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                  onClick={
                    timeRangeDraft.endedAt ? handleResumeTimeInModal : handlePauseTimeInModal
                  }
                  className="staff-time-footer-btn"
                >
                  {timeRangeDraft.endedAt ? 'Tiếp tục tính giờ' : 'Tạm dừng giờ'}
                </Button>,
                <Button
                  key="delete-time"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setDeleteTimeReason('');
                    setDeleteTimeModalOpen(true);
                  }}
                  className="staff-time-footer-btn"
                >
                  Xóa tiền giờ
                </Button>,
                <Button
                  key="save"
                  type="primary"
                  loading={saving}
                  onClick={saveTimeRange}
                  className="staff-time-footer-btn staff-time-footer-btn--primary"
                >
                  Lưu thay đổi
                </Button>,
              ]
            : [
                <Button
                  key="cancel"
                  onClick={() => setTimeDetailOpen(false)}
                  className="staff-time-footer-btn"
                >
                  Đóng
                </Button>,
                <Button
                  key="discard-restore"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setTimeRestoringDraft(false);
                    setTimeDetailOpen(false);
                  }}
                  className="staff-time-footer-btn"
                >
                  Hủy khôi phục
                </Button>,
                <Button
                  key="save"
                  type="primary"
                  loading={saving}
                  onClick={saveTimeRange}
                  className="staff-time-footer-btn staff-time-footer-btn--primary"
                >
                  Lưu thay đổi
                </Button>,
              ]
        }
      >
        {quote.data?.time ? (
          <div className="staff-time-detail-modal">
            {/* Phân đoạn chuyển bàn nếu có */}
            {quote.data.time.tableSegments && quote.data.time.tableSegments.length > 1 ? (
              <section className="staff-time-detail-card staff-time-detail-card--segments">
                <Typography.Title level={5} className="staff-time-card-title">
                  <SwapOutlined /> Lịch sử chuyển bàn
                </Typography.Title>
                <div className="staff-time-segments-list">
                  {quote.data.time.tableSegments.map((tSeg, index) => (
                    <div
                      key={`${tSeg.tableId}-${tSeg.startedAtMs}-${index}`}
                      className="staff-time-segment-row"
                    >
                      <div className="staff-time-segment-info">
                        <div className="staff-time-segment-name-wrap">
                          <strong className="staff-time-segment-name">{tSeg.tableName}</strong>
                          <span className="staff-time-segment-rate-pill">
                            {formatMoney(tSeg.pricingConfig.basePriceVnd)}/giờ
                          </span>
                        </div>
                        <div className="staff-time-segment-timing">
                          <span>
                            {formatClock(tSeg.startedAtMs)}–
                            {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'}
                          </span>
                          <span className="staff-time-segment-dot">•</span>
                          <span>{formatElapsed(tSeg.elapsedSeconds)}</span>
                        </div>
                      </div>
                      <b className="staff-time-segment-amount">
                        {formatMoney(tSeg.amountAfterRoundingVnd)}
                      </b>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Thời gian sử dụng */}
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Thời gian sử dụng
              </Typography.Title>
              <div className="staff-time-range-fields">
                <label htmlFor="staff-time-started-at" className="staff-time-field">
                  <span className="staff-time-field__label">Giờ vào</span>
                  <Input
                    id="staff-time-started-at"
                    type="datetime-local"
                    step={1}
                    max={formatDateTimeInput(Date.now())}
                    value={timeRangeDraft.startedAt}
                    onChange={(event) =>
                      setTimeRangeDraft((value) => ({ ...value, startedAt: event.target.value }))
                    }
                    className="staff-time-field__input"
                  />
                </label>
                <label htmlFor="staff-time-ended-at" className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ ra</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          endedAt: formatDateTimeInput(Date.now()),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <Input
                    id="staff-time-ended-at"
                    type="datetime-local"
                    step={1}
                    min={timeRangeDraft.startedAt}
                    max={formatDateTimeInput(Date.now())}
                    value={timeRangeDraft.endedAt}
                    onChange={(event) =>
                      setTimeRangeDraft((value) => ({ ...value, endedAt: event.target.value }))
                    }
                    className="staff-time-field__input"
                  />
                  <small className="staff-time-field__hint">
                    Điền giờ ra và bấm Lưu thay đổi để chốt/dừng giờ. Để trống để tính đến hiện tại.
                  </small>
                </label>
              </div>
              <div className="staff-time-detail-row staff-time-detail-row--highlight">
                <span>Tổng thời gian tính tiền</span>
                <b>{formatElapsed(liveElapsedSeconds)}</b>
              </div>
            </section>

            {/* Bảng giá áp dụng */}
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Bảng giá áp dụng
              </Typography.Title>
              <div className="staff-time-rates-list">
                {quote.data.time.pricingConfig.firstPeriod.enabled ? (
                  <div className="staff-time-detail-row">
                    <span>
                      <strong>Giá đầu tiên</strong>
                      <small>
                        {formatElapsed(quote.data.time.pricingConfig.firstPeriod.durationSeconds)}{' '}
                        đầu
                      </small>
                    </span>
                    <b>
                      {formatPriceRate(
                        quote.data.time.pricingConfig.firstPeriod.priceVnd,
                        quote.data.time.pricingConfig.firstPeriod.durationSeconds,
                      )}
                    </b>
                  </div>
                ) : null}
                {quote.data.time.pricingConfig.specialWindows.map((window) => (
                  <div key={window.id} className="staff-time-detail-row">
                    <span>
                      <strong>{window.name}</strong>
                      <small>
                        {formatMinuteOfDay(window.startMinute)}–
                        {formatMinuteOfDay(window.endMinute)} ·{' '}
                        {formatWeekdays(window.weekdaysMask)}
                      </small>
                    </span>
                    <b>
                      {formatPriceRate(
                        window.priceVnd,
                        quote.data!.time!.pricingConfig.baseDurationSeconds,
                      )}
                    </b>
                  </div>
                ))}
                <div className="staff-time-detail-row">
                  <span>
                    <strong>Giá thường</strong>
                    <small>
                      {quote.data.time.pricingConfig.calculationMode === 'ACTUAL_TIME'
                        ? 'Tính theo thời gian thực'
                        : 'Tính tròn theo block'}
                    </small>
                  </span>
                  <b>
                    {formatPriceRate(
                      quote.data.time.pricingConfig.basePriceVnd,
                      quote.data.time.pricingConfig.baseDurationSeconds,
                    )}
                  </b>
                </div>
              </div>
            </section>

            {/* Thành tiền tạm tính */}
            <section className="staff-time-detail-card staff-time-detail-card--totals">
              <Typography.Title level={5} className="staff-time-card-title">
                Thành tiền tạm tính
              </Typography.Title>
              <div className="staff-time-rates-list">
                {quote.data.time.segments.map((segment, index) => (
                  <div
                    key={`${segment.type}-${segment.startedAtMs}-${index}`}
                    className="staff-time-detail-row"
                  >
                    <span>
                      <strong>{segment.name}</strong>
                      <small>
                        {formatClock(segment.startedAtMs)}–{formatClock(segment.endedAtMs)} ·{' '}
                        {formatElapsed(segment.elapsedSeconds)}
                      </small>
                    </span>
                    <b>{formatMoney(segment.amountBeforeRoundingVnd)}</b>
                  </div>
                ))}
              </div>
              <div className="staff-time-detail-row staff-time-detail-row--total">
                <span>Tổng tiền giờ</span>
                <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
              </div>
            </section>
          </div>
        ) : timeRestoringDraft ? (
          <div className="staff-time-detail-modal">
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Thời gian sử dụng
              </Typography.Title>
              <div className="staff-time-range-fields">
                <label htmlFor="staff-time-started-at" className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ vào</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          startedAt: formatDateTimeInput(Date.now()),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <Input
                    id="staff-time-started-at"
                    type="datetime-local"
                    step={1}
                    max={formatDateTimeInput(Date.now())}
                    value={timeRangeDraft.startedAt}
                    onChange={(event) =>
                      setTimeRangeDraft((value) => ({ ...value, startedAt: event.target.value }))
                    }
                    className="staff-time-field__input"
                  />
                  <small className="staff-time-field__hint">
                    Chọn thời điểm bắt đầu tính giờ cho bàn/phòng.
                  </small>
                </label>
                <label htmlFor="staff-time-ended-at" className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ ra</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          endedAt: formatDateTimeInput(Date.now()),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <Input
                    id="staff-time-ended-at"
                    type="datetime-local"
                    step={1}
                    min={timeRangeDraft.startedAt}
                    max={formatDateTimeInput(Date.now())}
                    value={timeRangeDraft.endedAt}
                    onChange={(event) =>
                      setTimeRangeDraft((value) => ({ ...value, endedAt: event.target.value }))
                    }
                    className="staff-time-field__input"
                  />
                  <small className="staff-time-field__hint">
                    Điền giờ ra nếu khách đã kết thúc. Để trống nếu bàn vẫn đang tiếp tục chơi.
                  </small>
                </label>
              </div>
            </section>
          </div>
        ) : null}
      </Modal>
      <StaffTableTransferModal
        open={transferOpen}
        currentTable={tables.data?.find((item) => item.id === quote.data?.order.tableId) ?? null}
        currentQuote={quote.data ?? null}
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTransferOpen(false)}
        onConfirm={(table) => transferTo(table)}
      />
      <Modal
        open={provisionalBillOpen && Boolean(quote.data)}
        title={
          <div className="staff-provisional-modal-header">
            <FileTextOutlined />
            <span>Xem trước phiếu tạm tính · {quote.data?.order.tableName}</span>
          </div>
        }
        width={500}
        centered
        onCancel={() => setProvisionalBillOpen(false)}
        footer={[
          <Button key="close" onClick={() => setProvisionalBillOpen(false)}>
            Đóng
          </Button>,
        ]}
      >
        {quote.data ? (
          <div className="staff-provisional-bill-content">
            <ReceiptPreviewPaper
              options={{
                data: buildPrintDataFromQuote(quote.data, 'PROVISIONAL'),
                printSettings: printSettings.data,
                storeInfo: {
                  storeName: staffContext.data?.storeName ?? null,
                  phone: staffContext.data?.storePhone ?? null,
                  address: staffContext.data?.storeAddress ?? null,
                  bankName: staffContext.data?.bankName ?? null,
                  bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
                  bankAccountName: staffContext.data?.bankAccountName ?? null,
                },
              }}
            />
            <Alert
              type="info"
              showIcon
              message="Số tiền có thể tiếp tục thay đổi do bàn vẫn đang tính giờ."
              style={{ marginBottom: 14 }}
            />
            <div className="staff-provisional-info-card">
              <div className="staff-provisional-row">
                <span>Bàn</span>
                <strong>{quote.data.order.tableName}</strong>
              </div>
              {quote.data.time ? (
                <>
                  <div className="staff-provisional-row">
                    <span>Giờ vào</span>
                    <span>{formatDateTime(quote.data.time.startedAtMs)}</span>
                  </div>
                  <div className="staff-provisional-row">
                    <span>Thời gian hiện tại</span>
                    <strong>{formatElapsed(liveElapsedSeconds)}</strong>
                  </div>
                  <div className="staff-provisional-row">
                    <span>Tiền giờ tạm tính</span>
                    <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
                  </div>
                </>
              ) : null}
            </div>

            <div className="staff-provisional-items-list">
              {displayedItems.map((item) => (
                <div key={item.id} className="staff-provisional-item-row">
                  <span>
                    {item.productName} ({item.quantityMilli / 1000} {item.unitName ?? ''})
                  </span>
                  <b>{formatMoney(item.netLineTotalVnd)}</b>
                </div>
              ))}
            </div>

            <div className="staff-provisional-totals-card">
              <div className="staff-provisional-row">
                <span>Tổng tiền hàng</span>
                <span>{formatMoney(regularProductGross)}</span>
              </div>
              {totalTimeGross > 0 ? (
                <div className="staff-provisional-row">
                  <span>Tiền giờ</span>
                  <span>{formatMoney(totalTimeGross)}</span>
                </div>
              ) : null}
              {totalDiscount > 0 ? (
                <div className="staff-provisional-row">
                  <span>Giảm giá</span>
                  <span>-{formatMoney(totalDiscount)}</span>
                </div>
              ) : null}
              <div className="staff-provisional-row staff-provisional-row--total">
                <span>TỔNG TẠM TÍNH</span>
                <b>{formatMoney(displayedTotal)}</b>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={deleteItemModalOpen && Boolean(deleteItemTarget)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <DeleteOutlined />
            <span>Xác nhận xóa mặt hàng</span>
          </div>
        }
        okText="Xác nhận xóa"
        okButtonProps={{ danger: true, disabled: !deleteItemReason.trim() }}
        confirmLoading={deletingItem}
        cancelText="Hủy"
        onOk={() => void handleDeleteItemConfirm()}
        onCancel={() => {
          if (deletingItem) return;
          setDeleteItemModalOpen(false);
          setDeleteItemTarget(null);
          setDeleteItemReason('');
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <div>
            Bạn có chắc chắn muốn xóa mặt hàng <strong>{deleteItemTarget?.name}</strong> khỏi đơn?
          </div>
          <div>
            <label
              htmlFor="delete-item-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do xóa <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {['Khách đổi ý', 'Nhập nhầm món', 'Hết hàng / Hỏng', 'Khác'].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  onClick={() => setDeleteItemReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: deleteItemReason === tag ? '#e6f4ff' : undefined,
                    borderColor: deleteItemReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="delete-item-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do xóa mặt hàng..."
              value={deleteItemReason}
              onChange={(e) => setDeleteItemReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTimeModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <DeleteOutlined />
            <span>Xác nhận xóa tiền giờ bàn</span>
          </div>
        }
        okText="Xác nhận xóa"
        okButtonProps={{ danger: true, disabled: !deleteTimeReason.trim() }}
        confirmLoading={deletingTime}
        cancelText="Hủy"
        onOk={() => void handleDeleteTimeConfirm()}
        onCancel={() => {
          if (deletingTime) return;
          setDeleteTimeModalOpen(false);
          setDeleteTimeReason('');
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Alert
            type="warning"
            showIcon
            description="Sau khi xóa, đơn hàng này sẽ không bị tính tiền giờ mặc định của bàn nữa."
          />
          <div>
            <label
              htmlFor="delete-time-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do xóa tiền giờ <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                'Miễn phí tiền giờ',
                'Bàn đặt trước không tính giờ',
                'Khách quen / Khuyến mãi',
                'Nhập nhầm bàn',
                'Khác',
              ].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  onClick={() => setDeleteTimeReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: deleteTimeReason === tag ? '#e6f4ff' : undefined,
                    borderColor: deleteTimeReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="delete-time-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do xóa tiền giờ của bàn..."
              value={deleteTimeReason}
              onChange={(e) => setDeleteTimeReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <CloseCircleOutlined />
            <span>Hủy đơn hàng</span>
          </div>
        }
        okText="Xác nhận hủy"
        okButtonProps={{ danger: true, disabled: !cancelReason.trim() }}
        cancelText="Quay lại"
        onOk={cancelOrder}
        onCancel={() => setCancelOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Alert
            type="error"
            showIcon
            description="Toàn bộ món đã chọn sẽ bị hủy và bàn sẽ được giải phóng."
          />
          <div>
            <label
              htmlFor="cancel-order-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do hủy đơn <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {['Khách không dùng nữa', 'Bàn mở nhầm', 'Khách đổi bàn', 'Khác'].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  onClick={() => setCancelReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: cancelReason === tag ? '#e6f4ff' : undefined,
                    borderColor: cancelReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="cancel-order-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do hủy đơn..."
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={discardModalOpen}
        footer={null}
        closable={false}
        centered
        width={360}
        className="staff-confirm-discard-modal"
        onCancel={() => setDiscardModalOpen(false)}
      >
        <div className="staff-confirm-discard-content">
          <Typography.Title level={4} className="staff-confirm-discard-title">
            Dừng thêm sản phẩm
          </Typography.Title>
          <p className="staff-confirm-discard-desc">
            Hành động này sẽ xoá các sản phẩm bạn vừa chọn và không thể hoàn tác.
          </p>
          <div className="staff-confirm-discard-actions">
            <button
              type="button"
              className="staff-confirm-discard-btn staff-confirm-discard-btn--cancel"
              onClick={() => setDiscardModalOpen(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              className="staff-confirm-discard-btn staff-confirm-discard-btn--confirm"
              onClick={() => {
                setDiscardModalOpen(false);
                navigate('/pos');
              }}
            >
              Xác nhận
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={resumeModalOpen}
        title="Tiếp tục tính giờ?"
        okText="Tiếp tục chơi"
        cancelText="Hủy"
        okButtonProps={{ loading: resuming }}
        onCancel={() => !resuming && setResumeModalOpen(false)}
        onOk={() => void handleResumeCheckout()}
      >
        <div
          className="staff-confirm-resume-body"
          style={{ display: 'grid', gap: 10, paddingTop: 6 }}
        >
          <p style={{ margin: 0 }}>
            Bàn đã dừng tính giờ lúc{' '}
            <strong>
              {quote.data?.time?.endedAtMs ? formatClock(quote.data.time.endedAtMs) : 'trước đó'}
            </strong>
            .
          </p>
          <p style={{ margin: 0, color: '#475569' }}>
            Một khoảng tính giờ mới sẽ bắt đầu từ thời điểm xác nhận tiếp tục. Khoảng thời gian chờ
            thanh toán sẽ <strong>không được tính tiền</strong>.
          </p>
        </div>
      </Modal>
      <Modal
        open={mobileActionsOpen}
        title="Thao tác khác"
        footer={null}
        onCancel={() => setMobileActionsOpen(false)}
        className="staff-mobile-actions-modal"
        width={420}
      >
        <div className="staff-mobile-actions-body">
          <div className="staff-mobile-actions-info-card">
            <div className="staff-mobile-actions-info-row">
              <span>Mã đơn hàng:</span>
              <strong style={{ color: '#0975F7', fontFamily: 'monospace' }}>
                {isNew
                  ? 'Chưa tạo'
                  : quote.data?.order.displayCode ||
                    (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
              </strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Thời gian tạo:</span>
              <strong>{isNew ? 'Bây giờ' : formatDateTime(quote.data?.order.openedAt ?? 0)}</strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Thu ngân:</span>
              <strong>
                {isNew
                  ? (auth.actor?.displayName ?? 'Nhân viên')
                  : (quote.data?.order.openedByName ?? auth.actor?.displayName ?? 'Nhân viên')}
              </strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Bàn / Khu vực:</span>
              <strong>
                {orderType === 'DINE_IN'
                  ? (quote.data?.order.tableName ?? selectedTable?.name ?? 'Chưa chọn bàn')
                  : 'Mang đi'}
              </strong>
            </div>
          </div>

          <div className="staff-mobile-actions-buttons">
            {(quote.data?.order.tableId || selectedTable?.id || preselectedTableId) && (
              <Button
                size="large"
                block
                icon={<QrcodeOutlined />}
                loading={tableQrLoading}
                onClick={() => {
                  setMobileActionsOpen(false);
                  void handleOpenTableQrModal();
                }}
                style={{
                  borderColor: '#0975F7',
                  color: '#0975F7',
                  fontWeight: 600,
                }}
              >
                Lấy mã QR Order của bàn
              </Button>
            )}
            {!isNew && (
              <>
                <Button
                  size="large"
                  block
                  icon={<PrinterOutlined />}
                  disabled={printSettings.data?.allowProvisionalPrint === false}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    void printProvisionalReceipt();
                  }}
                >
                  In phiếu tạm tính
                </Button>
                <Button
                  size="large"
                  block
                  icon={<FileTextOutlined />}
                  disabled={printSettings.data?.allowProvisionalPrint === false}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setProvisionalBillOpen(true);
                  }}
                >
                  Xem trước phiếu tạm tính
                </Button>

                {quote.data?.order.orderType === 'DINE_IN' && (
                  <Button
                    size="large"
                    block
                    icon={<SwapOutlined />}
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setTransferOpen(true);
                    }}
                  >
                    Chuyển bàn/phòng
                  </Button>
                )}

                {orderId && (
                  <Button
                    size="large"
                    block
                    icon={<HistoryOutlined />}
                    onClick={() => {
                      setMobileActionsOpen(false);
                      navigate(`/pos/orders/${orderId}/detail`);
                    }}
                  >
                    Chi tiết & Lịch sử đơn
                  </Button>
                )}

                <Button
                  size="large"
                  block
                  icon={<UserOutlined />}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setGuestModalOpen(true);
                  }}
                >
                  Đổi số lượng khách ({guestCount} khách)
                </Button>

                <Button
                  size="large"
                  block
                  icon={<UserOutlined />}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setCustomerModalOpen(true);
                  }}
                >
                  {customerName ? `Khách hàng: ${customerName}` : 'Thêm / Đổi khách hàng'}
                </Button>

                <Button
                  danger
                  size="large"
                  block
                  icon={<StopOutlined />}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setCancelOpen(true);
                  }}
                >
                  Hủy đơn hàng
                </Button>
              </>
            )}

            {isNew && (
              <Button
                size="large"
                block
                icon={<CloseOutlined />}
                onClick={() => {
                  setMobileActionsOpen(false);
                  handleExit();
                }}
              >
                Hủy tạo đơn & Thoát
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={guestModalOpen}
        title="Số lượng khách"
        okText="Xác nhận"
        cancelText="Đóng"
        onOk={() => {
          void saveGuestCount(guestCount);
          setGuestModalOpen(false);
        }}
        onCancel={() => setGuestModalOpen(false)}
        width={360}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            margin: '16px 0',
          }}
        >
          {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
            <Button
              key={num}
              type={guestCount === num ? 'primary' : 'default'}
              size="large"
              onClick={() => {
                void saveGuestCount(num);
                setGuestModalOpen(false);
              }}
            >
              {num}
            </Button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
            Nhập số khách khác:
          </label>
          <InputNumber
            min={1}
            max={999}
            value={guestCount}
            onChange={(val) => val && setGuestCount(val)}
            style={{ width: '100%' }}
            size="large"
          />
        </div>
      </Modal>
      <Modal
        open={customerModalOpen}
        title="Khách hàng"
        footer={null}
        onCancel={() => setCustomerModalOpen(false)}
        width={680}
        className="pos-customer-selection-shell"
      >
        <PosCustomerSelector
          customerId={customerId}
          csrfToken={csrf}
          allowCreate
          reopenPickerOnDeselect={isMobile}
          onSelect={async (customer) => {
            await saveCustomerInfo(customer);
            if (customer) setCustomerModalOpen(false);
          }}
        />
      </Modal>

      {/* Modal Xem trước đơn hàng (Mobile Cart Review) */}
      <Modal
        open={isMobile && cartPreviewOpen}
        footer={null}
        closable={false}
        centered
        width={480}
        className="staff-cart-preview-modal"
        styles={{
          body: { padding: 0 },
        }}
        onCancel={() => setCartPreviewOpen(false)}
      >
        <div className="staff-cart-preview-container">
          {/* Header */}
          <div className="staff-cart-preview-header">
            <button
              type="button"
              className="staff-cart-preview-clear-btn"
              onClick={() => {
                setPickingCart([]);
                setCartPreviewOpen(false);
              }}
            >
              Xoá tất cả
            </button>
            <strong className="staff-cart-preview-title">Xem trước đơn hàng</strong>
            <button
              type="button"
              className="staff-cart-preview-close-btn"
              onClick={() => setCartPreviewOpen(false)}
              aria-label="Đóng xem trước"
            >
              <CloseOutlined />
            </button>
          </div>

          {/* List */}
          <div className="staff-cart-preview-list">
            {pickingCart.length === 0 ? (
              <div className="staff-cart-preview-empty">Giỏ hàng đang trống</div>
            ) : (
              pickingCart.map((item, index) => {
                const lineTotal = calculateLineTotal(
                  item.variant.salePriceVnd ?? 0,
                  item.quantityMilli,
                );
                return (
                  <div key={item.id || index} className="staff-cart-preview-item">
                    <div className="staff-cart-preview-item__top">
                      <div className="staff-cart-preview-item__name-wrap">
                        <strong className="staff-cart-preview-item__name">
                          {item.product.productName}
                        </strong>
                        {item.variant.name && item.variant.name !== 'Mặc định' && (
                          <span className="staff-cart-preview-item__variant">
                            ({item.variant.name})
                          </span>
                        )}
                      </div>
                      <span className="staff-cart-preview-item__price">
                        {formatMoney(lineTotal)}
                      </span>
                    </div>

                    <div
                      className="staff-cart-preview-item__note-row"
                      onClick={() => {
                        setEditingNoteItemIndex(index);
                        setItemNoteDraft(item.note ?? '');
                      }}
                    >
                      <FileTextOutlined style={{ color: '#0975f7', marginRight: 6 }} />
                      <span className="staff-cart-preview-item__note-label">Ghi chú:</span>
                      <span className="staff-cart-preview-item__note-val">
                        {item.note ? item.note : 'Không có'}
                      </span>
                    </div>

                    <div className="staff-cart-preview-item__bottom">
                      <button
                        type="button"
                        className="staff-cart-preview-item__del-btn"
                        onClick={() => {
                          setPickingCart((prev) => prev.filter((_, i) => i !== index));
                        }}
                      >
                        Xoá
                      </button>
                      <div className="staff-cart-preview-stepper">
                        <button
                          type="button"
                          className="staff-cart-preview-stepper__btn"
                          onClick={() => {
                            if (item.quantityMilli <= 1000) {
                              setPickingCart((prev) => prev.filter((_, i) => i !== index));
                            } else {
                              setPickingCart((prev) =>
                                prev.map((l, i) =>
                                  i === index ? { ...l, quantityMilli: l.quantityMilli - 1000 } : l,
                                ),
                              );
                            }
                          }}
                        >
                          <MinusOutlined />
                        </button>
                        <span className="staff-cart-preview-stepper__val">
                          {item.product.productType === 'WEIGHT'
                            ? `${item.quantityMilli / 1000} ${getWeightUnit(item.product.unitName)}`
                            : item.quantityMilli / 1000}
                        </span>
                        <button
                          type="button"
                          className="staff-cart-preview-stepper__btn"
                          onClick={() => {
                            setPickingCart((prev) =>
                              prev.map((l, i) =>
                                i === index ? { ...l, quantityMilli: l.quantityMilli + 1000 } : l,
                              ),
                            );
                          }}
                        >
                          <PlusOutlined />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sticky Bottom Bar inside Preview */}
          <div className="staff-cart-preview-footer">
            <div className="staff-product-picker-mobile__cart-btn">
              <ShoppingCartOutlined />
              <span className="staff-product-picker-mobile__cart-count">{pickingCartCount}</span>
            </div>
            <div className="staff-product-picker-mobile__bottom-actions">
              <b className="staff-product-picker-mobile__bottom-price">
                {formatMoney(pickingCartTotal)}
              </b>
              <Button
                type="primary"
                size="large"
                onClick={() => {
                  // Đóng xem trước và quay ra lại danh sách món
                  setCartPreviewOpen(false);
                }}
                className="staff-product-picker-mobile__done-btn"
              >
                Tiếp tục
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Note Editing Modal */}
      <Modal
        open={editingNoteItemIndex !== null}
        title="Ghi chú món"
        okText="Lưu ghi chú"
        cancelText="Hủy"
        onOk={() => {
          if (editingNoteItemIndex !== null) {
            setPickingCart((prev) =>
              prev.map((l, i) =>
                i === editingNoteItemIndex ? { ...l, note: itemNoteDraft.trim() || null } : l,
              ),
            );
            setEditingNoteItemIndex(null);
            setItemNoteDraft('');
          }
        }}
        onCancel={() => {
          setEditingNoteItemIndex(null);
          setItemNoteDraft('');
        }}
      >
        <Input.TextArea
          rows={3}
          placeholder="Nhập ghi chú (ví dụ: ít đá, không đường, cay...)"
          value={itemNoteDraft}
          onChange={(e) => setItemNoteDraft(e.target.value)}
        />
      </Modal>

      {/* Modal hiển thị mã QR Order của bàn (Standee & Frame đẹp) */}
      {tableQrData && (
        <TableQrModal
          open={tableQrModalOpen}
          onClose={() => setTableQrModalOpen(false)}
          tableName={tableQrData.tableName}
          url={tableQrData.url}
          qrImageSrc={tableQrData.image}
          storeName={staffContext.data?.storeName ?? 'PRO POS'}
          orderCode={tableQrData.orderCode}
        />
      )}
    </div>
  );
}

function InvoicePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [messageApi, holder] = message.useMessage();
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const invoiceId = location.pathname.match(/^\/pos\/invoices\/([^/]+)$/u)?.[1];
  const invoice = useQuery({
    queryKey: ['pos-invoice', invoiceId],
    queryFn: () => apiRequest<InvoiceDetail>(`/api/v1/pos/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
  });
  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
  });
  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });
  if (invoice.isLoading) return <Spin fullscreen description="Đang tạo hóa đơn" />;
  if (invoice.isError || !invoice.data) {
    return (
      <Result
        status="error"
        title="Không tải được hóa đơn"
        extra={<Button onClick={() => navigate('/pos')}>Về danh sách đơn</Button>}
      />
    );
  }
  const data = invoice.data;
  const invoicePrintData = buildPrintDataFromInvoice(data);
  invoicePrintData.paymentAllocations = data.allocations.map((allocation) => ({
    method: allocation.method,
    amountVnd: allocation.amountVnd,
  }));
  invoicePrintData.paidAmountVnd = data.allocations
    .filter((allocation) => allocation.method !== 'DEBT')
    .reduce((sum, allocation) => sum + allocation.amountVnd, 0);
  invoicePrintData.debtAmountVnd = data.allocations
    .filter((allocation) => allocation.method === 'DEBT')
    .reduce((sum, allocation) => sum + allocation.amountVnd, 0);
  const invoicePrintOptions = {
    data: invoicePrintData,
    printSettings: printSettings.data,
    storeInfo: {
      storeName: staffContext.data?.storeName ?? null,
      phone: staffContext.data?.storePhone ?? null,
      address: staffContext.data?.storeAddress ?? null,
      bankName: staffContext.data?.bankName ?? null,
      bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
      bankAccountName: staffContext.data?.bankAccountName ?? null,
    },
  };
  return (
    <main className="staff-invoice-page">
      {holder}
      <Result
        status="success"
        title="Thanh toán thành công"
        subTitle={`Hóa đơn ${data.invoice.displayCode}`}
      />
      <section className="staff-invoice-sheet">
        <header>
          <div>
            <strong>Pro POS</strong>
            <span>{data.invoice.orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang đi'}</span>
          </div>
          <div>
            <b>{data.invoice.displayCode}</b>
            <span>{formatDateTime(data.invoice.issuedAt)}</span>
          </div>
        </header>
        <div className="staff-invoice-lines">
          {data.lines.map((line) => {
            const snapshot = JSON.parse(line.snapshotJson) as {
              productType?: 'QUANTITY' | 'WEIGHT' | 'TIME';
              unitName?: string | null;
              variantName?: string | null;
              note?: string | null;
              elapsedSeconds?: number;
              startedAtMs?: number;
              endedAtMs?: number | null;
              segments?: Array<{
                name: string;
                elapsedSeconds: number;
                amountBeforeRoundingVnd: number;
              }>;
              tableSegments?: Array<{
                tableName: string;
                startedAtMs: number;
                endedAtMs: number | null;
                elapsedSeconds: number;
                amountAfterRoundingVnd: number;
                pricingConfig?: { basePriceVnd: number };
              }>;
            };
            const isTimeLine = line.lineType === 'TIME' || snapshot.productType === 'TIME';
            const hasTableTransfer = Boolean(
              snapshot.tableSegments && snapshot.tableSegments.length > 1,
            );

            if (isTimeLine && hasTableTransfer) {
              return (
                <div key={line.id} className="is-time staff-invoice-transfer-block">
                  <div className="staff-invoice-transfer-header">
                    <div className="staff-invoice-transfer-title">
                      <strong>Tiền giờ (Chuyển bàn)</strong>
                      <small className="staff-invoice-transfer-subtitle">
                        {snapshot.tableSegments!.map((s) => s.tableName).join(' → ')}
                      </small>
                    </div>
                    <b className="staff-invoice-transfer-total">{formatMoney(line.lineTotal)}</b>
                  </div>

                  <div className="staff-invoice-transfer-segments-table">
                    {snapshot.tableSegments!.map((tSeg, idx) => (
                      <div key={idx} className="staff-invoice-transfer-row">
                        <div className="staff-invoice-transfer-row__left">
                          <span className="staff-invoice-transfer-row__dot">•</span>
                          <strong className="staff-invoice-transfer-row__name">
                            {tSeg.tableName}:
                          </strong>{' '}
                          <span className="staff-invoice-transfer-row__time">
                            {formatClock(tSeg.startedAtMs)}–
                            {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'} (
                            {formatElapsed(tSeg.elapsedSeconds)}
                            {tSeg.pricingConfig
                              ? ` @ ${formatMoney(tSeg.pricingConfig.basePriceVnd)}/h`
                              : ''}
                            )
                          </span>
                        </div>
                        <span className="staff-invoice-transfer-row__amount">
                          {formatMoney(tSeg.amountAfterRoundingVnd)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="staff-invoice-transfer-summary-line">
                    <small>
                      Tổng thời gian: {formatElapsed(snapshot.elapsedSeconds ?? 0)} (
                      {formatDateTime(snapshot.startedAtMs!)} –{' '}
                      {formatDateTime(snapshot.endedAtMs ?? data.invoice.issuedAt)})
                    </small>
                  </div>
                </div>
              );
            }

            return (
              <div key={line.id} className={isTimeLine ? 'is-time' : ''}>
                <span>
                  <strong>{line.description}</strong>
                  {isTimeLine && snapshot.startedAtMs ? (
                    <small>
                      {formatClock(snapshot.startedAtMs)}–
                      {snapshot.endedAtMs ? formatClock(snapshot.endedAtMs) : 'hiện tại'} ·{' '}
                      {formatElapsed(snapshot.elapsedSeconds ?? 0)}
                    </small>
                  ) : (
                    <small>
                      {[snapshot.variantName, snapshot.note].filter(Boolean).join(' · ')}
                    </small>
                  )}
                  {snapshot.segments?.map((segment, index) => (
                    <small key={`${segment.name}-${index}`}>
                      {segment.name}: {formatElapsed(segment.elapsedSeconds)} ·{' '}
                      {formatMoney(segment.amountBeforeRoundingVnd)}
                    </small>
                  ))}
                </span>
                <span>
                  {line.lineType === 'PRODUCT' && snapshot.productType !== 'TIME'
                    ? formatItemQuantity(
                        snapshot.productType ?? 'QUANTITY',
                        line.quantityMilli,
                        snapshot.unitName ?? null,
                      )
                    : ''}
                </span>
                <b>{formatMoney(line.lineTotal)}</b>
              </div>
            );
          })}
        </div>
        <footer>
          <div>
            <span>Tạm tính</span>
            <b>{formatMoney(data.invoice.subtotal)}</b>
          </div>
          <div>
            <span>Giảm giá</span>
            <b>{formatMoney(data.invoice.discountTotal)}</b>
          </div>
          <div className="staff-invoice-grand-total">
            <span>Khách đã trả</span>
            <b>{formatMoney(data.invoice.total)}</b>
          </div>
          <div>
            <span>Phương thức</span>
            <b>{data.payment.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}</b>
          </div>
          {data.payment.method === 'CASH' ? (
            <>
              <div>
                <span>Tiền khách đưa</span>
                <b>{formatMoney(data.payment.cashReceived ?? 0)}</b>
              </div>
              <div>
                <span>Tiền thừa</span>
                <b>{formatMoney(data.payment.cashChange ?? 0)}</b>
              </div>
            </>
          ) : null}
          {data.allocations.length > 0 ? (
            <>
              {data.allocations.map((allocation) => (
                <div key={allocation.id}>
                  <span>
                    {allocation.method === 'CASH'
                      ? 'Tiền mặt'
                      : allocation.method === 'DEBT'
                        ? 'Ghi công nợ'
                        : 'Chuyển khoản'}
                  </span>
                  <b className={allocation.method === 'DEBT' ? 'text-danger' : ''}>
                    {formatMoney(allocation.amountVnd)}
                  </b>
                </div>
              ))}
              <div>
                <span>Đã thanh toán</span>
                <b>
                  {formatMoney(
                    data.allocations
                      .filter((allocation) => allocation.method !== 'DEBT')
                      .reduce((sum, allocation) => sum + allocation.amountVnd, 0),
                  )}
                </b>
              </div>
              <div>
                <span>Còn ghi nợ</span>
                <b className="text-danger">
                  {formatMoney(
                    data.allocations
                      .filter((allocation) => allocation.method === 'DEBT')
                      .reduce((sum, allocation) => sum + allocation.amountVnd, 0),
                  )}
                </b>
              </div>
            </>
          ) : null}
        </footer>
      </section>
      <div className="staff-invoice-actions">
        <Button size="large" onClick={() => navigate('/pos')}>
          Về danh sách đơn
        </Button>
        <Button size="large" icon={<FileTextOutlined />} onClick={() => setPrintPreviewOpen(true)}>
          Xem trước hóa đơn
        </Button>
        <Button
          type="primary"
          size="large"
          icon={<PrinterOutlined />}
          loading={printing}
          onClick={async () => {
            setPrinting(true);
            try {
              const result = await printReceipt(invoicePrintOptions);
              if (result.success) messageApi.success('Đã gửi lệnh in hóa đơn!');
              else messageApi.error(result.message ?? 'Không thể in hóa đơn.');
            } finally {
              setPrinting(false);
            }
          }}
        >
          In hóa đơn
        </Button>
      </div>
      <ReceiptPreviewModal
        open={printPreviewOpen}
        title={`Xem trước hóa đơn ${data.invoice.displayCode}`}
        options={invoicePrintOptions}
        onCancel={() => setPrintPreviewOpen(false)}
        previewOnly
      />
    </main>
  );
}

type PaymentMethodType = 'CASH' | 'BANK_TRANSFER' | 'DEBT';

interface PaymentMethodItem {
  key: PaymentMethodType;
  label: string;
  backendMethod: 'CASH' | 'BANK_TRANSFER';
  allocationMethod?: 'CASH' | 'BANK_TRANSFER';
  icon: React.ReactNode;
}

const PAYMENT_METHODS: PaymentMethodItem[] = [
  {
    key: 'CASH',
    label: 'Tiền mặt',
    backendMethod: 'CASH',
    allocationMethod: 'CASH',
    icon: (
      <div
        style={{
          width: 36,
          height: 24,
          background: '#10b981',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        $
      </div>
    ),
  },
  {
    key: 'BANK_TRANSFER',
    label: 'Chuyển khoản',
    backendMethod: 'BANK_TRANSFER',
    allocationMethod: 'BANK_TRANSFER',
    icon: <CreditCardOutlined style={{ fontSize: 24, color: '#0877ee' }} />,
  },
  {
    key: 'DEBT',
    label: 'Ghi nợ - Thanh toán sau',
    backendMethod: 'BANK_TRANSFER',
    icon: <HistoryOutlined style={{ fontSize: 26, color: '#0877ee' }} />,
  },
];

function PaymentPage({ orderId, auth }: { orderId: string; auth: AuthContextResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const quotePollingInterval = usePosPollingInterval(5_000);
  const [messageApi, holder] = message.useMessage();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodType>('CASH');
  const [isMultiMethod, setIsMultiMethod] = useState(false);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [cashApplied, setCashApplied] = useState(0);
  const [bankApplied, setBankApplied] = useState(0);
  const [debtAmount, setDebtAmount] = useState(0);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [_attachedCustomer, setAttachedCustomer] = useState<{
    name: string;
    phone?: string | undefined;
  } | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [paymentPreviewOpen, setPaymentPreviewOpen] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [prepareCheckoutError, setPrepareCheckoutError] = useState<string | null>(null);
  const [returningToOrder, setReturningToOrder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const checkoutPreparationStartedRef = useRef(false);
  const checkoutWasFrozenRef = useRef(false);
  const csrf = auth.csrfToken!;

  const quote = useQuery({
    queryKey: ['pos-order-quote', orderId],
    queryFn: () => apiRequest<OrderQuote>(`/api/v1/pos/orders/${orderId}/quote`),
    refetchInterval: quotePollingInterval,
  });

  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
  });

  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });

  useEffect(() => {
    const currentQuote = quote.data;
    if (!currentQuote?.time) return;
    if (currentQuote.order.status === 'PAYMENT_PENDING') {
      armPaymentReturn(orderId, currentQuote.order.version);
    } else if (currentQuote.order.status === 'OPEN' && !checkoutWasFrozenRef.current) {
      armPaymentReturn(orderId);
    }
  }, [orderId, quote.data?.order.status, quote.data?.order.version, Boolean(quote.data?.time)]);

  const resumeFrozenCheckout = async (frozenQuote: OrderQuote, notify: boolean) => {
    const sendResume = (expectedOrderVersion: number) =>
      jsonRequest<{
        orderId: string;
        status: 'OPEN';
        resumedAt: number;
        quote: OrderQuote;
      }>(
        `/api/v1/pos/orders/${frozenQuote.order.id}/resume-checkout`,
        { expectedOrderVersion },
        { headers: mutationHeaders(csrf) },
      );

    let result;
    try {
      result = await sendResume(frozenQuote.order.version);
    } catch (error) {
      // Another tab may have updated customer/order metadata while checkout was
      // pending. Reload the authoritative version and retry the resume once.
      const refreshed = await apiRequest<OrderQuote>(
        `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
      );
      if (!refreshed.time || refreshed.order.status === 'OPEN') return true;
      if (
        refreshed.order.status !== 'PAYMENT_PENDING' ||
        refreshed.order.version === frozenQuote.order.version
      ) {
        throw error;
      }
      result = await sendResume(refreshed.order.version);
    }

    queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], (cached) =>
      !cached || result.quote.order.version >= cached.order.version ? result.quote : cached,
    );
    clearPaymentPageActive(frozenQuote.order.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
    ]);
    if (notify) {
      messageApi.success(
        `Đã tự động tiếp tục tính giờ cho ${frozenQuote.order.tableName ?? 'bàn'}.`,
      );
    }
    return true;
  };

  // Payment must always use a server-frozen quote. Several screens can navigate
  // directly to this route, so the payment page is the final safety boundary.
  useEffect(() => {
    const currentQuote = quote.data;
    if (currentQuote?.order.status === 'PAYMENT_PENDING') {
      checkoutPreparationStartedRef.current = true;
      checkoutWasFrozenRef.current = true;
      return;
    }
    if (currentQuote?.order.status === 'OPEN' && checkoutWasFrozenRef.current) {
      clearPaymentPageActive(currentQuote.order.id);
      navigate(`/pos/orders/${currentQuote.order.id}`, { replace: true });
      return;
    }
    if (
      !currentQuote?.time ||
      currentQuote.order.status !== 'OPEN' ||
      checkoutPreparationStartedRef.current
    ) {
      return;
    }

    checkoutPreparationStartedRef.current = true;
    setPreparingCheckout(true);
    setPrepareCheckoutError(null);

    void jsonRequest<{
      orderId: string;
      status: 'PAYMENT_PENDING';
      stoppedAt: number;
      quote: OrderQuote;
    }>(
      `/api/v1/pos/orders/${currentQuote.order.id}/stop-time`,
      { expectedOrderVersion: currentQuote.order.version },
      { headers: mutationHeaders(csrf) },
    )
      .then(async (result) => {
        checkoutWasFrozenRef.current = true;
        const cachedQuote = queryClient.getQueryData<OrderQuote>(['pos-order-quote', orderId]);
        if (!cachedQuote || result.quote.order.version >= cachedQuote.order.version) {
          queryClient.setQueryData(['pos-order-quote', orderId], result.quote);
        } else if (cachedQuote.order.status === 'OPEN') {
          clearPaymentPageActive(result.quote.order.id);
          navigate(`/pos/orders/${result.quote.order.id}`, { replace: true });
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
          queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
        ]);
      })
      .catch(async (error) => {
        // A concurrent order update can make the version stale. Refetching lets
        // this effect retry with the authoritative version; other failures stay
        // visible and keep all payment controls blocked.
        const refreshed = await quote.refetch();
        if (refreshed.data?.order.version !== currentQuote.order.version) {
          checkoutPreparationStartedRef.current = false;
          return;
        }
        setPrepareCheckoutError(errorText(error));
      })
      .finally(() => setPreparingCheckout(false));
  }, [csrf, navigate, orderId, prepareCheckoutError, preparingCheckout, queryClient, quote.data]);

  const handleCopy = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    messageApi.success(`Đã sao chép ${label}`);
  };

  // Mặc định tiền khách đưa điền đúng giá tiền khách phải trả
  useEffect(() => {
    if (quote.data && cashReceived === null) {
      setCashReceived(quote.data.totalVnd);
    }
  }, [quote.data, cashReceived]);

  const totalVnd = quote.data?.totalVnd ?? 0;
  const currentMethodItem =
    PAYMENT_METHODS.find((m) => m.key === selectedMethod) ?? PAYMENT_METHODS[0]!;
  const isDebtMethod = selectedMethod === 'DEBT';

  const changeVnd = selectedMethod === 'CASH' ? Math.max(0, (cashReceived ?? 0) - totalVnd) : 0;
  const currentDebtAmount = isMultiMethod
    ? debtAmount
    : isDebtMethod
      ? Math.max(0, totalVnd - cashApplied)
      : 0;
  const currentReceiptAllocations: Array<{
    method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
    amountVnd: number;
  }> = isMultiMethod
    ? [
        ...(cashApplied > 0 ? [{ method: 'CASH' as const, amountVnd: cashApplied }] : []),
        ...(bankApplied > 0 ? [{ method: 'BANK_TRANSFER' as const, amountVnd: bankApplied }] : []),
        ...(debtAmount > 0 ? [{ method: 'DEBT' as const, amountVnd: debtAmount }] : []),
      ]
    : isDebtMethod
      ? [
          ...(cashApplied > 0 ? [{ method: 'CASH' as const, amountVnd: cashApplied }] : []),
          ...(currentDebtAmount > 0
            ? [{ method: 'DEBT' as const, amountVnd: currentDebtAmount }]
            : []),
        ]
      : [
          {
            method: selectedMethod === 'CASH' ? ('CASH' as const) : ('BANK_TRANSFER' as const),
            amountVnd: totalVnd,
          },
        ];
  const buildCurrentPaymentPrintData = () => {
    if (!quote.data) return null;
    const data = buildPrintDataFromQuote(
      quote.data,
      'PAYMENT',
      currentMethodItem.backendMethod,
      cashReceived,
    );
    data.paymentAllocations = currentReceiptAllocations;
    data.paidAmountVnd = Math.max(0, totalVnd - currentDebtAmount);
    data.debtAmountVnd = currentDebtAmount;
    return data;
  };
  const paymentPreviewOptions = quote.data
    ? {
        data: buildCurrentPaymentPrintData()!,
        printSettings: printSettings.data,
        storeInfo: {
          storeName: staffContext.data?.storeName ?? null,
          phone: staffContext.data?.storePhone ?? null,
          address: staffContext.data?.storeAddress ?? null,
          bankName: staffContext.data?.bankName ?? null,
          bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
          bankAccountName: staffContext.data?.bankAccountName ?? null,
        },
      }
    : null;

  const resumeCheckoutForReturn = async () => {
    if (!quote.data?.time || quote.data.order.status !== 'PAYMENT_PENDING') return true;
    setReturningToOrder(true);
    try {
      return await resumeFrozenCheckout(quote.data, true);
    } catch (error) {
      messageApi.error(errorText(error));
      return false;
    } finally {
      setReturningToOrder(false);
    }
  };

  const handleBackToOrder = async () => {
    if (!quote.data || returningToOrder || preparingCheckout || submitting) return;
    const resumed = await resumeCheckoutForReturn();
    if (!resumed) return;
    navigate(`/pos/orders/${orderId}`, { replace: true });
  };

  const handleConfirmPayment = async (andPrint = false) => {
    if (!quote.data || submitting) return;
    if (quote.data.time && quote.data.order.status !== 'PAYMENT_PENDING') {
      messageApi.error('Chưa thể chốt số tiền. Vui lòng đợi hệ thống dừng giờ của bàn.');
      return;
    }
    if (
      !isMultiMethod &&
      selectedMethod === 'CASH' &&
      (cashReceived === null || cashReceived < totalVnd)
    ) {
      messageApi.warning('Số tiền khách đưa chưa đủ để thanh toán.');
      return;
    }
    if (isMultiMethod && cashApplied + bankApplied + debtAmount !== totalVnd) {
      messageApi.warning('Tổng tiền mặt, chuyển khoản và công nợ phải bằng giá trị hóa đơn.');
      return;
    }
    if (debtAmount > 0 && !quote.data.order.customerId) {
      messageApi.warning('Vui lòng chọn khách hàng trước khi ghi nợ.');
      return;
    }
    if (isDebtMethod && !quote.data.order.customerId) {
      messageApi.warning('Vui lòng chọn hoặc tạo khách hàng để ghi nợ.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await jsonRequest<{
        invoiceId: string;
        displayCode?: string;
      }>(
        `/api/v1/pos/orders/${quote.data.order.id}/checkout`,
        {
          expectedOrderVersion: quote.data.order.version,
          method: currentMethodItem.backendMethod,
          cashReceivedVnd: currentMethodItem.backendMethod === 'CASH' ? cashReceived : null,
          allocations: isMultiMethod
            ? [
                ...(cashApplied > 0
                  ? [
                      {
                        method: 'CASH',
                        amountVnd: cashApplied,
                        tenderedVnd: cashReceived ?? cashApplied,
                      },
                    ]
                  : []),
                ...(bankApplied > 0 ? [{ method: 'BANK_TRANSFER', amountVnd: bankApplied }] : []),
              ]
            : isDebtMethod
              ? cashApplied > 0
                ? [{ method: 'CASH', amountVnd: cashApplied, tenderedVnd: cashApplied }]
                : []
              : currentMethodItem.allocationMethod && selectedMethod !== 'CASH'
                ? [{ method: currentMethodItem.allocationMethod, amountVnd: totalVnd }]
                : undefined,
          debtAmountVnd: isMultiMethod ? debtAmount : isDebtMethod ? totalVnd - cashApplied : 0,
        },
        { headers: mutationHeaders(csrf) },
      );
      void queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });

      if (andPrint) {
        const printData = buildCurrentPaymentPrintData()!;
        const resolvedCode =
          result.displayCode ||
          quote.data.order.displayCode ||
          (quote.data.order.id ? `HD-${quote.data.order.id.slice(0, 8).toUpperCase()}` : '—');
        printData.orderCode = resolvedCode;
        printData.invoiceCode = resolvedCode;
        const printResult = await printReceipt({
          data: printData,
          printSettings: printSettings.data,
          storeInfo: {
            storeName: staffContext.data?.storeName ?? null,
            phone: staffContext.data?.storePhone ?? null,
            address: staffContext.data?.storeAddress ?? null,
            bankName: staffContext.data?.bankName ?? null,
            bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
            bankAccountName: staffContext.data?.bankAccountName ?? null,
          },
        });
        if (printResult.success) {
          messageApi.success('Thanh toán và in hóa đơn thành công!');
        } else {
          messageApi.warning(
            `Thanh toán thành công nhưng chưa in được hóa đơn: ${printResult.message ?? 'Không rõ lỗi'}`,
          );
        }
      } else {
        messageApi.success('Thanh toán đơn hàng thành công!');
      }

      // Return directly to POS home
      clearPaymentPageActive(quote.data.order.id);
      navigate('/pos', { replace: true });
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCustomer = () => {
    if (!customerName.trim()) {
      messageApi.warning('Vui lòng nhập tên khách hàng.');
      return;
    }
    setAttachedCustomer({
      name: customerName.trim(),
      phone: customerPhone.trim() || undefined,
    });
    setCustomerModalOpen(false);
    messageApi.success('Đã lưu thông tin khách hàng vào đơn.');
  };

  return (
    <div className="staff-payment-page">
      {holder}
      <header className="staff-payment-page__header">
        <Button
          type="text"
          icon={<LeftOutlined />}
          loading={returningToOrder || preparingCheckout}
          disabled={returningToOrder || preparingCheckout || submitting}
          className="staff-payment-page__back-btn"
          aria-label="Quay lại đơn hàng"
          onClick={() => void handleBackToOrder()}
        />
        <Typography.Title level={4} className="staff-payment-page__title">
          Thanh toán
        </Typography.Title>
      </header>

      {quote.isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin size="large" description="Đang tải dữ liệu thanh toán..." />
        </div>
      ) : quote.isError || !quote.data ? (
        <div style={{ padding: 40 }}>
          <Alert
            type="error"
            showIcon
            title="Không thể tải thông tin đơn hàng"
            description="Đơn hàng không tồn tại hoặc đã kết thúc."
            action={
              <Button type="primary" onClick={() => navigate('/pos')}>
                Về danh sách đơn
              </Button>
            }
          />
        </div>
      ) : prepareCheckoutError ? (
        <div style={{ padding: 40 }}>
          <Alert
            type="error"
            showIcon
            title="Chưa thể chốt số tiền thanh toán"
            description={prepareCheckoutError}
            action={
              <Button
                type="primary"
                onClick={() => {
                  checkoutPreparationStartedRef.current = false;
                  setPrepareCheckoutError(null);
                  void quote.refetch();
                }}
              >
                Thử lại
              </Button>
            }
          />
        </div>
      ) : preparingCheckout || (quote.data.time && quote.data.order.status === 'OPEN') ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin size="large" description="Đang dừng giờ và chốt số tiền trên máy chủ..." />
        </div>
      ) : (
        <div className="staff-payment-page__body">
          <div className="staff-payment-page__left">
            <section className="staff-payment-page__section">
              <div className="staff-payment-page__section-title">Khách hàng</div>
              <PosCustomerSelector
                customerId={quote.data.order.customerId ?? null}
                csrfToken={csrf}
                allowCreate
                variant="compact"
                onSelect={async (customer) => {
                  await jsonRequest(
                    `/api/v1/pos/orders/${orderId}/guest`,
                    {
                      expectedOrderVersion: quote.data!.order.version,
                      guestCount: quote.data!.order.guestCount ?? 1,
                      customerId: customer?.id ?? null,
                    },
                    { method: 'PATCH', headers: mutationHeaders(csrf) },
                  );
                  await queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] });
                }}
              />
            </section>

            <section className="staff-payment-page__section">
              <div className="staff-payment-page__methods-header">
                <div className="staff-payment-page__section-title" style={{ margin: 0 }}>
                  Thanh toán
                </div>
                <div className="staff-payment-page__multi-switch">
                  <span>Nhiều phương thức</span>
                  <Switch checked={isMultiMethod} onChange={setIsMultiMethod} />
                </div>
              </div>

              <div className="staff-payment-page__methods-grid">
                {PAYMENT_METHODS.map((method) => {
                  const isActive = selectedMethod === method.key;
                  return (
                    <button
                      key={method.key}
                      type="button"
                      className={`staff-payment-method-card ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelectedMethod(method.key);
                        if (method.key === 'DEBT') {
                          setCashApplied(0);
                          setBankApplied(0);
                          setDebtAmount(totalVnd);
                        } else {
                          setDebtAmount(0);
                        }
                        if (cashReceived === null || cashReceived === 0) {
                          setCashReceived(totalVnd);
                        }
                      }}
                    >
                      <div className="staff-payment-method-card__icon">{method.icon}</div>
                      <span>{method.label}</span>
                      {isActive ? (
                        <div className="staff-payment-method-card__badge">
                          <CheckOutlined />
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {isMultiMethod ? (
                <div className="staff-payment-allocations">
                  <label>
                    Tiền mặt
                    <InputNumber
                      min={0}
                      max={totalVnd}
                      value={cashApplied}
                      onChange={(v) => setCashApplied(Number(v ?? 0))}
                      addonAfter="đ"
                    />
                  </label>
                  <label>
                    Chuyển khoản
                    <InputNumber
                      min={0}
                      max={totalVnd}
                      value={bankApplied}
                      onChange={(v) => setBankApplied(Number(v ?? 0))}
                      addonAfter="đ"
                    />
                  </label>
                  <label>
                    Ghi công nợ
                    <InputNumber
                      min={0}
                      max={totalVnd}
                      value={debtAmount}
                      onChange={(v) => setDebtAmount(Number(v ?? 0))}
                      addonAfter="đ"
                    />
                  </label>
                  <Typography.Text
                    type={
                      cashApplied + bankApplied + debtAmount === totalVnd ? 'success' : 'danger'
                    }
                  >
                    Còn lại: {formatMoney(totalVnd - cashApplied - bankApplied - debtAmount)}
                  </Typography.Text>
                </div>
              ) : null}
            </section>

            {selectedMethod === 'BANK_TRANSFER'
              ? (() => {
                  const bankSettings = quote.data?.bankSettings;
                  const hasBank = Boolean(
                    bankSettings?.bankName && bankSettings?.bankAccountNumber,
                  );
                  const transferNote =
                    `TT ${quote.data?.order.tableName ? `${quote.data.order.tableName} ` : ''}${quote.data?.order.displayCode || quote.data?.order.id.slice(0, 6) || ''}`.trim();

                  return (
                    <section className="staff-payment-page__section staff-vietqr-card">
                      <div className="staff-vietqr-card__header">
                        <div className="staff-vietqr-card__title">
                          <QrcodeOutlined style={{ color: '#0877ee', fontSize: 18 }} />
                          <span>Thông tin chuyển khoản</span>
                        </div>
                        <Tag color="processing" style={{ borderRadius: 12, margin: 0 }}>
                          Tự động điền số tiền
                        </Tag>
                      </div>

                      {hasBank ? (
                        <div className="staff-vietqr-details" style={{ width: '100%' }}>
                          <div className="staff-vietqr-detail-item">
                            <span className="staff-vietqr-detail-label">Số tài khoản</span>
                            <div className="staff-vietqr-detail-value">
                              <strong className="staff-vietqr-copyable">
                                {bankSettings?.bankAccountNumber}
                              </strong>
                              <Tooltip title="Sao chép STK">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() =>
                                    handleCopy(
                                      bankSettings?.bankAccountNumber || '',
                                      'số tài khoản',
                                    )
                                  }
                                />
                              </Tooltip>
                            </div>
                          </div>

                          {bankSettings?.bankAccountName ? (
                            <div className="staff-vietqr-detail-item">
                              <span className="staff-vietqr-detail-label">Chủ tài khoản</span>
                              <div className="staff-vietqr-detail-value">
                                <strong>{bankSettings.bankAccountName}</strong>
                                <Tooltip title="Sao chép tên chủ TK">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() =>
                                      handleCopy(
                                        bankSettings.bankAccountName || '',
                                        'tên chủ tài khoản',
                                      )
                                    }
                                  />
                                </Tooltip>
                              </div>
                            </div>
                          ) : null}

                          <div className="staff-vietqr-detail-item">
                            <span className="staff-vietqr-detail-label">Số tiền cần chuyển</span>
                            <div className="staff-vietqr-detail-value">
                              <strong style={{ color: '#0877ee', fontSize: 16 }}>
                                {formatMoney(totalVnd)}
                              </strong>
                              <Tooltip title="Sao chép số tiền">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => handleCopy(String(totalVnd), 'số tiền')}
                                />
                              </Tooltip>
                            </div>
                          </div>

                          <div className="staff-vietqr-detail-item">
                            <span className="staff-vietqr-detail-label">Nội dung CK</span>
                            <div className="staff-vietqr-detail-value">
                              <strong style={{ color: '#d97706' }}>{transferNote}</strong>
                              <Tooltip title="Sao chép nội dung">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => handleCopy(transferNote, 'nội dung')}
                                />
                              </Tooltip>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Alert
                          type="warning"
                          showIcon
                          title="Chưa cấu hình tài khoản ngân hàng"
                          description={
                            <div style={{ marginTop: 6 }}>
                              <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: 13 }}>
                                Vui lòng cấu hình tài khoản ngân hàng trong Thiết lập để tự động tạo
                                mã VietQR cho khách quét chuyển khoản.
                              </p>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => navigate('/owner/settings/store')}
                              >
                                Đến trang Cấu hình ngân hàng
                              </Button>
                            </div>
                          }
                        />
                      )}
                    </section>
                  );
                })()
              : null}
          </div>

          <div className="staff-payment-page__right">
            <div className="staff-payment-page__right-top">
              {selectedMethod === 'CASH' ? (
                <>
                  <div className="staff-payment-page__input-row">
                    <span className="staff-payment-page__input-label">Tiền khách đưa</span>
                    <div className="staff-payment-page__input-wrap">
                      <InputNumber
                        className="staff-payment-page__amount-input"
                        min={0}
                        value={cashReceived}
                        onChange={(val) => setCashReceived(val === null ? 0 : Number(val))}
                        formatter={(val) => `${val ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
                        parser={(val) => Number((val ?? '').replaceAll(',', ''))}
                        addonAfter="đ"
                      />
                    </div>
                  </div>

                  <div className="staff-payment-page__quick-cash">
                    <button type="button" onClick={() => setCashReceived(totalVnd)}>
                      Đúng giá ({formatMoney(totalVnd)})
                    </button>
                    {[50000, 100000, 200000, 500000]
                      .filter((amount) => amount >= totalVnd)
                      .map((amount) => (
                        <button key={amount} type="button" onClick={() => setCashReceived(amount)}>
                          {formatMoney(amount)}
                        </button>
                      ))}
                  </div>
                </>
              ) : isDebtMethod ? (
                <div className="staff-payment-debt-panel">
                  <div className="staff-payment-page__input-row">
                    <span className="staff-payment-page__input-label">Tiền khách trả trước</span>
                    <div className="staff-payment-page__input-wrap">
                      <InputNumber
                        className="staff-payment-page__amount-input"
                        min={0}
                        max={totalVnd}
                        value={cashApplied}
                        onChange={(value) => {
                          const paid = Number(value ?? 0);
                          setCashApplied(paid);
                          setDebtAmount(Math.max(0, totalVnd - paid));
                        }}
                        formatter={(value) =>
                          `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
                        }
                        parser={(value) => Number((value ?? '').replaceAll(',', ''))}
                        addonAfter="đ"
                      />
                    </div>
                  </div>
                  <div className="staff-payment-page__input-row">
                    <span className="staff-payment-page__input-label">Ghi công nợ</span>
                    <div className="staff-payment-page__input-wrap">
                      <InputNumber
                        className="staff-payment-page__amount-input"
                        value={Math.max(0, totalVnd - cashApplied)}
                        readOnly
                        formatter={(value) =>
                          `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
                        }
                        addonAfter="đ"
                      />
                    </div>
                  </div>
                  {!quote.data.order.customerId ? (
                    <Alert
                      type="error"
                      showIcon
                      message="Vui lòng chọn hoặc tạo khách hàng để ghi nợ."
                    />
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      message={`Khoản nợ ${formatMoney(Math.max(0, totalVnd - cashApplied))} sẽ được ghi vào hồ sơ khách hàng.`}
                    />
                  )}
                </div>
              ) : (
                <>
                  <div className="staff-payment-bank-summary">
                    <div className="staff-payment-bank-summary__badge">
                      <CreditCardOutlined /> Chuyển khoản ngân hàng (VietQR)
                    </div>
                    <p className="staff-payment-bank-summary__hint">
                      Khách quét mã VietQR bên dưới để thanh toán đúng số tiền{' '}
                      <b>{formatMoney(totalVnd)}</b>. Sau khi kiểm tra tiền đã vào tài khoản, bấm
                      nút <b>Xác nhận đã nhận tiền</b>.
                    </p>
                  </div>

                  {(() => {
                    const bankSettings = quote.data?.bankSettings;
                    const hasBank = Boolean(
                      bankSettings?.bankName && bankSettings?.bankAccountNumber,
                    );
                    const transferNote =
                      `TT ${quote.data?.order.tableName ? `${quote.data.order.tableName} ` : ''}${quote.data?.order.displayCode || quote.data?.order.id.slice(0, 6) || ''}`.trim();
                    const qrUrl = hasBank
                      ? `https://img.vietqr.io/image/${encodeURIComponent(bankSettings!.bankName!.trim())}-${encodeURIComponent(bankSettings!.bankAccountNumber!.trim())}-compact2.png?amount=${totalVnd}&addInfo=${encodeURIComponent(transferNote)}&accountName=${encodeURIComponent(bankSettings!.bankAccountName?.trim() || '')}`
                      : null;

                    if (!hasBank || !qrUrl) return null;

                    return (
                      <div
                        className="staff-vietqr-sidebar-box"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 10,
                          padding: '12px 0 4px',
                        }}
                      >
                        <div
                          className="staff-vietqr-img-wrapper"
                          onClick={() => setQrModalOpen(true)}
                          title="Nhấn để phóng to mã QR"
                          style={{
                            maxWidth: 340,
                            width: '100%',
                            cursor: 'pointer',
                            borderRadius: 12,
                            overflow: 'hidden',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 6px 24px rgba(0, 0, 0, 0.08)',
                            background: '#fff',
                          }}
                        >
                          <img
                            src={qrUrl}
                            alt="VietQR Payment"
                            className="staff-vietqr-img"
                            loading="eager"
                            style={{ display: 'block', width: '100%', height: 'auto' }}
                          />
                          <div className="staff-vietqr-img-overlay">
                            <FullscreenOutlined /> Phóng to QR
                          </div>
                        </div>
                        <Button
                          type="dashed"
                          icon={<FullscreenOutlined />}
                          onClick={() => setQrModalOpen(true)}
                          className="staff-vietqr-zoom-btn"
                          style={{ maxWidth: 340, width: '100%' }}
                        >
                          Phóng to cho khách quét
                        </Button>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="staff-payment-page__right-bottom">
              <div className="staff-payment-sticky-summary">
                <div className="staff-payment-page__change-row staff-payment-page__change-row--total">
                  <span className="staff-payment-page__change-label">Khách phải trả</span>
                  <strong className="staff-payment-page__total-val">{formatMoney(totalVnd)}</strong>
                </div>
                {selectedMethod === 'CASH' ? (
                  <div className="staff-payment-page__change-row">
                    <span className="staff-payment-page__change-label">Tiền thừa trả khách</span>
                    <strong className="staff-payment-page__change-val">
                      {formatMoney(changeVnd)}
                    </strong>
                  </div>
                ) : (
                  <div className="staff-payment-page__change-row">
                    <span className="staff-payment-page__change-label">Phương thức</span>
                    <Tag color="blue">
                      {isDebtMethod ? 'Ghi nợ - Thanh toán sau' : 'Chuyển khoản VietQR'}
                    </Tag>
                  </div>
                )}
              </div>

              <div className="staff-payment-actions-grid">
                <Button
                  type="primary"
                  icon={<PrinterOutlined />}
                  className="staff-payment-page__submit-btn"
                  loading={submitting}
                  disabled={
                    !quote.data ||
                    (selectedMethod === 'CASH' && (cashReceived ?? 0) < totalVnd) ||
                    (isDebtMethod && !quote.data.order.customerId)
                  }
                  onClick={() => {
                    void handleConfirmPayment(true);
                  }}
                >
                  {isDebtMethod
                    ? 'Ghi nợ & in'
                    : selectedMethod === 'CASH'
                      ? 'Thanh toán & in'
                      : 'Đã nhận tiền & in'}
                </Button>
                <Button
                  icon={<FileTextOutlined />}
                  disabled={!quote.data}
                  onClick={() => setPaymentPreviewOpen(true)}
                >
                  Xem trước
                </Button>
                <Button
                  icon={<CheckOutlined />}
                  disabled={
                    !quote.data ||
                    (selectedMethod === 'CASH' && (cashReceived ?? 0) < totalVnd) ||
                    (isDebtMethod && !quote.data.order.customerId)
                  }
                  onClick={() => {
                    void handleConfirmPayment(false);
                  }}
                >
                  {isDebtMethod
                    ? 'Ghi nợ'
                    : selectedMethod === 'CASH'
                      ? 'Thanh toán'
                      : 'Đã nhận tiền'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={qrModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <QrcodeOutlined style={{ color: '#0877ee', fontSize: 18 }} />
            <span>Mã QR Chuyển khoản - {quote.data?.order.tableName || 'Đơn hàng'}</span>
          </div>
        }
        footer={[
          <Button key="close" type="primary" size="large" onClick={() => setQrModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        onCancel={() => setQrModalOpen(false)}
        centered
        width={420}
      >
        {(() => {
          const bankSettings = quote.data?.bankSettings;
          const hasBank = Boolean(bankSettings?.bankName && bankSettings?.bankAccountNumber);
          const transferNote =
            `TT ${quote.data?.order.tableName ? `${quote.data.order.tableName} ` : ''}${quote.data?.order.displayCode || quote.data?.order.id.slice(0, 6) || ''}`.trim();
          const qrUrl = hasBank
            ? `https://img.vietqr.io/image/${encodeURIComponent(bankSettings!.bankName!.trim())}-${encodeURIComponent(bankSettings!.bankAccountNumber!.trim())}-compact2.png?amount=${totalVnd}&addInfo=${encodeURIComponent(transferNote)}&accountName=${encodeURIComponent(bankSettings!.bankAccountName?.trim() || '')}`
            : null;

          if (!qrUrl) return null;
          return (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <img
                src={qrUrl}
                alt="VietQR Full"
                style={{
                  maxWidth: '100%',
                  width: '100%',
                  borderRadius: 12,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                  border: '1px solid #e2e8f0',
                }}
              />
              <div style={{ marginTop: 14, fontSize: 18, fontWeight: 800, color: '#0877ee' }}>
                {formatMoney(totalVnd)}
              </div>
              <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
                Nội dung CK: <strong style={{ color: '#d97706' }}>{transferNote}</strong>
              </div>
            </div>
          );
        })()}
      </Modal>
      <ReceiptPreviewModal
        open={paymentPreviewOpen}
        title="Xem trước hóa đơn thanh toán"
        options={paymentPreviewOptions}
        onCancel={() => setPaymentPreviewOpen(false)}
        previewOnly
      />

      <Modal
        open={customerModalOpen}
        title="Thêm thông tin khách hàng"
        okText="Lưu khách hàng"
        cancelText="Hủy"
        onOk={handleSaveCustomer}
        onCancel={() => setCustomerModalOpen(false)}
      >
        <div style={{ display: 'grid', gap: 14, paddingTop: 10 }}>
          <label>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Tên khách hàng *
            </span>
            <Input
              placeholder="Nhập tên khách hàng"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </label>
          <label>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Số điện thoại
            </span>
            <Input
              placeholder="Nhập số điện thoại"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

export function StaffPosPortalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ordersSearch, setOrdersSearch] = useState('');
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [onboardingRestartToken, setOnboardingRestartToken] = useState(0);
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const posContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });
  if (auth.isLoading) return <Spin fullscreen description="Đang mở cổng nhân viên" />;
  if (auth.isError || auth.data?.actor?.kind !== 'EMPLOYEE') {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }

  const isInvoiceDetail = location.pathname.startsWith('/pos/invoices/');
  const isInvoicesList =
    location.pathname === '/pos/invoices' || location.pathname.startsWith('/pos/invoices?');
  const isCatalogNewProduct = location.pathname === '/pos/catalog/products/new';
  const isCatalogEditProduct =
    location.pathname.startsWith('/pos/catalog/products/') && !isCatalogNewProduct;
  const isCatalogCategoryDetail =
    location.pathname.startsWith('/pos/catalog/categories/') &&
    location.pathname !== '/pos/catalog/categories';
  const isCatalogCategories = location.pathname === '/pos/catalog/categories';
  const isCatalogList =
    location.pathname === '/pos/catalog' ||
    location.pathname === '/pos/catalog/' ||
    location.pathname === '/pos/catalog/products' ||
    location.pathname.startsWith('/pos/catalog/products?');
  const isCatalog =
    isCatalogNewProduct ||
    isCatalogEditProduct ||
    isCatalogCategoryDetail ||
    isCatalogCategories ||
    isCatalogList;
  const isPrinterSettings = location.pathname === '/pos/printers';

  const isDetail =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/detail');
  const isPayment =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/payment');
  const isEditor = location.pathname.startsWith('/pos/orders/') && !isPayment && !isDetail;
  const isFullScreen =
    isInvoiceDetail || isPayment || isEditor || isDetail || isCatalog || isPrinterSettings;
  const active = location.pathname.startsWith('/pos/areas')
    ? 'areas'
    : location.pathname.startsWith('/pos/qr-order')
      ? 'qr'
      : location.pathname.startsWith('/pos/more') ||
          isInvoicesList ||
          isCatalog ||
          isPrinterSettings
        ? 'more'
        : 'orders';

  const detailOrderId = isDetail ? location.pathname.split('/')[3] : undefined;
  const paymentOrderId = isPayment ? location.pathname.split('/')[3] : undefined;

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND, borderRadius: 8 } }}>
      <RealtimeProvider>
        <div className={`staff-pos-shell${isFullScreen ? ' staff-pos-shell--editor' : ''}`}>
          <PushNotificationControl csrfToken={auth.data.csrfToken} autoPrompt />
          <StaffOnboarding auth={auth.data} restartToken={onboardingRestartToken} />
          {!isFullScreen ? (
            <StaffHeader
              context={auth.data}
              onOpenNotifications={() => setNotificationCenterOpen(true)}
              searchSlot={
                active === 'orders' ? (
                  <Input
                    size="large"
                    allowClear
                    prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
                    placeholder="Tìm kiếm đơn hàng..."
                    value={ordersSearch}
                    onChange={(event) => setOrdersSearch(event.target.value)}
                  />
                ) : null
              }
            />
          ) : null}
          <div className="staff-pos-main">
            {isPrinterSettings ? (
              <StaffPrinterSettingsPage
                csrfToken={auth.data.csrfToken}
                storeName={posContext.data?.storeName ?? 'PRO POS'}
                onBack={() => navigate('/pos/more')}
              />
            ) : isInvoiceDetail ? (
              <InvoicePage />
            ) : isInvoicesList ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerInvoicesPage
                    apiPrefix="/api/v1/pos/invoices"
                    userPermissions={posContext.data?.permissions}
                    isOwner={false}
                    onBack={() => navigate('/pos/more')}
                  />
                </div>
              </div>
            ) : isCatalogNewProduct ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerProductFormPage
                    baseRoute="/pos/catalog"
                    userPermissions={posContext.data?.permissions}
                    isOwner={false}
                    onBack={() => navigate('/pos/catalog/products')}
                  />
                </div>
              </div>
            ) : isCatalogEditProduct ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerProductFormPage
                    productId={location.pathname.split('/').at(-1)!}
                    baseRoute="/pos/catalog"
                    userPermissions={posContext.data?.permissions}
                    isOwner={false}
                    onBack={() => navigate('/pos/catalog/products')}
                  />
                </div>
              </div>
            ) : isCatalogCategoryDetail ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerCategoryDetailPage
                    categoryId={location.pathname.split('/').at(-1)!}
                    baseRoute="/pos/catalog"
                    onBack={() => navigate('/pos/catalog/categories')}
                  />
                </div>
              </div>
            ) : isCatalogCategories ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerCategoryListPage
                    baseRoute="/pos/catalog"
                    onBack={() => navigate('/pos/catalog/products')}
                  />
                </div>
              </div>
            ) : isCatalogList ? (
              <div className="staff-invoices-shell">
                <div className="staff-invoices-container">
                  <OwnerProductListPage
                    baseRoute="/pos/catalog"
                    userPermissions={posContext.data?.permissions}
                    isOwner={false}
                    onBack={() => navigate('/pos/more')}
                  />
                </div>
              </div>
            ) : isDetail && detailOrderId ? (
              <OrderDetailPage orderId={detailOrderId} />
            ) : isPayment && paymentOrderId ? (
              <PaymentPage orderId={paymentOrderId} auth={auth.data} />
            ) : isEditor ? (
              <OrderEditor auth={auth.data} />
            ) : active === 'areas' ? (
              <AreasPage />
            ) : active === 'qr' ? (
              <QrOrderPage />
            ) : active === 'more' ? (
              <MorePage
                auth={auth.data}
                onStartOnboarding={() => setOnboardingRestartToken((value) => value + 1)}
              />
            ) : (
              <OrdersPage search={ordersSearch} />
            )}
          </div>
          {!isFullScreen ? <StaffBottomNav active={active} /> : null}
          <StaffNotificationCenter
            open={notificationCenterOpen}
            onClose={() => setNotificationCenterOpen(false)}
          />
        </div>
      </RealtimeProvider>
    </ConfigProvider>
  );
}
