import {
  BellOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MinusOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SendOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Empty, Input, Modal, Result, Spin, Tag, message } from 'antd';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import type {
  GuestMenuProduct,
  GuestMenuVariant,
  GuestOrderContext,
  GuestOrderRequestDto,
} from '@contracts/qr-order';
import { apiRequest, jsonRequest } from '@client/lib/api';

interface CartLine {
  id: string; // variantId
  product: GuestMenuProduct;
  variant: GuestMenuVariant;
  quantity: number;
  note: string;
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'M'
  );
}

export function GuestOrderPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();

  // State
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');

  // Item Customization Modal State
  const [customizingProduct, setCustomizingProduct] = useState<GuestMenuProduct | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [modalQuantity, setModalQuantity] = useState<number>(1);
  const [modalItemNote, setModalItemNote] = useState<string>('');

  // Service Confirmation Modal
  const [serviceConfirm, setServiceConfirm] = useState<{
    open: boolean;
    type: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
  }>({ open: false, type: 'CALL_STAFF' });

  // Queries
  const context = useQuery({
    queryKey: ['guest-order-context', token],
    queryFn: () => apiRequest<GuestOrderContext>(`/api/v1/guest-order/resolve/${token}`),
    enabled: Boolean(token),
    retry: false,
  });

  const requests = useQuery({
    queryKey: ['guest-order-own-requests'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/guest-order/requests'),
    enabled: context.isSuccess,
    refetchInterval: 5_000,
  });

  // Calculations
  const cartLines = Object.values(cart);
  const totalItemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAmount = cartLines.reduce(
    (sum, line) => sum + line.variant.salePriceVnd * line.quantity,
    0,
  );

  const categories = useMemo(() => {
    const rawCategories = (context.data?.menu ?? []).map((p) => p.categoryName || 'Món khác');
    return ['Tất cả', ...new Set(rawCategories)];
  }, [context.data?.menu]);

  const filteredMenu = useMemo(() => {
    const menu = context.data?.menu ?? [];
    const query = search.trim().toLowerCase();
    return menu.filter((product) => {
      const matchCat =
        selectedCategory === 'ALL' ||
        selectedCategory === 'Tất cả' ||
        (product.categoryName || 'Món khác') === selectedCategory;
      const matchSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.variants.some((v) => v.name.toLowerCase().includes(query));
      return matchCat && matchSearch;
    });
  }, [context.data?.menu, search, selectedCategory]);

  const groupedMenu = useMemo(() => {
    const map = new Map<string, GuestMenuProduct[]>();
    for (const item of filteredMenu) {
      const cat = item.categoryName || 'Món khác';
      const existing = map.get(cat) ?? [];
      existing.push(item);
      map.set(cat, existing);
    }
    return map;
  }, [filteredMenu]);

  // Actions
  const handleQuickAdd = (product: GuestMenuProduct) => {
    if (product.variants.length > 1) {
      // Open customization modal if multiple variants exist
      openCustomizationModal(product);
      return;
    }

    const defaultVariant = product.variants[0];
    if (!defaultVariant) return;

    setCart((current) => {
      const existing = current[defaultVariant.id];
      const newQty = Math.min(50, (existing?.quantity ?? 0) + 1);
      return {
        ...current,
        [defaultVariant.id]: {
          id: defaultVariant.id,
          product,
          variant: defaultVariant,
          quantity: newQty,
          note: existing?.note ?? '',
        },
      };
    });
    messageApi.success({
      content: `Đã thêm ${product.name}`,
      duration: 1.2,
      style: { marginTop: '10vh' },
    });
  };

  const handleUpdateCartQuantity = (variantId: string, delta: number) => {
    setCart((current) => {
      const item = current[variantId];
      if (!item) return current;
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        const next = { ...current };
        delete next[variantId];
        return next;
      }
      return {
        ...current,
        [variantId]: { ...item, quantity: Math.min(50, newQty) },
      };
    });
  };

  const openCustomizationModal = (product: GuestMenuProduct) => {
    setCustomizingProduct(product);
    const defaultVariant = product.variants[0];
    setSelectedVariantId(defaultVariant?.id ?? '');
    setModalQuantity(1);
    setModalItemNote('');
  };

  const handleSaveModalItem = () => {
    if (!customizingProduct) return;
    const variant =
      customizingProduct.variants.find((v) => v.id === selectedVariantId) ??
      customizingProduct.variants[0];
    if (!variant) return;

    setCart((current) => {
      const existing = current[variant.id];
      const newQty = Math.min(50, (existing?.quantity ?? 0) + modalQuantity);
      return {
        ...current,
        [variant.id]: {
          id: variant.id,
          product: customizingProduct,
          variant,
          quantity: newQty,
          note: modalItemNote.trim() || existing?.note || '',
        },
      };
    });

    setCustomizingProduct(null);
    messageApi.success({
      content: `Đã thêm ${customizingProduct.name}`,
      duration: 1.5,
      style: { marginTop: '10vh' },
    });
  };

  // Submit Order Mutation
  const submitOrder = useMutation({
    mutationFn: async () => {
      const clientRequestId = crypto.randomUUID();
      return jsonRequest<{ requestId: string }>(
        '/api/v1/guest-order/requests',
        {
          clientRequestId,
          items: cartLines.map((line) => ({
            productId: line.product.id,
            variantId: line.variant.id,
            quantity: line.quantity,
            note: line.note.trim() || undefined,
          })),
          note: orderNote.trim() || undefined,
        },
        { headers: { 'Idempotency-Key': clientRequestId } },
      );
    },
    onSuccess: async () => {
      setCart({});
      setOrderNote('');
      setCartDrawerOpen(false);
      messageApi.success('Đã gửi gọi món thành công! Quán đang chuẩn bị món cho bạn.');
      await queryClient.invalidateQueries({ queryKey: ['guest-order-own-requests'] });
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.');
    },
  });

  // Service Request Mutation (Call staff / Bill)
  const submitService = useMutation({
    mutationFn: (type: 'CALL_STAFF' | 'CHECKOUT_REQUEST') =>
      jsonRequest('/api/v1/guest-order/service-requests', { type }),
    onSuccess: (_, type) => {
      setServiceConfirm({ open: false, type: 'CALL_STAFF' });
      messageApi.success(
        type === 'CALL_STAFF'
          ? 'Đã gửi yêu cầu gọi nhân viên tới bàn.'
          : 'Đã gửi yêu cầu thanh toán. Nhân viên sẽ mang hóa đơn tới bàn.',
      );
      void queryClient.invalidateQueries({ queryKey: ['guest-order-own-requests'] });
    },
    onError: (error) => {
      setServiceConfirm({ open: false, type: 'CALL_STAFF' });
      messageApi.warning(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.');
    },
  });

  // Loading & Error States
  if (context.isLoading) {
    return (
      <div
        className="qr-guest-layout"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Spin size="large" tip="Đang tải thực đơn của quán..." />
      </div>
    );
  }

  if (context.isError || !context.data) {
    return (
      <div className="qr-guest-layout" style={{ padding: '60px 16px' }}>
        <Result
          status="warning"
          title="Không thể mở thực đơn"
          subTitle={
            context.error instanceof Error
              ? context.error.message
              : 'Bàn chưa mở phiên hoặc mã QR không còn hiệu lực. Vui lòng liên hệ nhân viên.'
          }
        />
      </div>
    );
  }

  const latestRequest = requests.data?.[0];

  return (
    <div className="qr-guest-layout">
      {holder}

      <div className="qr-guest-container">
        {/* ── 1. Hero Header Card ────────────────────────────────────────── */}
        <header className="qr-guest-hero">
          <div className="qr-guest-hero__top">
            <div>
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.85,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                <ShopOutlined /> Thực đơn gọi món
              </div>
              <h1 className="qr-guest-hero__store-title">{context.data.storeName}</h1>
            </div>

            <div className="qr-guest-hero__table-pill">
              <span className="qr-guest-hero__pulse" />
              <span>{context.data.tableName}</span>
              {context.data.areaName ? (
                <span style={{ opacity: 0.8 }}>· {context.data.areaName}</span>
              ) : null}
            </div>
          </div>

          {/* Quick Service Action Buttons */}
          <div className="qr-guest-services">
            <button
              type="button"
              className="qr-guest-service-btn qr-guest-service-btn--staff"
              onClick={() => setServiceConfirm({ open: true, type: 'CALL_STAFF' })}
            >
              <div className="qr-guest-service-btn__icon">
                <BellOutlined />
              </div>
              <div>
                <div className="qr-guest-service-btn__text">Gọi nhân viên</div>
                <div className="qr-guest-service-btn__sub">Hỗ trợ tại bàn</div>
              </div>
            </button>

            <button
              type="button"
              className="qr-guest-service-btn qr-guest-service-btn--bill"
              onClick={() => setServiceConfirm({ open: true, type: 'CHECKOUT_REQUEST' })}
            >
              <div className="qr-guest-service-btn__icon">
                <CreditCardOutlined />
              </div>
              <div>
                <div className="qr-guest-service-btn__text">Thanh toán</div>
                <div className="qr-guest-service-btn__sub">Tính tiền & in bill</div>
              </div>
            </button>
          </div>
        </header>

        {/* ── 2. Live Order Status Tracker (If previous requests exist) ─── */}
        {latestRequest ? (
          <div className="qr-guest-status-banner" onClick={() => setHistoryDrawerOpen(true)}>
            <div className="qr-guest-status-banner__left">
              <span
                className={`qr-guest-status-banner__badge ${
                  latestRequest.status === 'ACCEPTED'
                    ? 'qr-guest-status-banner__badge--accepted'
                    : 'qr-guest-status-banner__badge--pending'
                }`}
              >
                {latestRequest.status === 'ACCEPTED' ? (
                  <>
                    <CheckCircleFilled /> Quán đã nhận món
                  </>
                ) : latestRequest.status === 'REJECTED' ? (
                  <>
                    <CloseCircleFilled /> Quán từ chối
                  </>
                ) : (
                  <>
                    <ClockCircleFilled /> Đang chờ xác nhận
                  </>
                )}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="qr-guest-status-banner__title">
                  {latestRequest.items && latestRequest.items.length > 0
                    ? latestRequest.items.map((i) => `${i.productName} × ${i.quantity}`).join(', ')
                    : 'Chi tiết đợt gọi món'}
                </div>
                <div className="qr-guest-status-banner__sub">
                  {(requests.data?.length ?? 0) > 1
                    ? `Có ${requests.data?.length} đợt gọi · Bấm để xem toàn bộ`
                    : 'Bấm để xem lịch sử gọi món tại bàn'}
                </div>
              </div>
            </div>
            <RightOutlined style={{ fontSize: 13, color: '#94a3b8' }} />
          </div>
        ) : null}

        {/* ── 3. Quick Search Bar ─────────────────────────────────────────── */}
        <div className="qr-guest-search-wrap" style={{ marginTop: latestRequest ? 0 : 14 }}>
          <div className="qr-guest-search-box">
            <SearchOutlined style={{ fontSize: 16, color: '#94a3b8' }} />
            <input
              type="text"
              className="qr-guest-search-input"
              placeholder="Tìm món ăn, nước uống..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <CloseOutlined
                style={{ fontSize: 14, color: '#94a3b8', cursor: 'pointer' }}
                onClick={() => setSearch('')}
              />
            ) : null}
          </div>
        </div>

        {/* ── 4. Sticky Horizontal Category Navigation ───────────────────── */}
        <nav className="qr-guest-cat-nav">
          {categories.map((cat) => {
            const isActive =
              (selectedCategory === 'ALL' && (cat === 'Tất cả' || cat === 'ALL')) ||
              selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                className={`qr-guest-cat-pill ${isActive ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory(cat === 'Tất cả' ? 'ALL' : cat)}
              >
                {cat}
              </button>
            );
          })}
        </nav>

        {/* ── 5. Product Grid Sections ───────────────────────────────────── */}
        {filteredMenu.length === 0 ? (
          <div style={{ padding: '60px 16px', textAlign: 'center' }}>
            <Empty description="Không tìm thấy món ăn phù hợp" />
          </div>
        ) : (
          Array.from(groupedMenu.entries()).map(([categoryName, items]) => (
            <section key={categoryName} className="qr-guest-section">
              <div className="qr-guest-section__title">
                <span>{categoryName}</span>
                <span className="qr-guest-section__count">{items.length}</span>
              </div>

              <div className="qr-guest-grid">
                {items.map((product) => {
                  const defaultVariant = product.variants[0];
                  const hasMultiVariants = product.variants.length > 1;

                  // Find if any variant is currently in cart
                  const inCartLines = cartLines.filter((l) => l.product.id === product.id);
                  const totalInCartForProduct = inCartLines.reduce((s, l) => s + l.quantity, 0);

                  return (
                    <div key={product.id} className="qr-guest-card">
                      <div
                        className="qr-guest-card__img-wrap"
                        style={{
                          background:
                            product.avatarType === 'IMAGE' && product.mediaId
                              ? '#ffffff'
                              : (product.avatarColor ?? '#0877ee'),
                        }}
                        onClick={() => openCustomizationModal(product)}
                      >
                        {product.avatarType === 'IMAGE' && product.mediaId ? (
                          <img
                            src={`/api/v1/guest-order/media/${product.mediaId}`}
                            alt={product.name}
                            className="qr-guest-card__img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="qr-guest-card__avatar-letter">
                            {getInitials(product.name)}
                          </div>
                        )}

                        {product.unitName ? (
                          <span className="qr-guest-card__unit-tag">{product.unitName}</span>
                        ) : null}
                      </div>

                      <div className="qr-guest-card__content">
                        <div
                          onClick={() => openCustomizationModal(product)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="qr-guest-card__name">{product.name}</div>
                          {hasMultiVariants ? (
                            <span className="qr-guest-card__variant-badge">
                              {product.variants.length} phiên bản
                            </span>
                          ) : null}
                        </div>

                        <div className="qr-guest-card__bottom">
                          <div>
                            <span className="qr-guest-card__price">
                              {defaultVariant ? formatVnd(defaultVariant.salePriceVnd) : '—'}
                            </span>
                            {product.productType === 'WEIGHT' && product.unitName ? (
                              <span className="qr-guest-card__price-unit">/{product.unitName}</span>
                            ) : null}
                          </div>

                          {/* Quick Stepper or Add Button */}
                          {!hasMultiVariants && defaultVariant && totalInCartForProduct > 0 ? (
                            <div className="qr-guest-card__stepper">
                              <button
                                type="button"
                                className="qr-guest-card__stepper-btn"
                                onClick={() => handleUpdateCartQuantity(defaultVariant.id, -1)}
                              >
                                <MinusOutlined />
                              </button>
                              <span className="qr-guest-card__stepper-val">
                                {totalInCartForProduct}
                              </span>
                              <button
                                type="button"
                                className="qr-guest-card__stepper-btn"
                                onClick={() => handleUpdateCartQuantity(defaultVariant.id, 1)}
                              >
                                <PlusOutlined />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="qr-guest-card__add-btn"
                              aria-label={`Thêm ${product.name}`}
                              onClick={() => handleQuickAdd(product)}
                            >
                              <PlusOutlined />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}

        {/* ── 6. Floating Bottom Cart Bar ─────────────────────────────────── */}
        {totalItemCount > 0 ? (
          <div className="qr-guest-bottom-bar">
            <div className="qr-guest-bottom-bar__inner">
              <div className="qr-guest-bottom-bar__left" onClick={() => setCartDrawerOpen(true)}>
                <div className="qr-guest-bottom-bar__cart-icon">
                  <ShoppingCartOutlined />
                  <span className="qr-guest-bottom-bar__badge">{totalItemCount}</span>
                </div>
                <div className="qr-guest-bottom-bar__total-box">
                  <span className="qr-guest-bottom-bar__label">Tạm tính</span>
                  <span className="qr-guest-bottom-bar__amount">{formatVnd(totalAmount)}</span>
                </div>
              </div>

              <button
                type="button"
                className="qr-guest-bottom-bar__action-btn"
                onClick={() => setCartDrawerOpen(true)}
              >
                <span>Xem giỏ & Gọi món</span>
                <RightOutlined style={{ fontSize: 13 }} />
              </button>
            </div>
          </div>
        ) : null}

        {/* ── 7. Cart Bottom Sheet Drawer ─────────────────────────────────── */}
        <Drawer
          title={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 800 }}>Giỏ hàng ({totalItemCount} món)</span>
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => setCart({})}
              >
                Xóa tất cả
              </Button>
            </div>
          }
          placement="bottom"
          height="auto"
          open={cartDrawerOpen}
          onClose={() => setCartDrawerOpen(false)}
          styles={{
            body: { padding: '14px 16px 24px', maxHeight: '75vh', overflowY: 'auto' },
          }}
        >
          {cartLines.length === 0 ? (
            <Empty description="Giỏ hàng của bạn đang trống" style={{ padding: '20px 0' }} />
          ) : (
            <div>
              <div style={{ marginBottom: 14 }}>
                {cartLines.map((line) => (
                  <div key={line.variant.id} className="qr-guest-sheet-item">
                    <div className="qr-guest-sheet-item__info">
                      <div className="qr-guest-sheet-item__name">{line.product.name}</div>
                      <div className="qr-guest-sheet-item__meta">
                        {line.variant.name !== 'Default' && line.variant.name !== 'Mặc định' ? (
                          <Tag style={{ marginRight: 6 }}>{line.variant.name}</Tag>
                        ) : null}
                        <span className="qr-guest-sheet-item__price">
                          {formatVnd(line.variant.salePriceVnd)}
                        </span>
                      </div>
                      {line.note ? (
                        <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>
                          Ghi chú: {line.note}
                        </div>
                      ) : null}
                    </div>

                    <div className="qr-guest-sheet-item__stepper">
                      <Button
                        size="small"
                        shape="circle"
                        icon={<MinusOutlined />}
                        onClick={() => handleUpdateCartQuantity(line.variant.id, -1)}
                      />
                      <strong style={{ minWidth: 20, textAlign: 'center', fontSize: 15 }}>
                        {line.quantity}
                      </strong>
                      <Button
                        size="small"
                        shape="circle"
                        icon={<PlusOutlined />}
                        onClick={() => handleUpdateCartQuantity(line.variant.id, 1)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Table Order Note */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#334155' }}>
                  <FileTextOutlined /> Ghi chú cho cả bàn:
                </div>
                <Input.TextArea
                  rows={2}
                  maxLength={200}
                  showCount
                  placeholder="Ví dụ: Mang thêm đá lạnh, mang trước nước ngọt..."
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                />
              </div>

              {/* Order Total & Submit Button */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderTop: '1px solid #e2e8f0',
                  marginBottom: 14,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: '#64748b' }}>
                  Tổng thanh toán:
                </span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#e11d48' }}>
                  {formatVnd(totalAmount)}
                </span>
              </div>

              <Button
                type="primary"
                size="large"
                block
                icon={<SendOutlined />}
                loading={submitOrder.isPending}
                style={{
                  height: 50,
                  borderRadius: 14,
                  fontSize: 16,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #0b63d6 0%, #0877ee 100%)',
                }}
                onClick={() => submitOrder.mutate()}
              >
                Gửi yêu cầu gọi món ({formatVnd(totalAmount)})
              </Button>
            </div>
          )}
        </Drawer>

        {/* ── 8. Product Customization Bottom Sheet Modal ─────────────────── */}
        <Modal
          open={Boolean(customizingProduct)}
          title={customizingProduct?.name}
          footer={null}
          centered
          onCancel={() => setCustomizingProduct(null)}
          styles={{ body: { padding: '12px 4px 4px' } }}
        >
          {customizingProduct ? (
            <div>
              {customizingProduct.avatarType === 'IMAGE' && customizingProduct.mediaId ? (
                <img
                  src={`/api/v1/guest-order/media/${customizingProduct.mediaId}`}
                  alt={customizingProduct.name}
                  className="qr-guest-modal-img"
                />
              ) : null}

              {/* Variants Selector */}
              {customizingProduct.variants.length > 1 ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#334155' }}>
                    Chọn phiên bản:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {customizingProduct.variants.map((v) => {
                      const isSelected = v.id === selectedVariantId;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={`qr-guest-variant-btn ${isSelected ? 'is-active' : ''}`}
                          onClick={() => setSelectedVariantId(v.id)}
                        >
                          <div>{v.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>
                            {formatVnd(v.salePriceVnd)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Item Note */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#334155' }}>
                  Ghi chú cho món này (tùy chọn):
                </div>
                <Input
                  placeholder="Ví dụ: Ít đường, không đá, nhiều ớt..."
                  value={modalItemNote}
                  maxLength={100}
                  onChange={(e) => setModalItemNote(e.target.value)}
                />
              </div>

              {/* Quantity Stepper & Add Action */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button
                    size="large"
                    shape="circle"
                    icon={<MinusOutlined />}
                    disabled={modalQuantity <= 1}
                    onClick={() => setModalQuantity((q) => Math.max(1, q - 1))}
                  />
                  <span
                    style={{ fontSize: 18, fontWeight: 800, minWidth: 28, textAlign: 'center' }}
                  >
                    {modalQuantity}
                  </span>
                  <Button
                    size="large"
                    shape="circle"
                    icon={<PlusOutlined />}
                    onClick={() => setModalQuantity((q) => Math.min(50, q + 1))}
                  />
                </div>

                {(() => {
                  const currentVar =
                    customizingProduct.variants.find((v) => v.id === selectedVariantId) ??
                    customizingProduct.variants[0];
                  const linePrice = (currentVar?.salePriceVnd ?? 0) * modalQuantity;
                  return (
                    <Button
                      type="primary"
                      size="large"
                      style={{
                        height: 46,
                        borderRadius: 12,
                        fontWeight: 700,
                        padding: '0 20px',
                        background: '#0877ee',
                      }}
                      onClick={handleSaveModalItem}
                    >
                      Thêm · {formatVnd(linePrice)}
                    </Button>
                  );
                })()}
              </div>
            </div>
          ) : null}
        </Modal>

        {/* ── 9. Order Timeline History Drawer ─────────────────────────────── */}
        <Drawer
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HistoryOutlined style={{ color: '#0877ee' }} />
              <span style={{ fontSize: 17, fontWeight: 800 }}>Lịch sử gọi món tại bàn</span>
            </div>
          }
          placement="bottom"
          height="80vh"
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          styles={{ body: { padding: '14px 16px', background: '#f8fafc' } }}
        >
          {!requests.data || requests.data.length === 0 ? (
            <Empty
              description="Chưa có đợt gọi món nào trong phiên này"
              style={{ padding: '40px 0' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {requests.data.map((req, index) => {
                const batchTotal = (req.items ?? []).reduce(
                  (sum, item) => sum + item.lineTotalVnd,
                  0,
                );
                return (
                  <div
                    key={req.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: 14,
                      padding: 14,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                        paddingBottom: 8,
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>
                        Đợt #{requests.data!.length - index}
                      </span>
                      <Tag
                        color={
                          req.status === 'ACCEPTED'
                            ? 'success'
                            : req.status === 'REJECTED'
                              ? 'error'
                              : 'processing'
                        }
                        style={{ borderRadius: 6, fontWeight: 700 }}
                      >
                        {req.status === 'ACCEPTED'
                          ? 'Quán đã nhận'
                          : req.status === 'REJECTED'
                            ? 'Bị từ chối'
                            : 'Đang chờ xử lý'}
                      </Tag>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {req.items?.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: 13.5,
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600 }}>{item.productName}</span>
                            {item.variantName && item.variantName !== 'Default' ? (
                              <span style={{ color: '#64748b', fontSize: 12 }}>
                                {' '}
                                ({item.variantName})
                              </span>
                            ) : null}
                            <span style={{ color: '#0877ee', fontWeight: 700, marginLeft: 6 }}>
                              × {item.quantity}
                            </span>
                          </div>
                          <span style={{ fontWeight: 700, color: '#475569' }}>
                            {formatVnd(item.lineTotalVnd)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {req.note ? (
                      <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 8 }}>
                        Ghi chú: {req.note}
                      </div>
                    ) : null}

                    {req.rejectedReason ? (
                      <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>
                        Lý do từ chối: {req.rejectedReason}
                      </div>
                    ) : null}

                    {batchTotal > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          marginTop: 10,
                          paddingTop: 8,
                          borderTop: '1px dashed #e2e8f0',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#0f172a',
                        }}
                      >
                        Tổng đợt: {formatVnd(batchTotal)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Drawer>

        {/* ── 10. Service Call / Bill Confirmation Modal ───────────────────── */}
        <Modal
          open={serviceConfirm.open}
          title={
            serviceConfirm.type === 'CALL_STAFF'
              ? 'Xác nhận gọi nhân viên'
              : 'Xác nhận yêu cầu thanh toán'
          }
          okText="Xác nhận gửi"
          cancelText="Hủy"
          confirmLoading={submitService.isPending}
          centered
          onOk={() => submitService.mutate(serviceConfirm.type)}
          onCancel={() => setServiceConfirm({ open: false, type: 'CALL_STAFF' })}
        >
          <div style={{ padding: '8px 0', fontSize: 14.5, color: '#334155', lineHeight: 1.5 }}>
            {serviceConfirm.type === 'CALL_STAFF' ? (
              <p>
                Bạn muốn gửi tín hiệu <strong>gọi nhân viên phục vụ</strong> đến{' '}
                <strong>{context.data.tableName}</strong>? Nhân viên sẽ tới bàn hỗ trợ bạn ngay.
              </p>
            ) : (
              <p>
                Bạn muốn <strong>yêu cầu thanh toán</strong> cho{' '}
                <strong>{context.data.tableName}</strong>? Thu ngân sẽ chốt giờ chơi và mang hóa đơn
                tới bàn.
              </p>
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
}
