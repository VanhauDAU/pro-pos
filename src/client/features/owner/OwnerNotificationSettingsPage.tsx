import {
  ArrowLeftOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CreditCardOutlined,
  DownOutlined,
  EditOutlined,
  ExperimentOutlined,
  MobileOutlined,
  PrinterOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  SoundOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  StaffNotificationItemDto,
  StoreNotificationOverviewDto,
  UpdateStaffNotificationInput,
} from '@contracts/staff-notifications';
import { apiRequest, jsonRequest } from '@client/lib/api';
import { playPushNotificationSound, posSound, warmPosSounds } from '@client/lib/sound';
import { PushNotificationControl } from '@client/features/pwa/PushNotificationControl';

const NOTIFICATIONS_QUERY_KEY = ['owner-notification-settings'];

type TestNotificationKind =
  | 'ORDER_PAID'
  | 'QR_ORDER'
  | 'CALL_STAFF'
  | 'CHECKOUT_REQUEST'
  | 'TABLE_OPEN_REQUEST'
  | 'PRINT_COMPLETED';

function applyStaffNotificationSettings(
  item: StaffNotificationItemDto,
  settings: UpdateStaffNotificationInput,
): StaffNotificationItemDto {
  return {
    ...item,
    ...(settings.enabled !== undefined ? { enabled: settings.enabled } : {}),
    ...(settings.onlyActiveSessions !== undefined
      ? { onlyActiveSessions: settings.onlyActiveSessions }
      : {}),
    ...(settings.notifyOrderPaid !== undefined
      ? { notifyOrderPaid: settings.notifyOrderPaid }
      : {}),
    ...(settings.notifyQrOrder !== undefined ? { notifyQrOrder: settings.notifyQrOrder } : {}),
    ...(settings.notifyCallStaff !== undefined
      ? { notifyCallStaff: settings.notifyCallStaff }
      : {}),
    ...(settings.notifyCheckoutRequest !== undefined
      ? { notifyCheckoutRequest: settings.notifyCheckoutRequest }
      : {}),
    ...(settings.notifyTableOpenRequest !== undefined
      ? { notifyTableOpenRequest: settings.notifyTableOpenRequest }
      : {}),
    ...(settings.notifyPrintStatus !== undefined
      ? { notifyPrintStatus: settings.notifyPrintStatus }
      : {}),
  };
}

export function OwnerNotificationSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const csrfToken = authContext.data?.csrfToken ?? '';

  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [editUser, setEditUser] = useState<StaffNotificationItemDto | null>(null);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testKind, setTestKind] = useState<TestNotificationKind>('ORDER_PAID');
  const [testTargetUserId, setTestTargetUserId] = useState<string | undefined>(undefined);
  const [showGuide, setShowGuide] = useState(true);

  const [editForm] = Form.useForm<UpdateStaffNotificationInput>();

  useEffect(() => {
    warmPosSounds([
      'PAYMENT_SUCCESS',
      'NEW_QR_ORDER',
      'CALL_STAFF',
      'CHECKOUT_REQUEST',
      'TABLE_OPEN_REQUEST',
    ]);
    void posSound.unlock();
  }, []);

  const overviewQuery = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => apiRequest<StoreNotificationOverviewDto>('/api/v1/owner/notifications/settings'),
  });

  const updateSingleMutation = useMutation({
    mutationFn: async ({
      userId,
      settings,
    }: {
      userId: string;
      settings: UpdateStaffNotificationInput;
    }) => {
      await jsonRequest(`/api/v1/owner/notifications/settings/${userId}`, settings, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': csrfToken },
      });
    },
    onMutate: async ({ userId, settings }) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previousData =
        queryClient.getQueryData<StoreNotificationOverviewDto>(NOTIFICATIONS_QUERY_KEY);
      if (previousData) {
        const nextItems = previousData.items.map((item) => {
          if (item.userId === userId) {
            return applyStaffNotificationSettings(item, settings);
          }
          return item;
        });
        const enabledCount = nextItems.filter((i) => i.enabled).length;
        queryClient.setQueryData<StoreNotificationOverviewDto>(NOTIFICATIONS_QUERY_KEY, {
          ...previousData,
          items: nextItems,
          enabledStaffCount: enabledCount,
        });
      }
      return { previousData };
    },
    onError: (err: unknown, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previousData);
      }
      messageApi.error(err instanceof Error ? err.message : 'Không thể lưu cấu hình');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({
      userIds,
      settings,
    }: {
      userIds: string[];
      settings: UpdateStaffNotificationInput;
    }) => {
      await jsonRequest(
        '/api/v1/owner/notifications/settings/bulk',
        { userIds, settings },
        { headers: { 'X-CSRF-Token': csrfToken } },
      );
    },
    onMutate: async ({ userIds, settings }) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const previousData =
        queryClient.getQueryData<StoreNotificationOverviewDto>(NOTIFICATIONS_QUERY_KEY);
      if (previousData) {
        const userSet = new Set(userIds);
        const nextItems = previousData.items.map((item) => {
          if (userSet.has(item.userId)) {
            return applyStaffNotificationSettings(item, settings);
          }
          return item;
        });
        const enabledCount = nextItems.filter((i) => i.enabled).length;
        queryClient.setQueryData<StoreNotificationOverviewDto>(NOTIFICATIONS_QUERY_KEY, {
          ...previousData,
          items: nextItems,
          enabledStaffCount: enabledCount,
        });
      }
      return { previousData };
    },
    onSuccess: () => {
      messageApi.success('Đã cập nhật hàng loạt nhân viên');
    },
    onError: (err: unknown, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previousData);
      }
      messageApi.error(err instanceof Error ? err.message : 'Không thể cập nhật hàng loạt');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });

  const sendTestNotificationMutation = useMutation({
    mutationFn: async ({ kind, userId, tag }: { kind: string; userId?: string; tag?: string }) => {
      return jsonRequest<{ sent: number; failed: number; disabled: boolean }>(
        '/api/v1/owner/notifications/test',
        { kind, ...(userId ? { userId } : {}), ...(tag ? { tag } : {}) },
        { headers: { 'X-CSRF-Token': csrfToken } },
      );
    },
    onSuccess: (data) => {
      if (data.disabled) {
        messageApi.warning('Hệ thống Push Notification chưa cấu hình VAPID.');
      } else if (data.sent > 0) {
        messageApi.success(`Đã bắn thông báo thử nghiệm tới ${data.sent} thiết bị!`);
      } else {
        messageApi.info(
          'Đã gửi nhưng chưa có thiết bị nào nhận (do chưa bật nhận hoặc chưa có phiên active).',
        );
      }
      setTestModalVisible(false);
    },
    onError: (err: unknown) => {
      messageApi.error(err instanceof Error ? err.message : 'Không thể gửi thông báo thử nghiệm');
    },
  });

  const handleToggleSingle = useCallback(
    (item: StaffNotificationItemDto, field: keyof UpdateStaffNotificationInput, value: boolean) => {
      updateSingleMutation.mutate({
        userId: item.userId,
        settings: { [field]: value },
      });
    },
    [updateSingleMutation],
  );

  const openEditModal = (item: StaffNotificationItemDto) => {
    setEditUser(item);
    editForm.setFieldsValue({
      enabled: item.enabled,
      onlyActiveSessions: item.onlyActiveSessions,
      notifyOrderPaid: item.notifyOrderPaid,
      notifyQrOrder: item.notifyQrOrder,
      notifyCallStaff: item.notifyCallStaff,
      notifyCheckoutRequest: item.notifyCheckoutRequest,
      notifyTableOpenRequest: item.notifyTableOpenRequest,
      notifyPrintStatus: item.notifyPrintStatus,
    });
  };

  const handleSaveModal = async () => {
    if (!editUser) return;
    try {
      const values = await editForm.validateFields();
      updateSingleMutation.mutate(
        { userId: editUser.userId, settings: values },
        {
          onSuccess: () => {
            messageApi.success(`Đã lưu cấu hình cho ${editUser.displayName}`);
            setEditUser(null);
          },
        },
      );
    } catch {
      // Form validation error
    }
  };

  const items = overviewQuery.data?.items ?? [];

  const rolesList = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(item.roleName));
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (roleFilter !== 'ALL' && item.roleName !== roleFilter) return false;
      if (searchText.trim()) {
        const query = searchText.toLowerCase().trim();
        return (
          item.displayName.toLowerCase().includes(query) ||
          item.username.toLowerCase().includes(query) ||
          item.roleName.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, roleFilter, searchText]);

  const allUserIds = useMemo(() => items.map((i) => i.userId), [items]);

  const handleBulkToggle = useCallback(
    (field: keyof UpdateStaffNotificationInput, value: boolean) => {
      if (allUserIds.length === 0) return;
      bulkUpdateMutation.mutate({
        userIds: allUserIds,
        settings: { [field]: value },
      });
    },
    [allUserIds, bulkUpdateMutation],
  );

  const bulkMenuItems: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'enable-all',
        icon: <CheckCircleOutlined style={{ color: '#16a34a' }} />,
        label: 'Bật nhận thông báo cho tất cả',
        onClick: () => handleBulkToggle('enabled', true),
      },
      {
        key: 'disable-all',
        icon: <CloseCircleOutlined style={{ color: '#dc2626' }} />,
        label: 'Tắt nhận thông báo cho tất cả',
        onClick: () => handleBulkToggle('enabled', false),
      },
      {
        type: 'divider',
      },
      {
        key: 'active-sessions-all',
        icon: <MobileOutlined style={{ color: '#2563eb' }} />,
        label: 'Bật "Chỉ khi còn phiên" cho tất cả',
        onClick: () => handleBulkToggle('onlyActiveSessions', true),
      },
      {
        key: 'order-paid-all',
        icon: <CreditCardOutlined style={{ color: '#059669' }} />,
        label: 'Bật "Báo thanh toán" cho tất cả',
        onClick: () => handleBulkToggle('notifyOrderPaid', true),
      },
      {
        key: 'qr-order-all',
        icon: <QrcodeOutlined style={{ color: '#2563eb' }} />,
        label: 'Bật "Gọi món QR" cho tất cả',
        onClick: () => handleBulkToggle('notifyQrOrder', true),
      },
    ],
    [handleBulkToggle],
  );

  const columns: ColumnsType<StaffNotificationItemDto> = useMemo(
    () => [
      {
        title: 'Tài khoản nhân viên',
        key: 'user',
        width: 260,
        fixed: 'left',
        render: (_, record) => {
          const isOwner = record.roleCode === 'OWNER';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar
                size={42}
                style={{
                  backgroundColor: isOwner ? '#e11d48' : '#0975f7',
                  fontWeight: 600,
                  fontSize: 16,
                  flexShrink: 0,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                }}
              >
                {record.displayName.slice(0, 1).toUpperCase()}
              </Avatar>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>{record.displayName}</strong>
                  {isOwner ? (
                    <Tag
                      color="volcano"
                      style={{ margin: 0, fontSize: 11, lineHeight: '18px', borderRadius: 4 }}
                    >
                      Chủ cửa hàng
                    </Tag>
                  ) : (
                    <Tag
                      color="blue"
                      style={{ margin: 0, fontSize: 11, lineHeight: '18px', borderRadius: 4 }}
                    >
                      {record.roleName}
                    </Tag>
                  )}
                </div>
                <span style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  @{record.username}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        title: 'PWA & Phiên đăng nhập',
        key: 'deviceStatus',
        width: 190,
        render: (_, record) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {record.hasPushSubscription ? (
              <Badge
                status="success"
                text={
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: '#16a34a' }}>
                    Đã liên kết PWA
                  </span>
                }
              />
            ) : (
              <Badge
                status="default"
                text={
                  <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Chưa đăng ký thiết bị</span>
                }
              />
            )}
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Phiên active:{' '}
              <strong style={{ color: record.activeSessionsCount > 0 ? '#0f172a' : '#94a3b8' }}>
                {record.activeSessionsCount}
              </strong>
            </span>
          </div>
        ),
      },
      {
        title: (
          <Tooltip title="Bật hoặc tắt toàn bộ thông báo cho nhân viên này">
            <span>Nhận thông báo</span>
          </Tooltip>
        ),
        key: 'enabled',
        width: 130,
        align: 'center',
        render: (_, record) => (
          <Switch
            checked={record.enabled}
            onChange={(checked) => handleToggleSingle(record, 'enabled', checked)}
          />
        ),
      },
      {
        title: (
          <Tooltip title="Chỉ gửi thông báo khi nhân viên đang có phiên làm việc active trên POS. Khi đăng xuất hoặc hết ca sẽ dừng nhận.">
            <span>Chỉ khi còn phiên ℹ️</span>
          </Tooltip>
        ),
        key: 'onlyActiveSessions',
        width: 150,
        align: 'center',
        render: (_, record) => (
          <Tooltip
            title={
              record.onlyActiveSessions
                ? 'Đang bật: Chỉ gửi khi nhân viên có phiên active'
                : 'Đang tắt: Gửi thông báo mọi lúc'
            }
          >
            <Switch
              checked={record.onlyActiveSessions}
              disabled={!record.enabled}
              onChange={(checked) => handleToggleSingle(record, 'onlyActiveSessions', checked)}
            />
          </Tooltip>
        ),
      },
      {
        title: 'Các loại thông báo sự kiện PWA',
        key: 'notificationTypes',
        width: 480,
        render: (_, record) => {
          const disabled = !record.enabled;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Row 1: Sales events */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* 1. Payment success */}
                <Tooltip title="Thanh toán thành công (kèm chuông xác nhận)">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background: record.notifyOrderPaid && !disabled ? '#ecfdf5' : '#f8fafc',
                      border: `1px solid ${record.notifyOrderPaid && !disabled ? '#a7f3d0' : '#e2e8f0'}`,
                      color: record.notifyOrderPaid && !disabled ? '#065f46' : '#64748b',
                    }}
                  >
                    <CreditCardOutlined
                      style={{ color: record.notifyOrderPaid && !disabled ? '#059669' : '#94a3b8' }}
                    />
                    <span>Thanh toán</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyOrderPaid}
                      onChange={(checked) => handleToggleSingle(record, 'notifyOrderPaid', checked)}
                    />
                  </div>
                </Tooltip>

                {/* 2. QR Order */}
                <Tooltip title="Có món mới từ QR bàn">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background: record.notifyQrOrder && !disabled ? '#eff6ff' : '#f8fafc',
                      border: `1px solid ${record.notifyQrOrder && !disabled ? '#bfdbfe' : '#e2e8f0'}`,
                      color: record.notifyQrOrder && !disabled ? '#1e40af' : '#64748b',
                    }}
                  >
                    <QrcodeOutlined
                      style={{ color: record.notifyQrOrder && !disabled ? '#2563eb' : '#94a3b8' }}
                    />
                    <span>Gọi món QR</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyQrOrder}
                      onChange={(checked) => handleToggleSingle(record, 'notifyQrOrder', checked)}
                    />
                  </div>
                </Tooltip>

                {/* 3. Call Staff */}
                <Tooltip title="Khách gọi phục vụ tại bàn">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background: record.notifyCallStaff && !disabled ? '#fef3c7' : '#f8fafc',
                      border: `1px solid ${record.notifyCallStaff && !disabled ? '#fde68a' : '#e2e8f0'}`,
                      color: record.notifyCallStaff && !disabled ? '#92400e' : '#64748b',
                    }}
                  >
                    <BellOutlined
                      style={{ color: record.notifyCallStaff && !disabled ? '#d97706' : '#94a3b8' }}
                    />
                    <span>Gọi phục vụ</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyCallStaff}
                      onChange={(checked) => handleToggleSingle(record, 'notifyCallStaff', checked)}
                    />
                  </div>
                </Tooltip>
              </div>

              {/* Row 2: Service & Hardware events */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* 4. Checkout Request */}
                <Tooltip title="Khách yêu cầu thanh toán tại bàn">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background: record.notifyCheckoutRequest && !disabled ? '#f3e8ff' : '#f8fafc',
                      border: `1px solid ${record.notifyCheckoutRequest && !disabled ? '#e9d5ff' : '#e2e8f0'}`,
                      color: record.notifyCheckoutRequest && !disabled ? '#6b21a8' : '#64748b',
                    }}
                  >
                    <CreditCardOutlined
                      style={{
                        color: record.notifyCheckoutRequest && !disabled ? '#9333ea' : '#94a3b8',
                      }}
                    />
                    <span>Yêu cầu TT</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyCheckoutRequest}
                      onChange={(checked) =>
                        handleToggleSingle(record, 'notifyCheckoutRequest', checked)
                      }
                    />
                  </div>
                </Tooltip>

                {/* 5. Table Open Request */}
                <Tooltip title="Khách quét mã yêu cầu mở bàn">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background:
                        record.notifyTableOpenRequest && !disabled ? '#e0f2fe' : '#f8fafc',
                      border: `1px solid ${record.notifyTableOpenRequest && !disabled ? '#bae6fd' : '#e2e8f0'}`,
                      color: record.notifyTableOpenRequest && !disabled ? '#0369a1' : '#64748b',
                    }}
                  >
                    <TeamOutlined
                      style={{
                        color: record.notifyTableOpenRequest && !disabled ? '#0284c7' : '#94a3b8',
                      }}
                    />
                    <span>Mở bàn QR</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyTableOpenRequest}
                      onChange={(checked) =>
                        handleToggleSingle(record, 'notifyTableOpenRequest', checked)
                      }
                    />
                  </div>
                </Tooltip>

                {/* 6. Printer Status */}
                <Tooltip title="Trạng thái máy in hóa đơn/bếp">
                  <div
                    className="owner-notif-pill"
                    style={{
                      background: record.notifyPrintStatus && !disabled ? '#ffedd5' : '#f8fafc',
                      border: `1px solid ${record.notifyPrintStatus && !disabled ? '#fed7aa' : '#e2e8f0'}`,
                      color: record.notifyPrintStatus && !disabled ? '#9a3412' : '#64748b',
                    }}
                  >
                    <PrinterOutlined
                      style={{
                        color: record.notifyPrintStatus && !disabled ? '#ea580c' : '#94a3b8',
                      }}
                    />
                    <span>Máy in</span>
                    <Switch
                      size="small"
                      disabled={disabled}
                      checked={record.notifyPrintStatus}
                      onChange={(checked) =>
                        handleToggleSingle(record, 'notifyPrintStatus', checked)
                      }
                    />
                  </div>
                </Tooltip>
              </div>
            </div>
          );
        },
      },
      {
        title: 'Thao tác',
        key: 'action',
        width: 90,
        fixed: 'right',
        align: 'center',
        render: (_, record) => (
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
            aria-label={`Chỉnh sửa cấu hình ${record.displayName}`}
            style={{ color: '#0975f7' }}
          >
            Sửa
          </Button>
        ),
      },
    ],
    [handleToggleSingle],
  );

  return (
    <div className="owner-notif-page owner-settings-page">
      {contextHolder}

      {/* Hero Header */}
      <div
        className="owner-page-heading"
        style={{
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 260, flex: 1 }}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/owner/settings')}
            style={{ paddingLeft: 0, marginBottom: 6, fontSize: 13.5, color: '#64748b' }}
          >
            Quay lại Thiết lập
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Typography.Title level={2} style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
              Thiết lập thông báo
            </Typography.Title>
            <Tag color="purple" style={{ borderRadius: 12, margin: 0, fontWeight: 600 }}>
              PWA Push
            </Tag>
          </div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13.5, display: 'block', marginTop: 4 }}
          >
            Cấu hình thông báo tức thời cho nhân viên theo từng loại sự kiện và kiểm soát theo ca
            làm việc.
          </Typography.Text>
        </div>

        <Space wrap size={10} style={{ alignSelf: 'center' }}>
          <PushNotificationControl csrfToken={csrfToken} showGuide />
          <Button
            icon={<ReloadOutlined />}
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })
            }
            loading={overviewQuery.isFetching}
          >
            Làm mới
          </Button>
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            onClick={() => setTestModalVisible(true)}
            style={{
              background: '#059669',
              borderColor: '#059669',
              boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)',
              fontWeight: 600,
            }}
          >
            Bắn thử nghiệm thông báo
          </Button>
        </Space>
      </div>

      {overviewQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
          <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>
            Đang tải dữ liệu cấu hình thông báo...
          </p>
        </div>
      ) : (
        <>
          {/* KPI Stat Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={8}>
              <Card className="owner-notif-stat-card" styles={{ body: { padding: '16px 20px' } }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: 12,
                        color: '#64748b',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                      }}
                    >
                      DỊCH VỤ WEB PUSH
                    </span>
                    <div style={{ marginTop: 6 }}>
                      {overviewQuery.data?.vapidConfigured ? (
                        <Tag
                          color="success"
                          style={{
                            fontSize: 13,
                            padding: '3px 10px',
                            borderRadius: 16,
                            fontWeight: 600,
                          }}
                        >
                          🟢 Sẵn sàng hoạt động
                        </Tag>
                      ) : (
                        <Tag
                          color="warning"
                          style={{
                            fontSize: 13,
                            padding: '3px 10px',
                            borderRadius: 16,
                            fontWeight: 600,
                          }}
                        >
                          🟡 Chưa cấu hình VAPID
                        </Tag>
                      )}
                    </div>
                    <span
                      style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginTop: 4 }}
                    >
                      Gửi thông báo nền trình duyệt
                    </span>
                  </div>
                  <Avatar
                    size={48}
                    style={{ background: '#f0fdf4', color: '#16a34a', flexShrink: 0 }}
                    icon={<BellOutlined style={{ fontSize: 22 }} />}
                  />
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={8}>
              <Card className="owner-notif-stat-card" styles={{ body: { padding: '16px 20px' } }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ flex: 1, paddingRight: 12 }}>
                    <span
                      style={{
                        fontSize: 12,
                        color: '#64748b',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                      }}
                    >
                      NHÂN VIÊN BẬT NHẬN
                    </span>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                      {overviewQuery.data?.enabledStaffCount ?? 0}
                      <span
                        style={{ fontSize: 13.5, color: '#64748b', fontWeight: 400, marginLeft: 4 }}
                      >
                        / {overviewQuery.data?.totalStaff ?? 0} tài khoản
                      </span>
                    </div>
                    <Progress
                      percent={
                        overviewQuery.data?.totalStaff
                          ? Math.round(
                              ((overviewQuery.data.enabledStaffCount ?? 0) /
                                overviewQuery.data.totalStaff) *
                                100,
                            )
                          : 0
                      }
                      size="small"
                      status="active"
                      strokeColor="#2563eb"
                      style={{ margin: '4px 0 0', maxWidth: 180 }}
                    />
                  </div>
                  <Avatar
                    size={48}
                    style={{ background: '#eff6ff', color: '#2563eb', flexShrink: 0 }}
                    icon={<TeamOutlined style={{ fontSize: 22 }} />}
                  />
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={8}>
              <Card className="owner-notif-stat-card" styles={{ body: { padding: '16px 20px' } }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: 12,
                        color: '#64748b',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                      }}
                    >
                      THIẾT BỊ LIÊN KẾT PWA
                    </span>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                      {overviewQuery.data?.totalSubscriptions ?? 0}
                      <span
                        style={{ fontSize: 13.5, color: '#64748b', fontWeight: 400, marginLeft: 4 }}
                      >
                        thiết bị
                      </span>
                    </div>
                    <span
                      style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginTop: 4 }}
                    >
                      Sẵn sàng nhận chuông & pop-up
                    </span>
                  </div>
                  <Avatar
                    size={48}
                    style={{ background: '#faf5ff', color: '#9333ea', flexShrink: 0 }}
                    icon={<MobileOutlined style={{ fontSize: 22 }} />}
                  />
                </div>
              </Card>
            </Col>
          </Row>

          {/* Guidance Banner */}
          {showGuide ? (
            <Alert
              style={{
                marginBottom: 20,
                borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
              showIcon
              closable
              onClose={() => setShowGuide(false)}
              type="info"
              message={
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  Nguyên tắc gửi thông báo cho nhân viên cửa hàng
                </span>
              }
              description={
                <div style={{ fontSize: 13, lineHeight: '22px', color: '#475569', marginTop: 4 }}>
                  <div>
                    💡 <strong>Chỉ thông báo khi còn phiên đăng nhập:</strong> Khi bật, nhân viên
                    chỉ nhận chuông và thông báo đẩy trên thiết bị nếu đang có phiên làm việc active
                    trên POS. Khi nhân viên hết ca hoặc đăng xuất, hệ thống sẽ tự động ngừng gửi,
                    tránh làm phiền ngoài giờ làm việc.
                  </div>
                  <div style={{ marginTop: 2 }}>
                    💳 <strong>Thông báo thanh toán thành công (PWA):</strong> Báo tức thời kèm
                    chuông âm thanh khi đơn hàng được hoàn tất thanh toán tiền mặt hoặc chuyển
                    khoản.
                  </div>
                </div>
              }
            />
          ) : null}

          {/* Toolbar: Search, Filters & Bulk Actions */}
          <Card
            style={{ borderRadius: 12, borderColor: '#e2e8f0', marginBottom: 20 }}
            styles={{ body: { padding: '14px 18px' } }}
          >
            <Row gutter={[12, 12]} align="middle" justify="space-between">
              <Col xs={24} sm={16} md={12} lg={10}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Input
                    placeholder="Tìm theo tên hoặc tài khoản..."
                    prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    allowClear
                    style={{ minWidth: 200, flex: 1 }}
                  />
                  <Select
                    value={roleFilter}
                    onChange={setRoleFilter}
                    style={{ minWidth: 140 }}
                    options={[
                      { label: 'Tất cả vai trò', value: 'ALL' },
                      ...rolesList.map((r) => ({ label: r, value: r })),
                    ]}
                  />
                </div>
              </Col>

              {/* Desktop Bulk Action Buttons */}
              <Col
                xs={24}
                sm={8}
                md={12}
                lg={14}
                style={{ textAlign: 'right' }}
                className="owner-notif-desktop-view"
              >
                <Space wrap size={8}>
                  <span style={{ fontSize: 12.5, color: '#64748b', marginRight: 2 }}>
                    Thao tác nhanh:
                  </span>
                  <Button
                    size="small"
                    onClick={() => handleBulkToggle('enabled', true)}
                    loading={bulkUpdateMutation.isPending}
                  >
                    Bật tất cả
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleBulkToggle('enabled', false)}
                    loading={bulkUpdateMutation.isPending}
                  >
                    Tắt tất cả
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleBulkToggle('onlyActiveSessions', true)}
                    loading={bulkUpdateMutation.isPending}
                  >
                    Chỉ khi còn phiên
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleBulkToggle('notifyOrderPaid', true)}
                    loading={bulkUpdateMutation.isPending}
                  >
                    Bật báo thanh toán
                  </Button>
                </Space>
              </Col>

              {/* Mobile Bulk Action Dropdown Menu */}
              <Col xs={24} className="owner-notif-mobile-view" style={{ width: '100%' }}>
                <Dropdown
                  menu={{ items: bulkMenuItems }}
                  trigger={['click']}
                  placement="bottomLeft"
                >
                  <Button
                    block
                    icon={<ThunderboltOutlined style={{ color: '#0975f7' }} />}
                    loading={bulkUpdateMutation.isPending}
                  >
                    Thao tác hàng loạt cho nhân viên <DownOutlined style={{ fontSize: 11 }} />
                  </Button>
                </Dropdown>
              </Col>
            </Row>
          </Card>

          {/* ── Desktop View: Responsive Table (>= 769px) ────────────────────────── */}
          <div className="owner-notif-desktop-view">
            <Card
              style={{ borderRadius: 12, borderColor: '#e2e8f0', overflow: 'hidden' }}
              styles={{ body: { padding: 0 } }}
            >
              <Table
                dataSource={filteredItems}
                columns={columns}
                rowKey="userId"
                scroll={{ x: 1080 }}
                pagination={{
                  pageSize: 15,
                  showSizeChanger: false,
                  showTotal: (total) => `Tổng cộng ${total} nhân viên`,
                }}
                locale={{
                  emptyText: (
                    <Empty
                      description="Không tìm thấy nhân viên nào phù hợp"
                      style={{ padding: 48 }}
                    />
                  ),
                }}
              />
            </Card>
          </div>

          {/* ── Mobile View: Touch Cards (< 769px) ───────────────────────────── */}
          <div className="owner-notif-mobile-view">
            {filteredItems.length === 0 ? (
              <Card style={{ borderRadius: 12, borderColor: '#e2e8f0', textAlign: 'center' }}>
                <Empty description="Không tìm thấy nhân viên nào phù hợp" style={{ padding: 32 }} />
              </Card>
            ) : (
              <div>
                {filteredItems.map((record) => {
                  const isOwner = record.roleCode === 'OWNER';
                  const disabled = !record.enabled;
                  const activeEventsCount = [
                    record.notifyOrderPaid,
                    record.notifyQrOrder,
                    record.notifyCallStaff,
                    record.notifyCheckoutRequest,
                    record.notifyTableOpenRequest,
                    record.notifyPrintStatus,
                  ].filter(Boolean).length;

                  return (
                    <div key={record.userId} className="owner-notif-mobile-card">
                      {/* Top Row: User Avatar, Name, Role & Master Toggle */}
                      <div className="owner-notif-mobile-card__header">
                        <div className="owner-notif-mobile-card__user">
                          <Avatar
                            size={44}
                            style={{
                              backgroundColor: isOwner ? '#e11d48' : '#0975f7',
                              fontWeight: 600,
                              fontSize: 16,
                              flexShrink: 0,
                            }}
                          >
                            {record.displayName.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <strong style={{ fontSize: 14.5, color: '#0f172a' }}>
                                {record.displayName}
                              </strong>
                              {isOwner ? (
                                <Tag
                                  color="volcano"
                                  style={{ margin: 0, fontSize: 10.5, lineHeight: '16px' }}
                                >
                                  Chủ quán
                                </Tag>
                              ) : (
                                <Tag
                                  color="blue"
                                  style={{ margin: 0, fontSize: 10.5, lineHeight: '16px' }}
                                >
                                  {record.roleName}
                                </Tag>
                              )}
                            </div>
                            <span style={{ fontSize: 12, color: '#64748b' }}>
                              @{record.username}
                            </span>
                          </div>
                        </div>

                        {/* Master Switch */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              display: 'block',
                              marginBottom: 2,
                              color: record.enabled ? '#16a34a' : '#94a3b8',
                            }}
                          >
                            {record.enabled ? 'ĐANG BẬT' : 'ĐÃ TẮT'}
                          </span>
                          <Switch
                            checked={record.enabled}
                            onChange={(checked) => handleToggleSingle(record, 'enabled', checked)}
                          />
                        </div>
                      </div>

                      {/* Device connection & Active sessions info */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                        {record.hasPushSubscription ? (
                          <Tag
                            color="success"
                            style={{ margin: 0, fontSize: 11.5, borderRadius: 4 }}
                          >
                            🟢 Đã liên kết PWA
                          </Tag>
                        ) : (
                          <Tag
                            color="default"
                            style={{ margin: 0, fontSize: 11.5, borderRadius: 4 }}
                          >
                            ⚪ Chưa liên kết PWA
                          </Tag>
                        )}
                        <Tag
                          color="geekblue"
                          style={{ margin: 0, fontSize: 11.5, borderRadius: 4 }}
                        >
                          📱 {record.activeSessionsCount} phiên active
                        </Tag>
                      </div>

                      {/* Setting: Only active sessions */}
                      <div className="owner-notif-mobile-card__setting-row">
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                            Chỉ thông báo khi còn phiên
                          </span>
                          <div style={{ fontSize: 11.5, color: '#64748b' }}>
                            Dừng gửi khi nhân viên đã hết ca hoặc đăng xuất
                          </div>
                        </div>
                        <Switch
                          checked={record.onlyActiveSessions}
                          disabled={disabled}
                          onChange={(checked) =>
                            handleToggleSingle(record, 'onlyActiveSessions', checked)
                          }
                        />
                      </div>

                      {/* Notification Events Grid */}
                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 8,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                            Sự kiện nhận thông báo ({disabled ? 0 : activeEventsCount}/6)
                          </span>
                        </div>

                        <div className="owner-notif-mobile-card__grid">
                          {/* 1. Payment */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background:
                                record.notifyOrderPaid && !disabled ? '#ecfdf5' : '#f8fafc',
                              border: `1px solid ${record.notifyOrderPaid && !disabled ? '#a7f3d0' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CreditCardOutlined
                                style={{
                                  color:
                                    record.notifyOrderPaid && !disabled ? '#059669' : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Thanh toán</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyOrderPaid}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyOrderPaid', checked)
                              }
                            />
                          </div>

                          {/* 2. QR Order */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background: record.notifyQrOrder && !disabled ? '#eff6ff' : '#f8fafc',
                              border: `1px solid ${record.notifyQrOrder && !disabled ? '#bfdbfe' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <QrcodeOutlined
                                style={{
                                  color: record.notifyQrOrder && !disabled ? '#2563eb' : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Gọi món QR</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyQrOrder}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyQrOrder', checked)
                              }
                            />
                          </div>

                          {/* 3. Call staff */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background:
                                record.notifyCallStaff && !disabled ? '#fef3c7' : '#f8fafc',
                              border: `1px solid ${record.notifyCallStaff && !disabled ? '#fde68a' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <BellOutlined
                                style={{
                                  color:
                                    record.notifyCallStaff && !disabled ? '#d97706' : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Gọi phục vụ</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyCallStaff}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyCallStaff', checked)
                              }
                            />
                          </div>

                          {/* 4. Checkout request */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background:
                                record.notifyCheckoutRequest && !disabled ? '#f3e8ff' : '#f8fafc',
                              border: `1px solid ${record.notifyCheckoutRequest && !disabled ? '#e9d5ff' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CreditCardOutlined
                                style={{
                                  color:
                                    record.notifyCheckoutRequest && !disabled
                                      ? '#9333ea'
                                      : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Yêu cầu TT</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyCheckoutRequest}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyCheckoutRequest', checked)
                              }
                            />
                          </div>

                          {/* 5. Table open */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background:
                                record.notifyTableOpenRequest && !disabled ? '#e0f2fe' : '#f8fafc',
                              border: `1px solid ${record.notifyTableOpenRequest && !disabled ? '#bae6fd' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <TeamOutlined
                                style={{
                                  color:
                                    record.notifyTableOpenRequest && !disabled
                                      ? '#0284c7'
                                      : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Mở bàn QR</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyTableOpenRequest}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyTableOpenRequest', checked)
                              }
                            />
                          </div>

                          {/* 6. Printer */}
                          <div
                            className="owner-notif-pill"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              background:
                                record.notifyPrintStatus && !disabled ? '#ffedd5' : '#f8fafc',
                              border: `1px solid ${record.notifyPrintStatus && !disabled ? '#fed7aa' : '#e2e8f0'}`,
                              padding: '8px 10px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <PrinterOutlined
                                style={{
                                  color:
                                    record.notifyPrintStatus && !disabled ? '#ea580c' : '#94a3b8',
                                }}
                              />
                              <span style={{ fontSize: 12 }}>Máy in</span>
                            </div>
                            <Switch
                              size="small"
                              disabled={disabled}
                              checked={record.notifyPrintStatus}
                              onChange={(checked) =>
                                handleToggleSingle(record, 'notifyPrintStatus', checked)
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <Divider style={{ margin: '14px 0 10px' }} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          icon={<SettingOutlined />}
                          onClick={() => openEditModal(record)}
                        >
                          Cấu hình nâng cao
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit Single Staff Modal */}
      <Modal
        open={Boolean(editUser)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SettingOutlined style={{ color: '#0975f7' }} />
            <span>Thiết lập thông báo: {editUser?.displayName}</span>
          </div>
        }
        okText="Lưu thiết lập"
        cancelText="Hủy"
        confirmLoading={updateSingleMutation.isPending}
        onOk={() => void handleSaveModal()}
        onCancel={() => setEditUser(null)}
        width="100%"
        style={{ maxWidth: 540 }}
        centered
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <div
            style={{
              padding: '12px 16px',
              background: '#f8fafc',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              marginBottom: 16,
            }}
          >
            <Form.Item name="enabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>Nhận thông báo cho tài khoản này</strong>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Tắt mục này sẽ chặn mọi thông báo PWA đến nhân viên này.
                  </div>
                </div>
                <Switch checked={Boolean(Form.useWatch('enabled', editForm))} />
              </div>
            </Form.Item>
          </div>

          <div
            style={{
              padding: '12px 16px',
              background: '#f8fafc',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              marginBottom: 20,
            }}
          >
            <Form.Item
              name="onlyActiveSessions"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>Chỉ thông báo khi còn phiên đăng nhập</strong>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Chỉ gửi khi nhân viên có ca làm việc/phiên mở trên POS. Không làm phiền khi đã
                    đăng xuất.
                  </div>
                </div>
                <Switch checked={Boolean(Form.useWatch('onlyActiveSessions', editForm))} />
              </div>
            </Form.Item>
          </div>

          <Typography.Title level={5} style={{ marginBottom: 12, fontSize: 14 }}>
            Các loại thông báo PWA được phép nhận
          </Typography.Title>

          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CreditCardOutlined style={{ color: '#059669', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Thanh toán thành công</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo kèm chuông khi đơn hoàn tất thanh toán tiền mặt/chuyển khoản
                  </div>
                </div>
              </div>
              <Form.Item name="notifyOrderPaid" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Divider style={{ margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <QrcodeOutlined style={{ color: '#2563eb', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Gọi món QR mới</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo kèm chuông khi khách gửi món mới từ mã QR bàn
                  </div>
                </div>
              </div>
              <Form.Item name="notifyQrOrder" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Divider style={{ margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BellOutlined style={{ color: '#d97706', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Gọi phục vụ tại bàn</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo kèm chuông khi khách bấm gọi nhân viên hỗ trợ
                  </div>
                </div>
              </div>
              <Form.Item name="notifyCallStaff" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Divider style={{ margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CreditCardOutlined style={{ color: '#9333ea', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Yêu cầu thanh toán</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo khi khách bấm yêu cầu thanh toán từ bàn
                  </div>
                </div>
              </div>
              <Form.Item name="notifyCheckoutRequest" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Divider style={{ margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TeamOutlined style={{ color: '#0284c7', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Yêu cầu mở bàn</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo khi khách quét mã yêu cầu mở bàn mới
                  </div>
                </div>
              </div>
              <Form.Item name="notifyTableOpenRequest" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Divider style={{ margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PrinterOutlined style={{ color: '#ea580c', fontSize: 18 }} />
                <div>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>Trạng thái máy in</span>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Báo khi máy in hóa đơn/bếp hoàn tất hoặc xảy ra lỗi
                  </div>
                </div>
              </div>
              <Form.Item name="notifyPrintStatus" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
          </Space>
        </Form>
      </Modal>

      {/* Test Notification Modal */}
      <Modal
        open={testModalVisible}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ExperimentOutlined style={{ color: '#059669' }} />
            <span>Bắn thử nghiệm thông báo PWA</span>
          </div>
        }
        okText="Bắn thử ngay"
        cancelText="Đóng"
        confirmLoading={sendTestNotificationMutation.isPending}
        onOk={() => {
          const testTag = `test-notification:${Date.now()}`;
          // Direct user click gesture unlocks audio and plays instantly without browser autoplay blocks
          playPushNotificationSound({
            kind: testKind,
            tag: testTag,
          });

          sendTestNotificationMutation.mutate({
            kind: testKind,
            tag: testTag,
            ...(testTargetUserId ? { userId: testTargetUserId } : {}),
          });
        }}
        onCancel={() => setTestModalVisible(false)}
        width="100%"
        style={{ maxWidth: 520 }}
        centered
      >
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Bắn thử 1 thông báo đẩy thực tế qua giao thức WebPush để kiểm tra âm thanh, hiển thị
            pop-up và rung trên thiết bị.
          </p>

          <Form layout="vertical">
            <Form.Item label="Loại thông báo thử nghiệm" required>
              <div style={{ display: 'flex', gap: 8 }}>
                <Select
                  style={{ flex: 1 }}
                  value={testKind}
                  onChange={(val) => setTestKind(val as TestNotificationKind)}
                  options={[
                    { label: '💳 Thanh toán thành công (kèm chuông)', value: 'ORDER_PAID' },
                    { label: '🍽️ Gọi món QR mới (kèm chuông)', value: 'QR_ORDER' },
                    { label: '🔔 Khách gọi phục vụ (kèm chuông)', value: 'CALL_STAFF' },
                    {
                      label: '🧾 Khách yêu cầu thanh toán (kèm chuông)',
                      value: 'CHECKOUT_REQUEST',
                    },
                    { label: '🪑 Khách yêu cầu mở bàn (kèm chuông)', value: 'TABLE_OPEN_REQUEST' },
                    { label: '🖨️ Máy in hoàn tất (chuông chime)', value: 'PRINT_COMPLETED' },
                  ]}
                />
                <Button
                  icon={<SoundOutlined />}
                  onClick={() => {
                    playPushNotificationSound({
                      kind: testKind,
                      tag: `preview-${Date.now()}`,
                    });
                  }}
                >
                  Nghe thử
                </Button>
              </div>
            </Form.Item>

            <Form.Item label="Người nhận thử nghiệm">
              <Select
                value={testTargetUserId}
                onChange={setTestTargetUserId}
                allowClear
                placeholder="Tất cả thiết bị đủ điều kiện trong cửa hàng"
                options={items.map((item) => ({
                  label: `${item.displayName} (@${item.username})`,
                  value: item.userId,
                }))}
              />
            </Form.Item>
          </Form>

          <Alert
            type="info"
            showIcon
            message="Lưu ý khi kiểm tra âm thanh thông báo"
            description={
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                <li>
                  Trình duyệt yêu cầu có ít nhất 1 thao tác click trên trang để cấp quyền phát âm
                  thanh tự động (Autoplay Policy).
                </li>
                <li>
                  Vui lòng kiểm tra loa máy tính/điện thoại không ở chế độ Im lặng (Mute) và cho
                  phép âm thanh trong cài đặt trình duyệt.
                </li>
                <li>
                  Nếu vừa nâng cấp phiên bản Service Worker, vui lòng <b>F5 (tải lại trang)</b> để
                  nạp worker mới nhất.
                </li>
              </ul>
            }
            style={{ fontSize: 12 }}
          />
        </div>
      </Modal>
    </div>
  );
}
