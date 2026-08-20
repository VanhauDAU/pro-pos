import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  SaveOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

type ProductType = 'QUANTITY' | 'WEIGHT' | 'TIME';
type AvatarType = 'COLOR' | 'IMAGE';

interface Category {
  id: string;
  name: string;
  status?: 'ACTIVE' | 'DISABLED';
  productCount?: number;
}

interface Unit {
  id: string;
  name: string;
}

interface ProductSummary {
  id: string;
  name: string;
  productType: ProductType;
  status: 'ACTIVE' | 'DISABLED';
  categoryId: string | null;
  categoryName: string | null;
  unitId: string | null;
  unitName: string | null;
  avatarType: AvatarType;
  avatarColor: string | null;
  variantCount: number;
  minSalePriceVnd: number | null;
  maxSalePriceVnd: number | null;
}

interface ProductVariant {
  id: string;
  displayCode: string;
  name: string;
  salePriceVnd: number | null;
  costPriceVnd: number;
  promptPrice: number | boolean;
}

interface SpecialWindow {
  id?: string;
  name: string;
  priceVnd: number;
  startMinute: number;
  endMinute: number;
  weekdaysMask: number;
}

interface ProductDetail extends ProductSummary {
  description: string | null;
  variants: ProductVariant[];
  pricing: {
    basePriceVnd: number;
    baseDurationSeconds: number;
    calculationMode: 'ACTUAL_TIME' | 'TIME_BLOCK';
    roundingUnitVnd: number;
    firstPeriod: { enabled: false } | { enabled: true; durationSeconds: number; priceVnd: number };
    specialWindows: SpecialWindow[];
  } | null;
}

interface ProductFormValues {
  name: string;
  productType: ProductType;
  description?: string;
  categoryId?: string;
  unitId?: string;
  avatarType: AvatarType;
  avatarColor: string;
  variants: Array<{
    id?: string;
    name: string;
    salePriceVnd: number | null;
    costPriceVnd: number;
    promptPrice: boolean;
  }>;
  basePriceVnd?: number;
  baseDurationValue?: number;
  baseDurationUnit?: 'MINUTE' | 'HOUR' | 'DAY';
  calculationMode?: 'ACTUAL_TIME' | 'TIME_BLOCK';
  roundingUnitVnd?: number;
  firstPeriodEnabled?: boolean;
  firstPeriodDurationValue?: number;
  firstPeriodDurationUnit?: 'MINUTE' | 'HOUR' | 'DAY';
  firstPeriodPrice?: number;
}

const PRODUCT_QUERY = ['owner-products'] as const;
const CATEGORY_QUERY = ['owner-categories'] as const;

const productTypeLabels: Record<ProductType, string> = {
  QUANTITY: 'Tính tiền theo số lượng',
  WEIGHT: 'Tính tiền theo trọng lượng',
  TIME: 'Tính tiền theo thời gian',
};

const avatarColors = [
  '#facc15',
  '#f59e0b',
  '#fb923c',
  '#bef264',
  '#e879f9',
  '#a78bfa',
  '#60a5fa',
  '#818cf8',
  '#f87171',
  '#f472b6',
  '#14b8a6',
  '#6366f1',
  '#fdba74',
  '#38bdf8',
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function secondsToDuration(seconds: number) {
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: 'DAY' as const };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: 'HOUR' as const };
  return { value: Math.max(1, Math.round(seconds / 60)), unit: 'MINUTE' as const };
}

function durationToSeconds(value: number | undefined, unit: string | undefined) {
  const amount = value ?? 0;
  if (unit === 'DAY') return amount * 86400;
  if (unit === 'HOUR') return amount * 3600;
  return amount * 60;
}

function BackLink({ label, to }: { label: string; to: string }) {
  const navigate = useNavigate();
  return (
    <button className="owner-back-link" type="button" onClick={() => navigate(to)}>
      <ArrowLeftOutlined /> {label}
    </button>
  );
}

function ProductAvatar({
  product,
  size = 44,
}: {
  product: Pick<ProductSummary, 'name' | 'avatarColor' | 'avatarType'>;
  size?: number;
}) {
  return (
    <Avatar
      shape="square"
      size={size}
      src={product.avatarType === 'IMAGE' ? undefined : undefined}
      style={{
        background: product.avatarColor || '#facc15',
        color: '#172235',
        fontWeight: 700,
        borderRadius: 6,
      }}
    >
      {initials(product.name)}
    </Avatar>
  );
}

export function OwnerProductListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ACTIVE');
  const products = useQuery({
    queryKey: PRODUCT_QUERY,
    queryFn: () => apiRequest<ProductSummary[]>('/api/v1/owner/catalog/products'),
  });

  const rows = useMemo(() => {
    const value = search.trim().toLowerCase();
    return (products.data ?? []).filter((product) => {
      const matchesSearch = !value || product.name.toLowerCase().includes(value);
      const matchesType = typeFilter === 'ALL' || product.productType === typeFilter;
      const matchesStatus = statusFilter === 'ALL' || product.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [products.data, search, statusFilter, typeFilter]);

  const disableProduct = async (product: ProductSummary) => {
    const context = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
    try {
      await apiRequest(`/api/v1/owner/catalog/products/${product.id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': context.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY });
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      messageApi.success('Đã ngừng kinh doanh mặt hàng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể ngừng kinh doanh mặt hàng.'));
    }
  };

  const columns: TableColumnsType<ProductSummary> = [
    {
      title: 'Mặt hàng',
      key: 'name',
      render: (_, product) => (
        <Space>
          <ProductAvatar product={product} />
          <div>
            <Button
              type="link"
              className="owner-catalog-name-link"
              onClick={() => navigate(`/owner/catalog/products/${product.id}`)}
            >
              {product.name}
            </Button>
            <Typography.Text type="secondary" className="owner-catalog-code">
              {productTypeLabels[product.productType]}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    { title: 'Đơn vị', dataIndex: 'unitName', key: 'unitName', render: (value) => value || '—' },
    {
      title: 'Danh mục',
      dataIndex: 'categoryName',
      key: 'categoryName',
      render: (value) => value || 'Chưa phân loại',
    },
    {
      title: 'Giá thành',
      key: 'price',
      align: 'right',
      render: (_, product) =>
        product.productType === 'TIME'
          ? 'Theo thời gian'
          : product.minSalePriceVnd === product.maxSalePriceVnd
            ? formatMoney(product.minSalePriceVnd)
            : `${product.variantCount} giá`,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      render: (value) => (
        <Tag color={value === 'ACTIVE' ? 'success' : 'default'}>
          {value === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}
        </Tag>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      align: 'right',
      render: (_, product) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => navigate(`/owner/catalog/products/${product.id}`)}
          >
            Sửa
          </Button>
          {product.status === 'ACTIVE' ? (
            <Popconfirm
              title="Ngừng kinh doanh mặt hàng này?"
              onConfirm={() => disableProduct(product)}
              okText="Ngừng bán"
              cancelText="Hủy"
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                Ngừng bán
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="owner-catalog-page">
      {contextHolder}
      <div className="owner-catalog-heading">
        <div>
          <Typography.Title level={2}>Danh sách mặt hàng</Typography.Title>
          <Typography.Text type="secondary">
            Quản lý sản phẩm, dịch vụ và bảng giá dùng trên POS.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/owner/catalog/products/new')}
        >
          Thêm mặt hàng
        </Button>
      </div>
      <div className="owner-catalog-subnav">
        <Button
          type="link"
          icon={<TagsOutlined />}
          onClick={() => navigate('/owner/catalog/categories')}
        >
          Danh mục
        </Button>
      </div>
      <Card className="owner-catalog-card">
        <div className="owner-catalog-toolbar">
          <Input
            prefix={<SearchOutlined />}
            placeholder="Tìm kiếm mặt hàng"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'ALL', label: 'Tất cả loại' },
              ...Object.entries(productTypeLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ACTIVE', label: 'Đang bán' },
              { value: 'DISABLED', label: 'Ngừng bán' },
              { value: 'ALL', label: 'Tất cả trạng thái' },
            ]}
          />
        </div>
        {products.isLoading ? (
          <Skeleton active />
        ) : products.isError ? (
          <Alert type="error" showIcon title="Không thể tải danh sách mặt hàng" />
        ) : rows.length === 0 ? (
          <Empty description="Chưa có mặt hàng phù hợp" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 920 }}
          />
        )}
      </Card>
    </div>
  );
}

export function OwnerProductFormPage({ productId }: { productId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ProductFormValues>();
  const [productType, setProductType] = useState<ProductType>('QUANTITY');
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(productId);
  const detail = useQuery({
    queryKey: ['owner-product', productId],
    queryFn: () => apiRequest<ProductDetail>(`/api/v1/owner/catalog/products/${productId}`),
    enabled: isEdit,
  });
  const categories = useQuery({
    queryKey: CATEGORY_QUERY,
    queryFn: () => apiRequest<Category[]>('/api/v1/owner/catalog/categories'),
  });
  const units = useQuery({
    queryKey: ['owner-units'],
    queryFn: () => apiRequest<Unit[]>('/api/v1/owner/catalog/units'),
  });
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const firstPeriodEnabled = Form.useWatch('firstPeriodEnabled', form);

  useEffect(() => {
    if (!detail.data) {
      if (!isEdit) {
        form.setFieldsValue({
          productType: 'QUANTITY',
          avatarType: 'COLOR',
          avatarColor: avatarColors[0] ?? '#facc15',
          variants: [
            { name: 'Giá mặc định', salePriceVnd: 0, costPriceVnd: 0, promptPrice: false },
          ],
          calculationMode: 'ACTUAL_TIME',
          roundingUnitVnd: 1000,
          firstPeriodEnabled: false,
        });
      }
      return;
    }
    const product = detail.data;
    const duration = product.pricing
      ? secondsToDuration(product.pricing.baseDurationSeconds)
      : undefined;
    const first = product.pricing?.firstPeriod.enabled
      ? secondsToDuration(product.pricing.firstPeriod.durationSeconds)
      : undefined;
    setProductType(product.productType);
    form.setFieldsValue({
      name: product.name,
      productType: product.productType,
      avatarType: product.avatarType,
      avatarColor: product.avatarColor || avatarColors[0] || '#facc15',
      variants: product.variants.map((variant) => ({
        ...variant,
        promptPrice: Boolean(variant.promptPrice),
      })),
      calculationMode: product.pricing?.calculationMode ?? 'ACTUAL_TIME',
      roundingUnitVnd: product.pricing?.roundingUnitVnd ?? 1000,
      firstPeriodEnabled: product.pricing?.firstPeriod.enabled ?? false,
      ...(product.description ? { description: product.description } : {}),
      ...(product.categoryId ? { categoryId: product.categoryId } : {}),
      ...(product.unitId ? { unitId: product.unitId } : {}),
      ...(product.pricing?.basePriceVnd !== undefined
        ? { basePriceVnd: product.pricing.basePriceVnd }
        : {}),
      ...(duration ? { baseDurationValue: duration.value, baseDurationUnit: duration.unit } : {}),
      ...(first
        ? { firstPeriodDurationValue: first.value, firstPeriodDurationUnit: first.unit }
        : {}),
      ...(product.pricing?.firstPeriod.enabled
        ? { firstPeriodPrice: product.pricing.firstPeriod.priceVnd }
        : {}),
    });
  }, [detail.data, form, isEdit]);

  const save = async (values: ProductFormValues) => {
    setSaving(true);
    try {
      const payload = {
        name: values.name,
        description: values.description || null,
        productType: values.productType,
        categoryId: values.categoryId || null,
        unitId: values.productType === 'TIME' ? null : values.unitId || null,
        avatarType: values.avatarType,
        avatarColor: values.avatarType === 'COLOR' ? values.avatarColor : null,
        variants:
          values.productType === 'TIME'
            ? []
            : (values.variants ?? []).map((variant) => ({
                ...(variant.id ? { id: variant.id } : {}),
                name: variant.name,
                salePriceVnd: variant.promptPrice ? null : variant.salePriceVnd,
                costPriceVnd: variant.costPriceVnd ?? 0,
                promptPrice: Boolean(variant.promptPrice),
              })),
      };
      const saved = await jsonRequest<{ id: string }>(
        isEdit ? `/api/v1/owner/catalog/products/${productId}` : '/api/v1/owner/catalog/products',
        payload,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      const savedId = saved.id || productId;
      if (values.productType === 'TIME' && savedId) {
        const existingWindows = detail.data?.pricing?.specialWindows ?? [];
        await jsonRequest(
          '/api/v1/owner/catalog/pricing',
          {
            productId: savedId,
            basePriceVnd: values.basePriceVnd,
            baseDurationSeconds: durationToSeconds(
              values.baseDurationValue,
              values.baseDurationUnit,
            ),
            calculationMode: values.calculationMode,
            roundingUnitVnd: values.roundingUnitVnd,
            firstPeriod: values.firstPeriodEnabled
              ? {
                  enabled: true,
                  durationSeconds: durationToSeconds(
                    values.firstPeriodDurationValue,
                    values.firstPeriodDurationUnit,
                  ),
                  priceVnd: values.firstPeriodPrice,
                }
              : { enabled: false },
            specialWindows: existingWindows.map(({ id: _id, ...window }) => window),
          },
          { method: 'PUT', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
        );
      }
      await queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY });
      messageApi.success(isEdit ? 'Đã cập nhật mặt hàng.' : 'Đã thêm mặt hàng.');
      navigate('/owner/catalog/products');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể lưu mặt hàng.'));
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && detail.isLoading) return <Skeleton active />;
  if (isEdit && detail.isError)
    return <Alert type="error" showIcon title="Không thể tải mặt hàng" />;

  return (
    <div className="owner-catalog-form-page">
      {contextHolder}
      <BackLink label="Quay lại danh sách mặt hàng" to="/owner/catalog/products" />
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>
            {isEdit ? 'Chi tiết mặt hàng' : 'Thêm mặt hàng'}
          </Typography.Title>
          <Typography.Text type="secondary">
            Thông tin cốt lõi để mặt hàng xuất hiện trên POS.
          </Typography.Text>
        </div>
        <Button onClick={() => navigate('/owner/catalog/products')}>Hủy</Button>
      </div>
      <Form
        form={form}
        layout="vertical"
        onFinish={save}
        requiredMark={false}
        className="owner-catalog-form"
      >
        <Row gutter={[20, 20]}>
          <Col xs={24} xl={16}>
            <Card title="Thông tin chung">
              <Form.Item
                label="Tên mặt hàng"
                name="name"
                rules={[{ required: true, message: 'Vui lòng nhập tên mặt hàng.' }]}
              >
                <Input placeholder="Ví dụ: Coca Cola, Trà đào, Giờ Pool" maxLength={160} />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label="Loại mặt hàng" name="productType" rules={[{ required: true }]}>
                    <Select
                      options={Object.entries(productTypeLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={(value: ProductType) => {
                        setProductType(value);
                        form.setFieldValue('productType', value);
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Danh mục" name="categoryId">
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn danh mục"
                      options={(categories.data ?? [])
                        .filter((category) => category.status !== 'DISABLED')
                        .map((category) => ({ value: category.id, label: category.name }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {productType !== 'TIME' ? (
                <Form.Item label="Mô tả" name="description">
                  <Input.TextArea
                    rows={4}
                    maxLength={1000}
                    showCount
                    placeholder="Mô tả ngắn về mặt hàng"
                  />
                </Form.Item>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  title="Mặt hàng tính theo thời gian"
                  description="Giá sẽ được tính theo thời gian sử dụng thực tế hoặc theo block."
                />
              )}
            </Card>
            {productType !== 'TIME' ? (
              <Card title="Phiên bản giá" className="owner-catalog-form-card">
                <Form.List name="variants">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((field, index) => (
                        <div className="owner-variant-row" key={field.key}>
                          <Form.Item
                            {...field}
                            label={index === 0 ? 'Tên giá' : undefined}
                            name={[field.name, 'name']}
                            rules={[{ required: true, message: 'Nhập tên giá.' }]}
                          >
                            <Input
                              placeholder={index === 0 ? 'Giá mặc định' : 'Size M, Size L...'}
                            />
                          </Form.Item>
                          <Form.Item
                            noStyle
                            shouldUpdate={(previous, current) =>
                              previous.variants?.[field.name]?.promptPrice !==
                              current.variants?.[field.name]?.promptPrice
                            }
                          >
                            {({ getFieldValue }) => {
                              const promptPrice = Boolean(
                                getFieldValue(['variants', field.name, 'promptPrice']),
                              );
                              return (
                                <Form.Item
                                  label={index === 0 ? 'Giá bán' : undefined}
                                  name={[field.name, 'salePriceVnd']}
                                  rules={
                                    promptPrice
                                      ? []
                                      : [{ required: true, message: 'Nhập giá bán.' }]
                                  }
                                >
                                  <InputNumber
                                    min={0}
                                    disabled={promptPrice}
                                    className="owner-full-width"
                                    addonAfter="đ"
                                  />
                                </Form.Item>
                              );
                            }}
                          </Form.Item>
                          <Form.Item
                            label={index === 0 ? 'Giá vốn' : undefined}
                            name={[field.name, 'costPriceVnd']}
                          >
                            <InputNumber min={0} className="owner-full-width" addonAfter="đ" />
                          </Form.Item>
                          <Form.Item
                            label={index === 0 ? 'Nhập giá khi bán' : undefined}
                            name={[field.name, 'promptPrice']}
                            valuePropName="checked"
                          >
                            <Checkbox />
                          </Form.Item>
                          {fields.length > 1 ? (
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label="Xóa phiên bản giá"
                              onClick={() => remove(field.name)}
                            />
                          ) : null}
                        </div>
                      ))}
                      <Button
                        type="link"
                        icon={<PlusOutlined />}
                        onClick={() =>
                          add({
                            name: `Giá ${fields.length + 1}`,
                            salePriceVnd: 0,
                            costPriceVnd: 0,
                            promptPrice: false,
                          })
                        }
                      >
                        Thêm giá
                      </Button>
                    </>
                  )}
                </Form.List>
                <Form.Item
                  label="Đơn vị"
                  name="unitId"
                  rules={[{ required: true, message: 'Vui lòng chọn đơn vị.' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Chọn đơn vị"
                    options={(units.data ?? []).map((unit) => ({
                      value: unit.id,
                      label: unit.name,
                    }))}
                  />
                </Form.Item>
              </Card>
            ) : (
              <Card title="Giá bán theo thời gian" className="owner-catalog-form-card">
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item
                      label="Giá bán thường"
                      name="basePriceVnd"
                      rules={[{ required: true, message: 'Nhập giá bán.' }]}
                    >
                      <InputNumber min={1} className="owner-full-width" addonAfter="đ" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Áp dụng mỗi khoảng thời gian" required>
                      <Space.Compact block>
                        <Form.Item
                          name="baseDurationValue"
                          noStyle
                          rules={[{ required: true, message: 'Nhập khoảng thời gian.' }]}
                        >
                          <InputNumber min={1} placeholder="1" />
                        </Form.Item>
                        <Form.Item name="baseDurationUnit" noStyle initialValue="HOUR">
                          <Select
                            options={[
                              { value: 'MINUTE', label: 'Phút' },
                              { value: 'HOUR', label: 'Giờ' },
                              { value: 'DAY', label: 'Ngày' },
                            ]}
                          />
                        </Form.Item>
                      </Space.Compact>
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item label="Cách tính thời gian" name="calculationMode">
                  <Radio.Group
                    options={[
                      { value: 'ACTUAL_TIME', label: 'Theo thời gian thực tế' },
                      { value: 'TIME_BLOCK', label: 'Theo block thời gian' },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Làm tròn thành tiền" name="roundingUnitVnd">
                  <Select
                    options={[
                      { value: 0, label: 'Không làm tròn' },
                      { value: 100, label: 'Đến 100đ' },
                      { value: 500, label: 'Đến 500đ' },
                      { value: 1000, label: 'Đến 1.000đ' },
                      { value: 5000, label: 'Đến 5.000đ' },
                    ]}
                  />
                </Form.Item>
                <div className="owner-setting-line">
                  <div>
                    <Typography.Text strong>Giờ đầu tiên</Typography.Text>
                    <Typography.Text type="secondary">
                      Giá riêng cho khoảng thời gian đầu tiên
                    </Typography.Text>
                  </div>
                  <Form.Item name="firstPeriodEnabled" valuePropName="checked" noStyle>
                    <Switch />
                  </Form.Item>
                </div>
                {firstPeriodEnabled ? (
                  <Row gutter={16} className="owner-inline-settings">
                    <Col xs={24} md={8}>
                      <Form.Item
                        label="Thời lượng đầu tiên"
                        name="firstPeriodDurationValue"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} className="owner-full-width" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Đơn vị" name="firstPeriodDurationUnit">
                        <Select
                          options={[
                            { value: 'MINUTE', label: 'Phút' },
                            { value: 'HOUR', label: 'Giờ' },
                            { value: 'DAY', label: 'Ngày' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        label="Giá bán"
                        name="firstPeriodPrice"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} className="owner-full-width" addonAfter="đ" />
                      </Form.Item>
                    </Col>
                  </Row>
                ) : null}
                <Alert
                  type="info"
                  showIcon
                  title="Giờ đặc biệt sẽ được giữ lại khi sửa"
                  description="Màn hình cấu hình giờ đặc biệt sẽ bổ sung ở ticket tiếp theo; dữ liệu hiện có không bị xóa khi bạn sửa giá cơ bản."
                />
              </Card>
            )}
          </Col>
          <Col xs={24} xl={8}>
            <Card title="Hình đại diện">
              <Form.Item name="avatarType">
                <Radio.Group
                  options={[
                    { value: 'COLOR', label: 'Màu sắc' },
                    { value: 'IMAGE', label: 'Hình ảnh' },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, next) => prev.avatarType !== next.avatarType}>
                {({ getFieldValue }) =>
                  getFieldValue('avatarType') === 'IMAGE' ? (
                    <Alert
                      type="info"
                      showIcon
                      title="Upload hình ảnh sẽ bổ sung sau"
                      description="Tạm thời dùng avatar màu để đảm bảo mặt hàng hiển thị rõ trên POS."
                    />
                  ) : (
                    <Form.Item name="avatarColor">
                      <Radio.Group className="owner-avatar-grid">
                        {avatarColors.map((color) => (
                          <Radio.Button
                            key={color}
                            value={color}
                            style={{ background: color }}
                            aria-label={`Màu ${color}`}
                          >
                            <span />
                          </Radio.Button>
                        ))}
                      </Radio.Group>
                    </Form.Item>
                  )
                }
              </Form.Item>
            </Card>
            <Card title="Danh mục" className="owner-catalog-form-card">
              <Form.Item name="categoryId" noStyle>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Chọn danh mục"
                  options={(categories.data ?? [])
                    .filter((category) => category.status !== 'DISABLED')
                    .map((category) => ({ value: category.id, label: category.name }))}
                />
              </Form.Item>
            </Card>
            <Card className="owner-catalog-form-card">
              <Typography.Text type="secondary">
                Mã mặt hàng sẽ được hệ thống tự sinh khi lưu phiên bản giá.
              </Typography.Text>
            </Card>
          </Col>
        </Row>
        <div className="owner-form-actions">
          <Button onClick={() => navigate('/owner/catalog/products')}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
            Lưu mặt hàng
          </Button>
        </div>
      </Form>
    </div>
  );
}

export function OwnerCategoryListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const categories = useQuery({
    queryKey: CATEGORY_QUERY,
    queryFn: () => apiRequest<Category[]>('/api/v1/owner/catalog/categories'),
  });
  const rows = (categories.data ?? []).filter(
    (category) =>
      category.status !== 'DISABLED' &&
      category.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const create = async ({ name }: { name: string }) => {
    const context = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
    try {
      await jsonRequest(
        '/api/v1/owner/catalog/categories',
        { name },
        { headers: { 'X-CSRF-Token': context.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      setOpen(false);
      form.resetFields();
      messageApi.success('Đã tạo danh mục.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể tạo danh mục.'));
    }
  };
  return (
    <div className="owner-catalog-page">
      {contextHolder}
      <BackLink label="Quay lại mặt hàng" to="/owner/catalog/products" />
      <div className="owner-catalog-heading">
        <div>
          <Typography.Title level={2}>Danh mục</Typography.Title>
          <Typography.Text type="secondary">
            Nhóm các mặt hàng để tìm nhanh trên POS.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Tạo danh mục
        </Button>
      </div>
      <Card className="owner-catalog-card">
        <Input
          prefix={<SearchOutlined />}
          placeholder="Tìm kiếm danh mục"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
          className="owner-category-search"
        />
        {categories.isLoading ? (
          <Skeleton active />
        ) : rows.length === 0 ? (
          <Empty description="Chưa có danh mục" />
        ) : (
          <Table
            rowKey="id"
            pagination={{ pageSize: 10, showSizeChanger: false }}
            dataSource={rows}
            columns={[
              {
                title: 'Danh mục',
                dataIndex: 'name',
                render: (name, category) => (
                  <Button
                    type="link"
                    onClick={() => navigate(`/owner/catalog/categories/${category.id}`)}
                  >
                    {name}
                  </Button>
                ),
              },
              {
                title: 'Số lượng mặt hàng',
                dataIndex: 'productCount',
                align: 'right',
                render: (count) => count ?? 0,
              },
              {
                title: 'Thao tác',
                align: 'right',
                render: (_, category) => (
                  <Button
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/owner/catalog/categories/${category.id}`)}
                  >
                    Xem và sửa
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title="Tạo danh mục"
        open={open}
        onCancel={() => setOpen(false)}
        okText="Tạo danh mục"
        cancelText="Hủy"
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={create}>
          <Form.Item
            name="name"
            label="Tên danh mục"
            rules={[{ required: true, message: 'Vui lòng nhập tên danh mục.' }]}
          >
            <Input autoFocus maxLength={160} placeholder="Ví dụ: Đồ uống" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function OwnerCategoryDetailPage({ categoryId }: { categoryId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const categories = useQuery({
    queryKey: CATEGORY_QUERY,
    queryFn: () => apiRequest<Category[]>('/api/v1/owner/catalog/categories'),
  });
  const products = useQuery({
    queryKey: ['owner-category-products', categoryId, search],
    queryFn: () =>
      apiRequest<ProductSummary[]>(
        `/api/v1/owner/catalog/categories/${categoryId}/products?q=${encodeURIComponent(search)}`,
      ),
  });
  const category = categories.data?.find((item) => item.id === categoryId);
  useEffect(() => {
    if (category) setName(category.name);
  }, [category]);
  const save = async () => {
    setSaving(true);
    try {
      const context = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
      await jsonRequest(
        `/api/v1/owner/catalog/categories/${categoryId}`,
        { name },
        { method: 'PUT', headers: { 'X-CSRF-Token': context.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      messageApi.success('Đã cập nhật danh mục.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật danh mục.'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      const context = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
      await apiRequest(`/api/v1/owner/catalog/categories/${categoryId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': context.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      messageApi.success('Đã xóa danh mục.');
      navigate('/owner/catalog/categories');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể xóa danh mục.'));
    }
  };
  if (!category && categories.isLoading) return <Skeleton active />;
  if (!category) return <Alert type="error" showIcon title="Không tìm thấy danh mục" />;
  return (
    <div className="owner-catalog-page">
      {contextHolder}
      <BackLink label="Quay lại danh mục" to="/owner/catalog/categories" />
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>Chi tiết danh mục</Typography.Title>
          <Typography.Text type="secondary">
            Chỉnh sửa tên và xem các mặt hàng thuộc danh mục.
          </Typography.Text>
        </div>
        <Space>
          <Popconfirm
            title="Xóa danh mục này?"
            description="Chỉ xóa được danh mục không còn mặt hàng đang bán."
            onConfirm={remove}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button danger icon={<DeleteOutlined />}>
              Xóa
            </Button>
          </Popconfirm>
          <Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={save}>
            Lưu
          </Button>
        </Space>
      </div>
      <Row gutter={[20, 20]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="Số lượng mặt hàng"
              value={category.productCount ?? 0}
              prefix={<AppstoreOutlined />}
            />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              className="owner-category-name-input"
            />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="Mặt hàng trong danh mục">
            <Input
              prefix={<SearchOutlined />}
              placeholder="Tìm kiếm mặt hàng"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
              className="owner-category-search"
            />
            {products.isLoading ? (
              <Skeleton active />
            ) : products.data?.length ? (
              <Table
                rowKey="id"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                dataSource={products.data}
                columns={[
                  {
                    title: 'Mặt hàng',
                    dataIndex: 'name',
                    render: (value, product) => (
                      <Space>
                        <ProductAvatar product={product} size={32} />
                        <Button
                          type="link"
                          onClick={() => navigate(`/owner/catalog/products/${product.id}`)}
                        >
                          {value}
                        </Button>
                      </Space>
                    ),
                  },
                  {
                    title: 'Loại',
                    dataIndex: 'productType',
                    render: (value) => productTypeLabels[value as ProductType],
                  },
                  {
                    title: 'Giá',
                    dataIndex: 'variantCount',
                    align: 'right',
                    render: (value) => (value === 1 ? '1 giá' : `${value} giá`),
                  },
                ]}
              />
            ) : (
              <Empty description="Danh mục chưa có mặt hàng" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
