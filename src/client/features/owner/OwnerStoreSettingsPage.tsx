import { ArrowLeftOutlined, EnvironmentOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Spin,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import { ApiError, apiRequest } from '@client/lib/api';

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

  useEffect(() => {
    if (!settings.data) return;
    const data = settings.data;
    setProvinceCode(data.provinceCode ?? undefined);
    form.setFieldsValue({
      name: data.name,
      phone: data.phone ?? '',
      currency: data.currency || 'VND',
      address: data.address ?? '',
      ...(data.provinceCode === null ? {} : { provinceCode: data.provinceCode }),
      ...(data.wardCode === null ? {} : { wardCode: data.wardCode }),
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
          bankName: settings.data?.bankName ?? null,
          bankAccountNumber: settings.data?.bankAccountNumber ?? null,
          bankAccountName: settings.data?.bankAccountName ?? null,
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
          <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
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
                <Form.Item label="Số điện thoại cửa hàng" name="phone">
                  <Input placeholder="Nhập số điện thoại" maxLength={32} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label={
                    <span>
                      Đơn vị tiền tệ <b className="owner-required">(*)</b>
                    </span>
                  }
                  name="currency"
                >
                  <Select options={[{ value: 'VND', label: 'Việt Nam đồng (VND)' }]} disabled />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label={
                <span>
                  Địa chỉ <b className="owner-required">(*)</b>
                </span>
              }
              name="address"
              rules={[{ required: true, message: 'Vui lòng nhập địa chỉ.' }]}
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={500}
                showCount
                placeholder="Số nhà, đường, thôn/tổ..."
              />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label={
                    <span>
                      Tỉnh / Thành phố <b className="owner-required">(*)</b>
                    </span>
                  }
                  name="provinceCode"
                  rules={[{ required: true, message: 'Vui lòng chọn tỉnh/thành phố.' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={provinces.isLoading}
                    placeholder="Chọn tỉnh/thành phố"
                    options={
                      provinces.data?.map((item) => ({
                        value: item.code,
                        label: item.name,
                      })) ?? []
                    }
                    onChange={(value: number) => {
                      setProvinceCode(value);
                      form.resetFields(['wardCode']);
                    }}
                    notFoundContent={
                      provinces.isError ? 'Không tải được dữ liệu tỉnh/thành phố' : undefined
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label={
                    <span>
                      Phường / Xã <b className="owner-required">(*)</b>
                    </span>
                  }
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
            <div className="owner-form-actions">
              <Button onClick={() => navigate('/owner/settings')}>Hủy</Button>
              <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
                Lưu
              </Button>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
}
