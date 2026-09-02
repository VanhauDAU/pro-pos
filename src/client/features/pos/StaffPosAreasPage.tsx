import 'antd/dist/reset.css';
import '@client/styles/areas.css';

import { PauseCircleOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, ConfigProvider, Empty, Spin } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';

import type { AppBootstrapResponse } from '@contracts/app-bootstrap';
import type { PosOverviewSnapshot, PosOverviewTable } from '@contracts/pos';

import { apiRequest } from '@client/lib/api';
import {
  recordPosStartupReady,
  setPosPerformanceCsrfToken,
  startPosInteraction,
} from '@client/lib/pos-performance';
import { RealtimeProvider, useRealtime } from '@client/realtime/RealtimeProvider';
import { PushNotificationControl } from '@client/features/pwa/PushNotificationControl';

import { PosAppSplash } from './PosAppSplash';
import {
  orderQuoteQueryOptions,
  overviewRefreshInterval,
  type RefreshableOrderQuote,
} from './pos-order-query';
import {
  PosNotificationsProvider,
  StaffBottomNav,
  StaffHeader,
  StaffNotificationCenter,
} from './StaffPosShellShared';

const BRAND = '#0975f7';
const ORDER_HOVER_PREFETCH_DELAY_MS = 80;
type PosTable = PosOverviewTable;
interface AreaOrderQuote extends RefreshableOrderQuote {}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Không thể kết nối máy chủ.';
}

const STATUS_OPTIONS: Array<{ key: 'ALL' | 'OCCUPIED' | 'AVAILABLE'; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'OCCUPIED', label: 'Đang sử dụng' },
  { key: 'AVAILABLE', label: 'Còn trống' },
];

function formatTableShortDuration(occupiedSince: number | null, now: number) {
  if (!occupiedSince) return '0p';
  const totalSecs = Math.max(0, Math.floor((now - occupiedSince) / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) {
    return `${hours}g ${minutes}p`;
  }
  return `${minutes}p`;
}

function AreasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { status: realtimeStatus, serverTimeOffsetMs } = useRealtime();
  const [now, setNow] = useState(() => Date.now() + serverTimeOffsetMs);
  const overview = useQuery<PosOverviewSnapshot>({
    queryKey: ['pos-overview'],
    queryFn: ({ signal }) => apiRequest<PosOverviewSnapshot>('/api/v1/pos/overview', { signal }),
    staleTime: 5_000,
    refetchInterval: (query) =>
      overviewRefreshInterval(
        query.state.data?.tables.some((table) => table.timeSessionStatus === 'RUNNING') ?? false,
        realtimeStatus,
      ),
    refetchOnMount: false,
    refetchOnWindowFocus: 'always',
  });
  const tables = {
    data: overview.data?.tables,
    isLoading: overview.isLoading,
    isError: overview.isError,
  };
  const posOrders = { data: overview.data?.orders };

  useEffect(() => {
    if (!overview.data) return;
    queryClient.setQueryData(['pos-tables'], overview.data.tables);
    queryClient.setQueryData(['pos-orders-list'], overview.data.orders);
    recordPosStartupReady();
  }, [overview.data, queryClient]);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const warmCatalog = () => {
      void queryClient.prefetchQuery({
        queryKey: ['pos-catalog'],
        queryFn: ({ signal }) => apiRequest<unknown[]>('/api/v1/pos/catalog', { signal }),
        staleTime: 15 * 60_000,
      });
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warmCatalog, { timeout: 3_000 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warmCatalog, 1_000);
    return () => window.clearTimeout(id);
  }, [queryClient]);

  const recordCardZoomOrigin = useCallback((element: HTMLElement) => {
    try {
      const rect = element.getBoundingClientRect();
      const root = document.documentElement;
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const scale = Math.max(0.25, Math.min(0.65, rect.width / Math.max(window.innerWidth, 1)));
      root.style.setProperty('--pos-zoom-origin-x', `${Math.round(originX)}px`);
      root.style.setProperty('--pos-zoom-origin-y', `${Math.round(originY)}px`);
      root.style.setProperty('--pos-zoom-scale', scale.toFixed(3));
    } catch {
      // Ignore in non-browser environment
    }
  }, []);

  const prefetchOrder = useCallback(
    (activeOrderId: string) => {
      void queryClient.prefetchQuery(
        orderQuoteQueryOptions<AreaOrderQuote>({
          orderId: activeOrderId,
          enabled: true,
          realtimeStatus,
          projection: 'editor',
        }),
      );
    },
    [queryClient, realtimeStatus],
  );
  const hoverPrefetchTimerRef = useRef<number | null>(null);
  const cancelHoverPrefetch = useCallback(() => {
    if (hoverPrefetchTimerRef.current !== null) {
      window.clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
  }, []);
  const prefetchOrderOnHoverIntent = useCallback(
    (activeOrderId: string) => {
      cancelHoverPrefetch();
      hoverPrefetchTimerRef.current = window.setTimeout(() => {
        hoverPrefetchTimerRef.current = null;
        prefetchOrder(activeOrderId);
      }, ORDER_HOVER_PREFETCH_DELAY_MS);
    },
    [cancelHoverPrefetch, prefetchOrder],
  );
  useEffect(() => cancelHoverPrefetch, [cancelHoverPrefetch]);

  const activeTakeaways = useMemo(() => {
    return (posOrders.data ?? [])
      .filter(
        (o) =>
          o.orderType === 'TAKEAWAY' && (o.status === 'OPEN' || o.status === 'PAYMENT_PENDING'),
      )
      .toSorted((a, b) => a.openedAt - b.openedAt);
  }, [posOrders.data]);

  useEffect(() => {
    const hasActiveOrder =
      tables.data?.some((table) => table.status === 'OCCUPIED') || activeTakeaways.length > 0;
    if (!hasActiveOrder) return undefined;
    const update = () => setNow(Date.now() + serverTimeOffsetMs);
    update();
    const delayToNextMinute = 60_000 - ((Date.now() + serverTimeOffsetMs) % 60_000);
    let interval: number | null = null;
    const timeout = window.setTimeout(() => {
      update();
      interval = window.setInterval(update, 60_000);
    }, delayToNextMinute);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [activeTakeaways.length, serverTimeOffsetMs, tables.data]);

  const areas = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; tables: PosTable[] }
    >();
    for (const table of tables.data ?? []) {
      const existing = map.get(table.areaId);
      if (existing) {
        existing.tables.push(table);
      } else {
        map.set(table.areaId, {
          id: table.areaId,
          name: table.areaName,
          sortOrder: table.areaSortOrder ?? 0,
          tables: [table],
        });
      }
    }
    return [...map.values()].toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }),
    );
  }, [tables.data]);

  const initialArea =
    searchParams.get('tab') === 'takeaway' ||
    (location.state as { selectedArea?: string } | null)?.selectedArea === '__TAKEAWAY__'
      ? '__TAKEAWAY__'
      : ((location.state as { selectedArea?: string } | null)?.selectedArea ?? null);

  const [selectedArea, setSelectedArea] = useState<string | null>(initialArea);
  const [status, setStatus] = useState<'ALL' | 'OCCUPIED' | 'AVAILABLE'>('ALL');

  useEffect(() => {
    const stateArea = (location.state as { selectedArea?: string } | null)?.selectedArea;
    if (searchParams.get('tab') === 'takeaway' || stateArea === '__TAKEAWAY__') {
      setSelectedArea('__TAKEAWAY__');
    } else if (stateArea) {
      setSelectedArea(stateArea);
    }
  }, [searchParams, location.state]);

  const isTakeaway = selectedArea === '__TAKEAWAY__';
  const effectiveAreaId = isTakeaway ? '__TAKEAWAY__' : (selectedArea ?? areas[0]?.id ?? null);
  const currentArea = areas.find((item) => item.id === effectiveAreaId) ?? areas[0];

  const visibleTables =
    currentArea?.tables.filter((table) => status === 'ALL' || table.status === status) ?? [];

  const availableCount = isTakeaway
    ? 0
    : (currentArea?.tables.filter((t) => t.status === 'AVAILABLE').length ?? 0);
  const occupiedCount = isTakeaway
    ? activeTakeaways.length
    : (currentArea?.tables.filter((t) => t.status === 'OCCUPIED').length ?? 0);
  const disabledCount = isTakeaway
    ? 0
    : (currentArea?.tables.filter((t) => t.status === 'DISABLED').length ?? 0);

  return (
    <div className="staff-areas-page">
      {tables.isLoading ? <Spin fullscreen description="Đang tải khu vực" /> : null}
      {tables.isError ? <Alert type="error" showIcon title="Chưa tải được khu vực và bàn" /> : null}
      {overview.isRefetchError && overview.data ? (
        <Alert
          type="warning"
          showIcon
          title="Dữ liệu Khu vực chưa được cập nhật"
          description={errorText(overview.error)}
          action={<Button onClick={() => void overview.refetch()}>Thử lại</Button>}
          style={{ margin: '12px 16px' }}
        />
      ) : null}

      {/* Mobile/iPad Top Bar: Status tabs on top, Area pills + Takeaway below */}
      <div className="staff-areas-mobile-header">
        <div className="staff-status-bar">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`staff-status-tab ${status === opt.key ? 'is-active' : ''}`}
              onClick={() => setStatus(opt.key)}
            >
              <span className="staff-status-tab__label">{opt.label}</span>
            </button>
          ))}
        </div>
        <div className="staff-area-pill-bar">
          <div className="staff-area-pill-list">
            <button
              type="button"
              className={`staff-area-pill staff-area-pill--takeaway ${isTakeaway ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedArea('__TAKEAWAY__');
                setSearchParams({ tab: 'takeaway' }, { replace: true });
              }}
            >
              <ShoppingOutlined /> Mang về
            </button>
            {areas.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`staff-area-pill ${!isTakeaway && item.id === currentArea?.id ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedArea(item.id);
                  setSearchParams({}, { replace: true });
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop Sidebar with Mang về card at the top */}
      <aside className="staff-area-sidebar staff-area-list">
        <button
          type="button"
          className={`staff-area-sidebar__item staff-area-sidebar__item--takeaway ${isTakeaway ? 'is-active' : ''}`}
          onClick={() => {
            setSelectedArea('__TAKEAWAY__');
            setSearchParams({ tab: 'takeaway' }, { replace: true });
          }}
        >
          <ShoppingOutlined /> <span>Mang về</span>
        </button>
        <div className="staff-area-sidebar__divider" />
        {areas.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`staff-area-sidebar__item ${!isTakeaway && item.id === currentArea?.id ? 'is-active' : ''}`}
            onClick={() => {
              setSelectedArea(item.id);
              setSearchParams({}, { replace: true });
            }}
          >
            {item.name}
          </button>
        ))}
      </aside>

      {/* Main Content Area */}
      <main className="staff-area-content">
        {/* Desktop Status Bar */}
        <div className="staff-desktop-status-bar">
          <div className="staff-status-bar">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`staff-status-tab ${status === opt.key ? 'is-active' : ''}`}
                onClick={() => setStatus(opt.key)}
              >
                <span className="staff-status-tab__label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {isTakeaway ? (
          <div className="staff-table-grid">
            {/* Card Tạo đơn mang về mới (luôn hiển thị, giống mẫu ảnh) */}
            {status !== 'OCCUPIED' ? (
              <button
                type="button"
                className="staff-table-card staff-table-card--takeaway-create"
                onPointerDown={(e) => recordCardZoomOrigin(e.currentTarget)}
                onClick={(e) => {
                  recordCardZoomOrigin(e.currentTarget);
                  navigate('/pos/orders/new?type=TAKEAWAY');
                }}
              >
                <div className="staff-takeaway-create-header">
                  <svg
                    className="staff-takeaway-create-icon"
                    width="38"
                    height="25"
                    viewBox="0 0 114 74"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M39.9713 15.4421C40.1863 13.4832 41.8412 12 43.812 12H70.6703C72.641 12 74.2959 13.4832 74.511 15.4421L75.3526 23.1084H39.1296L39.9713 15.4421Z"
                      fill="#AACCF5"
                    />
                    <path
                      d="M32.7784 25.6388C33.1058 20.5556 37.3241 16.6003 42.4178 16.6003H71.5815C76.6752 16.6003 80.8935 20.5556 81.221 25.6388L83.0996 54.8034C83.3507 58.7007 80.2573 61.9997 76.352 61.9997H37.6474C33.742 61.9997 30.6487 58.7007 30.8997 54.8034L32.7784 25.6388Z"
                      fill="#81A7D5"
                    />
                    <mask
                      id="mask0_takeaway_card"
                      style={{ maskType: 'alpha' }}
                      maskUnits="userSpaceOnUse"
                      x="30"
                      y="16"
                      width="54"
                      height="46"
                    >
                      <path
                        d="M32.779 25.639C33.1064 20.5558 37.3247 16.6004 42.4184 16.6004H71.5821C76.6758 16.6004 80.8941 20.5558 81.2216 25.639L83.1002 54.8036C83.3513 58.7009 80.2579 61.9999 76.3526 61.9999H37.648C33.7426 61.9999 30.6493 58.7009 30.9003 54.8036L32.779 25.639Z"
                        fill="#6682A3"
                      />
                    </mask>
                    <g mask="url(#mask0_takeaway_card)">
                      <g filter="url(#filter0_takeaway_card)">
                        <ellipse
                          cx="40.2927"
                          cy="56.207"
                          rx="28.0486"
                          ry="28.6584"
                          fill="#C1DAF9"
                          fillOpacity="0.7"
                        />
                      </g>
                    </g>
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M46.376 25.0522C47.843 25.0522 49.0323 26.2415 49.0323 27.7085C49.0323 32.4318 52.763 36.1606 57.2428 36.1606C61.7227 36.1606 65.4534 32.4318 65.4534 27.7085C65.4534 26.2415 66.6427 25.0522 68.1097 25.0522C69.5768 25.0522 70.7661 26.2415 70.7661 27.7085C70.7661 35.2552 64.7663 41.4733 57.2428 41.4733C49.7194 41.4733 43.7196 35.2552 43.7196 27.7085C43.7196 26.2415 44.9089 25.0522 46.376 25.0522Z"
                      fill="url(#paint0_takeaway_card)"
                    />
                    <defs>
                      <filter
                        id="filter0_takeaway_card"
                        x="-16.7343"
                        y="-1.42981"
                        width="114.054"
                        height="115.274"
                        filterUnits="userSpaceOnUse"
                        colorInterpolationFilters="sRGB"
                      >
                        <feFlood floodOpacity="0" result="BackgroundImageFix" />
                        <feBlend
                          mode="normal"
                          in="SourceGraphic"
                          in2="BackgroundImageFix"
                          result="shape"
                        />
                        <feGaussianBlur
                          stdDeviation="14.4892"
                          result="effect1_foregroundBlur_9518_135563"
                        />
                      </filter>
                      <linearGradient
                        id="paint0_takeaway_card"
                        x1="57.2428"
                        y1="25.0522"
                        x2="57.2428"
                        y2="35.6776"
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop stopColor="#D0DCF7" />
                        <stop offset="1" stopColor="#F4FEFF" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <strong className="staff-takeaway-create-title">Mang về</strong>
                </div>
              </button>
            ) : null}

            {/* Các đơn mang về đang hoạt động ("Mang về 01", "Mang về 02", ...) */}
            {status !== 'AVAILABLE'
              ? activeTakeaways.map((takeawayOrder, index) => {
                  const label = `Mang về ${String(index + 1).padStart(2, '0')}`;
                  return (
                    <button
                      type="button"
                      key={takeawayOrder.id}
                      className="staff-table-card staff-table-card--occupied"
                      onPointerEnter={() => prefetchOrderOnHoverIntent(takeawayOrder.id)}
                      onPointerLeave={cancelHoverPrefetch}
                      onPointerDown={(e) => {
                        startPosInteraction('order-shell');
                        startPosInteraction('order-verified');
                        cancelHoverPrefetch();
                        recordCardZoomOrigin(e.currentTarget);
                        prefetchOrder(takeawayOrder.id);
                      }}
                      onFocus={() => prefetchOrder(takeawayOrder.id)}
                      onClick={(e) => {
                        recordCardZoomOrigin(e.currentTarget);
                        navigate(`/pos/orders/${takeawayOrder.id}`);
                      }}
                    >
                      <div className="staff-table-card__header">
                        <strong className="staff-table-card__name">{label}</strong>
                      </div>
                      <div className="staff-table-card__body">
                        <div className="staff-table-card__meta">
                          <span>{formatTableShortDuration(takeawayOrder.openedAt, now)}</span>
                          <span className="staff-table-card__dot">•</span>
                          <span>{takeawayOrder.itemCount ?? 0} món</span>
                        </div>
                        <div className="staff-table-card__total">
                          {formatMoney(takeawayOrder.totalVnd ?? 0)}
                        </div>
                      </div>
                    </button>
                  );
                })
              : null}
          </div>
        ) : visibleTables.length === 0 ? (
          <Empty description="Khu vực chưa có bàn phù hợp" style={{ padding: '60px 0' }} />
        ) : (
          <div className="staff-table-grid">
            {visibleTables.map((table) => {
              const isOccupied = table.status === 'OCCUPIED';
              const isPaused = table.timeSessionStatus === 'PAUSED';

              return (
                <button
                  type="button"
                  key={table.id}
                  disabled={table.status === 'DISABLED'}
                  className={[
                    'staff-table-card',
                    `staff-table-card--${table.status.toLowerCase()}`,
                    isPaused && 'staff-table-card--paused',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerEnter={() => {
                    if (table.activeOrderId) prefetchOrderOnHoverIntent(table.activeOrderId);
                  }}
                  onPointerLeave={cancelHoverPrefetch}
                  onPointerDown={(e) => {
                    startPosInteraction('order-shell');
                    startPosInteraction('order-verified');
                    recordCardZoomOrigin(e.currentTarget);
                    if (table.activeOrderId) {
                      cancelHoverPrefetch();
                      prefetchOrder(table.activeOrderId);
                    }
                  }}
                  onFocus={() => {
                    if (table.activeOrderId) prefetchOrder(table.activeOrderId);
                  }}
                  onClick={(e) => {
                    recordCardZoomOrigin(e.currentTarget);
                    if (table.activeOrderId) navigate(`/pos/orders/${table.activeOrderId}`);
                    else navigate(`/pos/orders/new?tableId=${table.id}`);
                  }}
                >
                  <div className="staff-table-card__header">
                    <strong className="staff-table-card__name">{table.name}</strong>
                    {isOccupied && isPaused && (
                      <span className="staff-table-card__paused-badge">
                        <PauseCircleOutlined /> Tạm dừng
                      </span>
                    )}
                  </div>
                  {isOccupied ? (
                    <div className="staff-table-card__body">
                      <div className="staff-table-card__meta">
                        <span>{formatTableShortDuration(table.occupiedSince, now)}</span>
                        <span className="staff-table-card__dot">•</span>
                        <span>
                          {table.guestCount && table.guestCount > 0
                            ? `${table.guestCount} khách`
                            : `${table.itemCount ?? 0} món`}
                        </span>
                      </div>
                      <div className="staff-table-card__total">
                        {formatMoney(table.totalVnd ?? 0)}
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {/* Sticky 3 Status Dots Legend (Bàn trống, Đang sử dụng, Tạm ngưng) */}
        {!isTakeaway ? (
          <div className="staff-table-status-legend">
            <div className="staff-table-legend-item">
              <span className="staff-table-legend-dot staff-table-legend-dot--available" />
              <span className="staff-table-legend-label">Bàn trống</span>
              <span className="staff-table-legend-count">{availableCount}</span>
            </div>
            <div className="staff-table-legend-item">
              <span className="staff-table-legend-dot staff-table-legend-dot--occupied" />
              <span className="staff-table-legend-label">Đang sử dụng</span>
              <span className="staff-table-legend-count">{occupiedCount}</span>
            </div>
            <div className="staff-table-legend-item">
              <span className="staff-table-legend-dot staff-table-legend-dot--disabled" />
              <span className="staff-table-legend-label">Tạm ngưng</span>
              <span className="staff-table-legend-count">{disabledCount}</span>
            </div>
          </div>
        ) : (
          <div className="staff-table-status-legend">
            <div className="staff-table-legend-item">
              <span className="staff-table-legend-dot staff-table-legend-dot--occupied" />
              <span className="staff-table-legend-label">Đang phục vụ mang về</span>
              <span className="staff-table-legend-count">{activeTakeaways.length}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StaffPosAreasReady({ bootstrap }: { bootstrap: AppBootstrapResponse }) {
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const permissions = bootstrap.pos?.context.permissions ?? [];
  const canViewAreas = ['table.view', 'order.create', 'order.manage'].some((permission) =>
    permissions.includes(permission),
  );

  useEffect(() => {
    setPosPerformanceCsrfToken(bootstrap.auth.csrfToken);
    return () => setPosPerformanceCsrfToken(null);
  }, [bootstrap.auth.csrfToken]);

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND, borderRadius: 8 } }}>
      <RealtimeProvider>
        <PosNotificationsProvider>
          <div className="staff-pos-shell">
            <PushNotificationControl csrfToken={bootstrap.auth.csrfToken} autoPrompt />
            <StaffHeader
              context={bootstrap.auth}
              onOpenNotifications={() => setNotificationCenterOpen(true)}
            />
            <div className="staff-pos-main">
              {canViewAreas ? (
                <AreasPage />
              ) : (
                <div style={{ padding: 24 }}>
                  <Alert
                    type="warning"
                    showIcon
                    title="Không có quyền xem khu vực"
                    description="Vai trò hiện tại chưa được cấp quyền xem bàn hoặc quản lý đơn hàng."
                  />
                </div>
              )}
            </div>
            <StaffBottomNav active="areas" />
            <StaffNotificationCenter
              open={notificationCenterOpen}
              onClose={() => setNotificationCenterOpen(false)}
            />
          </div>
        </PosNotificationsProvider>
      </RealtimeProvider>
    </ConfigProvider>
  );
}

export function StaffPosAreasPage({
  bootstrap,
  bootstrapError,
  bootstrapLoading = false,
  retryBootstrap,
}: {
  bootstrap?: AppBootstrapResponse;
  bootstrapError?: Error | null;
  bootstrapLoading?: boolean;
  retryBootstrap?: () => void;
}) {
  if (bootstrapLoading || !bootstrap) {
    return bootstrapError ? (
      <div className="pos-app-splash" role="alert">
        <div className="pos-app-splash__content">
          <strong>Chưa thể tải dữ liệu POS</strong>
          <div className="pos-app-splash__message">{errorText(bootstrapError)}</div>
          <Button type="primary" onClick={retryBootstrap}>
            Thử lại
          </Button>
        </div>
      </div>
    ) : (
      <PosAppSplash message="Đang nạp dữ liệu POS..." />
    );
  }
  if (bootstrap.auth.actor?.kind !== 'EMPLOYEE' || !bootstrap.pos) {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }
  return <StaffPosAreasReady bootstrap={bootstrap} />;
}
