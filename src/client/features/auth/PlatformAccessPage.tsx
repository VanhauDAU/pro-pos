import { MailOutlined, SwapOutlined } from '@ant-design/icons';
import { Alert, Button, Typography } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import type { AccessStartResponse } from '@contracts/auth';

import { ApiError, jsonRequest } from '@client/lib/api';

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
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    accessErrorMessage(searchParams.get('authError')),
  );

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
      {searchParams.get('loggedOut') === '1' ? (
        <Alert
          type="success"
          showIcon
          message="Đã đăng xuất Cloudflare Access"
          description="Phiên Cloudflare Access đã được xóa. Bạn có thể nhập email mới khi nhận mã OTP."
          style={{ marginBottom: 14 }}
        />
      ) : null}
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
        <Button
          type="dashed"
          block
          icon={<SwapOutlined />}
          onClick={() => {
            window.location.assign(
              '/api/v1/auth/access/logout?returnTo=' +
                encodeURIComponent(window.location.origin + '/platform/login?loggedOut=1'),
            );
          }}
          style={{ marginTop: 10 }}
        >
          Đổi tài khoản khác (Xóa phiên cũ)
        </Button>
      </div>
    </AuthLayout>
  );
}
