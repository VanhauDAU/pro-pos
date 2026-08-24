import {
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  HourglassOutlined,
  MinusOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SendOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Result,
  Spin,
  Tag,
  message,
} from 'antd';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';

import type {
  GuestMenuProduct,
  GuestMenuVariant,
  GuestOrderContext,
  GuestOrderRequestDto,
} from '@contracts/qr-order';
import { apiRequest, jsonRequest } from '@client/lib/api';
import { GuestRobotAssistant } from './GuestRobotAssistant';
import { type GuestAssistantAction, type GuestAssistantFeedback } from './guest-assistant';

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
  const assistantFeedbackId = useRef(0);
  const guestPollingStartedAt = useRef(Date.now());
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  // State
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');

  // Cart Item Note Editing
  const [editingNoteVariantId, setEditingNoteVariantId] = useState<string | null>(null);
  const [tempItemNote, setTempItemNote] = useState<string>('');

  // Order Success Celebration Modal
  const [orderSuccessModalOpen, setOrderSuccessModalOpen] = useState(false);

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
  const [assistantFeedback, setAssistantFeedback] = useState<GuestAssistantFeedback | null>(null);

  const showAssistantFeedback = useCallback(
    (tone: GuestAssistantFeedback['tone'], feedbackMessage: string) => {
      assistantFeedbackId.current += 1;
      setAssistantFeedback({
        id: assistantFeedbackId.current,
        tone,
        message: feedbackMessage,
      });
    },
    [],
  );

  // Queries
  const context = useQuery({
    queryKey: ['guest-order-context', token],
    queryFn: () => apiRequest<GuestOrderContext>(`/api/v1/guest-order/resolve/${token}`),
    enabled: Boolean(token),
    retry: false,
    refetchInterval: (query) => {
      if (
        query.state.data?.tableStatus !== 'OPEN_REQUESTED' ||
        document.visibilityState === 'hidden' ||
        !navigator.onLine
      ) {
        return false;
      }
      const elapsed = Date.now() - guestPollingStartedAt.current;
      return elapsed < 30_000 ? 5_000 : elapsed < 120_000 ? 15_000 : 30_000;
    },
  });

  const requests = useQuery({
    queryKey: ['guest-order-own-requests', token],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/guest-order/requests'),
    enabled: context.data?.tableStatus === 'OPEN',
    refetchInterval: () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return false;
      const elapsed = Date.now() - guestPollingStartedAt.current;
      return elapsed < 30_000 ? 5_000 : elapsed < 120_000 ? 15_000 : 30_000;
    },
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

  const QUICK_TABLE_NOTES = [
    '🧊 Thêm đá lạnh',
    '🥢 Thêm chén đũa/ly',
    '🌶️ Ít cay / không cay',
    '🥤 Mang nước trước',
    '⚡ Làm nhanh giúp em',
    '🥡 Cho mang về',
  ];

  const handleToggleQuickNote = (chipText: string) => {
    setOrderNote((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chipText;
      if (trimmed.includes(chipText)) {
        return trimmed
          .replace(chipText, '')
          .replace(/,\s*,/g, ',')
          .replace(/^,\s*|,\s*$/g, '')
          .trim();
      }
      return `${trimmed}, ${chipText}`;
    });
  };

  const handleUpdateItemNote = (variantId: string, note: string) => {
    setCart((current) => {
      const item = current[variantId];
      if (!item) return current;
      return {
        ...current,
        [variantId]: {
          ...item,
          note: note.trim(),
        },
      };
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
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(40);
      }
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
      setOrderSuccessModalOpen(true);
      showAssistantFeedback(
        'success',
        'Đã gửi gọi món thành công. Quán đang chuẩn bị món cho bạn.',
      );
      messageApi.success('Đã gửi gọi món thành công! Quán đang chuẩn bị món cho bạn.');
      await queryClient.invalidateQueries({ queryKey: ['guest-order-own-requests'] });
    },
    onError: (error) => {
      showAssistantFeedback(
        'error',
        error instanceof Error ? error.message : 'Không thể gửi yêu cầu gọi món.',
      );
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
      showAssistantFeedback(
        'success',
        type === 'CALL_STAFF'
          ? 'Đã gọi nhân viên. Bạn vui lòng chờ trong giây lát.'
          : 'Đã gửi yêu cầu thanh toán. Nhân viên sẽ mang hóa đơn tới bàn.',
      );
      void queryClient.invalidateQueries({ queryKey: ['guest-order-own-requests'] });
    },
    onError: (error) => {
      setServiceConfirm({ open: false, type: 'CALL_STAFF' });
      showAssistantFeedback(
        'error',
        error instanceof Error ? error.message : 'Không thể gửi yêu cầu.',
      );
      messageApi.warning(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.');
    },
  });

  const requestTableOpen = useMutation({
    mutationFn: () =>
      jsonRequest<{ requestId: string | null; alreadyOpen: boolean }>(
        `/api/v1/guest-order/resolve/${token}/open-request`,
        {},
      ),
    onSuccess: async (result) => {
      messageApi.success(
        result.alreadyOpen
          ? 'Bàn đã được mở. Đang tải phiên gọi món...'
          : 'Đã báo nhân viên. Bạn có thể chọn món trong lúc chờ.',
      );
      showAssistantFeedback(
        'success',
        result.alreadyOpen
          ? 'Bàn đã sẵn sàng. Bạn có thể gọi món ngay.'
          : 'Đã gửi yêu cầu mở bàn. Nhân viên sẽ hỗ trợ bạn ngay.',
      );
      await context.refetch();
    },
    onError: (error) => {
      showAssistantFeedback(
        'error',
        error instanceof Error ? error.message : 'Không thể gửi yêu cầu mở bàn.',
      );
      messageApi.error(error instanceof Error ? error.message : 'Không thể gửi yêu cầu mở bàn.');
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
  const isTableOpen = context.data.tableStatus === 'OPEN';
  const isWaitingForOpen = context.data.tableStatus === 'OPEN_REQUESTED';
  const mediaUrl = (mediaId: string) =>
    isTableOpen
      ? `/api/v1/guest-order/media/${mediaId}`
      : `/api/v1/guest-order/resolve/${token}/media/${mediaId}`;

  const handleAssistantAction = (action: GuestAssistantAction) => {
    if (action === 'BROWSE_MENU') {
      window.setTimeout(() => {
        menuAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }
    if (action === 'OPEN_TABLE') {
      if (!requestTableOpen.isPending && !isWaitingForOpen) requestTableOpen.mutate();
      return;
    }
    if (!isTableOpen) return;
    setServiceConfirm({
      open: true,
      type: action === 'CALL_STAFF' ? 'CALL_STAFF' : 'CHECKOUT_REQUEST',
    });
  };

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
        </header>

        {!isTableOpen ? (
          <Alert
            className="qr-guest-table-open-alert"
            type={isWaitingForOpen ? 'info' : 'warning'}
            showIcon
            icon={<HourglassOutlined />}
            title={isWaitingForOpen ? 'Đang chờ nhân viên mở bàn' : 'Bàn chưa được mở'}
            description={
              <div className="qr-guest-table-open-alert__content">
                <span>
                  {isWaitingForOpen
                    ? 'Bạn cứ chọn món vào giỏ. Trang sẽ tự cập nhật ngay khi bàn được mở.'
                    : 'Chạm trợ lý Pro POS phía dưới để yêu cầu mở bàn. Bạn vẫn có thể xem menu và chọn món trước.'}
                </span>
              </div>
            }
          />
        ) : null}

        <GuestRobotAssistant
          key={token}
          token={token ?? 'unknown'}
          tableStatus={context.data.tableStatus}
          hasCart={totalItemCount > 0}
          actionPending={requestTableOpen.isPending || submitService.isPending}
          feedback={assistantFeedback}
          onAction={handleAssistantAction}
        />

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
        <div
          ref={menuAnchorRef}
          id="qr-guest-menu"
          className="qr-guest-search-wrap"
          style={{ marginTop: latestRequest ? 0 : 14 }}
        >
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
                        className={`qr-guest-card__img-wrap ${product.avatarColor ? 'has-custom-color' : ''}`}
                        style={{
                          background: product.avatarColor || '#f8fafc',
                        }}
                        onClick={() => openCustomizationModal(product)}
                      >
                        {product.avatarType === 'IMAGE' && product.mediaId ? (
                          <img
                            src={mediaUrl(product.mediaId)}
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
          placement="bottom"
          height="auto"
          open={cartDrawerOpen}
          onClose={() => {
            setCartDrawerOpen(false);
            setEditingNoteVariantId(null);
          }}
          closeIcon={null}
          rootClassName="qr-cart-drawer-root"
          styles={{
            body: { padding: 0, maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
          }}
        >
          {/* Top Drag Bar & Header */}
          <div className="qr-cart-sheet-top">
            <div className="qr-cart-drag-handle" />
            <div className="qr-cart-header">
              <div className="qr-cart-header__left">
                <div className="qr-cart-header__title-row">
                  <span className="qr-cart-header__title">Giỏ hàng của bạn</span>
                  <span className="qr-cart-header__count-badge">{totalItemCount} món</span>
                </div>
                {context.data?.table ? (
                  <div className="qr-cart-header__table-badge">
                    <ShopOutlined />
                    <span>
                      {context.data.table.name}
                      {context.data.table.areaName ? ` • ${context.data.table.areaName}` : ''}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="qr-cart-header__right">
                {cartLines.length > 0 ? (
                  <Popconfirm
                    title="Xóa tất cả món trong giỏ?"
                    description="Bạn có chắc muốn làm trống giỏ hàng không?"
                    okText="Xóa tất cả"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                      setCart({});
                      setCartDrawerOpen(false);
                    }}
                  >
                    <button type="button" className="qr-cart-clear-btn" aria-label="Xóa tất cả món">
                      <DeleteOutlined />
                      <span>Xóa hết</span>
                    </button>
                  </Popconfirm>
                ) : null}
                <button
                  type="button"
                  className="qr-cart-close-btn"
                  onClick={() => setCartDrawerOpen(false)}
                  aria-label="Đóng giỏ hàng"
                >
                  <CloseOutlined />
                </button>
              </div>
            </div>
          </div>

          {cartLines.length === 0 ? (
            <div className="qr-cart-empty-state">
              <div className="qr-cart-empty-icon">
                <ShoppingCartOutlined />
              </div>
              <div className="qr-cart-empty-title">Giỏ hàng đang trống</div>
              <div className="qr-cart-empty-desc">
                Hãy khám phá các món ngon hấp dẫn và thêm vào giỏ để gọi món nhé!
              </div>
              <Button
                type="primary"
                size="large"
                className="qr-cart-empty-btn"
                onClick={() => setCartDrawerOpen(false)}
              >
                Khám phá thực đơn
              </Button>
            </div>
          ) : (
            <div className="qr-cart-sheet-body">
              {/* Cart Items List */}
              <div className="qr-cart-items-list">
                {cartLines.map((line) => {
                  const isEditingNote = editingNoteVariantId === line.variant.id;
                  const hasCustomAvatar = Boolean(
                    line.product.avatarType === 'IMAGE' && line.product.mediaId,
                  );
                  const isMultiVariants =
                    line.variant.name !== 'Default' && line.variant.name !== 'Mặc định';

                  return (
                    <div key={line.variant.id} className="qr-cart-item-card">
                      <div className="qr-cart-item-main">
                        {/* Thumbnail / Avatar */}
                        <div
                          className={`qr-cart-item-thumb ${line.product.avatarColor ? 'has-custom-color' : ''}`}
                          style={{ background: line.product.avatarColor || '#f1f5f9' }}
                        >
                          {hasCustomAvatar ? (
                            <img
                              src={mediaUrl(line.product.mediaId!)}
                              alt={line.product.name}
                              className="qr-cart-item-img"
                              loading="lazy"
                            />
                          ) : (
                            <span className="qr-cart-item-avatar-letter">
                              {getInitials(line.product.name)}
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="qr-cart-item-info">
                          <div className="qr-cart-item-name">{line.product.name}</div>
                          <div className="qr-cart-item-meta">
                            {isMultiVariants ? (
                              <Tag className="qr-cart-variant-tag">{line.variant.name}</Tag>
                            ) : null}
                            <span className="qr-cart-item-unit-price">
                              {formatVnd(line.variant.salePriceVnd)}
                              {line.product.productType === 'WEIGHT' && line.product.unitName
                                ? `/${line.product.unitName}`
                                : ''}
                            </span>
                          </div>
                          <div className="qr-cart-item-total-price">
                            {formatVnd(line.variant.salePriceVnd * line.quantity)}
                          </div>
                        </div>

                        {/* Stepper */}
                        <div className="qr-cart-item-stepper">
                          <button
                            type="button"
                            className={`qr-cart-stepper-btn ${line.quantity === 1 ? 'is-delete' : ''}`}
                            aria-label={line.quantity === 1 ? 'Xóa món' : 'Giảm số lượng'}
                            onClick={() => handleUpdateCartQuantity(line.variant.id, -1)}
                          >
                            {line.quantity === 1 ? (
                              <DeleteOutlined style={{ fontSize: 13, color: '#ef4444' }} />
                            ) : (
                              <MinusOutlined style={{ fontSize: 12 }} />
                            )}
                          </button>
                          <span className="qr-cart-stepper-val">{line.quantity}</span>
                          <button
                            type="button"
                            className="qr-cart-stepper-btn"
                            aria-label="Tăng số lượng"
                            onClick={() => handleUpdateCartQuantity(line.variant.id, 1)}
                          >
                            <PlusOutlined style={{ fontSize: 12 }} />
                          </button>
                        </div>
                      </div>

                      {/* Item Note Section */}
                      <div className="qr-cart-item-note-section">
                        {isEditingNote ? (
                          <div className="qr-cart-item-note-edit">
                            <Input
                              size="small"
                              placeholder="Ghi chú món này (vd: ít đường, không đá...)"
                              value={tempItemNote}
                              maxLength={100}
                              autoFocus
                              onChange={(e) => setTempItemNote(e.target.value)}
                              onPressEnter={() => {
                                handleUpdateItemNote(line.variant.id, tempItemNote);
                                setEditingNoteVariantId(null);
                              }}
                              className="qr-cart-item-note-input"
                            />
                            <div className="qr-cart-item-note-edit-actions">
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  handleUpdateItemNote(line.variant.id, tempItemNote);
                                  setEditingNoteVariantId(null);
                                }}
                              >
                                Lưu
                              </Button>
                              <Button size="small" onClick={() => setEditingNoteVariantId(null)}>
                                Hủy
                              </Button>
                            </div>
                          </div>
                        ) : line.note ? (
                          <div className="qr-cart-item-note-badge">
                            <span className="qr-cart-item-note-text">
                              📝 <strong>Ghi chú:</strong> {line.note}
                            </span>
                            <div className="qr-cart-item-note-btns">
                              <button
                                type="button"
                                className="qr-cart-note-action-btn"
                                onClick={() => {
                                  setEditingNoteVariantId(line.variant.id);
                                  setTempItemNote(line.note);
                                }}
                              >
                                <EditOutlined /> Sửa
                              </button>
                              <button
                                type="button"
                                className="qr-cart-note-action-btn is-danger"
                                onClick={() => handleUpdateItemNote(line.variant.id, '')}
                              >
                                <CloseOutlined />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="qr-cart-add-note-btn"
                            onClick={() => {
                              setEditingNoteVariantId(line.variant.id);
                              setTempItemNote('');
                            }}
                          >
                            <PlusOutlined style={{ fontSize: 10 }} /> Thêm ghi chú món
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Table Order Notes & Quick Suggestions */}
              <div className="qr-cart-table-note-card">
                <div className="qr-cart-table-note-header">
                  <span className="qr-cart-table-note-title">
                    <FileTextOutlined /> Ghi chú cho cả bàn
                  </span>
                  <span className="qr-cart-table-note-hint">Chạm gợi ý để chọn nhanh</span>
                </div>

                <div className="qr-cart-quick-chips">
                  {QUICK_TABLE_NOTES.map((chip) => {
                    const isSelected = orderNote.includes(chip);
                    return (
                      <button
                        key={chip}
                        type="button"
                        className={`qr-cart-quick-chip ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleToggleQuickNote(chip)}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>

                <Input.TextArea
                  rows={2}
                  maxLength={200}
                  showCount
                  placeholder="Nhập thêm ghi chú phục vụ cho nhà hàng nếu cần..."
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  className="qr-cart-table-note-input"
                />
              </div>

              {/* Summary Breakdown */}
              <div className="qr-cart-summary-card">
                <div className="qr-cart-summary-row">
                  <span className="qr-cart-summary-label">Số lượng món</span>
                  <span className="qr-cart-summary-val">
                    {totalItemCount} phần ({cartLines.length} món)
                  </span>
                </div>
                <div className="qr-cart-summary-row">
                  <span className="qr-cart-summary-label">Bàn phục vụ</span>
                  <span className="qr-cart-summary-val">{context.data?.table.name}</span>
                </div>
                <div className="qr-cart-summary-divider" />
                <div className="qr-cart-summary-row is-total">
                  <div className="qr-cart-summary-total-label">
                    <span>Tổng thanh toán</span>
                    <small>(Tạm tính)</small>
                  </div>
                  <span className="qr-cart-summary-total-amount">{formatVnd(totalAmount)}</span>
                </div>
              </div>

              {/* Sticky Submit Button Box */}
              <div className="qr-cart-footer-box">
                <button
                  type="button"
                  className="qr-cart-submit-btn"
                  disabled={submitOrder.isPending || !isTableOpen}
                  onClick={() => submitOrder.mutate()}
                >
                  <div className="qr-cart-submit-btn__content">
                    <span className="qr-cart-submit-btn__icon">
                      {submitOrder.isPending ? <Spin size="small" /> : <SendOutlined />}
                    </span>
                    <span className="qr-cart-submit-btn__text">
                      {submitOrder.isPending
                        ? 'Đang gửi yêu cầu...'
                        : isTableOpen
                          ? 'Gửi yêu cầu gọi món'
                          : 'Chờ nhân viên mở bàn'}
                    </span>
                    <span className="qr-cart-submit-btn__badge">{formatVnd(totalAmount)}</span>
                  </div>
                </button>
                <div className="qr-cart-footer-tip">
                  <ThunderboltOutlined style={{ color: '#f59e0b' }} /> Món sẽ được chuyển ngay đến
                  quầy bar / bếp chế biến
                </div>
              </div>
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
                  className={`qr-guest-modal-img ${customizingProduct.avatarColor ? 'has-custom-color' : ''}`}
                  style={{ background: customizingProduct.avatarColor || '#f8fafc' }}
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

        {/* ── 11. Order Success Modal ──────────────────────────────────────── */}
        <Modal
          open={orderSuccessModalOpen}
          footer={null}
          centered
          closable={false}
          className="qr-order-success-modal"
          styles={{ body: { padding: '28px 20px 24px', textAlign: 'center' } }}
        >
          <div className="qr-success-anim-wrap">
            <CheckCircleFilled className="qr-success-icon" />
          </div>
          <div className="qr-success-title">Gọi món thành công!</div>
          <div className="qr-success-desc">
            Yêu cầu gọi món tại <strong>{context.data?.table?.name || 'bàn của bạn'}</strong> đã
            được chuyển đến quầy phục vụ và đang được chuẩn bị.
          </div>
          <div className="qr-success-actions">
            <Button
              type="primary"
              size="large"
              block
              className="qr-success-view-btn"
              onClick={() => {
                setOrderSuccessModalOpen(false);
                setHistoryDrawerOpen(true);
              }}
            >
              <HistoryOutlined /> Xem tiến độ & Lịch sử gọi món
            </Button>
            <Button
              size="large"
              block
              className="qr-success-continue-btn"
              onClick={() => setOrderSuccessModalOpen(false)}
            >
              Tiếp tục xem thực đơn
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
