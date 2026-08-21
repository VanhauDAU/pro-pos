import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  LockOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Spin,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import { VIETNAM_PHONE_REGEX } from '@contracts/store';

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
  provinceCode: number | null;
  provinceName: string | null;
  wardCode: number | null;
  wardName: string | null;
}

interface StoreFormValues {
  name: string;
  phone: string;
  currency: string;
  address: string;
  provinceCode: number;
  wardCode: number;
  bankName?: string | undefined;
  bankAccountNumber?: string | undefined;
  bankAccountName?: string | undefined;
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
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

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
    form.setFieldsValue({
      name: data.name,
      phone: normalizePhone(data.phone),
      currency: data.currency || 'VND',
      address: data.address ?? '',
      ...(data.provinceCode === null ? {} : { provinceCode: data.provinceCode }),
      ...(data.wardCode === null ? {} : { wardCode: data.wardCode }),
      bankName: data.bankName ?? undefined,
      bankAccountNumber: data.bankAccountNumber ?? undefined,
      bankAccountName: data.bankAccountName ?? undefined,
    });
  }, [form, settings.data]);

  const save = async (values: StoreFormValues) => {
    const province = provinces.data?.find((item) => item.code === values.provinceCode);
    const ward = wards.data?.find((item) => item.code === values.wardCode);
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
          bankName: values.bankName || null,
          bankAccountNumber: values.bankAccountNumber || null,
          bankAccountName: values.bankAccountName || null,
          bankQrMediaId: settings.data?.bankQrMediaId ?? null,
          provinceCode: province?.code ?? null,
          provinceName: province?.name ?? null,
          wardCode: ward?.code ?? null,
          wardName: ward?.name ?? null,
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
              Cấu hình ngân hàng nhận tiền để in mã VietQR trên hóa đơn bán hàng.
            </Typography.Paragraph>
          </aside>
          <Card className="owner-store-settings-card">
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item label="Ngân hàng" name="bankName">
                  <Select
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    loading={banks.isLoading}
                    placeholder="Chọn ngân hàng"
                    options={
                      banks.data?.map((b) => ({
                        value: b.bin,
                        label: `${b.shortName} - ${b.name}`,
                      })) ?? []
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Số tài khoản" name="bankAccountNumber">
                  <Input placeholder="Nhập số tài khoản" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="Tên chủ tài khoản"
              name="bankAccountName"
              normalize={(value) => (value || '').toUpperCase()}
            >
              <Input placeholder="Ví dụ: NGUYEN VAN A" />
            </Form.Item>
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
