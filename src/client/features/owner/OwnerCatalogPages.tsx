import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  SaveOutlined,
  TagsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
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
import type { ReactNode } from 'react';
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
  mediaId: string | null;
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

interface SpecialWindowForm {
  id?: string;
  name: string;
  priceVnd: number;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  weekdays: number[];
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
  mediaId?: string;
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
  specialWindows?: SpecialWindowForm[];
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

function minuteToTime(value: number) {
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string | undefined) {
  const [hours = 0, minutes = 0] = (value ?? '').split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 0;
  return Math.min(1439, Math.max(0, hours * 60 + minutes));
}

function weekdaysToMask(days: number[] | undefined) {
  return (days ?? []).reduce((mask, day) => mask | (1 << day), 0);
}

function maskToWeekdays(mask: number) {
  return Array.from({ length: 7 }, (_, day) => day).filter((day) => (mask & (1 << day)) !== 0);
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
  product: Pick<ProductSummary, 'name' | 'avatarColor' | 'avatarType' | 'mediaId'>;
  size?: number;
}) {
  return (
    <Avatar
      shape="square"
      size={size}
      src={
        product.avatarType === 'IMAGE' && product.mediaId
          ? `/api/v1/media/${product.mediaId}`
          : undefined
      }
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

  const restoreProduct = async (product: ProductSummary) => {
    const context = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
    try {
      await apiRequest(`/api/v1/owner/catalog/products/${product.id}/restore`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': context.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY });
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      messageApi.success('Đã khôi phục mặt hàng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể khôi phục mặt hàng.'));
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
          ) : (
            <Popconfirm
              title="Khôi phục mặt hàng này?"
              onConfirm={() => restoreProduct(product)}
              okText="Khôi phục"
              cancelText="Hủy"
            >
              <Button type="link" icon={<SaveOutlined />}>
                Khôi phục
              </Button>
            </Popconfirm>
          )}
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
  const [uploading, setUploading] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryForm] = Form.useForm<{ name: string }>();
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

  const createCategory = async ({ name }: { name: string }) => {
    try {
      const result = await jsonRequest<{ id: string }>(
        '/api/v1/owner/catalog/categories',
        { name },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      form.setFieldValue('categoryId', result.id);
      setCategoryModalOpen(false);
      categoryForm.resetFields();
      setCategorySearch('');
      messageApi.success('Đã thêm danh mục và chọn vào mặt hàng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể thêm danh mục.'));
    }
  };

  const categoryDropdown = (menu: ReactNode) => (
    <>
      {menu}
      <Divider style={{ margin: '8px 0' }} />
      <Button
        type="link"
        block
        disabled={!categorySearch.trim()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          categoryForm.setFieldValue('name', categorySearch.trim());
          setCategoryModalOpen(true);
        }}
      >
        <PlusOutlined /> Thêm danh mục{categorySearch.trim() ? ` “${categorySearch.trim()}”` : ''}
      </Button>
    </>
  );

  useEffect(() => {
    if (!detail.data) {
      if (!isEdit) {
        form.setFieldsValue({
          productType: 'QUANTITY',
          avatarType: 'COLOR',
          avatarColor: avatarColors[0] ?? '#facc15',
          specialWindows: [],
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
      ...(product.mediaId ? { mediaId: product.mediaId } : {}),
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
      specialWindows: (product.pricing?.specialWindows ?? []).map((window) => {
        const item = {
          name: window.name,
          priceVnd: window.priceVnd,
          allDay: window.startMinute === window.endMinute,
          startTime: minuteToTime(window.startMinute),
          endTime: minuteToTime(window.endMinute),
          weekdays: maskToWeekdays(window.weekdaysMask),
        };
        return window.id ? { id: window.id, ...item } : item;
      }),
    });
  }, [detail.data, form, isEdit]);

  const uploadImage = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      messageApi.error('Chỉ hỗ trợ PNG, JPEG hoặc WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      messageApi.error('Ảnh không được vượt quá 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/v1/media', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': authContext.data?.csrfToken ?? '',
        },
        body,
      });
      const payload = (await response.json()) as {
        data?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? 'Không thể tải ảnh.');
      form.setFieldValue('mediaId', payload.data.id);
      form.setFieldValue('avatarType', 'IMAGE');
      messageApi.success('Đã tải ảnh đại diện.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể tải ảnh đại diện.'));
    } finally {
      setUploading(false);
    }
  };

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
        mediaId: values.avatarType === 'IMAGE' ? values.mediaId || null : null,
        variants:
          values.productType === 'TIME'
            ? []
            : (values.variants ?? []).map((variant) => {
                const item: {
                  id?: string;
                  name: string;
                  salePriceVnd: number | null;
                  costPriceVnd: number;
                  promptPrice: boolean;
                } = {
                  name: variant.name,
                  salePriceVnd: variant.promptPrice ? null : variant.salePriceVnd,
                  costPriceVnd: variant.costPriceVnd ?? 0,
                  promptPrice: Boolean(variant.promptPrice),
                };
                if (variant.id) item.id = variant.id;
                return item;
              }),
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
        const windows = (values.specialWindows ?? []).filter((window) => window.name?.trim());
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
            specialWindows: windows.map((window) => ({
              name: window.name.trim(),
              priceVnd: window.priceVnd,
              startMinute: window.allDay ? 0 : timeToMinute(window.startTime),
              endMinute: window.allDay ? 0 : timeToMinute(window.endTime),
              weekdaysMask: weekdaysToMask(window.weekdays),
            })),
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
            <Card title="Thông tin chung" className="owner-catalog-form-card">
              <Form.Item
                label="Tên mặt hàng"
                name="name"
                rules={[{ required: true, message: 'Vui lòng nhập tên mặt hàng.' }]}
              >
                <Input
                  placeholder="Ví dụ: Coca Cola, Trà đào, Giờ Pool"
                  maxLength={160}
                  size="large"
                />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={productType !== 'TIME' ? 8 : 12}>
                  <Form.Item label="Loại mặt hàng" name="productType" rules={[{ required: true }]}>
                    <Select
                      size="large"
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
                <Col xs={24} md={productType !== 'TIME' ? 8 : 12}>
                  <Form.Item label="Danh mục" name="categoryId">
                    <Select
                      size="large"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn danh mục"
                      searchValue={categorySearch}
                      onSearch={setCategorySearch}
                      onChange={() => setCategorySearch('')}
                      dropdownRender={categoryDropdown}
                      options={(categories.data ?? [])
                        .filter((category) => category.status !== 'DISABLED')
                        .map((category) => ({ value: category.id, label: category.name }))}
                    />
                  </Form.Item>
                </Col>
                {productType !== 'TIME' ? (
                  <Col xs={24} md={8}>
                    <Form.Item
                      label="Đơn vị tính"
                      name="unitId"
                      rules={[{ required: true, message: 'Vui lòng chọn đơn vị.' }]}
                    >
                      <Select
                        size="large"
                        showSearch
                        optionFilterProp="label"
                        placeholder="Chọn đơn vị"
                        options={(units.data ?? []).map((unit) => ({
                          value: unit.id,
                          label: unit.name,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>
              {productType !== 'TIME' ? (
                <Form.Item label="Mô tả" name="description">
                  <Input.TextArea
                    rows={3}
                    maxLength={1000}
                    showCount
                    placeholder="Mô tả ngắn về mặt hàng (không bắt buộc)"
                  />
                </Form.Item>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  title="Mặt hàng tính theo thời gian"
                  description="Giá sẽ được tính theo thời gian sử dụng thực tế hoặc theo block thời gian."
                />
              )}
            </Card>
            {productType !== 'TIME' ? (
              <Card title="Phiên bản giá" className="owner-catalog-form-card">
                <Form.List name="variants">
                  {(fields, { add, remove }) => (
                    <div className="owner-variant-list">
                      {fields.map((field, index) => (
                        <div className="owner-variant-row" key={field.key}>
                          <div className="owner-variant-col owner-variant-col--name">
                            <Form.Item
                              {...field}
                              label="Tên giá / Phiên bản"
                              name={[field.name, 'name']}
                              rules={[{ required: true, message: 'Nhập tên giá.' }]}
                            >
                              <Input
                                placeholder={index === 0 ? 'Giá mặc định' : 'Size M, Size L...'}
                              />
                            </Form.Item>
                          </div>
                          <div className="owner-variant-col owner-variant-col--sale">
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
                                    label="Giá bán"
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
                          </div>
                          <div className="owner-variant-col owner-variant-col--cost">
                            <Form.Item label="Giá vốn" name={[field.name, 'costPriceVnd']}>
                              <InputNumber min={0} className="owner-full-width" addonAfter="đ" />
                            </Form.Item>
                          </div>
                          <div className="owner-variant-col owner-variant-col--prompt">
                            <Form.Item
                              label="Nhập khi bán"
                              name={[field.name, 'promptPrice']}
                              valuePropName="checked"
                            >
                              <Checkbox />
                            </Form.Item>
                          </div>
                          {fields.length > 1 ? (
                            <div className="owner-variant-col owner-variant-col--action">
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label="Xóa phiên bản giá"
                                onClick={() => remove(field.name)}
                              />
                            </div>
                          ) : null}
                        </div>
                      ))}
                      <Button
                        type="dashed"
                        block
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
                        Thêm phiên bản giá
                      </Button>
                    </div>
                  )}
                </Form.List>
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
                <div className="owner-setting-line owner-setting-line--section">
                  <div>
                    <Typography.Text strong>Giờ đặc biệt</Typography.Text>
                    <Typography.Text type="secondary">
                      Giá ưu tiên theo khung giờ và ngày trong tuần
                    </Typography.Text>
                  </div>
                  <Form.List name="specialWindows">
                    {(_fields, { add }) => (
                      <Button
                        type="link"
                        icon={<PlusOutlined />}
                        onClick={() =>
                          add({
                            name: 'Giờ tối',
                            priceVnd: 70_000,
                            allDay: false,
                            startTime: '21:00',
                            endTime: '23:45',
                            weekdays: [0, 1, 2, 3, 4, 5, 6],
                          })
                        }
                      >
                        Thêm khung giờ
                      </Button>
                    )}
                  </Form.List>
                </div>
                <Form.List name="specialWindows">
                  {(fields, { remove }) =>
                    fields.length ? (
                      <div className="owner-special-window-list">
                        {fields.map((field) => (
                          <Card size="small" className="owner-special-window-card" key={field.key}>
                            <div className="owner-special-window-heading">
                              <Typography.Text strong>Khung giờ {field.name + 1}</Typography.Text>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => remove(field.name)}
                              >
                                Xóa
                              </Button>
                            </div>
                            <Row gutter={12}>
                              <Col xs={24} md={8}>
                                <Form.Item
                                  {...field}
                                  label="Tên"
                                  name={[field.name, 'name']}
                                  rules={[{ required: true, message: 'Nhập tên khung giờ.' }]}
                                >
                                  <Input placeholder="Giờ tối, Cuối tuần..." />
                                </Form.Item>
                              </Col>
                              <Col xs={24} md={8}>
                                <Form.Item
                                  label="Giá bán"
                                  name={[field.name, 'priceVnd']}
                                  rules={[{ required: true, message: 'Nhập giá bán.' }]}
                                >
                                  <InputNumber
                                    min={1}
                                    className="owner-full-width"
                                    addonAfter="đ"
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} md={8}>
                                <Form.Item
                                  label="Cả ngày"
                                  name={[field.name, 'allDay']}
                                  valuePropName="checked"
                                >
                                  <Switch />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Form.Item
                              noStyle
                              shouldUpdate={(previous, current) =>
                                previous.specialWindows?.[field.name]?.allDay !==
                                current.specialWindows?.[field.name]?.allDay
                              }
                            >
                              {({ getFieldValue }) =>
                                getFieldValue(['specialWindows', field.name, 'allDay']) ? null : (
                                  <Row gutter={12}>
                                    <Col xs={24} md={12}>
                                      <Form.Item
                                        label="Từ"
                                        name={[field.name, 'startTime']}
                                        rules={[
                                          {
                                            required: true,
                                            pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
                                            message: 'Nhập giờ HH:mm.',
                                          },
                                        ]}
                                      >
                                        <Input type="time" />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                      <Form.Item
                                        label="Đến"
                                        name={[field.name, 'endTime']}
                                        rules={[
                                          {
                                            required: true,
                                            pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
                                            message: 'Nhập giờ HH:mm.',
                                          },
                                        ]}
                                      >
                                        <Input type="time" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                )
                              }
                            </Form.Item>
                            <Form.Item
                              label="Ngày trong tuần"
                              name={[field.name, 'weekdays']}
                              rules={[
                                {
                                  required: true,
                                  type: 'array',
                                  min: 1,
                                  message: 'Chọn ít nhất một ngày.',
                                },
                              ]}
                            >
                              <Checkbox.Group
                                options={[
                                  { label: 'T2', value: 0 },
                                  { label: 'T3', value: 1 },
                                  { label: 'T4', value: 2 },
                                  { label: 'T5', value: 3 },
                                  { label: 'T6', value: 4 },
                                  { label: 'T7', value: 5 },
                                  { label: 'CN', value: 6 },
                                ]}
                              />
                            </Form.Item>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Alert
                        type="info"
                        showIcon
                        title="Chưa có giờ đặc biệt"
                        description="Giá bán thường sẽ được áp dụng cho tất cả ngày và khung giờ."
                      />
                    )
                  }
                </Form.List>
              </Card>
            )}
          </Col>
          <Col xs={24} xl={8}>
            <Card title="Hình đại diện" className="owner-catalog-form-card">
              <Form.Item name="avatarType">
                <Radio.Group
                  options={[
                    { value: 'COLOR', label: 'Màu sắc' },
                    { value: 'IMAGE', label: 'Hình ảnh' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prev, next) =>
                  prev.avatarType !== next.avatarType || prev.mediaId !== next.mediaId
                }
              >
                {({ getFieldValue }) =>
                  getFieldValue('avatarType') === 'IMAGE' ? (
                    <div className="owner-image-upload-box">
                      {getFieldValue('mediaId') ? (
                        <img
                          src={`/api/v1/media/${getFieldValue('mediaId')}`}
                          alt="Ảnh đại diện mặt hàng"
                          className="owner-product-image-preview"
                        />
                      ) : (
                        <div className="owner-product-image-placeholder">Chưa có ảnh</div>
                      )}
                      <label className="ant-btn ant-btn-default owner-image-upload-button">
                        <UploadOutlined /> {uploading ? 'Đang tải...' : 'Tải ảnh lên'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          disabled={uploading}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadImage(file);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <Typography.Text type="secondary">
                        PNG, JPEG hoặc WebP, tối đa 5 MB.
                      </Typography.Text>
                    </div>
                  ) : (
                    <Form.Item name="avatarColor" label="Chọn màu hiển thị">
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
            <Card title="Thông tin hệ thống" className="owner-catalog-form-card">
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Mã mặt hàng (SKU) và các biến thể giá sẽ được hệ thống tự động sinh và quản lý theo
                chuẩn POS.
              </Typography.Paragraph>
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
      <Modal
        title="Thêm danh mục nhanh"
        open={categoryModalOpen}
        onCancel={() => setCategoryModalOpen(false)}
        okText="Thêm danh mục"
        cancelText="Hủy"
        onOk={() => categoryForm.submit()}
      >
        <Form form={categoryForm} layout="vertical" onFinish={createCategory}>
          <Form.Item
            name="name"
            label="Tên danh mục"
            rules={[{ required: true, message: 'Vui lòng nhập tên danh mục.' }]}
          >
            <Input maxLength={160} />
          </Form.Item>
        </Form>
      </Modal>
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
