import {
  ArrowLeftOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type { BankAccountDto } from '@contracts/store';
import { VIETNAM_PHONE_REGEX } from '@contracts/store';

import { StoreLocationMapPicker } from './StoreLocationMapPicker';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

const LOCATION_API = 'https://provinces.open-api.vn/api/v2';

interface Province {
  code: number;
  name: string;
  codename: string;
  division_type: string;
}

interface Ward {
  code: number;
  name: string;
  codename: string;
  province_code: number;
  division_type: string;
}

interface StoreSettings {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  phone: string | null;
  address: string | null;
  currency: string;
  businessDayCutoffMinutes: number;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  bankQrMediaId: string | null;
  bankAccounts: BankAccountDto[];
  provinceCode: number | null;
  provinceName: string | null;
  wardCode: number | null;
  wardName: string | null;
  locationVerificationEnabled: number | boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
}

interface StoreFormValues {
  name: string;
  phone: string;
  currency: string;
  address: string;
  provinceCode: number;
  wardCode: number;
  locationVerificationEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
}

interface BankAccountFormValues {
  bankBin: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
}

interface VietQRBank {
  id: number;
  name: string;
  code: string;
  bin: string;
  shortName: string;
  logo: string;
}

function normalizePhone(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) return `0${digits.slice(2)}`;
  return digits.slice(0, 11);
}

async function locationRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${LOCATION_API}${path}`);
  if (!response.ok) throw new Error('LOCATION_REQUEST_FAILED');
  return (await response.json()) as T;
}

export function OwnerStoreSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<StoreFormValues>();
  const [provinceCode, setProvinceCode] = useState<number | undefined>();
  const [locationVerificationEnabled, setLocationVerificationEnabled] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [allowedRadius, setAllowedRadius] = useState<number>(300);
  const [maxAccuracy, setMaxAccuracy] = useState<number>(100);
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [bankAccountModalOpen, setBankAccountModalOpen] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccountDto | null>(null);
  const [bankAccountSaving, setBankAccountSaving] = useState(false);
  const [bankAccountForm] = Form.useForm<BankAccountFormValues>();

  const settings = useQuery({
    queryKey: ['owner-settings'],
    queryFn: () => apiRequest<StoreSettings>('/api/v1/owner/store/settings'),
  });
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const provinces = useQuery({
    queryKey: ['vn-provinces-v2'],
    queryFn: () => locationRequest<Province[]>('/p/'),
    staleTime: 10 * 60 * 1000,
  });
  const wards = useQuery({
    queryKey: ['vn-wards-v2', provinceCode],
    queryFn: () => locationRequest<Ward[]>(`/w/?province=${provinceCode}`),
    enabled: provinceCode !== undefined,
    staleTime: 10 * 60 * 1000,
  });
  const banks = useQuery({
    queryKey: ['vietqr-banks'],
    queryFn: async () => {
      const res = await fetch('https://api.vietqr.io/v2/banks');
      if (!res.ok) throw new Error('Failed to fetch banks');
      const json = await res.json();
      return json.data as VietQRBank[];
    },
    staleTime: 24 * 60 * 60 * 1000,
  });

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm] = Form.useForm();
  const [passwordSaving, setPasswordSaving] = useState(false);

  const handleChangePassword = async (values: {
    currentPassword?: string;
    newPassword: string;
  }) => {
    setPasswordSaving(true);
    try {
      await jsonRequest('/api/v1/auth/change-password', values, {
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      messageApi.success('Đổi mật khẩu thành công.');
      passwordForm.resetFields();
      setPasswordModalOpen(false);
    } catch (err) {
      messageApi.error(err instanceof ApiError ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setPasswordSaving(false);
    }
  };

  useEffect(() => {
    if (!settings.data) return;
    const data = settings.data;
    setProvinceCode(data.provinceCode ?? undefined);
    const isLocEnabled =
      data.locationVerificationEnabled === 1 || data.locationVerificationEnabled === true;
    setLocationVerificationEnabled(isLocEnabled);
    setCoords({
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    });
    setAllowedRadius(data.allowedRadiusMeters || 300);
    setMaxAccuracy(data.maxAccuracyMeters || 100);

    form.setFieldsValue({
      name: data.name,
      phone: normalizePhone(data.phone),
      currency: data.currency || 'VND',
      address: data.address ?? '',
      ...(data.provinceCode === null ? {} : { provinceCode: data.provinceCode }),
      ...(data.wardCode === null ? {} : { wardCode: data.wardCode }),
      locationVerificationEnabled: isLocEnabled,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      allowedRadiusMeters: data.allowedRadiusMeters || 300,
      maxAccuracyMeters: data.maxAccuracyMeters || 100,
    });
  }, [form, settings.data]);

  const applyBankAccounts = (bankAccounts: BankAccountDto[]) => {
    const defaultAccount = bankAccounts.find((account) => account.isDefault) ?? null;
    queryClient.setQueryData<StoreSettings>(['owner-settings'], (current) =>
      current
        ? {
            ...current,
            bankAccounts,
            bankName: defaultAccount?.bankBin ?? null,
            bankAccountNumber: defaultAccount?.accountNumber ?? null,
            bankAccountName: defaultAccount?.accountName ?? null,
            bankQrMediaId: null,
          }
        : current,
    );
  };

  const openCreateBankAccount = () => {
    setEditingBankAccount(null);
    bankAccountForm.resetFields();
    bankAccountForm.setFieldsValue({
      isDefault: (settings.data?.bankAccounts.length ?? 0) === 0,
    });
    setBankAccountModalOpen(true);
  };

  const openEditBankAccount = (account: BankAccountDto) => {
    setEditingBankAccount(account);
    bankAccountForm.setFieldsValue({
      bankBin: account.bankBin,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      isDefault: account.isDefault,
    });
    setBankAccountModalOpen(true);
  };

  const saveBankAccount = async (values: BankAccountFormValues) => {
    const bank = banks.data?.find((candidate) => candidate.bin === values.bankBin);
    if (!bank) {
      messageApi.warning('Vui lòng chọn ngân hàng hợp lệ.');
      return;
    }
    setBankAccountSaving(true);
    try {
      const result = await jsonRequest<{ bankAccounts: BankAccountDto[] }>(
        editingBankAccount
          ? `/api/v1/owner/store/bank-accounts/${editingBankAccount.id}`
          : '/api/v1/owner/store/bank-accounts',
        {
          bankBin: bank.bin,
          bankCode: bank.code || bank.shortName,
          bankName: bank.name,
          accountNumber: values.accountNumber,
          accountName: values.accountName.toUpperCase(),
          isDefault: values.isDefault,
        },
        {
          method: editingBankAccount ? 'PATCH' : 'POST',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      applyBankAccounts(result.bankAccounts);
      setBankAccountModalOpen(false);
      bankAccountForm.resetFields();
      messageApi.success(editingBankAccount ? 'Đã cập nhật tài khoản.' : 'Đã thêm tài khoản.');
    } catch (error) {
      messageApi.error(error instanceof ApiError ? error.message : 'Không thể lưu tài khoản.');
    } finally {
      setBankAccountSaving(false);
    }
  };

  const deleteBankAccount = (account: BankAccountDto) => {
    Modal.confirm({
      title: 'Xóa tài khoản ngân hàng?',
      content: `${account.bankCode} · ${account.accountNumber}`,
      okText: 'Xóa',
      okButtonProps: { danger: true },
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          const result = await apiRequest<{ bankAccounts: BankAccountDto[] }>(
            `/api/v1/owner/store/bank-accounts/${account.id}`,
            {
              method: 'DELETE',
              headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
            },
          );
          applyBankAccounts(result.bankAccounts);
          messageApi.success('Đã xóa tài khoản ngân hàng.');
        } catch (error) {
          messageApi.error(error instanceof ApiError ? error.message : 'Không thể xóa tài khoản.');
        }
      },
    });
  };

  const save = async (values: StoreFormValues) => {
    const province = provinces.data?.find((item) => item.code === values.provinceCode);
    const ward = wards.data?.find((item) => item.code === values.wardCode);
    const defaultBankAccount = settings.data?.bankAccounts.find((account) => account.isDefault);

    if (locationVerificationEnabled && (coords.latitude === null || coords.longitude === null)) {
      messageApi.error('Vui lòng chọn vị trí cửa hàng trên bản đồ khi bật xác minh vị trí.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/api/v1/owner/store/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': authContext.data?.csrfToken ?? '',
        },
        body: JSON.stringify({
          name: values.name,
          phone: values.phone || null,
          address: values.address,
          businessDayCutoffMinutes: settings.data?.businessDayCutoffMinutes ?? 0,
          bankName: defaultBankAccount?.bankBin ?? null,
          bankAccountNumber: defaultBankAccount?.accountNumber ?? null,
          bankAccountName: defaultBankAccount?.accountName ?? null,
          bankQrMediaId: null,
          provinceCode: province?.code ?? null,
          provinceName: province?.name ?? null,
          wardCode: ward?.code ?? null,
          wardName: ward?.name ?? null,
          locationVerificationEnabled,
          latitude: coords.latitude,
          longitude: coords.longitude,
          allowedRadiusMeters: allowedRadius,
          maxAccuracyMeters: maxAccuracy,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-settings'] });
      messageApi.success('Đã lưu thông tin cửa hàng.');
    } catch (error) {
      messageApi.error(
        error instanceof ApiError ? error.message : 'Không thể lưu thông tin cửa hàng.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading) return <Spin fullscreen description="Đang tải thông tin cửa hàng" />;
  if (settings.isError || !settings.data) {
    return (
      <Alert
        type="error"
        showIcon
        title="Không thể tải thông tin cửa hàng"
        description="Vui lòng tải lại trang hoặc kiểm tra phiên Owner."
      />
    );
  }

  return (
    <div className="owner-store-settings-page">
      {contextHolder}
      <button className="owner-back-link" type="button" onClick={() => navigate('/owner/settings')}>
        <ArrowLeftOutlined /> Quay lại thiết lập cửa hàng
      </button>
      <div className="owner-store-settings-heading">
        <Typography.Title level={2}>Thông tin cửa hàng</Typography.Title>
        <Typography.Text type="secondary">
          Cập nhật thông tin chung và địa chỉ hiển thị của cửa hàng.
        </Typography.Text>
      </div>
      <Divider />
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
        <div className="owner-store-settings-layout">
          <aside className="owner-store-settings-intro">
            <Typography.Title level={4}>Thông tin chung</Typography.Title>
            <Typography.Paragraph type="secondary">
              Thông tin về cửa hàng, địa chỉ và lĩnh vực kinh doanh của bạn.
            </Typography.Paragraph>
            <Typography.Text type="secondary" italic>
              Mã cửa hàng: {settings.data.id.slice(0, 8).toUpperCase()}
            </Typography.Text>
            <div className="owner-store-settings-tip">
              <EnvironmentOutlined />
              <span>Tỉnh/thành phố và phường/xã được tải theo dữ liệu hành chính mới nhất.</span>
            </div>
          </aside>
          <Card className="owner-store-settings-card">
            <Form.Item
              label={
                <span>
                  Tên cửa hàng <b className="owner-required">(*)</b>
                </span>
              }
              name="name"
              rules={[{ required: true, message: 'Vui lòng nhập tên cửa hàng.' }]}
            >
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={160} showCount />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Số điện thoại cửa hàng"
                  name="phone"
                  normalize={normalizePhone}
                  rules={[
                    {
                      validator: async (_, value?: string) => {
                        const phone = normalizePhone(value);
                        if (!phone || VIETNAM_PHONE_REGEX.test(phone)) return;
                        throw new Error('Nhập số di động 10 số hoặc số bàn Việt Nam 10–11 số.');
                      },
                    },
                  ]}
                >
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Nhập số điện thoại"
                    maxLength={11}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="Đơn vị tiền tệ"
              name="currency"
              rules={[{ required: true, message: 'Vui lòng chọn đơn vị tiền tệ.' }]}
            >
              <Select
                options={[
                  { value: 'VND', label: 'VND (Việt Nam Đồng)' },
                  { value: 'USD', label: 'USD (Đô la Mỹ)' },
                ]}
              />
            </Form.Item>
          </Card>

          <aside className="owner-store-settings-intro">
            <Typography.Title level={4}>Địa chỉ</Typography.Title>
            <Typography.Paragraph type="secondary">
              Địa chỉ kinh doanh được in trên hóa đơn thanh toán cho khách hàng.
            </Typography.Paragraph>
          </aside>
          <Card className="owner-store-settings-card">
            <Form.Item
              label="Số nhà, tên đường"
              name="address"
              rules={[{ required: true, message: 'Vui lòng nhập địa chỉ chi tiết.' }]}
            >
              <Input
                prefix={<EnvironmentOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Ví dụ: 123 Đường Nguyễn Văn Cừ"
              />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Tỉnh / Thành phố"
                  name="provinceCode"
                  rules={[{ required: true, message: 'Vui lòng chọn tỉnh/thành phố.' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={provinces.isLoading}
                    placeholder="Chọn tỉnh/thành phố"
                    options={
                      provinces.data?.map((item) => ({ value: item.code, label: item.name })) ?? []
                    }
                    onChange={(value: number) => {
                      setProvinceCode(value);
                      form.setFieldValue('wardCode', undefined);
                    }}
                    notFoundContent={
                      provinces.isError ? 'Không tải được dữ liệu tỉnh/thành' : undefined
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Phường / Xã"
                  name="wardCode"
                  rules={[{ required: true, message: 'Vui lòng chọn phường/xã.' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={wards.isLoading}
                    disabled={provinceCode === undefined}
                    placeholder={
                      provinceCode === undefined ? 'Chọn tỉnh/thành phố trước' : 'Chọn phường/xã'
                    }
                    options={
                      wards.data?.map((item) => ({ value: item.code, label: item.name })) ?? []
                    }
                    notFoundContent={wards.isError ? 'Không tải được dữ liệu phường/xã' : undefined}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <aside className="owner-store-settings-intro">
            <Typography.Title level={4}>Thanh toán VietQR</Typography.Title>
            <Typography.Paragraph type="secondary">
              Quản lý các tài khoản nhận chuyển khoản và tài khoản được chọn mặc định tại quầy.
            </Typography.Paragraph>
          </aside>
          <Card className="owner-store-settings-card">
            <div className="owner-bank-accounts-heading">
              <div>
                <Typography.Text strong>Tài khoản ngân hàng</Typography.Text>
                <br />
                <Typography.Text type="secondary">
                  QR được tạo tự động theo tài khoản và số tiền thanh toán.
                </Typography.Text>
              </div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateBankAccount}>
                Thêm tài khoản
              </Button>
            </div>
            {settings.data.bankAccounts.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Chưa có tài khoản nhận chuyển khoản"
              />
            ) : (
              <div className="owner-bank-accounts-list">
                {settings.data.bankAccounts.map((account) => (
                  <div className="owner-bank-account-row" key={account.id}>
                    <div className="owner-bank-account-row__icon">
                      <BankOutlined />
                    </div>
                    <div className="owner-bank-account-row__content">
                      <div>
                        <strong>{account.bankCode || account.bankName}</strong>
                        {account.isDefault ? <Tag color="blue">Mặc định</Tag> : null}
                      </div>
                      <span>{account.accountNumber}</span>
                      <small>{account.accountName}</small>
                    </div>
                    <div className="owner-bank-account-row__actions">
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        aria-label="Sửa tài khoản"
                        onClick={() => openEditBankAccount(account)}
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label="Xóa tài khoản"
                        onClick={() => deleteBankAccount(account)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <aside className="owner-store-settings-intro">
            <Typography.Title level={4}>Vị trí cửa hàng & Xác minh QR Order</Typography.Title>
            <Typography.Paragraph type="secondary">
              Thiết lập tọa độ vị trí cửa hàng và bán kính cho phép khách hàng gọi món tại bàn qua
              QR.
            </Typography.Paragraph>
          </aside>
          <Card className="owner-store-settings-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  Xác minh vị trí khách hàng khi gọi món qua QR
                </Typography.Text>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Khách hàng chỉ có thể gửi món hoặc gửi yêu cầu khi đang có mặt trong phạm vi cho
                  phép của cửa hàng.
                </Typography.Text>
              </div>
              <Switch
                checked={locationVerificationEnabled}
                onChange={(checked) => {
                  setLocationVerificationEnabled(checked);
                  form.setFieldValue('locationVerificationEnabled', checked);
                }}
              />
            </div>

            {locationVerificationEnabled ? (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                <StoreLocationMapPicker
                  latitude={coords.latitude}
                  longitude={coords.longitude}
                  radiusMeters={allowedRadius}
                  maxAccuracyMeters={maxAccuracy}
                  initialAddress={settings.data.address}
                  onChange={(c) => {
                    setCoords(c);
                    form.setFieldsValue({ latitude: c.latitude, longitude: c.longitude });
                  }}
                  onRadiusChange={(r) => {
                    setAllowedRadius(r);
                    form.setFieldValue('allowedRadiusMeters', r);
                  }}
                  onMaxAccuracyChange={(a) => {
                    setMaxAccuracy(a);
                    form.setFieldValue('maxAccuracyMeters', a);
                  }}
                />
              </div>
            ) : null}
          </Card>

          <aside className="owner-store-settings-intro">
            <Typography.Title level={4}>Bảo mật tài khoản</Typography.Title>
            <Typography.Paragraph type="secondary">
              Quản lý mật khẩu đăng nhập của Chủ cửa hàng.
            </Typography.Paragraph>
          </aside>
          <Card className="owner-store-settings-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <Typography.Text strong>Mật khẩu Chủ cửa hàng</Typography.Text>
                <br />
                <Typography.Text type="secondary">
                  Dùng để đăng nhập vào trang quản trị và kích hoạt máy POS tại quầy.
                </Typography.Text>
              </div>
              <Button icon={<LockOutlined />} onClick={() => setPasswordModalOpen(true)}>
                Đổi mật khẩu
              </Button>
            </div>
          </Card>
        </div>

        <div className="owner-form-actions">
          <Button onClick={() => navigate('/owner/settings')}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
            Lưu
          </Button>
        </div>
      </Form>

      <Modal
        title={editingBankAccount ? 'Sửa tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng'}
        open={bankAccountModalOpen}
        okText={editingBankAccount ? 'Lưu thay đổi' : 'Thêm tài khoản'}
        cancelText="Hủy"
        confirmLoading={bankAccountSaving}
        onOk={() => bankAccountForm.submit()}
        onCancel={() => !bankAccountSaving && setBankAccountModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={bankAccountForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => void saveBankAccount(values)}
        >
          <Form.Item
            label="Ngân hàng"
            name="bankBin"
            rules={[{ required: true, message: 'Vui lòng chọn ngân hàng.' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={banks.isLoading}
              placeholder="Chọn ngân hàng"
              options={
                banks.data?.map((bank) => ({
                  value: bank.bin,
                  label: `${bank.shortName} - ${bank.name}`,
                })) ?? []
              }
            />
          </Form.Item>
          <Form.Item
            label="Số tài khoản"
            name="accountNumber"
            rules={[{ required: true, message: 'Vui lòng nhập số tài khoản.' }]}
          >
            <Input maxLength={64} placeholder="Nhập số tài khoản" />
          </Form.Item>
          <Form.Item
            label="Tên chủ tài khoản"
            name="accountName"
            normalize={(value) => (value || '').toUpperCase()}
            rules={[{ required: true, message: 'Vui lòng nhập tên chủ tài khoản.' }]}
          >
            <Input maxLength={160} placeholder="Ví dụ: NGUYEN VAN A" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked">
            <Checkbox disabled={Boolean(editingBankAccount?.isDefault)}>
              Tài khoản mặc định
            </Checkbox>
          </Form.Item>
          {editingBankAccount?.isDefault ? (
            <Typography.Text type="secondary">
              Hãy đặt tài khoản khác làm mặc định trước nếu muốn thay đổi trạng thái này.
            </Typography.Text>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="Đổi mật khẩu Chủ cửa hàng"
        open={passwordModalOpen}
        okText="Đổi mật khẩu"
        cancelText="Hủy"
        confirmLoading={passwordSaving}
        onOk={() => passwordForm.submit()}
        onCancel={() => !passwordSaving && setPasswordModalOpen(false)}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
          <Form.Item
            label="Mật khẩu hiện tại"
            name="currentPassword"
            rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại.' }]}
          >
            <Input.Password placeholder="Nhập mật khẩu hiện tại" />
          </Form.Item>
          <Form.Item
            label="Mật khẩu mới"
            name="newPassword"
            rules={[{ required: true, min: 6, message: 'Mật khẩu mới tối thiểu 6 ký tự.' }]}
          >
            <Input.Password placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
