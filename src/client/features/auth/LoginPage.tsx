import {
  ArrowLeftOutlined,
  DesktopOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  LoginOutlined,
  ShopOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Button, Checkbox, Form, Input, Popconfirm, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import type { AuthContextResponse, LoginResponse } from '@contracts/auth';

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
  showNumpad?: boolean;
}

function QuickPinInput({
  value,
  onChange,
  onComplete,
  showPin,
  onToggleShowPin,
  disabled = false,
  hasError = false,
  autoFocus = false,
  showNumpad = true,
}: QuickPinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus, disabled]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    onChange(raw);
    if (raw.length === 4) {
      onComplete?.(raw);
    }
  };

  const handleKeypadPress = (digit: string) => {
    if (disabled || value.length >= 4) return;
    const nextVal = (value + digit).slice(0, 4);
    onChange(nextVal);
    if (nextVal.length === 4) {
      onComplete?.(nextVal);
    }
  };

  const handleKeypadBackspace = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const handleKeypadClear = () => {
    if (disabled || value.length === 0) return;
    onChange('');
  };

  return (
    <div className={`quick-pin-container ${hasError ? 'is-error shake' : ''}`}>
      {/* Visual PIN Slots with real direct-focus numeric input */}
      <div className="quick-pin-display-row">
        <input
          ref={inputRef}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          className="quick-pin-hidden-input"
          aria-label="Mã PIN 4 số"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
        />

        <div className="quick-pin-slots" aria-hidden="true">
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

      {showNumpad ? (
        <div className="quick-pin-numpad" role="group" aria-label="Bàn phím số PIN">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              className="quick-pin-key"
              disabled={disabled}
              onClick={() => handleKeypadPress(digit)}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="quick-pin-key quick-pin-key--action"
            disabled={disabled || value.length === 0}
            onClick={handleKeypadClear}
            title="Xóa hết"
            aria-label="Xóa hết"
          >
            C
          </button>
          <button
            type="button"
            className="quick-pin-key"
            disabled={disabled}
            onClick={() => handleKeypadPress('0')}
          >
            0
          </button>
          <button
            type="button"
            className="quick-pin-key quick-pin-key--action"
            disabled={disabled || value.length === 0}
            onClick={handleKeypadBackspace}
            title="Xóa lùi"
            aria-label="Xóa lùi"
          >
            ⌫
          </button>
        </div>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Không thể đăng nhập. Vui lòng thử lại.';
}

function retryAfterSeconds(error: unknown) {
  if (!(error instanceof ApiError) || error.code !== 'AUTH_RATE_LIMITED') return 0;
  if (!error.details || typeof error.details !== 'object') return 0;
  const seconds = (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : 0;
}

function formatRetryDelay(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
    : `${remainingSeconds} giây`;
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
  const loginInFlightRef = useRef(false);
  const [ownerRetryAfterSeconds, setOwnerRetryAfterSeconds] = useState(0);
  const [employeeRetryAfterSeconds, setEmployeeRetryAfterSeconds] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState<{
    name: string;
    role: 'owner' | 'employee';
  } | null>(null);

  const [rememberedEmployee, setRememberedEmployeeState] = useState<RememberedEmployee | null>(() =>
    getRememberedEmployee(),
  );
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  const [ownerUsername, setOwnerUsername] = useState(() => {
    try {
      return localStorage.getItem('pos_saved_owner_username') || '';
    } catch {
      return '';
    }
  });
  const [ownerPassword, setOwnerPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const deviceIsActive = context.data?.device?.status === 'ACTIVE';

  useEffect(() => {
    const authErrorParam = searchParams.get('authError');
    if (authErrorParam) {
      const msg = accessErrorMessage(authErrorParam);
      if (msg) toast.error(msg);
    }
  }, [searchParams]);

  useEffect(() => {
    // If device is not active and no explicit tab param in URL, default to owner tab
    if (!searchParams.get('tab') && context.data && !deviceIsActive) {
      setActiveTab('owner');
    }
  }, [context.data, deviceIsActive, searchParams]);

  useEffect(() => {
    if (ownerRetryAfterSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setOwnerRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [ownerRetryAfterSeconds]);

  useEffect(() => {
    if (employeeRetryAfterSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setEmployeeRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [employeeRetryAfterSeconds]);

  const switchTab = (key: string) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
    setPinError(false);
    setPinValue('');
  };

  const executeOwnerLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loginInFlightRef.current || ownerRetryAfterSeconds > 0) return;
    if (!ownerUsername.trim() || !ownerPassword) {
      toast.warning('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    loginInFlightRef.current = true;
    setSubmitting(true);
    try {
      await jsonRequest<LoginResponse>('/api/v1/auth/owner/login', {
        username: ownerUsername.trim(),
        password: ownerPassword,
        rememberMe,
      });
      try {
        if (rememberMe) {
          localStorage.setItem('pos_saved_owner_username', ownerUsername.trim());
        } else {
          localStorage.removeItem('pos_saved_owner_username');
        }
      } catch {
        // ignore
      }
      setLoginSuccess({ name: ownerUsername.trim(), role: 'owner' });
      toast.success('Đăng nhập Chủ cửa hàng thành công!');
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      setTimeout(() => {
        navigate('/owner', { replace: true });
      }, 450);
    } catch (loginError) {
      const retryAfter = retryAfterSeconds(loginError);
      setOwnerRetryAfterSeconds(retryAfter);
      const msg =
        retryAfter > 0
          ? `Đăng nhập tạm khóa. Vui lòng thử lại sau ${formatRetryDelay(retryAfter)}.`
          : errorMessage(loginError);
      toast.error(msg);
    } finally {
      loginInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const executeEmployeeLogin = async (username: string, pin: string) => {
    if (
      loginInFlightRef.current ||
      employeeRetryAfterSeconds > 0 ||
      !username.trim() ||
      pin.length !== 4
    )
      return;
    loginInFlightRef.current = true;
    setSubmitting(true);
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
      setLoginSuccess({ name: savedInfo.displayName, role: 'employee' });
      toast.success(`Xin chào, ${savedInfo.displayName}!`);
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      setTimeout(() => {
        navigate('/pos', { replace: true });
      }, 450);
    } catch (loginError) {
      const retryAfter = retryAfterSeconds(loginError);
      setEmployeeRetryAfterSeconds(retryAfter);
      const msg =
        retryAfter > 0
          ? `Thiết bị đang tạm khóa đăng nhập PIN. Vui lòng thử lại sau ${formatRetryDelay(retryAfter)}.`
          : errorMessage(loginError);
      toast.error(msg);
      setPinError(true);
      setPinValue('');
    } finally {
      loginInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnectDevice = async () => {
    setDisconnecting(true);
    try {
      await jsonRequest<{ disconnected: boolean }>('/api/v1/auth/device/disconnect', {});
      try {
        localStorage.removeItem(REMEMBERED_EMPLOYEE_KEY);
      } catch {
        // ignore
      }
      setRememberedEmployeeState(null);
      setIsSwitchingAccount(false);
      setPinValue('');
      toast.info('Đã ngắt kết nối thiết bị.');
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      navigate('/device-activation');
    } catch (disconnectError) {
      toast.error(errorMessage(disconnectError));
    } finally {
      setDisconnecting(false);
    }
  };

  const renderDeviceBar = () => (
    <div className="employee-device-bar">
      <div className="employee-device-info">
        <ShopOutlined className="employee-device-icon" />
        <span
          className="employee-device-store"
          title={context.data?.device?.storeName || 'Cửa hàng'}
        >
          {context.data?.device?.storeName || 'Cửa hàng'}
        </span>
        <span className="employee-device-divider">•</span>
        <span className="employee-device-name" title={context.data?.device?.name}>
          {context.data?.device?.name}
        </span>
      </div>
      <Popconfirm
        title="Đổi cửa hàng cho máy POS?"
        description="Máy sẽ ngắt liên kết với cửa hàng hiện tại để kích hoạt cửa hàng khác."
        okText="Đổi cửa hàng"
        cancelText="Hủy"
        okButtonProps={{ danger: true, size: 'small' }}
        cancelButtonProps={{ size: 'small' }}
        placement="topRight"
        onConfirm={handleDisconnectDevice}
      >
        <Button
          type="link"
          size="small"
          icon={<SwapOutlined />}
          className="employee-change-store-btn"
          loading={disconnecting}
        >
          Đổi cửa hàng
        </Button>
      </Popconfirm>
    </div>
  );

  const handleQuickPinComplete = (completedPin: string) => {
    if (rememberedEmployee && !isSwitchingAccount) {
      void executeEmployeeLogin(rememberedEmployee.username, completedPin);
    }
  };

  const handleFullFormFinish = (values: EmployeeFormValues) => {
    void executeEmployeeLogin(values.username, pinValue || values.pin);
  };

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

  const renderOwnerTab = () => (
    <div className="owner-login-clean">
      <form onSubmit={executeOwnerLogin} className="owner-password-form">
        <div style={{ marginBottom: 16 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Tên đăng nhập hoặc Email"
            value={ownerUsername}
            onChange={(e) => setOwnerUsername(e.target.value)}
            autoComplete="username"
            disabled={submitting}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Mật khẩu"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            autoComplete="current-password"
            disabled={submitting}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <Checkbox
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={submitting}
          >
            <span style={{ color: '#475569', fontSize: 13.5 }}>Duy trì đăng nhập</span>
          </Checkbox>
        </div>

        <Button
          type="primary"
          size="large"
          htmlType="submit"
          block
          icon={<LoginOutlined />}
          loading={submitting}
          disabled={!ownerUsername.trim() || !ownerPassword || ownerRetryAfterSeconds > 0}
          className="owner-login-btn"
        >
          {ownerRetryAfterSeconds > 0
            ? `Thử lại sau ${formatRetryDelay(ownerRetryAfterSeconds)}`
            : 'Đăng nhập'}
        </Button>

        <div className="owner-login-clean__footer">
          <Button
            type="link"
            size="small"
            icon={<DesktopOutlined />}
            onClick={() => navigate('/device-activation')}
            className="owner-login-clean__link"
          >
            Kích hoạt thiết bị POS mới
          </Button>
        </div>
      </form>
    </div>
  );

  const renderEmployeeTab = () => {
    if (!deviceIsActive) {
      return (
        <div className="employee-device-warning">
          <div className="employee-device-warning-icon">
            <ShopOutlined />
          </div>
          <h3>Thiết bị chưa kích hoạt POS</h3>
          <p>
            Vui lòng đăng nhập với tài khoản Chủ cửa hàng để kích hoạt thiết bị này trước khi nhân
            viên có thể vào ca.
          </p>
          <Button
            type="primary"
            block
            size="large"
            icon={<DesktopOutlined />}
            onClick={() => switchTab('owner')}
            className="employee-device-warning-btn"
          >
            Chuyển sang Chủ cửa hàng
          </Button>
        </div>
      );
    }

    if (rememberedEmployee && !isSwitchingAccount) {
      return (
        <div className="employee-quick-login">
          <div className="remembered-employee-card" style={{ marginBottom: 16 }}>
            <Avatar size={42} className="remembered-employee-avatar">
              {getInitials(rememberedEmployee.displayName)}
            </Avatar>
            <div className="remembered-employee-info">
              <strong className="remembered-employee-name">{rememberedEmployee.displayName}</strong>
              <span className="remembered-employee-username">@{rememberedEmployee.username}</span>
            </div>
            <button
              type="button"
              className="remembered-employee-switch-btn"
              onClick={() => {
                setIsSwitchingAccount(true);
                setPinValue('');
                setPinError(false);
              }}
            >
              <SwapOutlined />
              <span>Đổi tài khoản</span>
            </button>
          </div>

          <div className="quick-pin-prompt">
            <span>Nhập mã PIN để vào ca</span>
          </div>

          <QuickPinInput
            value={pinValue}
            onChange={(val) => {
              setPinValue(val);
              if (pinError) setPinError(false);
            }}
            onComplete={handleQuickPinComplete}
            showPin={showPin}
            onToggleShowPin={() => setShowPin((prev) => !prev)}
            disabled={submitting}
            hasError={pinError}
          />

          <Button
            type="primary"
            size="large"
            block
            className="employee-login-submit-btn"
            loading={submitting}
            disabled={pinValue.length < 4 || employeeRetryAfterSeconds > 0}
            onClick={() => void executeEmployeeLogin(rememberedEmployee.username, pinValue)}
          >
            {employeeRetryAfterSeconds > 0
              ? `Thử lại sau ${formatRetryDelay(employeeRetryAfterSeconds)}`
              : 'Đăng nhập'}
          </Button>

          {renderDeviceBar()}
        </div>
      );
    }

    return (
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
            }}
            showPin={showPin}
            onToggleShowPin={() => setShowPin((prev) => !prev)}
            disabled={submitting || employeeRetryAfterSeconds > 0}
            hasError={pinError}
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          className="employee-login-submit-btn"
          loading={submitting}
          disabled={pinValue.length < 4 || employeeRetryAfterSeconds > 0}
        >
          {employeeRetryAfterSeconds > 0
            ? `Thử lại sau ${formatRetryDelay(employeeRetryAfterSeconds)}`
            : 'Đăng nhập'}
        </Button>

        {renderDeviceBar()}
      </Form>
    );
  };

  return (
    <AuthLayout>
      <div className="auth-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'owner'}
          className={`auth-tab-btn ${activeTab === 'owner' ? 'is-active' : ''}`}
          onClick={() => switchTab('owner')}
        >
          Chủ cửa hàng
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'employee'}
          className={`auth-tab-btn ${activeTab === 'employee' ? 'is-active' : ''}`}
          onClick={() => switchTab('employee')}
        >
          Nhân viên
        </button>
      </div>

      <div className="auth-tab-content">
        {activeTab === 'owner' ? renderOwnerTab() : renderEmployeeTab()}
      </div>

      {loginSuccess ? (
        <div className="login-success-overlay" role="alert" aria-live="assertive">
          <div className="login-success-card">
            <div className="login-success-icon-wrap">
              <svg className="login-success-checkmark" viewBox="0 0 52 52">
                <circle
                  className="login-success-checkmark__circle"
                  cx="26"
                  cy="26"
                  r="24"
                  fill="none"
                />
                <path
                  className="login-success-checkmark__check"
                  fill="none"
                  d="M14.1 27.2l7.1 7.2 16.7-16.8"
                />
              </svg>
            </div>
            <h3 className="login-success-title">Đăng nhập thành công!</h3>
            <p className="login-success-subtitle">
              Xin chào, <strong>{loginSuccess.name}</strong>
            </p>
          </div>
        </div>
      ) : null}
    </AuthLayout>
  );
}
