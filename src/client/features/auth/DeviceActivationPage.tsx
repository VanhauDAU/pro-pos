import { DesktopOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type { ActivationConfirmationResponse } from '@contracts/auth';

import { ApiError, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

interface DirectActivationValues {
  username: string;
  password: string;
  deviceName: string;
}

function activationError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể kích hoạt máy POS.';
}

function suggestDeviceName() {
  if (typeof navigator === 'undefined') return 'Máy thu ngân chính';

  const userAgent = navigator.userAgent;
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)) {
    return 'iPad';
  }
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/Android/i.test(userAgent)) {
    const model = userAgent.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/i)?.[1]?.trim();
    return model || 'Thiết bị Android';
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Máy Mac';
  if (/Windows/i.test(userAgent)) return 'Máy tính Windows';
  return 'Máy thu ngân chính';
}

export function DeviceActivationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultDeviceName] = useState(suggestDeviceName);

  const handleActivate = async (values: DirectActivationValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<ActivationConfirmationResponse>('/api/v1/device-activations/direct', {
        username: values.username.trim(),
        password: values.password,
        deviceName: values.deviceName.trim() || 'Máy thu ngân chính',
      });
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/?tab=employee', { replace: true });
    } catch (activateError) {
      setError(activationError(activateError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="activation-heading">
        <Typography.Title level={2}>Thiết lập máy POS</Typography.Title>
        <Typography.Paragraph type="secondary">
          Thực hiện một lần trên trình duyệt tại quầy thu ngân. Chủ cửa hàng xác nhận tài khoản và
          đặt tên máy; sau đó nhân viên có thể đăng nhập bằng mã PIN nội bộ.
        </Typography.Paragraph>
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

      <Form<DirectActivationValues>
        layout="vertical"
        requiredMark={false}
        initialValues={{ deviceName: defaultDeviceName }}
        onFinish={handleActivate}
      >
        <Form.Item
          label="Tài khoản Chủ cửa hàng"
          name="username"
          rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập hoặc email Owner.' }]}
        >
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Tên đăng nhập hoặc Email"
            autoComplete="username"
            disabled={submitting}
          />
        </Form.Item>

        <Form.Item
          label="Mật khẩu Chủ cửa hàng"
          name="password"
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu Owner.' }]}
        >
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Mật khẩu Owner"
            autoComplete="current-password"
            disabled={submitting}
          />
        </Form.Item>

        <Form.Item
          label="Tên thiết bị POS"
          name="deviceName"
          extra="Tên này sẽ hiển thị trong danh sách thiết bị quản trị, ví dụ: iPad quầy chính."
          rules={[{ required: true, message: 'Vui lòng đặt tên cho máy POS.' }]}
        >
          <Input
            size="large"
            maxLength={80}
            prefix={<DesktopOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Ví dụ: iPad quầy chính, iPhone quản lý"
            disabled={submitting}
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          loading={submitting}
          className="owner-login-btn"
          style={{ marginTop: 12 }}
        >
          Kích hoạt máy POS
        </Button>
      </Form>

      <Button
        className="activation-cancel"
        type="link"
        block
        onClick={() => navigate('/?tab=employee')}
        style={{ marginTop: 16 }}
      >
        Quay lại đăng nhập
      </Button>
    </AuthLayout>
  );
}
