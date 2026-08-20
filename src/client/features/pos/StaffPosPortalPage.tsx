import {
  AppstoreOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LeftOutlined,
  LogoutOutlined,
  MinusOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  QrcodeOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  SwapOutlined,
  UnorderedListOutlined,
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
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import { calculateTimePrice } from '@domain/pricing/engine';
import type { PricingConfigSnapshot, PricingResult } from '@domain/pricing/types';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

const BRAND = '#0975f7';

interface StaffContext {
  storeId: string;
  storeName: string;
  employeeId: string;
  employeeName: string;
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
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitName: string | null;
  variants: CatalogVariant[];
  timePricingConfig?: PricingConfigSnapshot | null;
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
  };
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
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
    timeStartedAtMs: number | null;
    timeEndedAtMs: number | null;
    timePricing?: (PricingResult & { pricingConfig: PricingConfigSnapshot }) | null;
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
  };
  subtotalVnd: number;
  discountTotalVnd: number;
  totalVnd: number;
}

interface DraftLine {
  id: string;
  product: CatalogProduct;
  variant: CatalogVariant;
  quantityMilli: number;
  note: string | null;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  timeStartedAtMs?: number | undefined;
  timeEndedAtMs?: number | undefined;
}

interface EditingOrderItem {
  source: 'DRAFT' | 'SAVED';
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
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
  timeStartedAtMs?: number | null | undefined;
  timeEndedAtMs?: number | null | undefined;
  timePricing?: (PricingResult & { pricingConfig: PricingConfigSnapshot }) | null | undefined;
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
  snapshot: Record<string, unknown> | null;
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

function calculateLineTotal(unitPriceVnd: number, quantityMilli: number) {
  return Math.floor((unitPriceVnd * quantityMilli + 500) / 1000);
}

function calculateDiscountAmount(
  grossLineTotalVnd: number,
  type: 'FIXED' | 'PERCENT' | null,
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
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME',
  quantityMilli: number,
  unitName: string | null,
) {
  const value = formatDecimal(quantityMilli / 1000);
  if (productType === 'WEIGHT') {
    return `${value} ${getWeightUnit(unitName)}`;
  }
  if (productType === 'TIME') {
    return `${value} ${unitName || 'giờ'}`;
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
  return error instanceof ApiError ? error.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
}

function mutationHeaders(csrfToken: string) {
  return { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': crypto.randomUUID() };
}

function StaffHeader({
  context,
  searchSlot,
}: {
  context: AuthContextResponse | undefined;
  searchSlot?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, holder] = Modal.useModal();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = () => {
    modal.confirm({
      title: 'Xác nhận đăng xuất',
      content: 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống POS?',
      okText: 'Đăng xuất',
      okButtonProps: { danger: true },
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          setLoggingOut(true);
          await apiRequest('/api/v1/auth/logout', { method: 'POST' });
          queryClient.clear();
          navigate('/login');
        } catch {
          // ignore
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
  return (
    <nav className="staff-pos-bottom-nav" aria-label="Điều hướng POS nhân viên">
      {navItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={active === item.key ? 'is-active' : ''}
          onClick={() => navigate(item.path)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function OrdersPage({ search }: { search: string }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY'>('ALL');
  const orders = useQuery({
    queryKey: ['pos-orders'],
    queryFn: () => apiRequest<PosOrder[]>('/api/v1/pos/orders'),
    refetchInterval: 30_000,
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
              <b>{counts[key]}</b>
            </button>
          ))}
        </aside>
        <main className="staff-order-results">
          <div className="staff-mobile-segmented">
            <Segmented
              block
              value={filter}
              options={[
                { value: 'ALL', label: `Tất cả (${counts.ALL})` },
                { value: 'DINE_IN', label: `Tại chỗ (${counts.DINE_IN})` },
                { value: 'TAKEAWAY', label: `Mang đi (${counts.TAKEAWAY})` },
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
        onClick={() => navigate('/pos/orders/new')}
      >
        Tạo đơn mới
      </Button>
    </div>
  );
}

function AreasPage() {
  const navigate = useNavigate();
  const tables = useQuery({
    queryKey: ['pos-tables'],
    queryFn: () => apiRequest<PosTable[]>('/api/v1/pos/tables'),
    refetchInterval: 20_000,
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

function QrOrderPage() {
  return (
    <div className="staff-coming-soon">
      <div className="staff-coming-soon__art">
        <QrcodeOutlined />
      </div>
      <Typography.Title level={2}>QR Order sẽ sớm ra mắt</Typography.Title>
      <Typography.Text type="secondary">
        Yêu cầu gọi món từ QR sẽ được phát triển ở giai đoạn tiếp theo.
      </Typography.Text>
    </div>
  );
}

function MorePage({ auth }: { auth: AuthContextResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
  });
  const logout = useMutation({
    mutationFn: () =>
      apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': auth.csrfToken! },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/?tab=employee', { replace: true });
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
          <Typography.Text>Nhân viên cửa hàng</Typography.Text>
        </div>
      </section>
      <Card className="staff-store-card" loading={context.isLoading}>
        <ShopOutlined />
        <div>
          <strong>{context.data?.storeName ?? 'Cửa hàng'}</strong>
          <span>Mã cửa hàng: {context.data?.storeId ?? '—'}</span>
        </div>
      </Card>
      <Card className="staff-more-actions">
        <button type="button" onClick={() => logout.mutate()}>
          <LogoutOutlined />
          <span>Đăng xuất</span>
        </button>
      </Card>
      <Typography.Text type="secondary" className="staff-version">
        Pro POS · Cổng nhân viên
      </Typography.Text>
    </div>
  );
}

interface StaffTablePickerModalProps {
  open: boolean;
  title?: string;
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
    setSelectedTableId(null);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
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
    <StaffItemDetailModalContent
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

function StaffItemDetailModalContent({
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

  const [timeStartedAt, setTimeStartedAt] = useState<string>(() =>
    formatDateTimeInput(item.timeStartedAtMs ?? Date.now()),
  );
  const [timeEndedAt, setTimeEndedAt] = useState<string>(() =>
    item.timeEndedAtMs ? formatDateTimeInput(item.timeEndedAtMs) : '',
  );
  const [modalClockNow, setModalClockNow] = useState(Date.now());

  useEffect(() => {
    if (item.productType !== 'TIME' || timeEndedAt) return;
    const timer = setInterval(() => {
      setModalClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [item.productType, timeEndedAt]);

  const currentVariant = variants.find((v) => v.id === selectedVariantId) ?? variants[0];
  const unitPriceVnd = currentVariant?.salePriceVnd ?? item.unitPriceVnd;

  const pricingConfig: PricingConfigSnapshot = useMemo(() => {
    if (product?.timePricingConfig) return product.timePricingConfig;
    if (item.timePricing?.pricingConfig) return item.timePricing.pricingConfig;
    return {
      version: 1,
      timezone: 'Asia/Ho_Chi_Minh',
      basePriceVnd: unitPriceVnd,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    };
  }, [product, item.timePricing?.pricingConfig, unitPriceVnd]);

  const startedMs = timeStartedAt ? new Date(timeStartedAt).getTime() : Date.now();
  const endedMs = timeEndedAt ? new Date(timeEndedAt).getTime() : modalClockNow;
  const effectiveEndMs = Math.max(startedMs + 1000, endedMs);

  const livePricingResult = useMemo(() => {
    if (item.productType !== 'TIME') return null;
    try {
      return calculateTimePrice({
        startedAtMs: startedMs,
        endedAtMs: effectiveEndMs,
        config: pricingConfig,
      });
    } catch {
      return null;
    }
  }, [item.productType, startedMs, effectiveEndMs, pricingConfig]);

  const handleTimeRangeChange = (startStr: string, endStr: string) => {
    setTimeStartedAt(startStr);
    setTimeEndedAt(endStr);
    if (!startStr) return;
    const sMs = new Date(startStr).getTime();
    const eMs = endStr ? new Date(endStr).getTime() : Date.now();
    if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs >= sMs) {
      const diffMinutes = Math.max(1, Math.round((eMs - sMs) / 60000));
      const hours = Math.round((diffMinutes / 60) * 100) / 100;
      setItemQuantityMilli(Math.max(1, Math.round(hours * 1000)));
      if (!itemNote || itemNote.startsWith('Giờ chơi:')) {
        const startText = new Date(sMs).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const endText = endStr
          ? new Date(eMs).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Hiện tại';
        setItemNote(`Giờ chơi: ${startText} - ${endText} (${diffMinutes} phút)`);
      }
    }
  };

  const grossTotal =
    item.productType === 'TIME' && livePricingResult
      ? livePricingResult.amountAfterRoundingVnd
      : calculateLineTotal(unitPriceVnd, itemQuantityMilli);
  const discountAmount = calculateDiscountAmount(grossTotal, discountType, discountValue);
  const netTotal = grossTotal - discountAmount;

  const handleSave = () => {
    const sMs = timeStartedAt ? new Date(timeStartedAt).getTime() : Date.now();
    const eMs = timeEndedAt ? new Date(timeEndedAt).getTime() : null;

    if (item.productType === 'TIME' && eMs !== null && eMs <= sMs) {
      message.error('Giờ ra phải sau giờ vào.');
      return;
    }

    let saveQtyMilli = itemQuantityMilli;
    let saveGrossTotal = grossTotal;
    if (item.productType === 'TIME' && livePricingResult) {
      saveQtyMilli = Math.max(1, Math.round((livePricingResult.elapsedSeconds / 3600) * 1000));
      saveGrossTotal = livePricingResult.amountAfterRoundingVnd;
    }
    const saveDiscountAmount = calculateDiscountAmount(saveGrossTotal, discountType, discountValue);
    const saveNetTotal = saveGrossTotal - saveDiscountAmount;

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
        quantityMilli: saveQtyMilli,
        note: itemNote.trim(),
        grossLineTotalVnd: saveGrossTotal,
        discountAmountVnd: saveDiscountAmount,
        discountType,
        discountInputValue: discountValue,
        netLineTotalVnd: saveNetTotal,
        ...(item.productType === 'TIME'
          ? {
              timeStartedAtMs: sMs,
              timeEndedAtMs: eMs ?? undefined,
              timePricing: livePricingResult ? { ...livePricingResult, pricingConfig } : undefined,
            }
          : {}),
      },
      currentVariant,
    );
  };

  return (
    <Modal
      open
      title={
        <div className="staff-item-modal__header-title">
          {item.productType === 'TIME'
            ? `Chi tiết tính giờ - ${item.productName}`
            : item.productName}
        </div>
      }
      width={item.productType === 'TIME' ? 760 : 540}
      centered
      destroyOnHidden
      onCancel={onCancel}
      footer={null}
      className={
        item.productType === 'TIME' ? 'staff-item-detail-modal-time' : 'staff-item-detail-modal-v2'
      }
    >
      <div className="staff-item-modal__body">
        {item.productType === 'TIME' ? (
          <div className="staff-time-detail-modal">
            <section>
              <Typography.Title level={5}>Bảng giá áp dụng</Typography.Title>
              {pricingConfig.firstPeriod.enabled ? (
                <div className="staff-time-detail-row">
                  <span>
                    <strong>Giá đầu tiên</strong>
                    <small>{formatElapsed(pricingConfig.firstPeriod.durationSeconds)} đầu</small>
                  </span>
                  <b>
                    {formatPriceRate(
                      pricingConfig.firstPeriod.priceVnd,
                      pricingConfig.firstPeriod.durationSeconds,
                    )}
                  </b>
                </div>
              ) : null}
              {pricingConfig.specialWindows.map((window) => (
                <div key={window.id} className="staff-time-detail-row">
                  <span>
                    <strong>{window.name}</strong>
                    <small>
                      {formatMinuteOfDay(window.startMinute)}–{formatMinuteOfDay(window.endMinute)}{' '}
                      · {formatWeekdays(window.weekdaysMask)}
                    </small>
                  </span>
                  <b>{formatPriceRate(window.priceVnd, pricingConfig.baseDurationSeconds)}</b>
                </div>
              ))}
              <div className="staff-time-detail-row">
                <span>
                  <strong>Giá thường</strong>
                  <small>
                    {pricingConfig.calculationMode === 'ACTUAL_TIME'
                      ? 'Tính theo thời gian thực'
                      : 'Tính tròn theo block'}
                    {pricingConfig.roundingUnitVnd > 0
                      ? ` · Làm tròn ${formatMoney(pricingConfig.roundingUnitVnd)}`
                      : ''}
                  </small>
                </span>
                <b>
                  {formatPriceRate(pricingConfig.basePriceVnd, pricingConfig.baseDurationSeconds)}
                </b>
              </div>
            </section>
            <section>
              <Typography.Title level={5}>Thời gian sử dụng</Typography.Title>
              <div className="staff-time-range-fields">
                <label htmlFor="staff-time-started-at-item">
                  <span>Giờ vào</span>
                  <Input
                    id="staff-time-started-at-item"
                    type="datetime-local"
                    step={1}
                    max={formatDateTimeInput(Date.now())}
                    value={timeStartedAt}
                    onChange={(event) => handleTimeRangeChange(event.target.value, timeEndedAt)}
                  />
                </label>
                <label htmlFor="staff-time-ended-at-item">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span>Giờ ra</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {timeEndedAt ? (
                        <button
                          type="button"
                          className="staff-item-modal__now-btn"
                          style={{ color: '#ff4d4f' }}
                          onClick={() => handleTimeRangeChange(timeStartedAt, '')}
                        >
                          Đang chạy
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="staff-item-modal__now-btn"
                        onClick={() =>
                          handleTimeRangeChange(timeStartedAt, formatDateTimeInput(Date.now()))
                        }
                      >
                        Lấy giờ hiện tại
                      </button>
                    </div>
                  </div>
                  <Input
                    id="staff-time-ended-at-item"
                    type="datetime-local"
                    step={1}
                    min={timeStartedAt}
                    max={formatDateTimeInput(Date.now())}
                    placeholder="Chưa kết thúc (đang chạy)"
                    value={timeEndedAt}
                    onChange={(event) => handleTimeRangeChange(timeStartedAt, event.target.value)}
                  />
                  <small>
                    Điền giờ ra và bấm Lưu thay đổi để tạm dừng/chốt giờ. Để trống để tiếp tục tính
                    đến hiện tại.
                  </small>
                </label>
              </div>
              <div className="staff-time-detail-row">
                <span>Tổng thời gian tính tiền</span>
                <b>
                  {formatElapsed(
                    livePricingResult?.elapsedSeconds ??
                      Math.max(
                        0,
                        Math.floor(
                          ((timeEndedAt ? new Date(timeEndedAt).getTime() : modalClockNow) -
                            new Date(timeStartedAt).getTime()) /
                            1000,
                        ),
                      ),
                  )}
                </b>
              </div>
            </section>
            <section>
              <Typography.Title level={5}>Thành tiền tạm tính</Typography.Title>
              {livePricingResult?.segments.map((segment, index) => (
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
              <div className="staff-time-detail-row staff-time-detail-row--total">
                <span>Tổng tiền giờ</span>
                <b>{formatMoney(grossTotal)}</b>
              </div>
            </section>
            <section>
              <Typography.Title level={5}>Ghi chú</Typography.Title>
              <Input.TextArea
                rows={2}
                placeholder="Nhập ghi chú"
                value={itemNote}
                onChange={(e) => setItemNote(e.target.value)}
                className="staff-item-modal__note-input"
              />
            </section>
            <section>
              <Typography.Title level={5}>Giảm giá sản phẩm</Typography.Title>
              {item.source === 'SAVED' ? (
                <div className="staff-item-modal__discount-preview">
                  {discountAmount > 0
                    ? `Đã giảm ${formatMoney(discountAmount)} · Còn ${formatMoney(netTotal)}`
                    : 'Không có giảm giá'}
                </div>
              ) : !showDiscountInput && discountAmount === 0 ? (
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
            </section>
          </div>
        ) : (
          <>
            <div className="staff-item-modal__avatar-wrap">
              <div
                className="staff-item-modal__avatar-box"
                style={{ background: product?.avatarColor ?? '#0877ee' }}
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
              <div className="staff-item-modal__section-subtitle">
                {item.source === 'DRAFT' ? 'Chọn một phiên bản giá' : 'Giá đã lưu theo đơn'}
              </div>
              <div className="staff-item-modal__variants">
                {variants.map((v) => {
                  const isChecked = v.id === selectedVariantId;
                  return (
                    <div
                      key={v.id}
                      className={`staff-item-modal__variant-row ${isChecked ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (item.source === 'DRAFT') setSelectedVariantId(v.id);
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
              {item.source === 'SAVED' ? (
                <div className="staff-item-modal__discount-preview">
                  {discountAmount > 0
                    ? `Đã giảm ${formatMoney(discountAmount)} · Còn ${formatMoney(netTotal)}`
                    : 'Không có giảm giá'}
                </div>
              ) : !showDiscountInput && discountAmount === 0 ? (
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
          </>
        )}

        <div className="staff-item-modal__footer">
          {item.productType === 'TIME' ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                width: '100%',
              }}
            >
              <Button
                icon={timeEndedAt ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                size="large"
                onClick={() => {
                  if (timeEndedAt) {
                    handleTimeRangeChange(timeStartedAt, '');
                    message.info('Đã xóa giờ ra để tiếp tục tính giờ.');
                  } else {
                    const nowStr = formatDateTimeInput(Date.now());
                    handleTimeRangeChange(timeStartedAt, nowStr);
                    message.info('Đã tạm dừng giờ (điền giờ hiện tại vào ô Giờ ra).');
                  }
                }}
              >
                {timeEndedAt ? 'Tiếp tục tính giờ (Xóa giờ ra)' : 'Tạm dừng giờ'}
              </Button>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button
                  danger
                  size="large"
                  icon={<DeleteOutlined />}
                  className="staff-item-modal__delete-action-btn"
                  onClick={onDelete}
                >
                  Xóa
                </Button>
                <Button
                  type="primary"
                  size="large"
                  className="staff-item-modal__save-btn"
                  onClick={handleSave}
                >
                  Lưu thay đổi
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="staff-item-modal__qty-row">
                <span className="staff-item-modal__qty-label">
                  {item.productType === 'WEIGHT'
                    ? `Trọng lượng (${getWeightUnit(item.unitName)})`
                    : 'Số lượng'}
                </span>
                {item.productType === 'WEIGHT' ? (
                  <InputNumber
                    min={0.001}
                    step={0.001}
                    precision={3}
                    decimalSeparator=","
                    value={itemQuantityMilli / 1000}
                    onChange={(val) =>
                      setItemQuantityMilli(Math.max(1, Math.round(Number(val ?? 0) * 1000)))
                    }
                    suffix={getWeightUnit(item.unitName)}
                    style={{ width: 140 }}
                  />
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
                    <span className="staff-item-modal__stepper-val">
                      {itemQuantityMilli / 1000}
                    </span>
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
                <Button
                  danger
                  size="large"
                  icon={<DeleteOutlined />}
                  className="staff-item-modal__delete-action-btn"
                  onClick={onDelete}
                >
                  Xóa
                </Button>
                <Button
                  type="primary"
                  size="large"
                  className="staff-item-modal__save-btn"
                  onClick={handleSave}
                >
                  Lưu
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function OrderEditor({ auth }: { auth: AuthContextResponse }) {
  const location = useLocation();
  const orderId = location.pathname.match(/^\/pos\/orders\/([^/]+)$/u)?.[1];
  const isNew = !orderId || orderId === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const preselectedTableId = searchParams.get('tableId');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>('DINE_IN');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableAction, setTableAction] = useState<'SAVE' | 'CHECKOUT'>('SAVE');
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
  const [orderedItemsCollapsed, setOrderedItemsCollapsed] = useState(false);
  const [cartTab, setCartTab] = useState<'DETAILS' | 'CUSTOMER' | 'ACTIONS'>('DETAILS');
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
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
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const hasRunningTime =
      quote.data?.time?.status === 'RUNNING' ||
      draftLines.some((l) => l.product.productType === 'TIME' && !l.timeEndedAtMs) ||
      (quote.data?.items ?? []).some((i) => i.productType === 'TIME' && !i.timeEndedAtMs);
    if (!hasRunningTime) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote.data?.time?.status, quote.data?.items, draftLines]);

  useEffect(() => {
    if (!isNew && quote.data && searchParams.get('checkout') === '1') {
      navigate(`/pos/orders/${quote.data.order.id}/payment`, { replace: true });
    }
  }, [isNew, quote.data, searchParams, navigate]);

  useEffect(() => {
    if (!isNew && quote.data) setOrderNote(quote.data.order.note ?? '');
  }, [isNew, quote.data]);

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

  const addDraftVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    enteredPrice?: number,
  ) => {
    const effectiveVariant =
      variant.promptPrice === 1 ? { ...variant, salePriceVnd: enteredPrice ?? null } : variant;
    if (effectiveVariant.salePriceVnd === null) return;
    if (product.productType === 'TIME') {
      const id = crypto.randomUUID();
      const line: DraftLine = {
        id,
        product,
        variant: effectiveVariant,
        quantityMilli: 1000,
        note: null,
        discountType: null,
        discountInputValue: null,
        timeStartedAtMs: Date.now(),
        timeEndedAtMs: undefined,
      };
      setDraftLines((lines) => [...lines, line]);
      messageApi.success(`Đã thêm ${product.productName} vào đơn.`);
      return;
    }
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

  const refreshOrder = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
    ]);
  };

  const chooseProduct = (product: CatalogProduct) => {
    if (product.variants.length > 1) {
      setVariantProduct(product);
      return;
    }
    const variant = product.variants[0];
    if (!variant) return;
    chooseVariant(product, variant);
  };

  const chooseVariant = (product: CatalogProduct, variant: CatalogVariant) => {
    setVariantProduct(null);
    if (variant.promptPrice === 1 || variant.salePriceVnd === null) {
      setPromptTarget({ product, variant });
      setPromptPrice(null);
    } else addDraftVariant(product, variant);
  };

  const confirmPromptPrice = () => {
    if (!promptTarget || promptPrice === null || promptPrice < 0) return;
    addDraftVariant(promptTarget.product, promptTarget.variant, promptPrice);
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
          timeStartedAtMs: line.timeStartedAtMs,
          timeEndedAtMs: line.timeEndedAtMs,
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
      const table = tables.data?.find((item) => item.id === preselectedTableId);
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
      await persistLines(created.orderId, 1);
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
        navigate(`/pos/orders/${quote.data.order.id}/payment`);
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
        navigate(`/pos/orders/${quote.data.order.id}/payment`);
      } else {
        navigate('/pos', { replace: true });
      }
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const beginCheckout = async () => {
    if (isNew && orderType === 'TAKEAWAY' && draftLines.length === 0) {
      messageApi.warning('Vui lòng chọn ít nhất một mặt hàng cho đơn mang đi.');
      return;
    }
    if (!isNew) {
      await saveAdditionalItems(true);
      return;
    }
    if (orderType === 'DINE_IN') {
      const table = tables.data?.find((item) => item.id === preselectedTableId);
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
    note: string | null;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
  }) => {
    if (!quote.data) return;
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/items/${input.id}`,
        {
          expectedOrderVersion: quote.data.order.version,
          quantityMilli: input.quantityMilli,
          note: input.note,
          timeStartedAtMs: input.timeStartedAtMs,
          timeEndedAtMs: input.timeEndedAtMs,
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
    if (!quote.data?.time) return;
    setTimeRangeDraft({
      startedAt: formatDateTimeInput(quote.data.time.startedAtMs),
      endedAt: quote.data.time.endedAtMs ? formatDateTimeInput(quote.data.time.endedAtMs) : '',
    });
    setTimeDetailOpen(true);
  };

  const saveTimeRange = async () => {
    if (!quote.data?.time) return;
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
      messageApi.success('Đã cập nhật giờ vào/giờ ra và tính lại tiền giờ.');
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
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
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
    let quantityMilli = line.quantityMilli;
    const unitPriceVnd = line.variant.salePriceVnd ?? 0;
    let gross = 0;
    let timePricing: (PricingResult & { pricingConfig: PricingConfigSnapshot }) | undefined;

    if (line.product.productType === 'TIME') {
      const pricingConfig: PricingConfigSnapshot = line.product.timePricingConfig ?? {
        version: 1,
        timezone: 'Asia/Ho_Chi_Minh',
        basePriceVnd: unitPriceVnd,
        baseDurationSeconds: 3600,
        calculationMode: 'ACTUAL_TIME',
        roundingUnitVnd: 1000,
        firstPeriod: { enabled: false },
        specialWindows: [],
      };
      const startMs = line.timeStartedAtMs ?? clockNow;
      const endMs = line.timeEndedAtMs ?? clockNow;
      try {
        const timeCalc = calculateTimePrice({
          startedAtMs: startMs,
          endedAtMs: Math.max(startMs + 1000, endMs),
          config: pricingConfig,
        });
        quantityMilli = Math.max(1, Math.round((timeCalc.elapsedSeconds / 3600) * 1000));
        gross = timeCalc.amountAfterRoundingVnd;
        timePricing = { ...timeCalc, pricingConfig };
      } catch {
        const diffMs = Math.max(0, endMs - startMs);
        quantityMilli = Math.max(1, Math.round((diffMs / 3_600_000) * 1000));
        gross = calculateLineTotal(unitPriceVnd, quantityMilli);
      }
    } else {
      gross = calculateLineTotal(unitPriceVnd, quantityMilli);
    }
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
      timeStartedAtMs: line.timeStartedAtMs ?? null,
      timeEndedAtMs: line.timeEndedAtMs ?? null,
      timePricing,
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

  // 1. Tiền hàng (chỉ tính mặt hàng số lượng và trọng lượng thông thường)
  const regularProductItems = allCurrentItems.filter((i) => i.productType !== 'TIME');
  const regularProductGross = regularProductItems.reduce(
    (sum, item) => sum + item.grossLineTotalVnd,
    0,
  );
  const regularProductDiscount = regularProductItems.reduce(
    (sum, item) => sum + item.discountAmountVnd,
    0,
  );
  const regularProductCount = regularProductItems.length;

  // 2. Tiền giờ (phiên tính giờ của bàn + các mặt hàng tính thời gian gọi thêm)
  const tableTimeGross = quote.data?.time ? quote.data.time.amountAfterRoundingVnd : 0;
  const timeProductItems = allCurrentItems.filter((i) => i.productType === 'TIME');
  const timeProductsGross = timeProductItems.reduce((sum, item) => sum + item.grossLineTotalVnd, 0);
  const timeProductsDiscount = timeProductItems.reduce(
    (sum, item) => sum + item.discountAmountVnd,
    0,
  );
  const totalTimeGross = tableTimeGross + timeProductsGross;

  // 3. Giảm giá và Tổng khách phải trả
  const totalDiscount = regularProductDiscount + timeProductsDiscount;
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
              {quote.data.order.orderType === 'DINE_IN'
                ? `${quote.data.order.areaName} - ${quote.data.order.tableName}`
                : quote.data.order.displayCode}
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
            onChange={(value) => setOrderType(value as 'DINE_IN' | 'TAKEAWAY')}
            aria-label="Loại đơn"
            title={
              isNew
                ? 'Chọn loại đơn'
                : 'Chưa cho phép đổi loại khi đơn đã chạy để tránh sai tiền giờ'
            }
          />
          <div className="staff-order-code">
            <small>Mã đơn</small>
            <strong>{isNew ? 'Sinh khi lưu' : (quote.data?.order.displayCode ?? '—')}</strong>
          </div>
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
                      className="staff-product-card__visual"
                      style={{ background: product.avatarColor ?? '#eaf4ff' }}
                    >
                      {product.avatarType === 'IMAGE' && product.mediaId ? (
                        <img src={`/api/v1/media/${product.mediaId}`} alt="" />
                      ) : (
                        getProductInitials(product.productName)
                      )}
                    </span>
                    <strong>{product.productName}</strong>
                    <small>
                      {product.variants.length > 1
                        ? `${product.variants.length} phiên bản`
                        : '\u00a0'}
                    </small>
                    <b>
                      {minPrice === null
                        ? 'Nhập giá'
                        : minPrice === maxPrice
                          ? `${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : product.productType === 'TIME' ? `/${product.unitName || 'giờ'}` : ''}`
                          : `Từ ${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : product.productType === 'TIME' ? `/${product.unitName || 'giờ'}` : ''}`}
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
                    {draftDisplayItems.map((item) =>
                      item.productType === 'TIME' ? (
                        <button
                          type="button"
                          key={item.id}
                          className="staff-time-line staff-time-line--editable"
                          onClick={() =>
                            setEditingItem({
                              source: 'DRAFT',
                              ...item,
                              note: item.note ?? '',
                            })
                          }
                        >
                          <div className="staff-time-line__heading">
                            <span className="staff-order-quantity">1x</span>
                            <span className="staff-order-item-name">
                              <strong>Giờ</strong>
                              <small>{item.productName}</small>
                            </span>
                            <b>{formatMoney(item.netLineTotalVnd)}</b>
                          </div>
                          <div className="staff-time-line__details">
                            <span>Từ: {formatDateTime(item.timeStartedAtMs ?? Date.now())}</span>
                            <span>
                              Tới:{' '}
                              {item.timeEndedAtMs ? formatDateTime(item.timeEndedAtMs) : 'Hiện tại'}
                            </span>
                            <span>
                              Tổng thời gian tạm tính:{' '}
                              {formatElapsed(
                                Math.max(
                                  1,
                                  Math.floor(
                                    ((item.timeEndedAtMs ?? clockNow) -
                                      (item.timeStartedAtMs ?? item.timeEndedAtMs ?? clockNow)) /
                                      1000,
                                  ),
                                ),
                              )}
                            </span>
                          </div>
                        </button>
                      ) : (
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
                      ),
                    )}
                  </div>
                </section>
              ) : null}
              <div className="staff-cart-section-header">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Sản phẩm đã gọi ({displayedItems.length + (quote.data?.time ? 1 : 0)})
                </Typography.Title>
                <Button
                  type="text"
                  size="small"
                  className="staff-cart-collapse-btn"
                  icon={orderedItemsCollapsed ? <DownOutlined /> : <UpOutlined />}
                  aria-label={
                    orderedItemsCollapsed ? 'Mở rộng sản phẩm đã gọi' : 'Thu gọn sản phẩm đã gọi'
                  }
                  onClick={() => setOrderedItemsCollapsed((prev) => !prev)}
                />
              </div>
              {!orderedItemsCollapsed ? (
                <>
                  {quote.data?.time ? (
                    <button
                      type="button"
                      className="staff-time-line staff-time-line--editable"
                      onClick={openTimeDetails}
                    >
                      <div className="staff-time-line__heading">
                        <span className="staff-order-quantity">1x</span>
                        <span className="staff-order-item-name">
                          <strong>Giờ</strong>
                          <small>{quote.data.order.tableName}</small>
                        </span>
                        <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
                      </div>
                      <div className="staff-time-line__details">
                        <span>Từ: {formatDateTime(quote.data.time.startedAtMs)}</span>
                        <span>
                          Tới:{' '}
                          {quote.data.time.endedAtMs
                            ? formatDateTime(quote.data.time.endedAtMs)
                            : quote.data.time.status === 'PAUSED'
                              ? formatDateTime(
                                  quote.data.time.startedAtMs +
                                    quote.data.time.elapsedSeconds * 1000,
                                )
                              : 'Hiện tại'}
                        </span>
                        <span>Tổng thời gian tạm tính: {formatElapsed(liveElapsedSeconds)}</span>
                      </div>
                    </button>
                  ) : isNew && orderType === 'DINE_IN' ? (
                    <Alert
                      type="info"
                      showIcon
                      title="Giờ bắt đầu khi lưu đơn và chọn bàn/phòng"
                      className="staff-time-placeholder"
                    />
                  ) : null}
                  {quote.isLoading && !isNew ? (
                    <Skeleton active />
                  ) : displayedItems.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mặt hàng" />
                  ) : (
                    <div className="staff-compact-order-list">
                      {displayedItems.map((item) =>
                        item.productType === 'TIME' ? (
                          <button
                            type="button"
                            key={item.id}
                            className="staff-time-line staff-time-line--editable"
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
                                timeStartedAtMs: item.timeStartedAtMs,
                                timeEndedAtMs: item.timeEndedAtMs,
                                timePricing: item.timePricing,
                              })
                            }
                          >
                            <div className="staff-time-line__heading">
                              <span className="staff-order-quantity">1x</span>
                              <span className="staff-order-item-name">
                                <strong>Giờ</strong>
                                <small>{item.productName}</small>
                              </span>
                              <b>{formatMoney(item.netLineTotalVnd)}</b>
                            </div>
                            <div className="staff-time-line__details">
                              <span>Từ: {formatDateTime(item.timeStartedAtMs ?? Date.now())}</span>
                              <span>
                                Tới:{' '}
                                {item.timeEndedAtMs
                                  ? formatDateTime(item.timeEndedAtMs)
                                  : 'Hiện tại'}
                              </span>
                              <span>
                                Tổng thời gian tạm tính:{' '}
                                {formatElapsed(
                                  Math.max(
                                    1,
                                    Math.floor(
                                      ((item.timeEndedAtMs ?? clockNow) -
                                        (item.timeStartedAtMs ?? item.timeEndedAtMs ?? clockNow)) /
                                        1000,
                                    ),
                                  ),
                                )}
                              </span>
                            </div>
                          </button>
                        ) : (
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
                                timeStartedAtMs: item.timeStartedAtMs,
                                timeEndedAtMs: item.timeEndedAtMs,
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
                        ),
                      )}
                    </div>
                  )}
                </>
              ) : null}
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
            </div>
          ) : cartTab === 'CUSTOMER' ? (
            <div className="staff-cart-tab-content staff-customer-tab">
              <div className="staff-info-card">
                <strong>Khách lẻ</strong>
                <span>Chưa liên kết thông tin thành viên</span>
              </div>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 13, textAlign: 'center', display: 'block', margin: '20px 0' }}
              >
                Tính năng tích điểm và thông tin thành viên sẽ ra mắt ở giai đoạn tiếp theo.
              </Typography.Text>
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
                        ? `Tại chỗ ${quote.data?.order.tableName ? `· ${quote.data.order.tableName}` : ''}`
                        : 'Mang đi'}
                    </strong>
                  </div>
                  <div className="staff-order-info-item">
                    <span className="staff-order-info-label">
                      <FileTextOutlined /> Mã đơn
                    </span>
                    <strong className="staff-order-info-value">
                      {isNew ? 'Sinh khi lưu' : (quote.data?.order.displayCode ?? '—')}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="staff-order-action-buttons">
                <Typography.Title level={5} style={{ marginBottom: 12 }}>
                  Thao tác đơn
                </Typography.Title>
                {!isNew ? (
                  <div className="staff-action-buttons-group">
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
                  </div>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    description="Chuyển bàn và Hủy đơn sẽ khả dụng sau khi đơn hàng được lưu."
                  />
                )}
              </div>
            </div>
          )}
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
          <div className="staff-cart-actions">
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
              loading={saving}
              onClick={beginCheckout}
            >
              Thanh toán
            </Button>
          </div>
        </aside>
      </div>
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
              onClick={() => chooseVariant(variantProduct, variant)}
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
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')}
          parser={(value) => Number((value ?? '').replaceAll('.', ''))}
          onChange={(value) => setPromptPrice(value === null ? null : Number(value))}
          suffix="đ"
          style={{ width: '100%' }}
        />
      </Modal>
      <StaffTablePickerModal
        open={tableModalOpen}
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTableModalOpen(false)}
        onConfirm={(table) => void saveWithTable(table, tableAction === 'CHECKOUT')}
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
                  timeStartedAtMs: updated.timeStartedAtMs ?? undefined,
                  timeEndedAtMs: updated.timeEndedAtMs ?? undefined,
                };
              }),
            );
            setEditingItem(null);
          } else {
            void updateExistingItem({
              id: editingItem.id,
              quantityMilli: updated.quantityMilli,
              note: updated.note.trim() || null,
              timeStartedAtMs: updated.timeStartedAtMs,
              timeEndedAtMs: updated.timeEndedAtMs,
            });
          }
        }}
        onDelete={() => {
          if (!editingItem) return;
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
        open={timeDetailOpen && Boolean(quote.data?.time)}
        title="Chi tiết tính giờ"
        width={760}
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
                >
                  {timeRangeDraft.endedAt ? 'Tiếp tục tính giờ (Xóa giờ ra)' : 'Tạm dừng giờ'}
                </Button>,
                <Button
                  key="delete-time"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setDeleteTimeReason('');
                    setDeleteTimeModalOpen(true);
                  }}
                >
                  Xóa tiền giờ
                </Button>,
                <Button key="save" type="primary" loading={saving} onClick={saveTimeRange}>
                  Lưu thay đổi
                </Button>,
              ]
            : null
        }
      >
        {quote.data?.time ? (
          <div className="staff-time-detail-modal">
            <section>
              <Typography.Title level={5}>Bảng giá áp dụng</Typography.Title>
              {quote.data.time.pricingConfig.firstPeriod.enabled ? (
                <div className="staff-time-detail-row">
                  <span>
                    <strong>Giá đầu tiên</strong>
                    <small>
                      {formatElapsed(quote.data.time.pricingConfig.firstPeriod.durationSeconds)} đầu
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
                      {formatMinuteOfDay(window.startMinute)}–{formatMinuteOfDay(window.endMinute)}{' '}
                      · {formatWeekdays(window.weekdaysMask)}
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
            </section>
            <section>
              <Typography.Title level={5}>Thời gian sử dụng</Typography.Title>
              <div className="staff-time-range-fields">
                <label htmlFor="staff-time-started-at">
                  <span>Giờ vào</span>
                  <Input
                    id="staff-time-started-at"
                    type="datetime-local"
                    step={1}
                    max={formatDateTimeInput(Date.now())}
                    value={timeRangeDraft.startedAt}
                    onChange={(event) =>
                      setTimeRangeDraft((value) => ({ ...value, startedAt: event.target.value }))
                    }
                  />
                </label>
                <label htmlFor="staff-time-ended-at">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span>Giờ ra</span>
                    <button
                      type="button"
                      className="staff-item-modal__now-btn"
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
                  />
                  <small>
                    Điền giờ ra và bấm Lưu thay đổi để tạm dừng/chốt giờ. Để trống để tiếp tục tính
                    đến hiện tại.
                  </small>
                </label>
              </div>
              <div className="staff-time-detail-row">
                <span>Tổng thời gian tính tiền</span>
                <b>{formatElapsed(liveElapsedSeconds)}</b>
              </div>
            </section>
            <section>
              <Typography.Title level={5}>Thành tiền tạm tính</Typography.Title>
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
              <div className="staff-time-detail-row staff-time-detail-row--total">
                <span>Tổng tiền giờ</span>
                <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
              </div>
            </section>
          </div>
        ) : null}
      </Modal>
      <StaffTablePickerModal
        open={transferOpen}
        title="Chuyển bàn/phòng"
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTransferOpen(false)}
        onConfirm={(table) => void transferTo(table)}
      />
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
    </div>
  );
}

function InvoicePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const invoiceId = location.pathname.match(/^\/pos\/invoices\/([^/]+)$/u)?.[1];
  const invoice = useQuery({
    queryKey: ['pos-invoice', invoiceId],
    queryFn: () => apiRequest<InvoiceDetail>(`/api/v1/pos/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
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
  return (
    <main className="staff-invoice-page">
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
            };
            const isTimeLine = line.lineType === 'TIME' || snapshot.productType === 'TIME';
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
        </footer>
      </section>
      <div className="staff-invoice-actions">
        <Button size="large" onClick={() => navigate('/pos')}>
          Về danh sách đơn
        </Button>
        <Button
          type="primary"
          size="large"
          icon={<PrinterOutlined />}
          onClick={() => window.print()}
        >
          In hóa đơn
        </Button>
      </div>
    </main>
  );
}

type PaymentMethodType = 'CASH' | 'VISA' | 'MASTER' | 'JCB' | 'ATM' | 'DEBT';

interface PaymentMethodItem {
  key: PaymentMethodType;
  label: string;
  backendMethod: 'CASH' | 'BANK_TRANSFER';
  icon: React.ReactNode;
}

const PAYMENT_METHODS: PaymentMethodItem[] = [
  {
    key: 'CASH',
    label: 'Tiền mặt',
    backendMethod: 'CASH',
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
    key: 'VISA',
    label: 'Thẻ Visa',
    backendMethod: 'BANK_TRANSFER',
    icon: (
      <div
        style={{
          width: 38,
          height: 22,
          background: '#1a1f71',
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontStyle: 'italic',
          fontWeight: 900,
          fontSize: 11,
          letterSpacing: 0.5,
        }}
      >
        VISA
      </div>
    ),
  },
  {
    key: 'MASTER',
    label: 'Thẻ Master',
    backendMethod: 'BANK_TRANSFER',
    icon: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{ width: 18, height: 18, borderRadius: '50%', background: '#eb001b', zIndex: 1 }}
        />
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#f79e1b',
            marginLeft: -8,
            opacity: 0.9,
          }}
        />
      </div>
    ),
  },
  {
    key: 'JCB',
    label: 'Thẻ JCB',
    backendMethod: 'BANK_TRANSFER',
    icon: (
      <div
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          padding: '2px 4px',
          border: '1px solid #e0e4e8',
          borderRadius: 3,
          background: '#fff',
        }}
      >
        <div style={{ width: 6, height: 16, background: '#0079c1', borderRadius: 2 }} />
        <div style={{ width: 6, height: 16, background: '#e60012', borderRadius: 2 }} />
        <div style={{ width: 6, height: 16, background: '#00873c', borderRadius: 2 }} />
      </div>
    ),
  },
  {
    key: 'ATM',
    label: 'Thẻ ATM',
    backendMethod: 'BANK_TRANSFER',
    icon: <CreditCardOutlined style={{ fontSize: 24, color: '#0877ee' }} />,
  },
  {
    key: 'DEBT',
    label: 'Ghi nợ - Thanh toán sau',
    backendMethod: 'BANK_TRANSFER',
    icon: <HistoryOutlined style={{ fontSize: 24, color: '#0877ee' }} />,
  },
];

function PaymentPage({ orderId, auth }: { orderId: string; auth: AuthContextResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodType>('CASH');
  const [isMultiMethod, setIsMultiMethod] = useState(false);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [attachedCustomer, setAttachedCustomer] = useState<{
    name: string;
    phone?: string | undefined;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const csrf = auth.csrfToken!;

  const quote = useQuery({
    queryKey: ['pos-order-quote', orderId],
    queryFn: () => apiRequest<OrderQuote>(`/api/v1/pos/orders/${orderId}/quote`),
    refetchInterval: 5_000,
  });

  // Mặc định tiền khách đưa điền đúng giá tiền khách phải trả
  useEffect(() => {
    if (quote.data && cashReceived === null) {
      setCashReceived(quote.data.totalVnd);
    }
  }, [quote.data, cashReceived]);

  const totalVnd = quote.data?.totalVnd ?? 0;
  const currentMethodItem =
    PAYMENT_METHODS.find((m) => m.key === selectedMethod) ?? PAYMENT_METHODS[0]!;

  const changeVnd = selectedMethod === 'CASH' ? Math.max(0, (cashReceived ?? 0) - totalVnd) : 0;

  const handleConfirmPayment = async () => {
    if (!quote.data) return;
    if (selectedMethod === 'CASH' && (cashReceived === null || cashReceived < totalVnd)) {
      messageApi.warning('Số tiền khách đưa chưa đủ để thanh toán.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await jsonRequest<{ invoiceId: string }>(
        `/api/v1/pos/orders/${quote.data.order.id}/checkout`,
        {
          expectedOrderVersion: quote.data.order.version,
          method: currentMethodItem.backendMethod,
          cashReceivedVnd: currentMethodItem.backendMethod === 'CASH' ? cashReceived : null,
        },
        { headers: mutationHeaders(csrf) },
      );
      await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
      messageApi.success('Thanh toán đơn hàng thành công!');
      navigate(`/pos/invoices/${result.invoiceId}`, { replace: true });
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
          className="staff-payment-page__back-btn"
          aria-label="Quay lại đơn hàng"
          onClick={() => navigate(`/pos/orders/${orderId}`)}
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
      ) : (
        <div className="staff-payment-page__body">
          <div className="staff-payment-page__left">
            <section className="staff-payment-page__section">
              <div className="staff-payment-page__section-title">Khách hàng</div>
              {attachedCustomer ? (
                <div className="staff-payment-page__customer-card">
                  <UserOutlined style={{ color: '#0877ee', fontSize: 18 }} />
                  <div>
                    <strong>{attachedCustomer.name}</strong>
                    {attachedCustomer.phone ? (
                      <span style={{ marginLeft: 8, color: '#656a75', fontSize: 13 }}>
                        ({attachedCustomer.phone})
                      </span>
                    ) : null}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => setAttachedCustomer(null)}
                    style={{ marginLeft: 8 }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="staff-payment-page__customer-btn"
                  onClick={() => setCustomerModalOpen(true)}
                >
                  <PlusCircleOutlined />
                  <span>Thêm khách hàng</span>
                </button>
              )}
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
            </section>
          </div>

          <div className="staff-payment-page__right">
            <div className="staff-payment-page__right-top">
              <div className="staff-payment-page__row">
                <span className="staff-payment-page__row-label">Khách phải trả</span>
                <strong className="staff-payment-page__total-val">{formatMoney(totalVnd)}</strong>
              </div>

              <div className="staff-payment-page__input-row">
                <span className="staff-payment-page__input-label">{currentMethodItem.label}</span>
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

              {selectedMethod === 'CASH' ? (
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
              ) : null}
            </div>

            <div className="staff-payment-page__right-bottom">
              <div className="staff-payment-page__change-row">
                <span className="staff-payment-page__change-label">Tiền thừa trả khách</span>
                <strong className="staff-payment-page__change-val">{formatMoney(changeVnd)}</strong>
              </div>

              <Button
                type="primary"
                size="large"
                block
                className="staff-payment-page__submit-btn"
                loading={submitting}
                disabled={
                  !quote.data || (selectedMethod === 'CASH' && (cashReceived ?? 0) < totalVnd)
                }
                onClick={handleConfirmPayment}
              >
                Xác nhận thanh toán
              </Button>
            </div>
          </div>
        </div>
      )}

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
  const location = useLocation();
  const [ordersSearch, setOrdersSearch] = useState('');
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  if (auth.isLoading) return <Spin fullscreen description="Đang mở cổng nhân viên" />;
  if (auth.isError || auth.data?.actor?.kind !== 'EMPLOYEE') {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }

  const isInvoice = location.pathname.startsWith('/pos/invoices/');
  const isPayment =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/payment');
  const isEditor = location.pathname.startsWith('/pos/orders/') && !isPayment;
  const isFullScreen = isInvoice || isPayment || isEditor;
  const active = location.pathname.startsWith('/pos/areas')
    ? 'areas'
    : location.pathname.startsWith('/pos/qr-order')
      ? 'qr'
      : location.pathname.startsWith('/pos/more')
        ? 'more'
        : 'orders';

  const paymentOrderId = isPayment ? location.pathname.split('/')[3] : undefined;

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND, borderRadius: 8 } }}>
      <div className={`staff-pos-shell${isFullScreen ? ' staff-pos-shell--editor' : ''}`}>
        {!isFullScreen ? (
          <StaffHeader
            context={auth.data}
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
          {isInvoice ? (
            <InvoicePage />
          ) : isPayment && paymentOrderId ? (
            <PaymentPage orderId={paymentOrderId} auth={auth.data} />
          ) : isEditor ? (
            <OrderEditor auth={auth.data} />
          ) : active === 'areas' ? (
            <AreasPage />
          ) : active === 'qr' ? (
            <QrOrderPage />
          ) : active === 'more' ? (
            <MorePage auth={auth.data} />
          ) : (
            <OrdersPage search={ordersSearch} />
          )}
        </div>
        {!isFullScreen ? <StaffBottomNav active={active} /> : null}
      </div>
    </ConfigProvider>
  );
}
