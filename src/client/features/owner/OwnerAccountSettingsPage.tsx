import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse, OwnerAccountProfile } from '@contracts/auth';
import { VIETNAM_PHONE_REGEX } from '@contracts/store';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface AccountFormValues {
  username: string;
  displayName: string;
  phone?: string | undefined;
  email?: string | undefined;
}

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function normalizePhone(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) return `0${digits.slice(2)}`;
  return digits.slice(0, 11);
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function OwnerAccountSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profileForm] = Form.useForm<AccountFormValues>();
  const [passwordForm] = Form.useForm<ChangePasswordFormValues>();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const accountQuery = useQuery({
    queryKey: ['owner-account'],
    queryFn: () => apiRequest<OwnerAccountProfile>('/api/v1/owner/account'),
  });

  const authContextQuery = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  useEffect(() => {
    if (!accountQuery.data) return;
    const data = accountQuery.data;
    profileForm.setFieldsValue({
      username: data.username,
      displayName: data.displayName,
      phone: normalizePhone(data.phone),
      email: data.email ?? '',
    });
  }, [accountQuery.data, profileForm]);

  const handleSaveProfile = async (values: AccountFormValues) => {
    setSavingProfile(true);
    try {
      await apiRequest<OwnerAccountProfile>('/api/v1/owner/account', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': authContextQuery.data?.csrfToken ?? '',
        },
        body: JSON.stringify({
          displayName: values.displayName.trim(),
          phone: values.phone ? normalizePhone(values.phone) : null,
          email: values.email ? values.email.trim() : null,
        }),
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner-account'] }),
        queryClient.invalidateQueries({ queryKey: ['auth-context'] }),
      ]);

      messageApi.success('Cập nhật thông tin tài khoản thành công.');
    } catch (error) {
      messageApi.error(
        error instanceof ApiError ? error.message : 'Không thể lưu thông tin tài khoản.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (values: ChangePasswordFormValues) => {
    setSavingPassword(true);
    try {
      await jsonRequest('/api/v1/owner/account/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }, {
        headers: { 'X-CSRF-Token': authContextQuery.data?.csrfToken ?? '' },
      });

      messageApi.success('Đổi mật khẩu thành công. Vui lòng ghi nhớ mật khẩu mới.');
      passwordForm.resetFields();
    } catch (error) {
      messageApi.error(
        error instanceof ApiError ? error.message : 'Không thể đổi mật khẩu.',
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const handleResetProfileForm = () => {
    if (accountQuery.data) {
      profileForm.setFieldsValue({
        username: accountQuery.data.username,
        displayName: accountQuery.data.displayName,
        phone: normalizePhone(accountQuery.data.phone),
        email: accountQuery.data.email ?? '',
      });
    }
  };

  if (accountQuery.isLoading) {
    return <Spin fullscreen description="Đang tải thông tin tài khoản Chủ cửa hàng..." />;
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="owner-store-settings-page">
        <button className="owner-back-link" type="button" onClick={() => navigate('/owner/settings')}>
          <ArrowLeftOutlined /> Quay lại thiết lập
        </button>
        <Alert
          type="error"
          showIcon
          title="Không thể tải thông tin tài khoản"
          description="Vui lòng thử tải lại trang hoặc kiểm tra phiên đăng nhập của Chủ cửa hàng."
          style={{ marginTop: 24 }}
        />
      </div>
    );
  }

  const account = accountQuery.data;

  return (
    <div className="owner-store-settings-page">
      {contextHolder}
      <button className="owner-back-link" type="button" onClick={() => navigate('/owner/settings')}>
        <ArrowLeftOutlined /> Quay lại thiết lập
      </button>

      <div className="owner-store-settings-heading">
        <Typography.Title level={2}>Thiết lập tài khoản</Typography.Title>
        <Typography.Text type="secondary">
          Quản lý thông tin cá nhân của Chủ cửa hàng và bảo mật đăng nhập.
        </Typography.Text>
      </div>

      <Divider />

      {/* Summary Profile Banner */}
      <Card
        style={{
          marginBottom: 28,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #0975f7 0%, #0650ab 100%)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 8px 24px rgba(9, 117, 247, 0.18)',
        }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <Row align="middle" justify="space-between" gutter={[16, 16]}>
          <Col>
            <Space orientation="horizontal" size={18} align="center">
              <Avatar
                size={64}
                style={{
                  backgroundColor: '#ffffff',
                  color: '#0975f7',
                  fontSize: 26,
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              >
                {account.displayName.slice(0, 1).toUpperCase()}
              </Avatar>
              <div>
                <Space orientation="horizontal" size={8} align="center">
                  <Typography.Title
                    level={3}
                    style={{ color: '#ffffff', margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}
                  >
                    {account.displayName}
                  </Typography.Title>
                  <Tag color="gold" style={{ fontWeight: 600, borderRadius: 6, margin: 0 }}>
                    CHỦ CỬA HÀNG
                  </Tag>
                </Space>
                <div style={{ marginTop: 6, color: 'rgba(255, 255, 255, 0.85)', fontSize: 13 }}>
                  <Space orientation="horizontal" size={16} wrap>
                    <span>
                      <UserOutlined style={{ marginRight: 5 }} />
                      Tài khoản: <strong>{account.username}</strong>
                    </span>
                    {account.storeName ? (
                      <span>
                        <ShopOutlined style={{ marginRight: 5 }} />
                        Cửa hàng: <strong>{account.storeName}</strong>
                      </span>
                    ) : null}
                  </Space>
                </div>
              </div>
            </Space>
          </Col>
          <Col>
            <Tag
              icon={<CheckCircleOutlined />}
              color="success"
              style={{
                fontSize: 13,
                padding: '4px 12px',
                borderRadius: 20,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.2)',
                color: '#fff',
              }}
            >
              Đang hoạt động
            </Tag>
          </Col>
        </Row>
      </Card>

      {/* Main Settings Form Layout */}
      <div className="owner-store-settings-layout">
        {/* SECTION 1: Personal Info */}
        <aside className="owner-store-settings-intro">
          <Typography.Title level={4}>Thông tin cá nhân</Typography.Title>
          <Typography.Paragraph type="secondary">
            Thông tin định danh của chủ cửa hàng dùng để liên hệ, nhận thông báo và quản trị hệ thống.
          </Typography.Paragraph>
          <div className="owner-store-settings-tip">
            <InfoCircleOutlined />
            <span>Tên tài khoản (username) là duy nhất và không thể thay đổi sau khi tạo.</span>
          </div>
        </aside>

        <Card className="owner-store-settings-card">
          <Form
            form={profileForm}
            layout="vertical"
            requiredMark={false}
            onFinish={handleSaveProfile}
          >
            <Form.Item
              label={
                <Space orientation="horizontal" size={4}>
                  <span>Tài khoản (Tên đăng nhập)</span>
                  <Tag color="default" style={{ fontSize: 11, marginLeft: 4 }}>
                    Không thể thay đổi
                  </Tag>
                </Space>
              }
              name="username"
              extra="Tên tài khoản dùng để đăng nhập hệ thống và kích hoạt máy POS."
            >
              <Input
                disabled
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                style={{
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                  fontWeight: 600,
                  cursor: 'not-allowed',
                }}
              />
            </Form.Item>

            <Form.Item
              label={
                <span>
                  Họ và tên chủ cửa hàng <b className="owner-required">(*)</b>
                </span>
              }
              name="displayName"
              rules={[
                { required: true, message: 'Vui lòng nhập họ và tên chủ cửa hàng.' },
                { max: 128, message: 'Họ và tên không được vượt quá 128 ký tự.' },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Nhập họ và tên chủ cửa hàng"
                maxLength={128}
                showCount
              />
            </Form.Item>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Số điện thoại"
                  name="phone"
                  normalize={normalizePhone}
                  rules={[
                    {
                      validator: async (_, value?: string) => {
                        const phone = normalizePhone(value);
                        if (!phone || VIETNAM_PHONE_REGEX.test(phone)) return;
                        throw new Error('Số điện thoại không đúng định dạng Việt Nam (10–11 số).');
                      },
                    },
                  ]}
                >
                  <Input
                    prefix={<PhoneOutlined style={{ color: '#94a3b8' }} />}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ví dụ: 0912345678"
                    maxLength={11}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Email"
                  name="email"
                  rules={[
                    { type: 'email', message: 'Địa chỉ email không hợp lệ.' },
                    { max: 254, message: 'Email tối đa 254 ký tự.' },
                  ]}
                >
                  <Input
                    prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
                    type="email"
                    placeholder="Ví dụ: owner@example.com"
                    maxLength={254}
                  />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <Button onClick={handleResetProfileForm} disabled={savingProfile}>
                Đặt lại
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={savingProfile}
                icon={<SaveOutlined />}
              >
                Lưu thông tin
              </Button>
            </div>
          </Form>
        </Card>

        {/* SECTION 2: Security & Password */}
        <aside className="owner-store-settings-intro">
          <Typography.Title level={4}>Bảo mật & Mật khẩu</Typography.Title>
          <Typography.Paragraph type="secondary">
            Cập nhật mật khẩu định kỳ để bảo vệ tài khoản quản trị và các thiết bị bán hàng POS.
          </Typography.Paragraph>
          <div className="owner-store-settings-tip">
            <SafetyCertificateOutlined />
            <span>Mật khẩu mới tối thiểu 6 ký tự. Hãy kết hợp chữ hoa, chữ thường và chữ số.</span>
          </div>
        </aside>

        <Card className="owner-store-settings-card">
          <Form
            form={passwordForm}
            layout="vertical"
            requiredMark={false}
            onFinish={handleChangePassword}
          >
            <Form.Item
              label={
                <span>
                  Mật khẩu hiện tại <b className="owner-required">(*)</b>
                </span>
              }
              name="currentPassword"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại.' }]}
            >
              <Input.Password
                prefix={<KeyOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Nhập mật khẩu đang sử dụng"
                autoComplete="current-password"
              />
            </Form.Item>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label={
                    <span>
                      Mật khẩu mới <b className="owner-required">(*)</b>
                    </span>
                  }
                  name="newPassword"
                  rules={[
                    { required: true, message: 'Vui lòng nhập mật khẩu mới.' },
                    { min: 6, message: 'Mật khẩu mới tối thiểu 6 ký tự.' },
                    { max: 128, message: 'Mật khẩu tối đa 128 ký tự.' },
                  ]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                    placeholder="Tối thiểu 6 ký tự"
                    autoComplete="new-password"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label={
                    <span>
                      Xác nhận mật khẩu mới <b className="owner-required">(*)</b>
                    </span>
                  }
                  name="confirmPassword"
                  dependencies={['newPassword']}
                  rules={[
                    { required: true, message: 'Vui lòng xác nhận lại mật khẩu mới.' },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue('newPassword') === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(new Error('Mật khẩu xác nhận không khớp.'));
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                  />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={savingPassword}
                icon={<KeyOutlined />}
                style={{ background: '#1e293b' }}
              >
                Cập nhật mật khẩu
              </Button>
            </div>
          </Form>
        </Card>

        {/* SECTION 3: System Details */}
        <aside className="owner-store-settings-intro">
          <Typography.Title level={4}>Thông tin hệ thống</Typography.Title>
          <Typography.Paragraph type="secondary">
            Chi tiết liên kết tài khoản với cửa hàng và nhật ký khởi tạo.
          </Typography.Paragraph>
        </aside>

        <Card className="owner-store-settings-card">
          <Row gutter={[24, 16]}>
            <Col xs={24} sm={12}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  MÃ ĐỊNH DANH TÀI KHOẢN (USER ID)
                </Typography.Text>
                <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 13, color: '#334155' }}>
                  {account.id}
                </div>
              </div>
            </Col>
            <Col xs={24} sm={12}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  CỬA HÀNG QUẢN LÝ
                </Typography.Text>
                <div style={{ marginTop: 4, fontWeight: 600, color: '#0f172a' }}>
                  {account.storeName || account.storeId}
                </div>
              </div>
            </Col>
            <Col xs={24} sm={12}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  NGÀY KHỞI TẠO TÀI KHOẢN
                </Typography.Text>
                <div style={{ marginTop: 4, color: '#334155' }}>
                  {formatDate(account.createdAt)}
                </div>
              </div>
            </Col>
            <Col xs={24} sm={12}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  TRẠNG THÁI
                </Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Badge status="success" text="Đang hoạt động (ACTIVE)" />
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      </div>
    </div>
  );
}
