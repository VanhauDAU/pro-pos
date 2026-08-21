import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  MailOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Button, Form, Input, Spin, Tabs, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import type { AccessStartResponse, AuthContextResponse, LoginResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

import { AuthLayout } from './AuthLayout';

interface EmployeeFormValues {
  username: string;
  pin: string;
}

interface RememberedEmployee {
  username: string;
  displayName: string;
}

const REMEMBERED_EMPLOYEE_KEY = 'pos_last_employee';

function getRememberedEmployee(): RememberedEmployee | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_EMPLOYEE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedEmployee>;
    if (parsed && typeof parsed.username === 'string' && parsed.username.trim()) {
      return {
        username: parsed.username.trim(),
        displayName:
          typeof parsed.displayName === 'string' && parsed.displayName.trim()
            ? parsed.displayName.trim()
            : parsed.username.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function setRememberedEmployee(data: RememberedEmployee) {
  try {
    localStorage.setItem(REMEMBERED_EMPLOYEE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
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

interface QuickPinInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (pin: string) => void;
  showPin: boolean;
  onToggleShowPin: () => void;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

function QuickPinInput({
  value,
  onChange,
  onComplete,
  showPin,
  onToggleShowPin,
  disabled = false,
  hasError = false,
  autoFocus = true,
}: QuickPinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      // Focus on desktop/keyboard devices without forcing layout jump
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus, disabled]);

  const handleDigitPress = (digit: string) => {
    if (disabled || value.length >= 4) return;
    const nextVal = value + digit;
    onChange(nextVal);
    if (nextVal.length === 4) {
      onComplete?.(nextVal);
    }
  };

  const handleBackspace = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const handleClear = () => {
    if (disabled || value.length === 0) return;
    onChange('');
    inputRef.current?.focus({ preventScroll: true });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    onChange(raw);
    if (raw.length === 4) {
      onComplete?.(raw);
    }
  };

  return (
    <div className={`quick-pin-container ${hasError ? 'is-error shake' : ''}`}>
      {/* Hidden real input for hardware keyboard / virtual keyboard typing */}
      <input
        ref={inputRef}
        type={showPin ? 'text' : 'password'}
        inputMode="none"
        pattern="[0-9]*"
        maxLength={4}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        className="quick-pin-hidden-input"
        aria-label="Mã PIN 4 số"
        autoComplete="one-time-code"
      />

      {/* 4 Visual PIN Slots + Show/Hide Toggle */}
      <div
        className="quick-pin-display-row"
        onClick={() => inputRef.current?.focus({ preventScroll: true })}
      >
        <div className="quick-pin-slots">
          {[0, 1, 2, 3].map((index) => {
            const digit = value[index];
            const isFilled = digit !== undefined;
            const isActive =
              !disabled && (index === value.length || (index === 3 && value.length === 4));
            return (
              <div
                key={index}
                className={`quick-pin-slot ${isFilled ? 'is-filled' : ''} ${isActive ? 'is-active' : ''}`}
              >
                {isFilled ? (
                  showPin ? (
                    <span className="quick-pin-digit-text">{digit}</span>
                  ) : (
                    <span className="quick-pin-bullet" />
                  )
                ) : null}
              </div>
            );
          })}
        </div>

        <Button
          type="text"
          className="quick-pin-toggle-btn"
          icon={showPin ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onToggleShowPin();
          }}
          title={showPin ? 'Ẩn mã PIN' : 'Xem mã PIN'}
          aria-label={showPin ? 'Ẩn mã PIN' : 'Xem mã PIN'}
        />
      </div>

      {/* On-screen Touch Keypad */}
      <div className="quick-pin-numpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            className="quick-pin-key"
            disabled={disabled || value.length >= 4}
            onClick={() => handleDigitPress(digit)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="quick-pin-key quick-pin-key--action"
          disabled={disabled || value.length === 0}
          onClick={handleClear}
          title="Xóa hết"
        >
          C
        </button>
        <button
          key="0"
          type="button"
          className="quick-pin-key"
          disabled={disabled || value.length >= 4}
          onClick={() => handleDigitPress('0')}
        >
          0
        </button>
        <button
          type="button"
          className="quick-pin-key quick-pin-key--action"
          disabled={disabled || value.length === 0}
          onClick={handleBackspace}
          title="Xóa 1 số"
          aria-label="Xóa"
        >
          <DeleteOutlined />
        </button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Không thể đăng nhập. Vui lòng thử lại.';
}

function accessErrorMessage(code: string | null) {
  if (!code) return null;
  if (code === 'SESSION_EXPIRED') return 'Phiên Owner đã hết hạn. Vui lòng đăng nhập lại.';
  if (code === 'CONNECTION_ERROR') return 'Không thể kết nối Pro POS. Vui lòng thử lại.';
  if (code === 'STORE_LOCKED') return 'Cửa hàng đang bị khóa.';
  if (code === 'ACCESS_IDENTITY_DENIED') return 'Email chưa được cấp quyền sử dụng Pro POS.';
  if (code === 'ACCESS_REQUEST_EXPIRED') return 'Yêu cầu đăng nhập đã hết hạn. Vui lòng thử lại.';
  return 'Không thể xác thực email qua Cloudflare Access. Vui lòng thử lại.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') === 'owner' ? 'owner' : 'employee',
  );
  const [submitting, setSubmitting] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);
  const [rememberedEmployee, setRememberedEmployeeState] = useState<RememberedEmployee | null>(() =>
    getRememberedEmployee(),
  );
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    accessErrorMessage(searchParams.get('authError')),
  );
  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const deviceIsActive = context.data?.device?.status === 'ACTIVE';

  const switchTab = (key: string) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
    setError(null);
    setPinError(false);
    setPinValue('');
  };

  const ownerLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await jsonRequest<AccessStartResponse>('/api/v1/auth/access/start', {
        purpose: 'OWNER_LOGIN',
      });
      window.location.assign(response.loginUrl);
    } catch (loginError) {
      setError(errorMessage(loginError));
      setSubmitting(false);
    }
  };

  const executeEmployeeLogin = async (username: string, pin: string) => {
    if (!username.trim() || pin.length !== 4) return;
    setSubmitting(true);
    setError(null);
    setPinError(false);
    try {
      const response = await jsonRequest<LoginResponse>('/api/v1/auth/employee/login', {
        username: username.trim(),
        pin,
      });
      const savedInfo: RememberedEmployee = {
        username: username.trim(),
        displayName: response.actor.displayName || username.trim(),
      };
      setRememberedEmployee(savedInfo);
      setRememberedEmployeeState(savedInfo);
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/pos', { replace: true });
    } catch (loginError) {
      setError(errorMessage(loginError));
      setPinError(true);
      setPinValue('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickPinComplete = (completedPin: string) => {
    if (rememberedEmployee && !isSwitchingAccount) {
      void executeEmployeeLogin(rememberedEmployee.username, completedPin);
    }
  };

  const handleFullFormFinish = (values: EmployeeFormValues) => {
    void executeEmployeeLogin(values.username, pinValue || values.pin);
  };

  const items = useMemo(
    () => [
      {
        key: 'owner',
        label: 'Chủ cửa hàng',
        children: (
          <div className="owner-otp-login">
            {searchParams.get('loggedOut') === '1' ? (
              <Alert
                type="success"
                showIcon
                message="Đã đăng xuất tài khoản Owner"
                description="Phiên Cloudflare Access đã được xóa. Bạn có thể nhập email mới khi nhận mã OTP."
                style={{ marginBottom: 14 }}
              />
            ) : null}
            <Alert
              type="info"
              showIcon
              title="Đăng nhập bảo mật bằng email OTP"
              description="Cloudflare Access sẽ gửi mã dùng một lần đến email đã được cấp quyền. Pro POS không lưu mật khẩu Owner."
            />
            <Button
              type="primary"
              size="large"
              block
              icon={<MailOutlined />}
              loading={submitting}
              onClick={ownerLogin}
            >
              Nhận mã OTP qua email
            </Button>
            <Button
              type="dashed"
              block
              icon={<SwapOutlined />}
              onClick={() => {
                window.location.assign('/api/v1/auth/access/logout');
              }}
              style={{ marginTop: 10 }}
            >
              Đổi tài khoản Owner khác (Xóa phiên cũ)
            </Button>
            <Typography.Paragraph className="login-help" type="secondary">
              Owner có thể đăng nhập trên điện thoại hoặc máy tính mà không cần thiết lập máy POS.
            </Typography.Paragraph>
          </div>
        ),
      },
      {
        key: 'employee',
        label: 'Nhân viên',
        children: deviceIsActive ? (
          rememberedEmployee && !isSwitchingAccount ? (
            /* Quick PIN login for remembered employee */
            <div className="employee-quick-login">
              <div className="remembered-employee-card">
                <Avatar size={48} className="remembered-employee-avatar">
                  {getInitials(rememberedEmployee.displayName)}
                </Avatar>
                <div className="remembered-employee-info">
                  <strong className="remembered-employee-name">
                    {rememberedEmployee.displayName}
                  </strong>
                  <span className="remembered-employee-username">
                    @{rememberedEmployee.username}
                  </span>
                </div>
                <Button
                  type="text"
                  icon={<SwapOutlined />}
                  className="remembered-employee-switch-btn"
                  onClick={() => {
                    setIsSwitchingAccount(true);
                    setPinValue('');
                    setError(null);
                    setPinError(false);
                  }}
                  title="Đăng nhập tài khoản khác"
                >
                  Đổi
                </Button>
              </div>

              <div className="quick-pin-prompt">
                <span>Nhập mã PIN để vào ca</span>
              </div>

              <QuickPinInput
                value={pinValue}
                onChange={(val) => {
                  setPinValue(val);
                  if (pinError) setPinError(false);
                  if (error) setError(null);
                }}
                onComplete={handleQuickPinComplete}
                showPin={showPin}
                onToggleShowPin={() => setShowPin((prev) => !prev)}
                disabled={submitting}
                hasError={pinError}
                autoFocus
              />

              <Button
                type="primary"
                size="large"
                block
                className="employee-login-submit-btn"
                loading={submitting}
                disabled={pinValue.length < 4}
                onClick={() => void executeEmployeeLogin(rememberedEmployee.username, pinValue)}
              >
                Đăng nhập
              </Button>

              <div className="device-caption">
                <DesktopOutlined />
                <span>{context.data?.device?.name}</span>
              </div>
            </div>
          ) : (
            /* Standard Username + PIN login form */
            <Form<EmployeeFormValues>
              layout="vertical"
              requiredMark={false}
              onFinish={handleFullFormFinish}
              className="employee-full-login-form"
            >
              {rememberedEmployee ? (
                <div className="employee-switch-back-bar">
                  <Button
                    type="link"
                    size="small"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => {
                      setIsSwitchingAccount(false);
                      setPinValue('');
                      setError(null);
                      setPinError(false);
                    }}
                    className="employee-switch-back-btn"
                  >
                    Quay lại {rememberedEmployee.displayName}
                  </Button>
                </div>
              ) : null}

              <Form.Item
                name="username"
                rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  size="large"
                  autoComplete="username"
                  prefix={<UserOutlined />}
                  placeholder="Tên đăng nhập"
                  autoFocus={!rememberedEmployee}
                />
              </Form.Item>

              <Form.Item
                label={<span className="employee-pin-label">Mã PIN (4 số)</span>}
                className="employee-pin-login-item"
              >
                <QuickPinInput
                  value={pinValue}
                  onChange={(val) => {
                    setPinValue(val);
                    if (pinError) setPinError(false);
                    if (error) setError(null);
                  }}
                  showPin={showPin}
                  onToggleShowPin={() => setShowPin((prev) => !prev)}
                  disabled={submitting}
                  hasError={pinError}
                  autoFocus={Boolean(rememberedEmployee)}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                className="employee-login-submit-btn"
                loading={submitting}
                disabled={pinValue.length < 4}
              >
                Đăng nhập
              </Button>

              <div className="device-caption">
                <DesktopOutlined />
                <span>{context.data?.device?.name}</span>
              </div>
            </Form>
          )
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
    [
      context.data?.device?.name,
      context.data?.device?.status,
      deviceIsActive,
      rememberedEmployee,
      isSwitchingAccount,
      pinValue,
      pinError,
      showPin,
      submitting,
      error,
    ],
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
