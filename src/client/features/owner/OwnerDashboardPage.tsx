import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BankOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DollarCircleOutlined,
  DownOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RightOutlined,
  RiseOutlined,
  RocketOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  TagsOutlined,
  TeamOutlined,
  UpOutlined,
  UsergroupAddOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Progress,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { DashboardDataDto, DashboardStaffRevenueRow } from '@contracts/dashboard';
import { apiRequest } from '@client/lib/api';

export interface StoreSettings {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  phone: string | null;
  address: string | null;
  currency: string;
  businessDayCutoffMinutes: number;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  bankQrMediaId?: string | null;
}

interface AreaTableInfo {
  id: string;
  name: string;
}

interface AreaLayoutInfo {
  id: string;
  name: string;
  tables: AreaTableInfo[];
}

interface ProductSummaryInfo {
  id: string;
  name: string;
  isSystem?: boolean | number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

const ModernDonutChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.ModernDonutChart };
});

const RevenueTrendChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.RevenueTrendChart };
});

const HourlyRevenueChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.HourlyRevenueChart };
});

function ChartFallback() {
  return <Skeleton active paragraph={{ rows: 5 }} />;
}

// ─── Onboarding Checklist Component ──────────────────────────────────────────

interface OnboardingTask {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  completed: boolean;
  actionText: string;
}

function OwnerOnboardingChecklist({ settings }: { settings: StoreSettings | undefined }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const areaLayouts = useQuery({
    queryKey: ['owner-area-layouts'],
    queryFn: () => apiRequest<AreaLayoutInfo[]>('/api/v1/owner/catalog/area-layouts'),
  });

  const products = useQuery({
    queryKey: ['owner-products'],
    queryFn: () => apiRequest<ProductSummaryInfo[]>('/api/v1/owner/catalog/products'),
  });

  const employees = useQuery({
    queryKey: ['owner-staff-list'],
    queryFn: () => apiRequest<any[]>('/api/v1/owner/staff'),
  });

  const hasAreas = Boolean(
    (areaLayouts.data ?? []).length > 0 &&
    areaLayouts.data?.some((a) => a.tables && a.tables.length > 0),
  );
  const hasProducts = Boolean(
    (products.data ?? []).some((p) => !p.isSystem) || (products.data ?? []).length > 0,
  );
  const hasEmployees = Boolean((employees.data ?? []).length > 0);
  const hasBanking = Boolean(settings?.bankAccountNumber && settings?.bankName);

  const tasks: OnboardingTask[] = [
    {
      key: 'areas',
      title: 'Tạo khu vực & Bàn / Phòng',
      description: 'Thiết lập sơ đồ tầng, khu vực và danh sách bàn/phòng phục vụ.',
      icon: <AppstoreOutlined />,
      route: '/owner/settings/areas',
      completed: hasAreas,
      actionText: 'Tạo bàn/phòng',
    },
    {
      key: 'products',
      title: 'Tạo thực đơn & Mặt hàng',
      description: 'Thêm các món ăn, đồ uống, hàng hóa hoặc bảng giá tính giờ.',
      icon: <ShoppingOutlined />,
      route: '/owner/catalog/products/new',
      completed: hasProducts,
      actionText: 'Thêm mặt hàng',
    },
    {
      key: 'employees',
      title: 'Thêm nhân viên',
      description: 'Tạo tài khoản và mã PIN để nhân viên đăng nhập bán hàng trên POS.',
      icon: <TeamOutlined />,
      route: '/owner/staff/new',
      completed: hasEmployees,
      actionText: 'Thêm nhân viên',
    },
    {
      key: 'banking',
      title: 'Thiết lập tài khoản ngân hàng (VietQR)',
      description: 'Nhập số tài khoản để tự động sinh mã VietQR nhận tiền chuyển khoản.',
      icon: <BankOutlined />,
      route: '/owner/settings/store',
      completed: hasBanking,
      actionText: 'Thiết lập STK',
    },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;
  const isAllCompleted = completedCount === tasks.length;
  const progressPercent = Math.round((completedCount / tasks.length) * 100);

  // Ẩn hoàn toàn nếu đang tải hoặc tất cả 4 bước đã hoàn thành
  if (areaLayouts.isLoading || products.isLoading || employees.isLoading || isAllCompleted) {
    return null;
  }

  return (
    <div className="owner-onboarding-card">
      <div className="owner-onboarding-card__header" onClick={() => setCollapsed(!collapsed)}>
        <div className="owner-onboarding-card__title-group">
          <div className="owner-onboarding-card__badge">
            <RocketOutlined />
          </div>
          <div>
            <div className="owner-onboarding-card__heading-row">
              <strong className="owner-onboarding-card__title">
                {isAllCompleted
                  ? 'Tuyệt vời! Cửa hàng đã sẵn sàng hoạt động'
                  : 'Danh sách việc cần làm cho cửa hàng mới'}
              </strong>
              <Tag
                color={isAllCompleted ? 'success' : 'processing'}
                className="owner-onboarding-status-tag"
              >
                {completedCount}/{tasks.length} hoàn thành ({progressPercent}%)
              </Tag>
            </div>
            <p className="owner-onboarding-card__subtitle">
              {isAllCompleted
                ? 'Toàn bộ 4 bước thiết lập cơ bản đã hoàn tất. Bạn có thể bắt đầu bán hàng ngay trên POS!'
                : 'Hoàn thành 4 bước cơ bản sau để bắt đầu bán hàng và nhận thanh toán trên POS.'}
            </p>
          </div>
        </div>
        <div className="owner-onboarding-card__header-actions">
          <Progress
            percent={progressPercent}
            size="small"
            strokeColor={isAllCompleted ? '#10b981' : '#0975F7'}
            style={{ width: 100, marginRight: 12 }}
            showInfo={false}
          />
          <Button
            type="text"
            size="small"
            icon={collapsed ? <DownOutlined /> : <UpOutlined />}
            aria-label={collapsed ? 'Mở rộng checklist' : 'Thu gọn checklist'}
          />
        </div>
      </div>

      {!collapsed && (
        <div className="owner-onboarding-grid">
          {tasks.map((task, idx) => (
            <div
              key={task.key}
              className={`owner-onboarding-item${task.completed ? ' is-completed' : ''}`}
              onClick={() => navigate(task.route)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(task.route);
              }}
            >
              <div className="owner-onboarding-item__left">
                <div className={`owner-onboarding-item__step${task.completed ? ' is-done' : ''}`}>
                  {task.completed ? <CheckCircleFilled /> : <span>{idx + 1}</span>}
                </div>
                <div className="owner-onboarding-item__icon-wrap">{task.icon}</div>
              </div>
              <div className="owner-onboarding-item__body">
                <div className="owner-onboarding-item__title-row">
                  <strong className="owner-onboarding-item__title">{task.title}</strong>
                  {task.completed ? (
                    <Tag color="success" className="owner-onboarding-item__tag">
                      Đã xong
                    </Tag>
                  ) : null}
                </div>
                <p className="owner-onboarding-item__desc">{task.description}</p>
              </div>
              <div className="owner-onboarding-item__action">
                {task.completed ? (
                  <Button type="text" size="small" className="owner-onboarding-item__btn-done">
                    Xem lại <RightOutlined />
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    className="owner-onboarding-item__btn-start"
                  >
                    {task.actionText} <ArrowRightOutlined />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────

export function OwnerDashboardPage({ settings }: { settings: StoreSettings | undefined }) {
  const [range, setRange] = useState<'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom'>(
    'today',
  );
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);

  // Tab states for 4 Donut Cards
  const [paymentTab, setPaymentTab] = useState<'byRevenue' | 'byCount'>('byRevenue');
  const [orderTypeTab, setOrderTypeTab] = useState<'byRevenue' | 'byCount'>('byRevenue');
  const [categoryTab, setCategoryTab] = useState<'byAmount' | 'byQuantity'>('byAmount');
  const [topProductTab, setTopProductTab] = useState<'byAmount' | 'byQuantity'>('byAmount');

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('range', range);
    if (range === 'custom' && customFrom && customTo) {
      p.set('dateFrom', customFrom);
      p.set('dateTo', customTo);
    }
    return p.toString();
  }, [range, customFrom, customTo]);

  const { data, isLoading, isFetching, refetch } = useQuery<DashboardDataDto>({
    queryKey: ['owner-dashboard-data', queryParams],
    queryFn: () => apiRequest<DashboardDataDto>(`/api/v1/owner/analytics/dashboard?${queryParams}`),
    refetchInterval: 30_000,
  });

  const staffColumns: TableColumnsType<DashboardStaffRevenueRow> = [
    {
      title: 'Nhân viên',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (name: string, row) => (
        <div>
          <strong>{name}</strong>
          {row.roleName ? (
            <div style={{ fontSize: 11, color: '#8898aa' }}>{row.roleName}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Số HĐ',
      dataIndex: 'invoiceCount',
      key: 'invoiceCount',
      width: 90,
      align: 'center',
      render: (count: number) => <Tag color="blue">{count}</Tag>,
    },
    {
      title: 'Số tiền thu về',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (amt: number) => <strong style={{ color: '#0975F7' }}>{formatMoney(amt)}</strong>,
    },
  ];
  const subtotal = data?.summary.subtotal ?? 0;
  const goodsShare =
    subtotal > 0 ? Math.round(((data?.summary.goodsRevenue ?? 0) / subtotal) * 100) : 0;
  const timeShare =
    subtotal > 0 ? Math.round(((data?.summary.timeRevenue ?? 0) / subtotal) * 100) : 0;
  const discountRate = subtotal > 0 ? ((data?.summary.discountTotal ?? 0) / subtotal) * 100 : 0;

  return (
    <div className="owner-dashboard-page">
      {/* ── Page Header & Filters ── */}
      <div className="owner-page-heading owner-dashboard-header">
        <div className="owner-dashboard-header__main">
          <Typography.Title
            level={2}
            className="owner-dashboard-header__title"
            style={{ margin: 0 }}
          >
            <RiseOutlined
              className="owner-dashboard-header__icon"
              style={{ marginRight: 8, color: '#0975F7' }}
            />
            Tổng quan kinh doanh
          </Typography.Title>
          <Typography.Text type="secondary" className="owner-dashboard-header__subtitle">
            Theo dõi thời gian thực kết quả kinh doanh và hoạt động cửa hàng.
          </Typography.Text>
        </div>

        <div className="owner-dashboard-controls">
          <div className="owner-dashboard-controls__row">
            <Select
              value={range}
              onChange={(val) => {
                setRange(val);
                if (val !== 'custom') {
                  setCustomFrom(null);
                  setCustomTo(null);
                }
              }}
              className="owner-dashboard-range-select"
              options={[
                { value: 'today', label: 'Hôm nay' },
                { value: 'yesterday', label: 'Hôm qua' },
                { value: 'week', label: 'Tuần này' },
                { value: 'month', label: 'Tháng này' },
                { value: 'year', label: 'Năm nay' },
                { value: 'custom', label: 'Khoảng thời gian khác' },
              ]}
            />

            <Tooltip title="Tự động cập nhật mỗi 30 giây hoặc bấm để làm mới">
              <Button
                icon={<ReloadOutlined spin={isFetching} />}
                onClick={() => void refetch()}
                className="owner-dashboard-refresh-btn"
              >
                <span className="owner-dashboard-refresh-btn-text">Làm mới</span>
              </Button>
            </Tooltip>
          </div>

          {range === 'custom' && (
            <div className="owner-dashboard-custom-picker">
              <Input
                type="date"
                value={customFrom ?? ''}
                onChange={(e) => setCustomFrom(e.target.value || null)}
                className="owner-dashboard-custom-input"
              />
              <span className="owner-dashboard-custom-sep">-</span>
              <Input
                type="date"
                value={customTo ?? ''}
                onChange={(e) => setCustomTo(e.target.value || null)}
                className="owner-dashboard-custom-input"
              />
            </div>
          )}

          <Typography.Text className="owner-filter-note owner-dashboard-tz-note">
            Múi giờ: {settings?.timezone ?? 'Asia/Ho_Chi_Minh'}
          </Typography.Text>
        </div>
      </div>

      {/* ── Danh sách việc cần làm khi mới tạo tài khoản ── */}
      <OwnerOnboardingChecklist settings={settings} />

      {isLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      ) : (
        <>
          {/* ── Thống kê tổng quan ── */}
          <div className="owner-dashboard-summary-grid">
            <Card className="owner-stat-card owner-stat-card--revenue owner-stat-card--featured">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}
                >
                  <DollarCircleOutlined />
                </span>
                <span className="owner-stat-card__label">Doanh thu thuần</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.revenue ?? 0)}
              </div>
              <div className="owner-stat-card__detail owner-stat-card__detail--featured">
                <span>{data?.summary.invoiceCount ?? 0} hóa đơn</span>
                <span>TB {formatMoney(data?.summary.avgRevenuePerInvoice ?? 0)}/HĐ</span>
              </div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--blue">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#eef5ff', color: '#0975F7' }}
                >
                  <ShoppingOutlined />
                </span>
                <span className="owner-stat-card__label">Tiền hàng</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.goodsRevenue ?? 0)}
              </div>
              <div className="owner-stat-card__detail">{goodsShare}% tổng trước giảm giá</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--violet">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#f5f3ff', color: '#8b5cf6' }}
                >
                  <ClockCircleOutlined />
                </span>
                <span className="owner-stat-card__label">Tiền giờ</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.timeRevenue ?? 0)}
              </div>
              <div className="owner-stat-card__detail">{timeShare}% tổng trước giảm giá</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--purple">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#fff7ed', color: '#f97316' }}
                >
                  <TagsOutlined />
                </span>
                <span className="owner-stat-card__label">Giảm giá</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.discountTotal ?? 0)}
              </div>
              <div className="owner-stat-card__detail">{discountRate.toFixed(1)}% tổng tiền</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--teal">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#f0fdfa', color: '#14b8a6' }}
                >
                  <FileTextOutlined />
                </span>
                <span className="owner-stat-card__label">Số hóa đơn</span>
              </div>
              <div className="owner-stat-card__value">{data?.summary.invoiceCount ?? 0}</div>
              <div className="owner-stat-card__detail">Hóa đơn hoàn tất trong kỳ</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--indigo">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#eef2ff', color: '#6366f1' }}
                >
                  <AppstoreOutlined />
                </span>
                <span className="owner-stat-card__label">TB mặt hàng / HĐ</span>
              </div>
              <div className="owner-stat-card__value">{data?.summary.avgItemsPerInvoice ?? 0}</div>
              <div className="owner-stat-card__detail">Không bao gồm dịch vụ giờ</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--pink">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#fdf2f8', color: '#ec4899' }}
                >
                  <RiseOutlined />
                </span>
                <span className="owner-stat-card__label">TB doanh thu / HĐ</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.avgRevenuePerInvoice ?? 0)}
              </div>
              <div className="owner-stat-card__detail">Giá trị trung bình mỗi hóa đơn</div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--orange">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#fffbeb', color: '#f59e0b' }}
                >
                  <UsergroupAddOutlined />
                </span>
                <span className="owner-stat-card__label">Khách hàng</span>
              </div>
              <div className="owner-stat-card__value">{data?.summary.customerCount ?? 0}</div>
              <div className="owner-stat-card__detail">Hồ sơ khách đang hoạt động</div>
            </Card>
          </div>

          {/* ── Doanh thu đơn chưa hoàn tất (Live Running) ── */}
          <Card
            className="owner-uncompleted-card"
            title={
              <div className="owner-uncompleted-title">
                <Badge status="processing" color="#10b981" />
                <span>Doanh thu đơn chưa hoàn tất (Đang phục vụ)</span>
              </div>
            }
          >
            <div className="owner-uncompleted-grid">
              <div className="owner-uncompleted-item">
                <div
                  className="owner-uncompleted-item__icon"
                  style={{ background: '#eef5ff', color: '#0975F7' }}
                >
                  <ShopOutlined />
                </div>
                <div className="owner-uncompleted-item__info">
                  <span className="owner-uncompleted-item__label">Tại bàn (Dine-in)</span>
                  <div className="owner-uncompleted-item__metrics">
                    <Tag color="blue">{data?.uncompletedOrders.dineIn.count ?? 0} đơn</Tag>
                    <strong>{formatMoney(data?.uncompletedOrders.dineIn.amount ?? 0)}</strong>
                  </div>
                </div>
              </div>

              <div className="owner-uncompleted-item">
                <div
                  className="owner-uncompleted-item__icon"
                  style={{ background: '#fffbeb', color: '#f59e0b' }}
                >
                  <ShoppingCartOutlined />
                </div>
                <div className="owner-uncompleted-item__info">
                  <span className="owner-uncompleted-item__label">Mang về (Takeaway)</span>
                  <div className="owner-uncompleted-item__metrics">
                    <Tag color="orange">{data?.uncompletedOrders.takeaway.count ?? 0} đơn</Tag>
                    <strong>{formatMoney(data?.uncompletedOrders.takeaway.amount ?? 0)}</strong>
                  </div>
                </div>
              </div>

              <div className="owner-uncompleted-item owner-uncompleted-item--total">
                <div
                  className="owner-uncompleted-item__icon"
                  style={{ background: '#ecfdf5', color: '#10b981' }}
                >
                  <WalletOutlined />
                </div>
                <div className="owner-uncompleted-item__info">
                  <span className="owner-uncompleted-item__label">Tổng cộng tạm tính</span>
                  <div className="owner-uncompleted-item__metrics">
                    <Tag color="success">{data?.uncompletedOrders.total.count ?? 0} đơn</Tag>
                    <strong style={{ color: '#059669', fontSize: 18 }}>
                      {formatMoney(data?.uncompletedOrders.total.amount ?? 0)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* ── Biểu đồ doanh thu ── */}
          <div className="owner-charts-2col">
            <Card
              className="owner-chart-card owner-chart-card--featured"
              title="Xu hướng doanh thu"
              extra={
                <span className="owner-chart-card__hint">Cột: trước giảm · Đường: thực thu</span>
              }
            >
              <Suspense fallback={<ChartFallback />}>
                <RevenueTrendChart points={data?.revenueTimelineChart ?? []} />
              </Suspense>
            </Card>

            <Card className="owner-chart-card" title="Khung giờ thanh toán">
              <Suspense fallback={<ChartFallback />}>
                <HourlyRevenueChart
                  points={(data?.paymentTimeChart ?? []).map((point) => ({
                    hour: point.hour,
                    label: point.hourLabel,
                    revenue: point.revenue,
                    invoiceCount: point.invoiceCount,
                  }))}
                />
              </Suspense>
            </Card>
          </div>

          {/* ── 4 Khối Biểu Đồ Tròn (Donut Charts với 2 Tab) ── */}
          <div className="owner-charts-4grid">
            {/* 1. Phương thức thanh toán */}
            <Card
              className="owner-donut-card"
              title="Phương thức thanh toán"
              extra={
                <Tabs
                  size="small"
                  activeKey={paymentTab}
                  onChange={(k) => setPaymentTab(k as 'byRevenue' | 'byCount')}
                  items={[
                    { key: 'byRevenue', label: 'Tổng doanh thu' },
                    { key: 'byCount', label: 'Số hóa đơn' },
                  ]}
                />
              }
            >
              <Suspense fallback={<ChartFallback />}>
                <ModernDonutChart
                  slices={
                    paymentTab === 'byRevenue'
                      ? (data?.paymentMethods.byRevenue ?? [])
                      : (data?.paymentMethods.byCount ?? [])
                  }
                  isMoney={paymentTab === 'byRevenue'}
                  unit={paymentTab === 'byRevenue' ? 'đ' : 'HĐ'}
                />
              </Suspense>
            </Card>

            {/* 2. Hình thức phục vụ */}
            <Card
              className="owner-donut-card"
              title="Hình thức phục vụ"
              extra={
                <Tabs
                  size="small"
                  activeKey={orderTypeTab}
                  onChange={(k) => setOrderTypeTab(k as 'byRevenue' | 'byCount')}
                  items={[
                    { key: 'byRevenue', label: 'Tổng doanh thu' },
                    { key: 'byCount', label: 'Số hóa đơn' },
                  ]}
                />
              }
            >
              <Suspense fallback={<ChartFallback />}>
                <ModernDonutChart
                  slices={
                    orderTypeTab === 'byRevenue'
                      ? (data?.orderTypes.byRevenue ?? [])
                      : (data?.orderTypes.byCount ?? [])
                  }
                  isMoney={orderTypeTab === 'byRevenue'}
                  unit={orderTypeTab === 'byRevenue' ? 'đ' : 'HĐ'}
                />
              </Suspense>
            </Card>

            {/* 3. Mặt hàng theo danh mục */}
            <Card
              className="owner-donut-card"
              title="Mặt hàng theo danh mục"
              extra={
                <Tabs
                  size="small"
                  activeKey={categoryTab}
                  onChange={(k) => setCategoryTab(k as 'byAmount' | 'byQuantity')}
                  items={[
                    { key: 'byAmount', label: 'Tổng số tiền' },
                    { key: 'byQuantity', label: 'Số lượng' },
                  ]}
                />
              }
            >
              <Suspense fallback={<ChartFallback />}>
                <ModernDonutChart
                  slices={
                    categoryTab === 'byAmount'
                      ? (data?.categories.byAmount ?? [])
                      : (data?.categories.byQuantity ?? [])
                  }
                  isMoney={categoryTab === 'byAmount'}
                  unit={categoryTab === 'byAmount' ? 'đ' : 'Món'}
                />
              </Suspense>
            </Card>

            {/* 4. Mặt hàng bán chạy */}
            <Card
              className="owner-donut-card"
              title="Mặt hàng bán chạy"
              extra={
                <Tabs
                  size="small"
                  activeKey={topProductTab}
                  onChange={(k) => setTopProductTab(k as 'byAmount' | 'byQuantity')}
                  items={[
                    { key: 'byAmount', label: 'Tổng số tiền' },
                    { key: 'byQuantity', label: 'Số lượng' },
                  ]}
                />
              }
            >
              <Suspense fallback={<ChartFallback />}>
                <ModernDonutChart
                  slices={(topProductTab === 'byAmount'
                    ? (data?.topProducts.byAmount ?? [])
                    : (data?.topProducts.byQuantity ?? [])
                  ).map((p) => ({
                    key: p.productId,
                    label: p.productName,
                    value: p.value,
                    percentage: p.percentage,
                    color: p.color,
                  }))}
                  isMoney={topProductTab === 'byAmount'}
                  unit={topProductTab === 'byAmount' ? 'đ' : 'phần'}
                />
              </Suspense>
            </Card>
          </div>

          {/* ── Doanh thu nhân viên ── */}
          <div className="owner-dashboard-bottom">
            <Card
              className="owner-staff-revenue-card"
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TeamOutlined style={{ color: '#0975F7' }} />
                  <span>Doanh thu nhân viên</span>
                </div>
              }
            >
              <Table
                dataSource={data?.staffRevenue ?? []}
                columns={staffColumns}
                rowKey="userId"
                pagination={false}
                size="small"
                scroll={{ x: 'max-content' }}
                className="owner-staff-table"
                locale={{
                  emptyText: <Empty description="Chưa có dữ liệu nhân viên trong kỳ" />,
                }}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
