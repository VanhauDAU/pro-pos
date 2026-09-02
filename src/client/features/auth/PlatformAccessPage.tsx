import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { AccessStartResponse, LoginResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

function accessErrorMessage(code: string | null) {
  if (!code) return null;
  if (code === 'ACCESS_IDENTITY_DENIED') return 'Email chưa được cấp quyền SUPER_ADMIN.';
  if (code === 'ACCESS_REQUEST_EXPIRED') {
    return 'Yêu cầu đăng nhập đã hết hạn. Vui lòng thử lại.';
  }
  return 'Không thể xác thực email qua Cloudflare Access. Vui lòng thử lại.';
}

export function PlatformAccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [localForm] = Form.useForm<{ username: string; password: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    accessErrorMessage(searchParams.get('authError')),
  );

  const versionQuery = useQuery({
    queryKey: ['system-version'],
    queryFn: () => apiRequest<{ environment: string }>('/api/version'),
  });

  const isLocal = versionQuery.data?.environment === 'local';

  const loginCloudflareAccess = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await jsonRequest<AccessStartResponse>('/api/v1/auth/access/start', {
        purpose: 'PLATFORM_LOGIN',
      });
      window.location.assign(response.loginUrl);
    } catch (loginError) {
      setError(
        loginError instanceof ApiError
          ? loginError.message
          : 'Không thể đăng nhập cổng SUPER_ADMIN.',
      );
      setSubmitting(false);
    }
  };

  const loginLocalPassword = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<LoginResponse>('/api/v1/auth/platform/login', {
        username: values.username.trim(),
        password: values.password,
      });
      navigate('/platform', { replace: true });
    } catch (loginError) {
      setError(
        loginError instanceof ApiError
          ? loginError.message
          : 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản và mật khẩu.',
      );
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="login-heading">
        <Typography.Title level={2}>Quản trị nền tảng</Typography.Title>
        <Typography.Text type="secondary">Chỉ dành cho SUPER_ADMIN Pro POS</Typography.Text>
      </div>

      {error ? (
        <Alert
          className="login-error"
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 20 }}
        />
      ) : null}

      {isLocal ? (
        <div className="platform-local-login">
          <Alert
            type="info"
            showIcon
            message="Môi trường phát triển Local — đăng nhập bằng tài khoản SUPER_ADMIN local."
            style={{ marginBottom: 20 }}
          />
          <Form
            form={localForm}
            layout="vertical"
            requiredMark={false}
            onFinish={loginLocalPassword}
            initialValues={{ username: 'admin' }}
          >
            <Form.Item
              label="Tên đăng nhập hoặc email"
              name="username"
              rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập hoặc email.' }]}
            >
              <Input
                size="large"
                prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                placeholder="admin hoặc email"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              label="Mật khẩu"
              name="password"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu.' }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Nhập mật khẩu SUPER_ADMIN"
                autoComplete="current-password"
              />
            </Form.Item>
            <Button
              type="primary"
              size="large"
              block
              htmlType="submit"
              loading={submitting}
              style={{ marginTop: 8 }}
            >
              Đăng nhập SUPER_ADMIN
            </Button>
          </Form>
        </div>
      ) : (
        <div className="owner-otp-login">
          <Alert
            type="info"
            showIcon
            title="Xác thực email bằng Cloudflare Access"
            description="Mã OTP chỉ được gửi tới email SUPER_ADMIN đã có trong Cloudflare Access policy và cơ sở dữ liệu."
            style={{ marginBottom: 20 }}
          />
          <Button
            type="primary"
            size="large"
            block
            icon={<MailOutlined />}
            loading={submitting}
            onClick={loginCloudflareAccess}
            className="owner-login-btn"
          >
            Nhận mã OTP qua email
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
import 'antd/dist/reset.css';
import '@client/styles/base.css';
