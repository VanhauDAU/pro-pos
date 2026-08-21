import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DesktopOutlined,
  EditOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UnlockOutlined,
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
  Drawer,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  CreatePlatformStoreResponse,
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

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
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

export function SuperAdminPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CreateStoreValues>();
  const [editMemberForm] = Form.useForm<EditMemberValues>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordValues>();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'LOCKED'>('ALL');

  // Member editing state
  const [editingMember, setEditingMember] = useState<StoreMember | null>(null);
  const [resetPasswordMember, setResetPasswordMember] = useState<StoreMember | null>(null);

  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const stores = useQuery({
    queryKey: ['platform-stores'],
    queryFn: () => apiRequest<PlatformStoreSummary[]>('/api/v1/platform/stores'),
    enabled: context.data?.actor?.kind === 'SUPER_ADMIN',
  });

  const storeDetail = useQuery({
    queryKey: ['platform-store-detail', selectedStoreId],
    queryFn: () => apiRequest<PlatformStoreDetail>(`/api/v1/platform/stores/${selectedStoreId}`),
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
          <div>
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
        <Button icon={<LogoutOutlined />} loading={submitting} onClick={logout}>
          Đăng xuất
        </Button>
      </header>

      <main className="platform-content">
        <div className="platform-title-row">
          <div>
            <Typography.Title level={2} style={{ margin: 0, fontWeight: 800 }}>
              Hệ thống cửa hàng
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              Quản lý danh sách cửa hàng, phân quyền Chủ quán và theo dõi thiết bị POS hoạt động.
            </Typography.Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            style={{ borderRadius: 10, fontWeight: 600, height: 44 }}
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Tạo cửa hàng mới
          </Button>
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

        {/* Hero Statistic Cards */}
        <div className="platform-stats">
          <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 24px' } }}>
            <div className="stat-card-inner">
              <div className="stat-icon-wrapper stat-icon-wrapper--blue">
                <ShopOutlined />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>
                  Tổng số cửa hàng
                </Typography.Text>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {stats.total}
                </div>
              </div>
            </div>
          </Card>

          <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 24px' } }}>
            <div className="stat-card-inner">
              <div className="stat-icon-wrapper stat-icon-wrapper--green">
                <CheckCircleOutlined />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>
                  Đang hoạt động
                </Typography.Text>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981', lineHeight: 1.2 }}>
                  {stats.active}
                </div>
              </div>
            </div>
          </Card>

          <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 24px' } }}>
            <div className="stat-card-inner">
              <div className="stat-icon-wrapper stat-icon-wrapper--red">
                <LockOutlined />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>
                  Đang bị khóa
                </Typography.Text>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444', lineHeight: 1.2 }}>
                  {stats.locked}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Stores Table Card */}
        <Card className="platform-table-card" styles={{ body: { padding: '20px 24px' } }}>
          <div className="platform-toolbar">
            <div className="platform-toolbar-left">
              <Input
                placeholder="Tìm theo tên cửa hàng hoặc ID..."
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: 280, borderRadius: 8 }}
                allowClear
              />
              <Radio.Group
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                buttonStyle="solid"
                style={{ borderRadius: 8 }}
              >
                <Radio.Button value="ALL">Tất cả ({stats.total})</Radio.Button>
                <Radio.Button value="ACTIVE">Hoạt động ({stats.active})</Radio.Button>
                <Radio.Button value="LOCKED">Đã khóa ({stats.locked})</Radio.Button>
              </Radio.Group>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-stores'] })}
            >
              Làm mới
            </Button>
          </div>

          <Table
            rowKey="id"
            loading={stores.isLoading}
            dataSource={filteredStores}
            pagination={{ pageSize: 10, showSizeChanger: false }}
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
                      onClick={() => setSelectedStoreId(store.id)}
                      style={{ borderRadius: 6 }}
                    >
                      Chi tiết
                    </Button>
                    <Popconfirm
                      title={
                        store.status === 'ACTIVE' ? 'Khóa cửa hàng này?' : 'Mở lại cửa hàng này?'
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
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </main>

      {/* Drawer Xem & Quản lý Chi Tiết Cửa Hàng */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563eb',
                fontSize: 18,
              }}
            >
              <ShopOutlined />
            </div>
            <div>
              <Typography.Text strong style={{ fontSize: 17 }}>
                {detail?.store.name || 'Chi tiết cửa hàng'}
              </Typography.Text>
              {detail ? (
                <Tag
                  color={detail.store.status === 'ACTIVE' ? 'success' : 'error'}
                  style={{ marginLeft: 8, borderRadius: 6 }}
                >
                  {detail.store.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
                </Tag>
              ) : null}
            </div>
          </div>
        }
        placement="right"
        width={820}
        onClose={() => setSelectedStoreId(null)}
        open={Boolean(selectedStoreId)}
        extra={
          detail ? (
            <Space>
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
                {detail.store.status === 'ACTIVE' ? 'Khóa cửa hàng' : 'Mở lại'}
              </Button>
            </Space>
          ) : null
        }
      >
        {storeDetail.isLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#64748b', fontWeight: 500 }}>
              Đang tải dữ liệu cửa hàng...
            </div>
          </div>
        ) : detail ? (
          <Tabs
            defaultActiveKey="overview"
            items={[
              {
                key: 'overview',
                label: (
                  <span>
                    <InfoCircleOutlined /> Tổng quan & Cài đặt
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
                            text={detail.store.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}
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
                            <Typography.Text strong>{detail.store.settings.phone}</Typography.Text>
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

                    <Card size="small" title="Thanh toán VietQR & Vận hành" className="detail-card">
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
                            Dùng Cloudflare Durable Objects để đồng bộ tức thì giữa thu ngân và nhân
                            viên quầy.
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
                    <TeamOutlined /> Tài khoản & Nhân sự ({detail.members.length})
                  </span>
                ),
                children: (
                  <div>
                    <div style={{ marginBottom: 12, color: '#64748b', fontSize: 13 }}>
                      Danh sách tài khoản Chủ quán và Nhân sự. SuperAdmin có thể chỉnh sửa thông tin
                      hoặc đặt lại mật khẩu trực tiếp.
                    </div>
                    <Table
                      rowKey="id"
                      size="middle"
                      dataSource={detail.members}
                      pagination={false}
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                          title: 'Thao tác',
                          key: 'actions',
                          align: 'right',
                          render: (_, m) => (
                            <Space size="small">
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
                  </div>
                ),
              },
              {
                key: 'devices',
                label: (
                  <span>
                    <DesktopOutlined /> Thiết bị POS ({detail.devices.length})
                  </span>
                ),
                children:
                  detail.devices.length === 0 ? (
                    <Empty description="Chưa có thiết bị POS nào được kích hoạt." />
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={detail.devices}
                      pagination={false}
                      columns={[
                        {
                          title: 'Tên máy POS',
                          key: 'name',
                          render: (_, d) => (
                            <div>
                              <DesktopOutlined style={{ marginRight: 6, color: '#2563eb' }} />
                              <Typography.Text strong>{d.name}</Typography.Text>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>ID: {d.id}</div>
                            </div>
                          ),
                        },
                        {
                          title: 'Trạng thái',
                          dataIndex: 'status',
                          key: 'status',
                          render: (s: 'ACTIVE' | 'REVOKED') => (
                            <Tag color={s === 'ACTIVE' ? 'success' : 'error'}>
                              {s === 'ACTIVE' ? 'Hoạt động' : 'Đã thu hồi'}
                            </Tag>
                          ),
                        },
                        {
                          title: 'Người kích hoạt',
                          dataIndex: 'activatedByName',
                          key: 'activatedByName',
                        },
                        {
                          title: 'Kích hoạt lúc',
                          dataIndex: 'activatedAt',
                          key: 'activatedAt',
                          render: (val: number) => formatDateTime(val),
                        },
                        {
                          title: 'Hoạt động gần nhất',
                          dataIndex: 'lastSeenAt',
                          key: 'lastSeenAt',
                          render: (val: number | null) => formatDateTime(val),
                        },
                      ]}
                    />
                  ),
              },
              {
                key: 'sessions',
                label: (
                  <span>
                    <ClockCircleOutlined /> Phiên đăng nhập ({detail.sessions.length})
                  </span>
                ),
                children:
                  detail.sessions.length === 0 ? (
                    <Empty description="Hiện không có phiên đăng nhập nào đang hoạt động." />
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={detail.sessions}
                      pagination={false}
                      columns={[
                        {
                          title: 'Người dùng',
                          key: 'user',
                          render: (_, s) => (
                            <div>
                              <Typography.Text strong>{s.userName}</Typography.Text>
                              <div style={{ fontSize: 12, color: '#64748b' }}>
                                @{s.userUsername}{' '}
                                <Tag color={s.sessionKind === 'OWNER' ? 'gold' : 'blue'}>
                                  {s.sessionKind}
                                </Tag>
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Thiết bị',
                          dataIndex: 'deviceName',
                          key: 'deviceName',
                          render: (name: string | null) => name || 'Trình duyệt trực tiếp',
                        },
                        {
                          title: 'Đăng nhập lúc',
                          dataIndex: 'createdAt',
                          key: 'createdAt',
                          render: (val: number) => formatDateTime(val),
                        },
                        {
                          title: 'Hoạt động gần nhất',
                          dataIndex: 'lastSeenAt',
                          key: 'lastSeenAt',
                          render: (val: number) => formatDateTime(val),
                        },
                        {
                          title: 'Hết hạn',
                          dataIndex: 'expiresAt',
                          key: 'expiresAt',
                          render: (val: number) => formatDateTime(val),
                        },
                      ]}
                    />
                  ),
              },
              {
                key: 'stats',
                label: (
                  <span>
                    <AppstoreOutlined /> Dữ liệu & Thống kê
                  </span>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Tổng doanh thu tích lũy"
                            value={formatVnd(detail.stats.totalRevenue)}
                            prefix={<CreditCardOutlined style={{ color: '#10b981' }} />}
                            valueStyle={{ color: '#10b981', fontWeight: 'bold' }}
                          />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Tổng số hóa đơn xuất"
                            value={detail.stats.totalInvoices}
                            prefix={<ShoppingOutlined style={{ color: '#2563eb' }} />}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={8}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Tổng số bàn"
                            value={detail.stats.totalTables}
                            suffix={`(${detail.stats.totalAreas} khu vực)`}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={8}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Bàn đang mở khách"
                            value={detail.stats.openTables}
                            valueStyle={{ color: '#eab308' }}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={8}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Số mặt hàng (Menu)"
                            value={detail.stats.totalProducts}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={12}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Tổng số đơn hàng"
                            value={detail.stats.totalOrders}
                            suffix={`(${detail.stats.paidOrders} đã thanh toán)`}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={12}>
                        <Card size="small" className="detail-stat-card">
                          <Statistic
                            title="Đơn hàng đang phục vụ"
                            value={detail.stats.openOrders}
                            valueStyle={{ color: '#3b82f6' }}
                          />
                        </Card>
                      </Col>
                    </Row>
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Drawer>

      {/* Modal Chỉnh Sửa Thông Tin Tài Khoản */}
      <Modal
        title={`Chỉnh sửa tài khoản: ${editingMember?.displayName || ''}`}
        open={Boolean(editingMember)}
        okText="Lưu thay đổi"
        cancelText="Hủy"
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
