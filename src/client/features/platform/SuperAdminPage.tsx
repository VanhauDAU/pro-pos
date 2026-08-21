import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DesktopOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  LockOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
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
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
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

export function SuperAdminPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CreateStoreValues>();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (capabilityError) {
      setError(readableError(capabilityError));
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
            <Typography.Text strong>Quản trị nền tảng</Typography.Text>
            <Typography.Text type="secondary">{context.data.actor.displayName}</Typography.Text>
          </div>
        </div>
        <Button icon={<LogoutOutlined />} loading={submitting} onClick={logout}>
          Đăng xuất
        </Button>
      </header>

      <main className="platform-content">
        <div className="platform-title-row">
          <div>
            <Typography.Title level={2}>Cửa hàng Pro POS</Typography.Title>
            <Typography.Text type="secondary">
              Tạo cửa hàng, quản lý tài khoản Chủ cửa hàng và theo dõi hoạt động hệ thống.
            </Typography.Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Tạo cửa hàng
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
          />
        ) : null}

        <div className="platform-stats-grid">
          <Card className="platform-stat-card">
            <Statistic title="Tổng số cửa hàng" value={stats.total} prefix={<ShopOutlined />} />
          </Card>
          <Card className="platform-stat-card">
            <Statistic
              title="Đang hoạt động"
              value={stats.active}
              valueStyle={{ color: '#10b981' }}
            />
          </Card>
          <Card className="platform-stat-card">
            <Statistic
              title="Đang bị khóa"
              value={stats.locked}
              valueStyle={{ color: '#ef4444' }}
            />
          </Card>
        </div>

        <Card className="platform-table-card" title="Danh sách cửa hàng">
          <Table
            rowKey="id"
            loading={stores.isLoading}
            dataSource={stores.data ?? []}
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
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>ID: {record.id}</div>
                  </div>
                ),
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                key: 'status',
                render: (status: 'ACTIVE' | 'LOCKED') => (
                  <Tag color={status === 'ACTIVE' ? 'success' : 'error'}>
                    {status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                  </Tag>
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
                  >
                    {enabled ? 'Bật' : 'Tắt'}
                  </Button>
                ),
              },
              {
                title: 'Ngày tạo',
                dataIndex: 'createdAt',
                key: 'createdAt',
                render: (val: number) => formatDateTime(val),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                render: (_, store: PlatformStoreSummary) => (
                  <Space size="middle">
                    <Button
                      type="primary"
                      ghost
                      icon={<EyeOutlined />}
                      onClick={() => setSelectedStoreId(store.id)}
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

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShopOutlined style={{ fontSize: 20, color: '#2563eb' }} />
            <div>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {detail?.store.name || 'Chi tiết cửa hàng'}
              </Typography.Text>
              {detail ? (
                <Tag
                  color={detail.store.status === 'ACTIVE' ? 'success' : 'error'}
                  style={{ marginLeft: 8 }}
                >
                  {detail.store.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                </Tag>
              ) : null}
            </div>
          </div>
        }
        placement="right"
        width={780}
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
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: '#64748b' }}>Đang tải dữ liệu chi tiết...</div>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <Card size="small" title="Thông tin cơ bản" className="detail-card">
                      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
                        <Descriptions.Item label="Mã Cửa Hàng (ID)">
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
                          {detail.store.settings?.phone || (
                            <span style={{ color: '#94a3b8' }}>Chưa cập nhật</span>
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Đơn vị tiền tệ">
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
                        <Descriptions.Item label="Giờ chốt ngày">
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
                          <strong>Realtime POS (Đồng bộ bàn & đơn hàng theo thời gian thực)</strong>
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
                    <TeamOutlined /> Tài khoản ({detail.members.length})
                  </span>
                ),
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={detail.members}
                    pagination={false}
                    columns={[
                      {
                        title: 'Tài khoản',
                        key: 'user',
                        render: (_, m) => (
                          <div>
                            <Typography.Text strong>{m.displayName}</Typography.Text>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              @{m.username}{' '}
                              {m.roleCode === 'OWNER' ? (
                                <Tag color="gold">Chủ cửa hàng</Tag>
                              ) : (
                                <Tag color="blue">{m.roleName}</Tag>
                              )}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: 'Email / SĐT',
                        key: 'contact',
                        render: (_, m) => (
                          <div style={{ fontSize: 13 }}>
                            <div>{m.email || '—'}</div>
                            <div style={{ color: '#64748b' }}>{m.phone || '—'}</div>
                          </div>
                        ),
                      },
                      {
                        title: 'Trạng thái',
                        key: 'status',
                        render: (_, m) => (
                          <Tag color={m.userStatus === 'ACTIVE' ? 'success' : 'default'}>
                            {m.userStatus === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                          </Tag>
                        ),
                      },
                      {
                        title: 'Ngày tạo',
                        dataIndex: 'createdAt',
                        key: 'createdAt',
                        render: (val: number) => formatDateTime(val),
                      },
                    ]}
                  />
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
