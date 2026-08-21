import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DollarCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RiseOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  TagsOutlined,
  TeamOutlined,
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
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';

import type {
  DashboardDataDto,
  DashboardPaymentTimePoint,
  DashboardStaffRevenueRow,
  DashboardTimelinePoint,
} from '@contracts/dashboard';
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function formatShortMoney(value: number) {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + ' tỷ';
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' tr';
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(0) + 'k';
  }
  return String(value);
}

// ─── SVG Donut Chart Component ───────────────────────────────────────────────

function SvgDonutChart({
  slices,
  unit = 'đ',
  isMoney = true,
}: {
  slices: { key: string; label: string; value: number; percentage: number; color: string }[];
  unit?: string;
  isMoney?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);

  if (!slices.length || total === 0) {
    return (
      <div className="dashboard-donut-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />
      </div>
    );
  }

  // Pre-calculate SVG arcs
  const radius = 68;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const segments = slices.map((slice, i) => {
    const strokeDasharray = `${(slice.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -cumulativeOffset;
    cumulativeOffset += (slice.percentage / 100) * circumference;
    return {
      ...slice,
      index: i,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeSlice = hoveredIdx !== null ? slices[hoveredIdx] : null;

  return (
    <div className="dashboard-donut-container">
      <div className="dashboard-donut-chart">
        <svg viewBox="0 0 180 180" className="dashboard-donut-svg">
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx="90"
              cy="90"
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={hoveredIdx === seg.index ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={seg.strokeDasharray}
              strokeDashoffset={seg.strokeDashoffset}
              strokeLinecap="round"
              className="dashboard-donut-segment"
              onMouseEnter={() => setHoveredIdx(seg.index)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
        </svg>
        <div className="dashboard-donut-center">
          {activeSlice ? (
            <>
              <span className="dashboard-donut-center__label">{activeSlice.label}</span>
              <strong className="dashboard-donut-center__val" style={{ color: activeSlice.color }}>
                {activeSlice.percentage}%
              </strong>
              <small className="dashboard-donut-center__sub">
                {isMoney ? formatMoney(activeSlice.value) : `${activeSlice.value} ${unit}`}
              </small>
            </>
          ) : (
            <>
              <span className="dashboard-donut-center__label">Tổng cộng</span>
              <strong className="dashboard-donut-center__val">
                {isMoney ? formatShortMoney(total) : `${total} ${unit}`}
              </strong>
              <small className="dashboard-donut-center__sub">{slices.length} mục</small>
            </>
          )}
        </div>
      </div>

      <div className="dashboard-donut-legend">
        {slices.map((slice, i) => (
          <div
            key={slice.key}
            className={`dashboard-donut-legend__row ${
              hoveredIdx === i ? 'dashboard-donut-legend__row--active' : ''
            }`}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <span
              className="dashboard-donut-legend__dot"
              style={{ backgroundColor: slice.color }}
            />
            <span className="dashboard-donut-legend__label">{slice.label}</span>
            <span className="dashboard-donut-legend__pct">{slice.percentage}%</span>
            <span className="dashboard-donut-legend__val">
              {isMoney ? formatMoney(slice.value) : `${slice.value} ${unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SVG Timeline Bar Chart Component ────────────────────────────────────────

function SvgTimelineBarChart({ points }: { points: DashboardTimelinePoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    const m = Math.max(...points.map((p) => p.revenue), 0);
    return m === 0 ? 100_000 : m;
  }, [points]);

  const yTicks = useMemo(() => {
    return [maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0];
  }, [maxVal]);

  const totalRevenue = useMemo(() => points.reduce((sum, p) => sum + p.revenue, 0), [points]);

  if (!points.length) {
    return (
      <div className="dashboard-chart-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />
      </div>
    );
  }

  return (
    <div className="dashboard-barchart-wrapper">
      <div className="dashboard-barchart-header">
        <div>
          <span className="dashboard-barchart-total-label">Tổng doanh thu kỳ này:</span>
          <strong className="dashboard-barchart-total-val">{formatMoney(totalRevenue)}</strong>
        </div>
      </div>

      <div className="dashboard-barchart">
        {/* Y Axis */}
        <div className="dashboard-barchart__yaxis">
          {yTicks.map((val, idx) => (
            <span key={idx}>{formatShortMoney(val)}</span>
          ))}
        </div>

        {/* Plot area */}
        <div className="dashboard-barchart__plot">
          {/* Grid lines */}
          <div className="dashboard-barchart__gridline" style={{ top: '0%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '25%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '50%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '75%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '100%' }} />

          {/* Columns */}
          <div className="dashboard-barchart__columns">
            {points.map((p, idx) => {
              const heightPct = Math.min(
                100,
                Math.max(p.revenue > 0 ? 4 : 0, (p.revenue / maxVal) * 100),
              );
              const isHovered = hoveredIdx === idx;
              return (
                <div
                  key={idx}
                  className={`dashboard-barchart__col ${
                    isHovered ? 'dashboard-barchart__col--active' : ''
                  }`}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <Tooltip
                    title={
                      <div style={{ textAlign: 'center' }}>
                        <div>
                          <strong>{p.label}</strong>
                        </div>
                        <div>Doanh thu: {formatMoney(p.revenue)}</div>
                        <div>Số hóa đơn: {p.invoiceCount}</div>
                      </div>
                    }
                    placement="top"
                  >
                    <div className="dashboard-barchart__bar-track">
                      <div
                        className="dashboard-barchart__bar"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor:
                            p.revenue > 0 ? (isHovered ? '#0659c0' : '#0975F7') : '#e2e8f0',
                        }}
                      />
                    </div>
                  </Tooltip>
                  <span className="dashboard-barchart__label">{p.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SVG Payment Time Bar Chart ──────────────────────────────────────────────

function SvgPaymentTimeChart({ points }: { points: DashboardPaymentTimePoint[] }) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    const m = Math.max(...points.map((p) => p.revenue), 0);
    return m === 0 ? 100_000 : m;
  }, [points]);

  const peakHour = useMemo(() => {
    let peak = points[0];
    for (const p of points) {
      if (p.revenue > (peak?.revenue ?? 0)) {
        peak = p;
      }
    }
    return peak && peak.revenue > 0 ? peak : null;
  }, [points]);

  return (
    <div className="dashboard-barchart-wrapper">
      <div className="dashboard-barchart-header">
        {peakHour ? (
          <div>
            <span className="dashboard-barchart-total-label">
              Khung giờ thanh toán cao điểm nhất:
            </span>{' '}
            <Tag color="orange" icon={<ClockCircleOutlined />}>
              {peakHour.hourLabel} ({formatMoney(peakHour.revenue)} · {peakHour.invoiceCount} HĐ)
            </Tag>
          </div>
        ) : (
          <span className="dashboard-barchart-total-label">
            Phân bố doanh thu theo 24 giờ trong ngày
          </span>
        )}
      </div>

      <div className="dashboard-barchart">
        <div className="dashboard-barchart__yaxis">
          <span>{formatShortMoney(maxVal)}</span>
          <span>{formatShortMoney(maxVal * 0.5)}</span>
          <span>0</span>
        </div>

        <div className="dashboard-barchart__plot">
          <div className="dashboard-barchart__gridline" style={{ top: '0%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '50%' }} />
          <div className="dashboard-barchart__gridline" style={{ top: '100%' }} />

          <div className="dashboard-barchart__columns">
            {points.map((p) => {
              const heightPct = Math.min(
                100,
                Math.max(p.revenue > 0 ? 4 : 0, (p.revenue / maxVal) * 100),
              );
              const isHovered = hoveredHour === p.hour;
              const isPeak = peakHour?.hour === p.hour;
              return (
                <div
                  key={p.hour}
                  className="dashboard-barchart__col"
                  onMouseEnter={() => setHoveredHour(p.hour)}
                  onMouseLeave={() => setHoveredHour(null)}
                >
                  <Tooltip
                    title={
                      <div style={{ textAlign: 'center' }}>
                        <div>
                          <strong>{p.hourLabel}</strong>
                        </div>
                        <div>Doanh thu: {formatMoney(p.revenue)}</div>
                        <div>Số lượt TT: {p.invoiceCount}</div>
                      </div>
                    }
                    placement="top"
                  >
                    <div className="dashboard-barchart__bar-track">
                      <div
                        className="dashboard-barchart__bar"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor:
                            p.revenue > 0
                              ? isPeak
                                ? '#f59e0b'
                                : isHovered
                                  ? '#059669'
                                  : '#10b981'
                              : '#e2e8f0',
                        }}
                      />
                    </div>
                  </Tooltip>
                  <span className="dashboard-barchart__label">{p.hour}h</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
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

  return (
    <div className="owner-dashboard-page">
      {/* ── Page Header & Filters ── */}
      <div className="owner-page-heading owner-dashboard-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            <RiseOutlined style={{ marginRight: 10, color: '#0975F7' }} />
            Tổng quan kinh doanh
          </Typography.Title>
          <Typography.Text type="secondary">
            Theo dõi thời gian thực kết quả kinh doanh và hoạt động cửa hàng.
          </Typography.Text>
        </div>

        <div className="owner-dashboard-controls">
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

          {range === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Input
                type="date"
                value={customFrom ?? ''}
                onChange={(e) => setCustomFrom(e.target.value || null)}
                style={{ width: 140 }}
              />
              <span>-</span>
              <Input
                type="date"
                value={customTo ?? ''}
                onChange={(e) => setCustomTo(e.target.value || null)}
                style={{ width: 140 }}
              />
            </div>
          )}

          <Tooltip title="Tự động cập nhật mỗi 30 giây hoặc bấm để làm mới">
            <Button
              icon={<ReloadOutlined spin={isFetching} />}
              onClick={() => void refetch()}
              className="owner-dashboard-refresh-btn"
            >
              Làm mới
            </Button>
          </Tooltip>

          <Typography.Text className="owner-filter-note">
            Múi giờ: {settings?.timezone ?? 'Asia/Ho_Chi_Minh'}
          </Typography.Text>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      ) : (
        <>
          {/* ── 7 Thống Kê Tổng Quan (KPIs) ── */}
          <div className="owner-dashboard-summary-grid">
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
                {formatMoney(data?.summary.subtotal ?? 0)}
              </div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--purple">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#f5f3ff', color: '#8b5cf6' }}
                >
                  <TagsOutlined />
                </span>
                <span className="owner-stat-card__label">Giảm giá</span>
              </div>
              <div className="owner-stat-card__value">
                {formatMoney(data?.summary.discountTotal ?? 0)}
              </div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--emerald">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#ecfdf5', color: '#10b981' }}
                >
                  <DollarCircleOutlined />
                </span>
                <span className="owner-stat-card__label">Doanh thu</span>
              </div>
              <div className="owner-stat-card__value" style={{ color: '#059669', fontWeight: 800 }}>
                {formatMoney(data?.summary.revenue ?? 0)}
              </div>
            </Card>

            <Card className="owner-stat-card owner-stat-card--orange">
              <div className="owner-stat-card__head">
                <span
                  className="owner-stat-card__icon"
                  style={{ background: '#fffbeb', color: '#f59e0b' }}
                >
                  <UsergroupAddOutlined />
                </span>
                <span className="owner-stat-card__label">Số khách hàng</span>
              </div>
              <Tooltip title="Tính năng hồ sơ & quản lý khách hàng đang chuẩn bị triển khai">
                <div className="owner-stat-card__value">
                  {data?.summary.customerCount && data.summary.customerCount > 0 ? (
                    data.summary.customerCount
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 18, fontWeight: 500 }}>Chưa có</span>
                  )}
                </div>
              </Tooltip>
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
                  <span className="owner-uncompleted-item__label">Mang đi (Takeaway)</span>
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

          {/* ── 2 Biểu Đồ Cột ── */}
          <div className="owner-charts-2col">
            {/* Biểu đồ cột doanh thu tổng hợp */}
            <Card
              className="owner-chart-card"
              title="Biểu đồ cột doanh thu tổng hợp (Thời gian & Doanh thu)"
            >
              <SvgTimelineBarChart points={data?.revenueTimelineChart ?? []} />
            </Card>

            {/* Biểu đồ doanh thu theo thời gian thanh toán */}
            <Card
              className="owner-chart-card"
              title="Biểu đồ doanh thu theo thời gian thanh toán (24 Giờ)"
            >
              <SvgPaymentTimeChart points={data?.paymentTimeChart ?? []} />
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
              <SvgDonutChart
                slices={
                  paymentTab === 'byRevenue'
                    ? (data?.paymentMethods.byRevenue ?? [])
                    : (data?.paymentMethods.byCount ?? [])
                }
                isMoney={paymentTab === 'byRevenue'}
                unit={paymentTab === 'byRevenue' ? 'đ' : 'HĐ'}
              />
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
              <SvgDonutChart
                slices={
                  orderTypeTab === 'byRevenue'
                    ? (data?.orderTypes.byRevenue ?? [])
                    : (data?.orderTypes.byCount ?? [])
                }
                isMoney={orderTypeTab === 'byRevenue'}
                unit={orderTypeTab === 'byRevenue' ? 'đ' : 'HĐ'}
              />
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
              <SvgDonutChart
                slices={
                  categoryTab === 'byAmount'
                    ? (data?.categories.byAmount ?? [])
                    : (data?.categories.byQuantity ?? [])
                }
                isMoney={categoryTab === 'byAmount'}
                unit={categoryTab === 'byAmount' ? 'đ' : 'Món'}
              />
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
              <SvgDonutChart
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
