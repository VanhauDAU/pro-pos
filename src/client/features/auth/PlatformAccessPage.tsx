import { MailOutlined } from '@ant-design/icons';
import { Alert, Button, Typography } from 'antd';
import { useState } from 'react';

import type { AccessStartResponse } from '@contracts/auth';

import { ApiError, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

export function PlatformAccessPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
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

  return (
    <AuthLayout>
      <div className="login-heading">
        <Typography.Title level={2}>Quản trị nền tảng</Typography.Title>
        <Typography.Text type="secondary">Chỉ dành cho SUPER_ADMIN Pro POS</Typography.Text>
      </div>
      {error ? <Alert className="login-error" type="error" showIcon title={error} /> : null}
      <div className="owner-otp-login">
        <Alert
          type="info"
          showIcon
          title="Xác thực email bằng Cloudflare Access"
          description="Mã OTP chỉ được gửi tới email SUPER_ADMIN đã có trong Access policy và D1."
        />
        <Button
          type="primary"
          size="large"
          block
          icon={<MailOutlined />}
          loading={submitting}
          onClick={login}
        >
          Nhận mã OTP qua email
        </Button>
      </div>
    </AuthLayout>
  );
}
