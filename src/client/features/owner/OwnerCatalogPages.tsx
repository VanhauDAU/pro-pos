import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CameraOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  SaveOutlined,
  ScissorOutlined,
  SearchOutlined,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import { CameraCaptureModal } from '@client/components/CameraCaptureModal';
import { ImageCropperModal } from '@client/components/ImageCropperModal';

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
  mediaId?: string | null;
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
  '#ffffff',
  '#f1f5f9',
  '#fef3c7',
  '#e0f2fe',
  '#dcfce7',
  '#fce7f3',
  '#facc15',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#0ea5e9',
  '#10b981',
  '#334155',
  '#0f172a',
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const p0 = parts[0];
  const p1 = parts[1];
  if (p0 && p1) {
    return (p0.slice(0, 1) + p1.slice(0, 1)).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
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
  const isImage = product.avatarType === 'IMAGE' && Boolean(product.mediaId);
  return (
    <Avatar
      shape="square"
      size={size}
      src={isImage ? `/api/v1/media/${product.mediaId}` : undefined}
      style={{
        background: product.avatarColor || (isImage ? '#ffffff' : '#f8fafc'),
        color: '#172235',
        fontWeight: 700,
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
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
  const [typeFilters, setTypeFilters] = useState<ProductType[]>([]);
  const [statusFilters, setStatusFilters] = useState<Array<'ACTIVE' | 'DISABLED'>>(['ACTIVE']);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [unitFilters, setUnitFilters] = useState<string[]>([]);
  const products = useQuery({
    queryKey: PRODUCT_QUERY,
    queryFn: () => apiRequest<ProductSummary[]>('/api/v1/owner/catalog/products'),
  });
  const categories = useQuery({
    queryKey: CATEGORY_QUERY,
    queryFn: () => apiRequest<Category[]>('/api/v1/owner/catalog/categories'),
  });
  const units = useQuery({
    queryKey: ['owner-units'],
    queryFn: () => apiRequest<Unit[]>('/api/v1/owner/catalog/units'),
  });

  const rows = useMemo(() => {
    const value = search.trim().toLowerCase();
    return (products.data ?? []).filter((product) => {
      const matchesSearch = !value || product.name.toLowerCase().includes(value);
      const matchesType = !typeFilters.length || typeFilters.includes(product.productType);
      const matchesStatus = !statusFilters.length || statusFilters.includes(product.status);
      const matchesCategory =
        !categoryFilters.length || categoryFilters.includes(product.categoryId ?? '');
      const matchesUnit = !unitFilters.length || unitFilters.includes(product.unitId ?? '');
      return matchesSearch && matchesType && matchesStatus && matchesCategory && matchesUnit;
    });
  }, [categoryFilters, products.data, search, statusFilters, typeFilters, unitFilters]);

  const filterLabels = {
    type: Object.fromEntries(Object.entries(productTypeLabels)),
    status: { ACTIVE: 'Đang bán', DISABLED: 'Ngừng bán' },
    category: Object.fromEntries((categories.data ?? []).map((item) => [item.id, item.name])),
    unit: Object.fromEntries((units.data ?? []).map((item) => [item.id, item.name])),
  };
  const activeFilters = [
    ...typeFilters.map((value) => ({
      key: `type:${value}`,
      label: `Loại: ${filterLabels.type[value]}`,
      remove: () => setTypeFilters((current) => current.filter((item) => item !== value)),
    })),
    ...statusFilters.map((value) => ({
      key: `status:${value}`,
      label: `Trạng thái: ${filterLabels.status[value]}`,
      remove: () => setStatusFilters((current) => current.filter((item) => item !== value)),
    })),
    ...categoryFilters.map((value) => ({
      key: `category:${value}`,
      label: `Danh mục: ${filterLabels.category[value] ?? value}`,
      remove: () => setCategoryFilters((current) => current.filter((item) => item !== value)),
    })),
    ...unitFilters.map((value) => ({
      key: `unit:${value}`,
      label: `Đơn vị: ${filterLabels.unit[value] ?? value}`,
      remove: () => setUnitFilters((current) => current.filter((item) => item !== value)),
    })),
  ];

  const clearFilters = () => {
    setTypeFilters([]);
    setStatusFilters([]);
    setCategoryFilters([]);
    setUnitFilters([]);
  };

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
            icon={<CopyOutlined />}
            onClick={() => navigate(`/owner/catalog/products/new?copyFrom=${product.id}`)}
          >
            Sao chép
          </Button>
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
            mode="multiple"
            maxTagCount={0}
            maxTagPlaceholder={(values) => `${values.length} loại`}
            value={typeFilters}
            onChange={setTypeFilters}
            placeholder="Loại mặt hàng"
            options={Object.entries(productTypeLabels).map(([value, label]) => ({ value, label }))}
          />
          <Select
            mode="multiple"
            maxTagCount={0}
            maxTagPlaceholder={(values) => `${values.length} trạng thái`}
            value={statusFilters}
            onChange={setStatusFilters}
            placeholder="Trạng thái"
            options={[
              { value: 'ACTIVE', label: 'Đang bán' },
              { value: 'DISABLED', label: 'Ngừng bán' },
            ]}
          />
          <Select
            mode="multiple"
            maxTagCount={0}
            maxTagPlaceholder={(values) => `${values.length} danh mục`}
            value={categoryFilters}
            onChange={setCategoryFilters}
            placeholder="Danh mục"
            showSearch
            optionFilterProp="label"
            options={(categories.data ?? [])
              .filter((item) => item.status !== 'DISABLED')
              .map((item) => ({ value: item.id, label: item.name }))}
          />
          <Select
            mode="multiple"
            maxTagCount={0}
            maxTagPlaceholder={(values) => `${values.length} đơn vị`}
            value={unitFilters}
            onChange={setUnitFilters}
            placeholder="Đơn vị"
            showSearch
            optionFilterProp="label"
            options={(units.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          />
        </div>
        {activeFilters.length ? (
          <div className="owner-catalog-active-filters">
            <Typography.Text type="secondary">Đang lọc:</Typography.Text>
            {activeFilters.map((filter) => (
              <Tag key={filter.key} closable onClose={filter.remove}>
                {filter.label}
              </Tag>
            ))}
            <Button type="link" size="small" onClick={clearFilters}>
              Xóa tất cả
            </Button>
          </div>
        ) : null}
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
  const [searchParams] = useSearchParams();
  const copyFromId = searchParams.get('copyFrom');
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ProductFormValues>();
  const [productType, setProductType] = useState<ProductType>('QUANTITY');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cropperModalOpen, setCropperModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [categorySearch, setCategorySearch] = useState('');
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categorySelectOpen, setCategorySelectOpen] = useState(false);

  const [unitSearch, setUnitSearch] = useState('');
  const [inlineUnitName, setInlineUnitName] = useState('');
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [unitSelectOpen, setUnitSelectOpen] = useState(false);

  const isEdit = Boolean(productId);
  const sourceProductId = productId || copyFromId;
  const detail = useQuery({
    queryKey: ['owner-product', sourceProductId],
    queryFn: () => apiRequest<ProductDetail>(`/api/v1/owner/catalog/products/${sourceProductId}`),
    enabled: Boolean(sourceProductId),
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

  const createCategoryDirect = async (nameToCreate: string) => {
    const name = nameToCreate.trim();
    if (!name) return;
    const existing = (categories.data ?? []).find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      form.setFieldsValue({ categoryId: existing.id });
      setCategorySearch('');
      setInlineCategoryName('');
      setCategorySelectOpen(false);
      messageApi.info(`Đã chọn danh mục "${existing.name}".`);
      return;
    }
    setCreatingCategory(true);
    try {
      const result = await jsonRequest<{ id: string }>(
        '/api/v1/owner/catalog/categories',
        { name },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      queryClient.setQueryData<Category[]>(CATEGORY_QUERY, (old) => {
        const current = old ?? [];
        if (current.some((c) => c.id === result.id)) return current;
        return [...current, { id: result.id, name, status: 'ACTIVE' }];
      });
      form.setFieldsValue({ categoryId: result.id });
      setCategorySearch('');
      setInlineCategoryName('');
      setCategorySelectOpen(false);
      void queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY });
      messageApi.success(`Đã thêm và chọn danh mục "${name}".`);
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể thêm danh mục.'));
    } finally {
      setCreatingCategory(false);
    }
  };

  const createUnitDirect = async (nameToCreate: string) => {
    const name = nameToCreate.trim();
    if (!name) return;
    const existing = (units.data ?? []).find(
      (u) => u.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      form.setFieldsValue({ unitId: existing.id });
      setUnitSearch('');
      setInlineUnitName('');
      setUnitSelectOpen(false);
      messageApi.info(`Đã chọn đơn vị tính "${existing.name}".`);
      return;
    }
    setCreatingUnit(true);
    try {
      const result = await jsonRequest<{ id: string }>(
        '/api/v1/owner/catalog/units',
        { name },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      queryClient.setQueryData<Unit[]>(['owner-units'], (old) => {
        const current = old ?? [];
        if (current.some((u) => u.id === result.id)) return current;
        return [...current, { id: result.id, name }];
      });
      form.setFieldsValue({ unitId: result.id });
      setUnitSearch('');
      setInlineUnitName('');
      setUnitSelectOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['owner-units'] });
      messageApi.success(`Đã thêm và chọn đơn vị tính "${name}".`);
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể thêm đơn vị.'));
    } finally {
      setCreatingUnit(false);
    }
  };

  const categoryDropdown = (menu: ReactNode) => {
    const trimmedSearch = categorySearch.trim();
    const existingMatches = (categories.data ?? []).some(
      (c) => c.name.toLowerCase() === trimmedSearch.toLowerCase(),
    );

    return (
      <div onMouseDown={(e) => e.stopPropagation()}>
        {menu}
        <Divider style={{ margin: '6px 0' }} />
        <div style={{ padding: '4px 8px 8px' }}>
          {trimmedSearch && !existingMatches ? (
            <div style={{ marginBottom: 6 }}>
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                loading={creatingCategory}
                onClick={() => void createCategoryDirect(trimmedSearch)}
                style={{
                  padding: 0,
                  fontWeight: 600,
                  height: 'auto',
                  textAlign: 'left',
                  whiteSpace: 'normal',
                }}
              >
                Thêm danh mục &ldquo;{trimmedSearch}&rdquo;
              </Button>
            </div>
          ) : null}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="middle"
              placeholder="Nhập tên danh mục mới..."
              value={inlineCategoryName}
              onChange={(e) => setInlineCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (inlineCategoryName.trim()) {
                    void createCategoryDirect(inlineCategoryName.trim());
                  }
                }
              }}
            />
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              loading={creatingCategory}
              disabled={!inlineCategoryName.trim()}
              onClick={() => void createCategoryDirect(inlineCategoryName.trim())}
            >
              Thêm
            </Button>
          </Space.Compact>
        </div>
      </div>
    );
  };

  const unitDropdown = (menu: ReactNode) => {
    const trimmedSearch = unitSearch.trim();
    const existingMatches = (units.data ?? []).some(
      (u) => u.name.toLowerCase() === trimmedSearch.toLowerCase(),
    );

    return (
      <div onMouseDown={(e) => e.stopPropagation()}>
        {menu}
        <Divider style={{ margin: '6px 0' }} />
        <div style={{ padding: '4px 8px 8px' }}>
          {trimmedSearch && !existingMatches ? (
            <div style={{ marginBottom: 6 }}>
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                loading={creatingUnit}
                onClick={() => void createUnitDirect(trimmedSearch)}
                style={{
                  padding: 0,
                  fontWeight: 600,
                  height: 'auto',
                  textAlign: 'left',
                  whiteSpace: 'normal',
                }}
              >
                Thêm đơn vị tính &ldquo;{trimmedSearch}&rdquo;
              </Button>
            </div>
          ) : null}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="middle"
              placeholder="Nhập đơn vị tính mới..."
              value={inlineUnitName}
              onChange={(e) => setInlineUnitName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (inlineUnitName.trim()) {
                    void createUnitDirect(inlineUnitName.trim());
                  }
                }
              }}
            />
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              loading={creatingUnit}
              disabled={!inlineUnitName.trim()}
              onClick={() => void createUnitDirect(inlineUnitName.trim())}
            >
              Thêm
            </Button>
          </Space.Compact>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!detail.data) {
      if (!isEdit && !copyFromId) {
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
      name: isEdit ? product.name : `${product.name} (sao chép)`,
      productType: product.productType,
      avatarType: product.avatarType,
      avatarColor: product.avatarColor || avatarColors[0] || '#facc15',
      mediaId: product.mediaId ?? null,
      variants: product.variants.map((variant) => ({
        ...(isEdit && variant.id ? { id: variant.id } : {}),
        name: variant.name,
        salePriceVnd: variant.salePriceVnd,
        costPriceVnd: variant.costPriceVnd,
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
        const item: {
          id?: string;
          name: string;
          priceVnd: number;
          allDay: boolean;
          startTime: string;
          endTime: string;
          weekdays: number[];
        } = {
          name: window.name,
          priceVnd: window.priceVnd,
          allDay: window.startMinute === window.endMinute,
          startTime: minuteToTime(window.startMinute),
          endTime: minuteToTime(window.endMinute),
          weekdays: maskToWeekdays(window.weekdaysMask),
        };
        if (isEdit && window.id) item.id = window.id;
        return item;
      }),
    });
  }, [detail.data, form, isEdit, copyFromId]);

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
      messageApi.success('Đã tải ảnh đại diện lên Cloudflare R2.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể tải ảnh đại diện.'));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    form.setFieldValue('mediaId', null);
    form.setFieldValue('avatarType', 'COLOR');
    messageApi.info('Đã gỡ ảnh sản phẩm.');
  };

  const save = async (values: ProductFormValues) => {
    setSaving(true);
    try {
      const currentMediaId = values.mediaId || form.getFieldValue('mediaId') || null;
      const payload = {
        name: values.name,
        description: values.description || null,
        productType: values.productType,
        categoryId: values.categoryId || null,
        unitId: values.productType === 'TIME' ? null : values.unitId || null,
        avatarType: values.avatarType,
        avatarColor: values.avatarColor || null,
        mediaId: values.avatarType === 'IMAGE' ? currentMediaId : null,
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY }),
        queryClient.invalidateQueries({ queryKey: ['owner-product'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-catalog'] }),
      ]);
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
            {isEdit ? 'Chi tiết mặt hàng' : copyFromId ? 'Sao chép mặt hàng' : 'Thêm mặt hàng'}
          </Typography.Title>
          <Typography.Text type="secondary">
            Thông tin cốt lõi để mặt hàng xuất hiện trên POS.
          </Typography.Text>
        </div>
        <Space>
          {isEdit && (
            <Button
              icon={<CopyOutlined />}
              onClick={() => navigate(`/owner/catalog/products/new?copyFrom=${productId}`)}
            >
              Sao chép
            </Button>
          )}
          <Button onClick={() => navigate('/owner/catalog/products')}>Hủy</Button>
        </Space>
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
                      open={categorySelectOpen}
                      onDropdownVisibleChange={setCategorySelectOpen}
                      optionFilterProp="label"
                      placeholder="Chọn danh mục"
                      searchValue={categorySearch}
                      onSearch={setCategorySearch}
                      onChange={(val) => {
                        form.setFieldValue('categoryId', val);
                        setCategorySearch('');
                      }}
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
                        allowClear
                        open={unitSelectOpen}
                        onDropdownVisibleChange={setUnitSelectOpen}
                        optionFilterProp="label"
                        placeholder="Chọn hoặc nhập đơn vị"
                        searchValue={unitSearch}
                        onSearch={setUnitSearch}
                        onChange={(val) => {
                          form.setFieldValue('unitId', val);
                          setUnitSearch('');
                        }}
                        dropdownRender={unitDropdown}
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
              <Form.Item name="mediaId" hidden>
                <Input />
              </Form.Item>
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
                  prev.avatarType !== next.avatarType ||
                  prev.mediaId !== next.mediaId ||
                  prev.avatarColor !== next.avatarColor
                }
              >
                {({ getFieldValue }) =>
                  getFieldValue('avatarType') === 'IMAGE' ? (
                    <div className="owner-image-single-container">
                      {getFieldValue('mediaId') ? (
                        <div className="owner-product-single-image-card">
                          <div
                            className="owner-product-image-preview-wrap"
                            style={{
                              background: getFieldValue('avatarColor') || '#ffffff',
                              border: '1.5px solid #e2e8f0',
                              borderRadius: 12,
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <img
                              src={`/api/v1/media/${getFieldValue('mediaId')}`}
                              alt="Ảnh đại diện mặt hàng"
                              className="owner-product-image-preview"
                              style={{
                                backgroundColor: 'transparent',
                                maxHeight: 180,
                                objectFit: 'contain',
                              }}
                            />
                            <div className="owner-product-image-badge">
                              <CheckOutlined /> 1 ảnh duy nhất
                            </div>
                          </div>
                          <div className="owner-product-image-actions">
                            <Button
                              icon={<ScissorOutlined />}
                              disabled={uploading}
                              onClick={() => {
                                const currentMediaId = form.getFieldValue('mediaId');
                                if (currentMediaId) {
                                  setCropImageSrc(`/api/v1/media/${currentMediaId}`);
                                  setCropperModalOpen(true);
                                }
                              }}
                            >
                              Căn chỉnh khung
                            </Button>
                            <Button
                              icon={<CameraOutlined />}
                              disabled={uploading}
                              onClick={() => setCameraModalOpen(true)}
                            >
                              Chụp ảnh mới
                            </Button>
                            <Button
                              icon={<UploadOutlined />}
                              disabled={uploading}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              Đổi ảnh khác
                            </Button>
                            <Popconfirm
                              title="Gỡ ảnh này?"
                              description="Mặt hàng sẽ chuyển về sử dụng màu sắc đại diện."
                              onConfirm={removeImage}
                              okText="Gỡ ảnh"
                              cancelText="Hủy"
                            >
                              <Button danger icon={<DeleteOutlined />} disabled={uploading}>
                                Xóa ảnh
                              </Button>
                            </Popconfirm>
                          </div>
                        </div>
                      ) : (
                        <div className="owner-product-empty-image-box">
                          <div className="owner-product-image-placeholder-icon">
                            <PictureOutlined style={{ fontSize: 36, color: '#94a3b8' }} />
                          </div>
                          <div className="owner-product-empty-image-title">
                            Chưa có ảnh đại diện
                          </div>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 13, display: 'block', marginBottom: 12 }}
                          >
                            Chỉ lưu 1 ảnh duy nhất. Bạn có thể chụp trực tiếp từ camera hoặc tải ảnh
                            từ máy.
                          </Typography.Text>
                          <div className="owner-image-upload-cta-row">
                            <Button
                              type="primary"
                              icon={<CameraOutlined />}
                              disabled={uploading}
                              onClick={() => setCameraModalOpen(true)}
                            >
                              Chụp từ Camera
                            </Button>
                            <Button
                              icon={<UploadOutlined />}
                              loading={uploading}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {uploading ? 'Đang tải...' : 'Tải tệp từ máy'}
                            </Button>
                          </div>
                        </div>
                      )}

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                              messageApi.error('Chỉ hỗ trợ PNG, JPEG hoặc WebP.');
                              return;
                            }
                            if (file.size > 10 * 1024 * 1024) {
                              messageApi.error('Ảnh không được vượt quá 10 MB.');
                              return;
                            }
                            const reader = new FileReader();
                            reader.addEventListener(
                              'load',
                              (e) => {
                                if (typeof e.target?.result === 'string') {
                                  setCropImageSrc(e.target.result);
                                  setCropperModalOpen(true);
                                }
                              },
                              { once: true },
                            );
                            reader.readAsDataURL(file);
                          }
                          event.currentTarget.value = '';
                        }}
                      />

                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          display: 'block',
                          textAlign: 'center',
                          marginTop: 10,
                          marginBottom: 12,
                        }}
                      >
                        Lưu lên Cloudflare R2 · PNG, JPEG hoặc WebP (tối đa 5 MB).
                      </Typography.Text>

                      <div
                        style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #e2e8f0' }}
                      >
                        <Form.Item
                          name="avatarColor"
                          label="Màu nền ảnh (hữu ích cho ảnh PNG trong suốt / không nền)"
                          tooltip="Màu này sẽ làm nền phía sau ảnh sản phẩm trên thực đơn và trang gọi món."
                        >
                          <Radio.Group className="owner-avatar-grid">
                            {avatarColors.map((color) => (
                              <Radio.Button
                                key={color}
                                value={color}
                                style={{
                                  background: color,
                                  border: color === '#ffffff' ? '1.5px solid #cbd5e1' : undefined,
                                }}
                                aria-label={`Màu ${color}`}
                              >
                                <span />
                              </Radio.Button>
                            ))}
                          </Radio.Group>
                        </Form.Item>
                      </div>
                    </div>
                  ) : (
                    <Form.Item name="avatarColor" label="Chọn màu hiển thị">
                      <Radio.Group className="owner-avatar-grid">
                        {avatarColors.map((color) => (
                          <Radio.Button
                            key={color}
                            value={color}
                            style={{
                              background: color,
                              border: color === '#ffffff' ? '1.5px solid #cbd5e1' : undefined,
                            }}
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
            <CameraCaptureModal
              open={cameraModalOpen}
              onClose={() => setCameraModalOpen(false)}
              onSnap={(dataUrl) => {
                setCropImageSrc(dataUrl);
                setCameraModalOpen(false);
                setCropperModalOpen(true);
              }}
              onCapture={uploadImage}
            />
            <ImageCropperModal
              open={cropperModalOpen}
              imageSrc={cropImageSrc}
              onClose={() => {
                setCropperModalOpen(false);
                setCropImageSrc(null);
              }}
              onConfirm={async (file) => {
                await uploadImage(file);
                setCropperModalOpen(false);
                setCropImageSrc(null);
              }}
            />
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
