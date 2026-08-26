import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  OwnerQrOrderSettingsDto,
  OwnerQrTableDto,
  QrQuickReasonDto,
} from '@contracts/owner-qr-order';
import type { GuestMenuProduct } from '@contracts/qr-order';
import { TableQrModal } from '@client/components/TableQrModal';
import { ApiError, apiRequest } from '@client/lib/api';

import { StoreLocationMapPicker } from './StoreLocationMapPicker';

interface SettingsFormValues {
  locationVerificationEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  locationMemoryMinutes: number;
  orderCooldownSeconds: number;
  callStaffCooldownSeconds: number;
  checkoutCooldownSeconds: number;
  salesScheduleEnabled: boolean;
}

interface DraftReason {
  key: string;
  id?: string;
  label: string;
  enabled: boolean;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function minuteToTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function timeToMinute(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function expandOvernightSalesHours(hours: OwnerQrOrderSettingsDto['salesHours']) {
  return hours.flatMap((window) => {
    if (window.endMinute > window.startMinute) return [window];
    const expanded = [{ ...window, endMinute: 1440 }];
    if (window.endMinute > 0) {
      expanded.push({
        id: crypto.randomUUID(),
        weekday: (window.weekday + 1) % 7,
        startMinute: 0,
        endMinute: window.endMinute,
      });
    }
    return expanded;
  });
}

function collapseOvernightSalesHours(hours: OwnerQrOrderSettingsDto['salesHours']) {
  const consumed = new Set<string>();
  const continuations = new Map<string, OwnerQrOrderSettingsDto['salesHours'][number]>();
  for (const window of hours) {
    if (window.endMinute !== 1440) continue;
    const continuation = hours.find(
      (candidate) => candidate.weekday === (window.weekday + 1) % 7 && candidate.startMinute === 0,
    );
    if (continuation) {
      consumed.add(continuation.id);
      continuations.set(window.id, continuation);
    }
  }
  return hours
    .filter((window) => !consumed.has(window.id))
    .map((window) =>
      window.endMinute === 1440
        ? { ...window, endMinute: continuations.get(window.id)?.endMinute ?? 0 }
        : window,
    );
}

function errorText(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  const issues = (error.details as { issues?: Array<{ message?: string }> } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

export function OwnerQrOrderSettingsPage() {
  const [form] = Form.useForm<SettingsFormValues>();
  const scheduleEnabled = Form.useWatch('salesScheduleEnabled', form);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [salesHours, setSalesHours] = useState<OwnerQrOrderSettingsDto['salesHours']>([]);
  const [reasons, setReasons] = useState<DraftReason[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingReasons, setSavingReasons] = useState(false);
  const [togglingTableId, setTogglingTableId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [salesStatusSaving, setSalesStatusSaving] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState('ALL');
  const [menuSearch, setMenuSearch] = useState('');
  const [menuCategory, setMenuCategory] = useState('ALL');
  const [qrPreview, setQrPreview] = useState<{
    tableName: string;
    url: string;
    image: string;
  } | null>(null);
  const [qrLoadingTableId, setQrLoadingTableId] = useState<string | null>(null);

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const store = useQuery({
    queryKey: ['owner-settings'],
    queryFn: () => apiRequest<{ name: string }>('/api/v1/owner/store/settings'),
  });
  const settings = useQuery({
    queryKey: ['owner-qr-order-settings'],
    queryFn: () => apiRequest<OwnerQrOrderSettingsDto>('/api/v1/owner/qr-order/settings'),
  });
  const tables = useQuery({
    queryKey: ['owner-qr-order-tables'],
    queryFn: () => apiRequest<OwnerQrTableDto[]>('/api/v1/owner/qr-order/tables'),
  });
  const menu = useQuery({
    queryKey: ['owner-qr-order-menu'],
    queryFn: () => apiRequest<GuestMenuProduct[]>('/api/v1/owner/qr-order/menu'),
  });
  const quickReasons = useQuery({
    queryKey: ['owner-qr-order-quick-reasons'],
    queryFn: () => apiRequest<QrQuickReasonDto[]>('/api/v1/owner/qr-order/quick-reasons'),
  });

  useEffect(() => {
    if (!settings.data) return;
    form.setFieldsValue({
      locationVerificationEnabled: settings.data.locationVerificationEnabled,
      latitude: settings.data.latitude,
      longitude: settings.data.longitude,
      allowedRadiusMeters: settings.data.allowedRadiusMeters,
      maxAccuracyMeters: settings.data.maxAccuracyMeters,
      locationMemoryMinutes: settings.data.locationMemoryMinutes,
      orderCooldownSeconds: settings.data.orderCooldownSeconds,
      callStaffCooldownSeconds: settings.data.callStaffCooldownSeconds,
      checkoutCooldownSeconds: settings.data.checkoutCooldownSeconds,
      salesScheduleEnabled: settings.data.salesScheduleEnabled,
    });
    setSalesHours(collapseOvernightSalesHours(settings.data.salesHours));
  }, [form, settings.data]);

  useEffect(() => {
    if (!quickReasons.data) return;
    setReasons(
      quickReasons.data.map((reason) => ({
        key: reason.id,
        id: reason.id,
        label: reason.label,
        enabled: reason.enabled,
      })),
    );
  }, [quickReasons.data]);

  const totalTables = tables.data?.length ?? 0;
  const enabledQrTables = (tables.data ?? []).filter((t) => t.qrOrderEnabled).length;

  const areaOptions = useMemo(() => {
    const areasMap = new Map<string, string>();
    for (const table of tables.data ?? []) {
      areasMap.set(table.areaId, table.areaName);
    }
    return [
      { value: 'ALL', label: 'Tất cả khu vực' },
      ...[...areasMap.entries()].map(([id, name]) => ({ value: id, label: name })),
    ];
  }, [tables.data]);

  const filteredTableGroups = useMemo(() => {
    const search = tableSearch.trim().toLocaleLowerCase('vi-VN');
    const filtered = (tables.data ?? []).filter((table) => {
      const matchArea = selectedAreaId === 'ALL' || table.areaId === selectedAreaId;
      const matchSearch =
        !search ||
        table.name.toLocaleLowerCase('vi-VN').includes(search) ||
        table.areaName.toLocaleLowerCase('vi-VN').includes(search);
      return matchArea && matchSearch;
    });

    const groups = new Map<string, { id: string; name: string; tables: OwnerQrTableDto[] }>();
    for (const table of filtered) {
      const group = groups.get(table.areaId) ?? {
        id: table.areaId,
        name: table.areaName,
        tables: [],
      };
      group.tables.push(table);
      groups.set(table.areaId, group);
    }
    return [...groups.values()];
  }, [tables.data, selectedAreaId, tableSearch]);

  const categories = useMemo(
    () => [
      'ALL',
      ...new Set((menu.data ?? []).map((product) => product.categoryName ?? 'Món khác')),
    ],
    [menu.data],
  );

  const filteredMenu = useMemo(() => {
    const search = menuSearch.trim().toLocaleLowerCase('vi-VN');
    return (menu.data ?? []).filter(
      (product) =>
        (menuCategory === 'ALL' || (product.categoryName ?? 'Món khác') === menuCategory) &&
        (!search || product.name.toLocaleLowerCase('vi-VN').includes(search)),
    );
  }, [menu.data, menuCategory, menuSearch]);

  const request = async <T,>(path: string, init: RequestInit) =>
    apiRequest<T>(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': auth.data?.csrfToken ?? '',
        ...init.headers,
      },
    });

  const currentSettingsValues = (): SettingsFormValues => {
    if (!settings.data) throw new Error('QR_ORDER_SETTINGS_NOT_LOADED');
    const current = form.getFieldsValue(true) as Partial<SettingsFormValues>;
    const saved: SettingsFormValues = {
      locationVerificationEnabled: settings.data.locationVerificationEnabled,
      latitude: settings.data.latitude,
      longitude: settings.data.longitude,
      allowedRadiusMeters: settings.data.allowedRadiusMeters,
      maxAccuracyMeters: settings.data.maxAccuracyMeters,
      locationMemoryMinutes: settings.data.locationMemoryMinutes,
      orderCooldownSeconds: settings.data.orderCooldownSeconds,
      callStaffCooldownSeconds: settings.data.callStaffCooldownSeconds,
      checkoutCooldownSeconds: settings.data.checkoutCooldownSeconds,
      salesScheduleEnabled: settings.data.salesScheduleEnabled,
    };
    const definedCurrent = Object.fromEntries(
      Object.entries(current).filter(([, value]) => value !== undefined),
    );
    return { ...saved, ...definedCurrent } as SettingsFormValues;
  };

  const saveSettings = async () => {
    await form.validateFields();
    const values = currentSettingsValues();
    if (
      values.locationVerificationEnabled &&
      (values.latitude === null || values.longitude === null)
    ) {
      messageApi.error('Vui lòng chọn vị trí cửa hàng trên bản đồ.');
      return;
    }
    setSavingSettings(true);
    try {
      await request('/api/v1/owner/qr-order/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...values, salesHours: expandOvernightSalesHours(salesHours) }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-settings'] });
      messageApi.success('Đã lưu cấu hình QR Order.');
    } catch (error) {
      messageApi.error(errorText(error, 'Không thể lưu cấu hình.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleTable = async (table: OwnerQrTableDto, enabled: boolean) => {
    setTogglingTableId(table.id);
    try {
      await request(`/api/v1/owner/qr-order/tables/${table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-tables'] });
      messageApi.success(enabled ? 'Đã bật QR Order cho bàn.' : 'Đã tắt QR Order cho bàn.');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể đổi trạng thái QR.');
    } finally {
      setTogglingTableId(null);
    }
  };

  const bulkToggle = async (enabled: boolean) => {
    const candidates = (tables.data ?? []).filter(
      (table) => enabled || table.status !== 'OCCUPIED',
    );
    if (!candidates.length) return;
    setBulkSaving(true);
    try {
      await request('/api/v1/owner/qr-order/tables/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ tableIds: candidates.map((table) => table.id), enabled }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-tables'] });
      messageApi.success(enabled ? 'Đã bật QR Order hàng loạt.' : 'Đã tắt các bàn có thể tắt.');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể cập nhật hàng loạt.');
    } finally {
      setBulkSaving(false);
    }
  };

  const viewQr = async (table: OwnerQrTableDto) => {
    setQrLoadingTableId(table.id);
    try {
      const result = await apiRequest<{ path: string }>(
        `/api/v1/owner/qr-order/tables/${table.id}/qr-code`,
      );
      const url = new URL(result.path, window.location.origin).toString();
      const { default: QRCode } = await import('qrcode');
      setQrPreview({
        tableName: table.name,
        url,
        image: await QRCode.toDataURL(url, { width: 640, margin: 2 }),
      });
      void queryClient.invalidateQueries({ queryKey: ['owner-qr-order-tables'] });
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể lấy mã QR.');
    } finally {
      setQrLoadingTableId(null);
    }
  };

  const setSalesPaused = async (paused: boolean) => {
    setSalesStatusSaving(true);
    try {
      await request('/api/v1/owner/qr-order/sales-status', {
        method: 'PATCH',
        body: JSON.stringify({ paused }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-settings'] });
      messageApi.success(paused ? 'Đã dừng nhận gọi món.' : 'Đã bỏ trạng thái dừng thủ công.');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể đổi trạng thái bán.');
    } finally {
      setSalesStatusSaving(false);
    }
  };

  const saveReasons = async () => {
    if (reasons.some((reason) => !reason.label.trim())) {
      messageApi.error('Nội dung lý do không được để trống.');
      return;
    }
    setSavingReasons(true);
    try {
      await request('/api/v1/owner/qr-order/quick-reasons', {
        method: 'PUT',
        body: JSON.stringify({
          reasons: reasons.map((reason) => ({
            ...(reason.id ? { id: reason.id } : {}),
            label: reason.label,
            enabled: reason.enabled,
          })),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-quick-reasons'] });
      messageApi.success('Đã lưu lý do gọi nhân viên nhanh.');
    } catch (error) {
      messageApi.error(errorText(error, 'Không thể lưu lý do.'));
    } finally {
      setSavingReasons(false);
    }
  };

  const toggleMenuVariant = async (
    product: GuestMenuProduct,
    variantId: string,
    enabled: boolean,
  ) => {
    try {
      await request(`/api/v1/owner/qr-order/menu/variants/${variantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-qr-order-menu'] });
      messageApi.success(
        enabled
          ? `Đã hiển thị phiên bản ${product.name} trên QR Order.`
          : `Đã ẩn phiên bản ${product.name} khỏi QR Order.`,
      );
    } catch (error) {
      messageApi.error(errorText(error, 'Không thể đổi trạng thái hiển thị phiên bản.'));
    }
  };

  const moveReason = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= reasons.length) return;
    setReasons((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  };

  const addWindow = (weekday: number) => {
    if (salesHours.filter((window) => window.weekday === weekday).length >= 4) return;
    setSalesHours((current) => [
      ...current,
      { id: crypto.randomUUID(), weekday, startMinute: 8 * 60, endMinute: 22 * 60 },
    ]);
  };

  const updateWindow = (id: string, field: 'startMinute' | 'endMinute', value: number) => {
    setSalesHours((current) =>
      current.map((window) => (window.id === id ? { ...window, [field]: value } : window)),
    );
  };

  if (settings.isLoading || tables.isLoading || quickReasons.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <Spin description="Đang tải cấu hình QR Order" />
      </div>
    );
  }

  const isAccepting = settings.data?.availability.acceptingOrders;
  const isManuallyPaused = settings.data?.availability.reason === 'MANUALLY_PAUSED';

  const qrConfig = (
    <div>
      {/* 1. Location Verification */}
      <Card className="owner-qr-card" title="Xác minh vị trí khách hàng">
        <div className="owner-qr-switch-row">
          <div className="owner-qr-switch-row__copy">
            <strong>Bắt buộc quét QR tại quán</strong>
            <span>
              Khách quét QR cần cho phép truy cập vị trí GPS để xác thực trước khi gọi món.
            </span>
          </div>
          <Form.Item name="locationVerificationEnabled" valuePropName="checked" noStyle>
            <Switch checkedChildren="Bật" unCheckedChildren="Tắt" />
          </Form.Item>
        </div>

        <Form.Item noStyle shouldUpdate>
          {() =>
            form.getFieldValue('locationVerificationEnabled') ? (
              <>
                <StoreLocationMapPicker
                  latitude={form.getFieldValue('latitude')}
                  longitude={form.getFieldValue('longitude')}
                  radiusMeters={form.getFieldValue('allowedRadiusMeters') ?? 300}
                  maxAccuracyMeters={form.getFieldValue('maxAccuracyMeters') ?? 100}
                  onChange={(coords) => form.setFieldsValue(coords)}
                  onRadiusChange={(value) => form.setFieldValue('allowedRadiusMeters', value)}
                  onMaxAccuracyChange={(value) => form.setFieldValue('maxAccuracyMeters', value)}
                />
                <div style={{ marginTop: 12, maxWidth: 280 }}>
                  <Form.Item
                    name="locationMemoryMinutes"
                    label={
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#475569',
                          textTransform: 'uppercase',
                        }}
                      >
                        Ghi nhớ vị trí trong
                      </span>
                    }
                    rules={[{ required: true }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={5} max={480} addonAfter="phút" style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              </>
            ) : null
          }
        </Form.Item>

        <div className="owner-qr-card-footer">
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={savingSettings}
            onClick={saveSettings}
          >
            Lưu cấu hình vị trí
          </Button>
        </div>
      </Card>

      {/* 2. Tables & QR Management */}
      <Card
        className="owner-qr-card"
        title={
          <Space size={8}>
            <span>Mã QR theo bàn/phòng</span>
            <Tag style={{ margin: 0, borderRadius: 10, fontSize: 11 }}>
              {enabledQrTables}/{totalTables} bàn bật QR
            </Tag>
          </Space>
        }
      >
        <div className="owner-qr-table-toolbar">
          <div className="owner-qr-table-toolbar__filters">
            <Input
              allowClear
              placeholder="Tìm bàn..."
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              style={{ maxWidth: 200 }}
            />
            <Select
              value={selectedAreaId}
              onChange={setSelectedAreaId}
              options={areaOptions}
              style={{ width: 160 }}
            />
          </div>
          <div className="owner-qr-table-toolbar__actions">
            <Button size="small" loading={bulkSaving} onClick={() => void bulkToggle(true)}>
              Bật tất cả
            </Button>
            <Button size="small" loading={bulkSaving} onClick={() => void bulkToggle(false)}>
              Tắt bàn rảnh
            </Button>
          </div>
        </div>

        {filteredTableGroups.length ? (
          <div>
            {filteredTableGroups.map((group) => (
              <div key={group.id} className="owner-qr-area-group">
                <div className="owner-qr-area-title">
                  <span>{group.name}</span>
                  <span className="owner-qr-area-count">({group.tables.length} bàn)</span>
                </div>
                <div className="owner-qr-table-grid">
                  {group.tables.map((table) => (
                    <div
                      key={table.id}
                      className={`owner-qr-table-card${!table.qrOrderEnabled ? ' is-disabled' : ''}`}
                    >
                      <div className="owner-qr-table-info">
                        <div className="owner-qr-table-name-wrap">
                          <span className="owner-qr-table-name">{table.name}</span>
                          <Tag
                            className="owner-qr-table-status-tag"
                            color={
                              table.status === 'OCCUPIED'
                                ? 'warning'
                                : table.status === 'DISABLED'
                                  ? 'default'
                                  : 'success'
                            }
                          >
                            {table.status === 'OCCUPIED'
                              ? 'Đang phục vụ'
                              : table.status === 'DISABLED'
                                ? 'Tạm ngưng'
                                : 'Trống'}
                          </Tag>
                        </div>
                        <span className="owner-qr-table-meta">
                          {table.qrExists ? 'Mã QR cố định sẵn sàng' : 'Chưa tạo mã QR'}
                        </span>
                      </div>

                      <div className="owner-qr-table-actions">
                        <Tooltip title="Xem hoặc tải mã QR bàn">
                          <Button
                            size="small"
                            icon={<QrcodeOutlined />}
                            loading={qrLoadingTableId === table.id}
                            onClick={() => void viewQr(table)}
                          >
                            QR
                          </Button>
                        </Tooltip>
                        <Tooltip
                          title={
                            table.status === 'OCCUPIED' && table.qrOrderEnabled
                              ? 'Không thể tắt QR của bàn đang phục vụ'
                              : table.qrOrderEnabled
                                ? 'Đang bật QR Order'
                                : 'Đang tắt QR Order'
                          }
                        >
                          <Switch
                            size="small"
                            checked={table.qrOrderEnabled}
                            disabled={table.status === 'OCCUPIED' && table.qrOrderEnabled}
                            loading={togglingTableId === table.id}
                            onChange={(enabled) => void toggleTable(table, enabled)}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="Không có bàn/phòng nào phù hợp" style={{ padding: '24px 0' }} />
        )}
      </Card>
    </div>
  );

  const salesConfig = (
    <div>
      {/* 1. Status Banner */}
      {settings.data ? (
        <div
          className={`owner-qr-status-banner ${
            isAccepting ? 'is-open' : isManuallyPaused ? 'is-paused' : 'is-outside'
          }`}
        >
          <div className="owner-qr-status-banner__text">
            <span className="owner-qr-status-banner__title">
              {isAccepting
                ? '🟢 Cửa hàng đang nhận đơn từ QR Order'
                : isManuallyPaused
                  ? '⏸️ Cửa hàng đang tạm dừng nhận đơn thủ công'
                  : '🕒 Cửa hàng đang ngoài khung giờ phục vụ'}
            </span>
            {settings.data.availability.nextOpenAt ? (
              <span className="owner-qr-status-banner__desc">
                Dự kiến mở lại lúc:{' '}
                {new Date(settings.data.availability.nextOpenAt).toLocaleString('vi-VN')}
              </span>
            ) : (
              <span className="owner-qr-status-banner__desc">
                {isAccepting
                  ? 'Khách quét QR có thể xem thực đơn và gửi yêu cầu gọi món bình thường.'
                  : 'Khách quét QR sẽ thấy thông báo tạm ngưng nhận đơn.'}
              </span>
            )}
          </div>
          <Button
            size="middle"
            danger={!settings.data.salesPaused}
            type={settings.data.salesPaused ? 'primary' : 'default'}
            loading={salesStatusSaving}
            onClick={() => void setSalesPaused(!settings.data.salesPaused)}
          >
            {settings.data.salesPaused ? 'Mở bán lại' : 'Tạm dừng ngay'}
          </Button>
        </div>
      ) : null}

      {/* 2. Cooldowns */}
      <Card className="owner-qr-card" title="Khoảng cách giữa các yêu cầu từ khách">
        <div className="owner-qr-cooldowns-grid">
          <div className="owner-qr-cooldown-item">
            <label>Gửi đơn gọi món</label>
            <Form.Item name="orderCooldownSeconds" noStyle rules={[{ required: true }]}>
              <InputNumber min={1} max={3600} addonAfter="giây" style={{ width: '100%' }} />
            </Form.Item>
            <small>Khoảng cách tối thiểu giữa 2 lần gửi món</small>
          </div>

          <div className="owner-qr-cooldown-item">
            <label>Gọi nhân viên</label>
            <Form.Item name="callStaffCooldownSeconds" noStyle rules={[{ required: true }]}>
              <InputNumber min={1} max={3600} addonAfter="giây" style={{ width: '100%' }} />
            </Form.Item>
            <small>Khoảng cách tối thiểu giữa 2 lần gọi phục vụ</small>
          </div>

          <div className="owner-qr-cooldown-item">
            <label>Yêu cầu thanh toán</label>
            <Form.Item name="checkoutCooldownSeconds" noStyle rules={[{ required: true }]}>
              <InputNumber min={1} max={3600} addonAfter="giây" style={{ width: '100%' }} />
            </Form.Item>
            <small>Khoảng cách tối thiểu giữa 2 lần xin tính tiền</small>
          </div>
        </div>

        <div className="owner-qr-card-footer">
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={savingSettings}
            onClick={saveSettings}
          >
            Lưu thời gian chờ
          </Button>
        </div>
      </Card>

      {/* 3. Weekly Schedule */}
      <Card className="owner-qr-card" title="Lịch nhận đơn theo tuần">
        <div className="owner-qr-switch-row">
          <div className="owner-qr-switch-row__copy">
            <strong>Giới hạn khung giờ nhận đơn</strong>
            <span>Nếu tắt, cửa hàng sẽ nhận đơn liên tục 24/7 (hoặc tới khi bấm tạm dừng).</span>
          </div>
          <Form.Item name="salesScheduleEnabled" valuePropName="checked" noStyle>
            <Switch checkedChildren="Theo lịch" unCheckedChildren="Mở 24/7" />
          </Form.Item>
        </div>

        {scheduleEnabled ? (
          <div className="owner-qr-schedule-list">
            {WEEKDAYS.map((label, weekday) => {
              const windows = salesHours.filter((window) => window.weekday === weekday);
              return (
                <div key={label} className="owner-qr-schedule-row">
                  <span className="owner-qr-schedule-day">{label}</span>
                  <div className="owner-qr-schedule-slots">
                    {windows.length ? (
                      windows.map((window) => (
                        <span key={window.id} className="owner-qr-schedule-slot">
                          <input
                            type="time"
                            value={minuteToTime(window.startMinute)}
                            onChange={(e) =>
                              updateWindow(window.id, 'startMinute', timeToMinute(e.target.value))
                            }
                          />
                          <span style={{ color: '#94a3b8' }}>–</span>
                          <input
                            type="time"
                            value={minuteToTime(window.endMinute)}
                            onChange={(e) =>
                              updateWindow(window.id, 'endMinute', timeToMinute(e.target.value))
                            }
                          />
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                            onClick={() =>
                              setSalesHours((curr) => curr.filter((w) => w.id !== window.id))
                            }
                            style={{ width: 20, height: 20, padding: 0 }}
                          />
                        </span>
                      ))
                    ) : (
                      <span className="owner-qr-schedule-empty-day">Nghỉ nhận đơn cả ngày</span>
                    )}
                  </div>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={windows.length >= 4}
                    onClick={() => addWindow(weekday)}
                  >
                    Thêm giờ
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="owner-qr-card-footer">
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={savingSettings}
            onClick={saveSettings}
          >
            Lưu lịch bán hàng
          </Button>
        </div>
      </Card>

      {/* 4. Quick Reasons */}
      <Card
        className="owner-qr-card"
        title="Lý do gọi nhân viên nhanh"
        extra={
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            disabled={reasons.length >= 20}
            onClick={() =>
              setReasons((curr) => [
                ...curr,
                { key: crypto.randomUUID(), label: '', enabled: true },
              ])
            }
          >
            Thêm lý do
          </Button>
        }
      >
        <div className="owner-qr-reasons-list">
          {reasons.map((reason, index) => (
            <div key={reason.key} className="owner-qr-reason-row">
              <div className="owner-qr-reason-order-btns">
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowUpOutlined style={{ fontSize: 11 }} />}
                  disabled={index === 0}
                  onClick={() => moveReason(index, -1)}
                  style={{ width: 20, height: 24, padding: 0 }}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowDownOutlined style={{ fontSize: 11 }} />}
                  disabled={index === reasons.length - 1}
                  onClick={() => moveReason(index, 1)}
                  style={{ width: 20, height: 24, padding: 0 }}
                />
              </div>
              <Input
                size="small"
                maxLength={80}
                value={reason.label}
                placeholder="Nhập nội dung lý do (VD: Lấy thêm đá, Hỗ trợ thanh toán...)"
                onChange={(e) =>
                  setReasons((curr) =>
                    curr.map((r) => (r.key === reason.key ? { ...r, label: e.target.value } : r)),
                  )
                }
              />
              <Switch
                size="small"
                checked={reason.enabled}
                onChange={(enabled) =>
                  setReasons((curr) =>
                    curr.map((r) => (r.key === reason.key ? { ...r, enabled } : r)),
                  )
                }
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                onClick={() => setReasons((curr) => curr.filter((r) => r.key !== reason.key))}
                style={{ width: 24, height: 24, padding: 0 }}
              />
            </div>
          ))}
        </div>

        <div className="owner-qr-card-footer">
          <Button
            type="primary"
            loading={savingReasons}
            onClick={saveReasons}
            icon={<SaveOutlined />}
          >
            Lưu danh sách lý do
          </Button>
        </div>
      </Card>

      {/* 5. Menu on QR */}
      <Card
        className="owner-qr-card"
        title={
          <Space size={8}>
            <span>Thực đơn bán qua QR</span>
            <Tag style={{ margin: 0, borderRadius: 10, fontSize: 11 }}>
              {filteredMenu.length} món
            </Tag>
          </Space>
        }
      >
        <div className="owner-qr-menu-toolbar">
          <Space wrap size={8}>
            <Input
              allowClear
              placeholder="Tìm tên món..."
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              value={menuCategory}
              style={{ width: 180 }}
              onChange={setMenuCategory}
              options={categories.map((category) => ({
                value: category,
                label: category === 'ALL' ? 'Tất cả danh mục' : category,
              }))}
            />
          </Space>
        </div>

        {menu.isLoading ? (
          <Spin style={{ padding: 24 }} />
        ) : filteredMenu.length ? (
          <div>
            {filteredMenu.map((product) => (
              <div key={product.id} className="owner-qr-menu-item">
                <div className="owner-qr-menu-item-info">
                  <div className="owner-qr-menu-item-title">
                    <strong>{product.name}</strong>
                    <Tag style={{ fontSize: 11, margin: 0, borderRadius: 4 }}>
                      {product.categoryName ?? 'Món khác'}
                    </Tag>
                  </div>
                  <div className="owner-qr-menu-item-variants">
                    {product.variants.map((variant) => (
                      <Space key={variant.id} size={4}>
                        <span
                          style={{
                            fontSize: 11,
                            color: '#475569',
                            background: '#f1f5f9',
                            padding: '1px 6px',
                            borderRadius: 4,
                          }}
                        >
                          {variant.name}: {variant.salePriceVnd.toLocaleString('vi-VN')}đ
                        </span>
                        <Switch
                          size="small"
                          checked={variant.qrOrderEnabled !== false}
                          checkedChildren="Hiện"
                          unCheckedChildren="Ẩn"
                          onChange={(enabled) =>
                            void toggleMenuVariant(product, variant.id, enabled)
                          }
                        />
                      </Space>
                    ))}
                  </div>
                </div>

                <div className="owner-qr-menu-item-actions">
                  <Button
                    type="link"
                    size="small"
                    onClick={() => navigate(`/owner/catalog/products/${product.id}`)}
                    style={{ padding: 0 }}
                  >
                    Chi tiết
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="Không tìm thấy món phù hợp" style={{ padding: '24px 0' }} />
        )}
      </Card>
    </div>
  );

  return (
    <div className="owner-qr-settings-page">
      {contextHolder}
      <div className="owner-qr-header">
        <div className="owner-qr-header__info">
          <Typography.Title level={2}>Cấu hình QR Order</Typography.Title>
          <Typography.Text type="secondary">
            Quản lý mã QR theo bàn, vị trí quán và quy tắc nhận đơn từ khách.
          </Typography.Text>
        </div>
        <div>
          {isAccepting ? (
            <span className="owner-qr-header__badge is-active">
              <span className="owner-qr-header__badge-dot" /> Đang nhận đơn
            </span>
          ) : isManuallyPaused ? (
            <span className="owner-qr-header__badge is-paused">
              <span className="owner-qr-header__badge-dot" /> Tạm dừng nhận đơn
            </span>
          ) : (
            <span className="owner-qr-header__badge is-outside">
              <span className="owner-qr-header__badge-dot" /> Ngoài giờ phục vụ
            </span>
          )}
        </div>
      </div>

      {settings.isError || tables.isError || quickReasons.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không tải được đầy đủ cấu hình QR Order"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Form form={form} layout="vertical">
        <Tabs
          className="owner-qr-tabs"
          items={[
            { key: 'qr', label: 'Cấu hình QR & Bàn', children: qrConfig },
            { key: 'sales', label: 'Cấu hình bán hàng', children: salesConfig },
          ]}
        />
      </Form>

      {qrPreview ? (
        <TableQrModal
          open
          onClose={() => setQrPreview(null)}
          tableName={qrPreview.tableName}
          url={qrPreview.url}
          qrImageSrc={qrPreview.image}
          storeName={store.data?.name ?? 'PRO POS'}
        />
      ) : null}
    </div>
  );
}
