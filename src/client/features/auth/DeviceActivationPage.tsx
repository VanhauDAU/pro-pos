import { DesktopOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Steps, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type {
  ActivationAuthorizationResponse,
  ActivationConfirmationResponse,
} from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

interface AuthorizationValues {
  username: string;
  password: string;
}

interface DeviceValues {
  deviceName: string;
}

function activationError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể thiết lập máy POS.';
}

export function DeviceActivationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorize = async (values: AuthorizationValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await jsonRequest<ActivationAuthorizationResponse>(
        '/api/v1/device-activations/authorize',
        values,
      );
      setCsrfToken(response.csrfToken);
      setStep(1);
    } catch (authorizationError) {
      setError(activationError(authorizationError));
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (values: DeviceValues) => {
    if (!csrfToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await jsonRequest<ActivationConfirmationResponse>(
        '/api/v1/device-activations/confirm',
        values,
        {
          headers: {
            'X-CSRF-Token': csrfToken,
            'Idempotency-Key': crypto.randomUUID(),
          },
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/?tab=employee', { replace: true });
    } catch (confirmationError) {
      setError(activationError(confirmationError));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    await apiRequest('/api/v1/device-activations/current', { method: 'DELETE' }).catch(() => null);
    navigate('/?tab=employee');
  };

  return (
    <AuthLayout>
      <div className="activation-heading">
        <Typography.Title level={2}>Thiết lập máy POS</Typography.Title>
        <Typography.Paragraph type="secondary">
          Thực hiện một lần trên trình duyệt Windows tại quầy. Owner xác nhận cửa hàng và đặt tên
          máy; sau đó nhân viên mới có thể đăng nhập bằng PIN. Đây không phải bước cài phần mềm và
          Owner trên điện thoại không cần thực hiện.
        </Typography.Paragraph>
      </div>

      <Steps
        className="activation-steps"
        size="small"
        current={step}
        items={[{ title: 'Owner xác nhận' }, { title: 'Đặt tên máy' }]}
      />

      {error ? <Alert className="login-error" type="error" showIcon title={error} /> : null}

      {step === 0 ? (
        <Form<AuthorizationValues> layout="vertical" requiredMark={false} onFinish={authorize}>
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập Owner.' }]}
          >
            <Input
              size="large"
              autoComplete="username"
              prefix={<UserOutlined />}
              placeholder="Tên đăng nhập Owner"
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
            Xác nhận Chủ cửa hàng
          </Button>
        </Form>
      ) : (
        <Form<DeviceValues> layout="vertical" requiredMark={false} onFinish={confirm}>
          <Form.Item
            name="deviceName"
            rules={[{ required: true, message: 'Vui lòng đặt tên cho máy POS.' }]}
          >
            <Input
              size="large"
              maxLength={80}
              prefix={<DesktopOutlined />}
              placeholder="Ví dụ: Máy thu ngân chính"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            Kích hoạt máy POS
          </Button>
        </Form>
      )}

      <Button className="activation-cancel" type="link" block onClick={cancel}>
        Quay lại đăng nhập
      </Button>
    </AuthLayout>
  );
}
