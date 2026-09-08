import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DollarOutlined,
  EditOutlined,
  EyeOutlined,
  FireOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LineChartOutlined,
  LockOutlined,
  LogoutOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  RiseOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingOutlined,
  StarOutlined,
  StopOutlined,
  TeamOutlined,
  TrophyOutlined,
  UnlockOutlined,
  UserOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  MobileOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Result,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  CreatePlatformStoreResponse,
  PlatformAnalytics,
  PlatformStoreDetail,
  PlatformStoreSummary,
} from '@contracts/platform';

import logo from '@client/assets/logo-black.svg';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface CreateStoreValues {
  name: string;
  ownerDisplayName: string;
  ownerEmail: string;
  ownerUsername?: string | undefined;
  ownerPassword?: string | undefined;
}

interface EditMemberValues {
  displayName: string;
  username: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  status: 'ACTIVE' | 'DISABLED';
}

interface ResetPasswordValues {
  newPassword: string;
  confirmPassword?: string | undefined;
}

type StoreMember = PlatformStoreDetail['members'][number];

function readableError(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

function formatVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫';
}

function formatCompactVnd(amount: number) {
  if (amount >= 1_000_000_000) {
    return (amount / 1_000_000_000).toFixed(1) + ' tỷ ₫';
  }
  if (amount >= 1_000_000) {
    return (amount / 1_000_000).toFixed(1) + ' tr ₫';
  }
  if (amount >= 1_000) {
    return (amount / 1_000).toFixed(0) + ' k ₫';
  }
  return formatVnd(amount);
}

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatDateTimeFull(timestamp: number | null | undefined) {
  if (!timestamp) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function formatRelativeTime(timestamp: number | null | undefined) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} ngày trước`;
  return formatDateTime(timestamp);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last && first.length > 0 && last.length > 0) {
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/* =========================================================================
   Interactive SVG Revenue Trend Chart
   ========================================================================= */
function RevenueTrendChart({
  data,
  metric,
}: {
  data: PlatformAnalytics['revenueTrend'];
  metric: 'revenue' | 'invoices';
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 760;
  const height = 240;
  const padLeft = 70;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 40;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const values = data.map((d) => (metric === 'revenue' ? d.revenue : d.invoiceCount));
  const maxVal = Math.max(...values, metric === 'revenue' ? 1_000_000 : 10);

  const points = data.map((d, idx) => {
    const x = padLeft + (idx / Math.max(data.length - 1, 1)) * chartW;
    const val = metric === 'revenue' ? d.revenue : d.invoiceCount;
    const y = padTop + chartH - (val / maxVal) * chartH;
    return { x, y, val, ...d };
  });

  // Area path
  const areaPath = useMemo(() => {
    const firstPt = points[0];
    const lastPt = points[points.length - 1];
    if (!firstPt || !lastPt) return '';
    let p = `M ${firstPt.x} ${padTop + chartH} L ${firstPt.x} ${firstPt.y}`;
    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      if (pt) p += ` L ${pt.x} ${pt.y}`;
    }
    p += ` L ${lastPt.x} ${padTop + chartH} Z`;
    return p;
  }, [points, padTop, chartH]);

  // Line path
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '');
  }, [points]);

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="platform-chart-container" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="platform-chart-svg"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + chartH * (1 - ratio);
          const labelVal = maxVal * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                className="platform-grid-line"
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#94a3b8"
                fontFamily="monospace"
              >
                {metric === 'revenue' ? formatCompactVnd(labelVal) : Math.round(labelVal)}
              </text>
            </g>
          );
        })}

        {/* Gradient Area Fill */}
        <path d={areaPath} fill="url(#revenueGradient)" />

        {/* Line Stroke */}
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />

        {/* X-axis labels & vertical hover trigger columns */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <text
              x={pt.x}
              y={height - 12}
              textAnchor="middle"
              fontSize="11"
              fill={hoverIndex === idx ? '#0f172a' : '#94a3b8'}
              fontWeight={hoverIndex === idx ? 700 : 500}
            >
              {pt.dateLabel}
            </text>

            {/* Hover Dot */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoverIndex === idx ? 6 : 3.5}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={hoverIndex === idx ? 3 : 2}
              style={{ transition: 'all 0.15s ease' }}
            />

            {/* Transparent hover capture rect */}
            <rect
              x={pt.x - chartW / points.length / 2}
              y={padTop}
              width={chartW / points.length}
              height={chartH}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoverIndex(idx)}
            />
          </g>
        ))}
      </svg>

      {/* Floating Tooltip */}
      {activePoint ? (
        <div
          className="platform-chart-tooltip-box"
          style={{
            left: `${(activePoint.x / width) * 100}%`,
            top: `${(activePoint.y / height) * 100}%`,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
            Ngày {activePoint.date}
          </div>
          <div style={{ color: '#93c5fd' }}>
            Doanh thu: <strong>{formatVnd(activePoint.revenue)}</strong>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 12 }}>
            Số hóa đơn: <strong>{activePoint.invoiceCount}</strong> đơn
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* =========================================================================
   Interactive Payment Methods Donut Chart
   ========================================================================= */
function PaymentDonutChart({ data }: { data: PlatformAnalytics['paymentMethods'] }) {
  const totalAmount = data.reduce((acc, d) => acc + d.totalAmount, 0);

  const radius = 60;
  const circ = 2 * Math.PI * radius;

  const colorMap: Record<string, string> = {
    CASH: '#10b981',
    BANK_TRANSFER: '#3b82f6',
    OTHER: '#8b5cf6',
  };

  let accumulated = 0;
  const slices = data.map((d) => {
    const ratio = totalAmount > 0 ? d.totalAmount / totalAmount : 0;
    const strokeDasharray = `${ratio * circ} ${circ}`;
    const strokeDashoffset = -accumulated * circ;
    accumulated += ratio;
    return {
      ...d,
      color: colorMap[d.method] || '#64748b',
      strokeDasharray,
      strokeDashoffset,
    };
  });

  return (
    <div className="platform-donut-wrapper">
      <div style={{ position: 'relative', width: 150, height: 150 }}>
        <svg viewBox="0 0 150 150" className="platform-donut-svg">
          {/* Background circle */}
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {slices.map((slice, i) => (
            <circle
              key={i}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth="18"
              strokeDasharray={slice.strokeDasharray}
              strokeDashoffset={slice.strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: 'all 0.3s ease' }}
            />
          ))}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>TỔNG GMV</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
            {formatCompactVnd(totalAmount)}
          </div>
        </div>
      </div>

      <div className="platform-donut-legend">
        {data.length === 0 ? (
          <Typography.Text type="secondary">Chưa có dữ liệu thanh toán</Typography.Text>
        ) : (
          slices.map((slice) => (
            <div key={slice.method} className="platform-donut-legend-item">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="platform-donut-dot" style={{ background: slice.color }} />
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{slice.label}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: '#0f172a' }}>{slice.percentage}%</strong>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {formatCompactVnd(slice.totalAmount)} ({slice.count} GD)
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   24-Hour Peak Distribution Chart
   ========================================================================= */
function HourlyPeakChart({ data }: { data: PlatformAnalytics['hourlyDistribution'] }) {
  const maxOrders = Math.max(...data.map((d) => d.orderCount), 1);

  return (
    <div>
      <div className="platform-hourly-chart">
        {data.map((item) => {
          const heightPct = Math.max((item.orderCount / maxOrders) * 100, 4);
          const isPeak = item.orderCount > 0 && item.orderCount >= maxOrders * 0.7;

          return (
            <Tooltip
              key={item.hour}
              title={
                <div>
                  <strong>{item.label}</strong>
                  <div>Đơn hàng: {item.orderCount}</div>
                  <div>Doanh thu: {formatVnd(item.revenue)}</div>
                </div>
              }
            >
              <div className="platform-hourly-col">
                <div
                  className={`platform-hourly-bar ${isPeak ? 'platform-hourly-bar--peak' : ''}`}
                  style={{ height: `${heightPct}%` }}
                />
                <span className="platform-hourly-label">
                  {item.hour % 3 === 0 ? String(item.hour).padStart(2, '0') : ''}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: '#64748b',
          marginTop: 6,
        }}
      >
        <span>00:00 (Đêm)</span>
        <span>12:00 (Trưa)</span>
        <span>18:00 (Tối)</span>
        <span>23:00 (Khuya)</span>
      </div>
    </div>
  );
}

/* =========================================================================
   Store Leaderboard / Performance Widget
   ========================================================================= */
function StoreLeaderboardWidget({
  stores,
  onSelectStore,
  isMobile,
}: {
  stores: PlatformAnalytics['storePerformance'];
  onSelectStore: (storeId: string) => void;
  isMobile?: boolean;
}) {
  const maxRevenue = Math.max(...stores.map((s) => s.totalRevenue), 1);

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stores.length === 0 ? (
          <Empty description="Chưa có dữ liệu cửa hàng" style={{ margin: '16px 0' }} />
        ) : (
          stores.map((record, idx) => {
            const rank = idx + 1;
            const cls =
              rank === 1
                ? 'platform-rank-1'
                : rank === 2
                  ? 'platform-rank-2'
                  : rank === 3
                    ? 'platform-rank-3'
                    : 'platform-rank-default';
            const pct = Math.round((record.totalRevenue / maxRevenue) * 100);

            return (
              <div
                key={record.storeId}
                className="platform-mobile-rank-card"
                onClick={() => onSelectStore(record.storeId)}
                style={{ cursor: 'pointer' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span className={`platform-rank-badge ${cls}`}>{rank}</span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {record.storeName}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                        <span className="platform-badge-id">{record.storeId.slice(0, 8)}</span>
                        <Tag
                          color={record.status === 'ACTIVE' ? 'success' : 'error'}
                          style={{ fontSize: 10, borderRadius: 4, margin: 0, padding: '0 4px' }}
                        >
                          {record.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                        </Tag>
                      </div>
                    </div>
                  </div>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<EyeOutlined />}
                    style={{ borderRadius: 6, fontSize: 11.5, flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectStore(record.storeId);
                    }}
                  >
                    Chi tiết
                  </Button>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: 8,
                    padding: '8px 10px',
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#64748b' }}>Doanh thu:</span>
                    <span style={{ fontWeight: 800, color: '#2563eb', fontSize: 14 }}>
                      {formatVnd(record.totalRevenue)}
                    </span>
                  </div>
                  <Progress
                    percent={pct}
                    size="small"
                    strokeColor="#2563eb"
                    showInfo={false}
                    style={{ margin: '4px 0 2px' }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                      color: '#64748b',
                      marginTop: 4,
                    }}
                  >
                    <span>
                      {record.totalInvoices} HĐ ({record.totalOrders} đơn)
                    </span>
                    <span>
                      {record.activeDevices} POS · {record.occupiedTables}/{record.totalTables} bàn
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  const columns = [
    {
      title: 'Hạng',
      key: 'rank',
      width: 65,
      render: (_: unknown, __: unknown, idx: number) => {
        const rank = idx + 1;
        const cls =
          rank === 1
            ? 'platform-rank-1'
            : rank === 2
              ? 'platform-rank-2'
              : rank === 3
                ? 'platform-rank-3'
                : 'platform-rank-default';
        return <span className={`platform-rank-badge ${cls}`}>{rank}</span>;
      },
    },
    {
      title: 'Cửa hàng',
      key: 'name',
      render: (record: PlatformAnalytics['storePerformance'][number]) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: '#0f172a' }}>
            {record.storeName}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
            <span className="platform-badge-id">{record.storeId.slice(0, 8)}</span>
            <Tag
              color={record.status === 'ACTIVE' ? 'success' : 'error'}
              style={{ fontSize: 11, borderRadius: 4, margin: 0 }}
            >
              {record.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'Doanh thu & Thị phần',
      key: 'revenue',
      render: (record: PlatformAnalytics['storePerformance'][number]) => {
        const pct = Math.round((record.totalRevenue / maxRevenue) * 100);
        return (
          <div style={{ minWidth: 160 }}>
            <div style={{ fontWeight: 800, color: '#0975f7', fontSize: 14.5 }}>
              {formatVnd(record.totalRevenue)}
            </div>
            <Progress
              percent={pct}
              size="small"
              strokeColor="#2563eb"
              showInfo={false}
              style={{ margin: '3px 0 0' }}
            />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              Hôm nay: {formatCompactVnd(record.todayRevenue)}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Đơn hàng & Giá trị TB',
      key: 'orders',
      render: (record: PlatformAnalytics['storePerformance'][number]) => (
        <div>
          <div style={{ fontWeight: 650, color: '#0f172a' }}>
            {record.totalInvoices} HĐ ({record.totalOrders} đơn)
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            TB/đơn: {formatCompactVnd(record.avgOrderValue)}
          </div>
        </div>
      ),
    },
    {
      title: 'Quy mô',
      key: 'scale',
      render: (record: PlatformAnalytics['storePerformance'][number]) => (
        <div style={{ fontSize: 12.5, color: '#475569' }}>
          <div>
            📱 <strong>{record.activeDevices}</strong> POS
          </div>
          <div>
            🎱{' '}
            <strong>
              {record.occupiedTables}/{record.totalTables}
            </strong>{' '}
            bàn
          </div>
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 110,
      render: (record: PlatformAnalytics['storePerformance'][number]) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => onSelectStore(record.storeId)}>
          Chi tiết
        </Button>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={stores}
      rowKey="storeId"
      pagination={{ pageSize: 5, hideOnSinglePage: true }}
      locale={{ emptyText: 'Chưa có dữ liệu cửa hàng' }}
      scroll={{ x: 600 }}
    />
  );
}

/* =========================================================================
   Top Selling Products / Services Widget
   ========================================================================= */
function TopProductsWidget({
  products,
  isMobile,
}: {
  products: PlatformAnalytics['topProducts'];
  isMobile?: boolean;
}) {
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {products.length === 0 ? (
          <Empty description="Chưa có mặt hàng nào được bán" style={{ margin: '16px 0' }} />
        ) : (
          products.map((record, idx) => (
            <div
              key={`${record.name}_${record.productType}`}
              className="platform-mobile-product-card"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    className="platform-rank-badge platform-rank-default"
                    style={{ width: 22, height: 22, fontSize: 11, flexShrink: 0 }}
                  >
                    {idx + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 650,
                        fontSize: 13.5,
                        color: '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.name}
                    </div>
                    <Tag
                      color={
                        record.productType === 'TIME'
                          ? 'blue'
                          : record.productType === 'WEIGHT'
                            ? 'orange'
                            : 'cyan'
                      }
                      style={{ fontSize: 10, margin: '2px 0 0', padding: '0 4px', borderRadius: 4 }}
                    >
                      {record.productType === 'TIME'
                        ? 'Giờ chơi'
                        : record.productType === 'WEIGHT'
                          ? 'Theo cân'
                          : 'Món / Đồ uống'}
                    </Tag>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, color: '#0975f7', fontSize: 13.5 }}>
                    {formatVnd(record.totalRevenue)}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                    {record.totalQuantity}{' '}
                    {record.productType === 'TIME'
                      ? 'giờ'
                      : record.productType === 'WEIGHT'
                        ? 'kg'
                        : 'phần'}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 45,
      render: (_: unknown, __: unknown, idx: number) => <strong>{idx + 1}</strong>,
    },
    {
      title: 'Mặt hàng / Dịch vụ',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: PlatformAnalytics['topProducts'][number]) => (
        <div>
          <div style={{ fontWeight: 650, color: '#0f172a' }}>{name}</div>
          <Tag
            color={
              record.productType === 'TIME'
                ? 'blue'
                : record.productType === 'WEIGHT'
                  ? 'orange'
                  : 'cyan'
            }
            style={{ fontSize: 11, borderRadius: 4, marginTop: 2 }}
          >
            {record.productType === 'TIME'
              ? 'Giờ chơi'
              : record.productType === 'WEIGHT'
                ? 'Theo cân'
                : 'Món / Đồ uống'}
          </Tag>
        </div>
      ),
    },
    {
      title: 'Số lượng bán',
      dataIndex: 'totalQuantity',
      key: 'totalQuantity',
      render: (qty: number, record: PlatformAnalytics['topProducts'][number]) => (
        <span style={{ fontWeight: 600 }}>
          {qty}{' '}
          {record.productType === 'TIME' ? 'giờ' : record.productType === 'WEIGHT' ? 'kg' : 'phần'}
        </span>
      ),
    },
    {
      title: 'Doanh thu',
      dataIndex: 'totalRevenue',
      key: 'totalRevenue',
      render: (rev: number) => <strong style={{ color: '#0975f7' }}>{formatVnd(rev)}</strong>,
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={products}
      rowKey={(r) => `${r.name}_${r.productType}`}
      pagination={{ pageSize: 5, hideOnSinglePage: true }}
      locale={{ emptyText: 'Chưa có mặt hàng nào được bán' }}
      size="middle"
      scroll={{ x: 480 }}
    />
  );
}

export function SuperAdminPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [form] = Form.useForm<CreateStoreValues>();
  const [editMemberForm] = Form.useForm<EditMemberValues>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordValues>();

  const [createOpen, setCreateOpen] = useState(false);
  const selectedStoreId = useMemo(() => {
    const match = location.pathname.match(/^\/platform\/stores\/([^/]+)\/?$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const openStoreDetail = (storeId: string) => {
    navigate(`/platform/stores/${encodeURIComponent(storeId)}`);
  };

  const closeStoreDetail = () => {
    navigate('/platform');
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Navigation & Filter state
  const [activeTab, setActiveTab] = useState<'analytics' | 'stores'>('analytics');
  const [analyticsDays, setAnalyticsDays] = useState<number>(14);
  const [trendMetric, setTrendMetric] = useState<'revenue' | 'invoices'>('revenue');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'LOCKED'>('ALL');

  // Member editing state
  const [editingMember, setEditingMember] = useState<StoreMember | null>(null);
  const [resetPasswordMember, setResetPasswordMember] = useState<StoreMember | null>(null);
  const [selectedMemberForHistory, setSelectedMemberForHistory] = useState<StoreMember | null>(
    null,
  );

  const [sessionPresenceFilter, setSessionPresenceFilter] = useState<
    'ALL' | 'ONLINE' | 'OFFLINE' | 'REVOKED' | 'EXPIRED'
  >('ALL');
  const [sessionViewMode, setSessionViewMode] = useState<'DEVICES' | 'HISTORY'>('DEVICES');
  const [selectedDeviceFilter, setSelectedDeviceFilter] = useState<string>('ALL');
  const [storeTrendDays, setStoreTrendDays] = useState<number>(14);
  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [memberHistoryFilter, setMemberHistoryFilter] = useState<
    'ALL' | 'ONLINE' | 'OFFLINE' | 'INACTIVE'
  >('ALL');
  const [activeDetailTab, setActiveDetailTab] = useState<string>('overview');
  const [cleaningDb, setCleaningDb] = useState(false);
  const [requestingPushDeviceId, setRequestingPushDeviceId] = useState<string | null>(null);

  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const stores = useQuery({
    queryKey: ['platform-stores'],
    queryFn: () => apiRequest<PlatformStoreSummary[]>('/api/v1/platform/stores'),
    enabled: context.data?.actor?.kind === 'SUPER_ADMIN',
  });

  const analytics = useQuery({
    queryKey: ['platform-analytics', analyticsDays],
    queryFn: () =>
      apiRequest<PlatformAnalytics>(`/api/v1/platform/analytics?days=${analyticsDays}`),
    enabled: context.data?.actor?.kind === 'SUPER_ADMIN',
  });

  const storeDetail = useQuery({
    queryKey: ['platform-store-detail', selectedStoreId, storeTrendDays],
    queryFn: () =>
      apiRequest<PlatformStoreDetail>(
        `/api/v1/platform/stores/${selectedStoreId}?days=${storeTrendDays}`,
      ),
    enabled: context.data?.actor?.kind === 'SUPER_ADMIN' && Boolean(selectedStoreId),
  });

  const stats = useMemo(() => {
    const rows = stores.data ?? [];
    return {
      total: rows.length,
      active: rows.filter((store) => store.status === 'ACTIVE').length,
      locked: rows.filter((store) => store.status === 'LOCKED').length,
    };
  }, [stores.data]);

  const filteredStores = useMemo(() => {
    const rows = stores.data ?? [];
    return rows.filter((store) => {
      const matchesSearch =
        !searchTerm.trim() ||
        store.name.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
        store.id.toLowerCase().includes(searchTerm.trim().toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || store.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [stores.data, searchTerm, statusFilter]);

  const csrfHeaders = () => ({
    'X-CSRF-Token': context.data?.csrfToken ?? '',
  });

  const createStore = async (values: CreateStoreValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<CreatePlatformStoreResponse>('/api/v1/platform/stores', values, {
        headers: csrfHeaders(),
      });
      await queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
      setCreateOpen(false);
      form.resetFields();
      message.success('Đã tạo cửa hàng mới thành công!');
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (store: { id: string; status: 'ACTIVE' | 'LOCKED' }) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${store.id}/status`,
        {
          status: store.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE',
        },
        {
          method: 'PATCH',
          headers: csrfHeaders(),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-stores'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-store-detail', store.id] }),
      ]);
      message.success(
        store.status === 'ACTIVE'
          ? 'Đã khóa cửa hàng thành công.'
          : 'Đã mở lại cửa hàng hoạt động.',
      );
    } catch (statusError) {
      setError(readableError(statusError));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteStore = async (store: { id: string; name: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/platform/stores/${store.id}`, {
        method: 'DELETE',
        headers: csrfHeaders(),
      });
      if (selectedStoreId === store.id) {
        closeStoreDetail();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-stores'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-analytics'] }),
      ]);
      message.success(`Đã xóa sạch toàn bộ dữ liệu cửa hàng "${store.name}" thành công!`);
    } catch (deleteError) {
      setError(readableError(deleteError));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRealtime = async (store: { id: string; posRealtimeEnabled: boolean }) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${store.id}/capabilities`,
        {
          capability: 'POS_REALTIME',
          enabled: !store.posRealtimeEnabled,
        },
        {
          method: 'PATCH',
          headers: csrfHeaders(),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-stores'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-store-detail', store.id] }),
      ]);
      message.success(!store.posRealtimeEnabled ? 'Đã bật Realtime POS' : 'Đã tắt Realtime POS');
    } catch (capabilityError) {
      setError(readableError(capabilityError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditMember = (member: StoreMember) => {
    setEditingMember(member);
    editMemberForm.setFieldsValue({
      displayName: member.displayName,
      username: member.username,
      email: member.email,
      phone: member.phone,
      status: member.userStatus,
    });
  };

  const submitEditMember = async (values: EditMemberValues) => {
    if (!selectedStoreId || !editingMember) return;
    setSubmitting(true);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${selectedStoreId}/members/${editingMember.userId}`,
        values,
        {
          method: 'PATCH',
          headers: csrfHeaders(),
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ['platform-store-detail', selectedStoreId],
      });
      message.success('Đã cập nhật thông tin tài khoản thành công!');
      setEditingMember(null);
    } catch (editError) {
      message.error(readableError(editError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = (member: StoreMember) => {
    setResetPasswordMember(member);
    resetPasswordForm.resetFields();
  };

  const submitResetPassword = async (values: ResetPasswordValues) => {
    if (!selectedStoreId || !resetPasswordMember) return;
    setSubmitting(true);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${selectedStoreId}/members/${resetPasswordMember.userId}`,
        {
          newPassword: values.newPassword,
        },
        {
          method: 'PATCH',
          headers: csrfHeaders(),
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ['platform-store-detail', selectedStoreId],
      });
      message.success(
        `Đã đặt lại mật khẩu mới cho tài khoản @${resetPasswordMember.username} thành công!`,
      );
      setResetPasswordMember(null);
      resetPasswordForm.resetFields();
    } catch (resetError) {
      message.error(readableError(resetError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!selectedStoreId) return;
    setSubmitting(true);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${selectedStoreId}/sessions/${sessionId}`,
        undefined,
        {
          method: 'DELETE',
          headers: csrfHeaders(),
        },
      );
      message.success('Đã thu hồi phiên đăng nhập thiết bị thành công!');
      await queryClient.invalidateQueries({
        queryKey: ['platform-store-detail', selectedStoreId],
      });
    } catch (err) {
      message.error(readableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!selectedStoreId) return;
    setSubmitting(true);
    try {
      await jsonRequest(
        `/api/v1/platform/stores/${selectedStoreId}/devices/${deviceId}`,
        undefined,
        {
          method: 'DELETE',
          headers: csrfHeaders(),
        },
      );
      message.success('Đã thu hồi quyền thiết bị POS thành công!');
      await queryClient.invalidateQueries({
        queryKey: ['platform-store-detail', selectedStoreId],
      });
    } catch (err) {
      message.error(readableError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPushPrompt = async (deviceId: string, deviceName: string) => {
    if (!selectedStoreId) return;
    setRequestingPushDeviceId(deviceId);
    try {
      const res = await jsonRequest<{ requested: boolean; deliveredConnections: number }>(
        `/api/v1/platform/stores/${selectedStoreId}/devices/${deviceId}/request-push-prompt`,
        {},
        { method: 'POST', headers: csrfHeaders() },
      );
      if (res.deliveredConnections > 0) {
        message.success(
          `Đã gửi yêu cầu bật thông báo tới "${deviceName}". Popup đã xuất hiện trên máy POS!`,
        );
      } else {
        message.info(
          `Đã lưu yêu cầu cho "${deviceName}". Popup sẽ tự động mở khi thiết bị kết nối vào POS.`,
        );
      }
    } catch (err) {
      message.error(readableError(err));
    } finally {
      setRequestingPushDeviceId(null);
    }
  };

  const handleMaintenanceCleanup = async () => {
    setCleaningDb(true);
    try {
      const res = await jsonRequest<{
        totalDeleted: number;
        durationMs: number;
        policy: Record<string, number>;
        tables: Record<string, number>;
      }>(
        '/api/v1/platform/maintenance/cleanup',
        {},
        {
          method: 'POST',
          headers: csrfHeaders(),
        },
      );
      const activeDeletions = Object.entries(res.tables || {}).filter(([, count]) => count > 0);
      Modal.success({
        title: 'Dọn dẹp dữ liệu vận hành hoàn tất',
        width: 480,
        content: (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Tổng cộng đã dọn: {res.totalDeleted.toLocaleString('vi-VN')} bản ghi ({res.durationMs}{' '}
              ms)
            </p>
            {activeDeletions.length > 0 ? (
              <div
                style={{
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '8px 12px',
                }}
              >
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#334155' }}>
                  {activeDeletions.map(([tbl, count]) => (
                    <li key={tbl} style={{ padding: '2px 0' }}>
                      <strong>{tbl}</strong>: {count.toLocaleString('vi-VN')} bản ghi
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ color: '#64748b', margin: 0 }}>
                Hệ thống sạch sẽ, không có bản ghi nào hết hạn cần dọn.
              </p>
            )}
          </div>
        ),
      });
      void queryClient.invalidateQueries({ queryKey: ['platform-analytics'] });
    } catch (err) {
      message.error(readableError(err));
    } finally {
      setCleaningDb(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    try {
      const response = await apiRequest<{ loggedOut: boolean; accessLogoutUrl: string | null }>(
        '/api/v1/auth/logout',
        {
          method: 'POST',
          headers: csrfHeaders(),
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      queryClient.clear();
      if (response?.accessLogoutUrl) {
        window.location.assign(
          `/api/v1/auth/access/logout?returnTo=${encodeURIComponent(window.location.origin + '/platform/login?loggedOut=1')}`,
        );
      } else {
        window.location.assign('/platform/login?loggedOut=1');
      }
    } catch {
      window.location.assign(
        `/api/v1/auth/access/logout?returnTo=${encodeURIComponent(window.location.origin + '/platform/login?loggedOut=1')}`,
      );
    }
  };

  if (context.isLoading) return <Spin fullscreen description="Đang kiểm tra phiên SUPER_ADMIN" />;
  if (context.isError || !context.data) {
    return <Navigate to="/platform/login" replace />;
  }
  if (context.data.actor?.kind !== 'SUPER_ADMIN') {
    return <Navigate to="/platform/login" replace />;
  }

  const detail = storeDetail.data;

  return (
    <Layout className="platform-shell">
      <header className="platform-header">
        <div className="platform-brand">
          <img src={logo} alt="Pro POS" />
          <div className="platform-brand-text">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text strong style={{ fontSize: 16 }}>
                Quản trị nền tảng
              </Typography.Text>
              <Tag color="blue" style={{ borderRadius: 6, fontWeight: 600 }}>
                SUPER_ADMIN
              </Tag>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {context.data.actor.displayName}
            </Typography.Text>
          </div>
        </div>
        <Button
          icon={<LogoutOutlined />}
          loading={submitting}
          onClick={logout}
          className="platform-logout-btn"
        >
          <span className="platform-logout-text">Đăng xuất</span>
        </Button>
      </header>

      <main className={`platform-content ${selectedStoreId ? 'platform-content--hidden' : ''}`}>
        <div className="platform-title-row">
          <div className="platform-title-text">
            <Typography.Title level={2} className="platform-main-title">
              Quản trị Nền tảng Pro POS
            </Typography.Title>
            <Typography.Text type="secondary" className="platform-main-subtitle">
              Theo dõi hiệu suất kinh doanh toàn hệ thống, quản lý cơ sở và cấp quyền tài khoản.
            </Typography.Text>
          </div>
          <div className="platform-actions-row">
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              className="platform-create-btn"
              onClick={() => {
                setError(null);
                setCreateOpen(true);
              }}
            >
              Tạo cửa hàng mới
            </Button>
            <div className="platform-actions-subrow">
              <Popconfirm
                title="Dọn dẹp dữ liệu vận hành?"
                description="Dọn dữ liệu vận hành đã hết hạn theo chính sách lưu trữ và dữ liệu mồ côi an toàn. Không xóa hóa đơn, thanh toán, đơn hàng còn tồn tại, danh mục hoặc cấu hình."
                okText="Dọn dẹp ngay"
                cancelText="Hủy"
                okButtonProps={{ danger: true, loading: cleaningDb }}
                onConfirm={handleMaintenanceCleanup}
              >
                <Button
                  icon={<ClearOutlined />}
                  loading={cleaningDb}
                  className="platform-cleanup-btn"
                >
                  Dọn dữ liệu vận hành
                </Button>
              </Popconfirm>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['platform-analytics'] });
                  void queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
                  message.info('Đang làm mới dữ liệu...');
                }}
                className="platform-refresh-btn"
              >
                Làm mới
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <Alert
            className="platform-error"
            type="error"
            showIcon
            message={error}
            closable
            onClose={() => setError(null)}
            style={{ borderRadius: 10, marginTop: 16 }}
          />
        ) : null}

        {/* Tab Navigation */}
        <div className="platform-tabs-wrapper">
          <Segmented
            block
            size="large"
            value={activeTab}
            onChange={(val) => setActiveTab(val as 'analytics' | 'stores')}
            options={[
              {
                label: (
                  <span className="platform-tab-label">
                    <LineChartOutlined
                      style={{ color: activeTab === 'analytics' ? '#2563eb' : '#64748b' }}
                    />
                    <span className="platform-tab-text-full">
                      Báo cáo & Hiệu suất Toàn Hệ Thống
                    </span>
                    <span className="platform-tab-text-short">Báo cáo & Hiệu suất</span>
                  </span>
                ),
                value: 'analytics',
              },
              {
                label: (
                  <span className="platform-tab-label">
                    <ShopOutlined
                      style={{ color: activeTab === 'stores' ? '#10b981' : '#64748b' }}
                    />
                    <span className="platform-tab-text-full">Quản lý Cửa hàng ({stats.total})</span>
                    <span className="platform-tab-text-short">Cửa hàng ({stats.total})</span>
                  </span>
                ),
                value: 'stores',
              },
            ]}
            className="platform-segmented-tabs"
          />
        </div>

        {/* TAB 1: ANALYTICS & PERFORMANCE DASHBOARD */}
        {activeTab === 'analytics' ? (
          analytics.isLoading ? (
            <Card
              style={{ marginTop: 16, textAlign: 'center', padding: '60px 0', borderRadius: 16 }}
            >
              <Spin size="large" description="Đang tải dữ liệu phân tích hệ thống..." />
            </Card>
          ) : analytics.data ? (
            <div className="platform-analytics-grid">
              {/* 4 Hero KPI Cards */}
              <div className="platform-kpi-grid">
                <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
                  <div className="stat-card-inner">
                    <div className="stat-icon-wrapper stat-icon-wrapper--blue">
                      <ShopOutlined />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                        CỬA HÀNG HỆ THỐNG
                      </Typography.Text>
                      <div
                        style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}
                      >
                        {analytics.data.summary.totalStores} Cơ sở
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>
                          {analytics.data.summary.activeStores} hoạt động
                        </span>{' '}
                        • {analytics.data.summary.lockedStores} đã khóa
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
                  <div className="stat-card-inner">
                    <div className="stat-icon-wrapper stat-icon-wrapper--green">
                      <DollarOutlined />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                        TỔNG DOANH THU (GMV)
                      </Typography.Text>
                      <div
                        style={{ fontSize: 22, fontWeight: 800, color: '#10b981', lineHeight: 1.2 }}
                      >
                        {formatVnd(analytics.data.summary.totalRevenue)}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                        Hôm nay:{' '}
                        <strong>{formatCompactVnd(analytics.data.summary.todayRevenue)}</strong> • 7
                        ngày:{' '}
                        <strong>{formatCompactVnd(analytics.data.summary.last7DaysRevenue)}</strong>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
                  <div className="stat-card-inner">
                    <div
                      className="stat-icon-wrapper"
                      style={{ background: '#f5f3ff', color: '#8b5cf6' }}
                    >
                      <CreditCardOutlined />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                        HÓA ĐƠN & ĐƠN HÀNG
                      </Typography.Text>
                      <div
                        style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}
                      >
                        {analytics.data.summary.totalInvoices} Hóa đơn
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                        TB/đơn:{' '}
                        <strong>{formatCompactVnd(analytics.data.summary.avgOrderValue)}</strong> •{' '}
                        {analytics.data.summary.openOrders} đơn đang mở
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
                  <div className="stat-card-inner">
                    <div
                      className="stat-icon-wrapper"
                      style={{ background: '#fffbeb', color: '#f59e0b' }}
                    >
                      <DesktopOutlined />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                        THIẾT BỊ & BÀN PHỤC VỤ
                      </Typography.Text>
                      <div
                        style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}
                      >
                        {analytics.data.summary.totalActiveDevices} POS Online
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                        Bàn chơi:{' '}
                        <strong>
                          {analytics.data.summary.occupiedTables}/
                          {analytics.data.summary.totalTables}
                        </strong>{' '}
                        • {analytics.data.summary.totalMembers} nhân sự
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Revenue & Invoices Trend Chart Card */}
              <Card className="platform-chart-card" styles={{ body: { padding: '22px 24px' } }}>
                <div className="platform-chart-header">
                  <div className="platform-chart-title">
                    <RiseOutlined style={{ color: '#2563eb', fontSize: 18 }} />
                    <span>Biểu đồ Xu hướng Doanh thu & Giao dịch</span>
                  </div>
                  <div className="platform-chart-controls">
                    <Segmented
                      value={trendMetric}
                      onChange={(val) => setTrendMetric(val as 'revenue' | 'invoices')}
                      options={[
                        { label: 'Doanh thu (VNĐ)', value: 'revenue' },
                        { label: 'Số hóa đơn', value: 'invoices' },
                      ]}
                      size="small"
                    />
                    <Segmented
                      value={analyticsDays}
                      onChange={(val) => setAnalyticsDays(val as number)}
                      options={[
                        { label: '7 ngày', value: 7 },
                        { label: '14 ngày', value: 14 },
                        { label: '30 ngày', value: 30 },
                      ]}
                      size="small"
                    />
                  </div>
                </div>

                <RevenueTrendChart data={analytics.data.revenueTrend} metric={trendMetric} />
              </Card>

              {/* Store Leaderboard / Ranking Card */}
              <Card className="platform-chart-card" styles={{ body: { padding: '22px 24px' } }}>
                <div className="platform-chart-header">
                  <div>
                    <div className="platform-chart-title">
                      <TrophyOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                      <span>Bảng Xếp Hạng & Hiệu Suất Cửa Hàng Toàn Hệ Thống</span>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      Xếp hạng doanh thu, tỷ lệ đóng góp GMV và quy mô vận hành của từng cơ sở
                    </Typography.Text>
                  </div>
                </div>

                <StoreLeaderboardWidget
                  stores={analytics.data.storePerformance}
                  onSelectStore={openStoreDetail}
                  isMobile={isMobile}
                />
              </Card>

              {/* Two Column Grid: Payment Breakdown & Hourly Peak */}
              <div className="platform-two-col-grid">
                {/* Payment Methods Card */}
                <Card className="platform-chart-card" styles={{ body: { padding: '20px 24px' } }}>
                  <div className="platform-chart-header" style={{ marginBottom: 10 }}>
                    <div className="platform-chart-title">
                      <CreditCardOutlined style={{ color: '#10b981', fontSize: 18 }} />
                      <span>Phân Bổ Phương Thức Thanh Toán</span>
                    </div>
                  </div>
                  <PaymentDonutChart data={analytics.data.paymentMethods} />
                </Card>

                {/* Hourly Peak Activity Card */}
                <Card className="platform-chart-card" styles={{ body: { padding: '20px 24px' } }}>
                  <div className="platform-chart-header" style={{ marginBottom: 4 }}>
                    <div className="platform-chart-title">
                      <FireOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                      <span>Khung Giờ Hoạt Động Cao Điểm</span>
                    </div>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Tần suất giao dịch theo từng khung giờ trong ngày (0h - 23h)
                  </Typography.Text>
                  <HourlyPeakChart data={analytics.data.hourlyDistribution} />
                </Card>
              </div>

              {/* Top Selling Products / Services */}
              <Card className="platform-chart-card" styles={{ body: { padding: '20px 24px' } }}>
                <div className="platform-chart-header">
                  <div>
                    <div className="platform-chart-title">
                      <StarOutlined style={{ color: '#eab308', fontSize: 18 }} />
                      <span>Top 10 Mặt Hàng & Dịch Vụ Tiêu Thụ Nhiều Nhất</span>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      Các dịch vụ giờ chơi, đồ uống và món ăn mang lại doanh thu cao nhất trên toàn
                      hệ thống
                    </Typography.Text>
                  </div>
                </div>
                <TopProductsWidget products={analytics.data.topProducts} isMobile={isMobile} />
              </Card>
            </div>
          ) : null
        ) : (
          /* TAB 2: STORES MANAGEMENT TABLE */
          <Card className="platform-table-card" styles={{ body: { padding: '20px 24px' } }}>
            <div className="platform-toolbar">
              <div className="platform-toolbar-left">
                <Input
                  placeholder="Tìm theo tên cửa hàng hoặc ID..."
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="platform-search-input"
                  allowClear
                />
                <Radio.Group
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  buttonStyle="solid"
                  className="platform-status-filter"
                >
                  <Radio.Button value="ALL">Tất cả ({stats.total})</Radio.Button>
                  <Radio.Button value="ACTIVE">Hoạt động ({stats.active})</Radio.Button>
                  <Radio.Button value="LOCKED">Đã khóa ({stats.locked})</Radio.Button>
                </Radio.Group>
              </div>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-stores'] })}
                className="platform-store-refresh-btn"
              >
                Làm mới
              </Button>
            </div>

            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stores.isLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <Spin />
                  </div>
                ) : filteredStores.length === 0 ? (
                  <Empty
                    description="Không tìm thấy cửa hàng phù hợp."
                    style={{ margin: '20px 0' }}
                  />
                ) : (
                  filteredStores.map((store) => (
                    <div key={store.id} className="platform-mobile-store-card">
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <Typography.Text
                            strong
                            style={{
                              fontSize: 15,
                              color: '#0f172a',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {store.name}
                          </Typography.Text>
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}
                          >
                            <span className="platform-badge-id">ID: {store.id.slice(0, 8)}</span>
                            <Badge
                              status={store.status === 'ACTIVE' ? 'success' : 'error'}
                              text={
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: 12,
                                    color: store.status === 'ACTIVE' ? '#10b981' : '#ef4444',
                                  }}
                                >
                                  {store.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                                </span>
                              }
                            />
                          </div>
                        </div>
                        <Button
                          type="primary"
                          ghost
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => openStoreDetail(store.id)}
                          style={{ borderRadius: 6, fontWeight: 600, flexShrink: 0 }}
                        >
                          Chi tiết
                        </Button>
                      </div>

                      <div
                        style={{
                          background: '#f8fafc',
                          borderRadius: 8,
                          padding: '8px 10px',
                          marginBottom: 10,
                          fontSize: 12,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ color: '#64748b' }}>Realtime POS:</span>
                          <Button
                            size="small"
                            type={store.posRealtimeEnabled ? 'primary' : 'default'}
                            loading={submitting}
                            onClick={() => toggleRealtime(store)}
                            style={{
                              borderRadius: 6,
                              fontSize: 11.5,
                              height: 26,
                              padding: '0 8px',
                            }}
                          >
                            {store.posRealtimeEnabled ? 'Đang bật' : 'Đang tắt'}
                          </Button>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: '#64748b' }}>Ngày khởi tạo:</span>
                          <span style={{ color: '#334155', fontWeight: 500 }}>
                            {formatDateTime(store.createdAt)}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Popconfirm
                          title={
                            store.status === 'ACTIVE'
                              ? 'Khóa cửa hàng này?'
                              : 'Mở lại cửa hàng này?'
                          }
                          description={
                            store.status === 'ACTIVE'
                              ? 'Nhân viên và Owner sẽ không thể đăng nhập.'
                              : 'Cho phép cửa hàng hoạt động lại bình thường.'
                          }
                          okText="Xác nhận"
                          cancelText="Hủy"
                          onConfirm={() => changeStatus(store)}
                        >
                          <Button
                            size="small"
                            danger={store.status === 'ACTIVE'}
                            icon={store.status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                            style={{ borderRadius: 6, width: '100%' }}
                          >
                            {store.status === 'ACTIVE' ? 'Khóa' : 'Mở lại'}
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title={`Xóa vĩnh viễn cửa hàng "${store.name}"?`}
                          description="Hành động này sẽ XÓA SẠCH toàn bộ dữ liệu (đơn hàng, hóa đơn, thực đơn, nhân viên, thiết bị, báo cáo...) và KHÔNG THỂ KHÔI PHỤC."
                          okText="Xóa sạch"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deleteStore(store)}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            style={{ borderRadius: 6, width: '100%' }}
                            loading={submitting}
                          >
                            Xóa
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <Table
                rowKey="id"
                loading={stores.isLoading}
                dataSource={filteredStores}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                scroll={{ x: 720 }}
                columns={[
                  {
                    title: 'Tên cửa hàng',
                    dataIndex: 'name',
                    key: 'name',
                    render: (val: string, record: PlatformStoreSummary) => (
                      <div>
                        <Typography.Text strong style={{ fontSize: 15 }}>
                          {val}
                        </Typography.Text>
                        <div style={{ marginTop: 2 }}>
                          <span className="platform-badge-id">ID: {record.id.slice(0, 8)}...</span>
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: 'Trạng thái',
                    dataIndex: 'status',
                    key: 'status',
                    render: (status: 'ACTIVE' | 'LOCKED') => (
                      <Badge
                        status={status === 'ACTIVE' ? 'success' : 'error'}
                        text={
                          <span
                            style={{
                              fontWeight: 600,
                              color: status === 'ACTIVE' ? '#10b981' : '#ef4444',
                            }}
                          >
                            {status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
                          </span>
                        }
                      />
                    ),
                  },
                  {
                    title: 'Realtime POS',
                    dataIndex: 'posRealtimeEnabled',
                    key: 'posRealtimeEnabled',
                    render: (enabled: boolean, store: PlatformStoreSummary) => (
                      <Button
                        size="small"
                        type={enabled ? 'primary' : 'default'}
                        loading={submitting}
                        onClick={() => toggleRealtime(store)}
                        style={{ borderRadius: 6, fontSize: 12 }}
                      >
                        {enabled ? 'Đang bật' : 'Đang tắt'}
                      </Button>
                    ),
                  },
                  {
                    title: 'Ngày khởi tạo',
                    dataIndex: 'createdAt',
                    key: 'createdAt',
                    render: (val: number) => (
                      <span style={{ color: '#64748b', fontSize: 13 }}>{formatDateTime(val)}</span>
                    ),
                  },
                  {
                    title: 'Thao tác',
                    key: 'actions',
                    align: 'right',
                    render: (_, store: PlatformStoreSummary) => (
                      <Space size="small">
                        <Button
                          type="primary"
                          ghost
                          icon={<EyeOutlined />}
                          onClick={() => openStoreDetail(store.id)}
                          style={{ borderRadius: 6 }}
                        >
                          Chi tiết
                        </Button>
                        <Popconfirm
                          title={
                            store.status === 'ACTIVE'
                              ? 'Khóa cửa hàng này?'
                              : 'Mở lại cửa hàng này?'
                          }
                          description={
                            store.status === 'ACTIVE'
                              ? 'Nhân viên và Owner sẽ không thể đăng nhập.'
                              : 'Cho phép cửa hàng hoạt động lại bình thường.'
                          }
                          okText="Xác nhận"
                          cancelText="Hủy"
                          onConfirm={() => changeStatus(store)}
                        >
                          <Button
                            danger={store.status === 'ACTIVE'}
                            icon={store.status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                            style={{ borderRadius: 6 }}
                          >
                            {store.status === 'ACTIVE' ? 'Khóa' : 'Mở lại'}
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title={`Xóa vĩnh viễn cửa hàng "${store.name}"?`}
                          description="Hành động này sẽ XÓA SẠCH toàn bộ dữ liệu (đơn hàng, hóa đơn, thực đơn, nhân viên, thiết bị, báo cáo...) và KHÔNG THỂ KHÔI PHỤC."
                          okText="Xóa sạch"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deleteStore(store)}
                        >
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            style={{ borderRadius: 6 }}
                            loading={submitting}
                          >
                            Xóa
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        )}
      </main>

      {selectedStoreId ? (
        <main className="platform-store-detail-page">
          <div className="platform-store-detail-header">
            <div className="platform-store-detail-heading">
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={closeStoreDetail}
                className="platform-store-detail-back"
                aria-label="Quay lại danh sách cửa hàng"
              />
              <div className="platform-store-detail-icon">
                <ShopOutlined />
              </div>
              <div className="platform-store-detail-title">
                <Typography.Text type="secondary">Chi tiết cửa hàng</Typography.Text>
                <div>
                  <Typography.Title level={3}>
                    {detail?.store.name || 'Đang tải cửa hàng...'}
                  </Typography.Title>
                  {detail ? (
                    <Tag
                      color={detail.store.status === 'ACTIVE' ? 'success' : 'error'}
                      className="platform-store-detail-status"
                    >
                      {detail.store.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
                    </Tag>
                  ) : null}
                </div>
              </div>
            </div>
            {detail ? (
              <Space wrap size="small" className="platform-store-detail-actions">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: ['platform-store-detail', selectedStoreId],
                    })
                  }
                >
                  Tải lại
                </Button>
                <Button
                  danger={detail.store.status === 'ACTIVE'}
                  icon={detail.store.status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                  loading={submitting}
                  onClick={() => changeStatus(detail.store)}
                >
                  {detail.store.status === 'ACTIVE' ? 'Khóa' : 'Mở lại'}
                </Button>
                <Popconfirm
                  title={`Xóa vĩnh viễn cửa hàng "${detail.store.name}"?`}
                  description="Hành động này sẽ XÓA SẠCH toàn bộ dữ liệu và KHÔNG THỂ KHÔI PHỤC."
                  okText="Xóa sạch"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deleteStore(detail.store)}
                >
                  <Button danger icon={<DeleteOutlined />} loading={submitting}>
                    {isMobile ? 'Xóa' : 'Xóa cửa hàng'}
                  </Button>
                </Popconfirm>
              </Space>
            ) : null}
          </div>
          <div className="platform-store-detail-body">
            {storeDetail.isLoading ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, color: '#64748b', fontWeight: 500 }}>
                  Đang tải dữ liệu cửa hàng...
                </div>
              </div>
            ) : storeDetail.isError ? (
              <Result
                status="error"
                title="Không thể tải chi tiết cửa hàng"
                subTitle={readableError(storeDetail.error)}
                extra={
                  <Space wrap>
                    <Button onClick={closeStoreDetail}>Quay lại danh sách</Button>
                    <Button type="primary" onClick={() => void storeDetail.refetch()}>
                      Thử lại
                    </Button>
                  </Space>
                }
              />
            ) : detail ? (
              <Tabs
                activeKey={activeDetailTab}
                onChange={setActiveDetailTab}
                items={[
                  {
                    key: 'overview',
                    label: (
                      <span>
                        <InfoCircleOutlined /> {isMobile ? 'Tổng quan' : 'Tổng quan & Cài đặt'}
                      </span>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <Card size="small" title="Thông tin định danh" className="detail-card">
                          <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                            <Descriptions.Item label="Mã ID (UUID)">
                              <Typography.Text copyable code>
                                {detail.store.id}
                              </Typography.Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="Tên cửa hàng">
                              <strong>{detail.store.name}</strong>
                            </Descriptions.Item>
                            <Descriptions.Item label="Trạng thái">
                              <Badge
                                status={detail.store.status === 'ACTIVE' ? 'success' : 'error'}
                                text={
                                  detail.store.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'
                                }
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="Múi giờ">
                              {detail.store.timezone}
                            </Descriptions.Item>
                            <Descriptions.Item label="Ngày khởi tạo">
                              {formatDateTime(detail.store.createdAt)}
                            </Descriptions.Item>
                            <Descriptions.Item label="Cập nhật gần nhất">
                              {formatDateTime(detail.store.updatedAt)}
                            </Descriptions.Item>
                          </Descriptions>
                        </Card>

                        <Card size="small" title="Địa chỉ & Liên hệ" className="detail-card">
                          <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                            <Descriptions.Item label="Số điện thoại">
                              {detail.store.settings?.phone ? (
                                <Typography.Text strong>
                                  {detail.store.settings.phone}
                                </Typography.Text>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>Chưa cập nhật</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Tiền tệ">
                              <Tag color="blue">{detail.store.settings?.currency || 'VND'}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Địa chỉ chi tiết" span={2}>
                              {detail.store.settings?.address || (
                                <span style={{ color: '#94a3b8' }}>Chưa cập nhật</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Phường / Xã">
                              {detail.store.settings?.wardName || (
                                <span style={{ color: '#94a3b8' }}>Chưa cập nhật</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Tỉnh / Thành phố">
                              {detail.store.settings?.provinceName || (
                                <span style={{ color: '#94a3b8' }}>Chưa cập nhật</span>
                              )}
                            </Descriptions.Item>
                          </Descriptions>
                        </Card>

                        <Card
                          size="small"
                          title="Thanh toán VietQR & Vận hành"
                          className="detail-card"
                        >
                          <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                            <Descriptions.Item label="Ngân hàng">
                              {detail.store.settings?.bankName || (
                                <span style={{ color: '#94a3b8' }}>Chưa cấu hình</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Số tài khoản">
                              {detail.store.settings?.bankAccountNumber ? (
                                <Typography.Text copyable strong>
                                  {detail.store.settings.bankAccountNumber}
                                </Typography.Text>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>Chưa cấu hình</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Chủ tài khoản">
                              {detail.store.settings?.bankAccountName || (
                                <span style={{ color: '#94a3b8' }}>Chưa cấu hình</span>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Giờ chốt ca / ngày">
                              {detail.store.settings?.businessDayCutoffMinutes !== undefined
                                ? `${Math.floor(detail.store.settings.businessDayCutoffMinutes / 60)}:00`
                                : '0:00'}
                            </Descriptions.Item>
                          </Descriptions>
                        </Card>

                        <Card size="small" title="Tính năng nền tảng" className="detail-card">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <strong>Realtime POS (Đồng bộ bàn & đơn hàng trực tiếp)</strong>
                              <div style={{ color: '#64748b', fontSize: 13 }}>
                                Dùng Cloudflare Durable Objects để đồng bộ tức thì giữa thu ngân và
                                nhân viên quầy.
                              </div>
                            </div>
                            <Button
                              type={detail.store.posRealtimeEnabled ? 'primary' : 'default'}
                              loading={submitting}
                              onClick={() => toggleRealtime(detail.store)}
                            >
                              {detail.store.posRealtimeEnabled ? 'Đang bật' : 'Đang tắt'}
                            </Button>
                          </div>
                        </Card>
                      </div>
                    ),
                  },
                  {
                    key: 'members',
                    label: (
                      <span>
                        <TeamOutlined />{' '}
                        {isMobile
                          ? `Nhân sự (${detail.members.length})`
                          : `Tài khoản & Nhân sự (${detail.members.length})`}
                      </span>
                    ),
                    children: (
                      <div>
                        <div style={{ marginBottom: 14, color: '#64748b', fontSize: 13 }}>
                          Danh sách tài khoản Chủ quán và Nhân sự. Bấm vào{' '}
                          <strong>Lịch sử thiết bị</strong> để xem chi tiết tất cả các lần đăng
                          nhập, thiết bị sử dụng và trạng thái phiên làm việc.
                        </div>
                        {isMobile ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {detail.members.map((m) => {
                              const userSessions = detail.sessions.filter(
                                (s) => s.userId === m.userId,
                              );
                              const onlineSessions = userSessions.filter(
                                (s) =>
                                  s.isOnline ||
                                  (s.status === 'ACTIVE' &&
                                    Date.now() < s.expiresAt &&
                                    Date.now() - s.lastSeenAt <= 5 * 60_000),
                              );
                              const isOnline = onlineSessions.length > 0;

                              return (
                                <div key={m.id} className="platform-mobile-member-card">
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                      marginBottom: 8,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        minWidth: 0,
                                      }}
                                    >
                                      <Avatar
                                        size={36}
                                        style={{
                                          background:
                                            m.roleCode === 'OWNER' ? '#f59e0b' : '#3b82f6',
                                          fontWeight: 700,
                                          flexShrink: 0,
                                        }}
                                      >
                                        {getInitials(m.displayName)}
                                      </Avatar>
                                      <div style={{ minWidth: 0 }}>
                                        <Typography.Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {m.displayName}
                                        </Typography.Text>
                                        <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                          @{m.username}{' '}
                                          {m.roleCode === 'OWNER' ? (
                                            <Tag
                                              color="gold"
                                              style={{ borderRadius: 4, margin: 0, fontSize: 10 }}
                                            >
                                              Chủ quán
                                            </Tag>
                                          ) : (
                                            <Tag
                                              color="blue"
                                              style={{ borderRadius: 4, margin: 0, fontSize: 10 }}
                                            >
                                              {m.roleName}
                                            </Tag>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <Badge
                                      status={m.userStatus === 'ACTIVE' ? 'success' : 'default'}
                                      text={
                                        <span style={{ fontSize: 11.5, fontWeight: 500 }}>
                                          {m.userStatus === 'ACTIVE' ? 'Hoạt động' : 'Khóa'}
                                        </span>
                                      }
                                    />
                                  </div>

                                  <div
                                    style={{
                                      background: '#f8fafc',
                                      borderRadius: 8,
                                      padding: '8px 10px',
                                      marginBottom: 8,
                                      fontSize: 12,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        marginBottom: 4,
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Liên hệ:</span>
                                      <span style={{ color: '#334155', fontWeight: 500 }}>
                                        {m.phone || m.email || 'Chưa có'}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Phiên làm việc:</span>
                                      {isOnline ? (
                                        <Tag
                                          color="success"
                                          style={{ margin: 0, fontSize: 11, fontWeight: 600 }}
                                        >
                                          🟢 Online ({onlineSessions[0]?.deviceName || 'Máy POS'})
                                        </Tag>
                                      ) : userSessions.length > 0 ? (
                                        <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                                          ⚪ Ngoại tuyến ({userSessions.length} phiên)
                                        </Tag>
                                      ) : (
                                        <span style={{ color: '#94a3b8' }}>Chưa đăng nhập</span>
                                      )}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '1.2fr 1fr 1fr',
                                      gap: 6,
                                    }}
                                  >
                                    <Button
                                      size="small"
                                      type="primary"
                                      ghost
                                      icon={<HistoryOutlined />}
                                      onClick={() => {
                                        setSelectedMemberForHistory(m);
                                        setMemberHistoryFilter('ALL');
                                      }}
                                      style={{ borderRadius: 6, fontSize: 11.5 }}
                                    >
                                      Lịch sử
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<EditOutlined />}
                                      onClick={() => handleEditMember(m)}
                                      style={{ borderRadius: 6, fontSize: 11.5 }}
                                    >
                                      Sửa
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<KeyOutlined />}
                                      onClick={() => handleResetPassword(m)}
                                      style={{ borderRadius: 6, fontSize: 11.5 }}
                                    >
                                      Đổi MK
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <Table
                            rowKey="id"
                            size="middle"
                            dataSource={detail.members}
                            pagination={false}
                            scroll={{ x: 720 }}
                            columns={[
                              {
                                title: 'Tài khoản',
                                key: 'user',
                                render: (_, m) => (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <Avatar
                                      size={38}
                                      style={{
                                        background: m.roleCode === 'OWNER' ? '#f59e0b' : '#3b82f6',
                                        fontWeight: 700,
                                      }}
                                    >
                                      {getInitials(m.displayName)}
                                    </Avatar>
                                    <div>
                                      <Typography.Text strong style={{ fontSize: 14 }}>
                                        {m.displayName}
                                      </Typography.Text>
                                      <div style={{ fontSize: 12, color: '#64748b' }}>
                                        @{m.username}{' '}
                                        {m.roleCode === 'OWNER' ? (
                                          <Tag color="gold" style={{ borderRadius: 4 }}>
                                            Chủ cửa hàng
                                          </Tag>
                                        ) : (
                                          <Tag color="blue" style={{ borderRadius: 4 }}>
                                            {m.roleName}
                                          </Tag>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ),
                              },
                              {
                                title: 'Email / SĐT',
                                key: 'contact',
                                render: (_, m) => (
                                  <div style={{ fontSize: 13 }}>
                                    {m.email ? (
                                      <div
                                        style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                      >
                                        <MailOutlined style={{ color: '#94a3b8' }} />
                                        <span>{m.email}</span>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>Chưa có email</span>
                                    )}
                                    {m.phone ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 4,
                                          marginTop: 2,
                                        }}
                                      >
                                        <PhoneOutlined style={{ color: '#94a3b8' }} />
                                        <span style={{ color: '#64748b' }}>{m.phone}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                ),
                              },
                              {
                                title: 'Trạng thái',
                                key: 'status',
                                render: (_, m) => (
                                  <Badge
                                    status={m.userStatus === 'ACTIVE' ? 'success' : 'default'}
                                    text={m.userStatus === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                                  />
                                ),
                              },
                              {
                                title: 'Thiết bị & Phiên',
                                key: 'deviceSummary',
                                render: (_, m) => {
                                  const userSessions = detail.sessions.filter(
                                    (s) => s.userId === m.userId,
                                  );
                                  const onlineSessions = userSessions.filter(
                                    (s) =>
                                      s.isOnline ||
                                      (s.status === 'ACTIVE' &&
                                        Date.now() < s.expiresAt &&
                                        Date.now() - s.lastSeenAt <= 5 * 60_000),
                                  );
                                  const activeNonOnlineSessions = userSessions.filter(
                                    (s) =>
                                      s.status === 'ACTIVE' &&
                                      Date.now() < s.expiresAt &&
                                      !onlineSessions.some((os) => os.id === s.id),
                                  );

                                  if (onlineSessions.length > 0) {
                                    const devName =
                                      onlineSessions[0]?.deviceName ||
                                      (onlineSessions[0]?.deviceId
                                        ? `Máy ${onlineSessions[0].deviceId.slice(0, 8)}`
                                        : 'Web Session');
                                    return (
                                      <div>
                                        <Tag
                                          color="success"
                                          style={{
                                            borderRadius: 6,
                                            fontWeight: 600,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                          }}
                                        >
                                          <Badge status="processing" color="#10b981" />
                                          🟢 Online: {devName}
                                          {onlineSessions.length > 1
                                            ? ` (+${onlineSessions.length - 1} máy)`
                                            : ''}
                                        </Tag>
                                        <div
                                          style={{ fontSize: 11, color: '#10b981', marginTop: 3 }}
                                        >
                                          Vừa hoạt động:{' '}
                                          {formatRelativeTime(onlineSessions[0]?.lastSeenAt)}
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (activeNonOnlineSessions.length > 0) {
                                    const devName =
                                      activeNonOnlineSessions[0]?.deviceName ||
                                      (activeNonOnlineSessions[0]?.deviceId
                                        ? `Máy ${activeNonOnlineSessions[0].deviceId.slice(0, 8)}`
                                        : 'Web Session');
                                    return (
                                      <div>
                                        <Tag
                                          color="default"
                                          style={{
                                            borderRadius: 6,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            color: '#64748b',
                                            background: '#f1f5f9',
                                          }}
                                        >
                                          ⚪ Ngoại tuyến ({devName})
                                        </Tag>
                                        <div
                                          style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}
                                        >
                                          Lần cuối:{' '}
                                          {formatRelativeTime(
                                            activeNonOnlineSessions[0]?.lastSeenAt,
                                          )}
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div>
                                      <Tag
                                        color="default"
                                        style={{ borderRadius: 6, color: '#94a3b8' }}
                                      >
                                        {userSessions.length > 0
                                          ? `${userSessions.length} lịch sử phiên`
                                          : 'Chưa đăng nhập'}
                                      </Tag>
                                      {userSessions.length > 0 && userSessions[0] ? (
                                        <div
                                          style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}
                                        >
                                          Trước đây:{' '}
                                          {formatRelativeTime(
                                            userSessions[0].lastSeenAt || userSessions[0].createdAt,
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                },
                              },
                              {
                                title: 'Thao tác',
                                key: 'actions',
                                align: 'right',
                                render: (_, m) => (
                                  <Space size="small">
                                    <Button
                                      size="small"
                                      type="primary"
                                      ghost
                                      icon={<HistoryOutlined />}
                                      onClick={() => {
                                        setSelectedMemberForHistory(m);
                                        setMemberHistoryFilter('ALL');
                                      }}
                                    >
                                      Lịch sử thiết bị
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<EditOutlined />}
                                      onClick={() => handleEditMember(m)}
                                    >
                                      Sửa
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<KeyOutlined />}
                                      onClick={() => handleResetPassword(m)}
                                    >
                                      Đổi MK
                                    </Button>
                                  </Space>
                                ),
                              },
                            ]}
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'devices',
                    label: (
                      <span>
                        <MobileOutlined /> Thiết bị POS ({detail.devices.length})
                        {detail.devices.filter((d) => d.isOnline).length > 0 && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              marginLeft: 8,
                              padding: '1px 8px',
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: '#ecfdf5',
                              color: '#059669',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            <span className="platform-pulse-dot" style={{ width: 6, height: 6 }} />
                            {detail.devices.filter((d) => d.isOnline).length} Online
                          </span>
                        )}
                      </span>
                    ),
                    children: (
                      <div>
                        {/* Telemetry Summary Banner */}
                        <div className="platform-telemetry-banner">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              flexWrap: 'wrap',
                              gap: 12,
                              marginBottom: 14,
                            }}
                          >
                            <div>
                              <Typography.Text strong style={{ fontSize: 14.5 }}>
                                Trạng thái kết nối thiết bị POS tại cửa hàng
                              </Typography.Text>
                              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                Hệ thống xác định trực tuyến qua tín hiệu heartbeat 5 phút gần nhất.
                                Khi nhân viên đăng nhập mới, phiên cũ trên cùng máy sẽ tự động thu
                                hồi.
                              </div>
                            </div>
                            <Tag
                              color="blue"
                              style={{ margin: 0, padding: '2px 8px', fontSize: 12 }}
                            >
                              Chính sách: 1 phiên đăng nhập / 1 máy POS
                            </Tag>
                          </div>

                          <div className="platform-telemetry-stats">
                            <div className="platform-telemetry-stat-box">
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: '#eff6ff',
                                  color: '#2563eb',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                <MobileOutlined />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#64748b',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                  }}
                                >
                                  Tổng máy POS
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                                  {detail.devices.length}
                                </div>
                              </div>
                            </div>

                            <div className="platform-telemetry-stat-box platform-telemetry-stat-box--online">
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: '#d1fae5',
                                  color: '#059669',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                <CheckCircleOutlined />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#047857',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                  }}
                                >
                                  Đang trực tuyến
                                </div>
                                <div
                                  style={{
                                    fontSize: 18,
                                    fontWeight: 800,
                                    color: '#065f46',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  <span className="platform-pulse-dot" />
                                  {detail.devices.filter((d) => d.isOnline).length} máy
                                </div>
                              </div>
                            </div>

                            <div className="platform-telemetry-stat-box platform-telemetry-stat-box--offline">
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: '#f1f5f9',
                                  color: '#64748b',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                <StopOutlined />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#64748b',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                  }}
                                >
                                  Ngoại tuyến
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#334155' }}>
                                  {
                                    detail.devices.filter(
                                      (d) => d.status === 'ACTIVE' && !d.isOnline,
                                    ).length
                                  }{' '}
                                  máy
                                </div>
                              </div>
                            </div>

                            <div className="platform-telemetry-stat-box">
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: '#fef2f2',
                                  color: '#ef4444',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                <StopOutlined />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#991b1b',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                  }}
                                >
                                  Đã thu hồi
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#b91c1c' }}>
                                  {detail.devices.filter((d) => d.status === 'REVOKED').length} máy
                                </div>
                              </div>
                            </div>

                            <div className="platform-telemetry-stat-box">
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  background: '#eff6ff',
                                  color: '#2563eb',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                              >
                                <BellOutlined />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#1d4ed8',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                  }}
                                >
                                  Bật thông báo
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#1e40af' }}>
                                  {detail.devices.filter((d) => d.pushNotificationEnabled).length}{' '}
                                  máy
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {detail.devices.length === 0 ? (
                          <Empty description="Chưa có thiết bị POS nào được kích hoạt." />
                        ) : isMobile ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {detail.devices.map((d) => {
                              const count =
                                d.sessionCount ??
                                detail.sessions.filter((s) => s.deviceId === d.id).length;
                              const cardModifier = d.isOnline
                                ? 'platform-mobile-device-card--online'
                                : d.status === 'ACTIVE'
                                  ? 'platform-mobile-device-card--offline'
                                  : 'platform-mobile-device-card--revoked';

                              return (
                                <div
                                  key={d.id}
                                  className={`platform-mobile-device-card ${cardModifier}`}
                                >
                                  {/* Header: Name and Status */}
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                      marginBottom: 8,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        minWidth: 0,
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 34,
                                          height: 34,
                                          borderRadius: 8,
                                          background: d.isOnline ? '#ecfdf5' : '#f1f5f9',
                                          color: d.isOnline ? '#059669' : '#64748b',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          flexShrink: 0,
                                          position: 'relative',
                                        }}
                                      >
                                        <MobileOutlined style={{ fontSize: 17 }} />
                                        {d.isOnline && (
                                          <span
                                            className="platform-pulse-dot"
                                            style={{
                                              position: 'absolute',
                                              top: -2,
                                              right: -2,
                                              width: 8,
                                              height: 8,
                                            }}
                                          />
                                        )}
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <Typography.Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {d.name || 'Thiết bị POS'}
                                        </Typography.Text>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                          ID: <code>{d.id}</code>
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ flexShrink: 0 }}>
                                      {d.isOnline ? (
                                        <Tag
                                          color="success"
                                          style={{ fontSize: 11, margin: 0, fontWeight: 600 }}
                                        >
                                          🟢 Trực tuyến
                                        </Tag>
                                      ) : d.status === 'ACTIVE' ? (
                                        <Tag color="default" style={{ fontSize: 11, margin: 0 }}>
                                          ⚪ Ngoại tuyến
                                        </Tag>
                                      ) : (
                                        <Tag color="error" style={{ fontSize: 11, margin: 0 }}>
                                          🔴 Đã thu hồi
                                        </Tag>
                                      )}
                                    </div>
                                  </div>

                                  {/* Info Box */}
                                  <div
                                    style={{
                                      background: '#f8fafc',
                                      borderRadius: 8,
                                      padding: '8px 10px',
                                      marginBottom: 10,
                                      fontSize: 12,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 5,
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Nhân sự đăng nhập:</span>
                                      {d.currentSession ? (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 5,
                                            maxWidth: '60%',
                                          }}
                                        >
                                          <Avatar
                                            size={20}
                                            style={{
                                              background: d.isOnline ? '#10b981' : '#3b82f6',
                                              fontSize: 10,
                                              fontWeight: 700,
                                              flexShrink: 0,
                                            }}
                                          >
                                            {getInitials(d.currentSession.userName)}
                                          </Avatar>
                                          <Typography.Text
                                            strong
                                            style={{
                                              fontSize: 12,
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {d.currentSession.userName}
                                          </Typography.Text>
                                        </div>
                                      ) : (
                                        <span style={{ color: '#94a3b8', fontSize: 11.5 }}>
                                          Chưa có
                                        </span>
                                      )}
                                    </div>

                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 5,
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Thông báo PWA:</span>
                                      {d.pushNotificationEnabled ? (
                                        <Tag
                                          color="success"
                                          icon={<BellOutlined />}
                                          style={{
                                            borderRadius: 6,
                                            fontWeight: 500,
                                            margin: 0,
                                            fontSize: 11,
                                          }}
                                        >
                                          Đã bật
                                        </Tag>
                                      ) : (
                                        <Tag
                                          color="default"
                                          style={{
                                            borderRadius: 6,
                                            color: '#94a3b8',
                                            margin: 0,
                                            fontSize: 11,
                                          }}
                                        >
                                          Chưa bật
                                        </Tag>
                                      )}
                                    </div>

                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 5,
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Hoạt động cuối:</span>
                                      <span
                                        style={{
                                          color: d.isOnline ? '#059669' : '#334155',
                                          fontWeight: d.isOnline ? 600 : 400,
                                          fontSize: 11.5,
                                        }}
                                      >
                                        {d.isOnline
                                          ? '🟢 Đang kết nối'
                                          : formatRelativeTime(d.lastSeenAt)}
                                      </span>
                                    </div>

                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span style={{ color: '#64748b' }}>Lượt phiên:</span>
                                      <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                                        {count} lượt
                                      </Tag>
                                    </div>
                                  </div>

                                  {/* Request push notification prominent button */}
                                  {d.status === 'ACTIVE' && !d.pushNotificationEnabled && (
                                    <Button
                                      block
                                      icon={<BellOutlined />}
                                      loading={requestingPushDeviceId === d.id}
                                      style={{
                                        color: '#2563eb',
                                        borderColor: '#93c5fd',
                                        background: '#eff6ff',
                                        fontWeight: 600,
                                        marginBottom: 8,
                                        height: 34,
                                      }}
                                      onClick={() => void handleRequestPushPrompt(d.id, d.name)}
                                    >
                                      Yêu cầu bật thông báo
                                    </Button>
                                  )}

                                  {/* Action Buttons */}
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: 6,
                                      justifyContent: 'flex-end',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    {d.currentSession && d.status === 'ACTIVE' && (
                                      <Popconfirm
                                        title="Đăng xuất khỏi thiết bị này?"
                                        description="Nhân viên sẽ bị đăng xuất khỏi ứng dụng POS và phải nhập lại PIN."
                                        okText="Đăng xuất"
                                        cancelText="Hủy"
                                        okButtonProps={{ danger: true, loading: submitting }}
                                        onConfirm={() => handleRevokeSession(d.currentSession!.id)}
                                      >
                                        <Button
                                          size="small"
                                          danger
                                          ghost
                                          icon={<LogoutOutlined />}
                                          style={{ flex: 1, minWidth: 80 }}
                                        >
                                          Đăng xuất
                                        </Button>
                                      </Popconfirm>
                                    )}
                                    <Button
                                      size="small"
                                      icon={<HistoryOutlined />}
                                      style={{ flex: 1, minWidth: 70 }}
                                      onClick={() => {
                                        setActiveDetailTab('sessions');
                                        setSessionViewMode('HISTORY');
                                        setSelectedDeviceFilter(d.id);
                                      }}
                                    >
                                      Lịch sử
                                    </Button>
                                    {d.status === 'ACTIVE' ? (
                                      <Popconfirm
                                        title="Thu hồi máy POS này?"
                                        description="Thiết bị sẽ bị ngắt kết nối và tất cả phiên đăng nhập trên máy sẽ bị hủy."
                                        okText="Thu hồi"
                                        cancelText="Hủy"
                                        okButtonProps={{ danger: true, loading: submitting }}
                                        onConfirm={() => handleRevokeDevice(d.id)}
                                      >
                                        <Button
                                          size="small"
                                          danger
                                          icon={<StopOutlined />}
                                          style={{ flex: 1, minWidth: 70 }}
                                        >
                                          Thu hồi
                                        </Button>
                                      </Popconfirm>
                                    ) : (
                                      <Tag
                                        color="default"
                                        style={{ alignSelf: 'center', margin: 0 }}
                                      >
                                        Đã thu hồi
                                      </Tag>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <Table
                            rowKey="id"
                            size="small"
                            dataSource={detail.devices}
                            pagination={false}
                            scroll={{ x: 780 }}
                            columns={[
                              {
                                title: 'Thiết bị POS',
                                key: 'name',
                                render: (_, d) => (
                                  <div className="platform-device-name">
                                    <div
                                      className="platform-device-name__icon"
                                      style={{
                                        background: d.isOnline ? '#ecfdf5' : '#f1f5f9',
                                        color: d.isOnline ? '#059669' : '#64748b',
                                        position: 'relative',
                                      }}
                                    >
                                      <MobileOutlined style={{ fontSize: 18 }} />
                                      {d.isOnline && (
                                        <span
                                          className="platform-pulse-dot"
                                          style={{
                                            position: 'absolute',
                                            top: -2,
                                            right: -2,
                                            width: 8,
                                            height: 8,
                                          }}
                                        />
                                      )}
                                    </div>
                                    <div>
                                      <div
                                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                      >
                                        <Typography.Text strong>
                                          {d.name || 'Thiết bị POS'}
                                        </Typography.Text>
                                        {d.isOnline ? (
                                          <Tag color="success" style={{ fontSize: 11, margin: 0 }}>
                                            🟢 Trực tuyến
                                          </Tag>
                                        ) : d.status === 'ACTIVE' ? (
                                          <Tag color="default" style={{ fontSize: 11, margin: 0 }}>
                                            ⚪ Ngoại tuyến
                                          </Tag>
                                        ) : (
                                          <Tag color="error" style={{ fontSize: 11, margin: 0 }}>
                                            🔴 Đã thu hồi
                                          </Tag>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                        ID: <code>{d.id}</code>
                                      </div>
                                    </div>
                                  </div>
                                ),
                              },
                              {
                                title: 'Nhân sự đang đăng nhập',
                                key: 'currentStaff',
                                render: (_, d) => {
                                  if (d.currentSession) {
                                    return (
                                      <div>
                                        <div
                                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                        >
                                          <Avatar
                                            size={22}
                                            style={{
                                              background: d.isOnline ? '#10b981' : '#3b82f6',
                                              fontSize: 11,
                                              fontWeight: 700,
                                            }}
                                          >
                                            {getInitials(d.currentSession.userName)}
                                          </Avatar>
                                          <Typography.Text strong>
                                            {d.currentSession.userName}
                                          </Typography.Text>
                                          <Tag
                                            color="blue"
                                            style={{ fontSize: 10, margin: 0, padding: '0 4px' }}
                                          >
                                            {d.currentSession.userRoleName}
                                          </Tag>
                                        </div>
                                        <div
                                          style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}
                                        >
                                          @{d.currentSession.userUsername} · Vào lúc{' '}
                                          {formatRelativeTime(d.currentSession.createdAt)}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                                      Chưa có nhân sự đăng nhập
                                    </span>
                                  );
                                },
                              },
                              {
                                title: 'Thông báo PWA',
                                key: 'pushNotification',
                                render: (_, d) => {
                                  if (d.pushNotificationEnabled) {
                                    return (
                                      <Tooltip title="Thiết bị đã bật thông báo đẩy khi thanh toán thành công và có đơn mới">
                                        <Tag
                                          color="success"
                                          icon={<BellOutlined />}
                                          style={{ borderRadius: 6, fontWeight: 500, margin: 0 }}
                                        >
                                          Đã bật
                                        </Tag>
                                      </Tooltip>
                                    );
                                  }
                                  return (
                                    <Tooltip title="Thiết bị chưa cấp quyền hoặc đã tắt thông báo trong Cài đặt">
                                      <Tag
                                        color="default"
                                        style={{ borderRadius: 6, color: '#94a3b8', margin: 0 }}
                                      >
                                        Chưa bật
                                      </Tag>
                                    </Tooltip>
                                  );
                                },
                              },
                              {
                                title: 'Hoạt động gần nhất',
                                dataIndex: 'lastSeenAt',
                                key: 'lastSeenAt',
                                render: (val: number | null, d) => (
                                  <div>
                                    <div>{formatDateTime(val)}</div>
                                    {d.isOnline ? (
                                      <div
                                        style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}
                                      >
                                        🟢 Đang kết nối
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 11, color: '#64748b' }}>
                                        {formatRelativeTime(val)}
                                      </div>
                                    )}
                                  </div>
                                ),
                              },
                              {
                                title: 'Lượt phiên',
                                key: 'sessionCount',
                                render: (_, d) => {
                                  const count =
                                    d.sessionCount ??
                                    detail.sessions.filter((s) => s.deviceId === d.id).length;
                                  return (
                                    <Tooltip
                                      title={`Đã có ${count} lượt đăng nhập được ghi nhận trên máy này`}
                                    >
                                      <Tag color="purple" style={{ cursor: 'pointer' }}>
                                        {count} lượt
                                      </Tag>
                                    </Tooltip>
                                  );
                                },
                              },
                              {
                                title: 'Kích hoạt bởi',
                                key: 'activatedInfo',
                                render: (_, d) => (
                                  <div style={{ fontSize: 12 }}>
                                    <div>{d.activatedByName || '—'}</div>
                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                      {formatDateTime(d.activatedAt)}
                                    </div>
                                  </div>
                                ),
                              },
                              {
                                title: 'Thao tác',
                                key: 'actions',
                                align: 'right',
                                render: (_, d) => (
                                  <Space size="small">
                                    {d.status === 'ACTIVE' && !d.pushNotificationEnabled && (
                                      <Tooltip title="Gửi tín hiệu mở popup yêu cầu nhân viên trên máy này bật thông báo PWA">
                                        <Button
                                          size="small"
                                          icon={<BellOutlined />}
                                          loading={requestingPushDeviceId === d.id}
                                          style={{
                                            color: '#2563eb',
                                            borderColor: '#93c5fd',
                                            background: '#eff6ff',
                                          }}
                                          onClick={() => void handleRequestPushPrompt(d.id, d.name)}
                                        >
                                          Yêu cầu bật thông báo
                                        </Button>
                                      </Tooltip>
                                    )}
                                    {d.currentSession && d.status === 'ACTIVE' && (
                                      <Popconfirm
                                        title="Đăng xuất khỏi thiết bị này?"
                                        description="Nhân viên sẽ bị đăng xuất khỏi ứng dụng POS và phải nhập lại PIN."
                                        okText="Đăng xuất"
                                        cancelText="Hủy"
                                        okButtonProps={{ danger: true, loading: submitting }}
                                        onConfirm={() => handleRevokeSession(d.currentSession!.id)}
                                      >
                                        <Button size="small" danger ghost icon={<LogoutOutlined />}>
                                          Đăng xuất
                                        </Button>
                                      </Popconfirm>
                                    )}
                                    <Button
                                      size="small"
                                      icon={<HistoryOutlined />}
                                      onClick={() => {
                                        setActiveDetailTab('sessions');
                                        setSessionViewMode('HISTORY');
                                        setSelectedDeviceFilter(d.id);
                                      }}
                                    >
                                      Lịch sử
                                    </Button>
                                    {d.status === 'ACTIVE' ? (
                                      <Popconfirm
                                        title="Thu hồi máy POS này?"
                                        description="Thiết bị sẽ bị ngắt kết nối và tất cả phiên đăng nhập trên máy sẽ bị hủy."
                                        okText="Thu hồi"
                                        cancelText="Hủy"
                                        okButtonProps={{ danger: true, loading: submitting }}
                                        onConfirm={() => handleRevokeDevice(d.id)}
                                      >
                                        <Button size="small" danger icon={<StopOutlined />}>
                                          Thu hồi
                                        </Button>
                                      </Popconfirm>
                                    ) : (
                                      <Tag color="default">Đã thu hồi</Tag>
                                    )}
                                  </Space>
                                ),
                              },
                            ]}
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'sessions',
                    label: (
                      <span>
                        <ClockCircleOutlined />{' '}
                        {isMobile
                          ? `Phiên (${detail.sessions.length})`
                          : `Lịch sử đăng nhập (${detail.sessions.length})`}
                        {detail.sessions.filter((s) => s.isOnline).length > 0 && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              marginLeft: isMobile ? 4 : 8,
                              padding: isMobile ? '0 5px' : '1px 8px',
                              borderRadius: 12,
                              fontSize: isMobile ? 10 : 11,
                              fontWeight: 700,
                              background: '#ecfdf5',
                              color: '#059669',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            <span className="platform-pulse-dot" style={{ width: 5, height: 5 }} />
                            {detail.sessions.filter((s) => s.isOnline).length} Online
                          </span>
                        )}
                      </span>
                    ),
                    children: (() => {
                      const onlineSessions = detail.sessions.filter((s) => s.isOnline);
                      const offlineActiveSessions = detail.sessions.filter(
                        (s) => s.status === 'ACTIVE' && Date.now() < s.expiresAt && !s.isOnline,
                      );
                      const revokedSessions = detail.sessions.filter((s) => s.status === 'REVOKED');
                      const expiredSessions = detail.sessions.filter(
                        (s) =>
                          s.status === 'EXPIRED' ||
                          (s.status === 'ACTIVE' && Date.now() >= s.expiresAt),
                      );

                      const filtered = detail.sessions.filter((s) => {
                        // Presence filter
                        if (sessionPresenceFilter === 'ONLINE' && !s.isOnline) return false;
                        if (
                          sessionPresenceFilter === 'OFFLINE' &&
                          !(s.status === 'ACTIVE' && Date.now() < s.expiresAt && !s.isOnline)
                        )
                          return false;
                        if (sessionPresenceFilter === 'REVOKED' && s.status !== 'REVOKED')
                          return false;
                        if (
                          sessionPresenceFilter === 'EXPIRED' &&
                          !(
                            s.status === 'EXPIRED' ||
                            (s.status === 'ACTIVE' && Date.now() >= s.expiresAt)
                          )
                        )
                          return false;

                        // Device filter
                        if (selectedDeviceFilter !== 'ALL') {
                          if (selectedDeviceFilter === 'WEB' && s.deviceId) return false;
                          if (selectedDeviceFilter !== 'WEB' && s.deviceId !== selectedDeviceFilter)
                            return false;
                        }

                        // Search filter
                        const term = sessionSearchTerm.trim().toLowerCase();
                        if (!term) return true;
                        return (
                          s.userName.toLowerCase().includes(term) ||
                          s.userUsername.toLowerCase().includes(term) ||
                          (s.deviceName && s.deviceName.toLowerCase().includes(term)) ||
                          (s.deviceId && s.deviceId.toLowerCase().includes(term))
                        );
                      });

                      return (
                        <div>
                          {/* Banner giải thích & KPI telemetry */}
                          <div className="platform-telemetry-banner">
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                flexWrap: 'wrap',
                                gap: 12,
                                marginBottom: 14,
                              }}
                            >
                              <div>
                                <Typography.Text strong style={{ fontSize: 14.5 }}>
                                  Quản lý phiên làm việc & Kiểm soát trực tuyến
                                </Typography.Text>
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                  Cửa hàng có <strong>{detail.devices.length} máy POS</strong> vật
                                  lý với tổng cộng{' '}
                                  <strong>{detail.sessions.length} lượt đăng nhập</strong> trong
                                  lịch sử. Mỗi thiết bị chỉ duy trì 1 phiên hoạt động duy nhất.
                                </div>
                              </div>
                              <Segmented
                                value={sessionViewMode}
                                onChange={(val) => setSessionViewMode(val as 'DEVICES' | 'HISTORY')}
                                options={[
                                  {
                                    label: (
                                      <span>
                                        <MobileOutlined /> Theo thiết bị ({detail.devices.length})
                                      </span>
                                    ),
                                    value: 'DEVICES',
                                  },
                                  {
                                    label: (
                                      <span>
                                        <HistoryOutlined /> Lịch sử chi tiết (
                                        {detail.sessions.length})
                                      </span>
                                    ),
                                    value: 'HISTORY',
                                  },
                                ]}
                              />
                            </div>

                            <div className="platform-telemetry-stats">
                              <div
                                className="platform-telemetry-stat-box platform-telemetry-stat-box--online"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  setSessionViewMode('HISTORY');
                                  setSessionPresenceFilter('ONLINE');
                                }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#d1fae5',
                                    color: '#059669',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 18,
                                  }}
                                >
                                  <CheckCircleOutlined />
                                </div>
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#047857',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Đang trực tuyến (Online)
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 18,
                                      fontWeight: 800,
                                      color: '#065f46',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    <span className="platform-pulse-dot" />
                                    {onlineSessions.length} phiên
                                  </div>
                                </div>
                              </div>

                              <div
                                className="platform-telemetry-stat-box platform-telemetry-stat-box--offline"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  setSessionViewMode('HISTORY');
                                  setSessionPresenceFilter('OFFLINE');
                                }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#f1f5f9',
                                    color: '#64748b',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 18,
                                  }}
                                >
                                  <StopOutlined />
                                </div>
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#64748b',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Ngoại tuyến (Offline)
                                  </div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: '#334155' }}>
                                    {offlineActiveSessions.length} phiên
                                  </div>
                                </div>
                              </div>

                              <div
                                className="platform-telemetry-stat-box"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  setSessionViewMode('HISTORY');
                                  setSessionPresenceFilter('REVOKED');
                                }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#fef2f2',
                                    color: '#ef4444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 18,
                                  }}
                                >
                                  <StopOutlined />
                                </div>
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#991b1b',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Đã thu hồi
                                  </div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: '#b91c1c' }}>
                                    {revokedSessions.length} phiên
                                  </div>
                                </div>
                              </div>

                              <div
                                className="platform-telemetry-stat-box"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  setSessionViewMode('HISTORY');
                                  setSessionPresenceFilter('EXPIRED');
                                }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#f8fafc',
                                    color: '#94a3b8',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 18,
                                  }}
                                >
                                  <ClockCircleOutlined />
                                </div>
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#64748b',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Hết hạn
                                  </div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: '#64748b' }}>
                                    {expiredSessions.length} phiên
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Chế độ 1: Theo thiết bị POS */}
                          {sessionViewMode === 'DEVICES' && (
                            <div>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: 12,
                                }}
                              >
                                <Typography.Text strong style={{ fontSize: 15 }}>
                                  Trạng thái các thiết bị vật lý ({detail.devices.length} máy POS)
                                </Typography.Text>
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<HistoryOutlined />}
                                  onClick={() => {
                                    setSessionViewMode('HISTORY');
                                    setSelectedDeviceFilter('ALL');
                                    setSessionPresenceFilter('ALL');
                                  }}
                                >
                                  Xem toàn bộ lịch sử ({detail.sessions.length} phiên) &rarr;
                                </Button>
                              </div>

                              {detail.devices.length === 0 ? (
                                <Empty description="Chưa có thiết bị POS nào." />
                              ) : (
                                <div className="platform-device-grid">
                                  {detail.devices.map((d) => {
                                    const devSessions = detail.sessions.filter(
                                      (s) => s.deviceId === d.id,
                                    );
                                    const isDeviceOnline = Boolean(d.isOnline);
                                    const isDeviceActive = d.status === 'ACTIVE';

                                    return (
                                      <Card
                                        key={d.id}
                                        size="small"
                                        className={`platform-device-card ${
                                          isDeviceOnline
                                            ? 'platform-device-card--online'
                                            : !isDeviceActive
                                              ? 'platform-device-card--revoked'
                                              : 'platform-device-card--offline'
                                        }`}
                                      >
                                        <div
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'flex-start',
                                            marginBottom: 12,
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 10,
                                            }}
                                          >
                                            <div
                                              style={{
                                                width: 38,
                                                height: 38,
                                                borderRadius: 10,
                                                background: isDeviceOnline ? '#ecfdf5' : '#f1f5f9',
                                                color: isDeviceOnline ? '#059669' : '#64748b',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 18,
                                              }}
                                            >
                                              <MobileOutlined />
                                            </div>
                                            <div>
                                              <div
                                                style={{
                                                  fontWeight: 700,
                                                  fontSize: 14.5,
                                                  color: '#0f172a',
                                                }}
                                              >
                                                {d.name || 'Thiết bị POS'}
                                              </div>
                                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                                ID: <code>{d.id}</code>
                                              </div>
                                            </div>
                                          </div>

                                          <div>
                                            {isDeviceOnline ? (
                                              <Tag
                                                color="success"
                                                style={{ fontWeight: 600, margin: 0 }}
                                              >
                                                🟢 Trực tuyến
                                              </Tag>
                                            ) : isDeviceActive ? (
                                              <Tag color="default" style={{ margin: 0 }}>
                                                ⚪ Ngoại tuyến
                                              </Tag>
                                            ) : (
                                              <Tag color="error" style={{ margin: 0 }}>
                                                🔴 Đã thu hồi
                                              </Tag>
                                            )}
                                          </div>
                                        </div>

                                        {/* Current Session / Staff Info */}
                                        <div
                                          style={{
                                            background: '#f8fafc',
                                            borderRadius: 8,
                                            padding: '10px 12px',
                                            marginBottom: 12,
                                            border: '1px solid #eef2f7',
                                          }}
                                        >
                                          {d.currentSession ? (
                                            <div>
                                              <div
                                                style={{
                                                  fontSize: 11,
                                                  color: '#64748b',
                                                  textTransform: 'uppercase',
                                                  fontWeight: 600,
                                                  marginBottom: 6,
                                                }}
                                              >
                                                Nhân sự đang đăng nhập
                                              </div>
                                              <div
                                                style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: 8,
                                                  marginBottom: 6,
                                                }}
                                              >
                                                <Avatar
                                                  size={26}
                                                  style={{
                                                    background: isDeviceOnline
                                                      ? '#10b981'
                                                      : '#3b82f6',
                                                    fontWeight: 700,
                                                  }}
                                                >
                                                  {getInitials(d.currentSession.userName)}
                                                </Avatar>
                                                <div>
                                                  <Typography.Text
                                                    strong
                                                    style={{ fontSize: 13.5 }}
                                                  >
                                                    {d.currentSession.userName}
                                                  </Typography.Text>
                                                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                                    @{d.currentSession.userUsername} ·{' '}
                                                    <Tag
                                                      color="blue"
                                                      style={{
                                                        fontSize: 10,
                                                        margin: 0,
                                                        padding: '0 4px',
                                                      }}
                                                    >
                                                      {d.currentSession.userRoleName}
                                                    </Tag>
                                                  </div>
                                                </div>
                                              </div>

                                              <div
                                                style={{
                                                  fontSize: 11.5,
                                                  color: '#64748b',
                                                  display: 'flex',
                                                  flexDirection: 'column',
                                                  gap: 2,
                                                }}
                                              >
                                                <div>
                                                  Đăng nhập:{' '}
                                                  <strong>
                                                    {formatRelativeTime(d.currentSession.createdAt)}
                                                  </strong>{' '}
                                                  ({formatDateTime(d.currentSession.createdAt)})
                                                </div>
                                                <div>
                                                  Hoạt động cuối:{' '}
                                                  <strong>
                                                    {formatRelativeTime(
                                                      d.currentSession.lastSeenAt,
                                                    )}
                                                  </strong>
                                                </div>
                                              </div>

                                              {isDeviceActive && (
                                                <div style={{ marginTop: 8, textAlign: 'right' }}>
                                                  <Popconfirm
                                                    title="Đăng xuất khỏi thiết bị này?"
                                                    description="Nhân viên sẽ bị đăng xuất khỏi ứng dụng POS và phải nhập lại mã PIN."
                                                    okText="Đăng xuất"
                                                    cancelText="Hủy"
                                                    okButtonProps={{
                                                      danger: true,
                                                      loading: submitting,
                                                    }}
                                                    onConfirm={() =>
                                                      handleRevokeSession(d.currentSession!.id)
                                                    }
                                                  >
                                                    <Button
                                                      size="small"
                                                      danger
                                                      ghost
                                                      icon={<LogoutOutlined />}
                                                    >
                                                      Đăng xuất nhân viên
                                                    </Button>
                                                  </Popconfirm>
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <div
                                              style={{
                                                color: '#94a3b8',
                                                fontSize: 12,
                                                padding: '4px 0',
                                              }}
                                            >
                                              <div>
                                                Chưa có tài khoản nào đăng nhập trên máy này.
                                              </div>
                                              {d.lastSeenAt && (
                                                <div
                                                  style={{
                                                    fontSize: 11,
                                                    marginTop: 4,
                                                    color: '#64748b',
                                                  }}
                                                >
                                                  Lần thấy cuối: {formatDateTime(d.lastSeenAt)} (
                                                  {formatRelativeTime(d.lastSeenAt)})
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        {/* Card Footer */}
                                        <div
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            fontSize: 12,
                                          }}
                                        >
                                          <span style={{ color: '#64748b' }}>
                                            {devSessions.length} lượt phiên trong lịch sử
                                          </span>
                                          <Space size="small">
                                            <Button
                                              size="small"
                                              type="text"
                                              icon={<HistoryOutlined />}
                                              onClick={() => {
                                                setSelectedDeviceFilter(d.id);
                                                setSessionPresenceFilter('ALL');
                                                setSessionViewMode('HISTORY');
                                              }}
                                            >
                                              Lịch sử
                                            </Button>
                                            {isDeviceActive && !d.pushNotificationEnabled && (
                                              <Button
                                                size="small"
                                                icon={<BellOutlined />}
                                                loading={requestingPushDeviceId === d.id}
                                                style={{
                                                  color: '#2563eb',
                                                  borderColor: '#93c5fd',
                                                  background: '#eff6ff',
                                                }}
                                                onClick={() =>
                                                  void handleRequestPushPrompt(d.id, d.name)
                                                }
                                              >
                                                Bật thông báo
                                              </Button>
                                            )}
                                            {isDeviceActive && (
                                              <Popconfirm
                                                title="Thu hồi máy POS này?"
                                                description="Thiết bị sẽ bị ngắt kết nối và tất cả phiên đăng nhập trên máy sẽ bị hủy."
                                                okText="Thu hồi"
                                                cancelText="Hủy"
                                                okButtonProps={{
                                                  danger: true,
                                                  loading: submitting,
                                                }}
                                                onConfirm={() => handleRevokeDevice(d.id)}
                                              >
                                                <Button
                                                  size="small"
                                                  type="text"
                                                  danger
                                                  icon={<StopOutlined />}
                                                >
                                                  Thu hồi
                                                </Button>
                                              </Popconfirm>
                                            )}
                                          </Space>
                                        </div>
                                      </Card>
                                    );
                                  })}

                                  {/* Web sessions card */}
                                  {detail.sessions.some((s) => !s.deviceId) && (
                                    <Card
                                      size="small"
                                      className="platform-device-card platform-device-card--offline"
                                    >
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'flex-start',
                                          marginBottom: 12,
                                        }}
                                      >
                                        <div
                                          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                                        >
                                          <div
                                            style={{
                                              width: 38,
                                              height: 38,
                                              borderRadius: 10,
                                              background: '#e0f2fe',
                                              color: '#0284c7',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              fontSize: 18,
                                            }}
                                          >
                                            <GlobalOutlined />
                                          </div>
                                          <div>
                                            <div
                                              style={{
                                                fontWeight: 700,
                                                fontSize: 14.5,
                                                color: '#0f172a',
                                              }}
                                            >
                                              Trình duyệt web trực tiếp
                                            </div>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                              Phiên web (Chủ cửa hàng / Web Admin)
                                            </div>
                                          </div>
                                        </div>
                                        <Tag color="cyan">Web Browser</Tag>
                                      </div>

                                      <div
                                        style={{
                                          background: '#f8fafc',
                                          borderRadius: 8,
                                          padding: '10px 12px',
                                          marginBottom: 12,
                                          border: '1px solid #eef2f7',
                                        }}
                                      >
                                        <div style={{ fontSize: 12, color: '#334155' }}>
                                          Tổng cộng có{' '}
                                          <strong>
                                            {detail.sessions.filter((s) => !s.deviceId).length}{' '}
                                            phiên
                                          </strong>{' '}
                                          đăng nhập qua trình duyệt web trực tiếp.
                                        </div>
                                        <div
                                          style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}
                                        >
                                          {
                                            detail.sessions.filter(
                                              (s) =>
                                                !s.deviceId &&
                                                s.status === 'ACTIVE' &&
                                                Date.now() < s.expiresAt,
                                            ).length
                                          }{' '}
                                          phiên đang hoạt động
                                        </div>
                                      </div>

                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'flex-end',
                                        }}
                                      >
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<HistoryOutlined />}
                                          onClick={() => {
                                            setSelectedDeviceFilter('WEB');
                                            setSessionPresenceFilter('ALL');
                                            setSessionViewMode('HISTORY');
                                          }}
                                        >
                                          Xem lịch sử phiên Web
                                        </Button>
                                      </div>
                                    </Card>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Chế độ 2: Danh sách lịch sử chi tiết */}
                          {sessionViewMode === 'HISTORY' && (
                            <div>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 12,
                                  marginBottom: 14,
                                }}
                              >
                                <Space wrap>
                                  <Segmented
                                    value={sessionPresenceFilter}
                                    onChange={(val) =>
                                      setSessionPresenceFilter(val as typeof sessionPresenceFilter)
                                    }
                                    options={[
                                      { label: `Tất cả (${detail.sessions.length})`, value: 'ALL' },
                                      {
                                        label: `🟢 Online (${onlineSessions.length})`,
                                        value: 'ONLINE',
                                      },
                                      {
                                        label: `⚪ Offline (${offlineActiveSessions.length})`,
                                        value: 'OFFLINE',
                                      },
                                      {
                                        label: `🔴 Đã thu hồi (${revokedSessions.length})`,
                                        value: 'REVOKED',
                                      },
                                      {
                                        label: `⏳ Hết hạn (${expiredSessions.length})`,
                                        value: 'EXPIRED',
                                      },
                                    ]}
                                  />

                                  <Select
                                    value={selectedDeviceFilter}
                                    onChange={setSelectedDeviceFilter}
                                    style={{ minWidth: 200 }}
                                    options={[
                                      {
                                        label: `Tất cả thiết bị (${detail.devices.length})`,
                                        value: 'ALL',
                                      },
                                      ...detail.devices.map((d) => ({
                                        label: `${d.name || 'Máy POS'} ${d.isOnline ? '🟢 Online' : '⚪ Offline'}`,
                                        value: d.id,
                                      })),
                                      ...(detail.sessions.some((s) => !s.deviceId)
                                        ? [{ label: '🌐 Trình duyệt Web', value: 'WEB' }]
                                        : []),
                                    ]}
                                  />
                                </Space>

                                <Input
                                  placeholder="Tìm theo nhân sự, máy POS, ID..."
                                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                                  value={sessionSearchTerm}
                                  onChange={(e) => setSessionSearchTerm(e.target.value)}
                                  allowClear
                                  style={{ width: isMobile ? '100%' : 260 }}
                                />
                              </div>

                              {filtered.length === 0 ? (
                                <Empty description="Không có phiên đăng nhập nào phù hợp bộ lọc." />
                              ) : isMobile ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {filtered.map((s) => {
                                    const isLive =
                                      s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                                    const isRevoked = s.status === 'REVOKED';

                                    return (
                                      <div key={s.id} className="platform-mobile-session-card">
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                            marginBottom: 8,
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 8,
                                              minWidth: 0,
                                            }}
                                          >
                                            <Avatar
                                              size={30}
                                              style={{
                                                background:
                                                  s.sessionKind === 'OWNER' ? '#f59e0b' : '#3b82f6',
                                                fontWeight: 700,
                                                flexShrink: 0,
                                              }}
                                            >
                                              {getInitials(s.userName)}
                                            </Avatar>
                                            <div style={{ minWidth: 0 }}>
                                              <Typography.Text
                                                strong
                                                style={{
                                                  fontSize: 13.5,
                                                  display: 'block',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                                }}
                                              >
                                                {s.userName}
                                              </Typography.Text>
                                              <div style={{ fontSize: 11, color: '#64748b' }}>
                                                @{s.userUsername}{' '}
                                                <Tag
                                                  color={
                                                    s.sessionKind === 'OWNER' ? 'gold' : 'blue'
                                                  }
                                                  style={{ fontSize: 10, margin: 0 }}
                                                >
                                                  {s.userRoleName || s.sessionKind}
                                                </Tag>
                                              </div>
                                            </div>
                                          </div>
                                          <div>
                                            {isRevoked ? (
                                              <Tag
                                                color="error"
                                                style={{ fontWeight: 600, margin: 0, fontSize: 11 }}
                                              >
                                                🔴 Thu hồi
                                              </Tag>
                                            ) : !isLive ? (
                                              <Tag
                                                color="default"
                                                style={{ margin: 0, fontSize: 11 }}
                                              >
                                                ⚪ Hết hạn
                                              </Tag>
                                            ) : s.isOnline ? (
                                              <Tag
                                                color="success"
                                                style={{ fontWeight: 600, margin: 0, fontSize: 11 }}
                                              >
                                                🟢 Online
                                              </Tag>
                                            ) : (
                                              <Tag
                                                color="default"
                                                style={{ margin: 0, fontSize: 11 }}
                                              >
                                                ⚪ Offline
                                              </Tag>
                                            )}
                                          </div>
                                        </div>

                                        <div
                                          style={{
                                            background: '#f8fafc',
                                            borderRadius: 8,
                                            padding: '6px 10px',
                                            fontSize: 11.5,
                                            marginBottom: 8,
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              marginBottom: 3,
                                            }}
                                          >
                                            <span style={{ color: '#64748b' }}>Thiết bị:</span>
                                            <span style={{ color: '#334155', fontWeight: 500 }}>
                                              {s.deviceId
                                                ? `📱 ${s.deviceName || 'Máy POS'}`
                                                : '🌐 Trình duyệt Web'}
                                            </span>
                                          </div>
                                          <div
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              marginBottom: 3,
                                            }}
                                          >
                                            <span style={{ color: '#64748b' }}>Đăng nhập:</span>
                                            <span style={{ color: '#334155' }}>
                                              {formatDateTime(s.createdAt)}
                                            </span>
                                          </div>
                                          <div
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                            }}
                                          >
                                            <span style={{ color: '#64748b' }}>
                                              Hoạt động cuối:
                                            </span>
                                            <span
                                              style={{
                                                color: s.isOnline ? '#059669' : '#64748b',
                                                fontWeight: s.isOnline ? 600 : 400,
                                              }}
                                            >
                                              {s.isOnline
                                                ? '🟢 Đang kết nối'
                                                : formatRelativeTime(s.lastSeenAt)}
                                            </span>
                                          </div>
                                        </div>

                                        {isLive && (
                                          <div
                                            style={{ display: 'flex', justifyContent: 'flex-end' }}
                                          >
                                            <Popconfirm
                                              title="Đăng xuất thiết bị này?"
                                              description="Phiên làm việc sẽ bị hủy ngay lập tức và buộc nhân sự đăng nhập lại."
                                              okText="Đăng xuất"
                                              cancelText="Hủy"
                                              okButtonProps={{ danger: true, loading: submitting }}
                                              onConfirm={() => handleRevokeSession(s.id)}
                                            >
                                              <Button size="small" danger icon={<StopOutlined />}>
                                                Thu hồi phiên
                                              </Button>
                                            </Popconfirm>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <Table
                                  rowKey="id"
                                  size="small"
                                  dataSource={filtered}
                                  pagination={{
                                    pageSize: 10,
                                    size: 'small',
                                    showTotal: (t) => `Tổng ${t} phiên`,
                                  }}
                                  scroll={{ x: 820 }}
                                  columns={[
                                    {
                                      title: 'Người dùng',
                                      key: 'user',
                                      render: (_, s) => (
                                        <div
                                          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                        >
                                          <Avatar
                                            size={28}
                                            style={{
                                              background:
                                                s.sessionKind === 'OWNER' ? '#f59e0b' : '#3b82f6',
                                              fontWeight: 700,
                                            }}
                                          >
                                            {getInitials(s.userName)}
                                          </Avatar>
                                          <div>
                                            <Typography.Text strong>{s.userName}</Typography.Text>
                                            <div style={{ fontSize: 12, color: '#64748b' }}>
                                              @{s.userUsername}{' '}
                                              <Tag
                                                color={s.sessionKind === 'OWNER' ? 'gold' : 'blue'}
                                              >
                                                {s.userRoleName || s.sessionKind}
                                              </Tag>
                                            </div>
                                          </div>
                                        </div>
                                      ),
                                    },
                                    {
                                      title: 'Thiết bị POS',
                                      key: 'device',
                                      render: (_, s) => (
                                        <div>
                                          {s.deviceId ? (
                                            <div>
                                              <MobileOutlined
                                                style={{ marginRight: 6, color: '#2563eb' }}
                                              />
                                              <Typography.Text strong>
                                                {s.deviceName || 'Máy POS'}
                                              </Typography.Text>
                                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                                ID: <code>{s.deviceId}</code>
                                              </div>
                                              {s.deviceStatus === 'REVOKED' && (
                                                <Tag
                                                  color="error"
                                                  style={{ fontSize: 10, marginTop: 2 }}
                                                >
                                                  Máy đã thu hồi
                                                </Tag>
                                              )}
                                            </div>
                                          ) : (
                                            <div>
                                              <GlobalOutlined
                                                style={{ marginRight: 6, color: '#0ea5e9' }}
                                              />
                                              <Typography.Text>
                                                {s.deviceName || 'Trình duyệt trực tiếp'}
                                              </Typography.Text>
                                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                                Web Session
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ),
                                    },
                                    {
                                      title: 'Trạng thái kết nối',
                                      key: 'presence',
                                      render: (_, s) => {
                                        const isLive =
                                          s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                                        const isRevoked = s.status === 'REVOKED';

                                        if (isRevoked) {
                                          return (
                                            <div>
                                              <Tag color="error" style={{ fontWeight: 600 }}>
                                                🔴 Đã thu hồi
                                              </Tag>
                                              {s.revokedAt ? (
                                                <div
                                                  style={{
                                                    fontSize: 11,
                                                    color: '#ef4444',
                                                    marginTop: 2,
                                                  }}
                                                >
                                                  {formatDateTime(s.revokedAt)}
                                                </div>
                                              ) : null}
                                            </div>
                                          );
                                        }

                                        if (!isLive) {
                                          return (
                                            <div>
                                              <Tag color="default">⚪ Hết hạn</Tag>
                                              <div
                                                style={{
                                                  fontSize: 11,
                                                  color: '#94a3b8',
                                                  marginTop: 2,
                                                }}
                                              >
                                                {formatDateTime(s.expiresAt)}
                                              </div>
                                            </div>
                                          );
                                        }

                                        if (s.isOnline) {
                                          return (
                                            <div>
                                              <Tag color="success" style={{ fontWeight: 600 }}>
                                                🟢 Đang trực tuyến
                                              </Tag>
                                              <div
                                                style={{
                                                  fontSize: 11,
                                                  color: '#059669',
                                                  marginTop: 2,
                                                }}
                                              >
                                                Có tín hiệu trong 5p
                                              </div>
                                            </div>
                                          );
                                        }

                                        return (
                                          <div>
                                            <Tag color="default">⚪ Ngoại tuyến</Tag>
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: '#64748b',
                                                marginTop: 2,
                                              }}
                                            >
                                              Hết hạn: {formatDateTime(s.expiresAt)}
                                            </div>
                                          </div>
                                        );
                                      },
                                    },
                                    {
                                      title: 'Thời gian đăng nhập',
                                      dataIndex: 'createdAt',
                                      key: 'createdAt',
                                      render: (val: number) => (
                                        <div>
                                          <div>{formatDateTimeFull(val)}</div>
                                          <div style={{ fontSize: 11, color: '#64748b' }}>
                                            {formatRelativeTime(val)}
                                          </div>
                                        </div>
                                      ),
                                    },
                                    {
                                      title: 'Hoạt động gần nhất',
                                      dataIndex: 'lastSeenAt',
                                      key: 'lastSeenAt',
                                      render: (val: number, s) => (
                                        <div>
                                          <div>{formatDateTimeFull(val)}</div>
                                          <div
                                            style={{
                                              fontSize: 11,
                                              color: s.isOnline ? '#059669' : '#64748b',
                                              fontWeight: s.isOnline ? 600 : 400,
                                            }}
                                          >
                                            {s.isOnline
                                              ? '🟢 Đang kết nối'
                                              : formatRelativeTime(val)}
                                          </div>
                                        </div>
                                      ),
                                    },
                                    {
                                      title: 'Thao tác',
                                      key: 'actions',
                                      align: 'right',
                                      render: (_, s) => {
                                        const isLive =
                                          s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                                        return isLive ? (
                                          <Popconfirm
                                            title="Đăng xuất thiết bị này?"
                                            description="Phiên làm việc sẽ bị hủy ngay lập tức và buộc nhân sự đăng nhập lại."
                                            okText="Đăng xuất"
                                            cancelText="Hủy"
                                            okButtonProps={{ danger: true, loading: submitting }}
                                            onConfirm={() => handleRevokeSession(s.id)}
                                          >
                                            <Button size="small" danger icon={<StopOutlined />}>
                                              Thu hồi
                                            </Button>
                                          </Popconfirm>
                                        ) : (
                                          <span style={{ color: '#cbd5e1' }}>—</span>
                                        );
                                      },
                                    },
                                  ]}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })(),
                  },
                  {
                    key: 'stats',
                    label: (
                      <span>
                        <AppstoreOutlined /> {isMobile ? 'Báo cáo' : 'Dữ liệu & Thống kê'}
                      </span>
                    ),
                    children: (
                      <div className="platform-store-analytics">
                        {/* Header toolbar with Trend Days selector and Last Activity */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 12,
                            padding: '4px 0',
                          }}
                        >
                          <div>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                              Thống kê kinh doanh & Phân tích vận hành
                            </Typography.Title>
                            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                              {detail.stats.lastActivityAt ? (
                                <span>
                                  Hoạt động gần nhất:{' '}
                                  <strong>{formatDateTimeFull(detail.stats.lastActivityAt)}</strong>{' '}
                                  ({formatRelativeTime(detail.stats.lastActivityAt)})
                                </span>
                              ) : (
                                'Chưa phát sinh hoạt động bán hàng'
                              )}
                            </div>
                          </div>

                          <Space align="center">
                            <span style={{ fontSize: 13, color: '#64748b' }}>Chu kỳ xu hướng:</span>
                            <Segmented
                              value={storeTrendDays}
                              onChange={(val) => setStoreTrendDays(val as number)}
                              options={[
                                { label: '7 ngày', value: 7 },
                                { label: '14 ngày', value: 14 },
                                { label: '30 ngày', value: 30 },
                              ]}
                            />
                          </Space>
                        </div>

                        {/* Top KPI Cards: Today & High-level Metrics */}
                        <div className="platform-store-kpi-grid">
                          <Card className="platform-store-kpi platform-store-kpi--primary">
                            <Statistic
                              title="Doanh thu hôm nay"
                              value={formatCompactVnd(detail.analytics.summary.todayRevenue)}
                              prefix={<DollarOutlined />}
                            />
                            <span>
                              30 ngày:{' '}
                              {formatCompactVnd(detail.analytics.summary.last30DaysRevenue)}
                            </span>
                          </Card>

                          <Card className="platform-store-kpi">
                            <Statistic
                              title="Đơn hàng hôm nay"
                              value={detail.stats.todayOrders ?? 0}
                              prefix={<ShoppingOutlined />}
                              suffix={
                                <span style={{ fontSize: 14, fontWeight: 400, color: '#64748b' }}>
                                  đơn
                                </span>
                              }
                            />
                            <span>Đã xuất {detail.stats.todayInvoices ?? 0} hóa đơn hôm nay</span>
                          </Card>

                          <Card className="platform-store-kpi">
                            <Statistic
                              title="Giá trị TB / đơn hôm nay"
                              value={formatCompactVnd(detail.stats.todayAvgOrderValue ?? 0)}
                              prefix={<CreditCardOutlined />}
                            />
                            <span>
                              TB toàn thời gian:{' '}
                              {formatCompactVnd(detail.analytics.summary.avgInvoiceValue)}
                            </span>
                          </Card>

                          <Card className="platform-store-kpi">
                            <Statistic
                              title="Bàn & Đơn đang mở"
                              value={`${detail.stats.openTables}/${detail.stats.totalTables}`}
                              prefix={<ShopOutlined />}
                              suffix={
                                <span style={{ fontSize: 14, fontWeight: 400, color: '#64748b' }}>
                                  bàn
                                </span>
                              }
                            />
                            <span>{detail.stats.openOrders} đơn đang phục vụ chưa thanh toán</span>
                          </Card>
                        </div>

                        {/* Trend Chart Card */}
                        <Card className="platform-chart-card">
                          <div className="platform-chart-header">
                            <div className="platform-chart-title">
                              <LineChartOutlined style={{ color: '#2563eb' }} />
                              Xu hướng kinh doanh ({storeTrendDays} ngày qua)
                            </div>
                            <Segmented
                              size="small"
                              value={trendMetric}
                              onChange={(value) => setTrendMetric(value as 'revenue' | 'invoices')}
                              options={[
                                { label: 'Doanh thu', value: 'revenue' },
                                { label: 'Hóa đơn', value: 'invoices' },
                              ]}
                            />
                          </div>
                          <RevenueTrendChart
                            data={detail.analytics.revenueTrend}
                            metric={trendMetric}
                          />
                        </Card>

                        {/* Two-Column Charts: Payment methods & Hourly distribution */}
                        <div className="platform-two-col-grid">
                          <Card
                            className="platform-chart-card"
                            title="Cơ cấu phương thức thanh toán"
                          >
                            <PaymentDonutChart data={detail.analytics.paymentMethods} />
                          </Card>
                          <Card
                            className="platform-chart-card"
                            title="Khung giờ phát sinh doanh thu"
                          >
                            <HourlyPeakChart data={detail.analytics.hourlyDistribution} />
                          </Card>
                        </div>

                        {/* Two-Column Deep-dive Operations & Customers */}
                        <div className="platform-two-col-grid platform-store-data-grid">
                          <Card
                            className="platform-chart-card"
                            title="Phân tích đơn hàng & Chống thất thoát"
                          >
                            <div className="platform-store-operation-grid">
                              <Statistic
                                title="Đơn tại bàn (Dine-in)"
                                value={detail.stats.dineInOrders ?? 0}
                                prefix={<ShopOutlined />}
                                suffix={
                                  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>
                                    đơn
                                  </span>
                                }
                              />
                              <Statistic
                                title="Đơn mang về (Takeaway)"
                                value={detail.stats.takeawayOrders ?? 0}
                                prefix={<ShoppingOutlined />}
                                suffix={
                                  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>
                                    đơn
                                  </span>
                                }
                              />
                              <Statistic
                                title="Tỷ lệ hoàn tất"
                                value={detail.analytics.summary.completionRate}
                                suffix="%"
                                prefix={<TrophyOutlined />}
                                valueStyle={{ color: '#10b981' }}
                              />
                              <Statistic
                                title="Đơn hủy / Thất thoát"
                                value={detail.stats.cancelledOrders ?? 0}
                                suffix={
                                  <span
                                    style={{
                                      fontSize: 13,
                                      fontWeight: 600,
                                      color:
                                        (detail.stats.cancelledOrders ?? 0) > 0
                                          ? '#ef4444'
                                          : '#64748b',
                                    }}
                                  >
                                    ({detail.stats.cancelRate ?? 0}%)
                                  </span>
                                }
                                prefix={<WarningOutlined />}
                                valueStyle={{
                                  color:
                                    (detail.stats.cancelledOrders ?? 0) > 0 ? '#ef4444' : undefined,
                                }}
                              />
                              <Statistic
                                title="Tổng giảm giá / KM"
                                value={formatCompactVnd(detail.stats.totalDiscountAmount ?? 0)}
                                prefix={<DollarOutlined />}
                              />
                              <Statistic
                                title="Tổng doanh thu tích lũy"
                                value={formatCompactVnd(detail.stats.totalRevenue)}
                                prefix={<RiseOutlined />}
                              />
                            </div>
                          </Card>

                          <Card
                            className="platform-chart-card"
                            title="Khách hàng, Thực đơn & Quy mô"
                          >
                            <div className="platform-store-operation-grid">
                              <Statistic
                                title="Tổng khách hàng lưu"
                                value={detail.stats.totalCustomers ?? 0}
                                prefix={<UserOutlined />}
                                suffix={
                                  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>
                                    khách
                                  </span>
                                }
                              />
                              <Statistic
                                title="Dư nợ khách hàng"
                                value={formatCompactVnd(detail.stats.totalDebtBalance ?? 0)}
                                valueStyle={{
                                  color:
                                    (detail.stats.totalDebtBalance ?? 0) > 0
                                      ? '#d97706'
                                      : undefined,
                                }}
                              />
                              <Statistic
                                title="Danh mục món"
                                value={detail.stats.totalCategories ?? 0}
                                prefix={<AppstoreOutlined />}
                                suffix={
                                  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>
                                    nhóm
                                  </span>
                                }
                              />
                              <Statistic
                                title="Mặt hàng menu"
                                value={
                                  detail.stats.activeProductsCount ?? detail.stats.totalProducts
                                }
                                suffix={`/ ${detail.stats.totalProducts} món`}
                              />
                              <Statistic
                                title="Thiết bị POS trực tuyến"
                                value={
                                  detail.stats.onlineDevicesCount ??
                                  detail.devices.filter((d) => d.isOnline).length
                                }
                                suffix={`/ ${detail.stats.totalDevices} máy`}
                                valueStyle={{ color: '#10b981' }}
                              />
                              <Statistic
                                title="Khu vực & Bàn"
                                value={detail.stats.totalAreas}
                                suffix={`khu / ${detail.stats.totalTables} bàn`}
                              />
                            </div>
                          </Card>
                        </div>

                        {/* Top Products */}
                        <Card
                          className="platform-chart-card"
                          title="Mặt hàng bán chạy nhất (Top Products)"
                        >
                          <TopProductsWidget products={detail.analytics.topProducts} />
                        </Card>
                      </div>
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        </main>
      ) : null}

      {/* Modal Lịch Sử Đăng Nhập Thiết Bị Của Thành Viên */}
      <Modal
        title={
          selectedMemberForHistory ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar
                size={36}
                style={{
                  background: selectedMemberForHistory.roleCode === 'OWNER' ? '#f59e0b' : '#3b82f6',
                  fontWeight: 700,
                }}
              >
                {getInitials(selectedMemberForHistory.displayName)}
              </Avatar>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
                  Lịch sử đăng nhập thiết bị
                </div>
                <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 400 }}>
                  {selectedMemberForHistory.displayName} (@{selectedMemberForHistory.username}) ·{' '}
                  <Tag
                    color={selectedMemberForHistory.roleCode === 'OWNER' ? 'gold' : 'blue'}
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {selectedMemberForHistory.roleName}
                  </Tag>
                </div>
              </div>
            </div>
          ) : (
            'Lịch sử đăng nhập thiết bị'
          )
        }
        open={Boolean(selectedMemberForHistory)}
        footer={[
          <Button key="close" type="primary" onClick={() => setSelectedMemberForHistory(null)}>
            Đóng
          </Button>,
        ]}
        width={isMobile ? 'calc(100vw - 24px)' : 860}
        onCancel={() => setSelectedMemberForHistory(null)}
        destroyOnClose
      >
        {selectedMemberForHistory && detail
          ? (() => {
              const userSessions = detail.sessions.filter(
                (s) => s.userId === selectedMemberForHistory.userId,
              );
              const onlineSessions = userSessions.filter((s) => s.isOnline);
              const offlineSessions = userSessions.filter(
                (s) => s.status === 'ACTIVE' && Date.now() < s.expiresAt && !s.isOnline,
              );
              const inactiveSessions = userSessions.filter(
                (s) => s.status !== 'ACTIVE' || Date.now() >= s.expiresAt,
              );

              const displayedSessions =
                memberHistoryFilter === 'ONLINE'
                  ? onlineSessions
                  : memberHistoryFilter === 'OFFLINE'
                    ? offlineSessions
                    : memberHistoryFilter === 'INACTIVE'
                      ? inactiveSessions
                      : userSessions;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
                  <Row gutter={[12, 12]}>
                    <Col xs={12} sm={8}>
                      <Card size="small" style={{ background: '#f8fafc', borderRadius: 8 }}>
                        <Statistic
                          title="Tổng lượt đăng nhập"
                          value={userSessions.length}
                          prefix={<HistoryOutlined style={{ color: '#2563eb' }} />}
                        />
                      </Card>
                    </Col>
                    <Col xs={12} sm={8}>
                      <Card size="small" style={{ background: '#f0fdf4', borderRadius: 8 }}>
                        <Statistic
                          title="Đang trực tuyến (Online)"
                          value={onlineSessions.length}
                          prefix={
                            <span className="platform-pulse-dot" style={{ marginRight: 6 }} />
                          }
                          valueStyle={{ color: '#10b981', fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Card size="small" style={{ background: '#f8fafc', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, color: '#64748b' }}>Thiết bị gần nhất</div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 650,
                            marginTop: 4,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {userSessions[0]?.deviceName ||
                            (userSessions[0] ? 'Trình duyệt Web' : '—')}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                          {userSessions[0]
                            ? formatRelativeTime(
                                userSessions[0]?.lastSeenAt || userSessions[0]?.createdAt,
                              )
                            : 'Chưa có'}
                        </div>
                      </Card>
                    </Col>
                  </Row>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <Segmented
                      value={memberHistoryFilter}
                      onChange={(val) => setMemberHistoryFilter(val as typeof memberHistoryFilter)}
                      options={[
                        { label: `Tất cả (${userSessions.length})`, value: 'ALL' },
                        { label: `🟢 Online (${onlineSessions.length})`, value: 'ONLINE' },
                        { label: `⚪ Offline (${offlineSessions.length})`, value: 'OFFLINE' },
                        {
                          label: `Đã kết thúc / Hết hạn (${inactiveSessions.length})`,
                          value: 'INACTIVE',
                        },
                      ]}
                    />
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      SuperAdmin có thể thu hồi phiên từ xa để đăng xuất thiết bị ngay lập tức
                    </span>
                  </div>

                  {displayedSessions.length === 0 ? (
                    <Empty
                      description="Không có phiên đăng nhập nào trong bộ lọc này."
                      style={{ margin: '24px 0' }}
                    />
                  ) : isMobile ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        maxHeight: '55vh',
                        overflowY: 'auto',
                        paddingRight: 4,
                      }}
                    >
                      {displayedSessions.map((s) => {
                        const isLive = s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                        const isRevoked = s.status === 'REVOKED';

                        return (
                          <div key={s.id} className="platform-mobile-session-card">
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  minWidth: 0,
                                }}
                              >
                                {s.deviceId ? (
                                  <DesktopOutlined style={{ color: '#2563eb', fontSize: 16 }} />
                                ) : (
                                  <GlobalOutlined style={{ color: '#0ea5e9', fontSize: 16 }} />
                                )}
                                <Typography.Text
                                  strong
                                  style={{
                                    fontSize: 13,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {s.deviceName || (s.deviceId ? 'Máy POS' : 'Trình duyệt Web')}
                                </Typography.Text>
                              </div>
                              <div>
                                {isRevoked ? (
                                  <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
                                    🔴 Thu hồi
                                  </Tag>
                                ) : !isLive ? (
                                  <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                                    ⚪ Hết hạn
                                  </Tag>
                                ) : s.isOnline ? (
                                  <Tag
                                    color="success"
                                    style={{ margin: 0, fontSize: 11, fontWeight: 600 }}
                                  >
                                    🟢 Online
                                  </Tag>
                                ) : (
                                  <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                                    ⚪ Offline
                                  </Tag>
                                )}
                              </div>
                            </div>

                            <div
                              style={{
                                background: '#f8fafc',
                                borderRadius: 8,
                                padding: '6px 10px',
                                fontSize: 11.5,
                                marginBottom: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: '#64748b' }}>Đăng nhập:</span>
                                <span style={{ color: '#334155' }}>
                                  {formatDateTime(s.createdAt)}
                                </span>
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <span style={{ color: '#64748b' }}>Hoạt động cuối:</span>
                                <span
                                  style={{
                                    color: s.isOnline ? '#059669' : '#64748b',
                                    fontWeight: s.isOnline ? 600 : 400,
                                  }}
                                >
                                  {s.isOnline
                                    ? '🟢 Đang kết nối'
                                    : formatRelativeTime(s.lastSeenAt)}
                                </span>
                              </div>
                            </div>

                            {isLive && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Popconfirm
                                  title="Đăng xuất thiết bị này từ xa?"
                                  description="Phiên làm việc trên thiết bị sẽ bị hủy ngay lập tức và buộc người dùng đăng nhập lại."
                                  okText="Đăng xuất"
                                  cancelText="Hủy"
                                  okButtonProps={{ danger: true, loading: submitting }}
                                  onConfirm={() => handleRevokeSession(s.id)}
                                >
                                  <Button size="small" danger icon={<StopOutlined />}>
                                    Thu hồi phiên
                                  </Button>
                                </Popconfirm>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={displayedSessions}
                      pagination={{
                        pageSize: 5,
                        size: 'small',
                        showTotal: (t) => `Tổng ${t} phiên`,
                      }}
                      scroll={{ x: 680 }}
                      columns={[
                        {
                          title: 'Thiết bị & Nền tảng',
                          key: 'device',
                          render: (_, s) => (
                            <div>
                              {s.deviceId ? (
                                <div>
                                  <DesktopOutlined style={{ marginRight: 6, color: '#2563eb' }} />
                                  <Typography.Text strong>
                                    {s.deviceName || 'Máy POS'}
                                  </Typography.Text>
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    Mã POS: {s.deviceId}
                                  </div>
                                  {s.deviceStatus === 'REVOKED' && (
                                    <Tag color="error" style={{ fontSize: 10, marginTop: 2 }}>
                                      Máy POS đã thu hồi
                                    </Tag>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <GlobalOutlined style={{ marginRight: 6, color: '#0ea5e9' }} />
                                  <Typography.Text strong>
                                    {s.deviceName || 'Trình duyệt Web / POS Trực tiếp'}
                                  </Typography.Text>
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    Web Browser Session
                                  </div>
                                </div>
                              )}
                            </div>
                          ),
                        },
                        {
                          title: 'Thời gian đăng nhập',
                          dataIndex: 'createdAt',
                          key: 'createdAt',
                          render: (val: number) => (
                            <div>
                              <div style={{ fontWeight: 500 }}>{formatDateTimeFull(val)}</div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>
                                {formatRelativeTime(val)}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Hoạt động lần cuối',
                          dataIndex: 'lastSeenAt',
                          key: 'lastSeenAt',
                          render: (val: number, s) => (
                            <div>
                              <div>{formatDateTimeFull(val)}</div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: s.isOnline ? '#059669' : '#64748b',
                                  fontWeight: s.isOnline ? 600 : 400,
                                }}
                              >
                                {s.isOnline ? '🟢 Đang kết nối' : formatRelativeTime(val)}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Trạng thái phiên',
                          key: 'sessionStatus',
                          render: (_, s) => {
                            const isLive = s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                            const isRevoked = s.status === 'REVOKED';

                            if (isRevoked) {
                              return (
                                <div>
                                  <Tag color="error" style={{ fontWeight: 600 }}>
                                    🔴 Đã thu hồi
                                  </Tag>
                                  {s.revokedAt ? (
                                    <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                                      {formatDateTime(s.revokedAt)}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            }

                            if (!isLive) {
                              return (
                                <div>
                                  <Tag color="default">⚪ Hết hạn</Tag>
                                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                    {formatDateTime(s.expiresAt)}
                                  </div>
                                </div>
                              );
                            }

                            if (s.isOnline) {
                              return (
                                <div>
                                  <Tag color="success" style={{ fontWeight: 600 }}>
                                    🟢 Đang trực tuyến
                                  </Tag>
                                  <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
                                    Có tín hiệu trong 5p
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div>
                                <Tag color="default">⚪ Ngoại tuyến</Tag>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                  Hết hạn: {formatDateTime(s.expiresAt)}
                                </div>
                              </div>
                            );
                          },
                        },
                        {
                          title: 'Hành động',
                          key: 'actions',
                          align: 'right',
                          render: (_, s) => {
                            const isLive = s.status === 'ACTIVE' && Date.now() < s.expiresAt;
                            return isLive ? (
                              <Popconfirm
                                title="Đăng xuất thiết bị này từ xa?"
                                description="Phiên làm việc trên thiết bị sẽ bị hủy ngay lập tức và buộc người dùng đăng nhập lại."
                                okText="Đăng xuất"
                                cancelText="Hủy"
                                okButtonProps={{ danger: true, loading: submitting }}
                                onConfirm={() => handleRevokeSession(s.id)}
                              >
                                <Button size="small" danger icon={<StopOutlined />}>
                                  Thu hồi phiên
                                </Button>
                              </Popconfirm>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>—</span>
                            );
                          },
                        },
                      ]}
                    />
                  )}
                </div>
              );
            })()
          : null}
      </Modal>

      {/* Modal Chỉnh Sửa Thông Tin Tài Khoản */}
      <Modal
        title={`Chỉnh sửa tài khoản: ${editingMember?.displayName || ''}`}
        open={Boolean(editingMember)}
        okText="Lưu thay đổi"
        cancelText="Hủy"
        width={isMobile ? 'calc(100vw - 24px)' : 520}
        confirmLoading={submitting}
        onOk={() => editMemberForm.submit()}
        onCancel={() => setEditingMember(null)}
        destroyOnClose
      >
        <Form
          form={editMemberForm}
          layout="vertical"
          requiredMark={false}
          onFinish={submitEditMember}
        >
          <Form.Item
            label="Tên hiển thị"
            name="displayName"
            rules={[{ required: true, message: 'Vui lòng nhập tên hiển thị.' }]}
          >
            <Input maxLength={128} placeholder="Tên hiển thị" />
          </Form.Item>
          <Form.Item
            label="Tên đăng nhập"
            name="username"
            rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
          >
            <Input maxLength={128} placeholder="Tên đăng nhập" />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[{ type: 'email', message: 'Email không hợp lệ.' }]}
          >
            <Input type="email" maxLength={254} placeholder="email@example.com" />
          </Form.Item>
          <Form.Item label="Số điện thoại" name="phone">
            <Input maxLength={32} placeholder="Số điện thoại" />
          </Form.Item>
          <Form.Item label="Trạng thái tài khoản" name="status">
            <Select
              options={[
                { label: 'Đang hoạt động (ACTIVE)', value: 'ACTIVE' },
                { label: 'Vô hiệu hóa / Khóa (DISABLED)', value: 'DISABLED' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Đặt Lại Mật Khẩu Thành Viên */}
      <Modal
        title={`Đặt lại mật khẩu: @${resetPasswordMember?.username || ''}`}
        open={Boolean(resetPasswordMember)}
        okText="Cập nhật mật khẩu"
        cancelText="Hủy"
        width={isMobile ? 'calc(100vw - 24px)' : 520}
        confirmLoading={submitting}
        onOk={() => resetPasswordForm.submit()}
        onCancel={() => setResetPasswordMember(null)}
        destroyOnClose
      >
        <div style={{ marginBottom: 16, color: '#64748b', fontSize: 13 }}>
          Nhập mật khẩu mới cho tài khoản <strong>{resetPasswordMember?.displayName}</strong>. Mật
          khẩu sẽ được mã hóa an toàn bằng chuẩn PBKDF2.
        </div>
        <Form
          form={resetPasswordForm}
          layout="vertical"
          requiredMark={false}
          onFinish={submitResetPassword}
        >
          <Form.Item
            label="Mật khẩu mới"
            name="newPassword"
            rules={[
              { required: true, message: 'Vui lòng nhập mật khẩu mới.' },
              { min: 6, message: 'Mật khẩu tối thiểu 6 ký tự.' },
            ]}
          >
            <Input.Password placeholder="Nhập mật khẩu mới" />
          </Form.Item>
          <Form.Item
            label="Xác nhận mật khẩu mới"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Vui lòng xác nhận mật khẩu mới.' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Mật khẩu xác nhận không khớp.'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="Nhập lại mật khẩu mới" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Tạo Cửa Hàng Mới */}
      <Modal
        title="Tạo cửa hàng mới"
        open={createOpen}
        okText="Tạo cửa hàng"
        cancelText="Hủy"
        width={isMobile ? 'calc(100vw - 24px)' : 520}
        confirmLoading={submitting}
        onOk={() => form.submit()}
        onCancel={() => !submitting && setCreateOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={createStore}>
          <Form.Item
            label="Tên cửa hàng"
            name="name"
            rules={[{ required: true, message: 'Vui lòng nhập tên cửa hàng.' }]}
          >
            <Input maxLength={160} placeholder="Ví dụ: Billiards Gia Đình" />
          </Form.Item>
          <Form.Item
            label="Tên Owner"
            name="ownerDisplayName"
            rules={[{ required: true, message: 'Vui lòng nhập tên Owner.' }]}
          >
            <Input maxLength={128} placeholder="Tên hiển thị" />
          </Form.Item>
          <Form.Item
            label="Email Owner"
            name="ownerEmail"
            rules={[
              { required: true, message: 'Vui lòng nhập email Owner.' },
              { type: 'email', message: 'Email không hợp lệ.' },
            ]}
          >
            <Input type="email" maxLength={254} placeholder="owner@example.com" />
          </Form.Item>
          <Form.Item
            label="Tên đăng nhập Owner"
            name="ownerUsername"
            tooltip="Nếu để trống sẽ sử dụng Email Owner làm tên đăng nhập."
          >
            <Input maxLength={128} placeholder="Tùy chọn (ví dụ: owner_billiards)" />
          </Form.Item>
          <Form.Item
            label="Mật khẩu khởi tạo"
            name="ownerPassword"
            rules={[
              {
                required: true,
                min: 6,
                message: 'Vui lòng nhập mật khẩu Owner (tối thiểu 6 ký tự).',
              },
            ]}
          >
            <Input.Password placeholder="Nhập mật khẩu cho Owner" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
import 'antd/dist/reset.css';
import '@client/styles/base.css';
