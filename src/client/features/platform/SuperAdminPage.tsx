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
import { Navigate, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type { CreatePlatformStoreResponse, PlatformStoreSummary } from '@contracts/platform';

import logo from '@client/assets/logo-black.svg';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface CreateStoreValues {
  name: string;
  ownerDisplayName: string;
  ownerEmail: string;
}

function readableError(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

export function SuperAdminPage() {
  const navigate = useNavigate();
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

  const logout = async () => {
    setSubmitting(true);
    try {
      const response = await apiRequest<{ loggedOut: boolean; accessLogoutUrl?: string | null }>(
        '/api/v1/auth/logout',
        {
          method: 'POST',
          headers: csrfHeaders(),
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      if (response.accessLogoutUrl) {
        window.location.assign(response.accessLogoutUrl);
      } else {
        navigate('/platform/login', { replace: true });
      }
    } catch (logoutError) {
      setError(readableError(logoutError));
      setSubmitting(false);
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
              Tạo cửa hàng, cấp Owner bằng email và quản lý trạng thái hoạt động.
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

        {error ? <Alert className="platform-error" type="error" showIcon title={error} /> : null}
        {stores.isError && !error ? (
          <Alert
            className="platform-error"
            type="error"
            showIcon
            title="Không thể tải danh sách cửa hàng."
          />
        ) : null}

        <section className="platform-stats" aria-label="Thống kê cửa hàng">
          <Card>
            <Statistic title="Tổng cửa hàng" value={stats.total} prefix={<ShopOutlined />} />
          </Card>
          <Card>
            <Statistic
              title="Đang hoạt động"
              value={stats.active}
              styles={{ content: { color: '#16a34a' } }}
            />
          </Card>
          <Card>
            <Statistic
              title="Đang khóa"
              value={stats.locked}
              styles={{ content: { color: '#dc2626' } }}
            />
          </Card>
        </section>

        <Card className="platform-table-card" title="Danh sách cửa hàng">
          <Table<PlatformStoreSummary>
            rowKey="id"
            loading={stores.isLoading}
            dataSource={stores.data ?? []}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: 760 }}
            locale={{ emptyText: 'Chưa có cửa hàng. Hãy tạo cửa hàng đầu tiên.' }}
            columns={[
              {
                title: 'Cửa hàng',
                dataIndex: 'name',
                key: 'name',
                render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                key: 'status',
                width: 150,
                render: (status: PlatformStoreSummary['status']) =>
                  status === 'ACTIVE' ? (
                    <Tag color="success">Đang hoạt động</Tag>
                  ) : (
                    <Tag color="error">Đang khóa</Tag>
                  ),
              },
              {
                title: 'Múi giờ',
                dataIndex: 'timezone',
                key: 'timezone',
                width: 180,
              },
              {
                title: 'Ngày tạo',
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 180,
                render: (value: number) =>
                  new Intl.DateTimeFormat('vi-VN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(value)),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 180,
                fixed: 'right',
                render: (_value, store) => (
                  <Popconfirm
                    title={store.status === 'ACTIVE' ? 'Khóa cửa hàng?' : 'Mở lại cửa hàng?'}
                    description={
                      store.status === 'ACTIVE'
                        ? 'Employee/POS sẽ bị chặn cho đến khi mở lại.'
                        : 'Thiết bị ACTIVE có thể tiếp tục sử dụng.'
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
        destroyOnHidden
      >
        <Alert
          className="platform-modal-note"
          type="info"
          showIcon
          title="Owner đăng nhập bằng email OTP"
          description="Sau khi tạo, hãy thêm đúng email Owner vào Cloudflare Access exact-email policy."
        />
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
        </Form>
      </Modal>
    </Layout>
  );
}
