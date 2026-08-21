import {
  LockOutlined,
  LogoutOutlined,
  PlusOutlined,
  ShopOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Modal,
  Popconfirm,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type { CreatePlatformStoreResponse, PlatformStoreSummary } from '@contracts/platform';

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

export function SuperAdminPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CreateStoreValues>();
  const [createOpen, setCreateOpen] = useState(false);
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

  const changeStatus = async (store: PlatformStoreSummary) => {
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
      await queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
    } catch (statusError) {
      setError(readableError(statusError));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRealtime = async (store: PlatformStoreSummary) => {
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
      await queryClient.invalidateQueries({ queryKey: ['platform-stores'] });
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
              Tạo cửa hàng và quản lý tài khoản Chủ cửa hàng.
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

        <Card
          className="platform-table-card"
          title="Danh sách cửa hàng"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Tạo cửa hàng
            </Button>
          }
        >
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
                render: (val: string) => <strong>{val}</strong>,
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
                title: 'Thao tác',
                key: 'actions',
                render: (_, store: PlatformStoreSummary) => (
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
                ),
              },
            ]}
          />
        </Card>
      </main>

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
