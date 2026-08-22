import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CloseOutlined,
  InfoCircleOutlined,
  MinusOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { apiRequest, jsonRequest } from '@client/lib/api';
import type { AuthContextResponse } from '@contracts/auth';
import type { CustomerGroup } from '@contracts/customer';
import type {
  PromotionDetail,
  PromotionInput,
  PromotionScope,
  PromotionSummary,
  PromotionType,
} from '@contracts/promotion';

interface CatalogChoice {
  id: string;
  name: string;
  productType?: 'QUANTITY' | 'WEIGHT' | 'TIME';
  status?: string;
}
interface ProductOption {
  id: string;
  name: string;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  variants: Array<{
    id: string;
    name: string;
    salePriceVnd: number | null;
    promptPrice: boolean;
  }>;
}
interface ProductTarget {
  productId: string;
  variantId: string | null;
  quantity: number;
}
interface PromotionFormValues {
  name: string;
  type: PromotionType;
  value?: number | null;
  minimumOrderVnd: number;
  maximumDiscountVnd?: number | null;
  autoApply: boolean;
  startDate: string;
  startTime: string;
  hasEnd: boolean;
  endDate?: string;
  endTime?: string;
  useWeekdays: boolean;
  weekdays: number[];
  useTimeRanges: boolean;
  timeRanges: Array<{ start: string; end: string }>;
  scope: PromotionScope;
  categoryIds: string[];
  productIds: string[];
  productTargets: ProductTarget[];
  customerGroupIds: string[];
  giftProductIds: string[];
  giftTargets: ProductTarget[];
  giftBuyAny: boolean;
  maximumGiftQuantity?: number | null;
}

const typeLabels: Record<PromotionType, string> = {
  FIXED_AMOUNT: 'Theo số tiền',
  PERCENT: 'Theo phần trăm',
  FLAT_PRICE: 'Đồng giá',
  GIFT: 'Tặng món',
};
const scopeLabels: Record<PromotionScope, string> = {
  INVOICE: 'Hóa đơn',
  CATEGORY: 'Danh mục',
  PRODUCT: 'Mặt hàng',
};
const weekdayLabels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

function mutationHeaders(token?: string | null) {
  return { 'X-CSRF-Token': token ?? '' };
}
function money(value: number | null | undefined) {
  return `${new Intl.NumberFormat('vi-VN').format(value ?? 0)}đ`;
}
function dateTime(value: number | null) {
  return value
    ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
    : 'Không giới hạn';
}
function inputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function inputTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function toTimestamp(date?: string, time?: string) {
  return new Date(`${date}T${time || '00:00'}:00`).getTime();
}
function minute(value: string) {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
}
function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function mask(days: number[]) {
  return days.reduce((total, day) => total | (1 << day), 0);
}
function maskDays(value: number | null) {
  return value === null
    ? []
    : weekdayLabels.map((_, day) => day).filter((day) => (value & (1 << day)) !== 0);
}

function formatMoneyInput(value: string | number | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseMoneyInput(value: string | undefined) {
  return Number((value ?? '').replace(/[^\d]/g, ''));
}

function productTargetKey(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? ''}`;
}

function MoneyInput({
  min = 0,
  value,
  onChange,
}: {
  min?: number;
  value?: number | null;
  onChange?: (value: number | null) => void;
}) {
  return (
    <InputNumber
      min={min}
      {...(value === undefined ? {} : { value })}
      {...(onChange ? { onChange } : {})}
      controls={false}
      formatter={formatMoneyInput}
      parser={parseMoneyInput}
      addonAfter="đ"
      style={{ width: '100%' }}
    />
  );
}

function ProductAvatar({ product }: { product: ProductOption }) {
  return (
    <Avatar
      shape="square"
      size={42}
      src={
        product.avatarType === 'IMAGE' && product.mediaId
          ? `/api/v1/media/${product.mediaId}`
          : undefined
      }
      style={{ background: product.avatarColor ?? '#e2e8f0', color: '#334155' }}
    >
      {product.name.slice(0, 2).toUpperCase()}
    </Avatar>
  );
}

function ProductPickerModal({
  open,
  title,
  products,
  value,
  excludeWeight,
  onCancel,
  onChange,
}: {
  open: boolean;
  title: string;
  products: ProductOption[];
  value: ProductTarget[];
  excludeWeight?: boolean;
  onCancel: () => void;
  onChange: (value: ProductTarget[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [draft, setDraft] = useState<ProductTarget[]>(value);
  useEffect(() => {
    if (open) {
      setDraft(value);
      setSearch('');
      setCategory('ALL');
    }
  }, [open, value]);
  const categories = [
    ...new Map(
      products
        .filter((item) => item.categoryId)
        .map((item) => [item.categoryId!, item.categoryName ?? 'Khác']),
    ).entries(),
  ];
  const visible = products.filter((product) => {
    if (excludeWeight && product.productType === 'WEIGHT') return false;
    if (category !== 'ALL' && product.categoryId !== category) return false;
    const term = search.trim().toLocaleLowerCase('vi');
    return (
      !term ||
      product.name.toLocaleLowerCase('vi').includes(term) ||
      product.variants.some((variant) => variant.name.toLocaleLowerCase('vi').includes(term))
    );
  });
  const selected = new Set(draft.map((item) => productTargetKey(item.productId, item.variantId)));
  const toggle = (productId: string, variantId: string | null, checked: boolean) => {
    const targetKey = productTargetKey(productId, variantId);
    if (checked && draft.length >= 50) return;
    setDraft((current) =>
      checked
        ? [...current, { productId, variantId, quantity: 1 }]
        : current.filter((item) => productTargetKey(item.productId, item.variantId) !== targetKey),
    );
  };
  return (
    <Modal
      open={open}
      width={780}
      title={title}
      onCancel={onCancel}
      className="owner-product-picker"
      footer={[
        <span key="count" className="owner-product-picker__count">
          Đã chọn {draft.length}/50
        </span>,
        <Button key="cancel" onClick={onCancel}>
          Hủy
        </Button>,
        <Button key="select" type="primary" onClick={() => onChange(draft)}>
          Chọn
        </Button>,
      ]}
    >
      <div className="owner-product-picker__filters">
        <Select
          value={category}
          onChange={setCategory}
          options={[
            { value: 'ALL', label: 'Tất cả danh mục' },
            ...categories.map(([categoryId, label]) => ({ value: categoryId, label })),
          ]}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm mặt hàng hoặc phiên bản giá"
        />
      </div>
      <div className="owner-product-picker__list">
        {visible.length === 0 ? (
          <Empty description="Không tìm thấy mặt hàng" />
        ) : (
          visible.map((product) => {
            const variants = product.variants;
            const variantSelected = variants.filter((variant) =>
              selected.has(productTargetKey(product.id, variant.id)),
            ).length;
            return (
              <div key={product.id} className="owner-product-picker__product">
                <div className="owner-product-picker__product-row">
                  <Checkbox
                    checked={variantSelected === variants.length}
                    indeterminate={variantSelected > 0 && variantSelected < variants.length}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      const variantIds = new Set(variants.map((variant) => variant.id));
                      setDraft((current) => {
                        const kept = current.filter(
                          (item) =>
                            item.productId !== product.id || !variantIds.has(item.variantId ?? ''),
                        );
                        return checked
                          ? [
                              ...kept,
                              ...variants
                                .slice(0, Math.max(0, 50 - kept.length))
                                .map((variant) => ({
                                  productId: product.id,
                                  variantId: variant.id,
                                  quantity: 1,
                                })),
                            ]
                          : kept;
                      });
                    }}
                  />
                  <ProductAvatar product={product} />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.categoryName ?? 'Chưa phân loại'}</small>
                  </span>
                  {variants.length === 1 ? (
                    <b>
                      {variants[0]!.promptPrice
                        ? 'Nhập giá khi bán'
                        : money(variants[0]!.salePriceVnd)}
                    </b>
                  ) : (
                    <b>{variants.length} giá</b>
                  )}
                </div>
                {variants.length > 1 ? (
                  <div className="owner-product-picker__variants">
                    {variants.map((variant) => (
                      <label key={variant.id}>
                        <Checkbox
                          checked={selected.has(productTargetKey(product.id, variant.id))}
                          onChange={(event) => toggle(product.id, variant.id, event.target.checked)}
                        />
                        <span>{variant.name}</span>
                        <b>
                          {variant.promptPrice ? 'Nhập giá khi bán' : money(variant.salePriceVnd)}
                        </b>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function SelectedProductList({
  value,
  products,
  showQuantity,
  onChange,
}: {
  value: ProductTarget[];
  products: ProductOption[];
  showQuantity?: boolean;
  onChange: (value: ProductTarget[]) => void;
}) {
  if (value.length === 0) return null;
  const rows = value.map((target) => {
    const product = products.find((item) => item.id === target.productId);
    const variant = product?.variants.find((item) => item.id === target.variantId);
    return { target, product, variant };
  });
  return (
    <div className="owner-selected-products">
      <div className="owner-selected-products__head">
        <span>Mặt hàng</span>
        <span>Giá bán</span>
        {showQuantity ? <span>Số lượng mua</span> : null}
        <span />
      </div>
      {rows.map(({ target, product, variant }) =>
        product ? (
          <div
            key={`${target.productId}:${target.variantId ?? ''}`}
            className="owner-selected-products__row"
          >
            <span className="owner-selected-products__name">
              <ProductAvatar product={product} />
              <span>
                <strong>{product.name}</strong>
                <small>{variant?.name ?? 'Tất cả phiên bản'}</small>
              </span>
            </span>
            <span>{variant?.promptPrice ? 'Nhập giá khi bán' : money(variant?.salePriceVnd)}</span>
            {showQuantity ? (
              <span className="owner-selected-products__quantity">
                <Button
                  size="small"
                  shape="circle"
                  icon={<MinusOutlined />}
                  disabled={target.quantity <= 1}
                  onClick={() =>
                    onChange(
                      value.map((item) =>
                        item === target
                          ? { ...item, quantity: Math.max(1, item.quantity - 1) }
                          : item,
                      ),
                    )
                  }
                />
                <b>{target.quantity}</b>
                <Button
                  size="small"
                  shape="circle"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    onChange(
                      value.map((item) =>
                        item === target
                          ? { ...item, quantity: Math.min(999, item.quantity + 1) }
                          : item,
                      ),
                    )
                  }
                />
              </span>
            ) : null}
            <Button
              type="text"
              danger
              icon={<CloseOutlined />}
              onClick={() => onChange(value.filter((item) => item !== target))}
            />
          </div>
        ) : null,
      )}
    </div>
  );
}

export function OwnerPromotionListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>();
  const [status, setStatus] = useState<string>();
  const promotions = useQuery({
    queryKey: ['owner-promotions', search, type, status],
    queryFn: () =>
      apiRequest<PromotionSummary[]>(
        `/api/v1/owner/promotions?search=${encodeURIComponent(search)}${type ? `&type=${type}` : ''}${status ? `&status=${status}` : ''}`,
      ),
  });
  return (
    <div className="owner-promotion-page">
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>Khuyến mại</Typography.Title>
          <Typography.Text type="secondary">
            Tạo và quản lý chương trình ưu đãi tại POS
          </Typography.Text>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => navigate('/owner/promotions/new')}
        >
          Tạo khuyến mại
        </Button>
      </div>
      <Card className="owner-promotion-list-card">
        <div className="owner-promotion-filters">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Tìm theo tên chương trình"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            allowClear
            placeholder="Loại khuyến mại"
            value={type}
            onChange={setType}
            options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
          />
          <Select
            allowClear
            placeholder="Trạng thái"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'ACTIVE', label: 'Đang bật' },
              { value: 'PAUSED', label: 'Ngừng áp dụng' },
            ]}
          />
        </div>
        <Table
          rowKey="id"
          loading={promotions.isLoading}
          dataSource={promotions.data ?? []}
          pagination={{ pageSize: 15 }}
          onRow={(row) => ({
            onClick: () => navigate(`/owner/promotions/${row.id}`),
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: 'Chương trình khuyến mại',
              dataIndex: 'name',
              render: (name: string, row: PromotionSummary) => (
                <div>
                  <strong>{name}</strong>
                  <div className="owner-promotion-muted">{scopeLabels[row.scope]}</div>
                </div>
              ),
            },
            {
              title: 'Loại khuyến mại',
              dataIndex: 'type',
              render: (value: PromotionType) => typeLabels[value],
            },
            { title: 'Bắt đầu', dataIndex: 'startsAt', render: dateTime },
            { title: 'Kết thúc', dataIndex: 'endsAt', render: dateTime },
            {
              title: 'Trạng thái',
              dataIndex: 'computedStatus',
              render: (value: PromotionSummary['computedStatus']) => {
                const meta = (
                  {
                    ACTIVE: ['green', 'Đang áp dụng'],
                    PAUSED: ['default', 'Ngừng áp dụng'],
                    UPCOMING: ['blue', 'Sắp diễn ra'],
                    ENDED: ['red', 'Đã kết thúc'],
                  } as const
                )[value];
                return <Tag color={meta[0]}>{meta[1]}</Tag>;
              },
            },
          ]}
          locale={{ emptyText: <Empty description="Chưa có chương trình khuyến mại" /> }}
        />
      </Card>
    </div>
  );
}

export function OwnerPromotionFormPage({ promotionId }: { promotionId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PromotionFormValues>();
  const [saving, setSaving] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const detail = useQuery({
    queryKey: ['owner-promotion', promotionId],
    queryFn: () => apiRequest<PromotionDetail>(`/api/v1/owner/promotions/${promotionId}`),
    enabled: Boolean(promotionId),
  });
  const products = useQuery({
    queryKey: ['owner-promotion-product-options'],
    queryFn: () => apiRequest<ProductOption[]>('/api/v1/owner/promotions/product-options'),
  });
  const categories = useQuery({
    queryKey: ['owner-categories'],
    queryFn: () => apiRequest<CatalogChoice[]>('/api/v1/owner/catalog/categories'),
  });
  const groups = useQuery({
    queryKey: ['customer-groups'],
    queryFn: () => apiRequest<CustomerGroup[]>('/api/v1/owner/customers/groups'),
  });

  useEffect(() => {
    if (!detail.data) return;
    const start = new Date(detail.data.startsAt);
    const end = detail.data.endsAt ? new Date(detail.data.endsAt) : null;
    form.setFieldsValue({
      name: detail.data.name,
      type: detail.data.type,
      value: detail.data.value,
      minimumOrderVnd: detail.data.minimumOrderVnd,
      maximumDiscountVnd: detail.data.maximumDiscountVnd,
      autoApply: detail.data.autoApply,
      startDate: inputDate(start),
      startTime: inputTime(start),
      hasEnd: Boolean(end),
      ...(end ? { endDate: inputDate(end), endTime: inputTime(end) } : {}),
      useWeekdays: detail.data.weekdaysMask !== null,
      weekdays: maskDays(detail.data.weekdaysMask),
      useTimeRanges: detail.data.timeRanges.length > 0,
      timeRanges: detail.data.timeRanges.map((range) => ({
        start: clock(range.startMinute),
        end: clock(range.endMinute),
      })),
      scope: detail.data.scope,
      categoryIds: detail.data.categoryIds,
      productIds: detail.data.productIds,
      productTargets: detail.data.productTargets,
      customerGroupIds: detail.data.customerGroupIds,
      giftProductIds: detail.data.giftProductIds,
      giftTargets: detail.data.giftTargets,
      giftBuyAny: detail.data.giftBuyAny,
      maximumGiftQuantity: detail.data.maximumGiftQuantity,
    });
  }, [detail.data, form]);

  const type = Form.useWatch('type', form) ?? 'FIXED_AMOUNT';
  const scope = Form.useWatch('scope', form) ?? 'INVOICE';
  const hasEnd = Form.useWatch('hasEnd', form);
  const useWeekdays = Form.useWatch('useWeekdays', form);
  const useTimeRanges = Form.useWatch('useTimeRanges', form);
  const productTargets = Form.useWatch('productTargets', form) ?? [];
  const giftTargets = Form.useWatch('giftTargets', form) ?? [];
  const watched = Form.useWatch([], form);

  useEffect(() => {
    if (type === 'FLAT_PRICE' && scope === 'INVOICE') form.setFieldValue('scope', 'PRODUCT');
    if (type === 'GIFT' && scope === 'CATEGORY') form.setFieldValue('scope', 'INVOICE');
  }, [type, scope, form]);

  const save = async (values: PromotionFormValues) => {
    const body: PromotionInput = {
      name: values.name,
      type: values.type,
      value: values.type === 'GIFT' ? null : (values.value ?? null),
      minimumOrderVnd: values.minimumOrderVnd ?? 0,
      maximumDiscountVnd: values.type === 'PERCENT' ? (values.maximumDiscountVnd ?? null) : null,
      autoApply: values.type === 'GIFT' ? false : Boolean(values.autoApply),
      startsAt: toTimestamp(values.startDate, values.startTime),
      endsAt: values.hasEnd ? toTimestamp(values.endDate, values.endTime) : null,
      weekdaysMask: values.useWeekdays ? mask(values.weekdays ?? []) : null,
      timeRanges: values.useTimeRanges
        ? (values.timeRanges ?? []).map((range) => ({
            startMinute: minute(range.start),
            endMinute: minute(range.end),
          }))
        : [],
      scope: values.scope,
      categoryIds: values.scope === 'CATEGORY' ? (values.categoryIds ?? []) : [],
      productIds: values.scope === 'PRODUCT' ? (values.productIds ?? []) : [],
      productTargets: values.scope === 'PRODUCT' ? (values.productTargets ?? []) : [],
      customerGroupIds: values.customerGroupIds ?? [],
      giftProductIds: values.type === 'GIFT' ? (values.giftProductIds ?? []) : [],
      giftTargets: values.type === 'GIFT' ? (values.giftTargets ?? []) : [],
      giftBuyAny:
        values.type === 'GIFT' && values.scope === 'PRODUCT' ? Boolean(values.giftBuyAny) : false,
      maximumGiftQuantity: values.type === 'GIFT' ? (values.maximumGiftQuantity ?? 1) : null,
    };
    setSaving(true);
    try {
      await jsonRequest(`/api/v1/owner/promotions${promotionId ? `/${promotionId}` : ''}`, body, {
        method: promotionId ? 'PUT' : 'POST',
        headers: mutationHeaders(auth.data?.csrfToken),
      });
      await queryClient.invalidateQueries({ queryKey: ['owner-promotions'] });
      message.success(promotionId ? 'Đã cập nhật khuyến mại.' : 'Đã tạo chương trình khuyến mại.');
      navigate('/owner/promotions');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async () => {
    if (!promotionId || !detail.data) return;
    const active = detail.data.status !== 'ACTIVE';
    await jsonRequest(
      `/api/v1/owner/promotions/${promotionId}/status`,
      { active },
      { method: 'PATCH', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: ['owner-promotions'] }),
    ]);
    message.success(active ? 'Đã tiếp tục khuyến mại.' : 'Đã ngừng khuyến mại.');
  };

  if (detail.isLoading) return <Card loading />;
  return (
    <div className="owner-promotion-page">
      <button
        type="button"
        className="owner-back-link"
        onClick={() => navigate('/owner/promotions')}
      >
        <ArrowLeftOutlined /> Quay lại danh sách khuyến mại
      </button>
      <div className="owner-page-heading owner-promotion-form-header">
        <div>
          <Typography.Title level={2}>
            {promotionId ? 'Chi tiết khuyến mại' : 'Thêm mới khuyến mại'}
          </Typography.Title>
        </div>
        <div className="owner-promotion-header-actions">
          {promotionId ? (
            <Button danger={detail.data?.status === 'ACTIVE'} onClick={() => void toggle()}>
              {detail.data?.status === 'ACTIVE' ? 'Ngừng khuyến mại' : 'Tiếp tục khuyến mại'}
            </Button>
          ) : null}
          <Button onClick={() => navigate('/owner/promotions')}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            Lưu
          </Button>
        </div>
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{
          type: 'FIXED_AMOUNT',
          minimumOrderVnd: 0,
          autoApply: false,
          startDate: inputDate(now),
          startTime: inputTime(now),
          hasEnd: false,
          useWeekdays: false,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          useTimeRanges: false,
          timeRanges: [{ start: '08:00', end: '22:00' }],
          scope: 'INVOICE',
          categoryIds: [],
          productIds: [],
          productTargets: [],
          customerGroupIds: [],
          giftProductIds: [],
          giftTargets: [],
          giftBuyAny: false,
          maximumGiftQuantity: 1,
        }}
        onFinish={(values) => void save(values)}
      >
        <div className="owner-promotion-form-layout">
          <div className="owner-promotion-form-main">
            <Card>
              <Typography.Title level={4}>Tên khuyến mại</Typography.Title>
              <Form.Item
                name="name"
                label="Tên khuyến mại"
                rules={[{ required: true, message: 'Vui lòng nhập tên khuyến mại.' }]}
              >
                <Input size="large" maxLength={160} placeholder="Ví dụ: Giảm 20% cuối tuần" />
              </Form.Item>
            </Card>
            <Card>
              <Typography.Title level={4}>Tùy chọn khuyến mại</Typography.Title>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="type" label="Loại khuyến mại">
                    <Select
                      size="large"
                      options={Object.entries(typeLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </Form.Item>
                </Col>
                {type !== 'GIFT' ? (
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="value"
                      label="Giá trị"
                      rules={[
                        { required: true, message: 'Vui lòng nhập giá trị.' },
                        ...(type === 'PERCENT'
                          ? [
                              {
                                type: 'number' as const,
                                min: 1,
                                max: 100,
                                message: 'Phần trăm phải từ 1 đến 100.',
                              },
                            ]
                          : []),
                      ]}
                    >
                      {type === 'PERCENT' ? (
                        <InputNumber
                          min={1}
                          max={100}
                          precision={0}
                          controls={false}
                          addonAfter="%"
                          onChange={(value) => {
                            if (typeof value === 'number' && value > 100)
                              form.setFieldValue('value', 100);
                            if (typeof value === 'number' && value < 0)
                              form.setFieldValue('value', 1);
                          }}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <MoneyInput min={1} />
                      )}
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="minimumOrderVnd" label="Giá trị hóa đơn tối thiểu">
                    <MoneyInput />
                  </Form.Item>
                </Col>
                {type === 'PERCENT' ? (
                  <Col xs={24} md={12}>
                    <Form.Item name="maximumDiscountVnd" label="Giảm giá tối đa">
                      <MoneyInput min={1} />
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>
              {type !== 'GIFT' ? (
                <div className="owner-promotion-toggle-row">
                  <Form.Item name="autoApply" valuePropName="checked" noStyle>
                    <Switch />
                  </Form.Item>
                  <span>Tự động áp dụng khuyến mại khi tạo đơn</span>
                </div>
              ) : null}
              {type === 'FLAT_PRICE' ? (
                <div className="owner-promotion-note">
                  <div className="owner-promotion-note__title">* Lưu ý :</div>
                  <div className="owner-promotion-note__item">
                    - Chương trình đồng giá chỉ điều chỉnh giá bán của mặt hàng trong thời gian được
                    chọn và không ghi nhận giá trị khuyến mại
                  </div>
                  <div className="owner-promotion-note__item">
                    - Không áp dụng cho mặt hàng có giá trị thấp hơn giá trị đồng giá được thiết lập
                  </div>
                  <div className="owner-promotion-note__item">
                    - Không áp dụng trên hóa đơn, chỉ áp dụng với danh mục hoặc mặt hàng
                  </div>
                </div>
              ) : null}
              {type === 'GIFT' ? (
                <div className="owner-promotion-note">
                  <div className="owner-promotion-note__title">- Lưu ý:</div>
                  <div className="owner-promotion-note__item">
                    - Chương trình khuyến mại tặng món áp dụng cho hóa đơn: Tặng món được chỉ định
                  </div>
                  <div className="owner-promotion-note__item">
                    - Chương trình khuyến mại tặng món áp dụng với mặt hàng: Mua món tặng món
                  </div>
                  <div className="owner-promotion-note__item">
                    - Chương trình khuyến mại tặng món không áp dụng với mặt hàng trọng lượng
                  </div>
                </div>
              ) : null}
            </Card>
            <Card>
              <Typography.Title level={4}>Thời gian áp dụng</Typography.Title>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="startDate" label="Ngày bắt đầu" rules={[{ required: true }]}>
                    <Input size="large" type="date" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="startTime"
                    label="Thời điểm bắt đầu"
                    rules={[{ required: true }]}
                  >
                    <Input size="large" type="time" />
                  </Form.Item>
                </Col>
              </Row>
              <div className="owner-promotion-toggle-row">
                <Form.Item name="hasEnd" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <span>Thời gian kết thúc</span>
              </div>
              {hasEnd ? (
                <Row gutter={12} className="owner-promotion-reveal">
                  <Col xs={24} md={12}>
                    <Form.Item name="endDate" label="Ngày kết thúc" rules={[{ required: true }]}>
                      <Input type="date" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="endTime"
                      label="Thời điểm kết thúc"
                      rules={[{ required: true }]}
                    >
                      <Input type="time" />
                    </Form.Item>
                  </Col>
                </Row>
              ) : null}
              <div className="owner-promotion-toggle-row">
                <Form.Item name="useWeekdays" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <span>Áp dụng theo thứ trong tuần</span>
              </div>
              {useWeekdays ? (
                <Form.Item
                  className="owner-promotion-reveal"
                  name="weekdays"
                  rules={[{ required: true, message: 'Chọn ít nhất một ngày.' }]}
                >
                  <Checkbox.Group
                    className="owner-promotion-weekdays"
                    options={weekdayLabels.map((label, value) => ({ label, value }))}
                  />
                </Form.Item>
              ) : null}
              <div className="owner-promotion-toggle-row">
                <Form.Item name="useTimeRanges" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <span>Áp dụng theo khung giờ</span>
              </div>
              {useTimeRanges ? (
                <Form.List name="timeRanges">
                  {(fields, { add, remove }) => (
                    <Space orientation="vertical" className="owner-promotion-time-ranges">
                      {fields.map((field) => (
                        <div key={field.key} className="owner-promotion-time-range">
                          <Form.Item
                            name={[field.name, 'start']}
                            label="Thời điểm bắt đầu"
                            rules={[{ required: true }]}
                          >
                            <Input type="time" size="large" />
                          </Form.Item>
                          <Form.Item
                            name={[field.name, 'end']}
                            label="Thời điểm kết thúc"
                            rules={[{ required: true }]}
                          >
                            <Input type="time" size="large" />
                          </Form.Item>
                          {fields.length > 1 ? (
                            <Button
                              type="text"
                              danger
                              icon={<CloseOutlined />}
                              onClick={() => remove(field.name)}
                              aria-label="Xóa khung giờ"
                            />
                          ) : null}
                        </div>
                      ))}
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => add({ start: '08:00', end: '22:00' })}
                      >
                        Thêm khung giờ
                      </Button>
                    </Space>
                  )}
                </Form.List>
              ) : null}
            </Card>
            <Card>
              <Typography.Title level={4}>Áp dụng với</Typography.Title>
              <Form.Item name="scope">
                <Radio.Group>
                  <Space orientation="vertical">
                    <Radio value="INVOICE" disabled={type === 'FLAT_PRICE'}>
                      Hóa đơn
                    </Radio>
                    <Radio value="CATEGORY" disabled={type === 'GIFT'}>
                      Danh mục
                    </Radio>
                    <Radio value="PRODUCT">Mặt hàng</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
              {scope === 'CATEGORY' ? (
                <Form.Item
                  name="categoryIds"
                  label="Danh mục áp dụng"
                  rules={[{ required: true, message: 'Vui lòng chọn danh mục.' }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    options={(categories.data ?? []).map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  />
                </Form.Item>
              ) : null}
              {scope === 'PRODUCT' ? (
                <div className="owner-product-selection">
                  <Button
                    block
                    icon={<SearchOutlined />}
                    onClick={() => setProductPickerOpen(true)}
                  >
                    Tìm và chọn mặt hàng hoặc phiên bản giá
                  </Button>
                  <div className="owner-product-selection__count">
                    Đã chọn {productTargets.length}/50
                  </div>
                  <Form.Item
                    name="productTargets"
                    rules={[
                      {
                        validator: async (_, value: ProductTarget[]) => {
                          if (!value?.length) throw new Error('Vui lòng chọn mặt hàng.');
                        },
                      },
                    ]}
                    noStyle
                  >
                    <input type="hidden" />
                  </Form.Item>
                  <SelectedProductList
                    value={productTargets}
                    products={products.data ?? []}
                    showQuantity={type === 'GIFT'}
                    onChange={(value) => form.setFieldValue('productTargets', value)}
                  />
                  {type === 'GIFT' ? (
                    <div className="owner-promotion-buy-any">
                      <Form.Item name="giftBuyAny" valuePropName="checked" noStyle>
                        <Checkbox />
                      </Form.Item>
                      <span>
                        Áp dụng CTKM khi mua 1 món với số lượng tương ứng trong danh sách trên
                      </span>
                      <Tooltip title="Nếu bỏ chọn, khách hàng cần phải mua tất cả danh sách mặt hàng trên mới đủ điều kiện áp dụng khuyến mại.">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
            {type === 'GIFT' ? (
              <Card>
                <Typography.Title level={4}>Mặt hàng được tặng</Typography.Title>
                <Button block icon={<SearchOutlined />} onClick={() => setGiftPickerOpen(true)}>
                  Tìm và chọn mặt hàng hoặc phiên bản giá
                </Button>
                <div className="owner-product-selection__count">
                  Đã chọn {giftTargets.length}/50
                </div>
                <Form.Item
                  name="giftTargets"
                  rules={[
                    {
                      validator: async (_, value: ProductTarget[]) => {
                        if (!value?.length) throw new Error('Vui lòng chọn mặt hàng được tặng.');
                      },
                    },
                  ]}
                  noStyle
                >
                  <input type="hidden" />
                </Form.Item>
                <SelectedProductList
                  value={giftTargets}
                  products={products.data ?? []}
                  onChange={(value) => form.setFieldValue('giftTargets', value)}
                />
                <Form.Item
                  name="maximumGiftQuantity"
                  label="Số lượng tặng tối đa"
                  className="owner-promotion-short-field"
                >
                  <InputNumber min={1} max={999} precision={0} />
                </Form.Item>
              </Card>
            ) : null}
            <Card>
              <Typography.Title level={4}>Đối tượng áp dụng</Typography.Title>
              <Typography.Paragraph type="secondary">
                Để trống để áp dụng cho tất cả khách hàng.
              </Typography.Paragraph>
              <Form.Item name="customerGroupIds" label="Nhóm khách hàng">
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  placeholder="Tất cả khách hàng"
                  options={(groups.data ?? []).map((group) => ({
                    value: group.id,
                    label: `${group.name} · ${group.customerCount} khách`,
                  }))}
                />
              </Form.Item>
            </Card>
          </div>
          <aside>
            <Card className="owner-promotion-preview" title="Tổng quan">
              <div className="owner-promotion-ticket">
                <span>
                  {type === 'PERCENT'
                    ? `${watched?.value ?? 0}%`
                    : type === 'GIFT'
                      ? 'Tặng món'
                      : money(watched?.value)}
                </span>
                <small>{watched?.name || 'Tên chương trình khuyến mại'}</small>
              </div>
              <div className="owner-promotion-timeline">
                <p>
                  <CalendarOutlined />{' '}
                  <span>
                    Bắt đầu
                    <br />
                    <strong>
                      {watched?.startDate || inputDate(now)} ·{' '}
                      {watched?.startTime || inputTime(now)}
                    </strong>
                  </span>
                </p>
                <p>
                  <CalendarOutlined />{' '}
                  <span>
                    Kết thúc
                    <br />
                    <strong>
                      {watched?.hasEnd
                        ? `${watched?.endDate ?? '--/--'} · ${watched?.endTime ?? '--:--'}`
                        : 'Không giới hạn'}
                    </strong>
                  </span>
                </p>
              </div>
              <ul>
                <li>Áp dụng cho {scopeLabels[watched?.scope ?? 'INVOICE'].toLowerCase()}</li>
                <li>
                  {(watched?.customerGroupIds?.length ?? 0) > 0
                    ? `Áp dụng với ${watched.customerGroupIds.length} nhóm khách hàng`
                    : 'Áp dụng với tất cả khách hàng'}
                </li>
              </ul>
            </Card>
          </aside>
        </div>
        <ProductPickerModal
          open={productPickerOpen}
          title="Chọn mặt hàng áp dụng"
          products={products.data ?? []}
          value={productTargets}
          excludeWeight={type === 'GIFT'}
          onCancel={() => setProductPickerOpen(false)}
          onChange={(value) => {
            form.setFieldValue('productTargets', value);
            setProductPickerOpen(false);
          }}
        />
        <ProductPickerModal
          open={giftPickerOpen}
          title="Chọn mặt hàng được tặng"
          products={products.data ?? []}
          value={giftTargets}
          excludeWeight
          onCancel={() => setGiftPickerOpen(false)}
          onChange={(value) => {
            form.setFieldValue('giftTargets', value);
            setGiftPickerOpen(false);
          }}
        />
      </Form>
    </div>
  );
}
