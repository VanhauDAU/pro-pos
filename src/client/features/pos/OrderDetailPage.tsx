import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CreditCardOutlined,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FieldTimeOutlined,
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
import { useQuery } from '@tanstack/react-query';
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
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { OrderDetailDto, OrderItemDetail } from '@contracts/order-detail';
import type { StorePrintSettings } from '@contracts/store';
import { apiRequest } from '@client/lib/api';
import { printReceipt, type PosReceiptPrintData } from '@client/lib/pos-receipt-printer';

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
  const targetOrderId = propOrderId ?? params.orderId;

  const [activeTab, setActiveTab] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [invoiceModalVisible, setInvoiceModalVisible] = useState(false);

  // Realtime clock update for OPEN orders
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const detailQuery = useQuery({
    queryKey: ['pos-order-detail', targetOrderId],
    queryFn: () => apiRequest<OrderDetailDto>(`/api/v1/pos/orders/${targetOrderId}/detail`),
    enabled: Boolean(targetOrderId),
    refetchInterval: (query) => (query.state.data?.order.status === 'OPEN' ? 5000 : false),
  });

  const data = detailQuery.data;

  // Realtime active segment duration calculation
  const liveTimeSegments = useMemo(() => {
    if (!data?.timeSegments) return [];
    if (data.order.status !== 'OPEN') return data.timeSegments;

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
  }, [data?.timeSegments, data?.order.status, now]);

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
  });

  const handlePrintReceipt = (receiptType: 'PROVISIONAL' | 'PAYMENT') => {
    if (!data) return;
    const isPayment = receiptType === 'PAYMENT' && Boolean(data.invoice);

    const printData: PosReceiptPrintData = {
      receiptType,
      orderCode:
        data.invoice?.displayCode ||
        data.order.displayCode ||
        data.order.id.slice(-6).toUpperCase(),
      invoiceCode: data.invoice?.displayCode || null,
      orderType: data.order.orderType,
      tableName: data.order.tableName,
      areaName: null,
      cashierName: data.invoice?.issuedByName ?? null,
      customerName: data.customer?.name ?? null,
      guestPhone: data.customer?.phone ?? null,
      guestAddress: null,
      note: data.order.note,
      checkInTimeMs: data.order.openedAt,
      issuedAtMs: data.invoice?.issuedAt || Date.now(),
      subtotal: isPayment ? data.invoice!.subtotalVnd : liveGrandTotal,
      discountTotal: isPayment ? data.invoice!.discountTotalVnd : 0,
      total: isPayment ? data.invoice!.totalVnd : liveGrandTotal,
      paymentMethod: data.invoice ? 'CASH' : null,
      cashReceived: null,
      cashChange: null,
      lines: [
        ...(liveTimeSegments.length > 0
          ? [
              {
                id: 'time-session',
                name: 'Tiền giờ',
                quantity: 1,
                unitPrice: liveTotalTimeAmount,
                totalPrice: liveTotalTimeAmount,
                isTime: true,
                timeStartedAtMs: data.order.openedAt,
                timeEndedAtMs: data.order.status === 'OPEN' ? null : Date.now(),
                timeElapsedSeconds: liveTotalElapsed,
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
        })),
      ],
    };

    void printReceipt({
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
              onClick={() => (onClose ? onClose() : navigate('/pos'))}
              icon={<ArrowLeftOutlined />}
            >
              Quay lại danh sách
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
      render: (name: string, row: OrderItemDetail) => (
        <div className="order-detail-item-cell">
          <strong className="order-detail-item-title">{name}</strong>
          {row.variantNameSnapshot && (
            <small className="order-detail-item-variant"> · {row.variantNameSnapshot}</small>
          )}
          {row.note && <div className="order-detail-item-note">Ghi chú: {row.note}</div>}
        </div>
      ),
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
                {order.orderType === 'DINE_IN' ? 'Tại bàn' : 'Mang đi'}
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
          <Space>
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
              <Button icon={<PrinterOutlined />} onClick={() => handlePrintReceipt('PROVISIONAL')}>
                In tạm tính
              </Button>
            )}

            {invoice && (
              <>
                <Button icon={<EyeOutlined />} onClick={() => setInvoiceModalVisible(true)}>
                  Xem hóa đơn
                </Button>
                <Button icon={<PrinterOutlined />} onClick={() => handlePrintReceipt('PAYMENT')}>
                  In hóa đơn
                </Button>
              </>
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
                  {order.tableName ? <Tag color="cyan">{order.tableName}</Tag> : 'Mang đi'}
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
                      <Badge
                        status={order.status === 'OPEN' ? 'processing' : 'default'}
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
              <Table<OrderItemDetail>
                rowKey="id"
                dataSource={items}
                columns={itemColumns}
                pagination={false}
                size="small"
                locale={{ emptyText: <Empty description="Chưa gọi mặt hàng nào" /> }}
              />
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
                  <span>{formatMoney(totals.itemGrossAmountVnd)}</span>
                </div>

                {totals.totalDiscountVnd > 0 && (
                  <div className="order-detail-totals-row text-danger">
                    <span>Giảm giá:</span>
                    <span>-{formatMoney(totals.totalDiscountVnd)}</span>
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
          <Table<OrderItemDetail>
            rowKey="id"
            dataSource={items}
            columns={itemColumns}
            pagination={false}
            locale={{ emptyText: <Empty description="Chưa có mặt hàng nào" /> }}
          />
        </Card>
      )}

      {/* ── Tab Content 4: Payment & Invoice ── */}
      {activeTab === 'payments' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="Giao dịch thanh toán" size="small" className="order-detail-card">
              {payments.length === 0 ? (
                <Empty description="Đơn hàng chưa thực hiện thanh toán" />
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
              title="Hóa đơn chính thức (Snapshot)"
              size="small"
              className="order-detail-card"
              extra={
                invoice && (
                  <Button
                    size="small"
                    icon={<PrinterOutlined />}
                    onClick={() => handlePrintReceipt('PAYMENT')}
                  >
                    In hóa đơn
                  </Button>
                )
              }
            >
              {!invoice ? (
                <Empty description="Chưa tạo hóa đơn chính thức cho đơn này" />
              ) : (
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="Mã hóa đơn">
                    <strong>{invoice.displayCode}</strong>
                  </Descriptions.Item>
                  <Descriptions.Item label="Trạng thái">
                    <Tag color="success">Đã hoàn thành</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Thời gian xuất">
                    {formatDateTime(invoice.issuedAt)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Thu ngân xuất">
                    {invoice.issuedByName}
                  </Descriptions.Item>
                  <Descriptions.Item label="Tiền hàng / giờ">
                    {formatMoney(invoice.subtotalVnd)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Giảm giá">
                    -{formatMoney(invoice.discountTotalVnd)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Tổng cộng">
                    <strong className="text-primary font-bold">
                      {formatMoney(invoice.totalVnd)}
                    </strong>
                  </Descriptions.Item>
                </Descriptions>
              )}
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
              items={auditEvents.map((evt) => ({
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

      {/* ── Invoice Printable Modal ── */}
      <Modal
        open={invoiceModalVisible}
        onCancel={() => setInvoiceModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setInvoiceModalVisible(false)}>
            Đóng
          </Button>,
          <Button
            key="print"
            type="primary"
            icon={<PrinterOutlined />}
            onClick={() => handlePrintReceipt('PAYMENT')}
          >
            In hóa đơn
          </Button>,
        ]}
        width={420}
        title="Hóa đơn thanh toán"
      >
        {invoice && (
          <div className="order-detail-invoice-preview">
            <div className="order-detail-invoice-preview__header">
              <h2>PRO POS BILLIARDS</h2>
              <div>{order.storeName}</div>
              <div>
                Hóa đơn: <strong>{invoice.displayCode}</strong>
              </div>
              <div>Ngày: {formatDateTime(invoice.issuedAt)}</div>
              <div>
                Bàn: {order.tableName ?? 'Mang đi'} · Thu ngân: {invoice.issuedByName}
              </div>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div className="order-detail-invoice-preview__lines">
              {liveTimeSegments.length > 0 && (
                <div className="order-detail-invoice-preview__line">
                  <div>
                    <div>Tiền giờ ({formatDuration(liveTotalElapsed)})</div>
                    <small className="text-secondary">{order.tableUsageChain.join(' → ')}</small>
                  </div>
                  <strong>{formatMoney(liveTotalTimeAmount)}</strong>
                </div>
              )}

              {items.map((it) => (
                <div key={it.id} className="order-detail-invoice-preview__line">
                  <div>
                    <div>
                      {it.productNameSnapshot} (x{it.quantityMilli / 1000})
                    </div>
                    {it.discountAmountVnd > 0 && (
                      <small className="text-danger">
                        Giảm: -{formatMoney(it.discountAmountVnd)}
                      </small>
                    )}
                  </div>
                  <strong>{formatMoney(it.netLineTotalVnd)}</strong>
                </div>
              ))}
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div className="order-detail-invoice-preview__totals">
              <div className="order-detail-invoice-preview__total-row">
                <span>Tổng tiền hàng & giờ:</span>
                <span>{formatMoney(invoice.subtotalVnd)}</span>
              </div>
              {invoice.discountTotalVnd > 0 && (
                <div className="order-detail-invoice-preview__total-row text-danger">
                  <span>Giảm giá:</span>
                  <span>-{formatMoney(invoice.discountTotalVnd)}</span>
                </div>
              )}
              <div className="order-detail-invoice-preview__total-row order-detail-invoice-preview__total-row--grand">
                <span>THANH TOÁN:</span>
                <strong>{formatMoney(invoice.totalVnd)}</strong>
              </div>
            </div>

            <div className="order-detail-invoice-preview__footer">
              <p>Cảm ơn quý khách và hẹn gặp lại!</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
