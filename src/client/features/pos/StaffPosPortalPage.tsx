import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownOutlined,
  EditOutlined,
  LogoutOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  UnorderedListOutlined,
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
  Modal,
  Segmented,
  Skeleton,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

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
  };
  items: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    netLineTotalVnd: number;
  }>;
  totalVnd: number;
}

interface DraftLine {
  product: CatalogProduct;
  variant: CatalogVariant;
  quantity: number;
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

function formatDuration(openedAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : `${minutes} phút`;
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
}

function mutationHeaders(csrfToken: string) {
  return { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': crypto.randomUUID() };
}

function StaffHeader({ context }: { context: AuthContextResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    const csrfToken = context.csrfToken;
    if (!csrfToken) {
      navigate('/?tab=employee', { replace: true });
      return;
    }
    try {
      setLoggingOut(true);
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/?tab=employee', { replace: true });
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể đăng xuất.');
      setLoggingOut(false);
    }
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'account',
      icon: <UserOutlined />,
      label: (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>Tài khoản</span>
          <Tag
            color="default"
            style={{ marginInlineEnd: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}
          >
            Làm sau
          </Tag>
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
      <div className="staff-pos-brand">
        <span className="staff-pos-brand__mark">P</span>
        <strong>Pro POS</strong>
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
            {context.actor?.displayName ? context.actor.displayName.slice(0, 1).toUpperCase() : 'U'}
          </Avatar>
          <div className="staff-pos-account__copy">
            <strong>{context.actor?.displayName ?? 'Nhân viên'}</strong>
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

function OrdersPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY'>('ALL');
  const [search, setSearch] = useState('');
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
      <div className="staff-orders-toolbar">
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm kiếm đơn hàng"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
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
  const [saving, setSaving] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [variantProduct, setVariantProduct] = useState<CatalogProduct | null>(null);
  const csrf = auth.csrfToken!;

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
    refetchInterval: 30_000,
  });

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

  const addDraftVariant = (product: CatalogProduct, variant: CatalogVariant) => {
    if (variant.promptPrice === 1 || variant.salePriceVnd === null) {
      messageApi.info('Mặt hàng nhập giá khi bán sẽ được hỗ trợ ở bước tiếp theo.');
      return;
    }
    setDraftLines((lines) => {
      const found = lines.find((line) => line.variant.id === variant.id);
      if (found) {
        return lines.map((line) =>
          line.variant.id === variant.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...lines, { product, variant, quantity: 1 }];
    });
  };

  const addToExisting = async (product: CatalogProduct, variant: CatalogVariant) => {
    if (!quote.data || variant.promptPrice === 1) return addDraftVariant(product, variant);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/items`,
        {
          productId: product.productId,
          variantId: variant.id,
          quantityMilli: 1000,
          expectedOrderVersion: quote.data.order.version,
        },
        { headers: mutationHeaders(csrf) },
      );
      await queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
    } catch (error) {
      messageApi.error(errorText(error));
    }
  };

  const chooseProduct = (product: CatalogProduct) => {
    if (product.variants.length > 1) {
      setVariantProduct(product);
      return;
    }
    const variant = product.variants[0];
    if (!variant) return;
    if (isNew) addDraftVariant(product, variant);
    else void addToExisting(product, variant);
  };

  const chooseVariant = (product: CatalogProduct, variant: CatalogVariant) => {
    setVariantProduct(null);
    if (isNew) addDraftVariant(product, variant);
    else void addToExisting(product, variant);
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
          quantityMilli: line.quantity * 1000,
          expectedOrderVersion: version,
        },
        { headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
  };

  const saveWithTable = async (table: PosTable) => {
    setSaving(true);
    try {
      const opened = await jsonRequest<{ orderId: string }>(
        '/api/v1/pos/tables/open',
        { tableId: table.id, expectedTableVersion: table.version },
        { headers: mutationHeaders(csrf) },
      );
      await persistLines(opened.orderId, 1);
      await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
      navigate(`/pos/orders/${opened.orderId}`, { replace: true });
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
      setTableModalOpen(false);
    }
  };

  const saveOrder = async () => {
    if (orderType === 'DINE_IN') {
      const table = tables.data?.find((item) => item.id === preselectedTableId);
      if (table?.status === 'AVAILABLE') return saveWithTable(table);
      setTableModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      const created = await jsonRequest<{ orderId: string }>(
        '/api/v1/pos/orders',
        { note: null },
        { headers: mutationHeaders(csrf) },
      );
      await persistLines(created.orderId, 1);
      await queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      navigate(`/pos/orders/${created.orderId}`, { replace: true });
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const displayedItems = isNew
    ? draftLines.map((line) => ({
        id: line.variant.id,
        productName: line.product.productName,
        variantName: line.variant.name,
        unitPriceVnd: line.variant.salePriceVnd ?? 0,
        quantityMilli: line.quantity * 1000,
        netLineTotalVnd: (line.variant.salePriceVnd ?? 0) * line.quantity,
      }))
    : (quote.data?.items ?? []);
  const displayedTotal = isNew
    ? displayedItems.reduce((sum, item) => sum + item.netLineTotalVnd, 0)
    : (quote.data?.totalVnd ?? 0);

  return (
    <div className="staff-order-editor">
      {holder}
      <header className="staff-order-editor__header">
        <Button
          type="text"
          size="large"
          aria-label="Đóng trang tạo đơn"
          icon={<CloseOutlined />}
          onClick={() => navigate('/pos')}
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
          prefix={<SearchOutlined />}
          placeholder="Tìm kiếm sản phẩm"
          value={catalogSearch}
          onChange={(event) => setCatalogSearch(event.target.value)}
        />
        {isNew ? (
          <Segmented
            value={orderType}
            options={[
              { value: 'DINE_IN', label: 'Tại chỗ' },
              { value: 'TAKEAWAY', label: 'Mang đi' },
            ]}
            onChange={(value) => setOrderType(value as typeof orderType)}
          />
        ) : (
          <Tag color="blue">Đang mở</Tag>
        )}
      </header>
      <div className="staff-order-editor__body">
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
                        product.productName.slice(0, 1).toUpperCase()
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
                          ? formatMoney(minPrice)
                          : `Từ ${formatMoney(minPrice)}`}
                    </b>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <aside className="staff-cart-panel">
          <div className="staff-cart-tabs">
            <button type="button" className="is-active">
              Chi tiết đơn
            </button>
            <button type="button" disabled>
              Khách hàng
            </button>
            <button type="button" disabled>
              Thao tác khác
            </button>
          </div>
          <Typography.Title level={4}>Sản phẩm đã gọi ({displayedItems.length})</Typography.Title>
          {quote.isLoading && !isNew ? (
            <Skeleton active />
          ) : displayedItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mặt hàng" />
          ) : (
            <div className="staff-cart-lines">
              {displayedItems.map((item) => (
                <div key={item.id}>
                  <span>
                    <strong>{item.productName}</strong>
                    <small>{item.variantName}</small>
                  </span>
                  <span>x{item.quantityMilli / 1000}</span>
                  <b>{formatMoney(item.netLineTotalVnd)}</b>
                </div>
              ))}
            </div>
          )}
          <div className="staff-cart-note">
            <strong>Ghi chú đơn hàng</strong>
            <EditOutlined />
          </div>
          <div className="staff-cart-summary">
            <Typography.Title level={4}>Tổng tiền</Typography.Title>
            <div>
              <span>Tổng tiền hàng ({displayedItems.length} món)</span>
              <b>{formatMoney(displayedTotal)}</b>
            </div>
            <div>
              <span>Giảm giá</span>
              <b>{formatMoney(0)}</b>
            </div>
            <div className="staff-cart-total">
              <span>Khách phải trả</span>
              <b>{formatMoney(displayedTotal)}</b>
            </div>
          </div>
          {isNew ? (
            <div className="staff-cart-actions">
              <Button size="large" loading={saving} onClick={saveOrder}>
                Lưu đơn
              </Button>
              <Button type="primary" size="large" disabled>
                Thanh toán
              </Button>
            </div>
          ) : null}
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
                {variant.salePriceVnd === null ? 'Nhập giá' : formatMoney(variant.salePriceVnd)}
              </b>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        open={tableModalOpen}
        title="Chọn khu vực và bàn"
        footer={null}
        onCancel={() => setTableModalOpen(false)}
      >
        <Typography.Paragraph type="secondary">
          Đơn tại chỗ bắt buộc phải chọn một bàn/phòng đang trống.
        </Typography.Paragraph>
        <div className="staff-table-picker">
          {(tables.data ?? [])
            .filter((table) => table.status === 'AVAILABLE')
            .map((table) => (
              <Button key={table.id} loading={saving} onClick={() => saveWithTable(table)}>
                {table.areaName} · {table.name}
              </Button>
            ))}
        </div>
      </Modal>
    </div>
  );
}

export function StaffPosPortalPage() {
  const location = useLocation();
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  if (auth.isLoading) return <Spin fullscreen description="Đang mở cổng nhân viên" />;
  if (auth.isError || auth.data?.actor?.kind !== 'EMPLOYEE') {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }

  const isEditor = location.pathname.startsWith('/pos/orders/');
  const active = location.pathname.startsWith('/pos/areas')
    ? 'areas'
    : location.pathname.startsWith('/pos/qr-order')
      ? 'qr'
      : location.pathname.startsWith('/pos/more')
        ? 'more'
        : 'orders';

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND, borderRadius: 8 } }}>
      <div className={`staff-pos-shell${isEditor ? ' staff-pos-shell--editor' : ''}`}>
        {!isEditor ? <StaffHeader context={auth.data} /> : null}
        <div className="staff-pos-main">
          {isEditor ? (
            <OrderEditor auth={auth.data} />
          ) : active === 'areas' ? (
            <AreasPage />
          ) : active === 'qr' ? (
            <QrOrderPage />
          ) : active === 'more' ? (
            <MorePage auth={auth.data} />
          ) : (
            <OrdersPage />
          )}
        </div>
        {!isEditor ? <StaffBottomNav active={active} /> : null}
      </div>
    </ConfigProvider>
  );
}
