import {
  CheckOutlined,
  ClockCircleOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Input, Modal, Select, Spin, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import type { AuthContextResponse } from '@contracts/auth';
import type { GuestOrderRequestDto } from '@contracts/qr-order';
import { apiRequest, jsonRequest } from '@client/lib/api';

function formatVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
}

function formatRelativeTime(timestamp: number | null | undefined) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(timestamp));
}

function mutationHeaders(csrfToken: string) {
  return { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': crypto.randomUUID() };
}

export interface QrOrderConfirmModalProps {
  open: boolean;
  onClose: () => void;
  areas?: Array<{
    id: string;
    name: string;
    tables: Array<{ id: string; name: string }>;
  }>;
}

export function QrOrderConfirmModal({ open, onClose, areas }: QrOrderConfirmModalProps) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [statusTab, setStatusTab] = useState<'PENDING' | 'ACCEPTED' | 'REJECTED'>('PENDING');
  const [selectedAreaId, setSelectedAreaId] = useState<string>('ALL');
  const [selectedTableId, setSelectedTableId] = useState<string>('ALL');
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [rejectingRequest, setRejectingRequest] = useState<GuestOrderRequestDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const ordersQuery = useQuery({
    queryKey: ['pos-staff-all-qr-orders'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/pos/qr-orders'),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  const overviewQuery = useQuery({
    queryKey: ['pos-overview-areas-for-qr-modal'],
    queryFn: () =>
      apiRequest<{
        tables: Array<{ id: string; name: string; areaId?: string; areaName?: string }>;
      }>('/api/v1/pos/overview'),
    enabled: open && (!areas || areas.length === 0),
  });

  const effectiveAreas = useMemo(() => {
    if (areas && areas.length > 0) return areas;
    if (!overviewQuery.data?.tables) return [];
    const map = new Map<
      string,
      { id: string; name: string; tables: Array<{ id: string; name: string }> }
    >();
    for (const t of overviewQuery.data.tables) {
      const aId = t.areaId ?? 'default';
      const aName = t.areaName ?? 'Khu vực';
      if (!map.has(aId)) {
        map.set(aId, { id: aId, name: aName, tables: [] });
      }
      map.get(aId)!.tables.push({ id: t.id, name: t.name });
    }
    return Array.from(map.values());
  }, [areas, overviewQuery.data?.tables]);

  const allOrders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  const refreshAfterMutation = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-staff-all-qr-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-notification-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-overview'] }),
    ]);

  const pendingOrders = useMemo(() => allOrders.filter((o) => o.status === 'PENDING'), [allOrders]);
  const acceptedOrders = useMemo(
    () => allOrders.filter((o) => o.status === 'ACCEPTED'),
    [allOrders],
  );
  const rejectedOrders = useMemo(
    () => allOrders.filter((o) => o.status === 'REJECTED'),
    [allOrders],
  );

  // Set default tab when modal opens or pending orders exist
  useEffect(() => {
    if (open) {
      if (pendingOrders.length > 0) {
        setStatusTab('PENDING');
      }
    }
  }, [open, pendingOrders.length]);

  // Expand all by default when new orders arrive
  useEffect(() => {
    if (allOrders.length > 0) {
      setExpandedMap((prev) => {
        const next = { ...prev };
        for (const order of allOrders) {
          if (next[order.id] === undefined) {
            next[order.id] = true;
          }
        }
        return next;
      });
    }
  }, [allOrders]);

  // Filter available tables for the Table Dropdown
  const availableTables = useMemo(() => {
    if (selectedAreaId === 'ALL') {
      return effectiveAreas.flatMap((a) => a.tables);
    }
    const area = effectiveAreas.find((a) => a.id === selectedAreaId);
    return area ? area.tables : [];
  }, [effectiveAreas, selectedAreaId]);

  // Reset table filter when area changes
  useEffect(() => {
    if (selectedTableId !== 'ALL' && !availableTables.some((t) => t.id === selectedTableId)) {
      setSelectedTableId('ALL');
    }
  }, [selectedAreaId, availableTables, selectedTableId]);

  // Filter orders according to tab & dropdown filters
  const filteredOrders = useMemo(() => {
    const ordersInTab =
      statusTab === 'PENDING'
        ? pendingOrders
        : statusTab === 'ACCEPTED'
          ? acceptedOrders
          : rejectedOrders;

    return ordersInTab.filter((order) => {
      if (selectedAreaId !== 'ALL') {
        const targetArea = effectiveAreas.find((a) => a.id === selectedAreaId);
        if (targetArea && order.areaName !== targetArea.name) return false;
      }
      if (selectedTableId !== 'ALL') {
        if (order.tableId !== selectedTableId) return false;
      }
      return true;
    });
  }, [
    statusTab,
    pendingOrders,
    acceptedOrders,
    rejectedOrders,
    selectedAreaId,
    selectedTableId,
    effectiveAreas,
  ]);

  const toggleExpand = (orderId: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const acceptMutation = useMutation({
    mutationFn: (request: GuestOrderRequestDto) =>
      jsonRequest(
        `/api/v1/pos/qr-orders/${request.id}/accept`,
        { expectedOrderVersion: request.orderVersion },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      ),
    onSuccess: () => {
      messageApi.success('Đã xác nhận món vào hóa đơn bàn.');
      void refreshAfterMutation();
    },
    onError: (err) => {
      messageApi.error(err instanceof Error ? err.message : 'Không thể xác nhận món.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ request, reason }: { request: GuestOrderRequestDto; reason: string }) =>
      jsonRequest(
        `/api/v1/pos/qr-orders/${request.id}/reject`,
        { reason },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      ),
    onSuccess: () => {
      messageApi.success('Đã từ chối đơn gọi món.');
      setRejectingRequest(null);
      setRejectReason('');
      void refreshAfterMutation();
    },
    onError: (err) => {
      messageApi.error(err instanceof Error ? err.message : 'Không thể từ chối đơn.');
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={780}
        centered
        destroyOnClose
        className="pos-qr-confirm-modal"
        styles={{
          body: { padding: 0 },
        }}
        title={
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>Xác nhận gọi món</div>
        }
      >
        <div className="pos-qr-confirm-modal__content">
          {/* ── Top Bar: Status Tabs & Dropdown Filters ────────────────── */}
          <div className="pos-qr-confirm-modal__toolbar">
            <div className="pos-qr-confirm-modal__tabs">
              <button
                type="button"
                className={`pos-qr-confirm-modal__tab ${statusTab === 'PENDING' ? 'is-active' : ''}`}
                onClick={() => setStatusTab('PENDING')}
              >
                Chưa xác nhận ({pendingOrders.length})
              </button>
              <button
                type="button"
                className={`pos-qr-confirm-modal__tab ${statusTab === 'ACCEPTED' ? 'is-active' : ''}`}
                onClick={() => setStatusTab('ACCEPTED')}
              >
                Đã xác nhận ({acceptedOrders.length})
              </button>
              <button
                type="button"
                className={`pos-qr-confirm-modal__tab ${statusTab === 'REJECTED' ? 'is-active' : ''}`}
                onClick={() => setStatusTab('REJECTED')}
              >
                Hủy gọi món ({rejectedOrders.length})
              </button>
            </div>

            <div className="pos-qr-confirm-modal__filters">
              <Select
                value={selectedAreaId}
                onChange={setSelectedAreaId}
                style={{ width: 140 }}
                size="middle"
                options={[
                  { value: 'ALL', label: 'Tất cả khu vực' },
                  ...effectiveAreas.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
              <Select
                value={selectedTableId}
                onChange={setSelectedTableId}
                style={{ width: 150 }}
                size="middle"
                options={[
                  { value: 'ALL', label: 'Tất cả phòng/bàn' },
                  ...availableTables.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </div>
          </div>

          {/* ── Orders List ────────────────────────────────────────────── */}
          <div className="pos-qr-confirm-modal__list">
            {ordersQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: '50px 0' }}>
                <Spin tip="Đang tải danh sách gọi món..." />
              </div>
            ) : filteredOrders.length === 0 ? (
              <Empty
                description={
                  statusTab === 'PENDING'
                    ? 'Không có yêu cầu gọi món nào đang chờ xác nhận'
                    : statusTab === 'ACCEPTED'
                      ? 'Chưa có đơn gọi món nào đã xác nhận'
                      : 'Không có đơn gọi món nào bị hủy'
                }
                style={{ padding: '48px 0' }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredOrders.map((order) => {
                  const isExpanded = expandedMap[order.id] !== false;
                  const totalVnd = (order.items ?? []).reduce(
                    (sum, item) => sum + item.lineTotalVnd,
                    0,
                  );

                  return (
                    <div
                      key={order.id}
                      className={`pos-qr-confirm-card ${statusTab === 'PENDING' ? 'pos-qr-confirm-card--pending' : ''}`}
                    >
                      {/* Card Header */}
                      <div
                        className="pos-qr-confirm-card__header"
                        onClick={() => toggleExpand(order.id)}
                      >
                        <div className="pos-qr-confirm-card__title-row">
                          <button
                            type="button"
                            className="pos-qr-confirm-card__toggle-btn"
                            aria-label="Thu gọn/Mở rộng"
                          >
                            {isExpanded ? <DownOutlined /> : <UpOutlined />}
                          </button>
                          <span className="pos-qr-confirm-card__table-name">
                            {order.tableName} - {order.areaName}
                          </span>
                          <span className="pos-qr-confirm-card__time">
                            <ClockCircleOutlined style={{ marginRight: 4 }} />
                            {formatRelativeTime(order.createdAt)}
                          </span>
                        </div>

                        {statusTab === 'PENDING' ? (
                          <div
                            className="pos-qr-confirm-card__actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              danger
                              size="middle"
                              onClick={() => {
                                setRejectingRequest(order);
                                setRejectReason('');
                              }}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                            >
                              Từ chối
                            </Button>
                            <Button
                              type="primary"
                              size="middle"
                              icon={<CheckOutlined />}
                              loading={
                                acceptMutation.isPending &&
                                acceptMutation.variables?.id === order.id
                              }
                              onClick={() => acceptMutation.mutate(order)}
                              disabled={acceptMutation.isPending || rejectMutation.isPending}
                            >
                              Xác nhận
                            </Button>
                          </div>
                        ) : (
                          <div className="pos-qr-confirm-card__total-pill">
                            {formatVnd(totalVnd)} đ
                          </div>
                        )}
                      </div>

                      {/* Card Body / Items */}
                      {isExpanded ? (
                        <div className="pos-qr-confirm-card__body">
                          <div className="pos-qr-confirm-card__items">
                            {order.items?.map((item) => (
                              <div key={item.id} className="pos-qr-confirm-card__item-row">
                                <div className="pos-qr-confirm-card__item-name">
                                  <span className="pos-qr-confirm-card__item-qty">
                                    {item.quantity} ×
                                  </span>
                                  <span>{item.productName}</span>
                                  {item.variantName && item.variantName !== 'Mặc định' ? (
                                    <span style={{ color: '#64748b', fontSize: 12 }}>
                                      {' '}
                                      ({item.variantName})
                                    </span>
                                  ) : null}
                                </div>
                                <div className="pos-qr-confirm-card__item-price">
                                  {formatVnd(item.lineTotalVnd)}
                                </div>
                              </div>
                            ))}
                          </div>

                          {order.note ? (
                            <div className="pos-qr-confirm-card__note">
                              💬 <strong>Ghi chú:</strong> {order.note}
                            </div>
                          ) : null}

                          {order.rejectedReason ? (
                            <div className="pos-qr-confirm-card__rejected-reason">
                              ⚠️ <strong>Lý do từ chối:</strong> {order.rejectedReason}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* ── Reject Reason Prompt Modal ───────────────────────────────── */}
      <Modal
        open={Boolean(rejectingRequest)}
        onCancel={() => {
          if (!rejectMutation.isPending) {
            setRejectingRequest(null);
            setRejectReason('');
          }
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
            <ExclamationCircleOutlined />
            <span>Từ chối yêu cầu gọi món {rejectingRequest?.tableName}</span>
          </div>
        }
        centered
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true, loading: rejectMutation.isPending }}
        cancelText="Quay lại"
        cancelButtonProps={{ disabled: rejectMutation.isPending }}
        onOk={() => {
          if (!rejectReason.trim()) {
            messageApi.warning('Vui lòng nhập lý do từ chối để khách được biết.');
            return;
          }
          if (rejectingRequest) {
            rejectMutation.mutate({
              request: rejectingRequest,
              reason: rejectReason.trim(),
            });
          }
        }}
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ fontSize: 13.5, color: '#475569', marginBottom: 8 }}>
            Vui lòng nhập lý do từ chối (VD: hết món, quầy bar quá tải, bàn chưa sẵn sàng):
          </p>
          <Input.TextArea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Nhập lý do để hiển thị trên màn hình khách..."
            maxLength={200}
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}
