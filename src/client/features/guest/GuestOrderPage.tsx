import {
  ArrowRightOutlined,
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
  SyncOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Result,
  Spin,
  Switch,
  Tag,
  message,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';

import type {
  GuestActiveOrderDto,
  GuestMenuProduct,
  GuestMenuVariant,
  GuestOrderContext,
  GuestOrderRequestDto,
  VerifyGuestLocationResponse,
} from '@contracts/qr-order';
import type {
  PosReceiptPrintData,
  PosReceiptPrintOptions,
} from '@domain/receipt/receipt-generator';
import { apiRequest, jsonRequest } from '@client/lib/api';
import { playPosSound } from '@client/lib/sound';
import { ReceiptPreviewPaper } from '@client/features/pos/ReceiptPreviewModal';
import { GuestRobotAssistant, RobotVisual } from './GuestRobotAssistant';
import { type GuestAssistantAction, type GuestAssistantFeedback } from './guest-assistant';

interface CartLine {
  id: string; // variantId
  product: GuestMenuProduct;
  variant: GuestMenuVariant;
  quantity: number;
  note: string;
}

interface GuestLocationCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: number;
}

async function geolocationPermissionState(): Promise<PermissionState | 'unsupported'> {
  if (!('geolocation' in navigator)) return 'unsupported';
  if (!('permissions' in navigator)) return 'prompt';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'prompt';
  }
}

function currentBrowserLocation(): Promise<GuestLocationCoordinates> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: Date.now(),
        }),
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function formatElapsedDetail(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}g ${m}p ${s}s`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
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
  const guestNameStorageKey = token ? `qr_customer_name_${token}` : 'qr_guest_name';
  const [customerName, setCustomerName] = useState(() => {
    try {
      return (
        localStorage.getItem(guestNameStorageKey) || localStorage.getItem('qr_guest_name') || ''
      );
    } catch {
      return '';
    }
  });
  const [hasEnteredName, setHasEnteredName] = useState(() => {
    try {
      const saved =
        localStorage.getItem(guestNameStorageKey) || localStorage.getItem('qr_guest_name');
      return Boolean(saved && saved.trim());
    } catch {
      return false;
    }
  });
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [tempCustomerName, setTempCustomerName] = useState(() => customerName || '');
  const [autoRequestTableOpen, setAutoRequestTableOpen] = useState(true);

  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [activeOrderDrawerOpen, setActiveOrderDrawerOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');

  // Anti-spam cooldowns (seconds)
  const [callStaffCooldown, setCallStaffCooldown] = useState(0);
  const [checkoutCooldown, setCheckoutCooldown] = useState(0);
  const lastVerifiedCoords = useRef<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAt: number;
  } | null>(null);

  // Local client timer for hourly billing (no server polling per second)
  const [clientNow, setClientNow] = useState(() => Date.now());

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

  // Decrement anti-spam cooldowns
  useEffect(() => {
    if (callStaffCooldown <= 0 && checkoutCooldown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCallStaffCooldown((c) => Math.max(0, c - 1));
      setCheckoutCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callStaffCooldown > 0, checkoutCooldown > 0]);

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

  const isTableOpen = context.data?.tableStatus === 'OPEN';

  // Dedicated Active Order Query (no 10s heavy quote polling, initial data from context)
  const activeOrderQuery = useQuery({
    queryKey: ['guest-active-order', token],
    queryFn: () =>
      apiRequest<GuestActiveOrderDto>(`/api/v1/guest-order/resolve/${token}/active-order`),
    enabled: isTableOpen,
    initialData: context.data?.activeOrder ?? undefined,
    staleTime: 60_000,
  });

  // Client-side local timer for live time ticking (runs only when time session is running)
  useEffect(() => {
    if (!isTableOpen || activeOrderQuery.data?.time?.status !== 'RUNNING') return undefined;
    const timer = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isTableOpen, activeOrderQuery.data?.time?.status]);

  const requests = useQuery({
    queryKey: ['guest-order-own-requests', token],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/guest-order/requests'),
    enabled: isTableOpen,
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

  const provisionalReceiptOptions = useMemo<PosReceiptPrintOptions | null>(() => {
    if (!activeOrderQuery.data || !context.data) return null;
    const order = activeOrderQuery.data;
    const printData: PosReceiptPrintData = {
      receiptType: 'PROVISIONAL',
      orderCode: order.displayCode || order.id.slice(-6).toUpperCase(),
      orderType: 'DINE_IN',
      tableName: context.data.tableName,
      areaName: context.data.areaName,
      cashierName: null,
      customerName: customerName.trim() || null,
      guestPhone: null,
      guestAddress: null,
      note: null,
      checkInTimeMs: order.openedAt,
      issuedAtMs: order.calculatedAt || Date.now(),
      subtotal: order.subtotalVnd,
      discountTotal: order.discountTotalVnd,
      promotionDiscount: 0,
      total: order.totalVnd,
      lines: [
        ...(order.time
          ? [
              {
                id: 'time-session',
                name: 'Tiền giờ',
                quantity: 1,
                unitPrice: order.time.basePriceVnd ?? order.time.amountAfterRoundingVnd,
                totalPrice: order.time.amountAfterRoundingVnd,
                isTime: true,
                timeStartedAtMs: order.time.startedAtMs,
                timeEndedAtMs: order.time.endedAtMs,
                timeElapsedSeconds: order.time.elapsedSeconds,
                timeSegments: order.time.segments?.map((s) => ({
                  name: s.name,
                  type: s.type,
                  startedAtMs: s.startedAtMs,
                  endedAtMs: s.endedAtMs,
                  elapsedSeconds: s.elapsedSeconds,
                  priceVnd: s.priceVnd,
                  amount: s.amountAfterRoundingVnd,
                })),
              },
            ]
          : []),
        ...order.items.map((it) => ({
          id: it.id,
          name:
            it.variantName && it.variantName !== 'Mặc định' && it.variantName !== 'Default'
              ? `${it.productName} (${it.variantName})`
              : it.productName,
          quantity: it.quantityMilli / 1000,
          unitPrice: it.unitPriceVnd,
          totalPrice: it.netLineTotalVnd,
          unitName: it.unitName,
          note: it.note,
          discountAmount: it.discountAmountVnd,
          isTime: it.productType === 'TIME',
        })),
      ],
    };

    const storeInfo = context.data.storeInfo;
    const printSettings = context.data.printSettings;

    return {
      data: printData,
      printSettings: printSettings ?? null,
      storeInfo: {
        storeName: storeInfo?.name ?? context.data.storeName,
        phone: storeInfo?.phone ?? null,
        address: storeInfo?.address ?? null,
        bankName: storeInfo?.bankName ?? null,
        bankAccountNumber: storeInfo?.bankAccountNumber ?? null,
        bankAccountName: storeInfo?.bankAccountName ?? null,
        bankQrMediaId: storeInfo?.bankQrMediaId ?? null,
      },
    };
  }, [activeOrderQuery.data, context.data]);

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

  const handleConfirmName = (nameToSave?: string, shouldTriggerTableOpen?: boolean) => {
    const raw = nameToSave ?? tempCustomerName;
    const finalName = raw.trim() || 'Khách tại bàn';
    setCustomerName(finalName);
    setTempCustomerName(finalName);
    setHasEnteredName(true);
    setNameModalOpen(false);
    try {
      localStorage.setItem(guestNameStorageKey, finalName);
      localStorage.setItem('qr_guest_name', finalName);
    } catch {}

    if (
      shouldTriggerTableOpen &&
      !isTableOpen &&
      !isWaitingForOpen &&
      !requestTableOpen.isPending
    ) {
      void executeWithLocationCheck((coords) =>
        requestTableOpen.mutate({ coords, customerNameOverride: finalName }),
      );
    }
  };

  // Submit Order Mutation
  const submitOrder = useMutation({
    mutationFn: async (coords?: {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt?: number;
    }) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(40);
      }
      const clientRequestId = crypto.randomUUID();
      const loc = coords ?? lastVerifiedCoords.current ?? undefined;
      return jsonRequest<{ requestId: string }>(
        '/api/v1/guest-order/requests',
        {
          clientRequestId,
          customerName: customerName.trim() || undefined,
          items: cartLines.map((line) => ({
            productId: line.product.id,
            variantId: line.variant.id,
            quantity: line.quantity,
            note: line.note.trim() || undefined,
          })),
          note: orderNote.trim() || undefined,
          ...(loc ? { location: loc } : {}),
        },
        { headers: { 'Idempotency-Key': clientRequestId } },
      );
    },
    onSuccess: async () => {
      playPosSound('GUEST_ORDER_SENT');
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
      void activeOrderQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['guest-active-order'] });
      void queryClient.invalidateQueries({ queryKey: ['guest-order-context', token] });
    },
    onError: (error) => {
      const isLocErr =
        (error as { code?: string })?.code === 'LOCATION_VERIFICATION_REQUIRED' ||
        (error instanceof Error && error.message.includes('xác minh vị trí'));
      if (isLocErr) {
        lastVerifiedCoords.current = null;
      }
      showAssistantFeedback(
        'error',
        error instanceof Error ? error.message : 'Không thể gửi yêu cầu gọi món.',
      );
      messageApi.error(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.');
    },
  });

  // Service Request Mutation (Call staff / Bill)
  const submitService = useMutation({
    mutationFn: ({
      type,
      coords,
    }: {
      type: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
      coords?:
        | {
            latitude: number;
            longitude: number;
            accuracyMeters: number;
            capturedAt?: number;
          }
        | undefined;
    }) => {
      const loc = coords ?? lastVerifiedCoords.current ?? undefined;
      return jsonRequest('/api/v1/guest-order/service-requests', {
        type,
        customerName: customerName.trim() || undefined,
        ...(loc ? { location: loc } : {}),
      });
    },
    onSuccess: (_, { type }) => {
      if (type === 'CALL_STAFF') {
        setCallStaffCooldown(60);
      } else {
        playPosSound('GUEST_CHECKOUT_REQUEST_SENT');
        setCheckoutCooldown(60);
      }
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
      void queryClient.invalidateQueries({ queryKey: ['guest-order-context', token] });
    },
    onError: (error, { type }) => {
      const isLocErr =
        (error as { code?: string })?.code === 'LOCATION_VERIFICATION_REQUIRED' ||
        (error instanceof Error && error.message.includes('xác minh vị trí'));
      if (isLocErr) {
        lastVerifiedCoords.current = null;
      }
      const errMsg = error instanceof Error ? error.message : 'Không thể gửi yêu cầu.';
      const retryAfter =
        (error as { details?: { retryAfterSeconds?: number } })?.details?.retryAfterSeconds ?? 60;
      if (errMsg.includes('chờ') || errMsg.includes('gửi lại') || errMsg.includes('COOLDOWN')) {
        if (type === 'CALL_STAFF') setCallStaffCooldown(retryAfter);
        else setCheckoutCooldown(retryAfter);
      }
      showAssistantFeedback('error', errMsg);
      messageApi.warning(errMsg);
    },
  });

  const requestTableOpen = useMutation({
    mutationFn: (
      args?:
        | {
            coords?:
              | {
                  latitude: number;
                  longitude: number;
                  accuracyMeters: number;
                  capturedAt?: number;
                }
              | undefined;
            customerNameOverride?: string | undefined;
          }
        | {
            latitude: number;
            longitude: number;
            accuracyMeters: number;
            capturedAt?: number;
          }
        | undefined,
    ) => {
      const isDirectCoords = Boolean(args && 'latitude' in args);
      const coords = isDirectCoords
        ? (args as {
            latitude: number;
            longitude: number;
            accuracyMeters: number;
            capturedAt?: number;
          })
        : (
            args as {
              coords?: {
                latitude: number;
                longitude: number;
                accuracyMeters: number;
                capturedAt?: number;
              };
            }
          )?.coords;
      const customerNameOverride = !isDirectCoords
        ? (args as { customerNameOverride?: string })?.customerNameOverride
        : undefined;
      const nameToSend = (customerNameOverride ?? customerName).trim() || undefined;

      return jsonRequest<{ requestId: string | null; alreadyOpen: boolean }>(
        `/api/v1/guest-order/resolve/${token}/open-request`,
        {
          customerName: nameToSend,
          ...(coords ? { location: coords } : {}),
        },
      );
    },
    onSuccess: async (result) => {
      if (!result.alreadyOpen) {
        playPosSound('GUEST_QR_OPEN_REQUESTED');
      }
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
      await queryClient.invalidateQueries({ queryKey: ['guest-order-context', token] });
    },
    onError: (error) => {
      const isLocErr =
        (error as { code?: string })?.code === 'LOCATION_VERIFICATION_REQUIRED' ||
        (error instanceof Error && error.message.includes('xác minh vị trí'));
      if (isLocErr) {
        lastVerifiedCoords.current = null;
      }
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
  const isWaitingForOpen = context.data.tableStatus === 'OPEN_REQUESTED';
  const mediaUrl = (mediaId: string) =>
    isTableOpen
      ? `/api/v1/guest-order/media/${mediaId}`
      : `/api/v1/guest-order/resolve/${token}/media/${mediaId}`;

  const executeWithLocationCheck = async (
    action: (coords?: GuestLocationCoordinates) => void | Promise<void>,
  ) => {
    const locReq = context.data?.locationRequirement;
    if (!locReq || !locReq.required) {
      await action(lastVerifiedCoords.current ?? undefined);
      return;
    }

    if (!locReq.configured) {
      messageApi.error('Cửa hàng chưa cấu hình vị trí quán. Vui lòng liên hệ nhân viên.');
      return;
    }

    // The server has already validated this guest session. No browser prompt
    // or additional application UI is needed until the session verification expires.
    if (locReq.isVerified) {
      await action(lastVerifiedCoords.current ?? undefined);
      return;
    }

    const permission = await geolocationPermissionState();
    if (permission === 'unsupported') {
      messageApi.error('Trình duyệt không hỗ trợ định vị. Vui lòng liên hệ nhân viên hỗ trợ.');
      return;
    }
    if (permission === 'denied') {
      messageApi.error('Vị trí đang bị chặn trong trình duyệt. Hãy cho phép Vị trí rồi thử lại.');
      return;
    }
    try {
      // With granted permission this is silent. With prompt permission, this
      // is the only UI shown: the browser-native location permission prompt.
      const coordinates = await currentBrowserLocation();
      await jsonRequest<VerifyGuestLocationResponse>(
        `/api/v1/guest-order/resolve/${token}/location/verify`,
        coordinates,
      );
      lastVerifiedCoords.current = coordinates;
      await queryClient.invalidateQueries({ queryKey: ['guest-order-context', token] });
      await action(coordinates);
    } catch (error) {
      if ((error as GeolocationPositionError | undefined)?.code === 1) {
        messageApi.error(
          'Bạn chưa cho phép vị trí. Hãy bật quyền Vị trí trong trình duyệt rồi thử lại.',
        );
      } else {
        messageApi.error(error instanceof Error ? error.message : 'Không thể xác minh vị trí.');
      }
    }
  };

  const handleAssistantAction = (action: GuestAssistantAction) => {
    if (action === 'BROWSE_MENU') {
      window.setTimeout(() => {
        menuAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }
    if (action === 'OPEN_TABLE') {
      if (!requestTableOpen.isPending && !isWaitingForOpen) {
        void executeWithLocationCheck((coords) => requestTableOpen.mutate(coords));
      }
      return;
    }
    if (!isTableOpen) return;
    const type = action === 'CALL_STAFF' ? 'CALL_STAFF' : 'CHECKOUT_REQUEST';
    void executeWithLocationCheck((coords) =>
      submitService.mutate({ type, ...(coords ? { coords } : {}) }),
    );
  };

  if (context.data && !hasEnteredName) {
    return (
      <div className="qr-guest-landing">
        {holder}
        <div className="qr-guest-landing__container">
          {/* 1. Header with Store & Table info */}
          <header className="qr-guest-landing__header">
            <div className="qr-guest-landing__store-badge">
              <ShopOutlined />
              <span>{context.data.storeName}</span>
            </div>
            <div className="qr-guest-landing__table-badge">
              <span className="qr-guest-hero__pulse" />
              <span>{context.data.tableName}</span>
              {context.data.areaName ? <span> · {context.data.areaName}</span> : null}
            </div>
          </header>

          {/* 2. Top-Aligned Form Card (Won't get obscured when mobile keyboard opens) */}
          <section className="qr-guest-landing__form-card">
            <div className="qr-guest-landing__card-header">
              <h2 className="qr-guest-landing__title">Chào bạn! 👋</h2>
            </div>

            <div className="qr-guest-landing__input-box">
              <Input
                size="large"
                prefix={<UserOutlined style={{ color: '#0975f7', fontSize: 17, marginRight: 6 }} />}
                placeholder="Tên của bạn (VD: Nam, Linh...)"
                value={tempCustomerName}
                onChange={(e) => setTempCustomerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmName(tempCustomerName, autoRequestTableOpen);
                  }
                }}
                maxLength={50}
                autoFocus
                className="qr-guest-landing__input"
              />
            </div>

            {!isTableOpen ? (
              <div className="qr-guest-landing__switch-row">
                <span className="qr-guest-landing__switch-label">Yêu cầu mở bàn</span>
                <Switch
                  checked={autoRequestTableOpen}
                  onChange={(checked) => setAutoRequestTableOpen(checked)}
                  className="qr-guest-landing__switch"
                />
              </div>
            ) : null}

            <Button
              type="primary"
              size="large"
              block
              className="qr-guest-landing__submit-btn"
              onClick={() => handleConfirmName(tempCustomerName, autoRequestTableOpen)}
              loading={requestTableOpen.isPending}
              icon={<ArrowRightOutlined />}
            >
              Bắt đầu
            </Button>
          </section>

          {/* 3. Robot Mascot Character */}
          <section className="qr-guest-landing__mascot-section" aria-label="Trợ lý Pro POS">
            <div className="qr-guest-landing__robot-wrap">
              <RobotVisual expression="happy" speaking={false} />
            </div>
          </section>
        </div>
      </div>
    );
  }

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

            <div className="qr-guest-hero__badges">
              <div
                className="qr-guest-hero__customer-pill"
                onClick={() => {
                  setTempCustomerName(customerName);
                  setNameModalOpen(true);
                }}
                title="Chạm để đổi tên xưng hô"
                role="button"
                tabIndex={0}
              >
                <UserOutlined style={{ color: '#0975f7' }} />
                <span>{customerName || 'Khách tại bàn'}</span>
                <EditOutlined style={{ fontSize: 11, opacity: 0.6, marginLeft: 2 }} />
              </div>

              <div className="qr-guest-hero__table-pill">
                <span className="qr-guest-hero__pulse" />
                <span>{context.data.tableName}</span>
                {context.data.areaName ? (
                  <span style={{ opacity: 0.8 }}>· {context.data.areaName}</span>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {!isTableOpen ? (
          <div
            className={`qr-guest-status-banner qr-guest-status-banner--${isWaitingForOpen ? 'waiting' : 'closed'}`}
            role="status"
          >
            <div className="qr-guest-status-banner__icon-wrap">
              <HourglassOutlined
                className={`qr-guest-status-banner__icon ${isWaitingForOpen ? 'qr-guest-status-banner__icon--pulse' : ''}`}
              />
            </div>
            <div className="qr-guest-status-banner__content">
              <span className="qr-guest-status-banner__title">
                {isWaitingForOpen ? 'Đang chờ nhân viên mở bàn' : 'Bàn chưa được mở'}
              </span>
              <p className="qr-guest-status-banner__desc">
                {isWaitingForOpen
                  ? 'Bạn cứ chọn món vào giỏ. Bàn sẽ tự cập nhật ngay khi được mở.'
                  : 'Chạm trợ lý Pro POS phía dưới để yêu cầu mở bàn.'}
              </p>
            </div>
          </div>
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

        {/* ── 2. Active Table Order Card (If table is open & order exists) ─── */}
        {isTableOpen && activeOrderQuery.data ? (
          <div
            className="qr-guest-active-order-card"
            onClick={() => setActiveOrderDrawerOpen(true)}
          >
            <div className="qr-guest-active-order-card__header">
              <div className="qr-guest-active-order-card__status">
                <span className="qr-guest-active-order-card__dot" />
                <span className="qr-guest-active-order-card__status-text">Bàn đang sử dụng</span>
                <span className="qr-guest-active-order-card__code">
                  #{activeOrderQuery.data.displayCode}
                </span>
              </div>
              <Button
                type="link"
                size="small"
                className="qr-guest-active-order-card__link"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveOrderDrawerOpen(true);
                }}
              >
                Xem HĐ tạm tính <RightOutlined />
              </Button>
            </div>

            <div className="qr-guest-active-order-card__body">
              <div className="qr-guest-active-order-card__meta">
                <span className="qr-guest-active-order-card__pill">
                  <FileTextOutlined style={{ color: '#0975f7' }} />{' '}
                  {activeOrderQuery.data.items.length > 0
                    ? `${activeOrderQuery.data.items.length} món`
                    : 'Chưa có món'}
                </span>
                {activeOrderQuery.data.time ? (
                  <span className="qr-guest-active-order-card__pill">
                    <ClockCircleFilled style={{ color: '#10b981' }} />{' '}
                    {formatElapsedDetail(
                      Math.max(
                        0,
                        Math.floor(
                          ((activeOrderQuery.data.time.endedAtMs ?? clientNow) -
                            activeOrderQuery.data.time.startedAtMs) /
                            1000,
                        ),
                      ),
                    )}
                  </span>
                ) : null}
              </div>

              <div className="qr-guest-active-order-card__total">
                <span className="qr-guest-active-order-card__total-label">Tạm tính:</span>
                <span className="qr-guest-active-order-card__total-val">
                  {formatVnd(activeOrderQuery.data.totalVnd)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── 3. Live Order Status Tracker (If previous requests exist) ─── */}
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

        {/* ── 4. Quick Search Bar ─────────────────────────────────────────── */}
        <div
          ref={menuAnchorRef}
          id="qr-guest-menu"
          className="qr-guest-search-wrap"
          style={{ marginTop: isTableOpen && activeOrderQuery.data ? 0 : latestRequest ? 0 : 14 }}
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
                {categoryName.toUpperCase()} ({items.length})
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

                      <div
                        className="qr-guest-card__content"
                        onClick={() => openCustomizationModal(product)}
                      >
                        <div>
                          <div className="qr-guest-card__name">{product.name}</div>
                          {hasMultiVariants ? (
                            <span className="qr-guest-card__variant-badge">
                              {product.variants.length} phiên bản
                            </span>
                          ) : null}
                        </div>

                        <div className="qr-guest-card__price">
                          {defaultVariant ? `${formatVnd(defaultVariant.salePriceVnd)}đ` : '—'}
                          {product.productType === 'WEIGHT' && product.unitName ? (
                            <span className="qr-guest-card__price-unit">/{product.unitName}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="qr-guest-card__action-wrap">
                        {/* Quick Stepper or Add Button */}
                        {!hasMultiVariants && defaultVariant && totalInCartForProduct > 0 ? (
                          <div className="qr-guest-card__stepper">
                            <button
                              type="button"
                              className="qr-guest-card__stepper-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateCartQuantity(defaultVariant.id, -1);
                              }}
                            >
                              <MinusOutlined />
                            </button>
                            <span className="qr-guest-card__stepper-val">
                              {totalInCartForProduct}
                            </span>
                            <button
                              type="button"
                              className="qr-guest-card__stepper-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateCartQuantity(defaultVariant.id, 1);
                              }}
                            >
                              <PlusOutlined />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="qr-guest-card__add-btn"
                            aria-label={`Thêm ${product.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickAdd(product);
                            }}
                          >
                            <PlusOutlined />
                          </button>
                        )}
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
          zIndex={1000}
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

                      {/* Item Note Section — auto-save, no buttons */}
                      <div className="qr-cart-item-note-section">
                        {isEditingNote ? (
                          <Input
                            size="small"
                            placeholder="Ghi chú món này (vd: ít đường, không đá...)"
                            value={tempItemNote}
                            maxLength={100}
                            autoFocus
                            className="qr-cart-item-note-input"
                            onChange={(e) => {
                              setTempItemNote(e.target.value);
                              handleUpdateItemNote(line.variant.id, e.target.value);
                            }}
                            onBlur={() => setEditingNoteVariantId(null)}
                          />
                        ) : line.note ? (
                          <div className="qr-cart-item-note-badge">
                            <span className="qr-cart-item-note-text">📝 {line.note}</span>
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

              {/* Table Order Note */}
              <div className="qr-cart-table-note-card">
                <div className="qr-cart-table-note-title">
                  <FileTextOutlined /> Ghi chú cho bàn
                </div>
                <Input.TextArea
                  rows={2}
                  maxLength={200}
                  showCount
                  placeholder="Yêu cầu đặc biệt, ít cay, không đá... (tùy chọn)"
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
                  onClick={() => executeWithLocationCheck((coords) => submitOrder.mutate(coords))}
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
          zIndex={1100}
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
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={modalQuantity}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      if (raw === '') {
                        setModalQuantity('' as unknown as number);
                        return;
                      }
                      const num = Math.min(50, Math.max(1, parseInt(raw, 10)));
                      setModalQuantity(num);
                    }}
                    onBlur={() => {
                      if (!modalQuantity || Number(modalQuantity) < 1) {
                        setModalQuantity(1);
                      }
                    }}
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      width: 44,
                      textAlign: 'center',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '4px 0',
                      outline: 'none',
                      background: '#f8fafc',
                      appearance: 'none',
                      MozAppearance: 'textfield',
                    }}
                    onFocus={(e) => e.target.select()}
                  />
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
          zIndex={1000}
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

        {/* ── 9b. Active Table Provisional Receipt Drawer ─────────────────── */}
        <Drawer
          title={
            <div className="qr-active-drawer-header">
              <div className="qr-active-drawer-title">
                <FileTextOutlined style={{ color: '#0975f7' }} />
                <span>Hóa đơn tạm tính · {context.data.tableName}</span>
              </div>
              <Button
                type="text"
                size="small"
                icon={<SyncOutlined spin={activeOrderQuery.isFetching} />}
                onClick={() => void activeOrderQuery.refetch()}
                className="qr-active-drawer-refresh-btn"
              >
                Làm mới
              </Button>
            </div>
          }
          placement="bottom"
          height="88vh"
          open={activeOrderDrawerOpen}
          zIndex={1000}
          onClose={() => setActiveOrderDrawerOpen(false)}
          styles={{ body: { padding: '12px 8px 24px', background: '#f1f5f9' } }}
        >
          {activeOrderQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <Spin tip="Đang tải hóa đơn tạm tính..." />
            </div>
          ) : provisionalReceiptOptions ? (
            <div className="qr-receipt-stage-wrapper">
              <ReceiptPreviewPaper options={provisionalReceiptOptions} />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
              Chưa có dữ liệu hóa đơn tạm tính cho bàn này.
            </div>
          )}
        </Drawer>

        {/* ── 10. Order Success Modal ──────────────────────────────────────── */}
        <Modal
          open={orderSuccessModalOpen}
          footer={null}
          centered
          closable={false}
          zIndex={1500}
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
        {/* ── 8. Edit Customer Name Modal ────────────────────────────────────── */}
        <Modal
          open={nameModalOpen}
          onCancel={() => setNameModalOpen(false)}
          onOk={() => handleConfirmName()}
          okText="Lưu tên"
          cancelText="Hủy"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserOutlined style={{ color: '#0975f7' }} />
              <span>Đổi tên xưng hô</span>
            </div>
          }
          centered
        >
          <div style={{ padding: '12px 0' }}>
            <p style={{ fontSize: 13.5, color: '#64748b', marginBottom: 10 }}>
              Tên của bạn sẽ hiển thị trên các yêu cầu gọi món gửi đến nhân viên và hóa đơn bàn:
            </p>
            <Input
              size="large"
              prefix={<UserOutlined style={{ color: '#0975f7', marginRight: 6 }} />}
              placeholder="Nhập tên của bạn (VD: Anh Nam, Chị Linh...)"
              value={tempCustomerName}
              onChange={(e) => setTempCustomerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleConfirmName();
                }
              }}
              maxLength={50}
              autoFocus
            />
          </div>
        </Modal>
      </div>
    </div>
  );
}
