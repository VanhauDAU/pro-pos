import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  GiftOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  ReloadOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  TagOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Modal,
  Result,
  Row,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type { OrderDetailDto, OrderItemDetail } from '@contracts/order-detail';
import type { StorePrintSettings } from '@contracts/store';
import { calculateTimePrice } from '@domain/pricing/engine';
import { apiRequest } from '@client/lib/api';
import {
  printReceipt,
  type PosReceiptPrintData,
  type PosReceiptPrintOptions,
  type PosReceiptTimeSegment,
} from '@client/lib/pos-receipt-printer';
import { usePosPollingInterval, useRealtime } from '@client/realtime/RealtimeProvider';
import { toast } from 'sonner';

const ReceiptPreviewModal = lazy(async () => {
  const module = await import('./ReceiptPreviewModal');
  return { default: module.ReceiptPreviewModal };
});

const ReceiptPreviewPaper = lazy(async () => {
  const module = await import('./ReceiptPreviewModal');
  return { default: module.ReceiptPreviewPaper };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '0đ';
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function formatClock(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTime(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationHuman(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '0 phút';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  if (s > 0 || parts.length === 0) parts.push(`${s} giây`);
  return parts.join(' ');
}

function statusBadge(status: OrderDetailDto['order']['status']) {
  switch (status) {
    case 'OPEN':
      return (
        <Tag color="processing" icon={<PlayCircleOutlined />}>
          Đang phục vụ
        </Tag>
      );
    case 'PAYMENT_PENDING':
      return (
        <Tag color="warning" icon={<PauseCircleOutlined />}>
          Chờ thanh toán / Tạm dừng
        </Tag>
      );
    case 'PAID':
      return (
        <Tag color="success" icon={<CheckCircleOutlined />}>
          Đã hoàn thành
        </Tag>
      );
    case 'CANCELLED':
      return (
        <Tag color="error" icon={<CloseCircleOutlined />}>
          Đã hủy
        </Tag>
      );
  }
}

function paymentMethodTag(method: 'CASH' | 'BANK_TRANSFER') {
  if (method === 'CASH') {
    return (
      <Tag color="green" icon={<WalletOutlined />}>
        Tiền mặt
      </Tag>
    );
  }
  return (
    <Tag color="blue" icon={<CreditCardOutlined />}>
      Chuyển khoản / QR
    </Tag>
  );
}

function allocationMethodTag(method: 'CASH' | 'BANK_TRANSFER' | 'DEBT') {
  if (method === 'DEBT') return <Tag color="orange">Ghi nợ - Thanh toán sau</Tag>;
  return paymentMethodTag(method);
}

function OrderDetailMobileItemsList({ items }: { items: OrderItemDetail[] }) {
  if (items.length === 0) {
    return <Empty description="Chưa gọi mặt hàng nào" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="order-detail-mobile-items-list">
      {items.map((it, idx) => {
        const isGift =
          (it.discountAmountVnd > 0 && it.netLineTotalVnd === 0) ||
          it.discountReason?.toLowerCase().includes('quà tặng');
        const qty = it.quantityMilli / 1000;

        return (
          <div key={it.id || idx} className="order-detail-mobile-item-card">
            {/* Header: Avatar, Name & Net Total */}
            <div className="order-detail-mobile-item-head">
              <div className="order-detail-mobile-item-thumb">
                {it.mediaId ? (
                  <img
                    src={`/api/v1/media/${it.mediaId}`}
                    alt=""
                    className="order-detail-mobile-item-img"
                  />
                ) : it.avatarColor ? (
                  <span
                    className="order-detail-mobile-item-color"
                    style={{ backgroundColor: it.avatarColor }}
                  />
                ) : (
                  <span className="order-detail-mobile-item-fallback">
                    <ShoppingCartOutlined />
                  </span>
                )}
              </div>

              <div className="order-detail-mobile-item-info">
                <div className="order-detail-mobile-item-title-row">
                  <strong className="order-detail-mobile-item-name">
                    {it.productNameSnapshot}
                  </strong>
                  {isGift && (
                    <Tag color="green" style={{ marginLeft: 4 }}>
                      Quà tặng
                    </Tag>
                  )}
                </div>
                {it.variantNameSnapshot && (
                  <div className="order-detail-mobile-item-variant">
                    Phân loại: <strong>{it.variantNameSnapshot}</strong>
                  </div>
                )}
              </div>

              <div className="order-detail-mobile-item-prices">
                <strong className="order-detail-mobile-item-net">
                  {formatMoney(it.netLineTotalVnd)}
                </strong>
                {it.discountAmountVnd > 0 && (
                  <span className="order-detail-mobile-item-gross">
                    {formatMoney(it.grossLineTotalVnd)}
                  </span>
                )}
              </div>
            </div>

            {/* Meta & Price Breakdown */}
            <div className="order-detail-mobile-item-meta">
              <Tag color="blue" className="order-detail-mobile-qty-tag">
                x{qty} {it.unitNameSnapshot ?? ''}
              </Tag>
              <span className="order-detail-mobile-unit-price">
                Đơn giá: {formatMoney(it.unitPriceSnapshot)}
              </span>
              {it.discountAmountVnd > 0 && (
                <Tag color="error" className="order-detail-mobile-disc-tag">
                  Giảm -{formatMoney(it.discountAmountVnd)}
                  {it.discountType === 'PERCENT' && it.discountInputValue
                    ? ` (${it.discountInputValue}%)`
                    : ''}
                </Tag>
              )}
            </div>

            {/* Note & Reason */}
            {it.discountReason && it.discountAmountVnd > 0 && (
              <div className="order-detail-mobile-item-reason">
                Lý do giảm: <span>{it.discountReason}</span>
              </div>
            )}
            {it.note && (
              <div className="order-detail-mobile-item-note">
                Ghi chú: <span>{it.note}</span>
              </div>
            )}

            {/* Footer: Staff & Timestamp */}
            <div className="order-detail-mobile-item-foot">
              <span>Thêm bởi: {it.addedByName ?? 'Nhân viên'}</span>
              <span>{formatDateTime(it.addedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OrderDetailPage({
  orderId: propOrderId,
  onClose,
}: {
  orderId?: string;
  onClose?: () => void;
}) {
  const params = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messageApi = toast;
  const contextHolder = null;
  const targetOrderId = propOrderId ?? params.orderId;

  const [activeTab, setActiveTab] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [receiptModalType, setReceiptModalType] = useState<'PROVISIONAL' | 'PAYMENT'>('PAYMENT');
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const detailPollingInterval = usePosPollingInterval(5_000);
  const { serverTimeOffsetMs } = useRealtime();

  const location = useLocation();
  const authQuery = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
    staleTime: 10 * 60_000,
    refetchOnMount: false,
  });
  const isOwner =
    authQuery.data?.allowedEntrypoints?.includes('OWNER') ||
    authQuery.data?.actor?.kind === 'OWNER';
  const isPos = location.pathname.startsWith('/pos');

  const deleteMutation = useMutation({
    mutationFn: () => {
      const endpoint =
        isPos || !isOwner
          ? `/api/v1/pos/invoices/${targetOrderId}`
          : `/api/v1/owner/invoices/${targetOrderId}`;
      return apiRequest<{ deleted: boolean }>(endpoint, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authQuery.data?.csrfToken ?? '' },
      });
    },
    onSuccess: async () => {
      void messageApi.success('Đã xóa hóa đơn thành công.');
      setDeleteConfirmVisible(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/v1/owner/invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/v1/pos/invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-invoice'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-order-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-analytics'] }),
      ]);
      if (onClose) {
        onClose();
      } else if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate('/pos/invoices');
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Không thể xóa hóa đơn.';
      void messageApi.error(msg);
    },
  });

  // Realtime clock update for OPEN orders
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now() + serverTimeOffsetMs);
    }, 1000);
    return () => clearInterval(timer);
  }, [serverTimeOffsetMs]);

  const detailQuery = useQuery({
    queryKey: ['pos-order-detail', targetOrderId],
    queryFn: ({ signal }) =>
      apiRequest<OrderDetailDto>(`/api/v1/pos/orders/${targetOrderId}/detail`, { signal }),
    enabled: Boolean(targetOrderId),
    refetchInterval: (query) =>
      query.state.data?.order.status === 'OPEN' ? detailPollingInterval : false,
  });

  const data = detailQuery.data;
  const invoicePromotions = useMemo(() => {
    if (!data?.invoice?.snapshotJson) return [];
    try {
      const snapshot = JSON.parse(data.invoice.snapshotJson) as {
        promotion?: {
          id?: string;
          name: string;
          type: string;
          scope?: string;
          value: number | null;
          discountAmountVnd: number;
          giftItems?: Array<{
            productId: string;
            variantId: string | null;
            productName: string;
            variantName: string | null;
            unitName: string | null;
            unitPriceVnd: number;
            quantityMilli: number;
            grossAmountVnd: number;
          }>;
          flatPriceItems?: Array<{
            productId: string;
            variantId: string | null;
            productName: string;
            variantName: string | null;
            quantityMilli: number;
            originalUnitPriceVnd: number;
            flatUnitPriceVnd: number;
            discountAmountVnd: number;
          }>;
        } | null;
        promotions?: Array<{
          id?: string;
          name: string;
          type: string;
          scope?: string;
          value: number | null;
          discountAmountVnd: number;
          giftItems?: Array<{
            productId: string;
            variantId: string | null;
            productName: string;
            variantName: string | null;
            unitName: string | null;
            unitPriceVnd: number;
            quantityMilli: number;
            grossAmountVnd: number;
          }>;
          flatPriceItems?: Array<{
            productId: string;
            variantId: string | null;
            productName: string;
            variantName: string | null;
            quantityMilli: number;
            originalUnitPriceVnd: number;
            flatUnitPriceVnd: number;
            discountAmountVnd: number;
          }>;
        }>;
      };
      return snapshot.promotions ?? (snapshot.promotion ? [snapshot.promotion] : []);
    } catch {
      return [];
    }
  }, [data?.invoice?.snapshotJson]);

  const appliedPromotions = useMemo(() => {
    if (data?.promotions && data.promotions.length > 0) return data.promotions;
    return invoicePromotions;
  }, [data?.promotions, invoicePromotions]);

  const invoicePromotionDiscount = appliedPromotions.reduce(
    (sum, promotion) => sum + promotion.discountAmountVnd,
    0,
  );

  // Realtime active segment duration calculation
  const liveTimeSegments = useMemo(() => {
    if (!data?.timeSegments) return [];
    if (data.order.status !== 'OPEN' || data.timeSummary?.status === 'PAUSED')
      return data.timeSegments;

    return data.timeSegments.map((seg) => {
      if (seg.isCurrentActive) {
        const liveElapsed = Math.max(1, Math.floor((now - seg.startedAt) / 1000));
        const ratePerSec = seg.unitPriceSnapshot / 3600;
        const liveAmount = Math.round(liveElapsed * ratePerSec);
        return {
          ...seg,
          elapsedSeconds: liveElapsed,
          amountBeforeRoundingVnd: liveAmount,
          amountAfterRoundingVnd: Math.ceil(liveAmount / 1000) * 1000,
        };
      }
      return seg;
    });
  }, [data?.timeSegments, data?.order.status, data?.timeSummary?.status, now]);

  const liveTotalElapsed = useMemo(() => {
    return liveTimeSegments.reduce((sum, s) => sum + s.elapsedSeconds, 0);
  }, [liveTimeSegments]);

  const liveTotalTimeAmount = useMemo(() => {
    return liveTimeSegments.reduce((sum, s) => sum + s.amountAfterRoundingVnd, 0);
  }, [liveTimeSegments]);

  const liveGrandTotal = useMemo(() => {
    if (!data) return 0;
    if (data.order.status === 'PAID' && data.invoice) {
      return data.invoice.totalVnd;
    }
    const itemTotal = data.items.reduce((sum, it) => sum + it.netLineTotalVnd, 0);
    return liveTotalTimeAmount + itemTotal;
  }, [data, liveTotalTimeAmount]);

  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () =>
      apiRequest<{
        storeName?: string;
        storePhone?: string | null;
        storeAddress?: string | null;
        bankName?: string | null;
        bankAccountNumber?: string | null;
        bankAccountName?: string | null;
      }>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const buildReceiptPrintData = (receiptType: 'PROVISIONAL' | 'PAYMENT'): PosReceiptPrintData => {
    if (!data) {
      throw new Error('Chưa tải được dữ liệu đơn hàng');
    }
    const isPayment = receiptType === 'PAYMENT' && Boolean(data.invoice);
    const successfulPayment = data.payments.find((payment) => payment.status === 'SUCCEEDED');

    const printData: PosReceiptPrintData = {
      receiptType,
      orderCode:
        data.invoice?.displayCode ||
        data.order.displayCode ||
        data.order.id.slice(-6).toUpperCase(),
      invoiceCode: data.invoice?.displayCode || null,
      orderType: data.order.orderType,
      tableName: data.order.tableName,
      areaName: data.order.areaName,
      cashierName: data.invoice?.issuedByName ?? authQuery.data?.actor?.displayName ?? null,
      customerName: data.customer?.name ?? null,
      guestPhone: data.customer?.phone ?? null,
      guestAddress: null,
      note: data.order.note,
      checkInTimeMs: data.order.openedAt,
      issuedAtMs: data.invoice?.issuedAt || Date.now(),
      subtotal: isPayment ? data.invoice!.subtotalVnd : liveGrandTotal,
      discountTotal: isPayment ? data.invoice!.discountTotalVnd : data.totals.totalDiscountVnd,
      promotionDiscount: isPayment
        ? invoicePromotionDiscount
        : data.totals.orderDiscountAmountVnd || 0,
      promotion: invoicePromotions[0] ?? null,
      promotions: invoicePromotions,
      total: isPayment ? data.invoice!.totalVnd : liveGrandTotal,
      paymentMethod: isPayment ? (successfulPayment?.method ?? null) : null,
      cashReceived: isPayment ? (successfulPayment?.cashReceived ?? null) : null,
      cashChange: isPayment ? (successfulPayment?.cashChange ?? null) : null,
      lines: [
        ...(liveTimeSegments.length > 0
          ? [
              {
                id: 'time-session',
                name: 'Tiền giờ',
                quantity: 1,
                unitPrice: liveTimeSegments[0]?.unitPriceSnapshot ?? liveTotalTimeAmount,
                totalPrice: liveTotalTimeAmount,
                isTime: true,
                timeStartedAtMs: data.order.openedAt,
                timeEndedAtMs:
                  data.order.status === 'OPEN' ? null : (data.order.closedAt ?? Date.now()),
                timeElapsedSeconds: liveTotalElapsed,
                timeSegments: liveTimeSegments.flatMap((s): PosReceiptTimeSegment[] => {
                  if (s.pricingRuleSnapshot) {
                    const singlePricing = calculateTimePrice({
                      startedAtMs: s.startedAt,
                      endedAtMs:
                        s.endedAt ??
                        (data.order.status === 'OPEN' ? now : (data.order.closedAt ?? now)),
                      config: s.pricingRuleSnapshot,
                    });
                    if (singlePricing.segments && singlePricing.segments.length > 0) {
                      return singlePricing.segments.map((ps): PosReceiptTimeSegment => ({
                        name: ps.name,
                        type: ps.type,
                        startedAtMs: ps.startedAtMs,
                        endedAtMs: ps.endedAtMs,
                        elapsedSeconds: ps.elapsedSeconds,
                        priceVnd: ps.priceVnd,
                        amount: ps.amountBeforeRoundingVnd,
                      }));
                    }
                  }
                  return [
                    {
                      name: s.rateNameSnapshot || 'Giá tính giờ',
                      type: 'BASE' as const,
                      startedAtMs: s.startedAt,
                      endedAtMs: s.endedAt,
                      elapsedSeconds: s.elapsedSeconds,
                      priceVnd: s.unitPriceSnapshot,
                      amount: s.amountAfterRoundingVnd,
                    },
                  ];
                }),
                tableSegments: liveTimeSegments.map((s) => ({
                  tableName: s.tableName,
                  startedAtMs: s.startedAt,
                  endedAtMs: s.endedAt,
                  elapsedSeconds: s.elapsedSeconds,
                  amount: s.amountAfterRoundingVnd,
                  hourlyPrice: s.unitPriceSnapshot,
                })),
              },
            ]
          : []),
        ...data.items.map((it) => ({
          id: it.id,
          name: it.productNameSnapshot,
          quantity: it.quantityMilli / 1000,
          unitPrice: it.unitPriceSnapshot,
          totalPrice: it.netLineTotalVnd,
          unitName: it.unitNameSnapshot,
          note: it.note,
          discountAmount: it.discountAmountVnd,
          discountReason: it.discountReason,
          isTime: it.productType === 'TIME',
          timeStartedAtMs: it.timeStartedAtMs ?? undefined,
          timeEndedAtMs: it.timeEndedAtMs,
        })),
      ],
    };
    if (isPayment) {
      printData.paymentAllocations = data.paymentAllocations.map((allocation) => ({
        method: allocation.method,
        amountVnd: allocation.amountVnd,
      }));
      printData.paidAmountVnd = data.totals.paidAmountVnd;
      printData.debtAmountVnd = data.totals.debtAmountVnd;
    }
    return printData;
  };

  const currentReceiptPrintOptions = useMemo<PosReceiptPrintOptions | null>(() => {
    if (!data) return null;
    const printData = buildReceiptPrintData(receiptModalType);
    return {
      data: printData,
      printSettings: printSettings.data,
      storeInfo: {
        storeName: staffContext.data?.storeName ?? data.order.storeName,
        phone: staffContext.data?.storePhone ?? null,
        address: staffContext.data?.storeAddress ?? null,
        bankName: staffContext.data?.bankName ?? null,
        bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
        bankAccountName: staffContext.data?.bankAccountName ?? null,
      },
    };
  }, [
    data,
    receiptModalType,
    printSettings.data,
    staffContext.data,
    liveGrandTotal,
    liveTotalElapsed,
    liveTotalTimeAmount,
    liveTimeSegments,
    invoicePromotions,
    invoicePromotionDiscount,
    authQuery.data?.actor?.displayName,
  ]);

  const handlePrintReceipt = async (receiptType: 'PROVISIONAL' | 'PAYMENT') => {
    if (!data) return;
    const printData = buildReceiptPrintData(receiptType);

    const result = await printReceipt({
      data: printData,
      printSettings: printSettings.data,
      storeInfo: {
        storeName: staffContext.data?.storeName ?? data.order.storeName,
        phone: staffContext.data?.storePhone ?? null,
        address: staffContext.data?.storeAddress ?? null,
        bankName: staffContext.data?.bankName ?? null,
        bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
        bankAccountName: staffContext.data?.bankAccountName ?? null,
      },
    });
    if (result.success) messageApi.success('Đã gửi lệnh in hóa đơn.');
    else messageApi.error(result.message ?? 'Không thể in hóa đơn.');
  };

  if (detailQuery.isLoading) {
    return (
      <div className="order-detail-page order-detail-page--loading">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }

  if (detailQuery.isError || !data) {
    return (
      <div className="order-detail-page">
        <Result
          status="404"
          title="Không tìm thấy đơn hàng"
          subTitle="Đơn hàng không tồn tại hoặc bạn không có quyền truy cập."
          extra={
            <Button
              type="primary"
              onClick={() => (onClose ? onClose() : navigate('/pos/areas'))}
              icon={<ArrowLeftOutlined />}
            >
              Quay lại khu vực
            </Button>
          }
        />
      </div>
    );
  }

  const {
    order,
    customer,
    tableTransfers,
    rateChanges,
    items,
    checkout,
    payments,
    paymentAllocations,
    invoice,
    auditEvents,
    totals,
  } = data;
  const orderCode =
    order.displayCode || (order.id ? `D-${order.id.slice(0, 8).toUpperCase()}` : '—');

  const itemColumns: TableColumnsType<OrderItemDetail> = [
    {
      key: 'productName',
      title: 'Mặt hàng',
      dataIndex: 'productNameSnapshot',
      render: (name: string, row: OrderItemDetail) => {
        const isGift =
          (row.discountAmountVnd > 0 && row.netLineTotalVnd === 0) ||
          row.discountReason?.toLowerCase().includes('quà tặng');
        return (
          <div className="order-detail-item-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {row.mediaId ? (
                <img
                  src={`/api/v1/media/${row.mediaId}`}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }}
                />
              ) : row.avatarColor ? (
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    backgroundColor: row.avatarColor,
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <strong className="order-detail-item-title">{name}</strong>
              {isGift && <Tag color="green">Quà tặng</Tag>}
            </div>
            {row.variantNameSnapshot && (
              <small className="order-detail-item-variant"> · {row.variantNameSnapshot}</small>
            )}
            {row.note && <div className="order-detail-item-note">Ghi chú: {row.note}</div>}
            {row.discountReason && row.discountAmountVnd > 0 && (
              <div style={{ fontSize: 11, color: '#e11d48', marginTop: 2 }}>
                Lý do giảm: {row.discountReason}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'quantity',
      title: 'Số lượng',
      dataIndex: 'quantityMilli',
      align: 'right',
      width: 110,
      render: (milli: number, row: OrderItemDetail) => {
        const qty = milli / 1000;
        return (
          <span>
            {qty} {row.unitNameSnapshot ?? ''}
          </span>
        );
      },
    },
    {
      key: 'unitPrice',
      title: 'Đơn giá',
      dataIndex: 'unitPriceSnapshot',
      align: 'right',
      width: 120,
      render: (price: number) => formatMoney(price),
    },
    {
      key: 'discount',
      title: 'Giảm giá',
      dataIndex: 'discountAmountVnd',
      align: 'right',
      width: 120,
      render: (disc: number, row: OrderItemDetail) => {
        if (!disc || disc <= 0) return <span className="text-secondary">—</span>;
        return (
          <span className="order-detail-discount-text">
            -{formatMoney(disc)}
            {row.discountType === 'PERCENT' && row.discountInputValue && (
              <small> ({row.discountInputValue}%)</small>
            )}
          </span>
        );
      },
    },
    {
      key: 'netTotal',
      title: 'Thành tiền',
      dataIndex: 'netLineTotalVnd',
      align: 'right',
      width: 130,
      render: (total: number) => <strong>{formatMoney(total)}</strong>,
    },
    {
      key: 'meta',
      title: 'Nhân viên / Giờ',
      align: 'right',
      width: 150,
      render: (_: unknown, row: OrderItemDetail) => (
        <div className="order-detail-meta-cell">
          <small>{row.addedByName ?? '—'}</small>
          <small className="text-secondary">{formatClock(row.addedAt)}</small>
        </div>
      ),
    },
  ];

  return (
    <div className="order-detail-page">
      {contextHolder}
      {/* ── Top Header Navigation ── */}
      <div className="order-detail-header">
        <div className="order-detail-header__left">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => (onClose ? onClose() : navigate(-1))}
            className="order-detail-back-btn"
          >
            Quay lại
          </Button>
          <div className="order-detail-header__title-group">
            <Typography.Title level={3} style={{ margin: 0 }}>
              Chi tiết đơn hàng: <span className="order-detail-code">{orderCode}</span>
            </Typography.Title>
            <Space size={8} wrap orientation="horizontal" style={{ marginTop: 4 }}>
              {statusBadge(order.status)}
              <Tag
                icon={order.orderType === 'DINE_IN' ? <ShopOutlined /> : <ShoppingCartOutlined />}
                color={order.orderType === 'DINE_IN' ? 'blue' : 'purple'}
              >
                {order.orderType === 'DINE_IN' ? 'Tại bàn' : 'Mang về'}
              </Tag>
              {order.tableName && (
                <Tag icon={<EnvironmentOutlined />} color="cyan">
                  {order.tableName} {order.areaName ? `(${order.areaName})` : ''}
                </Tag>
              )}
            </Space>
          </div>
        </div>

        <div className="order-detail-header__right">
          <Space wrap size={10}>
            <Tooltip title="Làm mới dữ liệu">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void detailQuery.refetch()}
                loading={detailQuery.isFetching}
              />
            </Tooltip>

            {order.status === 'OPEN' && (
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => navigate(`/pos/orders/${order.id}`)}
              >
                Vào màn hình gọi món
              </Button>
            )}

            {order.status === 'PAYMENT_PENDING' && (
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => navigate(`/pos/orders/${order.id}/payment`)}
                style={{ backgroundColor: '#10b981' }}
              >
                Thanh toán / Tiếp tục chơi
              </Button>
            )}

            {!invoice && order.status !== 'CANCELLED' && (
              <>
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => {
                    setReceiptModalType('PROVISIONAL');
                    setReceiptModalVisible(true);
                  }}
                >
                  Xem tạm tính
                </Button>
                <Button
                  icon={<PrinterOutlined />}
                  onClick={() => handlePrintReceipt('PROVISIONAL')}
                >
                  In tạm tính
                </Button>
              </>
            )}

            {invoice && (
              <>
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => {
                    setReceiptModalType('PAYMENT');
                    setReceiptModalVisible(true);
                  }}
                >
                  Xem hóa đơn
                </Button>
                <Button
                  type="primary"
                  icon={<PrinterOutlined />}
                  onClick={() => handlePrintReceipt('PAYMENT')}
                >
                  In hóa đơn
                </Button>
              </>
            )}

            {isOwner && (invoice || order.status === 'PAID' || order.status === 'CANCELLED') && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => setDeleteConfirmVisible(true)}
              >
                Xóa hóa đơn
              </Button>
            )}
          </Space>
        </div>
      </div>

      {/* ── Table Usage Chain Flow Banner (If transfers occurred) ── */}
      {order.tableUsageChain && order.tableUsageChain.length > 1 && (
        <Card className="order-detail-chain-banner" size="small">
          <div className="order-detail-chain-content">
            <span className="order-detail-chain-label">
              <SwapOutlined style={{ marginRight: 6, color: '#0975F7' }} />
              <strong>Lịch sử chuyển bàn:</strong>
            </span>
            <div className="order-detail-chain-nodes">
              {order.tableUsageChain.map((name, idx) => (
                <span key={idx} className="order-detail-chain-node">
                  <Tag color={idx === order.tableUsageChain.length - 1 ? 'gold' : 'blue'}>
                    {name}
                  </Tag>
                  {idx < order.tableUsageChain.length - 1 && (
                    <ArrowRightOutlined className="order-detail-chain-arrow" />
                  )}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ── Tabs Navigation ── */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="order-detail-tabs"
        items={[
          {
            key: 'overview',
            label: (
              <span>
                <InfoCircleOutlined /> Tổng quan
              </span>
            ),
          },
          {
            key: 'time',
            label: (
              <span>
                <ClockCircleOutlined /> Tiền giờ & Bàn ({liveTimeSegments.length})
              </span>
            ),
            disabled: order.orderType === 'TAKEAWAY',
          },
          {
            key: 'items',
            label: (
              <span>
                <ShoppingCartOutlined /> Mặt hàng ({items.length})
              </span>
            ),
          },
          {
            key: 'promotions',
            label: (
              <span>
                <GiftOutlined /> Khuyến mãi áp dụng ({appliedPromotions.length})
              </span>
            ),
          },
          {
            key: 'payments',
            label: (
              <span>
                <DollarOutlined /> Thanh toán & Hóa đơn
              </span>
            ),
          },
          {
            key: 'audit',
            label: (
              <span>
                <HistoryOutlined /> Lịch sử thao tác ({auditEvents.length})
              </span>
            ),
          },
        ]}
      />

      {/* ── Tab Content 1: Overview ── */}
      {activeTab === 'overview' && (
        <Row gutter={[16, 16]} className="order-detail-overview-grid">
          {/* Left Column: Order details, Time, Items preview */}
          <Col xs={24} lg={16}>
            {/* General Info Card */}
            <Card title="Thông tin đơn hàng" className="order-detail-card" size="small">
              <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
                <Descriptions.Item label="Mã đơn hàng">
                  <strong className="order-detail-code">{orderCode}</strong>
                </Descriptions.Item>
                {invoice && (
                  <Descriptions.Item label="Mã hóa đơn">
                    <strong style={{ color: '#0975F7' }}>{invoice.displayCode}</strong>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Trạng thái">
                  {statusBadge(order.status)}
                </Descriptions.Item>
                <Descriptions.Item label="Cửa hàng">{order.storeName}</Descriptions.Item>
                <Descriptions.Item label="Khu vực">{order.areaName ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Bàn phục vụ">
                  {order.tableName ? <Tag color="cyan">{order.tableName}</Tag> : 'Mang về'}
                </Descriptions.Item>
                <Descriptions.Item label="Nhân viên mở">{order.openedByName}</Descriptions.Item>
                <Descriptions.Item label="Thời gian mở">
                  {formatDateTime(order.openedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Thời gian đóng">
                  {formatDateTime(order.closedAt ?? order.cancelledAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Ghi chú">
                  {order.note || <span className="text-secondary">Không có ghi chú</span>}
                </Descriptions.Item>
              </Descriptions>

              {order.status === 'CANCELLED' && (
                <Alert
                  type="error"
                  showIcon
                  icon={<CloseCircleOutlined />}
                  style={{ marginTop: 12 }}
                  message={
                    <div>
                      <strong>Đơn đã bị hủy lúc {formatDateTime(order.cancelledAt)}</strong>
                      <div>Người hủy: {order.cancelledByName ?? 'Nhân viên'}</div>
                      <div>Lý do hủy: {order.cancelReason ?? 'Không có lý do'}</div>
                    </div>
                  }
                />
              )}
            </Card>

            {/* Time Summary Card (If Dine-In) */}
            {order.orderType === 'DINE_IN' && liveTimeSegments.length > 0 && (
              <Card
                title={
                  <div className="order-detail-card-title-row">
                    <span>
                      <FieldTimeOutlined style={{ marginRight: 8, color: '#0975F7' }} />
                      Chi tiết tiền giờ theo phân đoạn
                    </span>
                    <Space size={8}>
                      {data?.timeSummary?.status === 'PAUSED' ? (
                        <Tag color="warning" icon={<PauseCircleOutlined />}>
                          Tạm dừng tính giờ
                        </Tag>
                      ) : null}
                      <Badge
                        status={
                          order.status === 'OPEN'
                            ? data?.timeSummary?.status === 'PAUSED'
                              ? 'warning'
                              : 'processing'
                            : 'default'
                        }
                        text={<strong>Tổng giờ: {formatDuration(liveTotalElapsed)}</strong>}
                      />
                      <Tag color="gold" style={{ fontSize: '13px', fontWeight: 600 }}>
                        {formatMoney(liveTotalTimeAmount)}
                      </Tag>
                    </Space>
                  </div>
                }
                className="order-detail-card"
                size="small"
                style={{ marginTop: 16 }}
              >
                <div className="order-detail-segments-list">
                  {liveTimeSegments.map((seg, idx) => (
                    <div
                      key={seg.id || idx}
                      className={`order-detail-segment-item ${seg.isCurrentActive ? 'order-detail-segment-item--active' : ''}`}
                    >
                      <div className="order-detail-segment-header">
                        <div className="order-detail-segment-title">
                          <Tag color="blue">{idx + 1}</Tag>
                          <strong>{seg.tableName}</strong>
                          {seg.areaName && (
                            <small className="text-secondary"> ({seg.areaName})</small>
                          )}
                          {seg.isCurrentActive && (
                            <Badge status="processing" text="Đang tính giờ" />
                          )}
                        </div>
                        <div className="order-detail-segment-amount">
                          <strong>{formatMoney(seg.amountAfterRoundingVnd)}</strong>
                        </div>
                      </div>

                      <div className="order-detail-segment-body">
                        <div className="order-detail-segment-col">
                          <span className="text-secondary">Khung giờ:</span>{' '}
                          <span>
                            {formatClock(seg.startedAt)} →{' '}
                            {seg.endedAt ? formatClock(seg.endedAt) : 'Hiện tại'}
                          </span>
                        </div>
                        <div className="order-detail-segment-col">
                          <span className="text-secondary">Thời lượng:</span>{' '}
                          <strong>{formatDurationHuman(seg.elapsedSeconds)}</strong>
                        </div>
                        <div className="order-detail-segment-col">
                          <span className="text-secondary">Đơn giá snapshot:</span>{' '}
                          <span>{formatMoney(seg.unitPriceSnapshot)}/giờ</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Items Table Card */}
            <Card
              title={
                <div className="order-detail-card-title-row">
                  <span>
                    <ShoppingCartOutlined style={{ marginRight: 8, color: '#0975F7' }} />
                    Danh sách mặt hàng & dịch vụ ({items.length})
                  </span>
                  <Tag color="blue">
                    {formatMoney(items.reduce((s, i) => s + i.netLineTotalVnd, 0))}
                  </Tag>
                </div>
              }
              className="order-detail-card"
              size="small"
              style={{ marginTop: 16 }}
            >
              <div className="order-detail-items-desktop">
                <Table<OrderItemDetail>
                  rowKey="id"
                  dataSource={items}
                  columns={itemColumns}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: <Empty description="Chưa gọi mặt hàng nào" /> }}
                />
              </div>
              <div className="order-detail-items-mobile">
                <OrderDetailMobileItemsList items={items} />
              </div>
            </Card>
          </Col>

          {/* Right Column: Financial Totals, Customer & Checkout Snapshot */}
          <Col xs={24} lg={8}>
            {/* Totals Summary Card */}
            <Card
              title="Tổng thanh toán"
              className="order-detail-card order-detail-totals-card"
              size="small"
            >
              <div className="order-detail-totals-list">
                {order.orderType === 'DINE_IN' && (
                  <div className="order-detail-totals-row">
                    <span className="text-secondary">
                      Tiền giờ ({formatDuration(liveTotalElapsed)}):
                    </span>
                    <strong>{formatMoney(liveTotalTimeAmount)}</strong>
                  </div>
                )}

                <div className="order-detail-totals-row">
                  <span className="text-secondary">Tiền mặt hàng:</span>
                  <span>
                    {formatMoney(totals.itemGrossAmountVnd - totals.itemDiscountAmountVnd)}
                  </span>
                </div>

                {totals.orderDiscountAmountVnd > 0 && (
                  <div className="order-detail-totals-row text-danger">
                    <span>Khuyến mại:</span>
                    <span>-{formatMoney(totals.orderDiscountAmountVnd)}</span>
                  </div>
                )}

                <div className="order-detail-totals-row">
                  <span className="text-secondary">Phí / Phụ thu:</span>
                  <span>0đ</span>
                </div>

                <div className="order-detail-totals-row">
                  <span className="text-secondary">Thuế (VAT):</span>
                  <span>0đ</span>
                </div>

                <Divider style={{ margin: '10px 0' }} />

                <div className="order-detail-totals-row order-detail-totals-row--grand">
                  <span>Khách phải trả:</span>
                  <strong className="order-detail-grand-total">
                    {formatMoney(liveGrandTotal)}
                  </strong>
                </div>

                {payments.length > 0 && (
                  <>
                    <Divider style={{ margin: '10px 0' }} />
                    <div className="order-detail-totals-row">
                      <span className="text-secondary">Đã thanh toán:</span>
                      <span className="text-success font-semibold">
                        {formatMoney(totals.paidAmountVnd)}
                      </span>
                    </div>

                    {totals.changeAmountVnd > 0 && (
                      <div className="order-detail-totals-row">
                        <span className="text-secondary">Tiền thối lại:</span>
                        <span className="text-primary font-semibold">
                          {formatMoney(totals.changeAmountVnd)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {totals.debtAmountVnd > 0 ? (
                  <div className="order-detail-totals-row">
                    <span className="text-secondary">Ghi công nợ:</span>
                    <strong className="text-danger">{formatMoney(totals.debtAmountVnd)}</strong>
                  </div>
                ) : null}
              </div>
            </Card>

            {/* Customer Info Card */}
            <Card
              title="Thông tin khách hàng"
              className="order-detail-card"
              size="small"
              style={{ marginTop: 16 }}
            >
              <div className="order-detail-customer-row">
                <Avatar
                  size="large"
                  icon={<UserOutlined />}
                  style={{ backgroundColor: '#0975F7' }}
                />
                <div>
                  <strong>{customer?.name ?? 'Khách lẻ'}</strong>
                  <div className="text-secondary">
                    {customer?.phone ?? 'Chưa lưu số điện thoại'}
                  </div>
                </div>
              </div>
            </Card>

            {/* Checkout / Stop Time Snapshot (If exists) */}
            {checkout && (
              <Card
                title="Thông tin dừng giờ / Tạm tính"
                className="order-detail-card"
                size="small"
                style={{ marginTop: 16 }}
              >
                <div className="order-detail-checkout-box">
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Thời điểm dừng:</span>
                    <strong>{formatClock(checkout.stoppedAt)}</strong>
                  </div>
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Người thao tác:</span>
                    <span>{checkout.stoppedByName ?? 'Nhân viên'}</span>
                  </div>
                  {checkout.frozenTimeAmountVnd !== null && (
                    <div className="order-detail-checkout-row">
                      <span className="text-secondary">Tiền giờ đã khóa:</span>
                      <span>{formatMoney(checkout.frozenTimeAmountVnd)}</span>
                    </div>
                  )}
                  {checkout.resumedAt && (
                    <div className="order-detail-checkout-row text-success">
                      <span>Tiếp tục chơi lúc:</span>
                      <strong>{formatClock(checkout.resumedAt)}</strong>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Invoice Quick Summary (If exists) */}
            {invoice && (
              <Card
                title="Thông tin hóa đơn"
                className="order-detail-card"
                size="small"
                style={{ marginTop: 16 }}
              >
                <div className="order-detail-checkout-box">
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Mã hóa đơn:</span>
                    <strong>{invoice.displayCode}</strong>
                  </div>
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Thời gian xuất:</span>
                    <span>{formatDateTime(invoice.issuedAt)}</span>
                  </div>
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Thu ngân:</span>
                    <span>{invoice.issuedByName}</span>
                  </div>
                  <div className="order-detail-checkout-row">
                    <span className="text-secondary">Tổng hóa đơn:</span>
                    <strong className="text-primary">{formatMoney(invoice.totalVnd)}</strong>
                  </div>
                  {totals.debtAmountVnd > 0 ? (
                    <div className="order-detail-checkout-row">
                      <span className="text-secondary">Công nợ phát sinh:</span>
                      <strong className="text-danger">{formatMoney(totals.debtAmountVnd)}</strong>
                    </div>
                  ) : null}
                </div>
              </Card>
            )}
          </Col>
        </Row>
      )}

      {/* ── Tab Content 2: Time & Table Lifecycle ── */}
      {activeTab === 'time' && (
        <div className="order-detail-tab-pane">
          <Row gutter={[16, 16]}>
            {/* Time Segments */}
            <Col xs={24} md={14}>
              <Card
                title={
                  <div className="order-detail-card-title-row">
                    <span>
                      <ClockCircleOutlined style={{ marginRight: 8, color: '#0975F7' }} />
                      Chi tiết các phân đoạn tính giờ (TimeSegments)
                    </span>
                    <Badge count={liveTimeSegments.length} color="#0975F7" />
                  </div>
                }
                size="small"
                className="order-detail-card"
              >
                <div className="order-detail-segments-expanded">
                  {liveTimeSegments.map((seg, idx) => (
                    <Card
                      key={seg.id || idx}
                      type="inner"
                      size="small"
                      title={
                        <div className="order-detail-card-title-row">
                          <Space>
                            <Tag color="blue">Phân đoạn {idx + 1}</Tag>
                            <strong>{seg.tableName}</strong>
                            {seg.areaName && <Tag color="default">{seg.areaName}</Tag>}
                          </Space>
                          <strong className="text-primary">
                            {formatMoney(seg.amountAfterRoundingVnd)}
                          </strong>
                        </div>
                      }
                      style={{ marginBottom: 12 }}
                    >
                      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
                        <Descriptions.Item label="Thời gian bắt đầu">
                          {formatDateTime(seg.startedAt)}
                        </Descriptions.Item>
                        <Descriptions.Item label="Thời gian kết thúc">
                          {seg.endedAt ? (
                            formatDateTime(seg.endedAt)
                          ) : (
                            <Badge status="processing" text="Đang tiếp tục chạy..." />
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Thời lượng chơi">
                          <strong>{formatDuration(seg.elapsedSeconds)}</strong> (
                          {formatDurationHuman(seg.elapsedSeconds)})
                        </Descriptions.Item>
                        <Descriptions.Item label="Bảng giá snapshot">
                          {seg.rateNameSnapshot} ({formatMoney(seg.unitPriceSnapshot)}/giờ)
                        </Descriptions.Item>
                        <Descriptions.Item label="Thành tiền trước làm tròn">
                          {formatMoney(seg.amountBeforeRoundingVnd)}
                        </Descriptions.Item>
                        <Descriptions.Item label="Thành tiền sau làm tròn">
                          <strong>{formatMoney(seg.amountAfterRoundingVnd)}</strong>
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  ))}
                </div>
              </Card>
            </Col>

            {/* Table Transfers & Rate Changes */}
            <Col xs={24} md={10}>
              {/* Transfer history */}
              <Card
                title={
                  <span>
                    <SwapOutlined style={{ marginRight: 8, color: '#0975F7' }} />
                    Lịch sử chuyển bàn ({tableTransfers.length})
                  </span>
                }
                size="small"
                className="order-detail-card"
              >
                {tableTransfers.length === 0 ? (
                  <Empty
                    description="Đơn hàng chưa từng chuyển bàn"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  <div className="order-detail-transfers-list">
                    {tableTransfers.map((tr, idx) => (
                      <div key={tr.id || idx} className="order-detail-transfer-box">
                        <div className="order-detail-transfer-header">
                          <Space>
                            <Tag color="volcano">{tr.fromTableName}</Tag>
                            <ArrowRightOutlined />
                            <Tag color="green">{tr.toTableName}</Tag>
                          </Space>
                          <small className="text-secondary">{formatClock(tr.transferredAt)}</small>
                        </div>
                        <div className="order-detail-transfer-details">
                          <div>
                            <span className="text-secondary">Giá cũ:</span>{' '}
                            {formatMoney(tr.oldRateVnd)}/h →{' '}
                            <span className="text-secondary">Giá mới:</span>{' '}
                            {formatMoney(tr.newRateVnd)}/h
                          </div>
                          <div>
                            <span className="text-secondary">Nhân viên thực hiện:</span>{' '}
                            <strong>{tr.employeeName}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Rate changes */}
              <Card
                title={
                  <span>
                    <TagOutlined style={{ marginRight: 8, color: '#0975F7' }} />
                    Lịch sử đổi giá tính giờ ({rateChanges.length})
                  </span>
                }
                size="small"
                className="order-detail-card"
                style={{ marginTop: 16 }}
              >
                {rateChanges.length === 0 ? (
                  <Empty
                    description="Không có thay đổi giá tính giờ"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  <div className="order-detail-transfers-list">
                    {rateChanges.map((rc, idx) => (
                      <div key={rc.id || idx} className="order-detail-transfer-box">
                        <div className="order-detail-transfer-header">
                          <Tag color="blue">{rc.tableName}</Tag>
                          <small className="text-secondary">{formatClock(rc.appliedAt)}</small>
                        </div>
                        <div className="order-detail-transfer-details">
                          <div>
                            {formatMoney(rc.oldRateVnd)}/h →{' '}
                            <strong>{formatMoney(rc.newRateVnd)}/h</strong>
                          </div>
                          <div>
                            <span className="text-secondary">Người đổi:</span> {rc.employeeName}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </div>
      )}

      {/* ── Tab Content 3: Items / Services ── */}
      {activeTab === 'items' && (
        <Card size="small" className="order-detail-card">
          <div className="order-detail-items-desktop">
            <Table<OrderItemDetail>
              rowKey="id"
              dataSource={items}
              columns={itemColumns}
              pagination={false}
              locale={{ emptyText: <Empty description="Chưa có mặt hàng nào" /> }}
            />
          </div>
          <div className="order-detail-items-mobile">
            <OrderDetailMobileItemsList items={items} />
          </div>
        </Card>
      )}

      {/* ── Tab Content: Applied Promotions ── */}
      {activeTab === 'promotions' && (
        <div className="order-detail-tab-pane">
          {appliedPromotions.length === 0 ? (
            <Card size="small" className="order-detail-card">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Đơn hàng không áp dụng chương trình khuyến mãi nào"
              />
            </Card>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {/* Summary Stats Banner */}
              <Card
                size="small"
                className="order-detail-card"
                style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}
              >
                <Row gutter={[16, 16]} align="middle">
                  <Col xs={24} sm={8}>
                    <div style={{ fontSize: 13, color: '#166534' }}>Số chương trình áp dụng:</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#15803d' }}>
                      {appliedPromotions.length} chương trình
                    </div>
                  </Col>
                  <Col xs={24} sm={8}>
                    <div style={{ fontSize: 13, color: '#166534' }}>Tổng tiền giảm trừ:</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>
                      -
                      {formatMoney(
                        appliedPromotions.reduce((sum, p) => sum + p.discountAmountVnd, 0),
                      )}
                    </div>
                  </Col>
                  <Col xs={24} sm={8}>
                    <div style={{ fontSize: 13, color: '#166534' }}>Quà tặng kèm theo:</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0975F7' }}>
                      {appliedPromotions.reduce((sum, p) => sum + (p.giftItems?.length ?? 0), 0)}{' '}
                      món quà
                    </div>
                  </Col>
                </Row>
              </Card>

              {/* List of Applied Promotions */}
              {appliedPromotions.map((promo, idx) => {
                const isGift = promo.type === 'GIFT';
                const isFlat = promo.type === 'FLAT_PRICE';
                const isPercent = promo.type === 'PERCENT';
                const isFixed = promo.type === 'FIXED_AMOUNT';

                return (
                  <Card
                    key={promo.id || idx}
                    size="small"
                    className="order-detail-card"
                    title={
                      <div className="order-detail-card-title-row">
                        <Space wrap>
                          <Tag color="magenta">#{idx + 1}</Tag>
                          <strong style={{ fontSize: 15 }}>{promo.name}</strong>
                          {isGift && <Tag color="green">Tặng quà</Tag>}
                          {isFlat && <Tag color="orange">Đồng giá</Tag>}
                          {isPercent && <Tag color="purple">Giảm {promo.value}%</Tag>}
                          {isFixed && <Tag color="blue">Giảm tiền mặt</Tag>}
                          {promo.scope && (
                            <Tag color="default">
                              {promo.scope === 'INVOICE'
                                ? 'Toàn hóa đơn'
                                : promo.scope === 'CATEGORY'
                                  ? 'Theo danh mục'
                                  : 'Theo món'}
                            </Tag>
                          )}
                        </Space>
                        <strong style={{ fontSize: 16, color: '#dc2626' }}>
                          -{formatMoney(promo.discountAmountVnd)}
                        </strong>
                      </div>
                    }
                  >
                    {/* Gift items detail if any */}
                    {promo.giftItems && promo.giftItems.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: '#166534' }}>
                          Danh sách món được tặng (Miễn phí 100%):
                        </div>
                        <Table
                          size="small"
                          pagination={false}
                          rowKey={(r, i) => `${r.productId}-${i}`}
                          dataSource={promo.giftItems}
                          columns={[
                            {
                              title: 'Mặt hàng tặng',
                              dataIndex: 'productName',
                              render: (name: string, row) => (
                                <div>
                                  <strong>{name}</strong>
                                  {row.variantName && (
                                    <small className="text-secondary"> · {row.variantName}</small>
                                  )}
                                  <Tag color="green" style={{ marginLeft: 6 }}>
                                    Quà tặng
                                  </Tag>
                                </div>
                              ),
                            },
                            {
                              title: 'Số lượng',
                              dataIndex: 'quantityMilli',
                              align: 'right',
                              render: (milli: number, row) => (
                                <span>
                                  {milli / 1000} {row.unitName ?? ''}
                                </span>
                              ),
                            },
                            {
                              title: 'Giá trị gốc',
                              dataIndex: 'unitPriceVnd',
                              align: 'right',
                              render: (price: number) => formatMoney(price),
                            },
                            {
                              title: 'Khuyến mãi giảm',
                              dataIndex: 'grossAmountVnd',
                              align: 'right',
                              render: (gross: number) => (
                                <span className="text-danger">-{formatMoney(gross)}</span>
                              ),
                            },
                            {
                              title: 'Thành tiền',
                              key: 'total',
                              align: 'right',
                              render: () => <strong className="text-success">0đ</strong>,
                            },
                          ]}
                        />
                      </div>
                    )}

                    {/* Flat price items detail if any */}
                    {promo.flatPriceItems && promo.flatPriceItems.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: '#d97706' }}>
                          Mặt hàng áp dụng mức đồng giá:
                        </div>
                        <Table
                          size="small"
                          pagination={false}
                          rowKey={(r, i) => `${r.productId}-${i}`}
                          dataSource={promo.flatPriceItems}
                          columns={[
                            {
                              title: 'Mặt hàng',
                              dataIndex: 'productName',
                              render: (name: string, row) => (
                                <div>
                                  <strong>{name}</strong>
                                  {row.variantName && (
                                    <small className="text-secondary"> · {row.variantName}</small>
                                  )}
                                </div>
                              ),
                            },
                            {
                              title: 'Số lượng',
                              dataIndex: 'quantityMilli',
                              align: 'right',
                              render: (milli: number) => <span>{milli / 1000}</span>,
                            },
                            {
                              title: 'Giá gốc',
                              dataIndex: 'originalUnitPriceVnd',
                              align: 'right',
                              render: (price: number) => formatMoney(price),
                            },
                            {
                              title: 'Giá sau khuyến mãi',
                              dataIndex: 'flatUnitPriceVnd',
                              align: 'right',
                              render: (price: number) => (
                                <strong className="text-primary">{formatMoney(price)}</strong>
                              ),
                            },
                            {
                              title: 'Tiết kiệm',
                              dataIndex: 'discountAmountVnd',
                              align: 'right',
                              render: (discount: number) => (
                                <span className="text-danger">-{formatMoney(discount)}</span>
                              ),
                            },
                          ]}
                        />
                      </div>
                    )}

                    {/* Simple summary for fixed amount or percent */}
                    {!promo.giftItems?.length && !promo.flatPriceItems?.length && (
                      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
                        <Descriptions.Item label="Hình thức khuyến mãi">
                          {isPercent
                            ? `Giảm ${promo.value}% trên giá trị áp dụng`
                            : isFixed
                              ? `Giảm trực tiếp ${formatMoney(promo.value)}`
                              : 'Giảm giá theo chương trình'}
                        </Descriptions.Item>
                        <Descriptions.Item label="Tổng số tiền giảm vào đơn">
                          <strong className="text-danger">
                            -{formatMoney(promo.discountAmountVnd)}
                          </strong>
                        </Descriptions.Item>
                      </Descriptions>
                    )}
                  </Card>
                );
              })}
            </Space>
          )}
        </div>
      )}

      {/* ── Tab Content 4: Payment & Invoice ── */}
      {activeTab === 'payments' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="Giao dịch thanh toán" size="small" className="order-detail-card">
              {paymentAllocations.length === 0 && payments.length === 0 ? (
                <Empty description="Đơn hàng chưa thực hiện thanh toán" />
              ) : paymentAllocations.length > 0 ? (
                <div className="order-detail-payments-list">
                  {paymentAllocations.map((allocation) => (
                    <Card
                      key={allocation.id}
                      type="inner"
                      size="small"
                      style={{ marginBottom: 12 }}
                    >
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="Phương thức">
                          {allocationMethodTag(allocation.method)}
                        </Descriptions.Item>
                        <Descriptions.Item
                          label={
                            allocation.method === 'DEBT' ? 'Số tiền ghi nợ' : 'Số tiền thanh toán'
                          }
                        >
                          <strong
                            className={
                              allocation.method === 'DEBT' ? 'text-danger' : 'text-primary'
                            }
                          >
                            {formatMoney(allocation.amountVnd)}
                          </strong>
                        </Descriptions.Item>
                        {allocation.tenderedVnd !== null ? (
                          <Descriptions.Item label="Tiền khách đưa">
                            {formatMoney(allocation.tenderedVnd)}
                          </Descriptions.Item>
                        ) : null}
                        <Descriptions.Item label="Thời gian">
                          {formatDateTime(allocation.createdAt)}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="order-detail-payments-list">
                  {payments.map((pm, idx) => (
                    <Card key={pm.id || idx} type="inner" size="small" style={{ marginBottom: 12 }}>
                      <Descriptions size="small" column={1} bordered>
                        <Descriptions.Item label="Phương thức">
                          {paymentMethodTag(pm.method)}
                        </Descriptions.Item>
                        <Descriptions.Item label="Trạng thái">
                          <Tag color={pm.status === 'SUCCEEDED' ? 'success' : 'default'}>
                            {pm.status === 'SUCCEEDED' ? 'Thành công' : pm.status}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Số tiền thanh toán">
                          <strong className="text-primary">{formatMoney(pm.amount)}</strong>
                        </Descriptions.Item>
                        {pm.cashReceived !== null && (
                          <Descriptions.Item label="Tiền khách đưa">
                            {formatMoney(pm.cashReceived)}
                          </Descriptions.Item>
                        )}
                        {pm.cashChange !== null && (
                          <Descriptions.Item label="Tiền thối lại">
                            {formatMoney(pm.cashChange)}
                          </Descriptions.Item>
                        )}
                        <Descriptions.Item label="Thu ngân">{pm.createdByName}</Descriptions.Item>
                        <Descriptions.Item label="Thời gian">
                          {formatDateTime(pm.createdAt)}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card
              title="Hóa đơn thanh toán (Bản in chuẩn)"
              size="small"
              className="order-detail-card order-detail-invoice-card"
              extra={
                invoice && (
                  <Space>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => {
                        setReceiptModalType('PAYMENT');
                        setReceiptModalVisible(true);
                      }}
                    >
                      Xem phóng to
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<PrinterOutlined />}
                      onClick={() => handlePrintReceipt('PAYMENT')}
                    >
                      In hóa đơn
                    </Button>
                  </Space>
                )
              }
            >
              {!invoice ? (
                <Empty description="Chưa tạo hóa đơn chính thức cho đơn này" />
              ) : currentReceiptPrintOptions ? (
                <div
                  style={{
                    maxHeight: 560,
                    overflowY: 'auto',
                    display: 'flex',
                    justifyContent: 'center',
                    background: '#f8fafc',
                    padding: '8px 0',
                    borderRadius: 8,
                  }}
                >
                  <Suspense fallback={<Skeleton active title={false} paragraph={{ rows: 10 }} />}>
                    <ReceiptPreviewPaper options={currentReceiptPrintOptions} />
                  </Suspense>
                </div>
              ) : null}
            </Card>
          </Col>
        </Row>
      )}

      {/* ── Tab Content 5: Audit Timeline ── */}
      {activeTab === 'audit' && (
        <Card
          title="Dòng thời gian sự kiện (Audit Timeline)"
          size="small"
          className="order-detail-card"
        >
          {auditEvents.length === 0 ? (
            <Empty description="Không có sự kiện nào được ghi nhận" />
          ) : (
            <Timeline
              mode="left"
              items={auditEvents
                .toSorted((left, right) => right.eventAt - left.eventAt)
                .map((evt) => ({
                  label: formatClock(evt.eventAt),
                  color: evt.action.includes('CANCEL')
                    ? 'red'
                    : evt.action.includes('COMPLETE') || evt.action.includes('PAID')
                      ? 'green'
                      : evt.action.includes('TRANSFER')
                        ? 'orange'
                        : 'blue',
                  children: (
                    <div className="order-detail-timeline-item">
                      <div className="order-detail-timeline-title">
                        <strong>{evt.title}</strong>
                        <small className="text-secondary"> · {formatDateTime(evt.eventAt)}</small>
                      </div>
                      <div className="order-detail-timeline-desc">{evt.description}</div>
                      {evt.actorName && (
                        <div className="order-detail-timeline-actor">
                          <UserOutlined style={{ marginRight: 4 }} />
                          <span>{evt.actorName}</span>
                        </div>
                      )}
                    </div>
                  ),
                }))}
            />
          )}
        </Card>
      )}

      {/* ── Authentic Thermal Receipt Modal ── */}
      {receiptModalVisible ? (
        <Suspense
          fallback={
            <Modal
              open
              title={
                receiptModalType === 'PAYMENT'
                  ? `Xem hóa đơn thanh toán · ${data.invoice?.displayCode || orderCode}`
                  : `Xem hóa đơn tạm tính · ${orderCode}`
              }
              footer={null}
              width={650}
              centered
              onCancel={() => setReceiptModalVisible(false)}
            >
              <Skeleton active title={false} paragraph={{ rows: 10 }} />
            </Modal>
          }
        >
          <ReceiptPreviewModal
            open
            title={
              receiptModalType === 'PAYMENT'
                ? `Xem hóa đơn thanh toán · ${data.invoice?.displayCode || orderCode}`
                : `Xem hóa đơn tạm tính · ${orderCode}`
            }
            options={currentReceiptPrintOptions}
            onCancel={() => setReceiptModalVisible(false)}
            onPrint={async () => {
              await handlePrintReceipt(receiptModalType);
              setReceiptModalVisible(false);
            }}
          />
        </Suspense>
      ) : null}

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        open={deleteConfirmVisible}
        title={null}
        onCancel={() => !deleteMutation.isPending && setDeleteConfirmVisible(false)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeleteConfirmVisible(false)}
            disabled={deleteMutation.isPending}
          >
            Hủy
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Xác nhận xóa
          </Button>,
        ]}
        centered
        width={480}
      >
        <div style={{ padding: '8px 0', fontSize: '14.5px', lineHeight: '1.6' }}>
          <div style={{ fontWeight: 600, fontSize: '16.5px', marginBottom: 14, color: '#0f172a' }}>
            Xin chào {authQuery.data?.actor?.displayName || 'Chủ cửa hàng'}
          </div>
          <p style={{ margin: '0 0 10px 0', color: '#334155' }}>
            Bạn đang thực hiện xóa hóa đơn này của cửa hàng.
          </p>
          <p style={{ margin: '0 0 10px 0', color: '#dc2626', fontWeight: 600 }}>
            Thao tác xóa hóa đơn sẽ xóa tất cả báo cáo liên quan tới hóa đơn
          </p>
          <p style={{ margin: 0, color: '#64748b' }}>
            Thao tác này sẽ không thể khôi phục, hãy cân nhắc kỹ trước khi xóa
          </p>
        </div>
      </Modal>
    </div>
  );
}
