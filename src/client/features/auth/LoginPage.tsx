import {
  DesktopOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Spin, Tabs, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import type { AuthContextResponse, LoginResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

interface OwnerFormValues {
  username: string;
  password: string;
}

interface EmployeeFormValues {
  username: string;
  pin: string;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Không thể đăng nhập. Vui lòng thử lại.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') === 'owner' ? 'owner' : 'employee',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const deviceIsActive = context.data?.device?.status === 'ACTIVE';

  const switchTab = (key: string) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
    setError(null);
  };

  const ownerLogin = async (values: OwnerFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<LoginResponse>('/api/v1/auth/owner/login', values);
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/owner', { replace: true });
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  const employeeLogin = async (values: EmployeeFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<LoginResponse>('/api/v1/auth/employee/login', values);
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/pos', { replace: true });
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  const items = useMemo(
    () => [
      {
        key: 'owner',
        label: 'Chủ cửa hàng',
        children: (
          <Form<OwnerFormValues> layout="vertical" requiredMark={false} onFinish={ownerLogin}>
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
            >
              <Input
                size="large"
                autoComplete="username"
                prefix={<UserOutlined />}
                placeholder="Tên đăng nhập"
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu.' }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                prefix={<LockOutlined />}
                placeholder="Mật khẩu"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
              Đăng nhập
            </Button>
            <Typography.Paragraph className="login-help" type="secondary">
              Owner có thể đăng nhập trên điện thoại hoặc máy tính mà không cần thiết lập máy POS.
            </Typography.Paragraph>
          </Form>
        ),
      },
      {
        key: 'employee',
        label: 'Nhân viên',
        children: deviceIsActive ? (
          <Form<EmployeeFormValues> layout="vertical" requiredMark={false} onFinish={employeeLogin}>
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
            >
              <Input
                size="large"
                autoComplete="username"
                prefix={<UserOutlined />}
                placeholder="Tên đăng nhập"
              />
            </Form.Item>
            <Form.Item
              name="pin"
              normalize={(value: string) => value.replaceAll(/\D/gu, '').slice(0, 4)}
              rules={[
                { required: true, message: 'Vui lòng nhập mã PIN.' },
                { pattern: /^\d{4}$/u, message: 'Mã PIN phải gồm đúng 4 số.' },
              ]}
            >
              <Input.Password
                size="large"
                autoComplete="off"
                inputMode="numeric"
                maxLength={4}
                prefix={<SafetyCertificateOutlined />}
                placeholder="Mã PIN 4 số"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
              Đăng nhập
            </Button>
            <div className="device-caption">
              <DesktopOutlined />
              <span>{context.data?.device?.name}</span>
            </div>
          </Form>
        ) : (
          <div className="activation-required">
            <Alert
              type={context.data?.device?.status === 'REVOKED' ? 'warning' : 'info'}
              showIcon
              title={
                context.data?.device?.status === 'REVOKED'
                  ? 'Thiết bị POS đã bị thu hồi'
                  : 'Máy này chưa được thiết lập làm POS'
              }
              description="Owner cần xác nhận máy tại quầy trước khi nhân viên có thể đăng nhập bằng PIN."
            />
            <Button
              type="primary"
              size="large"
              block
              icon={<DesktopOutlined />}
              onClick={() => navigate('/device-activation')}
            >
              Thiết lập máy POS
            </Button>
          </div>
        ),
      },
    ],
    [context.data?.device?.name, context.data?.device?.status, deviceIsActive, submitting],
  );

  if (context.isLoading) {
    return <Spin fullscreen description="Đang kiểm tra phiên đăng nhập và thiết bị" />;
  }
  if (context.isError || !context.data) {
    return (
      <AuthLayout>
        <Alert
          type="error"
          showIcon
          title="Không thể kết nối Pro POS"
          description="Vui lòng kiểm tra kết nối mạng và thử lại."
        />
      </AuthLayout>
    );
  }
  if (context.data.actor?.kind === 'OWNER') return <Navigate to="/owner" replace />;
  if (context.data.actor?.kind === 'EMPLOYEE' && deviceIsActive) {
    return <Navigate to="/pos" replace />;
  }

  return (
    <AuthLayout>
      <div className="login-heading">
        <Typography.Title level={2}>Đăng nhập Pro POS</Typography.Title>
        <Typography.Text type="secondary">Chọn đúng loại tài khoản để tiếp tục</Typography.Text>
      </div>
      {error ? <Alert className="login-error" type="error" showIcon title={error} /> : null}
      <Tabs
        className="login-tabs"
        activeKey={activeTab}
        centered
        items={items}
        onChange={switchTab}
      />
    </AuthLayout>
  );
}
