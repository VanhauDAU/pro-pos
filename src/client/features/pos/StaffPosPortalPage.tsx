import {
  AppstoreFilled,
  AppstoreOutlined,
  BankOutlined,
  BellFilled,
  BellOutlined,
  BookOutlined,
  CarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloseCircleOutlined,
  CloseOutlined,
  CoffeeOutlined,
  CopyOutlined,
  CreditCardOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  EllipsisOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  FireOutlined,
  GiftOutlined,
  HistoryOutlined,
  HomeOutlined,
  LaptopOutlined,
  LeftOutlined,
  LogoutOutlined,
  MedicineBoxOutlined,
  MessageOutlined,
  MinusOutlined,
  PauseCircleOutlined,
  PhoneOutlined,
  PlayCircleOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  QrcodeOutlined,
  RightOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SkinOutlined,
  SmileOutlined,
  StopOutlined,
  SwapOutlined,
  SyncOutlined,
  TagsFilled,
  TagsOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UnlockOutlined,
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  createContext,
  lazy,
  memo,
  Suspense,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  OrderCallBatchDto,
  OrderCallBatchPageDto,
  PosOverviewOrder,
  PosOverviewSnapshot,
  PosOverviewTable,
} from '@contracts/pos';
import type {
  GuestOrderRequestDto,
  ServiceRequestDto,
  StaffNotificationAuditResponse,
  StaffNotificationEventType,
  StaffNotificationStatus,
  TableOpenRequestDto,
} from '@contracts/qr-order';
import type { BankAccountDto, StorePrintSettings } from '@contracts/store';
import type { PricingConfigSnapshot } from '@domain/pricing/types';
import {
  buildPrintDataFromInvoice,
  buildPrintDataFromQuote,
  printReceipt,
  type PosReceiptPrintOptions,
} from '@client/lib/pos-receipt-printer';
import logoBlack from '@client/assets/logo-black.svg?url';
import { OrderDetailPage } from './OrderDetailPage';
import { StaffOnboarding } from './StaffOnboarding';
import { PosCustomerSelector } from './PosCustomerSelector';
import { PosAppSplash } from './PosAppSplash';
import { toast } from 'sonner';
import type { CustomerSummary } from '@contracts/customer';
import type { PosPromotionOption, PromotionPreviewResult } from '@contracts/promotion';
import { PushNotificationControl } from '@client/features/pwa/PushNotificationControl';

const OwnerInvoicesPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerInvoicesPage');
  return { default: module.OwnerInvoicesPage };
});

const OwnerCategoryDetailPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCatalogPages');
  return { default: module.OwnerCategoryDetailPage };
});

const OwnerCategoryListPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCatalogPages');
  return { default: module.OwnerCategoryListPage };
});

const OwnerProductFormPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCatalogPages');
  return { default: module.OwnerProductFormPage };
});

const OwnerProductListPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCatalogPages');
  return { default: module.OwnerProductListPage };
});

const OwnerCustomerDetailPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCustomerPages');
  return { default: module.OwnerCustomerDetailPage };
});

const OwnerCustomerFormPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCustomerPages');
  return { default: module.OwnerCustomerFormPage };
});

const OwnerCustomerGroupFormPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCustomerPages');
  return { default: module.OwnerCustomerGroupFormPage };
});

const OwnerCustomerGroupListPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCustomerPages');
  return { default: module.OwnerCustomerGroupListPage };
});

const OwnerCustomerListPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerCustomerPages');
  return { default: module.OwnerCustomerListPage };
});

const OwnerEmployeeFormPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerStaffPages');
  return { default: module.OwnerEmployeeFormPage };
});

const OwnerStaffListPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerStaffPages');
  return { default: module.OwnerStaffListPage };
});

const QrOrderConfirmModal = lazy(async () => {
  const module = await import('./QrOrderConfirmModal');
  return { default: module.QrOrderConfirmModal };
});

const ReceiptPreviewModal = lazy(async () => {
  const module = await import('./ReceiptPreviewModal');
  return { default: module.ReceiptPreviewModal };
});

const ReceiptPreviewPaper = lazy(async () => {
  const module = await import('./ReceiptPreviewModal');
  return { default: module.ReceiptPreviewPaper };
});

const TableQrModal = lazy(async () => {
  const module = await import('@client/components/TableQrModal');
  return { default: module.TableQrModal };
});

const StaffPrinterSettingsPage = lazy(async () => {
  const module = await import('./StaffPrinterSettingsPage');
  return { default: module.StaffPrinterSettingsPage };
});

function PosRouteLoadingFallback() {
  return (
    <div aria-label="Đang tải nội dung" style={{ minHeight: 320, padding: 24, background: '#fff' }}>
      <Skeleton active title={{ width: '36%' }} paragraph={{ rows: 6 }} />
    </div>
  );
}

function ReceiptPreviewLoadingModal({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <Modal open title={title} footer={null} width={650} centered onCancel={onCancel}>
      <Skeleton active title={false} paragraph={{ rows: 10 }} />
    </Modal>
  );
}

function renderLazyPosRoute(content: ReactNode) {
  return <Suspense fallback={<PosRouteLoadingFallback />}>{content}</Suspense>;
}

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
import { playPosSound } from '@client/lib/sound';
import {
  RealtimeProvider,
  usePosPollingInterval,
  useRealtime,
} from '@client/realtime/RealtimeProvider';
import {
  armPaymentReturn,
  clearPaymentPageActive,
  isReturningFromPayment,
  markPaymentNavigationStarted,
} from './payment-return-state';
import { canonicalPaymentPath } from './payment-navigation';
import { posErrorText } from './pos-error';
import { PosNotificationTracker } from './pos-notification-tracker';
import { orderQuoteQueryOptions, overviewRefreshInterval } from './pos-order-query';

const BRAND = '#0975f7';

const ALL_CATEGORY_ICON = <AppstoreFilled />;

function normalizeCategoryName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/đ/g, 'd')
    .trim();
}

function categoryNameIncludes(name: string, keywords: string[]) {
  return keywords.some(
    (keyword) =>
      name === keyword ||
      name.startsWith(`${keyword} `) ||
      name.endsWith(` ${keyword}`) ||
      name.includes(` ${keyword} `),
  );
}

function categoryIcon(name: string): ReactNode {
  const normalized = normalizeCategoryName(name);

  if (
    categoryNameIncludes(normalized, [
      'do an',
      'mon an',
      'thuc an',
      'do nuong',
      'banh',
      'com',
      'pho',
      'bun',
      'food',
    ])
  ) {
    return <FireOutlined />;
  }
  if (
    categoryNameIncludes(normalized, [
      'do uong',
      'nuoc',
      'ca phe',
      'coffee',
      'tra',
      'bia',
      'ruou',
      'drink',
    ])
  ) {
    return <CoffeeOutlined />;
  }
  if (categoryNameIncludes(normalized, ['dich vu', 'service', 'sua chua', 'bao tri'])) {
    return <ToolOutlined />;
  }
  if (categoryNameIncludes(normalized, ['quan ao', 'thoi trang', 'giay', 'tui', 'fashion'])) {
    return <SkinOutlined />;
  }
  if (
    categoryNameIncludes(normalized, ['dien tu', 'cong nghe', 'may tinh', 'dien thoai', 'laptop'])
  ) {
    return <LaptopOutlined />;
  }
  if (categoryNameIncludes(normalized, ['suc khoe', 'thuoc', 'y te', 'duoc'])) {
    return <MedicineBoxOutlined />;
  }
  if (categoryNameIncludes(normalized, ['xe', 'van chuyen', 'giao hang', 'transport'])) {
    return <CarOutlined />;
  }
  if (categoryNameIncludes(normalized, ['sach', 'van phong pham', 'giao duc', 'book'])) {
    return <BookOutlined />;
  }
  if (categoryNameIncludes(normalized, ['gia dung', 'noi that', 'nha cua', 'home'])) {
    return <HomeOutlined />;
  }
  if (categoryNameIncludes(normalized, ['giai tri', 'am nhac', 'game', 'tro choi'])) {
    return <CustomerServiceOutlined />;
  }

  const hash = [...normalized].reduce((value, char) => value + char.charCodeAt(0), 0);
  const icons = [<TagsFilled />, <ShoppingOutlined />, <ThunderboltOutlined />, <SmileOutlined />];
  return icons[hash % icons.length];
}

interface StaffContext {
  storeId: string;
  storeName: string;
  employeeId: string;
  employeeName: string;
  storePhone?: string | null;
  storeAddress?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  permissions?: string[];
  capabilities?: {
    posRealtime: boolean;
    posCommandsV2: boolean;
    posPaymentSnapshotV2: boolean;
    posRealtimeDeltasV2: boolean;
  };
}

type PosTable = PosOverviewTable;

interface CatalogVariant {
  id: string;
  name: string;
  salePriceVnd: number | null;
  promptPrice: 0 | 1;
}

interface CatalogProduct {
  productId: string;
  productName: string;
  productType: 'QUANTITY' | 'WEIGHT';
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitName: string | null;
  variants: CatalogVariant[];
}

interface OrderQuote {
  order: {
    id: string;
    displayCode: string | null;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    tableId: string | null;
    tableName: string | null;
    areaName: string | null;
    version: number;
    openedAt: number;
    openedByName?: string | null;
    status: 'OPEN' | 'PAYMENT_PENDING';
    note: string | null;
    guestCount?: number;
    customerName?: string | null;
    customerPhone?: string | null;
    customerId?: string | null;
    hasCallHistory: boolean;
  };
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    productType: 'QUANTITY' | 'WEIGHT';
    productName: string;
    variantName: string | null;
    unitName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    note: string | null;
    discountType: 'FIXED' | 'PERCENT' | null;
    discountInputValue: number | null;
    discountReason: string | null;
    grossLineTotalVnd: number;
    discountAmountVnd: number;
    netLineTotalVnd: number;
    promotionGift?: {
      promotionId: string;
      promotionName: string;
    };
  }>;
  time: null | {
    status: 'RUNNING' | 'PAUSED' | 'ENDED';
    startedAtMs: number;
    endedAtMs: number | null;
    pausedAtMs?: number | null;
    elapsedSeconds: number;
    amountBeforeRoundingVnd: number;
    amountAfterRoundingVnd: number;
    segments: Array<{
      type: 'FIRST_PERIOD' | 'SPECIAL' | 'BASE';
      name: string;
      startedAtMs: number;
      endedAtMs: number;
      elapsedSeconds: number;
      priceVnd: number;
      durationSeconds: number;
      amountBeforeRoundingVnd: number;
    }>;
    pricingConfig: PricingConfigSnapshot;
    tableSegments?: Array<{
      tableId: string;
      tableName: string;
      startedAtMs: number;
      endedAtMs: number | null;
      elapsedSeconds: number;
      amountBeforeRoundingVnd: number;
      amountAfterRoundingVnd: number;
      pricingConfig: PricingConfigSnapshot;
    }>;
  };
  subtotalVnd: number;
  discountTotalVnd: number;
  itemDiscountTotalVnd: number;
  promotionDiscountVnd: number;
  promotions: PosPromotionOption[];
  promotion: PosPromotionOption | null;
  promotionOptions: PosPromotionOption[];
  totalVnd: number;
  bankSettings?: {
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
  } | null;
  bankAccounts: BankAccountDto[];
}

interface OrderMutationSnapshot {
  clientMutationId: string;
  quote: OrderQuote;
  order: OrderQuote['order'];
  items: OrderQuote['items'];
  totals: {
    subtotalVnd: number;
    discountTotalVnd: number;
    totalVnd: number;
  };
  tableSummaries: PosTable[];
  orderVersion: number;
  serverNowMs: number;
  callBatch?: OrderCallBatchDto;
  paymentSnapshot?: PaymentSnapshotResult;
}

interface PaymentSnapshotResult {
  paymentSnapshotId: string;
  frozenAt: number;
  orderVersion: number;
  orderId: string;
  status: 'PAYMENT_PENDING';
  stoppedAt: number;
  quote: OrderQuote;
  tableSummary: PosTable | null;
}

interface PendingSavedItemEdit {
  variantId?: string | null;
  enteredUnitPriceVnd?: number;
  note?: string | null;
  discount?: null | {
    type: 'FIXED' | 'PERCENT';
    value: number;
    reason: string;
  };
  removalReason?: string;
}

const promotionTypeCopy: Record<PosPromotionOption['type'], string> = {
  FIXED_AMOUNT: 'Giảm theo số tiền',
  PERCENT: 'Giảm theo phần trăm',
  FLAT_PRICE: 'Đồng giá',
  GIFT: 'Tặng món',
};

function promotionBenefitCopy(promotion: PosPromotionOption) {
  if (promotion.type === 'GIFT') {
    return promotion.giftProductNames.length > 0
      ? `Tặng ${promotion.giftProductNames.join(', ')}`
      : 'Tặng món';
  }
  if (promotion.type === 'FLAT_PRICE') {
    const flatPrice = formatMoney(promotion.value ?? 0);
    return promotion.discountAmountVnd > 0
      ? `Đồng giá ${flatPrice} · -${formatMoney(promotion.discountAmountVnd)}`
      : `Đồng giá ${flatPrice}`;
  }
  return promotion.discountAmountVnd > 0 ? `-${formatMoney(promotion.discountAmountVnd)}` : '0đ';
}

function promotionTargetName(target: PosPromotionOption['configuredProductTargets'][number]) {
  return target.variantName ? `${target.productName} · ${target.variantName}` : target.productName;
}

function formatPromotionQuantity(quantityMilli: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(quantityMilli / 1000);
}

function PromotionOptionDetails({ option }: { option: PosPromotionOption }) {
  const configuredTargets = option.configuredProductTargets;
  return (
    <div className="staff-promotion-option__details">
      {option.type === 'GIFT' ? (
        <>
          {configuredTargets.length > 0 ? (
            <div>
              <span>Điều kiện mua {option.giftBuyAny ? 'một trong các món' : 'đủ các món'}:</span>
              <ul>
                {configuredTargets.map((target) => (
                  <li key={`${target.productId}:${target.variantId ?? ''}`}>
                    {promotionTargetName(target)} × {target.requiredQuantity}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <span>Điều kiện: Hóa đơn đủ điều kiện chương trình</span>
          )}
          <div>
            <span>Quà tặng:</span>{' '}
            <strong>{option.giftProductNames.join(', ') || 'Chưa xác định'}</strong>
            {option.maximumGiftQuantity ? ` · tối đa ${option.maximumGiftQuantity}` : ''}
          </div>
        </>
      ) : option.type === 'FLAT_PRICE' && option.flatPriceItems.length > 0 ? (
        <div>
          <span>Món được đồng giá trong đơn:</span>
          <ul>
            {option.flatPriceItems.map((item) => (
              <li key={`${item.productId}:${item.variantId ?? ''}`}>
                {item.productName}
                {item.variantName ? ` · ${item.variantName}` : ''} · SL:{' '}
                {formatPromotionQuantity(item.quantityMilli)} ·{' '}
                {formatMoney(item.originalUnitPriceVnd)}/món → {formatMoney(item.flatUnitPriceVnd)}
                /món
              </li>
            ))}
          </ul>
        </div>
      ) : option.scope === 'INVOICE' ? (
        <span>Phạm vi áp dụng: Toàn bộ hóa đơn</span>
      ) : option.scope === 'CATEGORY' ? (
        <div>
          <span>Danh mục áp dụng:</span>{' '}
          <strong>{option.categoryNames.join(', ') || 'Chưa xác định'}</strong>
        </div>
      ) : (
        <div>
          <span>Sản phẩm áp dụng:</span>
          <ul>
            {configuredTargets.map((target) => (
              <li key={`${target.productId}:${target.variantId ?? ''}`}>
                {promotionTargetName(target)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {option.type === 'PERCENT' && option.maximumDiscountVnd ? (
        <span>Giảm tối đa: {formatMoney(option.maximumDiscountVnd)}</span>
      ) : null}
    </div>
  );
}

function PosPromotionModal({
  open,
  options,
  appliedIds,
  loading,
  onClose,
  onApply,
}: {
  open: boolean;
  options: PosPromotionOption[];
  appliedIds: string[];
  loading: boolean;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(appliedIds);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) setSelected(appliedIds);
    wasOpenRef.current = open;
  }, [appliedIds, open]);

  const eligibleCount = useMemo(() => options.filter((o) => o.eligible).length, [options]);

  return (
    <Modal
      open={open}
      centered
      width={680}
      title={
        <div className="staff-promotion-modal-title">
          <GiftOutlined className="staff-promotion-modal-title__icon" />
          <span>Khuyến mại & Giảm giá</span>
        </div>
      }
      onCancel={onClose}
      className="staff-promotion-modal"
      footer={
        <div className="staff-promotion-modal-footer">
          <div className="staff-promotion-modal-footer__left">
            {appliedIds.length > 0 || selected.length > 0 ? (
              <Button
                danger
                type="text"
                disabled={loading}
                onClick={() => {
                  setSelected([]);
                  onApply([]);
                }}
                className="staff-promotion-clear-btn"
              >
                Bỏ tất cả khuyến mại
              </Button>
            ) : null}
          </div>
          <div className="staff-promotion-modal-footer__right">
            <Button disabled={loading} onClick={onClose} className="staff-promotion-cancel-btn">
              Đóng
            </Button>
            <Button
              type="primary"
              loading={loading}
              onClick={() => onApply(selected)}
              className="staff-promotion-apply-btn"
            >
              {selected.length > 0 ? `Áp dụng (${selected.length})` : 'Áp dụng'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="staff-promotion-modal__header-bar">
        <div className="staff-promotion-modal__stats">
          <strong>
            {options.length > 0
              ? `Khả dụng: ${eligibleCount}/${options.length} chương trình`
              : 'Chương trình khuyến mại'}
          </strong>
          <span>Đã chọn {selected.length} chương trình</span>
        </div>
        <small className="staff-promotion-modal__hint">
          Có thể chọn đồng thời nhiều chương trình đủ điều kiện
        </small>
      </div>

      <div className="staff-promotion-modal__list">
        {options.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Hiện không có chương trình khuyến mại nào"
            style={{ padding: '36px 0' }}
          />
        ) : (
          options.map((option) => {
            const isSelected = selected.includes(option.id);
            return (
              <div
                key={option.id}
                role="button"
                tabIndex={option.eligible ? 0 : -1}
                className={`staff-promotion-option ${isSelected ? 'is-selected' : ''} ${!option.eligible ? 'is-disabled' : ''}`}
                onClick={() => {
                  if (!option.eligible) return;
                  setSelected((current) =>
                    current.includes(option.id)
                      ? current.filter((id) => id !== option.id)
                      : [...current, option.id],
                  );
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && option.eligible) {
                    e.preventDefault();
                    setSelected((current) =>
                      current.includes(option.id)
                        ? current.filter((id) => id !== option.id)
                        : [...current, option.id],
                    );
                  }
                }}
              >
                <div className="staff-promotion-option__check">
                  <Checkbox
                    checked={isSelected}
                    disabled={!option.eligible}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, option.id]
                          : current.filter((id) => id !== option.id),
                      );
                    }}
                  />
                </div>

                <div className="staff-promotion-option__main">
                  <div className="staff-promotion-option__title-row">
                    <strong className="staff-promotion-option__name">{option.name}</strong>
                    <span
                      className={`staff-promotion-option__type-tag staff-promotion-option__type-tag--${option.type.toLowerCase()}`}
                    >
                      {promotionTypeCopy[option.type]}
                    </span>
                  </div>

                  <div className="staff-promotion-option__conditions">
                    {option.minimumOrderVnd > 0 ? (
                      <span className="staff-promotion-condition-badge">
                        Đơn tối thiểu: {formatMoney(option.minimumOrderVnd)}
                      </span>
                    ) : null}
                    {option.type === 'GIFT' && option.giftProductNames.length > 0 ? (
                      <span className="staff-promotion-gift-badge">
                        Tặng: {option.giftProductNames.join(', ')}
                      </span>
                    ) : null}
                  </div>

                  <PromotionOptionDetails option={option} />

                  {!option.eligible ? (
                    <div className="staff-promotion-option__ineligible">
                      <CloseCircleFilled className="staff-promotion-ineligible-icon" />
                      <span>Chưa đủ điều kiện{option.reason ? `: ${option.reason}` : ''}</span>
                    </div>
                  ) : null}
                </div>

                <div className="staff-promotion-option__benefit">
                  <b>{promotionBenefitCopy(option)}</b>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

interface DraftLine {
  id: string;
  product: CatalogProduct;
  variant: CatalogVariant;
  quantityMilli: number;
  note: string | null;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  discountReason: string | null;
}

interface EditingOrderItem {
  source: 'DRAFT' | 'SAVED';
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT';
  productName: string;
  variantName: string | null;
  unitName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  note: string;
  grossLineTotalVnd: number;
  discountAmountVnd: number;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  discountReason: string | null;
  netLineTotalVnd: number;
  enteredUnitPriceVnd?: number;
  discardOnCancel?: boolean | undefined;
}

interface InvoiceDetail {
  invoice: {
    id: string;
    orderId: string;
    displayCode: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    status: 'COMPLETED' | 'CANCELLED';
    issuedAt: number;
    snapshotJson: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
  };
  lines: Array<{
    id: string;
    lineType: 'PRODUCT' | 'TIME';
    description: string;
    quantityMilli: number;
    unitPrice: number;
    discountAmount: number;
    lineTotal: number;
    grossLineTotal: number;
    snapshotJson: string;
  }>;
  payment: {
    id: string;
    method: 'CASH' | 'BANK_TRANSFER';
    amount: number;
    cashReceived: number | null;
    cashChange: number | null;
    status: 'SUCCEEDED' | 'FAILED';
    createdAt: number;
  };
  allocations: Array<{
    id: string;
    method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
    amountVnd: number;
    tenderedVnd: number | null;
    bankAccountId: string | null;
    bankAccountSnapshotJson: string | null;
    createdAt: number;
  }>;
  snapshot: Record<string, unknown> | null;
}

function calculateLineTotal(unitPriceVnd: number, quantityMilli: number) {
  return Math.round((unitPriceVnd * quantityMilli) / 1000);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

function ItemDiscountDetail({
  amount,
  reason,
  promotionGift,
}: {
  amount: number;
  reason: string | null;
  promotionGift?: { promotionName: string; promotionId?: string } | undefined | null;
}) {
  if (amount <= 0) return null;
  if (promotionGift) {
    return (
      <span className="staff-item-discount-detail staff-item-discount-detail--promotion">
        <strong>Quà tặng khuyến mãi: -{formatMoney(amount)}</strong>
        <small>Chương trình: {promotionGift.promotionName}</small>
      </span>
    );
  }
  return (
    <span className="staff-item-discount-detail">
      <strong>Giảm thủ công: -{formatMoney(amount)}</strong>
      <small>Lý do: {reason || 'Chưa có lý do'}</small>
    </span>
  );
}

function calculateDiscountAmount(
  grossLineTotalVnd: number,
  type: 'FIXED' | 'PERCENT' | null | undefined,
  inputValue: number | null,
) {
  if (!type || inputValue === null) return 0;
  const amount =
    type === 'PERCENT' ? Math.floor((grossLineTotalVnd * inputValue + 50) / 100) : inputValue;
  return Math.min(grossLineTotalVnd, amount);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function getWeightUnit(unitName: string | null | undefined): string {
  if (!unitName) return 'kg';
  const lower = unitName.trim().toLowerCase();
  if (['kg', 'g', 'lạng', 'gram', 'kilogram', 'kg.'].includes(lower)) {
    return unitName.trim();
  }
  return 'kg';
}

function getProductInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const p0 = parts[0];
  const p1 = parts[1];
  if (p0 && p1) {
    return (p0.slice(0, 1) + p1.slice(0, 1)).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

function formatItemQuantity(
  productType: 'QUANTITY' | 'WEIGHT',
  quantityMilli: number,
  unitName: string | null,
) {
  const value = formatDecimal(quantityMilli / 1000);
  if (productType === 'WEIGHT') {
    return `${value} ${getWeightUnit(unitName)}`;
  }
  return `${value}x`;
}

function formatMinuteOfDay(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function formatWeekdays(mask: number) {
  if (mask === 127) return 'Tất cả các ngày';
  const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  return labels.filter((_, index) => (mask & (1 << index)) !== 0).join(', ');
}

function formatPriceRate(priceVnd: number, durationSeconds: number) {
  const duration = durationSeconds === 3600 ? 'giờ' : formatElapsed(durationSeconds);
  return `${formatMoney(priceVnd)}/${duration}`;
}

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatRequestAge(createdAt: number, now: number) {
  return formatElapsed(Math.max(0, Math.floor((now - createdAt) / 1000)));
}

function requestUrgency(createdAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds >= 300)
    return { className: 'is-critical', color: 'error' as const, label: 'Quá 5 phút' };
  if (seconds >= 120)
    return { className: 'is-warning', color: 'warning' as const, label: 'Cần xử lý' };
  return { className: 'is-fresh', color: 'processing' as const, label: 'Mới nhận' };
}

function notificationTypeLabel(type: StaffNotificationEventType) {
  const labels: Record<StaffNotificationEventType, string> = {
    QR_ORDER: 'QR Order gọi món',
    CALL_STAFF: 'Gọi nhân viên',
    CHECKOUT_REQUEST: 'Yêu cầu thanh toán',
    ORDER_CREATED: 'Đơn hàng mới được tạo',
    ITEM_ADDED: 'Thêm mặt hàng vào đơn',
    ITEM_UPDATED: 'Thay đổi mặt hàng trong đơn',
    ITEM_REMOVED: 'Xóa mặt hàng khỏi đơn',
    ORDER_SAVED: 'Lưu thay đổi đơn hàng',
    TABLE_TRANSFERRED: 'Thay đổi bàn của đơn',
    TIME_PAUSED: 'Tạm dừng tính giờ',
    TIME_RESUMED: 'Tiếp tục tính giờ',
    TIME_UPDATED: 'Điều chỉnh thời gian',
    CHECKOUT_PENDING: 'Chốt giờ chờ thanh toán',
    CHECKOUT: 'Hoàn tất thanh toán',
    ORDER_CANCELLED: 'Hủy đơn hàng',
  };
  return labels[type] || 'Hoạt động POS';
}

function notificationStatusMeta(status: StaffNotificationStatus) {
  const values: Record<StaffNotificationStatus, { label: string; color: string }> = {
    PENDING: { label: 'Chờ xác nhận', color: 'processing' },
    OPEN: { label: 'Chưa tiếp nhận', color: 'warning' },
    ACKNOWLEDGED: { label: 'Đã tiếp nhận', color: 'blue' },
    ACCEPTED: { label: 'Đã xác nhận', color: 'success' },
    REJECTED: { label: 'Đã từ chối', color: 'error' },
    COMPLETED: { label: 'Hoàn tất', color: 'success' },
    CANCELLED: { label: 'Đã hủy', color: 'default' },
    EXPIRED: { label: 'Hết hiệu lực', color: 'default' },
    INFO: { label: 'Hoạt động POS', color: 'magenta' },
  };
  return values[status];
}

function formatPreciseTime(timestamp: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function useServerNow(serverTimeOffsetMs: number) {
  const [now, setNow] = useState(() => Date.now() + serverTimeOffsetMs);
  useEffect(() => {
    const update = () => setNow(Date.now() + serverTimeOffsetMs);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [serverTimeOffsetMs]);
  return now;
}

function formatDurationVietnamese(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '0 giây';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  if (s > 0 || parts.length === 0) parts.push(`${s} giây`);
  return parts.join(' ');
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${hours}:${minutes} ${day}/${month}/${year}`;
}

function errorText(error: unknown) {
  return posErrorText(error);
}

function mutationHeaders(csrfToken: string) {
  return { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': crypto.randomUUID() };
}

interface PosNotificationSummary {
  guestOrders: GuestOrderRequestDto[];
  serviceRequests: ServiceRequestDto[];
  tableOpenRequests: TableOpenRequestDto[];
  counts: {
    guestOrders: number;
    serviceRequests: number;
    tableOpenRequests: number;
  };
  serverNowMs: number;
}

interface PosNotificationsContextValue {
  data: PosNotificationSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  qrConfirmModalOpen: boolean;
  setQrConfirmModalOpen: (open: boolean) => void;
}

const PosNotificationsContext = createContext<PosNotificationsContextValue | null>(null);

function PosNotificationWatcher() {
  const navigate = useNavigate();
  const notifications = usePosNotifications();
  const trackerRef = useRef(new PosNotificationTracker());

  useEffect(() => {
    const data = notifications.data;
    if (!data) return;

    for (const event of trackerRef.current.observe(data)) {
      playPosSound(event.sound, { dedupeKey: event.dedupeKey });

      if (event.kind === 'GUEST_ORDER') {
        const req = event.request;
        // Automatically pop up the QR order confirmation modal
        notifications.setQrConfirmModalOpen(true);
        const itemCount =
          req.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || req.items?.length || 0;
        toast.info(
          `🔔 Yêu cầu gọi món - ${req.tableName}${req.customerName ? ` (${req.customerName})` : ''}`,
          {
            description: `${req.customerName ? `Khách: ${req.customerName} • ` : ''}${req.tableName} (${req.areaName}) vừa gửi yêu cầu gọi món (${itemCount} món)`,
            duration: 8000,
            action: {
              label: 'Xem ngay',
              onClick: () => {
                notifications.setQrConfirmModalOpen(true);
              },
            },
          },
        );
      } else if (event.kind === 'SERVICE_REQUEST') {
        const sr = event.request;
        if (sr.type === 'CALL_STAFF') {
          toast.warning(
            `🔔 Gọi nhân viên - ${sr.tableName}${sr.customerName ? ` (${sr.customerName})` : ''}`,
            {
              description: `${sr.customerName ? `Khách: ${sr.customerName} • ` : ''}${sr.tableName} (${sr.areaName}) đang gọi nhân viên hỗ trợ`,
              duration: 8000,
              action: {
                label: 'Xem ngay',
                onClick: () => navigate('/pos/qr-order'),
              },
            },
          );
        } else if (sr.type === 'CHECKOUT_REQUEST') {
          toast.info(
            `💳 Yêu cầu thanh toán - ${sr.tableName}${sr.customerName ? ` (${sr.customerName})` : ''}`,
            {
              description: `${sr.customerName ? `Khách: ${sr.customerName} • ` : ''}${sr.tableName} (${sr.areaName}) vừa yêu cầu thanh toán`,
              duration: 8000,
              action: {
                label: 'Xem ngay',
                onClick: () => navigate('/pos/qr-order'),
              },
            },
          );
        }
      } else {
        const tor = event.request;
        toast.info(
          `🪑 Yêu cầu mở bàn - ${tor.tableName}${tor.customerName ? ` (${tor.customerName})` : ''}`,
          {
            description: `${tor.customerName ? `Khách: ${tor.customerName} • ` : ''}Yêu cầu mở ${tor.tableName} (${tor.areaName})`,
            duration: 8000,
            action: {
              label: 'Xem ngay',
              onClick: () => navigate('/pos/qr-order'),
            },
          },
        );
      }
    }
  }, [notifications.data, navigate, notifications]);

  return null;
}

function PosNotificationsProvider({ children }: { children: React.ReactNode }) {
  const pollingInterval = usePosPollingInterval(15_000);
  const [qrConfirmModalOpen, setQrConfirmModalOpen] = useState(false);
  const summary = useQuery({
    queryKey: ['pos-notification-summary'],
    queryFn: ({ signal }) =>
      apiRequest<PosNotificationSummary>('/api/v1/pos/qr-orders/summary', { signal }),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchInterval: pollingInterval,
  });
  const value = useMemo<PosNotificationsContextValue>(
    () => ({
      data: summary.data,
      isLoading: summary.isLoading,
      isError: summary.isError,
      isFetching: summary.isFetching,
      refetch: summary.refetch,
      qrConfirmModalOpen,
      setQrConfirmModalOpen,
    }),
    [
      summary.data,
      summary.isError,
      summary.isFetching,
      summary.isLoading,
      summary.refetch,
      qrConfirmModalOpen,
    ],
  );
  return (
    <PosNotificationsContext.Provider value={value}>
      <PosNotificationWatcher />
      {qrConfirmModalOpen ? (
        <Suspense
          fallback={
            <Modal
              open
              title="Xác nhận gọi món"
              footer={null}
              centered
              onCancel={() => setQrConfirmModalOpen(false)}
            >
              <div style={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                <Spin tip="Đang tải danh sách gọi món..." />
              </div>
            </Modal>
          }
        >
          <QrOrderConfirmModal open onClose={() => setQrConfirmModalOpen(false)} />
        </Suspense>
      ) : null}
      {children}
    </PosNotificationsContext.Provider>
  );
}

function usePosNotifications() {
  const value = useContext(PosNotificationsContext);
  if (!value) throw new Error('Missing PosNotificationsProvider');
  return value;
}

function StaffHeader({
  context,
  searchSlot,
  onOpenNotifications,
}: {
  context: AuthContextResponse | undefined;
  searchSlot?: React.ReactNode;
  onOpenNotifications: () => void;
}) {
  const { status } = useRealtime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, holder] = Modal.useModal();
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: notificationsData, setQrConfirmModalOpen } = usePosNotifications();
  const pendingQrCount =
    (notificationsData?.counts.guestOrders ?? 0) +
    (notificationsData?.counts.tableOpenRequests ?? 0);
  const showQrBell = pendingQrCount > 0;

  const pendingNotificationCount =
    (notificationsData?.counts.guestOrders ?? 0) +
    (notificationsData?.counts.serviceRequests ?? 0) +
    (notificationsData?.counts.tableOpenRequests ?? 0);

  const logout = () => {
    modal.confirm({
      title: 'Xác nhận đăng xuất',
      content: 'Bạn có chắc chắn muốn đăng xuất khỏi hệ thống POS?',
      okText: 'Đăng xuất',
      okButtonProps: { danger: true, loading: loggingOut },
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          setLoggingOut(true);
          const csrfToken = context?.csrfToken;
          if (csrfToken) {
            await apiRequest('/api/v1/auth/logout', {
              method: 'POST',
              headers: { 'X-CSRF-Token': csrfToken },
            });
          }
          await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
          queryClient.clear();
          navigate('/?tab=employee', { replace: true });
        } catch {
          await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
          queryClient.clear();
          navigate('/?tab=employee', { replace: true });
        } finally {
          setLoggingOut(false);
        }
      },
    });
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 700 }}>{context?.actor?.displayName ?? 'Nhân viên'}</div>
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
            {context?.actor?.kind === 'EMPLOYEE' ? 'Nhân viên' : 'Quản trị viên'}
          </div>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider',
    },
    {
      key: 'help-phone',
      icon: <PhoneOutlined style={{ color: '#10b981' }} />,
      label: (
        <a href="tel:0777464347">
          Gọi hỗ trợ: <strong>0777 464 347</strong>
        </a>
      ),
    },
    {
      key: 'help-zalo',
      icon: <MessageOutlined style={{ color: '#0975F7' }} />,
      label: (
        <a href="https://zalo.me/0816548150" target="_blank" rel="noopener noreferrer">
          Chat Zalo: <strong>0816 548 150</strong>
        </a>
      ),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Đăng xuất',
      danger: true,
      onClick: logout,
    },
  ];

  return (
    <header className="staff-pos-header">
      {holder}
      <div className="staff-pos-header__left">
        <div className="staff-pos-brand" title="Pro POS">
          <img src={logoBlack} alt="Pro POS" className="staff-pos-brand__logo" />
        </div>
        {searchSlot ? <div className="staff-pos-header__search">{searchSlot}</div> : null}
      </div>
      <Tooltip
        title={
          status === 'CONNECTED'
            ? 'Đồng bộ trực tiếp (Realtime)'
            : status === 'DISABLED'
              ? 'Cập nhật định kỳ'
              : 'Đang kết nối lại...'
        }
      >
        <div
          className={`staff-pos-sync-badge staff-pos-sync-badge--${status.toLowerCase()}`}
          aria-label="Trạng thái kết nối"
        >
          <span className="staff-pos-sync-dot" />
          <span className="staff-pos-sync-label">
            {status === 'CONNECTED'
              ? 'Trực tiếp'
              : status === 'DISABLED'
                ? 'Định kỳ'
                : 'Kết nối lại'}
          </span>
        </div>
      </Tooltip>
      {showQrBell ? (
        <button
          type="button"
          className={`pos-qr-bell-btn pos-qr-bell-btn--header ${pendingQrCount > 0 ? 'pos-qr-bell-btn--shake' : ''}`}
          onClick={() => setQrConfirmModalOpen(true)}
          title="Xác nhận gọi món qua QR"
        >
          <span className="pos-qr-bell-btn__icon">
            <BellFilled />
          </span>
          <span className="pos-qr-bell-btn__text">Gọi món qua QR</span>
          {pendingQrCount > 0 ? (
            <span className="pos-qr-bell-btn__badge">{pendingQrCount}</span>
          ) : null}
        </button>
      ) : null}
      <Tooltip title="Trung tâm thông báo">
        <Button
          type="text"
          className="staff-header-notification-btn"
          icon={<BellOutlined />}
          aria-label={
            pendingNotificationCount > 0
              ? `Thông báo, ${pendingNotificationCount} yêu cầu chưa xử lý`
              : 'Thông báo'
          }
          onClick={onOpenNotifications}
        >
          {pendingNotificationCount > 0 ? (
            <b className="staff-header-notification-badge">
              {pendingNotificationCount > 99 ? '99+' : pendingNotificationCount}
            </b>
          ) : null}
        </Button>
      </Tooltip>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="bottomRight"
        arrow={{ pointAtCenter: true }}
      >
        <Button
          type="text"
          className="staff-pos-account-button"
          loading={loggingOut}
          aria-label="Tài khoản nhân viên"
        >
          <Avatar style={{ background: '#d9ecff', color: BRAND, fontWeight: 700 }}>
            {context?.actor?.displayName
              ? context.actor.displayName.slice(0, 1).toUpperCase()
              : 'U'}
          </Avatar>
          <div className="staff-pos-account__copy">
            <strong>{context?.actor?.displayName ?? 'Nhân viên'}</strong>
            <small>Nhân viên</small>
          </div>
          <DownOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />
        </Button>
      </Dropdown>
    </header>
  );
}

const navItems = [
  { key: 'areas', label: 'Khu vực', icon: <AppstoreOutlined />, path: '/pos/areas' },
  { key: 'qr', label: 'QR Order', icon: <QrcodeOutlined />, path: '/pos/qr-order' },
  { key: 'more', label: 'Thêm', icon: <EllipsisOutlined />, path: '/pos/more' },
] as const;

function StaffBottomNav({ active }: { active: (typeof navItems)[number]['key'] }) {
  const navigate = useNavigate();
  const notifications = usePosNotifications();
  const pendingNotificationCount =
    (notifications.data?.counts.guestOrders ?? 0) +
    (notifications.data?.counts.serviceRequests ?? 0) +
    (notifications.data?.counts.tableOpenRequests ?? 0);
  return (
    <nav className="staff-pos-bottom-nav" aria-label="Điều hướng POS nhân viên">
      {navItems.map((item) => (
        <button
          key={item.key}
          type="button"
          data-nav-key={item.key}
          className={active === item.key ? 'is-active' : ''}
          aria-label={
            item.key === 'qr' && pendingNotificationCount > 0
              ? `${item.label}, ${pendingNotificationCount} yêu cầu chưa xử lý`
              : item.label
          }
          onClick={() => navigate(item.path)}
        >
          <span className="staff-pos-nav-icon">
            {item.icon}
            {item.key === 'qr' && pendingNotificationCount > 0 ? (
              <b className="staff-pos-nav-badge">
                {pendingNotificationCount > 99 ? '99+' : pendingNotificationCount}
              </b>
            ) : null}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

const STATUS_OPTIONS: Array<{ key: 'ALL' | 'OCCUPIED' | 'AVAILABLE'; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'OCCUPIED', label: 'Sử dụng' },
  { key: 'AVAILABLE', label: 'Còn trống' },
];

function formatTableShortDuration(occupiedSince: number | null, now: number) {
  if (!occupiedSince) return '0p';
  const totalSecs = Math.max(0, Math.floor((now - occupiedSince) / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) {
    return `${hours}g ${minutes}p`;
  }
  return `${minutes}p`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function AreasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { status: realtimeStatus, serverTimeOffsetMs } = useRealtime();
  const [now, setNow] = useState(() => Date.now() + serverTimeOffsetMs);
  const overview = useQuery<PosOverviewSnapshot>({
    queryKey: ['pos-overview'],
    queryFn: ({ signal }) => apiRequest<PosOverviewSnapshot>('/api/v1/pos/overview', { signal }),
    refetchInterval: (query) =>
      overviewRefreshInterval(
        query.state.data?.tables.some((table) => table.timeSessionStatus === 'RUNNING') ?? false,
        realtimeStatus,
      ),
    refetchOnMount: false,
    refetchOnWindowFocus: 'always',
  });
  const tables = {
    data: overview.data?.tables,
    isLoading: overview.isLoading,
    isError: overview.isError,
  };
  const posOrders = { data: overview.data?.orders };

  useEffect(() => {
    if (!overview.data) return;
    queryClient.setQueryData(['pos-tables'], overview.data.tables);
    queryClient.setQueryData(['pos-orders-list'], overview.data.orders);
  }, [overview.data, queryClient]);

  const activeTakeaways = useMemo(() => {
    return (posOrders.data ?? [])
      .filter(
        (o) =>
          o.orderType === 'TAKEAWAY' && (o.status === 'OPEN' || o.status === 'PAYMENT_PENDING'),
      )
      .toSorted((a, b) => a.openedAt - b.openedAt);
  }, [posOrders.data]);

  useEffect(() => {
    const hasActiveOrder =
      tables.data?.some((table) => table.status === 'OCCUPIED') || activeTakeaways.length > 0;
    if (!hasActiveOrder) return undefined;
    const update = () => setNow(Date.now() + serverTimeOffsetMs);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [activeTakeaways.length, serverTimeOffsetMs, tables.data]);

  const areas = useMemo(() => {
    const map = new Map<string, { id: string; name: string; tables: PosTable[] }>();
    for (const table of tables.data ?? []) {
      const area = map.get(table.areaId) ?? { id: table.areaId, name: table.areaName, tables: [] };
      area.tables.push(table);
      map.set(table.areaId, area);
    }
    return [...map.values()];
  }, [tables.data]);

  const initialArea =
    searchParams.get('tab') === 'takeaway' ||
      (location.state as { selectedArea?: string } | null)?.selectedArea === '__TAKEAWAY__'
      ? '__TAKEAWAY__'
      : ((location.state as { selectedArea?: string } | null)?.selectedArea ?? null);

  const [selectedArea, setSelectedArea] = useState<string | null>(initialArea);
  const [status, setStatus] = useState<'ALL' | 'OCCUPIED' | 'AVAILABLE'>('ALL');

  useEffect(() => {
    const stateArea = (location.state as { selectedArea?: string } | null)?.selectedArea;
    if (searchParams.get('tab') === 'takeaway' || stateArea === '__TAKEAWAY__') {
      setSelectedArea('__TAKEAWAY__');
    } else if (stateArea) {
      setSelectedArea(stateArea);
    }
  }, [searchParams, location.state]);

  const isTakeaway = selectedArea === '__TAKEAWAY__';
  const effectiveAreaId = isTakeaway ? '__TAKEAWAY__' : (selectedArea ?? areas[0]?.id ?? null);
  const currentArea = areas.find((item) => item.id === effectiveAreaId) ?? areas[0];

  const visibleTables =
    currentArea?.tables.filter((table) => status === 'ALL' || table.status === status) ?? [];

  return (
    <div className="staff-areas-page">
      {tables.isLoading ? <Spin fullscreen description="Đang tải khu vực" /> : null}
      {tables.isError ? <Alert type="error" showIcon title="Chưa tải được khu vực và bàn" /> : null}
      {overview.isRefetchError && overview.data ? (
        <Alert
          type="warning"
          showIcon
          title="Dữ liệu Khu vực chưa được cập nhật"
          description={errorText(overview.error)}
          action={<Button onClick={() => void overview.refetch()}>Thử lại</Button>}
          style={{ margin: '12px 16px' }}
        />
      ) : null}

      {/* Mobile/iPad Top Bar: Status tabs on top, Area pills + Takeaway below */}
      <div className="staff-areas-mobile-header">
        <div className="staff-status-bar">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`staff-status-tab ${status === opt.key ? 'is-active' : ''}`}
              onClick={() => setStatus(opt.key)}
            >
              <span className="staff-status-tab__label">{opt.label}</span>
            </button>
          ))}
        </div>
        <div className="staff-area-pill-bar">
          <div className="staff-area-pill-list">
            <button
              type="button"
              className={`staff-area-pill staff-area-pill--takeaway ${isTakeaway ? 'is-active' : ''}`}
              onClick={() => {
                setSelectedArea('__TAKEAWAY__');
                setSearchParams({ tab: 'takeaway' }, { replace: true });
              }}
            >
              <ShoppingOutlined /> Mang về
            </button>
            {areas.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`staff-area-pill ${!isTakeaway && item.id === currentArea?.id ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedArea(item.id);
                  setSearchParams({}, { replace: true });
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop Sidebar with Mang về card at the top */}
      <aside className="staff-area-sidebar staff-area-list">
        <button
          type="button"
          className={`staff-area-sidebar__item staff-area-sidebar__item--takeaway ${isTakeaway ? 'is-active' : ''}`}
          onClick={() => {
            setSelectedArea('__TAKEAWAY__');
            setSearchParams({ tab: 'takeaway' }, { replace: true });
          }}
        >
          <ShoppingOutlined /> <span>Mang về</span>
        </button>
        <div className="staff-area-sidebar__divider" />
        {areas.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`staff-area-sidebar__item ${!isTakeaway && item.id === currentArea?.id ? 'is-active' : ''}`}
            onClick={() => {
              setSelectedArea(item.id);
              setSearchParams({}, { replace: true });
            }}
          >
            {item.name}
          </button>
        ))}
      </aside>

      {/* Main Content Area */}
      <main className="staff-area-content">
        {/* Desktop Status Bar */}
        <div className="staff-desktop-status-bar">
          <div className="staff-status-bar">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`staff-status-tab ${status === opt.key ? 'is-active' : ''}`}
                onClick={() => setStatus(opt.key)}
              >
                <span className="staff-status-tab__label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {isTakeaway ? (
          <div className="staff-table-grid">
            {/* Card Tạo đơn mang về mới (luôn hiển thị, giống mẫu ảnh) */}
            {status !== 'OCCUPIED' ? (
              <button
                type="button"
                className="staff-table-card staff-table-card--takeaway-create"
                onClick={() => navigate('/pos/orders/new?type=TAKEAWAY')}
              >
                <div className="staff-takeaway-create-header">
                  <svg
                    className="staff-takeaway-create-icon"
                    width="38"
                    height="25"
                    viewBox="0 0 114 74"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M39.9713 15.4421C40.1863 13.4832 41.8412 12 43.812 12H70.6703C72.641 12 74.2959 13.4832 74.511 15.4421L75.3526 23.1084H39.1296L39.9713 15.4421Z"
                      fill="#AACCF5"
                    />
                    <path
                      d="M32.7784 25.6388C33.1058 20.5556 37.3241 16.6003 42.4178 16.6003H71.5815C76.6752 16.6003 80.8935 20.5556 81.221 25.6388L83.0996 54.8034C83.3507 58.7007 80.2573 61.9997 76.352 61.9997H37.6474C33.742 61.9997 30.6487 58.7007 30.8997 54.8034L32.7784 25.6388Z"
                      fill="#81A7D5"
                    />
                    <mask
                      id="mask0_takeaway_card"
                      style={{ maskType: 'alpha' }}
                      maskUnits="userSpaceOnUse"
                      x="30"
                      y="16"
                      width="54"
                      height="46"
                    >
                      <path
                        d="M32.779 25.639C33.1064 20.5558 37.3247 16.6004 42.4184 16.6004H71.5821C76.6758 16.6004 80.8941 20.5558 81.2216 25.639L83.1002 54.8036C83.3513 58.7009 80.2579 61.9999 76.3526 61.9999H37.648C33.7426 61.9999 30.6493 58.7009 30.9003 54.8036L32.779 25.639Z"
                        fill="#6682A3"
                      />
                    </mask>
                    <g mask="url(#mask0_takeaway_card)">
                      <g filter="url(#filter0_takeaway_card)">
                        <ellipse
                          cx="40.2927"
                          cy="56.207"
                          rx="28.0486"
                          ry="28.6584"
                          fill="#C1DAF9"
                          fillOpacity="0.7"
                        />
                      </g>
                    </g>
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M46.376 25.0522C47.843 25.0522 49.0323 26.2415 49.0323 27.7085C49.0323 32.4318 52.763 36.1606 57.2428 36.1606C61.7227 36.1606 65.4534 32.4318 65.4534 27.7085C65.4534 26.2415 66.6427 25.0522 68.1097 25.0522C69.5768 25.0522 70.7661 26.2415 70.7661 27.7085C70.7661 35.2552 64.7663 41.4733 57.2428 41.4733C49.7194 41.4733 43.7196 35.2552 43.7196 27.7085C43.7196 26.2415 44.9089 25.0522 46.376 25.0522Z"
                      fill="url(#paint0_takeaway_card)"
                    />
                    <defs>
                      <filter
                        id="filter0_takeaway_card"
                        x="-16.7343"
                        y="-1.42981"
                        width="114.054"
                        height="115.274"
                        filterUnits="userSpaceOnUse"
                        colorInterpolationFilters="sRGB"
                      >
                        <feFlood floodOpacity="0" result="BackgroundImageFix" />
                        <feBlend
                          mode="normal"
                          in="SourceGraphic"
                          in2="BackgroundImageFix"
                          result="shape"
                        />
                        <feGaussianBlur
                          stdDeviation="14.4892"
                          result="effect1_foregroundBlur_9518_135563"
                        />
                      </filter>
                      <linearGradient
                        id="paint0_takeaway_card"
                        x1="57.2428"
                        y1="25.0522"
                        x2="57.2428"
                        y2="35.6776"
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop stopColor="#D0DCF7" />
                        <stop offset="1" stopColor="#F4FEFF" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <strong className="staff-takeaway-create-title">Mang về</strong>
                </div>
              </button>
            ) : null}

            {/* Các đơn mang về đang hoạt động ("Mang về 01", "Mang về 02", ...) */}
            {status !== 'AVAILABLE'
              ? activeTakeaways.map((takeawayOrder, index) => {
                const label = `Mang về ${String(index + 1).padStart(2, '0')}`;
                return (
                  <button
                    type="button"
                    key={takeawayOrder.id}
                    className="staff-table-card staff-table-card--occupied"
                    onClick={() => navigate(`/pos/orders/${takeawayOrder.id}`)}
                  >
                    <div className="staff-table-card__header">
                      <strong className="staff-table-card__name">{label}</strong>
                    </div>
                    <div className="staff-table-card__body">
                      <div className="staff-table-card__meta">
                        <span>{formatTableShortDuration(takeawayOrder.openedAt, now)}</span>
                        <span className="staff-table-card__dot">•</span>
                        <span>{takeawayOrder.itemCount ?? 0} món</span>
                      </div>
                      <div className="staff-table-card__total">
                        {formatMoney(takeawayOrder.totalVnd ?? 0)}
                      </div>
                    </div>
                  </button>
                );
              })
              : null}
          </div>
        ) : visibleTables.length === 0 ? (
          <Empty description="Khu vực chưa có bàn phù hợp" style={{ padding: '60px 0' }} />
        ) : (
          <div className="staff-table-grid">
            {visibleTables.map((table) => {
              const isOccupied = table.status === 'OCCUPIED';
              const isPaused = table.timeSessionStatus === 'PAUSED';

              return (
                <button
                  type="button"
                  key={table.id}
                  disabled={table.status === 'DISABLED'}
                  className={[
                    'staff-table-card',
                    `staff-table-card--${table.status.toLowerCase()}`,
                    isPaused && 'staff-table-card--paused',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (table.activeOrderId) navigate(`/pos/orders/${table.activeOrderId}`);
                    else navigate(`/pos/orders/new?tableId=${table.id}`);
                  }}
                >
                  <div className="staff-table-card__header">
                    <strong className="staff-table-card__name">{table.name}</strong>
                    {isOccupied && isPaused && (
                      <span className="staff-table-card__paused-badge">
                        <PauseCircleOutlined /> Tạm dừng
                      </span>
                    )}
                  </div>
                  {isOccupied ? (
                    <div className="staff-table-card__body">
                      <div className="staff-table-card__meta">
                        <span>{formatTableShortDuration(table.occupiedSince, now)}</span>
                        <span className="staff-table-card__dot">•</span>
                        <span>
                          {table.guestCount && table.guestCount > 0
                            ? `${table.guestCount} khách`
                            : `${table.itemCount ?? 0} món`}
                        </span>
                      </div>
                      <div className="staff-table-card__total">
                        {formatMoney(table.totalVnd ?? 0)}
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function StaffNotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const pollingInterval = usePosPollingInterval(30_000);
  const notificationAudit = useQuery({
    queryKey: ['staff-notification-audit'],
    queryFn: () =>
      apiRequest<StaffNotificationAuditResponse>('/api/v1/pos/qr-orders/audit?limit=50'),
    enabled: open,
    refetchInterval: open ? pollingInterval : false,
  });
  const retentionDays = notificationAudit.data?.retentionDays ?? 3;

  return (
    <Drawer
      title={
        <div className="staff-notification-audit-title">
          <HistoryOutlined />
          <div>
            <strong>Thông báo</strong>
            <span>
              Lưu tối đa {retentionDays} ngày · {notificationAudit.data?.items.length ?? 0}/50 sự
              kiện gần nhất
            </span>
          </div>
        </div>
      }
      placement="right"
      size={520}
      open={open}
      onClose={onClose}
      className="staff-notification-audit-drawer"
    >
      {notificationAudit.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : notificationAudit.isError ? (
        <Alert
          type="error"
          showIcon
          title="Chưa tải được nhật ký"
          action={<Button onClick={() => void notificationAudit.refetch()}>Thử lại</Button>}
        />
      ) : (notificationAudit.data?.items.length ?? 0) === 0 ? (
        <Empty description={`Chưa có thông báo nào trong ${retentionDays} ngày gần đây`} />
      ) : (
        <div className="staff-notification-audit-list">
          {(notificationAudit.data?.items ?? []).map((event) => {
            const status = notificationStatusMeta(event.status);
            return (
              <article
                key={event.id}
                className="staff-notification-audit-item"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onClose();
                  navigate('/pos/qr-order');
                }}
              >
                <div
                  className={`staff-notification-audit-icon is-${event.eventType.toLowerCase()}`}
                >
                  {event.eventType === 'QR_ORDER' ? (
                    <QrcodeOutlined />
                  ) : event.eventType === 'CALL_STAFF' ? (
                    <BellOutlined />
                  ) : event.eventType === 'CHECKOUT_PENDING' ? (
                    <ClockCircleOutlined />
                  ) : event.eventType === 'CHECKOUT_REQUEST' || event.eventType === 'CHECKOUT' ? (
                    <CreditCardOutlined />
                  ) : (
                    <FileTextOutlined />
                  )}
                </div>
                <div className="staff-notification-audit-body">
                  <div className="staff-notification-audit-row">
                    <strong>{notificationTypeLabel(event.eventType)}</strong>
                    <Tag color={status.color}>{status.label}</Tag>
                  </div>
                  <b>
                    {event.tableName} · {event.areaName}
                  </b>
                  <p>{event.summary}</p>
                  {event.note ? <small className="is-note">Ghi chú: {event.note}</small> : null}
                  <div className="staff-notification-audit-meta">
                    <span>{formatDateTime(event.createdAt)}</span>
                    {event.itemCount > 0 ? <span>{event.itemCount} món</span> : null}
                    {event.totalVnd > 0 ? <span>{formatMoney(event.totalVnd)}</span> : null}
                  </div>
                  {event.actorName ? (
                    <small>
                      {status.label} bởi <b>{event.actorName}</b>
                      {event.deviceName ? ` · ${event.deviceName}` : ''}
                      {event.handledAt ? ` lúc ${formatPreciseTime(event.handledAt)}` : ''}
                    </small>
                  ) : null}
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, marginTop: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      navigate('/pos/qr-order');
                    }}
                  >
                    Mở tab QR Order →
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}

function QrOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messageApi = toast;
  const holder = null;
  const [modal, modalHolder] = Modal.useModal();
  const realtime = useRealtime();
  const notifications = usePosNotifications();
  const now = useServerNow(realtime.serverTimeOffsetMs);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [updatingServiceId, setUpdatingServiceId] = useState<string | null>(null);
  const [updatingTableOpenId, setUpdatingTableOpenId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'ALL' | 'TABLE_OPEN' | 'SERVICE' | 'ORDERS'>('ALL');

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const requests = {
    data: notifications.data?.guestOrders,
    isLoading: notifications.isLoading,
    isError: notifications.isError,
    isFetching: notifications.isFetching,
  };
  const serviceRequests = {
    data: notifications.data?.serviceRequests,
    isLoading: notifications.isLoading,
    isError: notifications.isError,
    isFetching: notifications.isFetching,
  };
  const tableOpenRequests = {
    data: notifications.data?.tableOpenRequests,
    isLoading: notifications.isLoading,
    isError: notifications.isError,
    isFetching: notifications.isFetching,
  };

  const pendingRequests = useMemo(
    () => (requests.data ?? []).toSorted((a, b) => a.createdAt - b.createdAt),
    [requests.data],
  );
  const activeServiceRequests = useMemo(
    () =>
      (serviceRequests.data ?? []).toSorted((a, b) => {
        if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
        return a.createdAt - b.createdAt;
      }),
    [serviceRequests.data],
  );
  const tableOpenList = useMemo(
    () => (tableOpenRequests.data ?? []).toSorted((a, b) => a.createdAt - b.createdAt),
    [tableOpenRequests.data],
  );

  const pendingCount = pendingRequests.length;
  const serviceCount = activeServiceRequests.length;
  const tableOpenCount = tableOpenList.length;
  const totalActionableCount = pendingCount + serviceCount + tableOpenCount;
  const totalPendingValue = pendingRequests.reduce(
    (sum, request) => sum + request.items.reduce((itemSum, item) => itemSum + item.lineTotalVnd, 0),
    0,
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-notification-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-staff-all-qr-orders'] }),
    ]);

  const refreshAreasAfterTableOpen = async () => {
    const overview = await queryClient.fetchQuery<PosOverviewSnapshot>({
      queryKey: ['pos-overview'],
      queryFn: ({ signal }) => apiRequest<PosOverviewSnapshot>('/api/v1/pos/overview', { signal }),
      staleTime: 0,
    });
    queryClient.setQueryData(['pos-tables'], overview.tables);
    queryClient.setQueryData(['pos-orders-list'], overview.orders);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-notification-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['pos-staff-all-qr-orders'] }),
    ]);
  };

  const accept = useMutation({
    mutationFn: (request: GuestOrderRequestDto) =>
      jsonRequest(
        `/api/v1/pos/qr-orders/${request.id}/accept`,
        { expectedOrderVersion: request.orderVersion },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      ),
    onSuccess: async () => {
      messageApi.success('Đã xác nhận món vào hóa đơn.');
      await refresh();
    },
    onError: async (error) => {
      messageApi.error(errorText(error));
      await refresh();
    },
  });

  const rejectRequest = (request: GuestOrderRequestDto) => {
    let reason = '';
    modal.confirm({
      title: `Từ chối yêu cầu ${request.tableName}`,
      content: (
        <Input.TextArea
          autoFocus
          placeholder="Nhập lý do để khách biết"
          maxLength={300}
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: 'Từ chối',
      okButtonProps: { danger: true },
      cancelText: 'Quay lại',
      onOk: async () => {
        if (!reason.trim()) throw new Error('Vui lòng nhập lý do.');
        setRejectingId(request.id);
        try {
          await jsonRequest(
            `/api/v1/pos/qr-orders/${request.id}/reject`,
            { reason: reason.trim() },
            { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
          );
          messageApi.success('Đã từ chối yêu cầu.');
          await refresh();
        } finally {
          setRejectingId(null);
        }
      },
    });
  };

  const updateService = async (request: ServiceRequestDto, action: 'ACKNOWLEDGE' | 'COMPLETE') => {
    setUpdatingServiceId(request.id);
    try {
      await jsonRequest(
        `/api/v1/pos/qr-orders/service-requests/${request.id}/status`,
        { action },
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      );
      await refresh();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setUpdatingServiceId(null);
    }
  };

  const acceptTableOpen = async (request: TableOpenRequestDto) => {
    setUpdatingTableOpenId(request.id);
    try {
      await jsonRequest(
        `/api/v1/pos/qr-orders/table-open-requests/${request.id}/accept`,
        {},
        { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
      );
      await refreshAreasAfterTableOpen();
      messageApi.success(`Đã mở ${request.tableName}.`);
    } catch (error) {
      messageApi.error(errorText(error));
      await refresh();
    } finally {
      setUpdatingTableOpenId(null);
    }
  };

  const cancelTableOpen = (request: TableOpenRequestDto) => {
    let reason = '';
    modal.confirm({
      title: `Từ chối mở ${request.tableName}`,
      content: (
        <Input.TextArea
          autoFocus
          placeholder="Nhập lý do từ chối"
          maxLength={300}
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: 'Từ chối',
      okButtonProps: { danger: true },
      cancelText: 'Quay lại',
      onOk: async () => {
        if (!reason.trim()) throw new Error('Vui lòng nhập lý do.');
        setUpdatingTableOpenId(request.id);
        try {
          await jsonRequest(
            `/api/v1/pos/qr-orders/table-open-requests/${request.id}/cancel`,
            { reason: reason.trim() },
            { headers: mutationHeaders(auth.data?.csrfToken ?? '') },
          );
          messageApi.success('Đã từ chối yêu cầu mở bàn.');
          await refresh();
        } finally {
          setUpdatingTableOpenId(null);
        }
      },
    });
  };

  const isRefreshing =
    requests.isFetching || serviceRequests.isFetching || tableOpenRequests.isFetching;
  const isLoading = requests.isLoading || serviceRequests.isLoading || tableOpenRequests.isLoading;

  const showTableOpen = filterTab === 'ALL' || filterTab === 'TABLE_OPEN';
  const showService = filterTab === 'ALL' || filterTab === 'SERVICE';
  const showOrders = filterTab === 'ALL' || filterTab === 'ORDERS';

  return (
    <main className="staff-qr-order-page">
      {holder}
      {modalHolder}

      {/* Top Banner & Control Bar */}
      <div className="staff-qr-hero-card" aria-label="Tổng quan QR Order">
        <div className="staff-qr-hero-card__main">
          <div className="staff-qr-hero-card__title-wrap">
            <div className="staff-qr-hero-card__icon-badge">
              <QrcodeOutlined />
            </div>
            <div>
              <div className="staff-qr-hero-card__heading">
                <h2>Yêu cầu QR Order</h2>
                <span className={`staff-qr-live-pill is-${realtime.status.toLowerCase()}`}>
                  <span className="staff-qr-live-dot" />
                  {realtime.status === 'CONNECTED' ? 'Trực tiếp' : 'Đang kết nối'}
                </span>
                {totalActionableCount > 0 ? (
                  <span className="staff-qr-badge-counter">{totalActionableCount} cần xử lý</span>
                ) : (
                  <span className="staff-qr-badge-counter is-clean">Đã xử lý hết</span>
                )}
              </div>
              <p className="staff-qr-hero-card__desc">
                Tự động nhận yêu cầu mở bàn, gọi phục vụ và đơn gọi món trực tiếp từ mã QR tại bàn.
              </p>
            </div>
          </div>

          <div className="staff-qr-hero-card__actions">
            <Button
              type="default"
              size="middle"
              className="staff-qr-refresh-btn"
              icon={<SyncOutlined spin={isRefreshing} />}
              disabled={isRefreshing}
              onClick={() => void refresh()}
            >
              Làm mới
            </Button>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        {totalActionableCount > 0 ? (
          <div className="staff-qr-tab-filter-bar">
            <button
              type="button"
              className={`staff-qr-tab-btn ${filterTab === 'ALL' ? 'is-active' : ''}`}
              onClick={() => setFilterTab('ALL')}
            >
              Tất cả
              <span className="staff-qr-tab-count">{totalActionableCount}</span>
            </button>

            {pendingCount > 0 ? (
              <button
                type="button"
                className={`staff-qr-tab-btn staff-qr-tab-btn--orders ${filterTab === 'ORDERS' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('ORDERS')}
              >
                <ShoppingOutlined /> Đơn gọi món
                <span className="staff-qr-tab-count">{pendingCount}</span>
              </button>
            ) : null}

            {serviceCount > 0 ? (
              <button
                type="button"
                className={`staff-qr-tab-btn staff-qr-tab-btn--service ${filterTab === 'SERVICE' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('SERVICE')}
              >
                <BellOutlined /> Gọi phục vụ
                <span className="staff-qr-tab-count">{serviceCount}</span>
              </button>
            ) : null}

            {tableOpenCount > 0 ? (
              <button
                type="button"
                className={`staff-qr-tab-btn staff-qr-tab-btn--table ${filterTab === 'TABLE_OPEN' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('TABLE_OPEN')}
              >
                <UnlockOutlined /> Mở bàn
                <span className="staff-qr-tab-count">{tableOpenCount}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Errors alert if any */}
      {requests.isError || serviceRequests.isError || tableOpenRequests.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không thể tải đầy đủ dữ liệu"
          description="Hệ thống vẫn đang tự kết nối lại. Bạn có thể bấm Làm mới để thử ngay."
          style={{ marginBottom: 16, borderRadius: 12 }}
        />
      ) : null}

      {/* Loading state */}
      {isLoading ? (
        <div style={{ padding: '36px 0' }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : totalActionableCount === 0 ? (
        /* Empty State: Sleek & Clean */
        <div className="staff-qr-empty-hero">
          <div className="staff-qr-empty-hero__icon">
            <CheckCircleOutlined />
          </div>
          <h3>Không có yêu cầu chờ xử lý</h3>
          <p>
            Tất cả yêu cầu mở bàn, gọi món và gọi nhân viên từ khách qua mã QR đã được xử lý xong.
          </p>
          <div className="staff-qr-empty-hero__time">
            <span>Cập nhật gần nhất lúc {formatPreciseTime(now)}</span>
          </div>
        </div>
      ) : (
        /* Actionable Tickets Board */
        <div className="staff-qr-tickets-board">
          {/* Section 1: Table Open Requests */}
          {showTableOpen && tableOpenCount > 0 ? (
            <div className="staff-qr-tickets-section">
              <div className="staff-qr-tickets-section__heading">
                <h4>Yêu cầu mở bàn ({tableOpenCount})</h4>
              </div>

              <div className="staff-qr-tickets-grid">
                {tableOpenList.map((request) => {
                  const urgency = requestUrgency(request.createdAt, now);
                  const isUpdating = updatingTableOpenId === request.id;

                  return (
                    <article key={request.id} className="staff-qr-ticket-card">
                      <div className="staff-qr-ticket-header">
                        <div className="staff-qr-ticket-table-badge">
                          <div className="staff-qr-table-icon-wrap">
                            <UnlockOutlined />
                          </div>
                          <div>
                            <div className="staff-qr-table-title">{request.tableName}</div>
                            <div className="staff-qr-table-sub">{request.areaName}</div>
                          </div>
                        </div>

                        <div className="staff-qr-ticket-timing">
                          <span className="staff-qr-type-badge">Mở bàn</span>
                          <span className={`staff-qr-time-text ${urgency.className}`}>
                            <ClockCircleOutlined /> {formatRequestAge(request.createdAt, now)}
                          </span>
                        </div>
                      </div>

                      <div className="staff-qr-ticket-body">
                        <div className="staff-qr-callout-box">
                          <span className="staff-qr-callout-label">Trạng thái:</span>
                          <strong className="staff-qr-callout-value">
                            Khách đã quét QR và đang chọn món trong lúc chờ mở bàn
                          </strong>
                        </div>
                        <div className="staff-qr-ticket-subtime">
                          Gửi lúc {formatPreciseTime(request.createdAt)}
                        </div>
                      </div>

                      <div className="staff-qr-ticket-footer">
                        <Button
                          size="large"
                          danger
                          className="staff-qr-action-btn staff-qr-action-btn--reject"
                          disabled={updatingTableOpenId !== null}
                          onClick={() => cancelTableOpen(request)}
                        >
                          Từ chối
                        </Button>
                        <Button
                          type="primary"
                          size="large"
                          icon={<UnlockOutlined />}
                          className="staff-qr-action-btn staff-qr-action-btn--primary"
                          loading={isUpdating}
                          disabled={updatingTableOpenId !== null && !isUpdating}
                          onClick={() => void acceptTableOpen(request)}
                        >
                          Mở bàn ngay
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Section 2: Support & Checkout Requests */}
          {showService && serviceCount > 0 ? (
            <div className="staff-qr-tickets-section">
              <div className="staff-qr-tickets-section__heading">
                <h4>Yêu cầu phục vụ & thanh toán ({serviceCount})</h4>
              </div>

              <div className="staff-qr-tickets-grid">
                {activeServiceRequests.map((request) => {
                  const urgency = requestUrgency(request.createdAt, now);
                  const isUpdating = updatingServiceId === request.id;
                  const isCallStaff = request.type === 'CALL_STAFF';

                  return (
                    <article key={request.id} className="staff-qr-ticket-card">
                      <div className="staff-qr-ticket-header">
                        <div className="staff-qr-ticket-table-badge">
                          <div className="staff-qr-table-icon-wrap">
                            {isCallStaff ? <BellOutlined /> : <CreditCardOutlined />}
                          </div>
                          <div>
                            <div className="staff-qr-table-title">{request.tableName}</div>
                            <div className="staff-qr-table-sub">{request.areaName}</div>
                          </div>
                        </div>

                        <div className="staff-qr-ticket-timing">
                          <span className="staff-qr-type-badge">
                            {isCallStaff ? 'Gọi nhân viên' : 'Thanh toán'}
                          </span>
                          <span className={`staff-qr-time-text ${urgency.className}`}>
                            <ClockCircleOutlined /> {formatRequestAge(request.createdAt, now)}
                          </span>
                        </div>
                      </div>

                      <div className="staff-qr-ticket-body">
                        <div className="staff-qr-callout-box">
                          <span className="staff-qr-callout-label">
                            {isCallStaff ? 'Nội dung yêu cầu:' : 'Hình thức:'}
                          </span>
                          <strong className="staff-qr-callout-value">
                            {request.reason ||
                              (isCallStaff
                                ? 'Khách cần nhân viên hỗ trợ tại bàn'
                                : 'Khách yêu cầu thanh toán hóa đơn')}
                          </strong>
                        </div>
                        <div className="staff-qr-ticket-subtime">
                          Gửi lúc {formatPreciseTime(request.createdAt)}
                          {request.acknowledgedAt
                            ? ` · Tiếp nhận lúc ${formatPreciseTime(request.acknowledgedAt)}`
                            : ''}
                        </div>
                      </div>

                      <div className="staff-qr-ticket-footer">
                        <Button
                          size="large"
                          className="staff-qr-action-btn staff-qr-action-btn--secondary"
                          onClick={() => navigate(`/pos/orders/${request.orderId}`)}
                        >
                          Xem đơn
                        </Button>
                        {request.status === 'OPEN' ? (
                          <Button
                            type="primary"
                            size="large"
                            className="staff-qr-action-btn staff-qr-action-btn--primary"
                            loading={isUpdating}
                            disabled={updatingServiceId !== null && !isUpdating}
                            onClick={() => void updateService(request, 'ACKNOWLEDGE')}
                          >
                            Tiếp nhận ngay
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            size="large"
                            className="staff-qr-action-btn staff-qr-action-btn--primary"
                            loading={isUpdating}
                            disabled={updatingServiceId !== null && !isUpdating}
                            onClick={() => void updateService(request, 'COMPLETE')}
                          >
                            Đã hoàn tất
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Section 3: Food Orders Requests */}
          {showOrders && pendingCount > 0 ? (
            <div className="staff-qr-tickets-section">
              <div className="staff-qr-tickets-section__heading">
                <h4>Đơn gọi món chờ xác nhận ({pendingCount})</h4>
                <span className="staff-qr-section-count">
                  Tổng: {formatMoney(totalPendingValue)}
                </span>
              </div>

              <div className="staff-qr-tickets-grid staff-qr-tickets-grid--orders">
                {pendingRequests.map((request) => {
                  const urgency = requestUrgency(request.createdAt, now);
                  const itemQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
                  const requestTotal = request.items.reduce(
                    (sum, item) => sum + item.lineTotalVnd,
                    0,
                  );
                  const isAccepting = accept.isPending && accept.variables?.id === request.id;
                  const isRejecting = rejectingId === request.id;
                  const anotherActionPending =
                    (accept.isPending && !isAccepting) || (rejectingId !== null && !isRejecting);

                  return (
                    <article key={request.id} className="staff-qr-ticket-card">
                      <div className="staff-qr-ticket-header">
                        <div className="staff-qr-ticket-table-badge">
                          <div className="staff-qr-table-icon-wrap">
                            <ShopOutlined />
                          </div>
                          <div>
                            <div className="staff-qr-table-title">{request.tableName}</div>
                            <div className="staff-qr-table-sub">
                              {request.areaName} · #{request.id.slice(0, 8).toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="staff-qr-ticket-timing">
                          <span className="staff-qr-type-badge">Đơn mới</span>
                          <span className={`staff-qr-time-text ${urgency.className}`}>
                            <ClockCircleOutlined /> {formatRequestAge(request.createdAt, now)}
                          </span>
                        </div>
                      </div>

                      <div className="staff-qr-ticket-body">
                        {/* Food items list */}
                        <div className="staff-qr-ticket-items-list">
                          {request.items.map((item) => (
                            <div key={item.id} className="staff-qr-ticket-item-row">
                              <div className="staff-qr-ticket-item-left">
                                <span className="staff-qr-ticket-item-qty">{item.quantity}×</span>
                                <div className="staff-qr-ticket-item-info">
                                  <div className="staff-qr-ticket-item-name">
                                    {item.productName}
                                  </div>
                                  {item.variantName && item.variantName !== 'Mặc định' ? (
                                    <span className="staff-qr-ticket-item-variant">
                                      {item.variantName}
                                    </span>
                                  ) : null}
                                  {item.note ? (
                                    <span className="staff-qr-ticket-item-note">
                                      Ghi chú: {item.note}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="staff-qr-ticket-item-price">
                                <strong>{formatMoney(item.lineTotalVnd)}</strong>
                                <small>{formatMoney(item.unitPriceVnd)}/món</small>
                              </div>
                            </div>
                          ))}
                        </div>

                        {request.note ? (
                          <div className="staff-qr-callout-box">
                            <span className="staff-qr-callout-label">Ghi chú đơn:</span>
                            <strong className="staff-qr-callout-value">{request.note}</strong>
                          </div>
                        ) : null}

                        <div className="staff-qr-ticket-total-bar">
                          <span>Tổng cộng ({formatDecimal(itemQuantity)} món):</span>
                          <strong>{formatMoney(requestTotal)}</strong>
                        </div>
                      </div>

                      <div className="staff-qr-ticket-footer staff-qr-ticket-footer--order">
                        <Button
                          size="large"
                          className="staff-qr-action-btn staff-qr-action-btn--secondary"
                          onClick={() => navigate(`/pos/orders/${request.orderId}`)}
                        >
                          Xem đơn
                        </Button>
                        <Button
                          size="large"
                          danger
                          className="staff-qr-action-btn staff-qr-action-btn--reject"
                          loading={isRejecting}
                          disabled={anotherActionPending || isAccepting}
                          onClick={() => rejectRequest(request)}
                        >
                          Từ chối
                        </Button>
                        <Button
                          type="primary"
                          size="large"
                          icon={<CheckCircleOutlined />}
                          className="staff-qr-action-btn staff-qr-action-btn--primary"
                          loading={isAccepting}
                          disabled={anotherActionPending || isRejecting}
                          onClick={() => accept.mutate(request)}
                        >
                          Xác nhận món
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}

function MorePage({
  auth,
  onStartOnboarding,
}: {
  auth: AuthContextResponse;
  onStartOnboarding: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messageApi = toast;
  const holder = null;
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const permissions = context.data?.permissions ?? [];
  const isOwner = auth.actor?.kind === 'OWNER';
  const hasPermission = (key: string) => isOwner || permissions.includes(key);

  const logout = useMutation({
    mutationFn: () =>
      apiRequest<{ loggedOut: boolean; accessLogoutUrl: string | null }>('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': auth.csrfToken! },
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      queryClient.clear();
      if (data?.accessLogoutUrl) {
        window.location.assign(data.accessLogoutUrl);
      } else {
        navigate('/?tab=employee', { replace: true });
      }
    },
    onError: (error) => messageApi.error(errorText(error)),
  });

  return (
    <div className="staff-more-page">
      {holder}
      <section className="staff-profile-hero">
        <Avatar size={76} icon={<UserOutlined />} />
        <div>
          <Typography.Title level={2}>{auth.actor!.displayName}</Typography.Title>
          <Typography.Text>
            {isOwner ? 'Chủ cửa hàng (Quản trị viên)' : 'Nhân viên cửa hàng'}
          </Typography.Text>
        </div>
      </section>

      {/* ── Sales management ───────────────────────────────────────── */}
      <div style={{ marginBottom: 16, marginTop: 20 }}>
        <Typography.Title
          level={5}
          style={{
            margin: '0 0 10px 4px',
            color: '#475569',
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Quản lý bán hàng
        </Typography.Title>

        <Card
          styles={{ body: { padding: 0 } }}
          style={{
            overflow: 'hidden',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          }}
        >
          {hasPermission('catalog.manage') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/catalog')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#fdf2f8',
                    color: '#db2777',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <TagsOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Mặt hàng & Danh mục
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Thêm món mới, điều chỉnh giá bán, quản lý danh mục và bảng giá
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          {hasPermission('invoice.view') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/invoices')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#eff6ff',
                    color: '#0975f7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <FileTextOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Hóa đơn & Biên lai
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Xem lịch sử hóa đơn bán hàng, in lại bill, tra cứu đơn đã thanh toán
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          {hasPermission('customer.list.view') || hasPermission('customer.groups.view') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/customers')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#f0fdf4',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <UserOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Khách hàng & Công nợ
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Hồ sơ khách hàng, phân nhóm, lịch sử chi tiêu, tích điểm & thu nợ
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          {hasPermission('staff.employees.view') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/staff')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#e0e7ff',
                    color: '#4338ca',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <TeamOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Quản lý Nhân viên
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Danh sách tài khoản nhân viên, đổi mã PIN, phân quyền vai trò
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}
        </Card>
      </div>

      {/* ── Device & POS settings ───────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Title
          level={5}
          style={{
            margin: '0 0 10px 4px',
            color: '#475569',
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Thiết lập
        </Typography.Title>

        <Card
          styles={{ body: { padding: 0 } }}
          style={{
            overflow: 'hidden',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          }}
        >
          {hasPermission('order.manage') ? (
            <div
              className="staff-more-nav-item"
              onClick={() => navigate('/pos/printers')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: '#ecfdf5',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                  }}
                >
                  <PrinterOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Máy in</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                    Dò tìm và thiết lập máy in hóa đơn trên thiết bị POS này
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#94a3b8', fontSize: 14 }} />
            </div>
          ) : null}

          <button
            type="button"
            className="staff-more-nav-item staff-onboarding-entry"
            onClick={onStartOnboarding}
          >
            <span className="staff-onboarding-entry__icon">
              <QuestionCircleOutlined />
            </span>
            <span className="staff-onboarding-entry__copy">
              <strong>Hướng dẫn sử dụng POS</strong>
              <small>Xem lại cách chọn khu vực, bàn, gọi món, lưu đơn và QR Order</small>
            </span>
            <RightOutlined />
          </button>

          {/* Push Notification Setup */}
          <div style={{ padding: '14px 18px' }}>
            <PushNotificationControl csrfToken={auth.csrfToken} showGuide />
          </div>
        </Card>
      </div>

      {/* ── Store Info Section ────────────────────────────────────────── */}
      <Card
        className="staff-store-card"
        loading={context.isLoading}
        style={{ borderRadius: 14, border: '1px solid #e2e8f0' }}
      >
        <div className="staff-store-card__header">
          <div className="staff-store-card__icon-wrap">
            <ShopOutlined />
          </div>
          <div className="staff-store-card__header-info">
            <strong className="staff-store-card__name">
              {context.data?.storeName ?? 'Cửa hàng'}
            </strong>
            {context.data?.storeId ? (
              <div className="staff-store-card__code-row">
                <Tooltip title="Bấm để sao chép mã cửa hàng">
                  <Tag
                    color="blue"
                    className="staff-store-card__code-tag"
                    onClick={() => {
                      if (context.data?.storeId) {
                        navigator.clipboard.writeText(context.data.storeId);
                        messageApi.success('Đã sao chép mã cửa hàng!');
                      }
                    }}
                  >
                    <CopyOutlined style={{ marginRight: 4 }} />
                    Mã: #{context.data.storeId.slice(0, 8).toUpperCase()}
                  </Tag>
                </Tooltip>
              </div>
            ) : null}
          </div>
        </div>

        {context.data?.storeAddress ||
          context.data?.storePhone ||
          context.data?.bankAccountNumber ? (
          <div className="staff-store-card__details">
            {context.data?.storeAddress ? (
              <div className="staff-store-card__detail-item">
                <EnvironmentOutlined className="staff-store-card__detail-icon" />
                <span className="staff-store-card__detail-text">
                  Địa chỉ: {context.data.storeAddress}
                </span>
              </div>
            ) : null}
            {context.data?.storePhone ? (
              <div className="staff-store-card__detail-item">
                <PhoneOutlined className="staff-store-card__detail-icon" />
                <span className="staff-store-card__detail-text">
                  Điện thoại: {context.data.storePhone}
                </span>
              </div>
            ) : null}
            {context.data?.bankAccountNumber && context.data?.bankName ? (
              <div className="staff-store-card__detail-item">
                <BankOutlined className="staff-store-card__detail-icon" />
                <span className="staff-store-card__detail-text">
                  Tài khoản: {context.data.bankName} · {context.data.bankAccountNumber}
                  {context.data.bankAccountName ? ` (${context.data.bankAccountName})` : ''}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* ── Logout Section ───────────────────────────────────────────── */}
      <Card
        className="staff-more-actions"
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <button type="button" onClick={() => logout.mutate()}>
          <LogoutOutlined />
          <span>Đăng xuất tài khoản</span>
        </button>
      </Card>

      <Typography.Text type="secondary" className="staff-version">
        Pro POS · Cổng nhân viên bán hàng
      </Typography.Text>
    </div>
  );
}

interface StaffTablePickerModalProps {
  open: boolean;
  title?: string;
  initialTableId?: string | null;
  tables: PosTable[];
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (table: PosTable) => void;
}

function formatTableElapsed(occupiedSince: number | null, now: number) {
  if (!occupiedSince) return '';
  const totalSecs = Math.max(0, Math.floor((now - occupiedSince) / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function StaffTablePickerModal({
  open,
  title = 'Chọn khu vực',
  initialTableId,
  tables,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: StaffTablePickerModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedTableId(initialTableId ?? null);
    if (initialTableId) {
      const match = tables.find((t) => t.id === initialTableId);
      if (match) {
        setSelectedAreaId(match.areaId);
      }
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [open, initialTableId, tables]);

  const areas = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; tables: PosTable[] }
    >();
    for (const table of tables) {
      const existing = map.get(table.areaId);
      if (existing) {
        existing.tables.push(table);
      } else {
        map.set(table.areaId, {
          id: table.areaId,
          name: table.areaName,
          sortOrder: table.areaSortOrder,
          tables: [table],
        });
      }
    }
    return [...map.values()].toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
    );
  }, [tables]);

  const activeArea = areas.find((item) => item.id === selectedAreaId) ?? areas[0];

  const sortedTables = useMemo(() => {
    return (activeArea?.tables ?? []).toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }),
    );
  }, [activeArea]);

  const availableCount = sortedTables.filter((table) => table.status === 'AVAILABLE').length;
  const totalCount = sortedTables.length;
  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? null;

  return (
    <Modal
      open={open}
      title={<div className="staff-area-modal__title">{title}</div>}
      footer={
        <div className="staff-area-modal__footer">
          <Button
            type="primary"
            size="large"
            block
            disabled={!selectedTable}
            loading={confirmLoading}
            onClick={() => {
              if (selectedTable) onConfirm(selectedTable);
            }}
            className="staff-area-modal__continue-btn"
          >
            Tiếp tục
          </Button>
        </div>
      }
      width={940}
      centered
      destroyOnHidden
      onCancel={onCancel}
      className="staff-area-picker-modal"
      styles={{
        body: { padding: 0 },
      }}
    >
      <div className="staff-area-modal__body">
        <aside className="staff-area-modal__sidebar">
          {areas.map((areaItem) => {
            const isActive = areaItem.id === activeArea?.id;
            return (
              <button
                key={areaItem.id}
                type="button"
                className={`staff-area-modal__tab ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedAreaId(areaItem.id);
                  setSelectedTableId(null);
                }}
              >
                {areaItem.name}
              </button>
            );
          })}
        </aside>
        <main className="staff-area-modal__content">
          <div className="staff-area-modal__summary">
            Bàn trống: {availableCount}/{totalCount}
          </div>
          {sortedTables.length === 0 ? (
            <Empty description="Khu vực chưa có bàn" style={{ padding: '60px 0' }} />
          ) : (
            <div className="staff-area-modal__grid">
              {sortedTables.map((table) => {
                const isOccupied = table.status === 'OCCUPIED';
                const isAvailable = table.status === 'AVAILABLE';
                const isDisabled = table.status === 'DISABLED';
                const isSelected = selectedTableId === table.id;

                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={isDisabled}
                    className={[
                      'staff-area-modal__card',
                      isOccupied && 'staff-area-modal__card--occupied',
                      isAvailable && 'staff-area-modal__card--available',
                      isDisabled && 'staff-area-modal__card--disabled',
                      isSelected && 'is-selected',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (isAvailable) {
                        setSelectedTableId(isSelected ? null : table.id);
                      }
                    }}
                    onDoubleClick={() => {
                      if (isAvailable) {
                        onConfirm(table);
                      }
                    }}
                  >
                    <strong className="staff-area-modal__card-name">{table.name}</strong>
                    {isOccupied ? (
                      <span className="staff-area-modal__card-time">
                        <ClockCircleOutlined /> {formatTableElapsed(table.occupiedSince, now)}
                      </span>
                    ) : isAvailable ? (
                      <span className="staff-area-modal__card-state">
                        {isSelected ? 'Đang chọn' : ''}
                      </span>
                    ) : (
                      <span className="staff-area-modal__card-state">Tạm ngưng</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </Modal>
  );
}

interface StaffTableTransferModalProps {
  open: boolean;
  currentTable: PosTable | null;
  currentQuote: OrderQuote | null;
  tables: PosTable[];
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (targetTable: PosTable) => Promise<void>;
}

function StaffTableTransferModal({
  open,
  currentTable,
  currentQuote,
  tables,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: StaffTableTransferModalProps) {
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [confirmTargetTable, setConfirmTargetTable] = useState<PosTable | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmTargetTable(null);
      setIsTransferring(false);
    }
  }, [open]);

  const areas = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; tables: PosTable[] }
    >();
    for (const table of tables) {
      const existing = map.get(table.areaId);
      if (existing) {
        existing.tables.push(table);
      } else {
        map.set(table.areaId, {
          id: table.areaId,
          name: table.areaName,
          sortOrder: table.areaSortOrder,
          tables: [table],
        });
      }
    }
    return [...map.values()].toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
    );
  }, [tables]);

  const activeArea = areas.find((item) => item.id === selectedAreaId) ?? areas[0];

  const sortedTables = useMemo(() => {
    return (activeArea?.tables ?? []).toSorted(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }),
    );
  }, [activeArea]);

  const availableCount = sortedTables.filter(
    (table) => table.status === 'AVAILABLE' && table.id !== currentTable?.id,
  ).length;
  const totalCount = sortedTables.length;

  const currentPriceText = useMemo(() => {
    if (currentQuote?.time?.pricingConfig) {
      const cfg = currentQuote.time.pricingConfig;
      const productName = currentTable?.timeProductName ? `${currentTable.timeProductName} · ` : '';
      return `${productName}${formatMoney(cfg.basePriceVnd)}/giờ`;
    }
    if (currentTable?.defaultPriceVnd) {
      const productName = currentTable.timeProductName ? `${currentTable.timeProductName} · ` : '';
      return `${productName}${formatMoney(currentTable.defaultPriceVnd)}/giờ`;
    }
    return 'Chưa có cấu hình giá';
  }, [currentQuote, currentTable]);

  const handleExecuteTransfer = async () => {
    if (!confirmTargetTable) return;
    setIsTransferring(true);
    try {
      await onConfirm(confirmTargetTable);
      setConfirmTargetTable(null);
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <>
      <Modal
        open={open && !confirmTargetTable}
        title={
          <div className="staff-transfer-modal__title">
            <SwapOutlined />
            <span>Chuyển bàn</span>
          </div>
        }
        footer={null}
        width={920}
        centered
        destroyOnHidden
        onCancel={onCancel}
        className="staff-transfer-picker-modal"
        styles={{
          body: { padding: 0 },
        }}
      >
        <div className="staff-transfer-modal__container">
          {/* Current Table Card */}
          {currentTable ? (
            <div className="staff-transfer-source-card">
              <div className="staff-transfer-source-card__left">
                <span className="staff-transfer-source-card__badge">Bàn hiện tại</span>
                <strong className="staff-transfer-source-card__name">{currentTable.name}</strong>
                <span className="staff-transfer-source-card__area">{currentTable.areaName}</span>
              </div>
              <div className="staff-transfer-source-card__right">
                <span className="staff-transfer-source-card__label">Giá hiện tại</span>
                <span className="staff-transfer-source-card__price">{currentPriceText}</span>
              </div>
            </div>
          ) : null}

          <div className="staff-transfer-modal__layout">
            <aside className="staff-transfer-modal__sidebar">
              {areas.map((areaItem) => {
                const isActive = areaItem.id === activeArea?.id;
                return (
                  <button
                    key={areaItem.id}
                    type="button"
                    className={`staff-transfer-modal__tab ${isActive ? 'is-active' : ''}`}
                    onClick={() => setSelectedAreaId(areaItem.id)}
                  >
                    {areaItem.name}
                  </button>
                );
              })}
            </aside>

            <main className="staff-transfer-modal__content">
              <div className="staff-transfer-modal__summary">
                <span>Chọn bàn đích:</span>
                <span className="staff-transfer-modal__count">
                  Bàn trống khả dụng:{' '}
                  <strong>
                    {availableCount}/{totalCount}
                  </strong>
                </span>
              </div>

              {sortedTables.length === 0 ? (
                <Empty description="Khu vực chưa có bàn" style={{ padding: '60px 0' }} />
              ) : (
                <div className="staff-transfer-modal__grid">
                  {sortedTables.map((table) => {
                    const isCurrent = table.id === currentTable?.id;
                    const isOccupied = table.status === 'OCCUPIED';
                    const isAvailable = table.status === 'AVAILABLE' && !isCurrent;
                    const isDisabled = table.status === 'DISABLED' || isCurrent || isOccupied;

                    const priceText = table.defaultPriceVnd
                      ? `${table.timeProductName ? `${table.timeProductName} · ` : ''}${formatMoney(table.defaultPriceVnd)}/giờ`
                      : 'Mặc định';

                    return (
                      <button
                        key={table.id}
                        type="button"
                        disabled={isDisabled}
                        className={[
                          'staff-transfer-card',
                          isAvailable && 'staff-transfer-card--available',
                          isOccupied && 'staff-transfer-card--occupied',
                          isCurrent && 'staff-transfer-card--current',
                          isDisabled && 'staff-transfer-card--disabled',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          if (isAvailable) {
                            setConfirmTargetTable(table);
                          }
                        }}
                      >
                        <div className="staff-transfer-card__header">
                          <strong className="staff-transfer-card__name">{table.name}</strong>
                          <span
                            className={`staff-transfer-card__status-badge ${isCurrent ? 'is-current' : isOccupied ? 'is-occupied' : 'is-available'
                              }`}
                          >
                            {isCurrent ? 'Bàn hiện tại' : isOccupied ? 'Đang chơi' : 'Bàn trống'}
                          </span>
                        </div>
                        <div className="staff-transfer-card__price">{priceText}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        open={Boolean(confirmTargetTable)}
        title={
          <div className="staff-transfer-confirm-title">
            <SwapOutlined />
            <span>
              Chuyển {currentTable?.name ?? 'Bàn'} → {confirmTargetTable?.name ?? 'Bàn mới'}?
            </span>
          </div>
        }
        okText="Xác nhận chuyển bàn"
        cancelText="Hủy"
        okButtonProps={{
          size: 'large',
          className: 'staff-transfer-confirm-ok-btn',
        }}
        cancelButtonProps={{
          size: 'large',
        }}
        confirmLoading={isTransferring || confirmLoading}
        onOk={() => void handleExecuteTransfer()}
        onCancel={() => {
          if (!isTransferring) setConfirmTargetTable(null);
        }}
        centered
        width={480}
        destroyOnHidden
      >
        {confirmTargetTable && currentTable ? (
          <div className="staff-transfer-confirm-body">
            <div className="staff-transfer-comparison">
              <div className="staff-transfer-comparison__item">
                <span className="staff-transfer-comparison__tag">Bàn hiện tại</span>
                <strong className="staff-transfer-comparison__name">{currentTable.name}</strong>
                <span className="staff-transfer-comparison__rate">{currentPriceText}</span>
              </div>

              <div className="staff-transfer-comparison__arrow">
                <SwapOutlined />
              </div>

              <div className="staff-transfer-comparison__item staff-transfer-comparison__item--target">
                <span className="staff-transfer-comparison__tag staff-transfer-comparison__tag--target">
                  Bàn mới
                </span>
                <strong className="staff-transfer-comparison__name">
                  {confirmTargetTable.name}
                </strong>
                <span className="staff-transfer-comparison__rate">
                  {confirmTargetTable.defaultPriceVnd
                    ? `${confirmTargetTable.timeProductName ? `${confirmTargetTable.timeProductName} · ` : ''}${formatMoney(confirmTargetTable.defaultPriceVnd)}/giờ`
                    : 'Theo cấu hình bàn mới'}
                </span>
              </div>
            </div>

            <div className="staff-transfer-confirm-notes">
              <div className="staff-transfer-confirm-note-item">
                <span className="staff-transfer-dot">•</span>
                <span>Giá mới sẽ áp dụng từ thời điểm chuyển.</span>
              </div>
              <div className="staff-transfer-confirm-note-item">
                <span className="staff-transfer-dot">•</span>
                <span>Thời gian đã chơi, món đã gọi và hóa đơn hiện tại được giữ nguyên.</span>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

interface StaffPromptPriceModalProps {
  target: {
    product: CatalogProduct;
    variant: CatalogVariant;
  } | null;
  onCancel: () => void;
  onConfirm: (enteredPrice: number) => void;
}

function StaffPromptPriceModal({ target, onCancel, onConfirm }: StaffPromptPriceModalProps) {
  const [price, setPrice] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      const initial = target.variant.salePriceVnd ?? null;
      setPrice(initial);
      setErrorMsg(null);
    }
  }, [target]);

  if (!target) return null;

  const MAX_PRICE = 1_000_000_000;

  const validatePrice = (
    val: number | null,
  ): { valid: boolean; error: string | null; cleanValue: number } => {
    if (val === null || val === undefined || isNaN(val)) {
      return { valid: false, error: 'Vui lòng nhập giá bán.', cleanValue: 0 };
    }
    if (val < 0) {
      return { valid: false, error: 'Giá bán không được nhỏ hơn 0đ.', cleanValue: 0 };
    }
    if (val > MAX_PRICE) {
      return { valid: false, error: 'Giá bán tối đa là 1.000.000.000đ.', cleanValue: MAX_PRICE };
    }
    return { valid: true, error: null, cleanValue: Math.floor(val) };
  };

  const handlePriceChange = (val: number | null) => {
    if (val === null || isNaN(Number(val))) {
      setPrice(null);
      setErrorMsg('Vui lòng nhập giá bán.');
      return;
    }
    const num = Math.floor(Number(val));
    setPrice(num);
    const { error } = validatePrice(num);
    setErrorMsg(error);
  };

  const handleConfirm = () => {
    const { valid, error, cleanValue } = validatePrice(price);
    if (!valid) {
      setErrorMsg(error);
      return;
    }
    onConfirm(cleanValue);
  };

  const handleAddAmount = (amount: number) => {
    const current = price ?? 0;
    const next = Math.min(MAX_PRICE, Math.max(0, current + amount));
    setPrice(next);
    setErrorMsg(null);
  };

  const handleSetAmount = (amount: number) => {
    setPrice(amount);
    setErrorMsg(null);
  };

  const isValid = price !== null && !isNaN(price) && price >= 0 && price <= MAX_PRICE;

  const hasCustomVariantName =
    target.variant.name &&
    target.variant.name !== 'Giá mặc định' &&
    target.variant.name !== 'Mặc định' &&
    target.variant.name !== 'default';

  return (
    <Modal
      open={Boolean(target)}
      title={
        <div className="staff-prompt-modal-title">
          <EditOutlined className="staff-prompt-modal-icon" />
          <span>Nhập giá bán · {target.product.productName}</span>
        </div>
      }
      okText="Thêm vào đơn"
      cancelText="Hủy"
      okButtonProps={{ disabled: !isValid }}
      onOk={handleConfirm}
      onCancel={onCancel}
      centered
      width={460}
      className="staff-prompt-price-dialog"
      destroyOnHidden
    >
      <div className="staff-prompt-modal-content">
        {hasCustomVariantName ? (
          <div className="staff-prompt-variant-tag">
            <span>Phiên bản:</span>
            <strong>{target.variant.name}</strong>
          </div>
        ) : null}

        <div className="staff-prompt-field">
          <label className="staff-prompt-label">Đơn giá bán (VNĐ):</label>
          <InputNumber
            ref={(node) => {
              if (node) {
                setTimeout(() => node.focus(), 50);
              }
            }}
            autoFocus
            min={0}
            max={MAX_PRICE}
            step={1000}
            value={price}
            status={errorMsg ? 'error' : ''}
            onFocus={(e) => e.target.select()}
            onPressEnter={handleConfirm}
            formatter={(value) =>
              value === null || value === undefined
                ? ''
                : `${value}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
            }
            parser={(value) => {
              const cleaned = (value ?? '').replace(/\D/g, '');
              return cleaned ? Number(cleaned) : 0;
            }}
            onChange={handlePriceChange}
            suffix="đ"
            placeholder="0"
            className="staff-prompt-input"
            style={{ width: '100%' }}
          />
          {errorMsg ? <div className="staff-prompt-error-msg">{errorMsg}</div> : null}
        </div>

        {/* Quick presets for rapid touch input */}
        <div className="staff-prompt-presets">
          <div className="staff-prompt-presets-label">Gợi ý nhanh:</div>
          <div className="staff-prompt-presets-grid">
            <button
              type="button"
              className="staff-prompt-preset-btn"
              onClick={() => handleAddAmount(10000)}
            >
              +10k
            </button>
            <button
              type="button"
              className="staff-prompt-preset-btn"
              onClick={() => handleAddAmount(20000)}
            >
              +20k
            </button>
            <button
              type="button"
              className="staff-prompt-preset-btn"
              onClick={() => handleAddAmount(50000)}
            >
              +50k
            </button>
            <button
              type="button"
              className="staff-prompt-preset-btn"
              onClick={() => handleAddAmount(100000)}
            >
              +100k
            </button>
            <button
              type="button"
              className="staff-prompt-preset-btn"
              onClick={() => handleAddAmount(200000)}
            >
              +200k
            </button>
            <button
              type="button"
              className="staff-prompt-preset-btn is-clear"
              onClick={() => handleSetAmount(0)}
            >
              0đ (Xóa)
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface StaffItemDetailModalProps {
  item: EditingOrderItem | null;
  catalog: CatalogProduct[];
  onCancel: () => void;
  onSave: (updated: EditingOrderItem, selectedVariant?: CatalogVariant) => void;
  onDelete: () => void;
}

function StaffItemDetailModal({
  item,
  catalog,
  onCancel,
  onSave,
  onDelete,
}: StaffItemDetailModalProps) {
  if (!item) return null;

  const product = catalog.find(
    (p) =>
      p.productId === item.productId ||
      p.productName === item.productName ||
      (item.variantId && p.variants.some((v) => v.id === item.variantId)),
  );

  const variants: CatalogVariant[] =
    product?.variants && product.variants.length > 0
      ? product.variants
      : [
        {
          id: item.variantId ?? 'default',
          name: item.variantName || 'Giá thường',
          salePriceVnd: item.unitPriceVnd,
          promptPrice: 0,
        },
      ];

  return (
    <OrderItemDetailModal
      key={item.id}
      item={item}
      product={product}
      variants={variants}
      onCancel={onCancel}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
}

function SwipeableOrderItemRow({
  children,
  onClick,
  onDelete,
  locked = false,
  className = '',
  dataVariantId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  onDelete: () => void;
  locked?: boolean;
  className?: string;
  dataVariantId?: string;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; startOffset: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (locked) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startOffset: offsetX,
    };
    isHorizontalSwipeRef.current = null;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (isHorizontalSwipeRef.current === null) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isHorizontalSwipeRef.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    if (isHorizontalSwipeRef.current) {
      const rawOffset = touchStartRef.current.startOffset + diffX;
      // Allow swiping left between -90px and 0px
      const clampedOffset = Math.min(0, Math.max(-90, rawOffset));
      setOffsetX(clampedOffset);
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    touchStartRef.current = null;
    if (isHorizontalSwipeRef.current) {
      if (offsetX < -35) {
        setOffsetX(-76);
      } else {
        setOffsetX(0);
      }
    }
    isHorizontalSwipeRef.current = null;
  };

  const handleClick = () => {
    if (locked) return;
    if (offsetX !== 0) {
      setOffsetX(0);
      return;
    }
    onClick();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOffsetX(0);
    onDelete();
  };

  return (
    <div
      className={`staff-swipeable-item-wrapper${locked ? ' is-locked' : ''}`}
      data-variant-id={dataVariantId}
    >
      {!locked ? (
        <div
          className="staff-swipeable-delete-action"
          style={{
            opacity: offsetX < 0 ? 1 : 0,
            visibility: offsetX < 0 ? 'visible' : 'hidden',
            pointerEvents: offsetX < -30 ? 'auto' : 'none',
          }}
        >
          <button
            type="button"
            className="staff-swipeable-delete-btn"
            onClick={handleDeleteClick}
            aria-label="Xóa món"
          >
            <DeleteOutlined />
            <span>Xóa</span>
          </button>
        </div>
      ) : null}
      <div
        role="button"
        tabIndex={0}
        data-variant-id={dataVariantId}
        className={`staff-compact-order-row staff-compact-order-row--editable ${className}`}
        style={{
          transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
          transition: isSwiping ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.4, 1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function WeightInputSection({
  unitName,
  unitPriceVnd,
  quantityMilli,
  onChangeQuantityMilli,
  grossTotal,
}: {
  unitName?: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  onChangeQuantityMilli: (milli: number) => void;
  grossTotal: number;
}) {
  const unit = getWeightUnit(unitName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Buffer input as text so typing "0.", "1,", "0.5" works smoothly without premature clamping or jumping
  const [inputText, setInputText] = useState<string>(() => {
    const qty = quantityMilli / 1000;
    return qty > 0 ? qty.toString() : '';
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto focus & select text when mounted so user can immediately type without backspacing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  const handleInputChange = (raw: string) => {
    // Only allow digits, comma, period
    const cleaned = raw.replace(/[^\d.,]/g, '');
    setInputText(cleaned);

    const normalized = cleaned.replace(',', '.');
    if (!normalized || normalized === '.') {
      setErrorMsg('Vui lòng nhập trọng lượng');
      onChangeQuantityMilli(0);
      return;
    }

    const val = parseFloat(normalized);
    if (isNaN(val) || val <= 0) {
      setErrorMsg('Trọng lượng phải lớn hơn 0');
      onChangeQuantityMilli(0);
    } else if (val > 9999.999) {
      setErrorMsg('Trọng lượng vượt quá giới hạn (tối đa 9.999)');
      onChangeQuantityMilli(0);
    } else {
      setErrorMsg(null);
      onChangeQuantityMilli(Math.round(val * 1000));
    }
  };

  const handleApplyPreset = (presetVal: number) => {
    setInputText(presetVal.toString());
    setErrorMsg(null);
    onChangeQuantityMilli(Math.round(presetVal * 1000));
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleAdjust = (delta: number) => {
    const currentVal = quantityMilli / 1000;
    const newVal = Math.max(0.001, Math.round((currentVal + delta) * 1000) / 1000);
    setInputText(newVal.toString());
    setErrorMsg(null);
    onChangeQuantityMilli(Math.round(newVal * 1000));
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const isKg = unit.toLowerCase() === 'kg';
  const presets = isKg ? [0.5, 1, 1.5, 2, 3, 5] : [50, 100, 200, 500];

  return (
    <div className="staff-weight-section">
      <div className="staff-weight-section__header">
        <div className="staff-item-modal__section-title">Trọng lượng ({unit})</div>
        <div className="staff-item-modal__section-subtitle">Nhập trọng lượng thực tế</div>
      </div>

      {/* Main Large Input */}
      <div className="staff-weight-input-wrapper">
        <div className={`staff-weight-input-box ${errorMsg ? 'has-error' : ''}`}>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="staff-weight-input-field"
            value={inputText}
            placeholder="0.000"
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <span className="staff-weight-input-unit-badge">{unit}</span>
          {inputText ? (
            <button
              type="button"
              className="staff-weight-input-clear-btn"
              onClick={() => {
                setInputText('');
                setErrorMsg('Vui lòng nhập trọng lượng');
                onChangeQuantityMilli(0);
                inputRef.current?.focus();
              }}
              title="Xóa nhập lại"
            >
              <CloseCircleFilled />
            </button>
          ) : null}
        </div>

        {/* Stepper adjustment buttons */}
        <div className="staff-weight-stepper-row">
          <button
            type="button"
            className="staff-weight-adjust-btn"
            onClick={() => handleAdjust(-0.1)}
            title="Giảm 0.1"
          >
            -0.1
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn staff-weight-adjust-btn--add"
            onClick={() => handleAdjust(0.1)}
            title="Tăng 0.1"
          >
            +0.1
          </button>
          <button
            type="button"
            className="staff-weight-adjust-btn staff-weight-adjust-btn--add"
            onClick={() => handleAdjust(0.5)}
            title="Tăng 0.5"
          >
            +0.5
          </button>
        </div>
      </div>

      {errorMsg ? <div className="staff-weight-error-alert">{errorMsg}</div> : null}

      {/* Quick Presets */}
      <div className="staff-weight-presets-wrap">
        <div className="staff-weight-presets-label">Mức cân nhanh:</div>
        <div className="staff-weight-presets-list">
          {presets.map((p) => {
            const isSelected = Math.abs(quantityMilli / 1000 - p) < 0.0001;
            return (
              <button
                key={p}
                type="button"
                className={`staff-weight-preset-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => handleApplyPreset(p)}
              >
                {p} {unit}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Calculation Preview Banner */}
      <div className="staff-weight-calc-summary">
        <div className="staff-weight-calc-formula">
          {quantityMilli > 0 ? (
            <>
              <span className="staff-weight-calc-qty">
                {(quantityMilli / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{' '}
                {unit}
              </span>
              <span className="staff-weight-calc-cross">×</span>
              <span className="staff-weight-calc-rate">
                {formatMoney(unitPriceVnd)}/{unit}
              </span>
            </>
          ) : (
            <span className="staff-weight-calc-empty">Chưa có trọng lượng</span>
          )}
        </div>
        <div className="staff-weight-calc-result">
          <span className="staff-weight-calc-equals">=</span>
          <strong className="staff-weight-calc-total">{formatMoney(grossTotal)}</strong>
        </div>
      </div>
    </div>
  );
}

function OrderItemDetailModal({
  item,
  product,
  variants,
  onCancel,
  onSave,
  onDelete,
}: {
  item: EditingOrderItem;
  product?: CatalogProduct | undefined;
  variants: CatalogVariant[];
  onCancel: () => void;
  onSave: (updated: EditingOrderItem, selectedVariant?: CatalogVariant) => void;
  onDelete: () => void;
}) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
    if (item.variantId && variants.some((v) => v.id === item.variantId)) {
      return item.variantId;
    }
    return variants[0]?.id ?? 'default';
  });
  const [itemNote, setItemNote] = useState<string>(item.note ?? '');
  const [itemQuantityMilli, setItemQuantityMilli] = useState<number>(item.quantityMilli);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT' | null>(item.discountType);
  const [discountValue, setDiscountValue] = useState<number | null>(item.discountInputValue);
  const [discountReason, setDiscountReason] = useState(item.discountReason ?? '');
  const [showDiscountInput, setShowDiscountInput] = useState<boolean>(
    Boolean(item.discountType && item.discountInputValue),
  );

  const currentVariant = variants.find((v) => v.id === selectedVariantId) ?? variants[0];
  const isPromptPrice = Boolean(
    currentVariant?.promptPrice === 1 ||
    item.enteredUnitPriceVnd !== undefined ||
    (currentVariant && currentVariant.salePriceVnd === null),
  );
  const [promptUnitPrice, setPromptUnitPrice] = useState<number | null>(() => {
    return item.unitPriceVnd ?? currentVariant?.salePriceVnd ?? null;
  });

  const unitPriceVnd =
    isPromptPrice && promptUnitPrice !== null
      ? promptUnitPrice
      : (currentVariant?.salePriceVnd ?? item.unitPriceVnd);

  const grossTotal = calculateLineTotal(unitPriceVnd, itemQuantityMilli);
  const discountAmount = calculateDiscountAmount(grossTotal, discountType, discountValue);
  const netTotal = grossTotal - discountAmount;

  const handleSave = () => {
    if (
      isPromptPrice &&
      (promptUnitPrice === null ||
        promptUnitPrice < 0 ||
        isNaN(promptUnitPrice) ||
        promptUnitPrice > 1_000_000_000)
    ) {
      toast.warning('Vui lòng nhập đơn giá hợp lệ (từ 0đ đến 1.000.000.000đ)');
      return;
    }
    if (item.productType === 'WEIGHT' && itemQuantityMilli <= 0) {
      toast.warning('Vui lòng nhập trọng lượng lớn hơn 0');
      return;
    }
    if (discountAmount > 0 && !discountReason.trim()) {
      toast.warning('Vui lòng nhập lý do giảm giá');
      return;
    }

    const saveDiscountAmount = calculateDiscountAmount(grossTotal, discountType, discountValue);
    const saveNetTotal = grossTotal - saveDiscountAmount;

    onSave(
      {
        ...item,
        variantId:
          currentVariant?.id !== 'default'
            ? (currentVariant?.id ?? null)
            : (item.variantId ?? null),
        variantName:
          currentVariant?.id !== 'default' ? (currentVariant?.name ?? null) : item.variantName,
        unitPriceVnd,
        quantityMilli: itemQuantityMilli,
        note: itemNote.trim(),
        grossLineTotalVnd: grossTotal,
        discountAmountVnd: saveDiscountAmount,
        discountType,
        discountInputValue: discountValue,
        discountReason: discountAmount > 0 ? discountReason.trim() : null,
        netLineTotalVnd: saveNetTotal,
      },
      currentVariant,
    );
  };

  const isNewPick = Boolean(item.discardOnCancel);

  return (
    <Modal
      open
      title={<div className="staff-item-modal__header-title">{item.productName}</div>}
      width={540}
      centered
      destroyOnHidden
      onCancel={onCancel}
      footer={null}
      wrapClassName="staff-item-detail-modal-wrap"
      className="staff-item-detail-modal-v2"
    >
      <div className="staff-item-modal__body">
        <div className="staff-item-modal__scrollable-content">
          <div className="staff-item-modal__avatar-wrap">
            <div
              className={`staff-item-modal__avatar-box ${product?.avatarType === 'IMAGE' && product?.mediaId ? 'has-image' : 'has-color'}`}
              style={{
                background:
                  product?.avatarType === 'IMAGE' && product?.mediaId
                    ? undefined
                    : product?.avatarColor || '#0975f7',
              }}
            >
              {product?.avatarType === 'IMAGE' && product?.mediaId ? (
                <img
                  src={`/api/v1/media/${product.mediaId}`}
                  alt={item.productName}
                  className="staff-item-modal__avatar-img"
                />
              ) : (
                <span className="staff-item-modal__avatar-letter">
                  {getProductInitials(item.productName)}
                </span>
              )}
            </div>
          </div>

          {variants.length > 1 ? (
            <div className="staff-item-modal__section">
              <div className="staff-item-modal__section-title">Phiên bản giá</div>
              <div className="staff-item-modal__section-subtitle">Chọn một phiên bản giá</div>
              <div className="staff-item-modal__variants">
                {variants.map((v) => {
                  const isChecked = v.id === selectedVariantId;
                  return (
                    <div
                      key={v.id}
                      className={`staff-item-modal__variant-row ${isChecked ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedVariantId(v.id);
                      }}
                    >
                      <div className="staff-item-modal__variant-left">
                        <div className={`staff-item-modal__radio ${isChecked ? 'is-checked' : ''}`}>
                          {isChecked ? <div className="staff-item-modal__radio-inner" /> : null}
                        </div>
                        <span className="staff-item-modal__variant-name">{v.name}</span>
                      </div>
                      <strong className="staff-item-modal__variant-price">
                        {formatMoney(v.salePriceVnd ?? unitPriceVnd)}
                        {item.productType === 'WEIGHT' ? `/${getWeightUnit(item.unitName)}` : ''}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Custom Unit Price for Prompt-Price / Surcharge items */}
          {isPromptPrice ? (
            <div className="staff-item-modal__section">
              <div className="staff-item-modal__section-title">Đơn giá bán (Nhập giá khi bán)</div>
              <InputNumber
                min={0}
                max={1_000_000_000}
                step={1000}
                value={promptUnitPrice}
                onFocus={(e) => e.target.select()}
                formatter={(val) =>
                  val === null || val === undefined
                    ? ''
                    : `${val}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
                }
                parser={(val) => {
                  const cleaned = (val ?? '').replace(/\D/g, '');
                  return cleaned ? Number(cleaned) : 0;
                }}
                onChange={(val) =>
                  setPromptUnitPrice(
                    val === null || isNaN(Number(val)) ? null : Math.floor(Number(val)),
                  )
                }
                suffix="đ"
                placeholder="0"
                style={{ width: '100%' }}
              />
            </div>
          ) : null}

          {/* Dedicated Weight Input Section for WEIGHT items */}
          {item.productType === 'WEIGHT' ? (
            <WeightInputSection
              unitName={item.unitName}
              unitPriceVnd={unitPriceVnd}
              quantityMilli={itemQuantityMilli}
              onChangeQuantityMilli={setItemQuantityMilli}
              grossTotal={grossTotal}
            />
          ) : null}

          <div className="staff-item-modal__section">
            <div className="staff-item-modal__section-title">Ghi chú</div>
            <Input.TextArea
              rows={2}
              placeholder="Nhập ghi chú"
              value={itemNote}
              onChange={(e) => setItemNote(e.target.value)}
              className="staff-item-modal__note-input"
            />
          </div>

          <div className="staff-item-modal__section">
            <div className="staff-item-modal__section-title">Giảm giá sản phẩm</div>
            {!showDiscountInput && discountAmount === 0 ? (
              <button
                type="button"
                className="staff-item-modal__discount-toggle"
                onClick={() => {
                  setShowDiscountInput(true);
                  setDiscountType('FIXED');
                }}
              >
                <span>Giảm giá thủ công</span>
                <PlusCircleOutlined className="staff-item-modal__plus-icon" />
              </button>
            ) : (
              <div className="staff-item-modal__discount-box">
                <div className="staff-item-modal__discount-row">
                  <Radio.Group
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                    size="middle"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="FIXED">VNĐ</Radio.Button>
                    <Radio.Button value="PERCENT">%</Radio.Button>
                  </Radio.Group>
                  <InputNumber
                    min={0}
                    max={discountType === 'PERCENT' ? 100 : grossTotal}
                    value={discountValue}
                    onChange={(val) => setDiscountValue(val === null ? null : Number(val))}
                    placeholder="0"
                    suffix={discountType === 'PERCENT' ? '%' : 'đ'}
                    formatter={(val) => `${val ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')}
                    parser={(val) => Number((val ?? '').replaceAll('.', ''))}
                    style={{ flex: 1 }}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    className="staff-item-modal__discount-delete-btn"
                    onClick={() => {
                      setDiscountType(null);
                      setDiscountValue(null);
                      setDiscountReason('');
                      setShowDiscountInput(false);
                    }}
                  />
                </div>
                {discountAmount > 0 ? (
                  <div className="staff-item-modal__discount-preview">
                    Giảm: -{formatMoney(discountAmount)} (Còn {formatMoney(netTotal)})
                  </div>
                ) : null}
                <Input.TextArea
                  rows={2}
                  maxLength={300}
                  showCount
                  value={discountReason}
                  status={discountAmount > 0 && !discountReason.trim() ? 'error' : ''}
                  placeholder="Nhập lý do giảm giá (*)"
                  onChange={(event) => setDiscountReason(event.target.value)}
                  className="staff-item-modal__discount-reason"
                />
              </div>
            )}
          </div>
        </div>

        <div className="staff-item-modal__footer">
          <div className="staff-item-modal__qty-row">
            <span className="staff-item-modal__qty-label">
              {item.productType === 'WEIGHT' ? `Tổng trọng lượng:` : 'Số lượng:'}
            </span>
            {item.productType === 'WEIGHT' ? (
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0877ee' }}>
                {(itemQuantityMilli / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{' '}
                {getWeightUnit(item.unitName)}
              </span>
            ) : (
              <div className="staff-item-modal__stepper">
                <button
                  type="button"
                  className="staff-item-modal__stepper-btn"
                  disabled={itemQuantityMilli <= 1000}
                  onClick={() => setItemQuantityMilli((prev) => Math.max(1000, prev - 1000))}
                >
                  <MinusOutlined />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="staff-item-modal__stepper-val"
                  value={itemQuantityMilli / 1000}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '');
                    if (raw === '') {
                      setItemQuantityMilli(0);
                      return;
                    }
                    const num = Math.min(999, Math.max(1, parseInt(raw, 10)));
                    setItemQuantityMilli(num * 1000);
                  }}
                  onBlur={() => {
                    if (itemQuantityMilli < 1000) {
                      setItemQuantityMilli(1000);
                    }
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="staff-item-modal__stepper-btn"
                  onClick={() => setItemQuantityMilli((prev) => prev + 1000)}
                >
                  <PlusOutlined />
                </button>
              </div>
            )}
          </div>

          <div className="staff-item-modal__actions">
            {isNewPick ? (
              <Button
                size="large"
                className="staff-item-modal__cancel-action-btn"
                onClick={onCancel}
              >
                Hủy
              </Button>
            ) : (
              <Button
                danger
                size="large"
                icon={<DeleteOutlined />}
                className="staff-item-modal__delete-action-btn"
                onClick={onDelete}
              >
                {item.source === 'SAVED' ? 'Xóa món' : 'Xóa khỏi giỏ'}
              </Button>
            )}
            <Button
              type="primary"
              size="large"
              className="staff-item-modal__save-btn"
              disabled={item.productType === 'WEIGHT' && itemQuantityMilli <= 0}
              onClick={handleSave}
            >
              {isNewPick ? 'Thêm vào đơn' : 'Lưu'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── QuickAddProductModal ─────────────────────────────────────────────────────
// A compact popup to quickly create a QUANTITY or WEIGHT product from the POS
// screen. Only available to users with catalog.manage permission (or Owner).
// Does NOT support TIME products (those have complex pricing configuration).
// ─────────────────────────────────────────────────────────────────────────────

interface QuickVariantRow {
  name: string;
  salePriceVnd: number | null;
  promptPrice: boolean;
}

interface QuickProductForm {
  name: string;
  productType: 'QUANTITY' | 'WEIGHT';
  categoryId?: string;
  unitId?: string;
  variants: QuickVariantRow[];
}

const AVATAR_COLORS_QA = [
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#34d399',
  '#38bdf8',
  '#818cf8',
  '#e879f9',
  '#94a3b8',
  '#f97316',
];

function QuickAddProductModal({
  open,
  auth,
  onClose,
  onCreated,
}: {
  open: boolean;
  auth: AuthContextResponse;
  onClose: () => void;
  onCreated: (productId: string, name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<QuickProductForm>();
  const [saving, setSaving] = useState(false);
  const [productType, setProductType] = useState<'QUANTITY' | 'WEIGHT'>('QUANTITY');

  // Inline category creation states
  const [categorySearch, setCategorySearch] = useState('');
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categorySelectOpen, setCategorySelectOpen] = useState(false);

  // Inline unit creation states
  const [unitSearch, setUnitSearch] = useState('');
  const [inlineUnitName, setInlineUnitName] = useState('');
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [unitSelectOpen, setUnitSelectOpen] = useState(false);

  const categories = useQuery({
    queryKey: ['owner-catalog-categories'],
    queryFn: () =>
      apiRequest<{ id: string; name: string; status?: string }[]>(
        '/api/v1/owner/catalog/categories',
      ),
    enabled: open,
    staleTime: 60_000,
  });

  const units = useQuery({
    queryKey: ['owner-units'],
    queryFn: () => apiRequest<{ id: string; name: string }[]>('/api/v1/owner/catalog/units'),
    enabled: open,
    staleTime: 60_000,
  });

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
      return;
    }
    setCreatingCategory(true);
    try {
      const result = await jsonRequest<{ id: string }>(
        '/api/v1/owner/catalog/categories',
        { name },
        { headers: { 'X-CSRF-Token': auth.csrfToken ?? '' } },
      );
      queryClient.setQueryData<{ id: string; name: string; status?: string }[]>(
        ['owner-catalog-categories'],
        (old) => {
          const current = old ?? [];
          if (current.some((c) => c.id === result.id)) return current;
          return [...current, { id: result.id, name, status: 'ACTIVE' }];
        },
      );
      form.setFieldsValue({ categoryId: result.id });
      setCategorySearch('');
      setInlineCategoryName('');
      setCategorySelectOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['owner-catalog-categories'] });
      toast.success(`Đã thêm danh mục "${name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể thêm danh mục.');
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
      return;
    }
    setCreatingUnit(true);
    try {
      const result = await jsonRequest<{ id: string }>(
        '/api/v1/owner/catalog/units',
        { name },
        { headers: { 'X-CSRF-Token': auth.csrfToken ?? '' } },
      );
      queryClient.setQueryData<{ id: string; name: string }[]>(['owner-units'], (old) => {
        const current = old ?? [];
        if (current.some((u) => u.id === result.id)) return current;
        return [...current, { id: result.id, name }];
      });
      form.setFieldsValue({ unitId: result.id });
      setUnitSearch('');
      setInlineUnitName('');
      setUnitSelectOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['owner-units'] });
      toast.success(`Đã thêm đơn vị tính "${name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể thêm đơn vị.');
    } finally {
      setCreatingUnit(false);
    }
  };

  const categoryDropdown = (menu: React.ReactNode) => {
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
                style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }}
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

  const unitDropdown = (menu: React.ReactNode) => {
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
                style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }}
              >
                Thêm đơn vị &ldquo;{trimmedSearch}&rdquo;
              </Button>
            </div>
          ) : null}
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="middle"
              placeholder="Nhập đơn vị mới..."
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

  // Pick random avatar color
  const avatarColor =
    AVATAR_COLORS_QA[Math.floor(Math.random() * AVATAR_COLORS_QA.length)] ?? '#818cf8';

  const handleClose = () => {
    form.resetFields();
    setProductType('QUANTITY');
    setCategorySearch('');
    setInlineCategoryName('');
    setUnitSearch('');
    setInlineUnitName('');
    onClose();
  };

  const save = async (values: QuickProductForm) => {
    setSaving(true);
    try {
      const payload = {
        name: values.name.trim(),
        productType: values.productType,
        categoryId: values.categoryId || null,
        unitId: values.unitId || null,
        avatarType: 'COLOR' as const,
        avatarColor,
        mediaId: null,
        variants: (values.variants ?? []).map((v) => ({
          name: v.name?.trim() || 'Giá mặc định',
          salePriceVnd: v.promptPrice ? null : (v.salePriceVnd ?? 0),
          costPriceVnd: 0,
          promptPrice: Boolean(v.promptPrice),
        })),
      };
      const saved = await jsonRequest<{ id: string }>('/api/v1/owner/catalog/products', payload, {
        headers: { 'X-CSRF-Token': auth.csrfToken ?? '' },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-catalog-categories'] }),
      ]);
      onCreated(saved.id, values.name.trim());
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể thêm mặt hàng.';
      Modal.error({ title: 'Lỗi', content: msg, centered: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={<span style={{ fontWeight: 700, fontSize: 16 }}>➕ Thêm nhanh mặt hàng</span>}
      footer={null}
      centered
      width={540}
      styles={{ body: { paddingTop: 8 } }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void save(values)}
        initialValues={{
          productType: 'QUANTITY',
          variants: [{ name: 'Giá mặc định', salePriceVnd: 0, promptPrice: false }],
        }}
      >
        {/* Tên mặt hàng */}
        <Form.Item
          name="name"
          label="Tên mặt hàng"
          rules={[{ required: true, message: 'Vui lòng nhập tên mặt hàng.' }]}
        >
          <Input placeholder="Ví dụ: Nước suối, Bít tết, Trà đào..." maxLength={160} autoFocus />
        </Form.Item>

        {/* Loại / Danh mục / Đơn vị */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="productType" label="Loại tính tiền" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'QUANTITY', label: '📦 Số lượng' },
                { value: 'WEIGHT', label: '⚖️ Trọng lượng' },
              ]}
              onChange={(v: 'QUANTITY' | 'WEIGHT') => setProductType(v)}
            />
          </Form.Item>
          <Form.Item name="categoryId" label="Danh mục">
            <Select
              allowClear
              showSearch
              open={categorySelectOpen}
              onDropdownVisibleChange={setCategorySelectOpen}
              optionFilterProp="label"
              placeholder="Chọn hoặc thêm danh mục"
              loading={categories.isLoading}
              searchValue={categorySearch}
              onSearch={setCategorySearch}
              onChange={(val) => {
                form.setFieldValue('categoryId', val);
                setCategorySearch('');
              }}
              dropdownRender={categoryDropdown}
              options={(categories.data ?? [])
                .filter((c) => c.status !== 'DISABLED')
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="unitId"
          label={productType === 'WEIGHT' ? 'Đơn vị trọng lượng' : 'Đơn vị tính'}
          rules={[{ required: true, message: 'Vui lòng chọn đơn vị.' }]}
        >
          <Select
            showSearch
            allowClear
            open={unitSelectOpen}
            onDropdownVisibleChange={setUnitSelectOpen}
            optionFilterProp="label"
            placeholder="Chọn hoặc thêm đơn vị (vd: cái, ly, kg...)"
            loading={units.isLoading}
            searchValue={unitSearch}
            onSearch={setUnitSearch}
            onChange={(val) => {
              form.setFieldValue('unitId', val);
              setUnitSearch('');
            }}
            dropdownRender={unitDropdown}
            options={(units.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          />
        </Form.Item>

        <Divider style={{ margin: '8px 0' }} />

        {/* Danh sách phiên bản giá */}
        <Form.List name="variants">
          {(fields, { add, remove }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                Phiên bản giá <span style={{ color: '#6b7280', fontWeight: 400 }}>(ít nhất 1)</span>
              </div>
              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr auto auto',
                    gap: 8,
                    alignItems: 'flex-end',
                  }}
                >
                  <Form.Item
                    name={[field.name, 'name']}
                    label={index === 0 ? 'Tên giá' : undefined}
                    rules={[{ required: true, message: 'Nhập tên.' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder={index === 0 ? 'Giá mặc định' : 'Size M, Size L...'} />
                  </Form.Item>

                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) =>
                      prev.variants?.[field.name]?.promptPrice !==
                      cur.variants?.[field.name]?.promptPrice
                    }
                  >
                    {({ getFieldValue }) => {
                      const isPrompt = Boolean(
                        getFieldValue(['variants', field.name, 'promptPrice']),
                      );
                      return (
                        <Form.Item
                          name={[field.name, 'salePriceVnd']}
                          label={index === 0 ? 'Giá bán' : undefined}
                          rules={isPrompt ? [] : [{ required: true, message: 'Nhập giá.' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <InputNumber
                            min={0}
                            disabled={isPrompt}
                            className="owner-full-width"
                            addonAfter="đ"
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>

                  <Form.Item
                    name={[field.name, 'promptPrice']}
                    valuePropName="checked"
                    label={index === 0 ? 'Nhập khi bán' : undefined}
                    style={{ marginBottom: 0 }}
                  >
                    <Checkbox />
                  </Form.Item>

                  {fields.length > 1 && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      style={{ marginBottom: 0, alignSelf: 'flex-end' }}
                      onClick={() => remove(field.name)}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="dashed"
                block
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ name: `Giá ${fields.length + 1}`, salePriceVnd: 0, promptPrice: false })
                }
                style={{ marginTop: 4 }}
              >
                Thêm phiên bản giá
              </Button>
            </div>
          )}
        </Form.List>

        {/* Footer actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
            paddingTop: 12,
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <Button onClick={handleClose}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            Thêm mặt hàng
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

interface PosProductCardProps {
  product: CatalogProduct;
  isPriority: boolean;
  onSelect: (product: CatalogProduct, event?: React.MouseEvent) => void;
}

const PosProductCard = memo(function PosProductCard({
  product,
  isPriority,
  onSelect,
}: PosProductCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const prices = product.variants
    .map((variant) => variant.salePriceVnd)
    .filter((price): price is number => price !== null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

  const hasImage = product.avatarType === 'IMAGE' && Boolean(product.mediaId) && !imgError;

  return (
    <button
      type="button"
      className={`staff-product-card ${hasImage ? 'has-image-card' : 'has-color-card'}`}
      onClick={(e) => onSelect(product, e)}
    >
      <span
        className={`staff-product-card__visual ${hasImage ? 'has-image' : 'has-color'}`}
        style={{
          background: hasImage ? undefined : product.avatarColor || '#0975f7',
        }}
      >
        {hasImage ? (
          <img
            src={`/api/v1/media/${product.mediaId}`}
            alt={product.productName}
            loading={isPriority ? 'eager' : 'lazy'}
            fetchPriority={isPriority ? 'high' : 'low'}
            decoding="async"
            className={`staff-product-card__img ${imgLoaded ? 'is-loaded' : ''}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : (
          getProductInitials(product.productName)
        )}
      </span>
      <div className="staff-product-card__info">
        <strong className="staff-product-card__name">{product.productName}</strong>
        <div className="staff-product-card__meta">
          {product.variants.length > 1 ? <small>{product.variants.length} phiên bản</small> : null}
        </div>
        <b className="staff-product-card__price">
          {minPrice === null
            ? 'Nhập giá'
            : minPrice === maxPrice
              ? `${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`
              : `Từ ${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`}
        </b>
      </div>
    </button>
  );
});

function OrderEditor({
  auth,
  orderIdOverride,
  suppressPaymentAutoResume = false,
}: {
  auth: AuthContextResponse;
  orderIdOverride?: string;
  suppressPaymentAutoResume?: boolean;
}) {
  const location = useLocation();
  const orderId = orderIdOverride ?? location.pathname.match(/^\/pos\/orders\/([^/]+)$/u)?.[1];
  const isNew = !orderId || orderId === 'new';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { serverTimeOffsetMs, status: realtimeStatus } = useRealtime();
  const messageApi = toast;
  const holder = null;
  const preselectedTableId = searchParams.get('tableId');
  const typeParam = searchParams.get('type');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>(() => {
    if (typeParam === 'TAKEAWAY') return 'TAKEAWAY';
    return 'DINE_IN';
  });
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [modifiedItemQuantities, setModifiedItemQuantities] = useState<Record<string, number>>({});
  const [modifiedItemDetails, setModifiedItemDetails] = useState<
    Record<string, PendingSavedItemEdit>
  >({});
  const [conflictingSavedItemIds, setConflictingSavedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableAction, setTableAction] = useState<'SELECT' | 'SAVE' | 'CHECKOUT'>('SELECT');
  const [saving, setSaving] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [variantProduct, setVariantProduct] = useState<CatalogProduct | null>(null);
  const [promptTarget, setPromptTarget] = useState<{
    product: CatalogProduct;
    variant: CatalogVariant;
  } | null>(null);
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [editingItem, setEditingItem] = useState<EditingOrderItem | null>(null);
  const [timeDetailOpen, setTimeDetailOpen] = useState(false);
  const [timeRangeDraft, setTimeRangeDraft] = useState<{
    startedAt: Dayjs | null;
    endedAt: Dayjs | null;
  }>({ startedAt: null, endedAt: null });
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [deleteItemModalOpen, setDeleteItemModalOpen] = useState(false);
  const [deleteItemTarget, setDeleteItemTarget] = useState<{
    id: string;
    name: string;
    source: 'DRAFT' | 'SAVED';
  } | null>(null);
  const [deleteItemReason, setDeleteItemReason] = useState('');
  const deletingItem = false;
  const [deleteTimeModalOpen, setDeleteTimeModalOpen] = useState(false);
  const [deleteTimeReason, setDeleteTimeReason] = useState('');
  const [deletingTime, setDeletingTime] = useState(false);
  const [timeRestoringDraft, setTimeRestoringDraft] = useState(false);
  const [timeRemoved, setTimeRemoved] = useState(false);
  const [orderedItemsCollapsed, setOrderedItemsCollapsed] = useState(false);
  const [cartTab, setCartTab] = useState<'DETAILS' | 'CUSTOMER' | 'ACTIONS'>('DETAILS');
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [provisionalBillOpen, setProvisionalBillOpen] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [autoResumeRetryToken, setAutoResumeRetryToken] = useState(0);
  const [stoppingTime, setStoppingTime] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false,
  );
  const [isDesktopPayment, setIsDesktopPayment] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : false,
  );
  const [mobileView, setMobileView] = useState<'CART' | 'PRODUCTS'>('CART');
  const cartIconRef = useRef<HTMLButtonElement>(null);
  const autoResumePaymentInFlightRef = useRef(false);
  const restoredDraftOrderRef = useRef<string | null>(null);
  const draftBaseVersionRef = useRef<number | null>(null);
  const committedQuantitiesRef = useRef<Record<string, number>>({});
  const committedOrderVersionRef = useRef<number | null>(null);
  const [recentlyAddedLineKey, setRecentlyAddedLineKey] = useState<string | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [guestCount, setGuestCount] = useState<number>(1);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [promotionModalOpen, setPromotionModalOpen] = useState(false);
  const [promotionSaving, setPromotionSaving] = useState(false);
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [manualPromotionIds, setManualPromotionIds] = useState<string[] | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [tableQrModalOpen, setTableQrModalOpen] = useState(false);
  const [tableQrData, setTableQrData] = useState<{
    tableName: string;
    url: string;
    image: string;
    orderCode?: string;
  } | null>(null);
  const [tableQrLoading, setTableQrLoading] = useState(false);
  const [cartWidth, setCartWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('pos_cart_width');
      return saved ? Math.max(360, Math.min(800, Number(saved))) : 480;
    } catch {
      return 480;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const csrf = auth.csrfToken!;

  const draftItemsPayload = () =>
    draftLines.map((line) => ({
      productId: line.product.productId,
      variantId: line.variant.id,
      enteredUnitPriceVnd:
        line.variant.promptPrice === 1 ? (line.variant.salePriceVnd ?? undefined) : undefined,
      quantityMilli: line.quantityMilli,
      note: line.note,
      discount:
        line.discountType && line.discountInputValue !== null
          ? {
            type: line.discountType,
            value: line.discountInputValue,
            reason: line.discountReason ?? '',
          }
          : null,
    }));

  const updatedItemsPayload = () => {
    if (!quote.data) return [];
    const ids = new Set([
      ...Object.keys(modifiedItemQuantities),
      ...Object.keys(modifiedItemDetails),
    ]);
    return [...ids].flatMap((itemId) => {
      const item = quote.data?.items.find((candidate) => candidate.id === itemId);
      if (!item || item.promotionGift) return [];
      const quantityMilli = modifiedItemQuantities[itemId] ?? item.quantityMilli;
      const details = modifiedItemDetails[itemId];
      if (quantityMilli === item.quantityMilli && !details) return [];
      return [{ itemId, quantityMilli, ...details }];
    });
  };

  const hasPendingSavedItemChanges = () => updatedItemsPayload().length > 0;

  const clearOrderDraft = () => {
    setDraftLines([]);
    setModifiedItemQuantities({});
    setModifiedItemDetails({});
    setConflictingSavedItemIds(new Set());
    draftBaseVersionRef.current = null;
    if (!isNew && orderId) {
      try {
        localStorage.removeItem(`propos:order-draft:${orderId}`);
      } catch {
        // Local recovery is best-effort only.
      }
    }
  };

  const applyOrderMutationSnapshot = (snapshot: OrderMutationSnapshot) => {
    queryClient.setQueryData<OrderQuote>(['pos-order-quote', snapshot.order.id], snapshot.quote);
    const changedTables = new Map(snapshot.tableSummaries.map((table) => [table.id, table]));
    const itemCount = snapshot.quote.items.reduce(
      (sum, item) => sum + item.quantityMilli / 1000,
      0,
    );
    const overviewOrder: PosOverviewOrder = {
      id: snapshot.order.id,
      displayCode: snapshot.order.displayCode ?? '',
      orderType: snapshot.order.orderType,
      status: snapshot.order.status,
      version: snapshot.order.version,
      openedAt: snapshot.order.openedAt,
      itemCount,
      totalVnd: snapshot.quote.totalVnd,
      tableId: snapshot.order.tableId,
      tableName: snapshot.order.tableName,
      areaName: snapshot.order.areaName,
      timeStatus: snapshot.quote.time?.status ?? null,
    };
    queryClient.setQueryData<PosTable[]>(['pos-tables'], (cached) => {
      if (!cached || snapshot.tableSummaries.length === 0) return cached;
      return cached.map((table) => changedTables.get(table.id) ?? table);
    });
    queryClient.setQueryData<PosOverviewSnapshot>(['pos-overview'], (cached) => {
      if (!cached) return cached;
      const tables =
        snapshot.tableSummaries.length === 0
          ? cached.tables
          : cached.tables.map((table) => changedTables.get(table.id) ?? table);
      const orderIndex = cached.orders.findIndex((order) => order.id === overviewOrder.id);
      const orders =
        orderIndex < 0
          ? [...cached.orders, overviewOrder]
          : cached.orders.map((order, index) =>
            index === orderIndex ? { ...order, ...overviewOrder } : order,
          );
      return { ...cached, tables, orders, serverNowMs: snapshot.serverNowMs };
    });
    queryClient.setQueryData<PosOverviewOrder[]>(['pos-orders-list'], (cached) => {
      if (!cached) return cached;
      const orderIndex = cached.findIndex((order) => order.id === overviewOrder.id);
      return orderIndex < 0
        ? [...cached, overviewOrder]
        : cached.map((order, index) =>
          index === orderIndex ? { ...order, ...overviewOrder } : order,
        );
    });
    if (snapshot.callBatch) {
      queryClient.setQueryData<OrderCallBatchPageDto>(
        ['pos-order-call-batches', snapshot.order.id],
        (cached) => ({
          items: [
            snapshot.callBatch!,
            ...(cached?.items ?? []).filter((batch) => batch.id !== snapshot.callBatch!.id),
          ],
          nextBeforeSequence: cached?.nextBeforeSequence ?? null,
        }),
      );
    }
  };

  const navigateToPayment = (targetOrderId: string, replace = false) => {
    markPaymentNavigationStarted(targetOrderId);
    const canonicalOrderPath = `/pos/orders/${targetOrderId}`;
    const leavingNewOrder =
      isNew || orderId !== targetOrderId || location.pathname !== canonicalOrderPath;
    if (isDesktopPayment) {
      if (leavingNewOrder) {
        navigate(canonicalPaymentPath(targetOrderId, true), { replace: true });
        return;
      }
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('checkout', '1');
          return next;
        },
        { replace },
      );
      return;
    }
    navigate(canonicalPaymentPath(targetOrderId, false), {
      replace: leavingNewOrder || replace,
    });
  };

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 900);
      setIsDesktopPayment(window.innerWidth >= 1200);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDownResizer = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = cartWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(360, Math.min(window.innerWidth - 380, startWidth + deltaX));
      setCartWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const deltaX = startX - upEvent.clientX;
      const finalWidth = Math.max(360, Math.min(window.innerWidth - 380, startWidth + deltaX));
      try {
        localStorage.setItem('pos_cart_width', String(finalWidth));
      } catch {
        // ignore
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleExit = () => {
    void queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-orders-list'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
    if (draftLines.length > 0 || hasPendingSavedItemChanges()) {
      setDiscardModalOpen(true);
    } else if (orderType === 'TAKEAWAY' || quote.data?.order.orderType === 'TAKEAWAY') {
      navigate('/pos/areas?tab=takeaway', { state: { selectedArea: '__TAKEAWAY__' } });
    } else {
      navigate('/pos/areas');
    }
  };

  useEffect(() => {
    setModifiedItemQuantities({});
    setModifiedItemDetails({});
    setConflictingSavedItemIds(new Set());
    setDraftLines([]);
    restoredDraftOrderRef.current = null;
    draftBaseVersionRef.current = null;
    committedQuantitiesRef.current = {};
    committedOrderVersionRef.current = null;
  }, [orderId]);

  const catalog = useQuery({
    queryKey: ['pos-catalog'],
    queryFn: ({ signal }) => apiRequest<CatalogProduct[]>('/api/v1/pos/catalog', { signal }),
    staleTime: 15 * 60_000,
    refetchOnMount: false,
  });
  const tables = useQuery({
    queryKey: ['pos-tables'],
    queryFn: ({ signal }) => apiRequest<PosTable[]>('/api/v1/pos/tables', { signal }),
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  });
  const quote = useQuery(
    orderQuoteQueryOptions<OrderQuote>({
      orderId: orderId ?? '',
      enabled: !isNew && Boolean(orderId),
      realtimeStatus,
    }),
  );
  const [verifiedQuoteOrderId, setVerifiedQuoteOrderId] = useState<string | null>(null);
  useEffect(() => {
    if (
      !isNew &&
      orderId &&
      quote.data?.order.id === orderId &&
      quote.isFetchedAfterMount &&
      quote.isSuccess &&
      !quote.isFetching &&
      !quote.isRefetchError
    ) {
      setVerifiedQuoteOrderId(orderId);
    }
  }, [
    isNew,
    orderId,
    quote.data?.order.id,
    quote.isFetchedAfterMount,
    quote.isFetching,
    quote.isRefetchError,
    quote.isSuccess,
  ]);
  const quoteReady = isNew || (Boolean(orderId) && verifiedQuoteOrderId === orderId);
  const callHistory = useQuery({
    queryKey: ['pos-order-call-batches', orderId],
    queryFn: ({ signal }) =>
      apiRequest<OrderCallBatchPageDto>(`/api/v1/pos/orders/${orderId}/call-batches?limit=20`, {
        signal,
      }),
    enabled: !isNew && Boolean(quote.data?.order.hasCallHistory) && callHistoryOpen,
    staleTime: 30_000,
    refetchOnMount: false,
  });
  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const canManageCatalog =
    auth.actor?.kind === 'OWNER' ||
    (staffContext.data?.permissions ?? []).includes('catalog.manage');

  useEffect(() => {
    if (!quote.data) return;
    const nextCommitted = Object.fromEntries(
      quote.data.items.map((item) => [item.id, item.quantityMilli]),
    );
    const previousVersion = committedOrderVersionRef.current;
    if (previousVersion !== null && previousVersion !== quote.data.order.version) {
      const changedIds = new Set(
        Object.keys(modifiedItemQuantities).filter((itemId) => {
          const previousBase = committedQuantitiesRef.current[itemId];
          const nextBase = nextCommitted[itemId];
          return previousBase !== undefined && nextBase !== undefined && previousBase !== nextBase;
        }),
      );
      if (changedIds.size > 0) {
        setModifiedItemQuantities((pending) => {
          const rebased = { ...pending };
          for (const itemId of changedIds) {
            const previousBase = committedQuantitiesRef.current[itemId]!;
            const nextBase = nextCommitted[itemId]!;
            rebased[itemId] = Math.max(
              0,
              nextBase + ((pending[itemId] ?? previousBase) - previousBase),
            );
          }
          return rebased;
        });
        setConflictingSavedItemIds((current) => new Set([...current, ...changedIds]));
      }
    }
    committedQuantitiesRef.current = nextCommitted;
    committedOrderVersionRef.current = quote.data.order.version;
  }, [modifiedItemQuantities, quote.data]);

  useEffect(() => {
    if (isNew || !orderId || !quote.data || restoredDraftOrderRef.current === orderId) return;
    restoredDraftOrderRef.current = orderId;
    try {
      const raw = localStorage.getItem(`propos:order-draft:${orderId}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        baseVersion?: number;
        draftLines?: DraftLine[];
        modifiedItemQuantities?: Record<string, number>;
        modifiedItemDetails?: Record<string, PendingSavedItemEdit>;
      };
      const hasDraft =
        (saved.draftLines?.length ?? 0) > 0 ||
        Object.keys(saved.modifiedItemQuantities ?? {}).length > 0 ||
        Object.keys(saved.modifiedItemDetails ?? {}).length > 0;
      if (!hasDraft) return;
      Modal.confirm({
        title: 'Khôi phục thay đổi chưa lưu?',
        content:
          saved.baseVersion === quote.data.order.version
            ? 'Thiết bị này còn một đợt gọi món chưa lưu.'
            : 'Đơn đã thay đổi từ thiết bị khác. Nháp sẽ được giữ để bạn đối chiếu lại trước khi lưu.',
        okText: 'Tiếp tục nháp',
        cancelText: 'Bỏ nháp',
        onOk: () => {
          setDraftLines(saved.draftLines ?? []);
          setModifiedItemQuantities(saved.modifiedItemQuantities ?? {});
          setModifiedItemDetails(saved.modifiedItemDetails ?? {});
          draftBaseVersionRef.current = saved.baseVersion ?? quote.data!.order.version;
        },
        onCancel: () => localStorage.removeItem(`propos:order-draft:${orderId}`),
      });
    } catch {
      localStorage.removeItem(`propos:order-draft:${orderId}`);
    }
  }, [isNew, orderId, quote.data]);

  useEffect(() => {
    if (isNew || !orderId || !quote.data || restoredDraftOrderRef.current !== orderId) {
      return;
    }
    const hasItemDraft =
      draftLines.length > 0 ||
      Object.keys(modifiedItemQuantities).length > 0 ||
      Object.keys(modifiedItemDetails).length > 0;
    try {
      if (!hasItemDraft) {
        localStorage.removeItem(`propos:order-draft:${orderId}`);
        draftBaseVersionRef.current = null;
        return;
      }
      draftBaseVersionRef.current ??= quote.data.order.version;
      localStorage.setItem(
        `propos:order-draft:${orderId}`,
        JSON.stringify({
          baseVersion: draftBaseVersionRef.current,
          draftLines,
          modifiedItemQuantities,
          modifiedItemDetails,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // Local recovery is best-effort only.
    }
  }, [draftLines, isNew, modifiedItemDetails, modifiedItemQuantities, orderId, quote.data]);
  const paymentSnapshotV2Enabled = staffContext.data?.capabilities?.posPaymentSnapshotV2 !== false;

  const selectedTable = useMemo(
    () => tables.data?.find((item) => item.id === preselectedTableId),
    [tables.data, preselectedTableId],
  );

  useEffect(() => {
    const hasRunningTime = quote.data?.time?.status === 'RUNNING';
    if (!hasRunningTime) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now() + serverTimeOffsetMs), 1000);
    return () => window.clearInterval(timer);
  }, [quote.data?.time?.status, serverTimeOffsetMs]);

  useEffect(() => {
    if (!isNew && quote.data && searchParams.get('checkout') === '1' && !isDesktopPayment) {
      navigateToPayment(quote.data.order.id, true);
    }
  }, [isDesktopPayment, isNew, quote.data, searchParams, navigate]);

  useEffect(() => {
    if (!isNew && quote.data) {
      setOrderNote(quote.data.order.note ?? '');
      if (quote.data.order.guestCount !== undefined) {
        setGuestCount(quote.data.order.guestCount);
      }
      if (quote.data.order.customerName !== undefined) {
        setCustomerName(quote.data.order.customerName ?? '');
      }
      if (quote.data.order.customerPhone !== undefined) {
        setCustomerPhone(quote.data.order.customerPhone ?? '');
      }
      if (quote.data.order.customerId !== undefined)
        setCustomerId(quote.data.order.customerId ?? null);
    }
  }, [isNew, quote.data]);

  const saveGuestCount = async (count: number) => {
    setGuestCount(count);
    if (!isNew && orderId && quote.data) {
      try {
        const snapshot = await jsonRequest<OrderMutationSnapshot>(
          `/api/v1/pos/orders/${orderId}/guest`,
          {
            expectedOrderVersion: quote.data.order.version,
            guestCount: Math.max(1, count),
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerId,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        applyOrderMutationSnapshot(snapshot);
      } catch (err) {
        messageApi.error(errorText(err));
      }
    }
  };

  const saveCustomerInfo = async (customer: CustomerSummary | null) => {
    const name = customer?.name ?? '';
    const phone = customer?.phone ?? '';
    setCustomerId(customer?.id ?? null);
    setCustomerName(name);
    setCustomerPhone(phone);
    if (!isNew && orderId && quote.data) {
      try {
        const snapshot = await jsonRequest<OrderMutationSnapshot>(
          `/api/v1/pos/orders/${orderId}/guest`,
          {
            expectedOrderVersion: quote.data.order.version,
            guestCount: Math.max(1, guestCount),
            customerName: name.trim() || null,
            customerPhone: phone.trim() || null,
            customerId: customer?.id ?? null,
          },
          { method: 'PATCH', headers: mutationHeaders(csrf) },
        );
        applyOrderMutationSnapshot(snapshot);
        messageApi.success(customer ? 'Đã chọn khách hàng.' : 'Đã bỏ chọn khách hàng.');
      } catch (err) {
        messageApi.error(errorText(err));
      }
    }
  };

  const printProvisionalReceipt = async () => {
    if (!quote.data) return;
    const result = await printReceipt({
      data: buildPrintDataFromQuote(quote.data, 'PROVISIONAL'),
      printSettings: printSettings.data,
      storeInfo: {
        storeName: staffContext.data?.storeName ?? null,
        phone: staffContext.data?.storePhone ?? null,
        address: staffContext.data?.storeAddress ?? null,
        bankName: staffContext.data?.bankName ?? null,
        bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
        bankAccountName: staffContext.data?.bankAccountName ?? null,
      },
    });
    if (result.success) messageApi.success('Đã gửi lệnh in phiếu tạm tính!');
    else messageApi.error(result.message ?? 'Không thể in phiếu tạm tính.');
  };

  const categories = useMemo(() => {
    const map = new Map<string, { count: number; name: string }>();
    for (const product of catalog.data ?? []) {
      if (product.categoryId && product.categoryName) {
        const current = map.get(product.categoryId);
        map.set(product.categoryId, {
          count: (current?.count ?? 0) + 1,
          name: product.categoryName,
        });
      }
    }
    return [...map].map(([id, category]) => ({
      id,
      count: category.count,
      name: category.name,
      icon: categoryIcon(category.name),
    }));
  }, [catalog.data]);

  const visibleCatalog = (catalog.data ?? []).filter((product) => {
    const haystack = `${product.productName} ${product.variants.map((variant) => variant.name).join(' ')}`;
    const matchesSearch = haystack
      .toLocaleLowerCase('vi-VN')
      .includes(catalogSearch.trim().toLocaleLowerCase('vi-VN'));
    return matchesSearch && (selectedCategory === 'ALL' || product.categoryId === selectedCategory);
  });
  const isPaymentPending = !isNew && quote.data?.order.status === 'PAYMENT_PENDING';
  const desktopCheckoutOpen =
    !isNew && Boolean(orderId) && isDesktopPayment && searchParams.get('checkout') === '1';

  const addDraftVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    enteredPrice?: number,
  ) => {
    if (isPaymentPending) {
      messageApi.warning(
        'Đơn hàng đang chờ thanh toán (đã dừng giờ). Bấm "Tiếp tục chơi" để thêm món.',
      );
      return;
    }
    const effectiveVariant =
      variant.promptPrice === 1 ? { ...variant, salePriceVnd: enteredPrice ?? null } : variant;
    if (effectiveVariant.salePriceVnd === null) return;
    if (product.productType === 'WEIGHT') {
      const id = crypto.randomUUID();
      const line: DraftLine = {
        id,
        product,
        variant: effectiveVariant,
        quantityMilli: 1000,
        note: null,
        discountType: null,
        discountInputValue: null,
        discountReason: null,
      };
      setDraftLines((lines) => [...lines, line]);
      setEditingItem({
        source: 'DRAFT',
        id,
        productId: product.productId,
        variantId: effectiveVariant.id,
        productType: product.productType,
        productName: product.productName,
        variantName: effectiveVariant.name,
        unitName: product.unitName,
        unitPriceVnd: effectiveVariant.salePriceVnd,
        quantityMilli: 1000,
        note: '',
        grossLineTotalVnd: effectiveVariant.salePriceVnd,
        discountAmountVnd: 0,
        discountType: null,
        discountInputValue: null,
        discountReason: null,
        netLineTotalVnd: effectiveVariant.salePriceVnd,
        discardOnCancel: true,
      });
      return;
    }
    if (!isNew && quote.data?.items) {
      const existingSaved = quote.data.items.find(
        (it) =>
          it.productId === product.productId &&
          (it.variantId ?? null) === (effectiveVariant.id ?? null) &&
          !it.promotionGift,
      );
      if (existingSaved) {
        setModifiedItemDetails((current) => {
          const existing = current[existingSaved.id];
          if (!existing?.removalReason) return current;
          const { removalReason: _removalReason, ...rest } = existing;
          return { ...current, [existingSaved.id]: rest };
        });
        setModifiedItemQuantities((prev) => {
          const current = prev[existingSaved.id] ?? existingSaved.quantityMilli;
          return { ...prev, [existingSaved.id]: current + 1000 };
        });
        return;
      }
    }
    setDraftLines((lines) => {
      const found = lines.find(
        (line) =>
          line.variant.id === effectiveVariant.id &&
          line.variant.salePriceVnd === effectiveVariant.salePriceVnd,
      );
      if (found) {
        return lines.map((line) =>
          line === found ? { ...line, quantityMilli: line.quantityMilli + 1000 } : line,
        );
      }
      return [
        ...lines,
        {
          id: crypto.randomUUID(),
          product,
          variant: effectiveVariant,
          quantityMilli: 1000,
          note: null,
          discountType: null,
          discountInputValue: null,
          discountReason: null,
        },
      ];
    });
  };

  const effectiveVariantQuantityMilli = (productId: string, variantId: string) => {
    const savedQuantity = (quote.data?.items ?? [])
      .filter(
        (item) =>
          !item.promotionGift && item.productId === productId && item.variantId === variantId,
      )
      .reduce((sum, item) => sum + (modifiedItemQuantities[item.id] ?? item.quantityMilli), 0);
    const draftQuantity = draftLines
      .filter((line) => line.product.productId === productId && line.variant.id === variantId)
      .reduce((sum, line) => sum + line.quantityMilli, 0);
    return savedQuantity + draftQuantity;
  };

  const decrementVariant = (product: CatalogProduct, variant: CatalogVariant) => {
    const draft = draftLines.findLast(
      (line) => line.product.productId === product.productId && line.variant.id === variant.id,
    );
    if (draft) {
      setDraftLines((lines) =>
        lines.flatMap((line) => {
          if (line.id !== draft.id) return [line];
          return line.quantityMilli > 1000
            ? [{ ...line, quantityMilli: line.quantityMilli - 1000 }]
            : [];
        }),
      );
      return;
    }
    const saved = quote.data?.items.find(
      (item) =>
        !item.promotionGift &&
        item.productId === product.productId &&
        item.variantId === variant.id,
    );
    if (!saved) return;
    const current = modifiedItemQuantities[saved.id] ?? saved.quantityMilli;
    if (current <= 1000) {
      setDeleteItemTarget({ id: saved.id, name: saved.productName, source: 'SAVED' });
      setDeleteItemReason('');
      setDeleteItemModalOpen(true);
      return;
    }
    setModifiedItemQuantities((quantities) => ({
      ...quantities,
      [saved.id]: current - 1000,
    }));
  };

  const incrementVariantFromPicker = (
    product: CatalogProduct,
    variant: CatalogVariant,
    event?: React.MouseEvent,
  ) => {
    if (
      variant.promptPrice === 1 ||
      variant.salePriceVnd === null ||
      product.productType === 'WEIGHT'
    ) {
      chooseVariant(product, variant, event);
      return;
    }
    if (event) triggerFlyAnimation(event, product, variant.id);
    addDraftVariant(product, variant);
  };

  const refreshOrder = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pos-order-quote', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
    ]);
  };

  const refreshCachesAfterCancel = async (cancelledOrderId: string) => {
    // Cancel responses only acknowledge the order id. Fetch one authoritative
    // overview before navigation so tables and active-order lists cannot remain
    // stale when the own realtime event is intentionally ignored.
    const overview = await queryClient.fetchQuery<PosOverviewSnapshot>({
      queryKey: ['pos-overview'],
      queryFn: ({ signal }) => apiRequest<PosOverviewSnapshot>('/api/v1/pos/overview', { signal }),
      staleTime: 0,
    });
    queryClient.setQueryData(['pos-tables'], overview.tables);
    queryClient.setQueryData(['pos-orders-list'], overview.orders);
    queryClient.removeQueries({ queryKey: ['pos-order-quote', cancelledOrderId] });
    queryClient.removeQueries({ queryKey: ['pos-order-detail', cancelledOrderId] });
    queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', cancelledOrderId] });
  };

  const chooseProduct = (product: CatalogProduct, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    if (product.variants.length > 1) {
      setVariantProduct(product);
      return;
    }
    const variant = product.variants[0];
    if (!variant) return;
    if (event) {
      triggerFlyAnimation(event, product, variant.id);
    }
    chooseVariant(product, variant);
  };

  const triggerFlyAnimation = (
    e: React.MouseEvent | HTMLElement,
    product: CatalogProduct,
    variantId?: string,
  ) => {
    // Only animate on desktop & tablet (skip on small mobile screens as requested)
    if (typeof window === 'undefined' || window.innerWidth < 640) return;

    const target = ('currentTarget' in e ? e.currentTarget : e) as HTMLElement;
    if (!target || typeof target.getBoundingClientRect !== 'function') return;

    const startRect = target.getBoundingClientRect();
    if (startRect.width === 0 || startRect.height === 0) return;

    const targetKey = variantId || product.variants[0]?.id || product.productId;
    const existingRow = targetKey
      ? (document.querySelector(
        `.staff-cart-panel [data-variant-id="${targetKey}"]`,
      ) as HTMLElement | null)
      : null;
    const cartList = document.querySelector('.staff-compact-order-list') as HTMLElement | null;
    const cartPanel = document.querySelector('.staff-cart-panel') as HTMLElement | null;
    const destEl = existingRow || cartList || cartPanel;

    if (!destEl) return;
    const destRect = destEl.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - 22;
    const startY = startRect.top + startRect.height / 2 - 22;

    const endX = existingRow
      ? destRect.left + 24
      : destRect.left + Math.min(destRect.width / 2, 80) - 22;
    const endY = existingRow
      ? destRect.top + destRect.height / 2 - 22
      : destRect.top + Math.min(destRect.height / 2, 60);

    const flyer = document.createElement('div');
    flyer.className = 'staff-flying-item';

    if (product.avatarType === 'IMAGE' && product.mediaId) {
      const img = document.createElement('img');
      img.src = `/api/v1/media/${product.mediaId}`;
      img.alt = product.productName;
      flyer.appendChild(img);
    } else {
      flyer.style.backgroundColor = product.avatarColor || '#0975f7';
      flyer.textContent = getProductInitials(product.productName);
    }

    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyer.style.setProperty('--end-x', `${endX}px`);
    flyer.style.setProperty('--end-y', `${endY}px`);

    document.body.appendChild(flyer);

    // Card click pop animation
    target.classList.add('staff-product-card--clicked');
    setTimeout(() => target.classList.remove('staff-product-card--clicked'), 320);

    requestAnimationFrame(() => {
      flyer.classList.add('is-flying');
    });

    setTimeout(() => {
      flyer.remove();
      // Item row response in cart
      setRecentlyAddedLineKey(targetKey);
      setTimeout(() => {
        setRecentlyAddedLineKey((curr) => (curr === targetKey ? null : curr));
      }, 700);
    }, 440);
  };

  const chooseVariant = (
    product: CatalogProduct,
    variant: CatalogVariant,
    event?: React.MouseEvent,
  ) => {
    if (event) {
      triggerFlyAnimation(event, product, variant.id);
    }
    setVariantProduct(null);
    if (variant.promptPrice === 1 || variant.salePriceVnd === null) {
      setPromptTarget({ product, variant });
    } else {
      addDraftVariant(product, variant);
    }
  };

  const commandsV2Enabled = staffContext.data?.capabilities?.posCommandsV2 !== false;

  const persistLinesV1 = async (targetOrderId: string, startingVersion: number) => {
    let version = startingVersion;
    for (const line of draftLines) {
      // V1 advances the aggregate version after every item and must stay sequential.
      // eslint-disable-next-line no-await-in-loop
      await jsonRequest(
        `/api/v1/pos/orders/${targetOrderId}/items`,
        {
          productId: line.product.productId,
          variantId: line.variant.id,
          enteredUnitPriceVnd:
            line.variant.promptPrice === 1 ? line.variant.salePriceVnd : undefined,
          quantityMilli: line.quantityMilli,
          expectedOrderVersion: version,
          note: line.note,
          discount:
            line.discountType && line.discountInputValue !== null
              ? {
                type: line.discountType,
                value: line.discountInputValue,
                reason: line.discountReason ?? '',
              }
              : null,
        },
        { headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    return version;
  };

  const persistModifiedItemsV1 = async (targetOrderId: string, startingVersion: number) => {
    let version = startingVersion;
    for (const update of updatedItemsPayload()) {
      const item = quote.data?.items.find((candidate) => candidate.id === update.itemId);
      if (!item) continue;
      if (update.quantityMilli === 0) {
        // V1 advances the aggregate version after every item and must stay sequential.
        // eslint-disable-next-line no-await-in-loop
        await jsonRequest(
          `/api/v1/pos/orders/${targetOrderId}/items/${update.itemId}`,
          {
            expectedOrderVersion: version,
            reason: update.removalReason ?? 'Khách đổi ý',
          },
          { method: 'DELETE', headers: mutationHeaders(csrf) },
        );
        version += 1;
        continue;
      }
      // V1 advances the aggregate version after every item and must stay sequential.
      // eslint-disable-next-line no-await-in-loop
      await jsonRequest(
        `/api/v1/pos/orders/${targetOrderId}/items/${update.itemId}`,
        {
          expectedOrderVersion: version,
          quantityMilli: update.quantityMilli,
          variantId: update.variantId === undefined ? item.variantId : update.variantId,
          discount:
            update.discount === undefined
              ? item.discountType && typeof item.discountInputValue === 'number'
                ? {
                  type: item.discountType,
                  value: item.discountInputValue,
                  reason: item.discountReason || '',
                }
                : undefined
              : update.discount,
          note: update.note === undefined ? (item.note ?? null) : update.note,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    return version;
  };

  const persistExistingOrderV1 = async (startingVersion: number) => {
    if (!quote.data) throw new Error('Không tìm thấy đơn hàng.');
    let version = await persistModifiedItemsV1(quote.data.order.id, startingVersion);
    if (draftLines.length > 0) version = await persistLinesV1(quote.data.order.id, version);
    if (orderNote !== (quote.data.order.note ?? '')) {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/note`,
        { expectedOrderVersion: version, note: orderNote.trim() || null },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    if (manualPromotionIds !== null) {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/promotion`,
        { promotionIds: manualPromotionIds, expectedOrderVersion: version },
        { method: 'PUT', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    clearOrderDraft();
    setManualPromotionIds(null);
    return version;
  };

  const completeCreatedOrderV1 = async (createdOrderId: string, checkoutAfterSave: boolean) => {
    void queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-orders-list'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
    if (checkoutAfterSave) {
      navigateToPayment(createdOrderId, true);
    } else {
      messageApi.success('Lưu đơn hàng thành công.');
      if (orderType === 'TAKEAWAY') {
        navigate('/pos/areas?tab=takeaway', {
          replace: true,
          state: { selectedArea: '__TAKEAWAY__' },
        });
      } else {
        navigate('/pos/areas', { replace: true });
      }
    }
  };

  const saveWithTableV1 = async (table: PosTable, checkoutAfterSave: boolean) => {
    const opened = await jsonRequest<{ orderId: string }>(
      '/api/v1/pos/tables/open',
      { tableId: table.id, expectedTableVersion: table.version },
      { headers: mutationHeaders(csrf) },
    );
    let version = await persistLinesV1(opened.orderId, 1);
    if (orderNote.trim()) {
      await jsonRequest(
        `/api/v1/pos/orders/${opened.orderId}/note`,
        { expectedOrderVersion: version, note: orderNote.trim() },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    if (guestCount > 1 || customerName.trim() || customerPhone.trim() || customerId) {
      await jsonRequest(
        `/api/v1/pos/orders/${opened.orderId}/guest`,
        {
          expectedOrderVersion: version,
          guestCount: Math.max(1, guestCount),
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerId,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    if (manualPromotionIds !== null) {
      await jsonRequest(
        `/api/v1/pos/orders/${opened.orderId}/promotion`,
        { promotionIds: manualPromotionIds, expectedOrderVersion: version },
        { method: 'PUT', headers: mutationHeaders(csrf) },
      );
    }
    setManualPromotionIds(null);
    await completeCreatedOrderV1(opened.orderId, checkoutAfterSave);
  };

  const createTakeawayOrderV1 = async () => {
    const created = await jsonRequest<{ orderId: string }>(
      '/api/v1/pos/orders',
      { note: orderNote.trim() || null },
      { headers: mutationHeaders(csrf) },
    );
    let version = await persistLinesV1(created.orderId, 1);
    if (guestCount > 1 || customerName.trim() || customerPhone.trim() || customerId) {
      await jsonRequest(
        `/api/v1/pos/orders/${created.orderId}/guest`,
        {
          expectedOrderVersion: version,
          guestCount: Math.max(1, guestCount),
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerId,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      version += 1;
    }
    if (manualPromotionIds !== null) {
      await jsonRequest(
        `/api/v1/pos/orders/${created.orderId}/promotion`,
        { promotionIds: manualPromotionIds, expectedOrderVersion: version },
        { method: 'PUT', headers: mutationHeaders(csrf) },
      );
    }
    setManualPromotionIds(null);
    return created.orderId;
  };

  const completeCreatedOrder = (snapshot: OrderMutationSnapshot, checkoutAfterSave: boolean) => {
    applyOrderMutationSnapshot(snapshot);
    clearOrderDraft();
    setManualPromotionIds(null);
    if (checkoutAfterSave) {
      navigateToPayment(snapshot.order.id, true);
    } else {
      messageApi.success(
        snapshot.callBatch
          ? `Đã lưu Đợt ${snapshot.callBatch.sequenceNo}.`
          : 'Lưu đơn hàng thành công.',
      );
      if (snapshot.order.orderType === 'TAKEAWAY' || orderType === 'TAKEAWAY') {
        navigate('/pos/areas?tab=takeaway', {
          replace: true,
          state: { selectedArea: '__TAKEAWAY__' },
        });
      } else {
        navigate('/pos/areas', { replace: true });
      }
    }
  };

  const saveWithTable = async (table: PosTable, checkoutAfterSave = false) => {
    setSaving(true);
    try {
      if (!commandsV2Enabled) {
        await saveWithTableV1(table, checkoutAfterSave);
        return;
      }
      const snapshot = await jsonRequest<OrderMutationSnapshot>(
        '/api/v1/pos/orders/open',
        {
          orderType: 'DINE_IN',
          tableId: table.id,
          expectedTableVersion: table.version,
          items: draftItemsPayload(),
          note: orderNote.trim() || null,
          guest: {
            guestCount: Math.max(1, guestCount),
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerId,
          },
          ...(manualPromotionIds === null ? {} : { promotionIds: manualPromotionIds }),
        },
        { headers: mutationHeaders(csrf) },
      );
      completeCreatedOrder(snapshot, checkoutAfterSave);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
      setTableModalOpen(false);
    }
  };

  const saveOrder = async () => {
    if (isNew && orderType === 'TAKEAWAY' && draftLines.length === 0) {
      messageApi.warning('Vui lòng chọn ít nhất một mặt hàng cho đơn mang về.');
      return;
    }
    if (orderType === 'DINE_IN') {
      const table = selectedTable ?? tables.data?.find((item) => item.id === preselectedTableId);
      if (table?.status === 'AVAILABLE') return saveWithTable(table, false);
      setTableAction('SAVE');
      setTableModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      if (!commandsV2Enabled) {
        const createdOrderId = await createTakeawayOrderV1();
        await completeCreatedOrderV1(createdOrderId, false);
        return;
      }
      const created = await createTakeawayOrderFromDraft();
      completeCreatedOrder(created, false);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const createTakeawayOrderFromDraft = async () => {
    return jsonRequest<OrderMutationSnapshot>(
      '/api/v1/pos/orders/open',
      {
        orderType: 'TAKEAWAY',
        items: draftItemsPayload(),
        note: orderNote.trim() || null,
        guest: {
          guestCount: Math.max(1, guestCount),
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerId,
        },
        ...(manualPromotionIds === null ? {} : { promotionIds: manualPromotionIds }),
      },
      { headers: mutationHeaders(csrf) },
    );
  };

  const saveAdditionalItems = async (openPaymentAfterSave = false, confirmedConflicts = false) => {
    if (!quote.data) return;
    if (conflictingSavedItemIds.size > 0 && !confirmedConflicts) {
      Modal.confirm({
        title: 'Xác nhận lưu sau khi đối chiếu',
        content:
          'Một số món đã được thiết bị khác cập nhật. Hệ thống đã giữ phần tăng/giảm của nháp hiện tại trên tổng mới nhất.',
        okText: 'Đã đối chiếu, tiếp tục lưu',
        cancelText: 'Kiểm tra lại',
        onOk: () => void saveAdditionalItems(openPaymentAfterSave, true),
      });
      return;
    }
    const hasSavedItemChanges = hasPendingSavedItemChanges();
    if (draftLines.length === 0 && !hasSavedItemChanges && manualPromotionIds === null) {
      if (openPaymentAfterSave) {
        navigateToPayment(quote.data.order.id);
      } else {
        messageApi.success('Lưu đơn hàng thành công.');
        if (orderType === 'TAKEAWAY' || quote.data.order.orderType === 'TAKEAWAY') {
          navigate('/pos/areas?tab=takeaway', {
            replace: true,
            state: { selectedArea: '__TAKEAWAY__' },
          });
        } else {
          navigate('/pos/areas', { replace: true });
        }
      }
      return;
    }
    setSaving(true);
    try {
      if (!commandsV2Enabled) {
        await persistExistingOrderV1(quote.data.order.version);
        await refreshOrder();
        void queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
        void queryClient.invalidateQueries({ queryKey: ['pos-orders-list'] });
        void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
        messageApi.success('Lưu đơn hàng thành công.');
        if (openPaymentAfterSave) {
          navigateToPayment(quote.data.order.id);
        } else if (orderType === 'TAKEAWAY' || quote.data.order.orderType === 'TAKEAWAY') {
          navigate('/pos/areas?tab=takeaway', {
            replace: true,
            state: { selectedArea: '__TAKEAWAY__' },
          });
        } else {
          navigate('/pos/areas', { replace: true });
        }
        return;
      }
      const snapshot = await jsonRequest<OrderMutationSnapshot>(
        `/api/v1/pos/orders/${quote.data.order.id}/save`,
        {
          expectedOrderVersion: quote.data.order.version,
          addedItems: draftItemsPayload(),
          updatedItems: updatedItemsPayload(),
          ...(orderNote !== (quote.data.order.note ?? '')
            ? { note: orderNote.trim() || null }
            : {}),
          ...(manualPromotionIds === null ? {} : { promotionIds: manualPromotionIds }),
        },
        { headers: mutationHeaders(csrf) },
      );
      applyOrderMutationSnapshot(snapshot);
      clearOrderDraft();
      setManualPromotionIds(null);
      messageApi.success(
        snapshot.callBatch
          ? `Đã lưu Đợt ${snapshot.callBatch.sequenceNo}.`
          : 'Lưu đơn hàng thành công.',
      );
      if (openPaymentAfterSave) {
        navigateToPayment(snapshot.order.id);
      } else if (snapshot.order.orderType === 'TAKEAWAY' || orderType === 'TAKEAWAY') {
        navigate('/pos/areas?tab=takeaway', {
          replace: true,
          state: { selectedArea: '__TAKEAWAY__' },
        });
      } else {
        navigate('/pos/areas', { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ORDER_VERSION_CONFLICT') {
        const latestQuote = (error.details as { quote?: OrderQuote } | null)?.quote;
        if (latestQuote) {
          queryClient.setQueryData(['pos-order-quote', quote.data.order.id], latestQuote);
        } else {
          await quote.refetch();
        }
        messageApi.warning(
          `${errorText(error)} Nháp đã được giữ để bạn đối chiếu trước khi lưu lại.`,
        );
      } else {
        messageApi.error(errorText(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const openPromotionPicker = () => {
    if (saving || promotionSaving) return;
    setPromotionModalOpen(true);
  };

  const handleResumeCheckout = async (automatic = false) => {
    if (!quote.data || resuming) return false;
    const frozenQuote = quote.data;
    setResuming(true);
    try {
      const sendResume = (expectedOrderVersion: number) =>
        jsonRequest<{
          orderId: string;
          status: 'OPEN';
          resumedAt: number;
          quote: OrderQuote;
        }>(
          `/api/v1/pos/orders/${frozenQuote.order.id}/resume-checkout`,
          { expectedOrderVersion },
          { headers: mutationHeaders(csrf) },
        );

      let result;
      try {
        result = await sendResume(frozenQuote.order.version);
      } catch (error) {
        const refreshed = await apiRequest<OrderQuote>(
          `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
        );
        if (!refreshed.time || refreshed.order.status === 'OPEN') {
          queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], refreshed);
          queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', frozenQuote.order.id] });
          clearPaymentPageActive(frozenQuote.order.id);
          await queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
          await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
          if (!automatic) {
            if (refreshed.time?.status === 'RUNNING') {
              messageApi.success(`Đã tiếp tục tính giờ cho ${frozenQuote.order.tableName}.`);
            } else {
              messageApi.info('Đã quay lại đơn. Thời gian vẫn đang dừng.');
            }
          }
          setResumeModalOpen(false);
          return refreshed.order.status === 'OPEN';
        }
        if (
          refreshed.order.status !== 'PAYMENT_PENDING' ||
          refreshed.order.version === frozenQuote.order.version
        ) {
          throw error;
        }
        result = await sendResume(refreshed.order.version);
      }
      queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], result.quote);
      queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', frozenQuote.order.id] });
      const verifiedQuote = await apiRequest<OrderQuote>(
        `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
      );
      queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], verifiedQuote);
      clearPaymentPageActive(frozenQuote.order.id);
      await queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
      if (!automatic) {
        if (verifiedQuote.time?.status === 'RUNNING') {
          messageApi.success(`Đã tiếp tục tính giờ cho ${frozenQuote.order.tableName}.`);
        } else {
          messageApi.info('Đã quay lại đơn. Thời gian vẫn đang dừng.');
        }
      }
      setResumeModalOpen(false);
      return verifiedQuote.order.status === 'OPEN';
    } catch (error) {
      if (!automatic) messageApi.error(errorText(error));
      return false;
    } finally {
      setResuming(false);
    }
  };

  useEffect(() => {
    const currentQuote = quote.data;
    if (
      suppressPaymentAutoResume ||
      desktopCheckoutOpen ||
      !quoteReady ||
      !currentQuote?.time ||
      currentQuote.order.status !== 'PAYMENT_PENDING' ||
      !isReturningFromPayment(currentQuote.order.id, currentQuote.order.version) ||
      autoResumePaymentInFlightRef.current
    ) {
      return;
    }
    let retryTimer: number | null = null;
    autoResumePaymentInFlightRef.current = true;
    void handleResumeCheckout(true)
      .then((resumed) => {
        if (!resumed) {
          retryTimer = window.setTimeout(
            () => setAutoResumeRetryToken((token) => token + 1),
            1_000,
          );
        }
      })
      .finally(() => {
        autoResumePaymentInFlightRef.current = false;
      });
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [
    autoResumeRetryToken,
    desktopCheckoutOpen,
    quote.data,
    quoteReady,
    suppressPaymentAutoResume,
  ]);

  const handleOpenTableQrModal = async () => {
    const tableId = quote.data?.order.tableId ?? selectedTable?.id ?? preselectedTableId;
    const tableName = quote.data?.order.tableName ?? selectedTable?.name ?? 'Bàn';
    if (!tableId) {
      messageApi.warning('Vui lòng chọn bàn/phòng để lấy mã QR Order.');
      return;
    }
    setTableQrLoading(true);
    try {
      const result = await apiRequest<{ path: string; version: number; enabled: boolean }>(
        `/api/v1/pos/tables/${tableId}/qr-code`,
      );
      const url = new URL(result.path, window.location.origin).toString();
      const { default: QRCode } = await import('qrcode');
      const qrImage = await QRCode.toDataURL(url, {
        width: 640,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      setTableQrData({
        tableName,
        url,
        image: qrImage,
        ...(quote.data?.order.displayCode || (orderId && orderId !== 'new')
          ? {
            orderCode: quote.data?.order.displayCode || `D-${orderId!.slice(0, 8).toUpperCase()}`,
          }
          : {}),
      });
      setTableQrModalOpen(true);
    } catch (error) {
      messageApi.error(errorText(error) || 'Không thể lấy mã QR Order của bàn.');
    } finally {
      setTableQrLoading(false);
    }
  };

  const beginCheckout = async () => {
    if (isNew && orderType === 'TAKEAWAY' && draftLines.length === 0) {
      messageApi.warning('Vui lòng chọn ít nhất một mặt hàng cho đơn Mang về.');
      return;
    }
    if (!isNew) {
      const hasPendingChanges =
        draftLines.length > 0 || hasPendingSavedItemChanges() || manualPromotionIds !== null;
      if (isPaymentPending) {
        navigateToPayment(quote.data!.order.id);
        return;
      }
      if (quote.data?.time) {
        setStoppingTime(true);
        try {
          let currentQuote = quote.data;
          if (hasPendingChanges) {
            if (commandsV2Enabled) {
              const saved = await jsonRequest<OrderMutationSnapshot>(
                `/api/v1/pos/orders/${quote.data.order.id}/save`,
                {
                  expectedOrderVersion: quote.data.order.version,
                  nextAction: 'BEGIN_CHECKOUT',
                  addedItems: draftItemsPayload(),
                  updatedItems: updatedItemsPayload(),
                  ...(manualPromotionIds === null ? {} : { promotionIds: manualPromotionIds }),
                },
                { headers: mutationHeaders(csrf) },
              );
              applyOrderMutationSnapshot(saved);
              currentQuote = saved.quote;
              clearOrderDraft();
              setManualPromotionIds(null);
              if (saved.paymentSnapshot) {
                queryClient.setQueryData(
                  ['pos-payment-snapshot', saved.order.id],
                  saved.paymentSnapshot,
                );
                navigateToPayment(saved.order.id);
                return;
              }
            } else {
              await persistExistingOrderV1(quote.data.order.version);
              currentQuote = await apiRequest<OrderQuote>(
                `/api/v1/pos/orders/${quote.data.order.id}/quote`,
              );
              queryClient.setQueryData(['pos-order-quote', quote.data.order.id], currentQuote);
            }
          }
          const result = await jsonRequest<PaymentSnapshotResult>(
            `/api/v1/pos/orders/${currentQuote.order.id}/stop-time`,
            { expectedOrderVersion: currentQuote.order.version },
            { headers: mutationHeaders(csrf) },
          );
          const pendingQuote: OrderQuote = {
            ...result.quote,
            order: {
              ...result.quote.order,
              status: 'PAYMENT_PENDING',
            },
          };
          queryClient.setQueryData<OrderQuote>(
            ['pos-order-quote', quote.data.order.id],
            (cached) =>
              !cached || pendingQuote.order.version >= cached.order.version ? pendingQuote : cached,
          );
          if (paymentSnapshotV2Enabled) {
            queryClient.setQueryData(['pos-payment-snapshot', currentQuote.order.id], result);
          }
          navigateToPayment(currentQuote.order.id);
        } catch (error) {
          messageApi.error(errorText(error));
        } finally {
          setStoppingTime(false);
        }
        return;
      }
      await saveAdditionalItems(true);
      return;
    }
    if (orderType === 'DINE_IN') {
      const table = selectedTable ?? tables.data?.find((item) => item.id === preselectedTableId);
      if (table?.status === 'AVAILABLE') {
        await saveWithTable(table, true);
        return;
      }
      setTableAction('CHECKOUT');
      setTableModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      const created = await createTakeawayOrderFromDraft();
      completeCreatedOrder(created, true);
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const updateExistingItem = (input: {
    id: string;
    quantityMilli: number;
    variantId?: string | null | undefined;
    discount?: null | { type: 'FIXED' | 'PERCENT'; value: number; reason: string } | undefined;
    note: string | null;
  }) => {
    setModifiedItemQuantities((current) => ({
      ...current,
      [input.id]: input.quantityMilli,
    }));
    setModifiedItemDetails((current) => ({
      ...current,
      [input.id]: {
        variantId: input.variantId ?? null,
        note: input.note,
        discount: input.discount ?? null,
      },
    }));
    setEditingItem(null);
  };

  const handleDeleteItemConfirm = () => {
    if (!deleteItemTarget || !deleteItemReason.trim()) return;
    const targetId = deleteItemTarget.id;
    const isDraftItem =
      deleteItemTarget.source === 'DRAFT' ||
      isNew ||
      draftLines.some((line) => line.id === targetId);

    if (isDraftItem) {
      setDraftLines((lines) => lines.filter((line) => line.id !== targetId));
      messageApi.success('Đã bỏ món khỏi phần đang thay đổi.');
    } else {
      setModifiedItemQuantities((current) => ({ ...current, [targetId]: 0 }));
      setModifiedItemDetails((current) => ({
        ...current,
        [targetId]: {
          ...current[targetId],
          removalReason: deleteItemReason.trim(),
        },
      }));
      messageApi.success('Đã đưa thao tác xóa vào phần đang thay đổi.');
    }
    setDeleteItemModalOpen(false);
    setDeleteItemTarget(null);
    setDeleteItemReason('');
  };

  const handleDeleteTimeConfirm = async () => {
    if (!deleteTimeReason.trim()) return;
    if (isNew || !quote.data) {
      setDeleteTimeModalOpen(false);
      setDeleteTimeReason('');
      setTimeDetailOpen(false);
      setTimeRemoved(true);
      return;
    }
    try {
      setDeletingTime(true);
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/time`,
        { expectedOrderVersion: quote.data.order.version, reason: deleteTimeReason.trim() },
        { method: 'DELETE', headers: mutationHeaders(csrf) },
      );
      setDeleteTimeModalOpen(false);
      setDeleteTimeReason('');
      setTimeDetailOpen(false);
      setTimeRestoringDraft(false);
      messageApi.success('Đã xóa tiền giờ mặc định của bàn.');
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setDeletingTime(false);
    }
  };

  const saveOrderNote = async () => {
    if (isNew || !quote.data) {
      setOrderNoteOpen(false);
      return;
    }
    try {
      const snapshot = await jsonRequest<OrderMutationSnapshot>(
        `/api/v1/pos/orders/${quote.data.order.id}/note`,
        { expectedOrderVersion: quote.data.order.version, note: orderNote.trim() || null },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      applyOrderMutationSnapshot(snapshot);
      setOrderNoteOpen(false);
    } catch (error) {
      messageApi.error(errorText(error));
    }
  };

  const handlePauseTimeRealtime = async () => {
    if (!quote.data?.order.id || !quote.data?.time) return;
    const currentOrderId = quote.data.order.id;
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${currentOrderId}/time/pause`,
        { expectedOrderVersion: quote.data.order.version },
        { headers: mutationHeaders(csrf) },
      );
      messageApi.success('Đã tạm dừng tính giờ bàn.');
      setTimeDetailOpen(false);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const handleResumeTimeRealtime = async () => {
    if (!quote.data?.order.id || !quote.data?.time) return;
    const currentOrderId = quote.data.order.id;
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${currentOrderId}/time/resume`,
        { expectedOrderVersion: quote.data.order.version },
        { headers: mutationHeaders(csrf) },
      );
      messageApi.success('Đã mở lại bàn / tiếp tục tính giờ.');
      setTimeDetailOpen(false);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const handleContinueRunningTime = async () => {
    if (!quote.data?.order.id || !quote.data?.time) return;
    const currentOrderId = quote.data.order.id;
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${currentOrderId}/time/range`,
        {
          expectedOrderVersion: quote.data.order.version,
          startedAtMs: quote.data.time.startedAtMs,
          endedAtMs: null,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      messageApi.success('Đã tiếp tục tính giờ bàn.');
      setTimeDetailOpen(false);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const openTimeDetails = () => {
    if (quote.data?.time) {
      const endedAtDefault = quote.data.time.endedAtMs
        ? dayjs(quote.data.time.endedAtMs)
        : quote.data.time.status === 'PAUSED' && quote.data.time.pausedAtMs
          ? dayjs(quote.data.time.pausedAtMs)
          : null;
      setTimeRangeDraft({
        startedAt: dayjs(quote.data.time.startedAtMs),
        endedAt: endedAtDefault,
      });
      setTimeDetailOpen(true);
    } else if (timeRestoringDraft) {
      setTimeRangeDraft({
        startedAt: dayjs(),
        endedAt: null,
      });
      setTimeDetailOpen(true);
    }
  };

  const saveTimeRange = async () => {
    if (!quote.data) return;
    const currentOrderId = quote.data.order.id;
    if (!timeRangeDraft.startedAt || !timeRangeDraft.startedAt.isValid()) {
      messageApi.warning('Vui lòng chọn giờ vào.');
      return;
    }
    const startedAtMs = timeRangeDraft.startedAt.valueOf();
    const rawEndedAtMs =
      timeRangeDraft.endedAt && timeRangeDraft.endedAt.isValid()
        ? timeRangeDraft.endedAt.valueOf()
        : null;
    if (
      !Number.isFinite(startedAtMs) ||
      (rawEndedAtMs !== null && (!Number.isFinite(rawEndedAtMs) || rawEndedAtMs <= startedAtMs))
    ) {
      messageApi.warning('Giờ ra phải sau giờ vào.');
      return;
    }
    // Clamp giờ ra về tối đa là now để tránh clock skew client/server
    const now = Date.now();
    const endedAtMs = rawEndedAtMs !== null ? Math.min(rawEndedAtMs, now) : null;
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${currentOrderId}/time/range`,
        {
          expectedOrderVersion: quote.data.order.version,
          startedAtMs,
          endedAtMs,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      await refreshOrder();
      setTimeDetailOpen(false);
      setTimeRestoringDraft(false);
      messageApi.success('Đã lưu thông tin tính giờ thành công.');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const transferTo = async (table: PosTable) => {
    if (!quote.data?.order.tableId) return;
    const source = tables.data?.find((item) => item.id === quote.data!.order.tableId);
    if (!source) return;
    try {
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/transfer`,
        {
          targetTableId: table.id,
          expectedOrderVersion: quote.data.order.version,
          expectedSourceTableVersion: source.version,
          expectedTargetTableVersion: table.version,
        },
        { headers: mutationHeaders(csrf) },
      );
      setTransferOpen(false);
      messageApi.success(`Đã chuyển ${source.name} → ${table.name}`);
      await refreshOrder();
    } catch (error) {
      messageApi.error(errorText(error));
      throw error;
    }
  };

  const cancelOrder = async () => {
    if (cancellingOrder || !quote.data || !cancelReason.trim()) return;
    try {
      setCancellingOrder(true);
      await jsonRequest(
        `/api/v1/pos/orders/${quote.data.order.id}/cancel`,
        { expectedOrderVersion: quote.data.order.version, reason: cancelReason.trim() },
        { headers: mutationHeaders(csrf) },
      );
      setCancelOpen(false);
      setCancelReason('');
      messageApi.success('Đã hủy đơn hàng thành công.');
      await refreshCachesAfterCancel(quote.data.order.id);
      if (orderType === 'TAKEAWAY' || quote.data.order.orderType === 'TAKEAWAY') {
        navigate('/pos/areas?tab=takeaway', {
          replace: true,
          state: { selectedArea: '__TAKEAWAY__' },
        });
      } else {
        navigate('/pos/areas', { replace: true });
      }
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setCancellingOrder(false);
    }
  };

  const draftDisplayItems = draftLines.map((line) => {
    const quantityMilli = line.quantityMilli;
    const unitPriceVnd = line.variant.salePriceVnd ?? 0;
    const gross = calculateLineTotal(unitPriceVnd, quantityMilli);
    const discount = calculateDiscountAmount(gross, line.discountType, line.discountInputValue);
    const net = gross - discount;
    return {
      id: line.id,
      productId: line.product.productId,
      variantId: line.variant.id,
      productType: line.product.productType,
      productName: line.product.productName,
      variantName: line.variant.name,
      unitName: line.product.unitName,
      unitPriceVnd,
      quantityMilli,
      grossLineTotalVnd: gross,
      discountAmountVnd: discount,
      discountType: line.discountType,
      discountInputValue: line.discountInputValue,
      discountReason: line.discountReason,
      netLineTotalVnd: net,
      note: line.note,
      promotionGift: undefined,
    };
  });
  const projectedSavedItems = useMemo(
    () =>
      (quote.data?.items ?? [])
        .filter((item) => !item.promotionGift)
        .map((item) => {
          const details = modifiedItemDetails[item.id];
          const variant = details?.variantId
            ? catalog.data
              ?.find((product) => product.productId === item.productId)
              ?.variants.find((candidate) => candidate.id === details.variantId)
            : undefined;
          const quantityMilli = modifiedItemQuantities[item.id] ?? item.quantityMilli;
          const unitPriceVnd =
            details?.enteredUnitPriceVnd ?? variant?.salePriceVnd ?? item.unitPriceVnd;
          const discountType =
            details?.discount === undefined ? item.discountType : (details.discount?.type ?? null);
          const discountInputValue =
            details?.discount === undefined
              ? item.discountInputValue
              : (details.discount?.value ?? null);
          const discountReason =
            details?.discount === undefined
              ? item.discountReason
              : (details.discount?.reason ?? null);
          const grossLineTotalVnd = calculateLineTotal(unitPriceVnd, quantityMilli);
          const discountAmountVnd = calculateDiscountAmount(
            grossLineTotalVnd,
            discountType,
            discountInputValue,
          );
          return Object.assign({}, item, {
            variantId: details?.variantId === undefined ? item.variantId : details.variantId,
            variantName: variant?.name ?? item.variantName,
            unitPriceVnd,
            quantityMilli,
            note: details?.note === undefined ? item.note : details.note,
            discountType,
            discountInputValue,
            discountReason,
            grossLineTotalVnd,
            discountAmountVnd,
            netLineTotalVnd: grossLineTotalVnd - discountAmountVnd,
          });
        }),
    [catalog.data, modifiedItemDetails, modifiedItemQuantities, quote.data?.items],
  );
  // Realtime promotion items combining saved items and draft items
  const combinedItemsForPromotion = useMemo(() => {
    const list: Array<{
      productId: string;
      variantId: string | null;
      productType: 'QUANTITY' | 'WEIGHT' | 'TIME' | 'SERVICE';
      productName: string;
      variantName: string | null;
      unitPriceVnd: number;
      quantityMilli: number;
      grossLineTotalVnd: number;
      netLineTotalVnd: number;
    }> = [];

    if (!isNew) {
      for (const item of projectedSavedItems) {
        if (item.quantityMilli === 0) continue;
        list.push({
          productId: item.productId,
          variantId: item.variantId ?? null,
          productType: item.productType,
          productName: item.productName,
          variantName: item.variantName ?? null,
          unitPriceVnd: item.unitPriceVnd,
          quantityMilli: item.quantityMilli,
          grossLineTotalVnd: item.grossLineTotalVnd,
          netLineTotalVnd: item.netLineTotalVnd,
        });
      }
    }

    for (const draft of draftDisplayItems) {
      list.push({
        productId: draft.productId,
        variantId: draft.variantId ?? null,
        productType: draft.productType,
        productName: draft.productName,
        variantName: draft.variantName ?? null,
        unitPriceVnd: draft.unitPriceVnd,
        quantityMilli: draft.quantityMilli,
        grossLineTotalVnd: draft.grossLineTotalVnd,
        netLineTotalVnd: draft.netLineTotalVnd,
      });
    }

    return list;
  }, [draftDisplayItems, isNew, projectedSavedItems]);

  // 2. Tiền giờ (phiên tính giờ của bàn)
  const totalTimeGross = quote.data?.time ? quote.data.time.amountAfterRoundingVnd : 0;

  const combinedProductGross = useMemo(() => {
    return combinedItemsForPromotion.reduce((sum, item) => sum + item.grossLineTotalVnd, 0);
  }, [combinedItemsForPromotion]);

  const combinedItemManualDiscountTotal = useMemo(() => {
    const draftDisc = draftDisplayItems.reduce((sum, it) => sum + (it.discountAmountVnd ?? 0), 0);
    const savedDisc = !isNew
      ? projectedSavedItems.reduce((sum, item) => sum + item.discountAmountVnd, 0)
      : 0;
    return draftDisc + savedDisc;
  }, [draftDisplayItems, isNew, projectedSavedItems]);

  const combinedSubtotal = Math.max(
    0,
    combinedProductGross + totalTimeGross - combinedItemManualDiscountTotal,
  );

  const promotionPreviewInput = useMemo(
    () => ({
      orderId: isNew ? undefined : orderId,
      customerId: customerId || null,
      subtotalVnd: combinedSubtotal,
      promotionIds: manualPromotionIds ?? undefined,
      items: combinedItemsForPromotion,
    }),
    [combinedItemsForPromotion, combinedSubtotal, customerId, isNew, manualPromotionIds, orderId],
  );
  const debouncedPromotionPreviewInput = useDebouncedValue(promotionPreviewInput, 300);
  const debouncedPromotionPreviewKey = useMemo(
    () => JSON.stringify(debouncedPromotionPreviewInput),
    [debouncedPromotionPreviewInput],
  );
  const promotionPreview = useQuery({
    queryKey: [
      'pos-promotion-preview',
      orderId,
      promotionModalOpen ? debouncedPromotionPreviewKey : 'closed',
    ],
    queryFn: ({ signal }) => {
      return jsonRequest<PromotionPreviewResult>(
        '/api/v1/pos/promotions/preview',
        debouncedPromotionPreviewInput,
        { skipMutationTracking: true, signal },
      );
    },
    enabled:
      promotionModalOpen &&
      combinedItemsForPromotion.length > 0 &&
      (staffContext.data?.permissions?.includes('promotion.apply') ?? false),
    staleTime: 5_000,
    retry: false,
  });

  const appliedPromotions: PosPromotionOption[] =
    promotionPreview.data?.applied ?? (!isNew ? (quote.data?.promotions ?? []) : []);
  const totalDiscount =
    promotionPreview.data?.promotionDiscountVnd ??
    (!isNew ? (quote.data?.promotionDiscountVnd ?? 0) : 0);
  const promotionOptions = promotionPreview.data?.options ?? quote.data?.promotionOptions ?? [];
  const appliedPromotionIds = useMemo(
    () => appliedPromotions.map((promotion) => promotion.id),
    [appliedPromotions],
  );

  const previewGiftDisplayItems = useMemo(() => {
    const gifts = promotionPreview.data
      ? (promotionPreview.data.giftItems ?? [])
      : (quote.data?.items ?? [])
        .filter((it) => it.promotionGift)
        .map((g) => ({
          productId: g.productId,
          variantId: g.variantId ?? null,
          productName: g.productName,
          variantName: g.variantName ?? null,
          unitName: g.unitName,
          unitPriceVnd: g.unitPriceVnd,
          quantityMilli: g.quantityMilli,
          grossAmountVnd: g.grossLineTotalVnd,
          promotionId: g.promotionGift?.promotionId ?? '',
          promotionName: g.promotionGift?.promotionName ?? '',
        }));
    return gifts.map((gift) => ({
      id: `preview-gift:${gift.promotionId}:${gift.productId}:${gift.variantId}`,
      productId: gift.productId,
      variantId: gift.variantId,
      productType: 'QUANTITY' as const,
      productName: gift.productName,
      variantName: gift.variantName,
      unitName: gift.unitName,
      unitPriceVnd: gift.unitPriceVnd,
      quantityMilli: gift.quantityMilli,
      grossLineTotalVnd: gift.grossAmountVnd,
      discountAmountVnd: gift.grossAmountVnd,
      discountType: 'PERCENT' as const,
      discountInputValue: 100,
      discountReason: `Quà tặng · ${gift.promotionName}`,
      netLineTotalVnd: 0,
      note: null,
      promotionGift: {
        promotionId: gift.promotionId,
        promotionName: gift.promotionName,
      },
    }));
  }, [promotionPreview.data, quote.data?.items]);

  const allCurrentItems = useMemo(() => {
    if (isNew) {
      return [...draftDisplayItems, ...previewGiftDisplayItems];
    }
    return [...projectedSavedItems, ...draftDisplayItems, ...previewGiftDisplayItems];
  }, [isNew, projectedSavedItems, draftDisplayItems, previewGiftDisplayItems]);

  const mobileHeaderTitle = useMemo(() => {
    const tName = quote.data?.order.tableName ?? selectedTable?.name;
    const aName = quote.data?.order.areaName ?? selectedTable?.areaName;
    if (tName) {
      return aName ? `${tName} / ${aName}` : tName;
    }
    if (orderType === 'TAKEAWAY') {
      return 'Đơn mang về';
    }
    return (
      quote.data?.order.displayCode || (orderId ? `Đơn ${orderId.slice(0, 6)}` : 'Chọn mặt hàng')
    );
  }, [
    quote.data?.order.tableName,
    quote.data?.order.areaName,
    quote.data?.order.displayCode,
    selectedTable,
    orderType,
    orderId,
  ]);

  const displayedItems = allCurrentItems;
  const committedDisplayItems = isNew ? [] : (quote.data?.items ?? []);
  const pendingChangeRows = useMemo(() => {
    const savedRows = updatedItemsPayload().flatMap((update) => {
      const item = quote.data?.items.find((candidate) => candidate.id === update.itemId);
      if (!item) return [];
      const projected = projectedSavedItems.find((candidate) => candidate.id === update.itemId);
      return [
        {
          key: `saved:${item.id}`,
          sourceId: item.id,
          source: 'SAVED' as const,
          productType: item.productType,
          productName: item.productName,
          variantName: projected?.variantName ?? item.variantName,
          unitName: item.unitName,
          deltaQuantityMilli: update.quantityMilli - item.quantityMilli,
          afterQuantityMilli: update.quantityMilli,
          amountDeltaVnd:
            (projected?.netLineTotalVnd ?? item.netLineTotalVnd) - item.netLineTotalVnd,
          isNew: false,
          removalReason: update.removalReason ?? null,
        },
      ];
    });
    const addedRows = draftDisplayItems.map((item) => ({
      key: `draft:${item.id}`,
      sourceId: item.id,
      source: 'DRAFT' as const,
      productType: item.productType,
      productName: item.productName,
      variantName: item.variantName,
      unitName: item.unitName,
      deltaQuantityMilli: item.quantityMilli,
      afterQuantityMilli: item.quantityMilli,
      amountDeltaVnd: item.netLineTotalVnd,
      isNew: true,
      removalReason: null,
    }));
    return [...savedRows, ...addedRows];
  }, [
    draftDisplayItems,
    modifiedItemDetails,
    modifiedItemQuantities,
    projectedSavedItems,
    quote.data,
  ]);

  const undoPendingChange = (source: 'DRAFT' | 'SAVED', sourceId: string) => {
    if (source === 'DRAFT') {
      setDraftLines((lines) => lines.filter((line) => line.id !== sourceId));
      return;
    }
    setModifiedItemQuantities((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
    setModifiedItemDetails((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  };

  const pendingChangesPanel =
    pendingChangeRows.length > 0 ? (
      <section className="staff-pending-changes">
        <div className="staff-pending-changes__header">
          <strong>Đang thay đổi ({pendingChangeRows.length})</strong>
          <button type="button" onClick={clearOrderDraft}>
            Hoàn tác tất cả
          </button>
        </div>
        {conflictingSavedItemIds.size > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="Đơn vừa thay đổi trên thiết bị khác"
            description="Số lượng nháp đã được giữ theo phần chênh lệch. Vui lòng đối chiếu lại trước khi lưu."
          />
        ) : null}
        <div className="staff-pending-changes__list">
          {pendingChangeRows.map((change) => (
            <div className="staff-pending-change-row" key={change.key}>
              <div className="staff-pending-change-row__quantity">
                {change.deltaQuantityMilli > 0 ? '+' : ''}
                {formatItemQuantity(change.productType, change.deltaQuantityMilli, change.unitName)}
              </div>
              <div className="staff-pending-change-row__content">
                <strong>{change.productName}</strong>
                <small>
                  {[change.variantName, change.removalReason && `Lý do: ${change.removalReason}`]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              {change.isNew ? <span className="staff-pending-change-row__new">New</span> : null}
              <b className={change.amountDeltaVnd < 0 ? 'is-negative' : ''}>
                {change.amountDeltaVnd > 0 ? '+' : ''}
                {formatMoney(change.amountDeltaVnd)}
              </b>
              <button
                type="button"
                className="staff-pending-change-row__undo"
                aria-label="Hoàn tác thay đổi"
                onClick={() => undoPendingChange(change.source, change.sourceId)}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      </section>
    ) : null;

  const hasUnsavedChanges = useMemo(() => {
    if (isNew) {
      return draftLines.length > 0;
    }
    return draftLines.length > 0 || updatedItemsPayload().length > 0 || manualPromotionIds !== null;
  }, [
    isNew,
    draftLines.length,
    modifiedItemDetails,
    modifiedItemQuantities,
    quote.data,
    manualPromotionIds,
  ]);
  const emphasizeSaveButton =
    !saving && (isNew ? orderType === 'DINE_IN' || draftLines.length > 0 : hasUnsavedChanges);

  // 1. Tiền hàng (mặt hàng số lượng và trọng lượng)
  const regularProductGross = allCurrentItems
    .filter((item) => !item.promotionGift)
    .reduce((sum, item) => sum + item.grossLineTotalVnd, 0);
  const regularProductCount = allCurrentItems.filter((item) => !item.promotionGift).length;

  const displayedTotal = Math.max(0, combinedSubtotal - totalDiscount);
  const liveElapsedSeconds = quote.data?.time
    ? quote.data.time.elapsedSeconds +
    (quote.data.time.status === 'RUNNING' && !quote.data.time.endedAtMs
      ? Math.max(0, Math.floor((clockNow - quote.dataUpdatedAt) / 1000))
      : 0)
    : 0;

  const applyPromotion = async (promotionIds: string[]) => {
    setManualPromotionIds(promotionIds);
    if (!isNew && quote.data && draftLines.length === 0 && !hasPendingSavedItemChanges()) {
      setPromotionSaving(true);
      try {
        const snapshot = await jsonRequest<OrderMutationSnapshot>(
          `/api/v1/pos/orders/${quote.data.order.id}/promotion`,
          { promotionIds, expectedOrderVersion: quote.data.order.version },
          { method: 'PUT', headers: mutationHeaders(csrf) },
        );
        applyOrderMutationSnapshot(snapshot);
        messageApi.success(
          promotionIds.length > 0
            ? `Đã áp dụng ${promotionIds.length} chương trình khuyến mại.`
            : 'Đã bỏ tất cả khuyến mại.',
        );
      } catch (error) {
        messageApi.error(errorText(error));
      } finally {
        setPromotionSaving(false);
      }
    } else {
      messageApi.success(
        promotionIds.length > 0
          ? `Đã áp dụng ${promotionIds.length} chương trình khuyến mại.`
          : 'Đã bỏ tất cả khuyến mại.',
      );
    }
    setPromotionModalOpen(false);
  };

  if (!quoteReady) {
    const failed = !quote.isFetching && (quote.isError || quote.isRefetchError);
    return (
      <div className="staff-order-editor" style={{ padding: 40 }}>
        {failed ? (
          <Alert
            type="error"
            showIcon
            title="Không thể xác minh dữ liệu đơn hàng"
            description={errorText(quote.error)}
            action={
              <Space>
                <Button onClick={() => navigate('/pos/areas')}>Về khu vực</Button>
                <Button type="primary" onClick={() => void quote.refetch()}>
                  Thử lại
                </Button>
              </Space>
            }
          />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Spin size="large" description="Đang xác minh dữ liệu mới nhất của đơn..." />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="staff-order-editor">
      {holder}
      <PosPromotionModal
        open={promotionModalOpen}
        options={promotionOptions}
        appliedIds={appliedPromotionIds}
        loading={promotionSaving}
        onClose={() => setPromotionModalOpen(false)}
        onApply={(ids) => void applyPromotion(ids)}
      />
      {desktopCheckoutOpen && orderId ? (
        <PaymentPage orderId={orderId} auth={auth} presentation="drawer" />
      ) : null}
      <Drawer
        open={callHistoryOpen}
        title="Lịch sử gọi món"
        width={isMobile ? '100%' : 460}
        onClose={() => setCallHistoryOpen(false)}
      >
        {callHistory.isLoading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : callHistory.data?.items.length ? (
          <div className="staff-call-history">
            {callHistory.data.items.map((batch) => (
              <section className="staff-call-history__batch" key={batch.id}>
                <div className="staff-call-history__heading">
                  <strong>Đợt {batch.sequenceNo}</strong>
                  <span>{formatDateTime(batch.createdAt)}</span>
                </div>
                <small>{batch.actorName}</small>
                {batch.entries.length > 0 ? (
                  <div className="staff-call-history__entries">
                    {batch.entries.map((entry) => (
                      <div className="staff-call-history__entry" key={entry.id}>
                        <div>
                          <strong>{entry.productName}</strong>
                          {entry.variantName ? <small>{entry.variantName}</small> : null}
                          {entry.removalReason ? <small>Lý do: {entry.removalReason}</small> : null}
                        </div>
                        <span>
                          {entry.deltaQuantityMilli > 0 ? '+' : ''}
                          {formatItemQuantity(
                            entry.productType === 'TIME' ? 'QUANTITY' : entry.productType,
                            entry.deltaQuantityMilli,
                            entry.unitName,
                          )}
                          <small>
                            {formatDecimal(entry.beforeQuantityMilli / 1000)} →{' '}
                            {formatDecimal(entry.afterQuantityMilli / 1000)}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small>Khởi tạo đơn, chưa có mặt hàng.</small>
                )}
              </section>
            ))}
          </div>
        ) : (
          <Empty description="Đơn này không có lịch sử gọi món" />
        )}
      </Drawer>

      {isMobile ? (
        mobileView === 'PRODUCTS' ? (
          <div className="staff-product-picker-mobile">
            {/* Header with Close Button */}
            <header className="staff-product-picker-mobile__header">
              <button
                type="button"
                className="staff-product-picker-mobile__close-btn"
                onClick={() => {
                  setMobileView('CART');
                }}
                aria-label="Thoát chọn món"
              >
                <CloseOutlined />
              </button>
              <div className="staff-product-picker-mobile__title">{mobileHeaderTitle}</div>
              <div className="staff-product-picker-mobile__header-actions">
                {canManageCatalog ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="staff-product-picker-mobile__action-btn"
                      onClick={() => setQuickAddOpen(true)}
                      title="Thêm nhanh món mới"
                    >
                      <PlusOutlined />
                    </button>
                    <button
                      type="button"
                      className="staff-product-picker-mobile__action-btn"
                      onClick={() => navigate('/pos/catalog')}
                      title="Quản lý món"
                    >
                      <TagsOutlined />
                    </button>
                  </div>
                ) : (
                  <div className="staff-product-picker-mobile__header-space" />
                )}
              </div>
            </header>

            {/* Search Bar */}
            <div className="staff-product-picker-mobile__search">
              <Input
                size="middle"
                allowClear
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Tìm kiếm mặt hàng..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
            </div>

            {/* Categories Horizontal Scroll Bar */}
            <div className="staff-product-picker-mobile__cat-bar">
              <button
                type="button"
                className={`staff-product-picker-cat-pill ${selectedCategory === 'ALL' ? 'is-active' : ''}`}
                onClick={() => setSelectedCategory('ALL')}
                aria-pressed={selectedCategory === 'ALL'}
              >
                <span className="staff-product-picker-cat-pill__icon">{ALL_CATEGORY_ICON}</span>
                <span className="staff-product-picker-cat-pill__content">
                  <span>Tất cả</span>
                  <small>{catalog.data?.length ?? 0} mặt hàng</small>
                </span>
              </button>
              {categories.map((cat) => (
                <button
                  type="button"
                  key={cat.id}
                  className={`staff-product-picker-cat-pill ${selectedCategory === cat.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory(cat.id)}
                  aria-pressed={selectedCategory === cat.id}
                >
                  <span className="staff-product-picker-cat-pill__icon">{cat.icon}</span>
                  <span className="staff-product-picker-cat-pill__content">
                    <span>{cat.name}</span>
                    <small>{cat.count} mặt hàng</small>
                  </span>
                </button>
              ))}
            </div>

            {/* Products Compact Row List */}
            <main className="staff-product-picker-mobile__products-list">
              {catalog.isLoading ? (
                <div style={{ padding: '20px 16px' }}>
                  <Skeleton active paragraph={{ rows: 6 }} />
                </div>
              ) : visibleCatalog.length === 0 ? (
                <Empty description="Không tìm thấy sản phẩm" style={{ marginTop: 60 }}>
                  {canManageCatalog && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setQuickAddOpen(true)}
                    >
                      Thêm nhanh mặt hàng
                    </Button>
                  )}
                </Empty>
              ) : (
                <div className="staff-product-compact-list">
                  {visibleCatalog.map((product, index) => {
                    const prices = product.variants
                      .map((v) => v.salePriceVnd)
                      .filter((p): p is number => p !== null);
                    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
                    const effectiveCount = product.variants.reduce(
                      (sum, variant) =>
                        sum + effectiveVariantQuantityMilli(product.productId, variant.id) / 1000,
                      0,
                    );
                    const committedCount = (quote.data?.items ?? [])
                      .filter((item) => !item.promotionGift && item.productId === product.productId)
                      .reduce((sum, item) => sum + item.quantityMilli / 1000, 0);

                    return (
                      <div
                        key={product.productId}
                        className={`staff-product-compact-row ${effectiveCount > 0 ? 'is-selected' : ''}`}
                        onClick={(e) => chooseProduct(product, e)}
                      >
                        <div
                          className={`staff-product-compact-row__visual ${product.avatarType === 'IMAGE' && product.mediaId ? 'has-image' : 'has-color'}`}
                          style={{
                            background:
                              product.avatarType === 'IMAGE' && product.mediaId
                                ? undefined
                                : product.avatarColor || '#0975f7',
                          }}
                        >
                          {product.avatarType === 'IMAGE' && product.mediaId ? (
                            <img
                              src={`/api/v1/media/${product.mediaId}`}
                              alt=""
                              loading={index < 12 ? 'eager' : 'lazy'}
                              fetchPriority={index < 12 ? 'high' : 'low'}
                              decoding="async"
                            />
                          ) : (
                            getProductInitials(product.productName)
                          )}
                        </div>

                        <div className="staff-product-compact-row__info">
                          <strong className="staff-product-compact-row__name">
                            {product.productName}
                          </strong>
                          <div className="staff-product-compact-row__meta">
                            {committedCount === 0 && effectiveCount > 0 ? (
                              <span className="staff-product-compact-row__new-badge">New</span>
                            ) : null}
                            {product.variants.length > 1 ? (
                              <span className="staff-product-compact-row__variant-badge">
                                {product.variants.length} phiên bản
                              </span>
                            ) : product.unitName ? (
                              <span className="staff-product-compact-row__unit">
                                {product.unitName}
                              </span>
                            ) : null}
                          </div>
                          <b className="staff-product-compact-row__price">
                            {minPrice === null
                              ? 'Nhập giá'
                              : minPrice === maxPrice
                                ? `${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`
                                : `Từ ${formatMoney(minPrice)}${product.productType === 'WEIGHT' ? `/${getWeightUnit(product.unitName)}` : ''}`}
                          </b>
                        </div>

                        <div className="staff-product-compact-row__action">
                          {effectiveCount > 0 &&
                            product.productType === 'QUANTITY' &&
                            product.variants.length === 1 ? (
                            <div
                              className="staff-product-compact-stepper"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="staff-product-compact-stepper__btn minus"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const variant = product.variants[0];
                                  if (variant) decrementVariant(product, variant);
                                }}
                                aria-label="Giảm"
                              >
                                −
                              </button>
                              <span className="staff-product-compact-stepper__count">
                                {formatDecimal(effectiveCount)}
                              </span>
                              <button
                                type="button"
                                className="staff-product-compact-stepper__btn plus"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  chooseProduct(product, e);
                                }}
                                aria-label="Tăng"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="staff-product-compact-add-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                chooseProduct(product, e);
                              }}
                              aria-label={`Thêm ${product.productName}`}
                            >
                              <PlusOutlined />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </main>

            {/* Bottom Bar: secondary cart review + primary direct save */}
            <div className="staff-product-picker-mobile__bottom-bar">
              <button
                type="button"
                className="staff-product-picker-mobile__cart-btn"
                ref={cartIconRef}
                onClick={() => setMobileView('CART')}
                aria-label="Xem đơn"
              >
                <ShoppingCartOutlined />
                <span className="staff-product-picker-mobile__cart-label">Xem đơn</span>
                <span className="staff-product-picker-mobile__cart-count">
                  {pendingChangeRows.length}
                </span>
              </button>
              <div className="staff-product-picker-mobile__bottom-actions">
                <b className="staff-product-picker-mobile__bottom-price">
                  {formatMoney(
                    pendingChangeRows.reduce((sum, change) => sum + change.amountDeltaVnd, 0),
                  )}
                </b>
                <Button
                  type="primary"
                  size="large"
                  disabled={
                    isNew ? orderType === 'TAKEAWAY' && draftLines.length === 0 : !hasUnsavedChanges
                  }
                  loading={saving}
                  onClick={isNew ? saveOrder : () => void saveAdditionalItems(false)}
                  className="staff-product-picker-mobile__done-btn"
                >
                  Lưu đơn
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="staff-order-mobile-view">
            {/* Sticky Top Bar: Header & Chips Bar */}
            <div className="staff-order-mobile-top-bar">
              {/* Mobile Header */}
              <header className="staff-order-mobile-header">
                <button
                  type="button"
                  className="staff-order-mobile-back-btn"
                  onClick={handleExit}
                  aria-label="Quay lại danh sách"
                >
                  <LeftOutlined />
                </button>
                <div className="staff-order-mobile-title-wrap">
                  <div className="staff-order-mobile-code">
                    {isNew
                      ? orderType === 'DINE_IN' && selectedTable
                        ? selectedTable.name
                        : 'Tạo đơn mới'
                      : quote.data?.order.displayCode ||
                      (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                  </div>
                  <div className="staff-order-mobile-sub">
                    <span className="staff-order-mobile-type-icon">
                      <ShopOutlined />
                    </span>
                    <span>
                      {orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang về'} -{' '}
                      {formatDateTime(isNew ? clockNow : (quote.data?.order.openedAt ?? clockNow))}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="staff-order-mobile-dots-btn"
                  onClick={() => setMobileActionsOpen(true)}
                  aria-label="Thao tác khác"
                >
                  <EllipsisOutlined />
                </button>
              </header>

              {/* Mobile Chips Horizontal Scroll Bar: Khách hàng -> Ghi chú -> Loại đơn -> Khu vực -> Số khách */}
              <div className="staff-order-mobile-chips-bar">
                {/* 1. Khách hàng */}
                <button
                  type="button"
                  className={`staff-order-chip ${customerName ? 'staff-order-chip--active' : ''}`}
                  onClick={() => setCustomerModalOpen(true)}
                >
                  <UserOutlined className="staff-order-chip__icon" />
                  <span className="staff-order-chip__text">{customerName || 'Khách lẻ'}</span>
                </button>

                {/* 2. Ghi chú */}
                <button
                  type="button"
                  className={`staff-order-chip ${orderNote ? 'staff-order-chip--active' : ''}`}
                  onClick={() => setOrderNoteOpen(true)}
                >
                  <EditOutlined className="staff-order-chip__icon" />
                  <span className="staff-order-chip__text">{orderNote || 'Ghi chú'}</span>
                </button>

                {/* 3. Loại đơn */}
                <button
                  type="button"
                  className="staff-order-chip"
                  onClick={() => {
                    if (!isNew) {
                      messageApi.info('Không thể đổi loại đơn cho đơn hàng đã lưu.');
                      return;
                    }
                    const nextType = orderType === 'DINE_IN' ? 'TAKEAWAY' : 'DINE_IN';
                    setOrderType(nextType);
                    if (nextType === 'TAKEAWAY') {
                      setSearchParams(
                        (prev) => {
                          const next = new URLSearchParams(prev);
                          next.delete('tableId');
                          return next;
                        },
                        { replace: true },
                      );
                    }
                  }}
                >
                  <ShopOutlined className="staff-order-chip__icon" />
                  <span className="staff-order-chip__text">
                    {orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang về'}
                  </span>
                </button>

                {/* 4. Khu vực / Bàn (nếu Tại chỗ) */}
                {orderType === 'DINE_IN' && (
                  <button
                    type="button"
                    className="staff-order-chip"
                    onClick={() => {
                      if (isNew) {
                        setTableAction('SELECT');
                        setTableModalOpen(true);
                      }
                    }}
                  >
                    <AppstoreOutlined className="staff-order-chip__icon" />
                    <span className="staff-order-chip__text">
                      {quote.data?.order.tableName
                        ? `${quote.data.order.areaName ? `${quote.data.order.areaName} - ` : ''}${quote.data.order.tableName}`
                        : selectedTable
                          ? `${selectedTable.areaName ? `${selectedTable.areaName} - ` : ''}${selectedTable.name}`
                          : 'Chọn bàn'}
                    </span>
                  </button>
                )}

                {/* 5. Số khách */}
                <button
                  type="button"
                  className="staff-order-chip"
                  onClick={() => setGuestModalOpen(true)}
                >
                  <TeamOutlined className="staff-order-chip__icon" />
                  <span className="staff-order-chip__text">{guestCount}</span>
                </button>
              </div>
            </div>

            {/* Mobile Ordered Items Section */}
            <div className="staff-order-mobile-items-section">
              <div
                className="staff-order-mobile-section-header"
                onClick={() => setOrderedItemsCollapsed((prev) => !prev)}
              >
                <span className="staff-order-mobile-section-title">
                  Mặt hàng đã gọi (
                  {committedDisplayItems.length +
                    (quote.data?.time ||
                      (isNew &&
                        orderType === 'DINE_IN' &&
                        selectedTable?.timeProductId &&
                        !timeRemoved) ||
                      timeRestoringDraft
                      ? 1
                      : 0)}
                  )
                </span>
                {!isNew && quote.data?.order.hasCallHistory ? (
                  <button
                    type="button"
                    className="staff-order-mobile-history-btn"
                    aria-label="Lịch sử gọi món"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCallHistoryOpen(true);
                    }}
                  >
                    <HistoryOutlined />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="staff-order-mobile-collapse-btn"
                  aria-label="Thu gọn/Mở rộng"
                >
                  {orderedItemsCollapsed ? <DownOutlined /> : <UpOutlined />}
                </button>
              </div>

              {!orderedItemsCollapsed && (
                <div className="staff-order-mobile-items-list">
                  {/* Small restore button if default time was deleted */}
                  {(!isNew &&
                    quote.data?.order.orderType === 'DINE_IN' &&
                    !quote.data?.time &&
                    !timeRestoringDraft) ||
                    (isNew &&
                      orderType === 'DINE_IN' &&
                      selectedTable?.timeProductId &&
                      timeRemoved) ? (
                    <div style={{ padding: '8px 16px 4px' }}>
                      <Button
                        size="small"
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          if (isNew) {
                            setTimeRemoved(false);
                          } else {
                            setTimeRestoringDraft(true);
                            setTimeRangeDraft({ startedAt: dayjs(), endedAt: null });
                            setTimeDetailOpen(true);
                          }
                        }}
                        style={{
                          fontSize: 12.5,
                          color: '#0975F7',
                          borderColor: '#91caff',
                          borderRadius: 6,
                          fontWeight: 500,
                        }}
                      >
                        Khôi phục tính giờ
                      </Button>
                    </div>
                  ) : null}

                  {/* 1. Time line item (if present or new dine-in table with pricing configured or restoring) */}
                  {quote.data?.time ? (
                    <div
                      className={`staff-order-mobile-item staff-order-mobile-item--time${quote.data.time.status === 'PAUSED' ? ' staff-order-mobile-item--paused' : ''}`}
                      onClick={openTimeDetails}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-item__name">
                          <span>
                            {quote.data.time.tableSegments &&
                              quote.data.time.tableSegments.length > 1
                              ? 'Tiền giờ (Chuyển bàn)'
                              : 'Giờ'}
                          </span>
                          {quote.data.time.status === 'PAUSED' ? (
                            <Tag
                              color="warning"
                              icon={<PauseCircleOutlined />}
                              style={{ marginLeft: 6 }}
                            >
                              Tạm dừng
                            </Tag>
                          ) : quote.data.time.status === 'ENDED' || quote.data.time.endedAtMs ? (
                            <Tag
                              color="default"
                              icon={<ClockCircleOutlined />}
                              style={{ marginLeft: 6 }}
                            >
                              Đã dừng giờ
                            </Tag>
                          ) : null}
                        </span>
                        <span className="staff-order-mobile-item__price">
                          {formatMoney(quote.data.time.amountAfterRoundingVnd)}
                        </span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: {formatDateTime(quote.data.time.startedAtMs)}</div>
                        <div>
                          Tới:{' '}
                          {quote.data.time.endedAtMs
                            ? formatDateTime(quote.data.time.endedAtMs)
                            : quote.data.time.status === 'PAUSED' && quote.data.time.pausedAtMs
                              ? formatDateTime(quote.data.time.pausedAtMs)
                              : 'Hiện tại'}
                        </div>
                        <div>
                          Tổng thời gian tạm tính: {formatDurationVietnamese(liveElapsedSeconds)}
                        </div>
                        {quote.data.time.tableSegments &&
                          quote.data.time.tableSegments.length > 1 && (
                            <div className="staff-order-mobile-item__chain">
                              Bàn:{' '}
                              {quote.data.time.tableSegments.map((s) => s.tableName).join(' → ')}
                            </div>
                          )}
                      </div>
                    </div>
                  ) : isNew &&
                    orderType === 'DINE_IN' &&
                    selectedTable?.timeProductId &&
                    !timeRemoved ? (
                    <div
                      className="staff-order-mobile-item staff-order-mobile-item--time"
                      onClick={() => {
                        setTableAction('SELECT');
                        setTableModalOpen(true);
                      }}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-item__name">
                          <span>Giờ</span>
                        </span>
                        <span className="staff-order-mobile-item__price">0 đ</span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: --:--:--</div>
                        <div>Tới: --:--:--</div>
                        <div>Tổng thời gian tạm tính: --:--:--</div>
                      </div>
                    </div>
                  ) : timeRestoringDraft ? (
                    <div
                      className="staff-order-mobile-item staff-order-mobile-item--time"
                      onClick={openTimeDetails}
                    >
                      <div className="staff-order-mobile-item__top">
                        <span className="staff-order-mobile-item__name">
                          <span>Giờ</span>
                        </span>
                        <span className="staff-order-mobile-item__price">0 đ</span>
                      </div>
                      <div className="staff-order-mobile-item__time-sub">
                        <div>Từ: --:--:--</div>
                        <div>Tới: --:--:--</div>
                        <div>Tổng thời gian tạm tính: --:--:--</div>
                      </div>
                    </div>
                  ) : null}

                  {pendingChangesPanel}

                  {/* 2. Items already committed to the order */}
                  {committedDisplayItems.map((item) => {
                    const isDraftLine = draftLines.some((l) => l.id === item.id);
                    const catalogProd = catalog.data?.find((p) => p.productId === item.productId);

                    const openItemEdit = () => {
                      if (item.promotionGift) return;
                      setEditingItem({
                        source: isDraftLine ? 'DRAFT' : 'SAVED',
                        id: item.id,
                        productId: item.productId,
                        variantId: item.variantId,
                        productType: item.productType,
                        productName: item.productName,
                        variantName: item.variantName,
                        unitName: item.unitName,
                        unitPriceVnd: item.unitPriceVnd,
                        quantityMilli: item.quantityMilli,
                        note: item.note ?? '',
                        grossLineTotalVnd: item.grossLineTotalVnd,
                        discountAmountVnd: item.discountAmountVnd,
                        discountType: item.discountType,
                        discountInputValue: item.discountInputValue,
                        discountReason: item.discountReason,
                        netLineTotalVnd: item.netLineTotalVnd,
                      });
                    };

                    return (
                      <SwipeableOrderItemRow
                        key={item.id}
                        locked={Boolean(item.promotionGift)}
                        onClick={openItemEdit}
                        onDelete={() => {
                          if (item.promotionGift) return;
                          if (isNew || isDraftLine) {
                            setDraftLines((lines) => lines.filter((line) => line.id !== item.id));
                            messageApi.success('Đã xóa món khỏi đơn.');
                          } else {
                            setDeleteItemTarget({
                              id: item.id,
                              name: item.productName,
                              source: 'SAVED',
                            });
                            setDeleteItemReason('Khách đổi ý');
                            setDeleteItemModalOpen(true);
                          }
                        }}
                        className="staff-order-mobile-swipe-card"
                      >
                        <div
                          className={`staff-order-mobile-card-row ${isDraftLine ? 'is-draft' : ''}`}
                        >
                          {/* Left: Thumbnail image */}
                          <div
                            className={`staff-order-mobile-card-row__visual ${catalogProd?.avatarType === 'IMAGE' && catalogProd.mediaId ? 'has-image' : 'has-color'}`}
                            style={{
                              background:
                                catalogProd?.avatarType === 'IMAGE' && catalogProd.mediaId
                                  ? undefined
                                  : catalogProd?.avatarColor || '#0975f7',
                            }}
                          >
                            {catalogProd?.avatarType === 'IMAGE' && catalogProd.mediaId ? (
                              <img
                                src={`/api/v1/media/${catalogProd.mediaId}`}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              getProductInitials(item.productName)
                            )}
                            {isDraftLine && (
                              <div className="staff-order-mobile-draft-ribbon">
                                <span>Mới</span>
                              </div>
                            )}
                          </div>

                          {/* Right: Content details */}
                          <div className="staff-order-mobile-card-row__content">
                            {/* Top row: Name + Ellipsis Dots */}
                            <div className="staff-order-mobile-card-row__top">
                              <span className="staff-order-mobile-card-row__name">
                                <strong>{item.productName}</strong>
                                {item.variantName && item.variantName !== 'Mặc định' && (
                                  <small className="staff-order-mobile-card-row__variant">
                                    {' '}
                                    · {item.variantName}
                                  </small>
                                )}
                                {item.promotionGift ? (
                                  <Tag color="success" style={{ marginLeft: 4 }}>
                                    Quà tặng
                                  </Tag>
                                ) : null}
                              </span>

                              {!item.promotionGift && (
                                <button
                                  type="button"
                                  className="staff-order-mobile-card-row__dots-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openItemEdit();
                                  }}
                                  aria-label="Tùy chỉnh món"
                                >
                                  <EllipsisOutlined />
                                </button>
                              )}
                            </div>

                            {/* Optional: Note and Discount details */}
                            {item.note && (
                              <div className="staff-order-mobile-card-row__note">
                                Ghi chú: {item.note}
                              </div>
                            )}
                            <ItemDiscountDetail
                              amount={item.discountAmountVnd}
                              reason={item.discountReason}
                              promotionGift={item.promotionGift}
                            />

                            {/* Bottom row: Price + Quantity Stepper */}
                            <div className="staff-order-mobile-card-row__bottom">
                              <span className="staff-order-mobile-card-row__price">
                                {formatMoney(item.netLineTotalVnd)}
                              </span>

                              {item.productType !== 'WEIGHT' && !item.promotionGift ? (
                                <span
                                  className="staff-order-mobile-quantity-label"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openItemEdit();
                                  }}
                                >
                                  {formatItemQuantity(
                                    item.productType,
                                    item.quantityMilli,
                                    item.unitName,
                                  )}
                                </span>
                              ) : item.productType === 'WEIGHT' ? (
                                <span className="staff-order-mobile-weight-label">
                                  {formatItemQuantity(
                                    item.productType,
                                    item.quantityMilli,
                                    item.unitName,
                                  )}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </SwipeableOrderItemRow>
                    );
                  })}

                  {committedDisplayItems.length === 0 &&
                    pendingChangeRows.length === 0 &&
                    !(
                      isNew &&
                      orderType === 'DINE_IN' &&
                      selectedTable?.timeProductId &&
                      !timeRemoved
                    ) &&
                    !quote.data?.time &&
                    !timeRestoringDraft && (
                      <div className="staff-order-mobile-empty">
                        <p>Chưa có mặt hàng nào trong đơn</p>
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setMobileView('PRODUCTS');
                          }}
                        >
                          Chọn món ngay
                        </Button>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Mobile Order Financial Summary Details (In-Flow / Non-Sticky) */}
            <div className="staff-order-mobile-summary-card">
              <div className="staff-order-mobile-summary__title">Tổng tiền</div>
              <div className="staff-order-mobile-summary__row">
                <span>Tổng tiền hàng ({regularProductCount} món)</span>
                <span>{formatMoney(regularProductGross)}</span>
              </div>
              {totalTimeGross > 0 && (
                <div className="staff-order-mobile-summary__row">
                  <span>Tiền giờ</span>
                  <span>{formatMoney(totalTimeGross)}</span>
                </div>
              )}
              {combinedItemManualDiscountTotal > 0 && (
                <div className="staff-order-mobile-summary__row">
                  <span>Giảm giá món</span>
                  <span className="staff-cart-discount-amount">
                    -{formatMoney(combinedItemManualDiscountTotal)}
                  </span>
                </div>
              )}
              <div
                className="staff-order-mobile-summary__row staff-promotion-trigger"
                onClick={() => void openPromotionPicker()}
              >
                <span>
                  Khuyến mãi <EditOutlined />
                </span>
                <span className="staff-cart-discount-amount">
                  {totalDiscount > 0 ? `-${formatMoney(totalDiscount)}` : '0đ'}
                </span>
              </div>
              {appliedPromotions.length > 0 ? (
                <div
                  className="staff-applied-promotions-box"
                  onClick={() => void openPromotionPicker()}
                >
                  {appliedPromotions.map((promotion) => (
                    <div key={promotion.id} className="staff-applied-promotion-row-item">
                      <span className="staff-applied-promotion-name">{promotion.name}</span>
                      <span className="staff-applied-promotion-amount">
                        {promotionBenefitCopy(promotion)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="staff-order-mobile-divider" />
              <div className="staff-order-mobile-summary__total-row">
                <strong>Tổng tiền</strong>
                <strong>{formatMoney(displayedTotal)}</strong>
              </div>
            </div>

            {/* Floating "+ Thêm món" Button */}
            <button
              type="button"
              className="staff-order-mobile-fab"
              onClick={() => {
                setMobileView('PRODUCTS');
              }}
            >
              <PlusOutlined />
            </button>

            {/* Sticky Bottom Billing Summary & Actions */}
            <div className="staff-order-mobile-footer">
              <div className="staff-order-mobile-summary-compact">
                <div className="staff-order-mobile-summary__total-row">
                  <strong>Tổng tiền</strong>
                  <strong>{formatMoney(displayedTotal)}</strong>
                </div>
              </div>

              <div className="staff-order-mobile-actions staff-order-mobile-actions--grid">
                {isPaymentPending ? (
                  <>
                    <button
                      type="button"
                      className="staff-order-mobile-btn staff-order-mobile-btn--provisional"
                      onClick={() => {
                        if (quote.data) setProvisionalBillOpen(true);
                        else messageApi.info('Vui lòng lưu đơn trước khi xem tạm tính.');
                      }}
                      title="Xem tạm tính"
                    >
                      <PrinterOutlined className="staff-order-mobile-btn__icon" />
                      <span className="staff-order-mobile-btn__label">Tạm tính</span>
                    </button>
                    <Button
                      size="large"
                      icon={<PlayCircleOutlined />}
                      loading={resuming}
                      onClick={() => setResumeModalOpen(true)}
                      className={`staff-order-mobile-btn staff-order-mobile-btn--save${emphasizeSaveButton ? ' staff-save-button--attention' : ''}`}
                    >
                      Tiếp tục chơi
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => navigateToPayment(quote.data!.order.id)}
                      className="staff-order-mobile-btn staff-order-mobile-btn--pay"
                    >
                      Thanh toán
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="staff-order-mobile-btn staff-order-mobile-btn--provisional"
                      onClick={() => {
                        if (quote.data) setProvisionalBillOpen(true);
                        else messageApi.info('Vui lòng lưu đơn trước khi xem tạm tính.');
                      }}
                      title="Xem tạm tính"
                    >
                      <PrinterOutlined className="staff-order-mobile-btn__icon" />
                      <span className="staff-order-mobile-btn__label">Tạm tính</span>
                    </button>
                    <Button
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : !hasUnsavedChanges
                      }
                      loading={saving}
                      onClick={isNew ? saveOrder : () => void saveAdditionalItems(false)}
                      className="staff-order-mobile-btn staff-order-mobile-btn--save"
                    >
                      Lưu đơn
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : displayedItems.length === 0 && !quote.data?.time
                      }
                      loading={saving || stoppingTime}
                      onClick={() => void beginCheckout()}
                      className="staff-order-mobile-btn staff-order-mobile-btn--pay"
                    >
                      Thanh toán
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      ) : (
        <>
          <header className="staff-order-editor__header">
            <Button
              type="text"
              size="large"
              aria-label="Đóng trang tạo đơn"
              icon={<CloseOutlined />}
              onClick={handleExit}
            />
            <div className="staff-order-editor__heading">
              <Typography.Title level={3}>
                {isNew ? 'Tạo đơn mới' : 'Chi tiết đơn hàng'}
              </Typography.Title>
              {!isNew && quote.data ? (
                <Typography.Text type="secondary">
                  {[
                    quote.data.order.orderType === 'DINE_IN'
                      ? [quote.data.order.areaName, quote.data.order.tableName]
                        .filter(Boolean)
                        .join(' - ')
                      : 'Mang về',
                    quote.data.order.displayCode ||
                    (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : null),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography.Text>
              ) : isNew && orderType === 'DINE_IN' && selectedTable ? (
                <Typography.Text type="secondary">
                  {[selectedTable.areaName, selectedTable.name].filter(Boolean).join(' - ')}
                </Typography.Text>
              ) : null}
            </div>
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Tìm kiếm sản phẩm"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
            <div className="staff-order-header-meta">
              <Select
                size="large"
                value={isNew ? orderType : quote.data?.order.orderType}
                options={[
                  { value: 'DINE_IN', label: 'Tại chỗ' },
                  { value: 'TAKEAWAY', label: 'Mang về' },
                ]}
                disabled={!isNew}
                onChange={(value) => {
                  const nextType = value as 'DINE_IN' | 'TAKEAWAY';
                  setOrderType(nextType);
                  if (nextType === 'TAKEAWAY') {
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('tableId');
                        return next;
                      },
                      { replace: true },
                    );
                  }
                }}
                aria-label="Loại đơn"
                title={
                  isNew
                    ? 'Chọn loại đơn'
                    : 'Chưa cho phép đổi loại khi đơn đã chạy để tránh sai tiền giờ'
                }
              />
              <div className="staff-order-code">
                <small>Mã đơn</small>
                <strong style={{ color: '#0975F7', fontFamily: 'monospace' }}>
                  {isNew
                    ? 'Sinh khi lưu'
                    : quote.data?.order.displayCode ||
                    (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                </strong>
              </div>
            </div>
          </header>
          <div
            className={`staff-order-editor__body ${isResizing ? 'is-resizing' : ''}`}
            style={{
              gridTemplateColumns: `120px minmax(0, 1fr) auto ${cartWidth}px`,
            }}
          >
            <aside className="staff-category-sidebar">
              <button
                type="button"
                className={selectedCategory === 'ALL' ? 'is-active' : ''}
                onClick={() => setSelectedCategory('ALL')}
                aria-pressed={selectedCategory === 'ALL'}
              >
                <span className="staff-category-sidebar__icon">{ALL_CATEGORY_ICON}</span>
                <span className="staff-category-sidebar__label">Tất cả</span>
                <small>{catalog.data?.length ?? 0}</small>
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  className={selectedCategory === category.id ? 'is-active' : ''}
                  onClick={() => setSelectedCategory(category.id)}
                  aria-pressed={selectedCategory === category.id}
                >
                  <span className="staff-category-sidebar__icon">{category.icon}</span>
                  <span className="staff-category-sidebar__label">{category.name}</span>
                  <small>{category.count}</small>
                </button>
              ))}
            </aside>
            <section className="staff-product-picker">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <Typography.Title level={3} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {selectedCategory === 'ALL'
                    ? 'Tất cả sản phẩm'
                    : categories.find((category) => category.id === selectedCategory)?.name}
                </Typography.Title>
                {canManageCatalog && (
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => setQuickAddOpen(true)}
                    style={{ borderColor: '#0975f7', color: '#0975f7', fontWeight: 600 }}
                  >
                    Thêm nhanh
                  </Button>
                )}
              </div>
              {catalog.isLoading ? (
                <Skeleton active />
              ) : visibleCatalog.length === 0 ? (
                <Empty description="Không có sản phẩm phù hợp">
                  {canManageCatalog && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setQuickAddOpen(true)}
                    >
                      Thêm nhanh mặt hàng
                    </Button>
                  )}
                </Empty>
              ) : (
                <div className="staff-product-grid">
                  {visibleCatalog.map((product, index) => (
                    <PosProductCard
                      key={product.productId}
                      product={product}
                      isPriority={index < 12}
                      onSelect={chooseProduct}
                    />
                  ))}
                </div>
              )}
            </section>
            <div
              className="staff-order-editor__resizer"
              onMouseDown={handleMouseDownResizer}
              title="Kéo thả để thay đổi độ rộng cột chi tiết đơn"
              role="separator"
              aria-orientation="vertical"
            >
              <div className="staff-order-editor__resizer-handle" />
            </div>
            <aside className="staff-cart-panel" style={{ width: cartWidth }}>
              {isPaymentPending ? (
                <div className="staff-order-pending-banner">
                  <div className="staff-order-pending-banner__badge">
                    <CheckCircleOutlined /> ĐÃ DỪNG TÍNH GIỜ
                  </div>
                  <div className="staff-order-pending-banner__text">
                    {quote.data?.time?.endedAtMs
                      ? `Đã dừng lúc ${formatClock(quote.data.time.endedAtMs)}`
                      : 'Đã dừng giờ'}{' '}
                    · Đang chờ thanh toán
                  </div>
                </div>
              ) : null}
              <div className="staff-cart-tabs">
                <button
                  type="button"
                  className={cartTab === 'DETAILS' ? 'is-active' : ''}
                  onClick={() => setCartTab('DETAILS')}
                >
                  Chi tiết đơn
                </button>
                <button
                  type="button"
                  className={cartTab === 'CUSTOMER' ? 'is-active' : ''}
                  onClick={() => setCartTab('CUSTOMER')}
                >
                  Khách hàng
                </button>
                <button
                  type="button"
                  className={cartTab === 'ACTIONS' ? 'is-active' : ''}
                  onClick={() => setCartTab('ACTIONS')}
                >
                  Thao tác khác
                </button>
              </div>
              <div className="staff-cart-scroll-region">
                {cartTab === 'DETAILS' ? (
                  <div className="staff-cart-tab-content">
                    {pendingChangesPanel}
                    <div className="staff-cart-section-header">
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        Sản phẩm đã gọi (
                        {committedDisplayItems.length +
                          (quote.data?.time ||
                            (isNew &&
                              orderType === 'DINE_IN' &&
                              selectedTable?.timeProductId &&
                              !timeRemoved) ||
                            timeRestoringDraft
                            ? 1
                            : 0)}
                        )
                      </Typography.Title>
                      {!isNew && quote.data?.order.hasCallHistory ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<HistoryOutlined />}
                          onClick={() => setCallHistoryOpen(true)}
                        >
                          Lịch sử
                        </Button>
                      ) : null}
                      <Button
                        type="text"
                        size="small"
                        className="staff-cart-collapse-btn"
                        icon={orderedItemsCollapsed ? <DownOutlined /> : <UpOutlined />}
                        aria-label={
                          orderedItemsCollapsed
                            ? 'Mở rộng sản phẩm đã gọi'
                            : 'Thu gọn sản phẩm đã gọi'
                        }
                        onClick={() => setOrderedItemsCollapsed((prev) => !prev)}
                      />
                    </div>
                    {!orderedItemsCollapsed ? (
                      <>
                        {/* Small restore button if default time was deleted */}
                        {(!isNew &&
                          quote.data?.order.orderType === 'DINE_IN' &&
                          !quote.data?.time &&
                          !timeRestoringDraft) ||
                          (isNew &&
                            orderType === 'DINE_IN' &&
                            selectedTable?.timeProductId &&
                            timeRemoved) ? (
                          <div style={{ margin: '0 0 14px' }}>
                            <Button
                              size="small"
                              type="dashed"
                              icon={<PlusOutlined />}
                              onClick={() => {
                                if (isNew) {
                                  setTimeRemoved(false);
                                } else {
                                  setTimeRestoringDraft(true);
                                  setTimeRangeDraft({ startedAt: dayjs(), endedAt: null });
                                  setTimeDetailOpen(true);
                                }
                              }}
                              style={{
                                fontSize: 12.5,
                                color: '#0975F7',
                                borderColor: '#91caff',
                                borderRadius: 6,
                                fontWeight: 500,
                              }}
                            >
                              Khôi phục tính giờ
                            </Button>
                          </div>
                        ) : null}

                        {quote.data?.time ? (
                          quote.data.time.tableSegments &&
                            quote.data.time.tableSegments.length > 1 ? (
                            <button
                              type="button"
                              className="staff-time-line staff-time-line--editable staff-time-line--transfer"
                              onClick={openTimeDetails}
                            >
                              <div className="staff-time-line__heading">
                                <span className="staff-order-quantity">1x</span>
                                <span className="staff-order-item-name">
                                  <div className="staff-time-line__title-row">
                                    <strong>Tiền giờ</strong>
                                    <span className="staff-time-transfer-badge">
                                      <SwapOutlined /> Chuyển bàn
                                    </span>
                                  </div>
                                  <small className="staff-time-transfer-chain">
                                    {quote.data.time.tableSegments
                                      .map((s) => s.tableName)
                                      .join(' → ')}
                                  </small>
                                </span>
                                <b className="staff-time-line__price">
                                  {formatMoney(quote.data.time.amountAfterRoundingVnd)}
                                </b>
                              </div>

                              {/* Detailed transfer breakdown in Cart */}
                              <div className="staff-time-cart-breakdown">
                                {quote.data.time.tableSegments.map((tSeg, idx) => (
                                  <div
                                    key={`${tSeg.tableId}-${tSeg.startedAtMs}-${idx}`}
                                    className="staff-time-cart-row"
                                  >
                                    <div className="staff-time-cart-row__left">
                                      <span className="staff-time-cart-dot">•</span>
                                      <strong className="staff-time-cart-tbl-name">
                                        {tSeg.tableName}
                                      </strong>
                                      <span className="staff-time-cart-tbl-time">
                                        {formatClock(tSeg.startedAtMs)}–
                                        {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'}{' '}
                                        ({formatElapsed(tSeg.elapsedSeconds)})
                                      </span>
                                      <span className="staff-time-cart-tbl-rate">
                                        {formatMoney(tSeg.pricingConfig.basePriceVnd)}/h
                                      </span>
                                    </div>
                                    <b className="staff-time-cart-row__amount">
                                      {formatMoney(tSeg.amountAfterRoundingVnd)}
                                    </b>
                                  </div>
                                ))}
                              </div>

                              <div className="staff-time-line__summary">
                                <span>
                                  Tổng thời gian:{' '}
                                  <strong>{formatElapsed(liveElapsedSeconds)}</strong>
                                </span>
                              </div>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`staff-time-line staff-time-line--editable${quote.data.time.status === 'PAUSED' ? ' staff-time-line--paused' : ''}`}
                              onClick={openTimeDetails}
                            >
                              <div className="staff-time-line__heading">
                                <span className="staff-order-quantity">1x</span>
                                <span className="staff-order-item-name">
                                  <strong>Tiền giờ · {quote.data.order.tableName}</strong>
                                  {quote.data.time.status === 'PAUSED' ? (
                                    <Tag
                                      color="warning"
                                      icon={<PauseCircleOutlined />}
                                      style={{ marginLeft: 6 }}
                                    >
                                      Tạm dừng
                                    </Tag>
                                  ) : quote.data.time.status === 'ENDED' ||
                                    quote.data.time.endedAtMs ? (
                                    <Tag
                                      color="default"
                                      icon={<ClockCircleOutlined />}
                                      style={{ marginLeft: 6 }}
                                    >
                                      Đã dừng giờ
                                    </Tag>
                                  ) : null}
                                  <small>
                                    {quote.data.time.pricingConfig
                                      ? `${formatMoney(quote.data.time.pricingConfig.basePriceVnd)}/giờ`
                                      : ''}
                                  </small>
                                </span>
                                <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
                              </div>
                              <div className="staff-time-line__details">
                                <span>
                                  {formatClock(quote.data.time.startedAtMs)}–
                                  {quote.data.time.endedAtMs
                                    ? formatClock(quote.data.time.endedAtMs)
                                    : quote.data.time.status === 'PAUSED' &&
                                      quote.data.time.pausedAtMs
                                      ? formatClock(quote.data.time.pausedAtMs)
                                      : 'Hiện tại'}{' '}
                                  · Tổng: <strong>{formatElapsed(liveElapsedSeconds)}</strong>
                                </span>
                              </div>
                            </button>
                          )
                        ) : isNew &&
                          orderType === 'DINE_IN' &&
                          selectedTable?.timeProductId &&
                          !timeRemoved ? (
                          <button
                            type="button"
                            className="staff-time-line staff-time-line--editable"
                            onClick={() => {
                              setTableAction('SELECT');
                              setTableModalOpen(true);
                            }}
                          >
                            <div className="staff-time-line__heading">
                              <span className="staff-order-quantity">1x</span>
                              <span className="staff-order-item-name">
                                <strong>Tiền giờ · {selectedTable.name}</strong>
                                <small>
                                  {selectedTable.defaultPriceVnd
                                    ? `${formatMoney(selectedTable.defaultPriceVnd)}/giờ`
                                    : (selectedTable.timeProductName ?? '')}
                                </small>
                              </span>
                              <b>0 đ</b>
                            </div>
                            <div className="staff-time-line__details">
                              <span>
                                --:--:--–--:--:-- · Tổng: <strong>--:--:--</strong>
                              </span>
                            </div>
                          </button>
                        ) : timeRestoringDraft ? (
                          <button
                            type="button"
                            className="staff-time-line staff-time-line--editable"
                            onClick={openTimeDetails}
                          >
                            <div className="staff-time-line__heading">
                              <span className="staff-order-quantity">1x</span>
                              <span className="staff-order-item-name">
                                <strong>
                                  Tiền giờ ·{' '}
                                  {quote.data?.order.tableName ?? selectedTable?.name ?? 'Bàn'}
                                </strong>
                                <small>
                                  {selectedTable?.defaultPriceVnd
                                    ? `${formatMoney(selectedTable.defaultPriceVnd)}/giờ`
                                    : (selectedTable?.timeProductName ?? '')}
                                </small>
                              </span>
                              <b>0 đ</b>
                            </div>
                            <div className="staff-time-line__details">
                              <span>
                                --:--:--–--:--:-- · Tổng: <strong>--:--:--</strong>
                              </span>
                            </div>
                          </button>
                        ) : null}
                        {quote.isLoading && !isNew ? (
                          <Skeleton active />
                        ) : committedDisplayItems.length === 0 &&
                          pendingChangeRows.length === 0 &&
                          !(
                            isNew &&
                            orderType === 'DINE_IN' &&
                            selectedTable?.timeProductId &&
                            !timeRemoved
                          ) &&
                          !timeRestoringDraft ? (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có mặt hàng"
                          />
                        ) : (
                          <div className="staff-compact-order-list">
                            {committedDisplayItems.map((item) => (
                              <SwipeableOrderItemRow
                                key={item.id}
                                dataVariantId={item.variantId ?? item.productId}
                                className={
                                  recentlyAddedLineKey === (item.variantId ?? item.productId)
                                    ? 'staff-order-line--just-added'
                                    : ''
                                }
                                locked={Boolean(item.promotionGift)}
                                onClick={() => {
                                  if (item.promotionGift) return;
                                  const isDraftLine = draftLines.some((l) => l.id === item.id);
                                  setEditingItem({
                                    source: isDraftLine ? 'DRAFT' : 'SAVED',
                                    id: item.id,
                                    productId: item.productId,
                                    variantId: item.variantId,
                                    productType: item.productType,
                                    productName: item.productName,
                                    variantName: item.variantName,
                                    unitName: item.unitName,
                                    unitPriceVnd: item.unitPriceVnd,
                                    quantityMilli: item.quantityMilli,
                                    note: item.note ?? '',
                                    grossLineTotalVnd: item.grossLineTotalVnd,
                                    discountAmountVnd: item.discountAmountVnd,
                                    discountType: item.discountType,
                                    discountInputValue: item.discountInputValue,
                                    discountReason: item.discountReason,
                                    netLineTotalVnd: item.netLineTotalVnd,
                                  });
                                }}
                                onDelete={() => {
                                  if (item.promotionGift) return;
                                  const isDraftLine = draftLines.some((l) => l.id === item.id);
                                  if (isNew || isDraftLine) {
                                    setDraftLines((lines) =>
                                      lines.filter((line) => line.id !== item.id),
                                    );
                                  } else {
                                    setDeleteItemTarget({
                                      id: item.id,
                                      name: item.productName,
                                      source: 'SAVED',
                                    });
                                    setDeleteItemReason('');
                                    setDeleteItemModalOpen(true);
                                  }
                                }}
                              >
                                <span className="staff-order-quantity">
                                  {formatItemQuantity(
                                    item.productType,
                                    item.quantityMilli,
                                    item.unitName,
                                  )}
                                </span>
                                <span className="staff-order-item-name">
                                  <strong>{item.productName}</strong>
                                  <small>{item.variantName}</small>
                                  {item.note ? <small>Ghi chú: {item.note}</small> : null}
                                  {item.promotionGift ? <Tag color="success">Quà tặng</Tag> : null}
                                  <ItemDiscountDetail
                                    amount={item.discountAmountVnd}
                                    reason={item.discountReason}
                                    promotionGift={item.promotionGift}
                                  />
                                </span>
                                <b>{formatMoney(item.netLineTotalVnd)}</b>
                              </SwipeableOrderItemRow>
                            ))}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : cartTab === 'CUSTOMER' ? (
                  <div className="staff-cart-tab-content staff-customer-tab">
                    <PosCustomerSelector
                      customerId={customerId}
                      csrfToken={csrf}
                      allowCreate
                      onSelect={saveCustomerInfo}
                    />
                  </div>
                ) : (
                  <div className="staff-cart-tab-content staff-actions-tab">
                    <div className="staff-order-info-section">
                      <Typography.Title level={5} style={{ marginBottom: 12 }}>
                        Thông tin đơn hàng
                      </Typography.Title>
                      <div className="staff-order-info-grid">
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <ClockCircleOutlined /> Thời gian tạo đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {isNew ? 'Chưa tạo' : formatDateTime(quote.data?.order.openedAt ?? 0)}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <UserOutlined /> Người tạo đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {isNew
                              ? (auth.actor?.displayName ?? 'Nhân viên')
                              : (quote.data?.order.openedByName ??
                                auth.actor?.displayName ??
                                'Nhân viên')}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <ShopOutlined /> Loại đơn
                          </span>
                          <strong className="staff-order-info-value">
                            {orderType === 'DINE_IN'
                              ? `Tại chỗ · ${quote.data?.order.tableName ?? selectedTable?.name ?? 'Chưa chọn bàn'}`
                              : 'Mang về'}
                          </strong>
                        </div>
                        <div className="staff-order-info-item">
                          <span className="staff-order-info-label">
                            <FileTextOutlined /> Mã đơn
                          </span>
                          <strong
                            className="staff-order-info-value"
                            style={{ color: '#0975F7', fontFamily: 'monospace' }}
                          >
                            {isNew
                              ? 'Sinh khi lưu'
                              : quote.data?.order.displayCode ||
                              (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="staff-order-action-buttons">
                      <Typography.Title level={5} style={{ marginBottom: 12 }}>
                        Thao tác khác
                      </Typography.Title>
                      <div className="staff-action-buttons-group">
                        {(quote.data?.order.tableId || selectedTable?.id || preselectedTableId) && (
                          <Button
                            icon={<QrcodeOutlined />}
                            loading={tableQrLoading}
                            onClick={() => void handleOpenTableQrModal()}
                            className="staff-action-qr-btn"
                            style={{
                              borderColor: '#0975F7',
                              color: '#0975F7',
                              fontWeight: 600,
                            }}
                          >
                            Mã QR bàn
                          </Button>
                        )}
                        {!isNew ? (
                          <>
                            <Button
                              icon={<PrinterOutlined />}
                              disabled={printSettings.data?.allowProvisionalPrint === false}
                              onClick={() => void printProvisionalReceipt()}
                              className="staff-action-provisional-btn"
                            >
                              In tạm tính
                            </Button>
                            <Button
                              icon={<FileTextOutlined />}
                              disabled={printSettings.data?.allowProvisionalPrint === false}
                              onClick={() => setProvisionalBillOpen(true)}
                              className="staff-action-preview-btn"
                            >
                              Xem tạm tính
                            </Button>
                            {quote.data?.order.orderType === 'DINE_IN' ? (
                              <Button
                                icon={<SwapOutlined />}
                                onClick={() => setTransferOpen(true)}
                                className="staff-action-transfer-btn"
                              >
                                Chuyển bàn
                              </Button>
                            ) : null}
                            <Button
                              danger
                              icon={<StopOutlined />}
                              onClick={() => setCancelOpen(true)}
                              className="staff-action-cancel-btn"
                            >
                              Hủy đơn hàng
                            </Button>
                          </>
                        ) : (
                          <Alert
                            type="info"
                            showIcon
                            className="staff-action-alert"
                            description="In tạm tính, Chuyển bàn và Hủy đơn sẽ khả dụng sau khi lưu đơn."
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="staff-cart-billing">
                {cartTab === 'DETAILS' ? (
                  <button
                    type="button"
                    className="staff-cart-note"
                    onClick={() => setOrderNoteOpen(true)}
                  >
                    <span>
                      <strong>Ghi chú đơn hàng</strong>
                      {orderNote ? <small>{orderNote}</small> : null}
                    </span>
                    <EditOutlined />
                  </button>
                ) : null}
                <div className="staff-cart-summary">
                  <Typography.Title level={4}>Tổng tiền</Typography.Title>
                  <div>
                    <span>Tổng tiền hàng ({regularProductCount} món)</span>
                    <b>{formatMoney(regularProductGross)}</b>
                  </div>
                  {totalTimeGross > 0 ? (
                    <div>
                      <span>Tiền giờ</span>
                      <b>{formatMoney(totalTimeGross)}</b>
                    </div>
                  ) : null}
                  {combinedItemManualDiscountTotal > 0 ? (
                    <div>
                      <span>Giảm giá món</span>
                      <b className="staff-cart-discount-amount">
                        -{formatMoney(combinedItemManualDiscountTotal)}
                      </b>
                    </div>
                  ) : null}
                  <div
                    className="staff-promotion-trigger"
                    onClick={() => void openPromotionPicker()}
                  >
                    <span>
                      Khuyến mãi <EditOutlined />
                    </span>
                    <span className="staff-cart-discount-amount">
                      {totalDiscount > 0 ? `-${formatMoney(totalDiscount)}` : '0đ'}
                    </span>
                  </div>
                  {appliedPromotions.length > 0 ? (
                    <div
                      className="staff-applied-promotions-box"
                      onClick={() => void openPromotionPicker()}
                    >
                      {appliedPromotions.map((promotion) => (
                        <div key={promotion.id} className="staff-applied-promotion-row-item">
                          <span className="staff-applied-promotion-name">{promotion.name}</span>
                          <span className="staff-applied-promotion-amount">
                            {promotionBenefitCopy(promotion)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="staff-cart-total">
                    <span>Khách phải trả</span>
                    <b>{formatMoney(displayedTotal)}</b>
                  </div>
                </div>
              </div>
              <div className="staff-cart-actions">
                {isPaymentPending ? (
                  <>
                    <Button
                      size="large"
                      icon={<PlayCircleOutlined />}
                      loading={resuming}
                      onClick={() => setResumeModalOpen(true)}
                      className="staff-payment-resume-btn"
                    >
                      Tiếp tục chơi
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => {
                        navigateToPayment(quote.data!.order.id);
                      }}
                    >
                      Tiếp tục thanh toán
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : !hasUnsavedChanges
                      }
                      loading={saving}
                      onClick={isNew ? saveOrder : () => void saveAdditionalItems(false)}
                      className={emphasizeSaveButton ? 'staff-save-button--attention' : ''}
                    >
                      Lưu đơn
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      disabled={
                        isNew
                          ? orderType === 'TAKEAWAY' && draftLines.length === 0
                          : displayedItems.length === 0 && !quote.data?.time
                      }
                      loading={saving || stoppingTime}
                      onClick={() => {
                        void beginCheckout();
                      }}
                    >
                      Thanh toán
                    </Button>
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      <Modal
        open={Boolean(variantProduct)}
        title={`Chọn phiên bản · ${variantProduct?.productName ?? ''}`}
        width={480}
        footer={null}
        onCancel={() => setVariantProduct(null)}
      >
        <div className="staff-variant-picker">
          {variantProduct?.variants.map((variant) => {
            const quantityMilli = effectiveVariantQuantityMilli(
              variantProduct.productId,
              variant.id,
            );
            const wasCommitted = (quote.data?.items ?? []).some(
              (item) =>
                !item.promotionGift &&
                item.productId === variantProduct.productId &&
                item.variantId === variant.id,
            );
            return (
              <div className="staff-variant-picker__row" key={variant.id}>
                <button
                  type="button"
                  className="staff-variant-picker__info"
                  onClick={(event) => incrementVariantFromPicker(variantProduct, variant, event)}
                >
                  <span>
                    {variant.name}
                    {!wasCommitted && quantityMilli > 0 ? (
                      <small className="staff-variant-picker__new">New</small>
                    ) : null}
                  </span>
                  <b>
                    {variant.salePriceVnd === null
                      ? 'Nhập giá'
                      : `${formatMoney(variant.salePriceVnd)}${variantProduct.productType === 'WEIGHT' ? `/${getWeightUnit(variantProduct.unitName)}` : ''}`}
                  </b>
                </button>
                {variantProduct.productType === 'QUANTITY' ? (
                  <div className="staff-variant-stepper">
                    <button
                      type="button"
                      className="staff-variant-stepper__btn"
                      disabled={quantityMilli <= 0}
                      onClick={() => decrementVariant(variantProduct, variant)}
                    >
                      −
                    </button>
                    <span className="staff-variant-stepper__count">
                      {formatDecimal(quantityMilli / 1000)}
                    </span>
                    <button
                      type="button"
                      className="staff-variant-stepper__btn"
                      onClick={(event) =>
                        incrementVariantFromPicker(variantProduct, variant, event)
                      }
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <Button onClick={(event) => chooseVariant(variantProduct, variant, event)}>
                    Chọn
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
      <StaffPromptPriceModal
        target={promptTarget}
        onCancel={() => setPromptTarget(null)}
        onConfirm={(enteredPrice) => {
          if (!promptTarget) return;
          addDraftVariant(promptTarget.product, promptTarget.variant, enteredPrice);
          setPromptTarget(null);
        }}
      />
      <StaffTablePickerModal
        open={tableModalOpen}
        initialTableId={preselectedTableId}
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTableModalOpen(false)}
        onConfirm={(table) => {
          if (tableAction === 'SAVE') {
            void saveWithTable(table, false);
          } else if (tableAction === 'CHECKOUT') {
            void saveWithTable(table, true);
          } else {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set('tableId', table.id);
                return next;
              },
              { replace: true },
            );
            setOrderType('DINE_IN');
            setTableModalOpen(false);
          }
        }}
      />
      <Modal
        open={orderNoteOpen}
        title="Ghi chú đơn hàng"
        okText="Lưu ghi chú"
        cancelText="Hủy"
        onOk={saveOrderNote}
        onCancel={() => setOrderNoteOpen(false)}
      >
        <Input.TextArea
          rows={4}
          maxLength={500}
          showCount
          value={orderNote}
          onChange={(event) => setOrderNote(event.target.value)}
        />
      </Modal>
      <StaffItemDetailModal
        item={editingItem}
        catalog={catalog.data ?? []}
        onCancel={() => {
          if (editingItem?.discardOnCancel) {
            setDraftLines((lines) => lines.filter((line) => line.id !== editingItem.id));
          }
          setEditingItem(null);
        }}
        onSave={(updated, selectedVariant) => {
          if (!editingItem) return;
          if (editingItem.source === 'DRAFT') {
            setDraftLines((lines) =>
              lines.map((line) => {
                if (line.id !== editingItem.id) return line;
                return {
                  ...line,
                  variant:
                    selectedVariant && selectedVariant.id !== 'default'
                      ? selectedVariant
                      : line.variant,
                  quantityMilli: updated.quantityMilli,
                  note: updated.note.trim() || null,
                  discountType: updated.discountType,
                  discountInputValue: updated.discountInputValue,
                  discountReason: updated.discountReason,
                };
              }),
            );
            setEditingItem(null);
          } else {
            void updateExistingItem({
              id: editingItem.id,
              quantityMilli: updated.quantityMilli,
              variantId:
                selectedVariant && selectedVariant.id !== 'default'
                  ? selectedVariant.id
                  : (updated.variantId ?? null),
              discount:
                updated.discountType &&
                  updated.discountInputValue !== null &&
                  updated.discountInputValue !== undefined
                  ? {
                    type: updated.discountType,
                    value: updated.discountInputValue,
                    reason: updated.discountReason ?? '',
                  }
                  : null,
              note: updated.note.trim() || null,
            });
          }
        }}
        onDelete={() => {
          if (!editingItem) return;
          if (editingItem.discardOnCancel || editingItem.source === 'DRAFT') {
            setDraftLines((lines) => lines.filter((line) => line.id !== editingItem.id));
            setEditingItem(null);
            return;
          }
          setDeleteItemTarget({
            id: editingItem.id,
            name: editingItem.productName,
            source: editingItem.source,
          });
          setDeleteItemReason('');
          setDeleteItemModalOpen(true);
          setEditingItem(null);
        }}
      />
      <Modal
        open={timeDetailOpen && (Boolean(quote.data?.time) || timeRestoringDraft)}
        title={
          <div className="staff-time-modal-header">
            <ClockCircleOutlined />
            <span>
              {timeRestoringDraft && !quote.data?.time ? 'Khôi phục tính giờ' : 'Chi tiết tính giờ'}
            </span>
          </div>
        }
        width={540}
        centered
        destroyOnHidden
        className="staff-time-detail-dialog"
        onCancel={() => setTimeDetailOpen(false)}
        footer={
          quote.data?.time
            ? [
              quote.data.time.status === 'PAUSED' ? (
                <Button
                  key="resume"
                  type="primary"
                  style={{ background: '#16a34a', borderColor: '#16a34a' }}
                  icon={<PlayCircleOutlined />}
                  loading={saving}
                  onClick={handleResumeTimeRealtime}
                  className="staff-time-footer-btn"
                >
                  Mở lại bàn (Tiếp tục giờ)
                </Button>
              ) : quote.data.time.status === 'ENDED' || quote.data.time.endedAtMs ? (
                <Button
                  key="continue"
                  type="primary"
                  style={{ background: '#16a34a', borderColor: '#16a34a' }}
                  icon={<PlayCircleOutlined />}
                  loading={saving}
                  onClick={handleContinueRunningTime}
                  className="staff-time-footer-btn"
                >
                  Tiếp tục tính giờ (Bỏ dừng)
                </Button>
              ) : (
                <Button
                  key="pause"
                  danger
                  icon={<PauseCircleOutlined />}
                  loading={saving}
                  onClick={handlePauseTimeRealtime}
                  className="staff-time-footer-btn"
                >
                  Tạm dừng tính giờ
                </Button>
              ),
              <Button
                key="delete-time"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setDeleteTimeReason('');
                  setDeleteTimeModalOpen(true);
                }}
                className="staff-time-footer-btn"
              >
                Xóa tiền giờ
              </Button>,
              <Button
                key="save"
                type="primary"
                loading={saving}
                onClick={saveTimeRange}
                className="staff-time-footer-btn staff-time-footer-btn--primary"
              >
                Lưu thay đổi
              </Button>,
            ]
            : [
              <Button
                key="cancel"
                onClick={() => setTimeDetailOpen(false)}
                className="staff-time-footer-btn"
              >
                Đóng
              </Button>,
              <Button
                key="discard-restore"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setTimeRestoringDraft(false);
                  setTimeDetailOpen(false);
                }}
                className="staff-time-footer-btn"
              >
                Hủy khôi phục
              </Button>,
              <Button
                key="save"
                type="primary"
                loading={saving}
                onClick={saveTimeRange}
                className="staff-time-footer-btn staff-time-footer-btn--primary"
              >
                Lưu thay đổi
              </Button>,
            ]
        }
      >
        {quote.data?.time ? (
          <div className="staff-time-detail-modal">
            {/* Phân đoạn chuyển bàn nếu có */}
            {quote.data.time.tableSegments && quote.data.time.tableSegments.length > 1 ? (
              <section className="staff-time-detail-card staff-time-detail-card--segments">
                <Typography.Title level={5} className="staff-time-card-title">
                  <SwapOutlined /> Lịch sử chuyển bàn
                </Typography.Title>
                <div className="staff-time-segments-list">
                  {quote.data.time.tableSegments.map((tSeg, index) => (
                    <div
                      key={`${tSeg.tableId}-${tSeg.startedAtMs}-${index}`}
                      className="staff-time-segment-row"
                    >
                      <div className="staff-time-segment-info">
                        <div className="staff-time-segment-name-wrap">
                          <strong className="staff-time-segment-name">{tSeg.tableName}</strong>
                          <span className="staff-time-segment-rate-pill">
                            {formatMoney(tSeg.pricingConfig.basePriceVnd)}/giờ
                          </span>
                        </div>
                        <div className="staff-time-segment-timing">
                          <span>
                            {formatClock(tSeg.startedAtMs)}–
                            {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'}
                          </span>
                          <span className="staff-time-segment-dot">•</span>
                          <span>{formatElapsed(tSeg.elapsedSeconds)}</span>
                        </div>
                      </div>
                      <b className="staff-time-segment-amount">
                        {formatMoney(tSeg.amountAfterRoundingVnd)}
                      </b>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Thời gian sử dụng */}
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Thời gian sử dụng
              </Typography.Title>
              <div className="staff-time-range-fields">
                <div className="staff-time-field">
                  <span className="staff-time-field__label">Giờ vào</span>
                  <DatePicker
                    id="staff-time-started-at"
                    showTime
                    format="HH:mm:ss DD/MM/YYYY"
                    placeholder="Chọn giờ vào (24h)"
                    value={timeRangeDraft.startedAt}
                    onChange={(val) => setTimeRangeDraft((prev) => ({ ...prev, startedAt: val }))}
                    className="staff-time-field__datepicker"
                    popupClassName="staff-time-picker-popup"
                    style={{ width: '100%' }}
                    needConfirm={false}
                  />
                </div>
                <div className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ ra</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          endedAt: dayjs(),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <DatePicker
                    id="staff-time-ended-at"
                    showTime
                    format="HH:mm:ss DD/MM/YYYY"
                    placeholder="Chọn giờ ra (24h)"
                    value={timeRangeDraft.endedAt}
                    onChange={(val) => setTimeRangeDraft((prev) => ({ ...prev, endedAt: val }))}
                    className="staff-time-field__datepicker"
                    popupClassName="staff-time-picker-popup"
                    style={{ width: '100%' }}
                    needConfirm={false}
                    allowClear
                  />
                  <small className="staff-time-field__hint">
                    Điền giờ ra và bấm Lưu thay đổi để chốt/dừng giờ. Để trống để tính đến hiện tại.
                  </small>
                </div>
              </div>
              <div className="staff-time-detail-row staff-time-detail-row--highlight">
                <span>Tổng thời gian tính tiền</span>
                <b>{formatElapsed(liveElapsedSeconds)}</b>
              </div>
            </section>

            {/* Bảng giá áp dụng */}
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Bảng giá áp dụng
              </Typography.Title>
              <div className="staff-time-rates-list">
                {quote.data.time.pricingConfig?.firstPeriod?.enabled ? (
                  <div className="staff-time-detail-row">
                    <span>
                      <strong>Giá đầu tiên</strong>
                      <small>
                        {formatElapsed(
                          quote.data.time.pricingConfig.firstPeriod.durationSeconds ?? 0,
                        )}{' '}
                        đầu
                      </small>
                    </span>
                    <b>
                      {formatPriceRate(
                        quote.data.time.pricingConfig.firstPeriod.priceVnd ?? 0,
                        quote.data.time.pricingConfig.firstPeriod.durationSeconds ?? 3600,
                      )}
                    </b>
                  </div>
                ) : null}
                {quote.data.time.pricingConfig?.specialWindows?.map((window) => (
                  <div key={window.id} className="staff-time-detail-row">
                    <span>
                      <strong>{window.name}</strong>
                      <small>
                        {formatMinuteOfDay(window.startMinute)}–
                        {formatMinuteOfDay(window.endMinute)} ·{' '}
                        {formatWeekdays(window.weekdaysMask)}
                      </small>
                    </span>
                    <b>
                      {formatPriceRate(
                        window.priceVnd,
                        quote.data?.time?.pricingConfig?.baseDurationSeconds ?? 3600,
                      )}
                    </b>
                  </div>
                ))}
                {quote.data.time.pricingConfig ? (
                  <div className="staff-time-detail-row">
                    <span>
                      <strong>Giá thường</strong>
                      <small>
                        {quote.data.time.pricingConfig.calculationMode === 'ACTUAL_TIME'
                          ? 'Tính theo thời gian thực'
                          : 'Tính tròn theo block'}
                      </small>
                    </span>
                    <b>
                      {formatPriceRate(
                        quote.data.time.pricingConfig.basePriceVnd,
                        quote.data.time.pricingConfig.baseDurationSeconds,
                      )}
                    </b>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Thành tiền tạm tính */}
            <section className="staff-time-detail-card staff-time-detail-card--totals">
              <Typography.Title level={5} className="staff-time-card-title">
                Thành tiền tạm tính
              </Typography.Title>
              <div className="staff-time-rates-list">
                {(quote.data.time.segments ?? []).map((segment, index) => (
                  <div
                    key={`${segment.type}-${segment.startedAtMs}-${index}`}
                    className="staff-time-detail-row"
                  >
                    <span>
                      <strong>{segment.name}</strong>
                      <small>
                        {formatClock(segment.startedAtMs)}–{formatClock(segment.endedAtMs)} ·{' '}
                        {formatElapsed(segment.elapsedSeconds)}
                      </small>
                    </span>
                    <b>{formatMoney(segment.amountBeforeRoundingVnd)}</b>
                  </div>
                ))}
              </div>
              <div className="staff-time-detail-row staff-time-detail-row--total">
                <span>Tổng tiền giờ</span>
                <b>{formatMoney(quote.data.time.amountAfterRoundingVnd)}</b>
              </div>
            </section>
          </div>
        ) : timeRestoringDraft ? (
          <div className="staff-time-detail-modal">
            <section className="staff-time-detail-card">
              <Typography.Title level={5} className="staff-time-card-title">
                Thời gian sử dụng
              </Typography.Title>
              <div className="staff-time-range-fields">
                <div className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ vào</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          startedAt: dayjs(),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <DatePicker
                    id="staff-time-restore-started-at"
                    showTime
                    format="HH:mm:ss DD/MM/YYYY"
                    placeholder="Chọn giờ vào (24h)"
                    value={timeRangeDraft.startedAt}
                    onChange={(val) => setTimeRangeDraft((prev) => ({ ...prev, startedAt: val }))}
                    className="staff-time-field__datepicker"
                    style={{ width: '100%' }}
                    needConfirm={false}
                  />
                  <small className="staff-time-field__hint">
                    Chọn thời điểm bắt đầu tính giờ cho bàn/phòng.
                  </small>
                </div>
                <div className="staff-time-field">
                  <div className="staff-time-field__header">
                    <span className="staff-time-field__label">Giờ ra</span>
                    <button
                      type="button"
                      className="staff-time-now-btn"
                      onClick={() =>
                        setTimeRangeDraft((prev) => ({
                          ...prev,
                          endedAt: dayjs(),
                        }))
                      }
                    >
                      Lấy giờ hiện tại
                    </button>
                  </div>
                  <DatePicker
                    id="staff-time-restore-ended-at"
                    showTime
                    format="HH:mm:ss DD/MM/YYYY"
                    placeholder="Chọn giờ ra (24h)"
                    value={timeRangeDraft.endedAt}
                    onChange={(val) => setTimeRangeDraft((prev) => ({ ...prev, endedAt: val }))}
                    className="staff-time-field__datepicker"
                    style={{ width: '100%' }}
                    needConfirm={false}
                    allowClear
                  />
                  <small className="staff-time-field__hint">
                    Điền giờ ra nếu khách đã kết thúc. Để trống nếu bàn vẫn đang tiếp tục chơi.
                  </small>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </Modal>
      <StaffTableTransferModal
        open={transferOpen}
        currentTable={tables.data?.find((item) => item.id === quote.data?.order.tableId) ?? null}
        currentQuote={quote.data ?? null}
        tables={tables.data ?? []}
        confirmLoading={saving}
        onCancel={() => setTransferOpen(false)}
        onConfirm={(table) => transferTo(table)}
      />
      <Modal
        open={provisionalBillOpen && Boolean(quote.data)}
        title={
          <div className="staff-provisional-modal-header">
            <FileTextOutlined />
            <span>Xem trước phiếu tạm tính · {quote.data?.order.tableName || 'Đơn mang về'}</span>
          </div>
        }
        width={540}
        centered
        className="pos-receipt-preview-modal staff-provisional-modal"
        onCancel={() => setProvisionalBillOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setProvisionalBillOpen(false)}>
            Đóng
          </Button>,
        ]}
      >
        {provisionalBillOpen && quote.data ? (
          <div className="staff-provisional-bill-content">
            <Suspense fallback={<Skeleton active title={false} paragraph={{ rows: 10 }} />}>
              <ReceiptPreviewPaper
                options={{
                  data: buildPrintDataFromQuote(quote.data, 'PROVISIONAL'),
                  printSettings: printSettings.data,
                  storeInfo: {
                    storeName: staffContext.data?.storeName ?? null,
                    phone: staffContext.data?.storePhone ?? null,
                    address: staffContext.data?.storeAddress ?? null,
                    bankName: staffContext.data?.bankName ?? null,
                    bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
                    bankAccountName: staffContext.data?.bankAccountName ?? null,
                  },
                }}
              />
            </Suspense>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={deleteItemModalOpen && Boolean(deleteItemTarget)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <DeleteOutlined />
            <span>Xác nhận xóa mặt hàng</span>
          </div>
        }
        okText="Xác nhận xóa"
        okButtonProps={{ danger: true, disabled: !deleteItemReason.trim() }}
        confirmLoading={deletingItem}
        cancelText="Hủy"
        onOk={() => void handleDeleteItemConfirm()}
        onCancel={() => {
          if (deletingItem) return;
          setDeleteItemModalOpen(false);
          setDeleteItemTarget(null);
          setDeleteItemReason('');
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <div>
            Bạn có chắc chắn muốn xóa mặt hàng <strong>{deleteItemTarget?.name}</strong> khỏi đơn?
          </div>
          <div>
            <label
              htmlFor="delete-item-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do xóa <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {['Khách đổi ý', 'Nhập nhầm món', 'Hết hàng / Hỏng', 'Khác'].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  onClick={() => setDeleteItemReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: deleteItemReason === tag ? '#e6f4ff' : undefined,
                    borderColor: deleteItemReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="delete-item-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do xóa mặt hàng..."
              value={deleteItemReason}
              onChange={(e) => setDeleteItemReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTimeModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <DeleteOutlined />
            <span>Xác nhận xóa tiền giờ bàn</span>
          </div>
        }
        okText="Xác nhận xóa"
        okButtonProps={{ danger: true, disabled: !deleteTimeReason.trim() }}
        confirmLoading={deletingTime}
        cancelText="Hủy"
        onOk={() => void handleDeleteTimeConfirm()}
        onCancel={() => {
          if (deletingTime) return;
          setDeleteTimeModalOpen(false);
          setDeleteTimeReason('');
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Alert
            type="warning"
            showIcon
            description="Sau khi xóa, đơn hàng này sẽ không bị tính tiền giờ mặc định của bàn nữa."
          />
          <div>
            <label
              htmlFor="delete-time-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do xóa tiền giờ <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                'Miễn phí tiền giờ',
                'Bàn đặt trước không tính giờ',
                'Khách quen / Khuyến mãi',
                'Nhập nhầm bàn',
                'Khác',
              ].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  onClick={() => setDeleteTimeReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: deleteTimeReason === tag ? '#e6f4ff' : undefined,
                    borderColor: deleteTimeReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="delete-time-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do xóa tiền giờ của bàn..."
              value={deleteTimeReason}
              onChange={(e) => setDeleteTimeReason(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <CloseCircleOutlined />
            <span>Hủy đơn hàng</span>
          </div>
        }
        okText="Xác nhận hủy"
        confirmLoading={cancellingOrder}
        okButtonProps={{
          danger: true,
          disabled: !cancelReason.trim() || cancellingOrder,
          loading: cancellingOrder,
        }}
        cancelButtonProps={{ disabled: cancellingOrder }}
        cancelText="Quay lại"
        onOk={() => void cancelOrder()}
        onCancel={() => {
          if (!cancellingOrder) {
            setCancelOpen(false);
          }
        }}
        closable={!cancellingOrder}
        maskClosable={!cancellingOrder}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Alert
            type="error"
            showIcon
            description="Toàn bộ món đã chọn sẽ bị hủy và bàn sẽ được giải phóng."
          />
          <div>
            <label
              htmlFor="cancel-order-reason"
              style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}
            >
              Lý do hủy đơn <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {['Khách không dùng nữa', 'Bàn mở nhầm', 'Khách đổi bàn', 'Khác'].map((tag) => (
                <Button
                  key={tag}
                  size="small"
                  disabled={cancellingOrder}
                  onClick={() => setCancelReason(tag)}
                  style={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: cancelReason === tag ? '#e6f4ff' : undefined,
                    borderColor: cancelReason === tag ? '#1677ff' : undefined,
                  }}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <Input.TextArea
              id="cancel-order-reason"
              rows={3}
              maxLength={500}
              placeholder="Nhập lý do hủy đơn..."
              value={cancelReason}
              disabled={cancellingOrder}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={discardModalOpen}
        footer={null}
        closable={false}
        centered
        width={360}
        className="staff-confirm-discard-modal"
        onCancel={() => setDiscardModalOpen(false)}
      >
        <div className="staff-confirm-discard-content">
          <Typography.Title level={4} className="staff-confirm-discard-title">
            Dừng thêm sản phẩm
          </Typography.Title>
          <p className="staff-confirm-discard-desc">
            Hành động này sẽ xoá các sản phẩm bạn vừa chọn và không thể hoàn tác.
          </p>
          <div className="staff-confirm-discard-actions">
            <button
              type="button"
              className="staff-confirm-discard-btn staff-confirm-discard-btn--cancel"
              onClick={() => setDiscardModalOpen(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              className="staff-confirm-discard-btn staff-confirm-discard-btn--confirm"
              onClick={() => {
                setDiscardModalOpen(false);
                void queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
                void queryClient.invalidateQueries({ queryKey: ['pos-orders-list'] });
                void queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
                if (orderType === 'TAKEAWAY' || quote.data?.order.orderType === 'TAKEAWAY') {
                  navigate('/pos/areas?tab=takeaway', { state: { selectedArea: '__TAKEAWAY__' } });
                } else {
                  navigate('/pos/areas');
                }
              }}
            >
              Xác nhận
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={resumeModalOpen}
        title="Tiếp tục tính giờ?"
        okText="Tiếp tục chơi"
        cancelText="Hủy"
        okButtonProps={{ loading: resuming }}
        onCancel={() => !resuming && setResumeModalOpen(false)}
        onOk={() => void handleResumeCheckout()}
      >
        <div
          className="staff-confirm-resume-body"
          style={{ display: 'grid', gap: 10, paddingTop: 6 }}
        >
          <p style={{ margin: 0 }}>
            Bàn đã dừng tính giờ lúc{' '}
            <strong>
              {quote.data?.time?.endedAtMs ? formatClock(quote.data.time.endedAtMs) : 'trước đó'}
            </strong>
            .
          </p>
          <p style={{ margin: 0, color: '#475569' }}>
            Một khoảng tính giờ mới sẽ bắt đầu từ thời điểm xác nhận tiếp tục. Khoảng thời gian chờ
            thanh toán sẽ <strong>không được tính tiền</strong>.
          </p>
        </div>
      </Modal>
      <Modal
        open={mobileActionsOpen}
        title="Thao tác khác"
        footer={null}
        onCancel={() => setMobileActionsOpen(false)}
        className="staff-mobile-actions-modal"
        width={420}
      >
        <div className="staff-mobile-actions-body">
          <div className="staff-mobile-actions-info-card">
            <div className="staff-mobile-actions-info-row">
              <span>Mã đơn hàng:</span>
              <strong style={{ color: '#0975F7', fontFamily: 'monospace' }}>
                {isNew
                  ? 'Chưa tạo'
                  : quote.data?.order.displayCode ||
                  (orderId ? `D-${orderId.slice(0, 8).toUpperCase()}` : '—')}
              </strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Thời gian tạo:</span>
              <strong>{isNew ? 'Bây giờ' : formatDateTime(quote.data?.order.openedAt ?? 0)}</strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Thu ngân:</span>
              <strong>
                {isNew
                  ? (auth.actor?.displayName ?? 'Nhân viên')
                  : (quote.data?.order.openedByName ?? auth.actor?.displayName ?? 'Nhân viên')}
              </strong>
            </div>
            <div className="staff-mobile-actions-info-row">
              <span>Bàn / Khu vực:</span>
              <strong>
                {orderType === 'DINE_IN'
                  ? (quote.data?.order.tableName ?? selectedTable?.name ?? 'Chưa chọn bàn')
                  : 'Mang về'}
              </strong>
            </div>
          </div>

          <div className="staff-mobile-actions-buttons">
            {(quote.data?.order.tableId || selectedTable?.id || preselectedTableId) && (
              <Button
                size="large"
                block
                icon={<QrcodeOutlined />}
                loading={tableQrLoading}
                onClick={() => {
                  setMobileActionsOpen(false);
                  void handleOpenTableQrModal();
                }}
                style={{
                  borderColor: '#0975F7',
                  color: '#0975F7',
                  fontWeight: 600,
                }}
              >
                Mã QR bàn
              </Button>
            )}
            {!isNew && (
              <>
                <Button
                  size="large"
                  block
                  icon={<PrinterOutlined />}
                  disabled={printSettings.data?.allowProvisionalPrint === false}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    void printProvisionalReceipt();
                  }}
                >
                  In tạm tính
                </Button>
                <Button
                  size="large"
                  block
                  icon={<FileTextOutlined />}
                  disabled={printSettings.data?.allowProvisionalPrint === false}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setProvisionalBillOpen(true);
                  }}
                >
                  Xem tạm tính
                </Button>

                {quote.data?.order.orderType === 'DINE_IN' && (
                  <Button
                    size="large"
                    block
                    icon={<SwapOutlined />}
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setTransferOpen(true);
                    }}
                  >
                    Chuyển bàn
                  </Button>
                )}

                <Button
                  size="large"
                  block
                  icon={<UserOutlined />}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setCustomerModalOpen(true);
                  }}
                >
                  {customerName ? customerName : 'Chọn khách'}
                </Button>

                <Button
                  danger
                  size="large"
                  block
                  icon={<StopOutlined />}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setCancelOpen(true);
                  }}
                >
                  Hủy đơn
                </Button>
              </>
            )}

            {isNew && (
              <Button
                size="large"
                block
                icon={<CloseOutlined />}
                onClick={() => {
                  setMobileActionsOpen(false);
                  handleExit();
                }}
              >
                Thoát tạo đơn
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <Modal
        open={guestModalOpen}
        title="Số lượng khách"
        okText="Xác nhận"
        cancelText="Đóng"
        onOk={() => {
          void saveGuestCount(guestCount);
          setGuestModalOpen(false);
        }}
        onCancel={() => setGuestModalOpen(false)}
        width={360}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            margin: '16px 0',
          }}
        >
          {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
            <Button
              key={num}
              type={guestCount === num ? 'primary' : 'default'}
              size="large"
              onClick={() => {
                void saveGuestCount(num);
                setGuestModalOpen(false);
              }}
            >
              {num}
            </Button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
            Nhập số khách khác:
          </label>
          <InputNumber
            min={1}
            max={999}
            value={guestCount}
            onChange={(val) => val && setGuestCount(val)}
            style={{ width: '100%' }}
            size="large"
          />
        </div>
      </Modal>
      <Modal
        open={customerModalOpen}
        title="Khách hàng"
        footer={null}
        onCancel={() => setCustomerModalOpen(false)}
        width={680}
        className="pos-customer-selection-shell"
      >
        <PosCustomerSelector
          customerId={customerId}
          csrfToken={csrf}
          allowCreate
          reopenPickerOnDeselect={isMobile}
          onSelect={async (customer) => {
            await saveCustomerInfo(customer);
            if (customer) setCustomerModalOpen(false);
          }}
        />
      </Modal>

      {/* Modal hiển thị mã QR Order của bàn (Standee & Frame đẹp) */}
      {tableQrModalOpen && tableQrData ? (
        <Suspense
          fallback={
            <Modal
              open
              title={`Mã QR Order · ${tableQrData.tableName}`}
              footer={null}
              centered
              onCancel={() => setTableQrModalOpen(false)}
            >
              <div style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
                <Spin tip="Đang chuẩn bị mã QR..." />
              </div>
            </Modal>
          }
        >
          <TableQrModal
            open
            onClose={() => setTableQrModalOpen(false)}
            tableName={tableQrData.tableName}
            url={tableQrData.url}
            qrImageSrc={tableQrData.image}
            storeName={staffContext.data?.storeName ?? 'PRO POS'}
            orderCode={tableQrData.orderCode}
          />
        </Suspense>
      ) : null}

      {canManageCatalog && (
        <QuickAddProductModal
          open={quickAddOpen}
          auth={auth}
          onClose={() => setQuickAddOpen(false)}
          onCreated={(_productId, name) => {
            messageApi.success(`Đã thêm mặt hàng "${name}" thành công.`);
          }}
        />
      )}
    </div>
  );
}

function InvoicePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const messageApi = toast;
  const holder = null;
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const invoiceId = location.pathname.match(/^\/pos\/invoices\/([^/]+)$/u)?.[1];
  const invoice = useQuery({
    queryKey: ['pos-invoice', invoiceId],
    queryFn: () => apiRequest<InvoiceDetail>(`/api/v1/pos/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
  });
  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  if (invoice.isLoading) return <Spin fullscreen description="Đang tạo hóa đơn" />;
  if (invoice.isError || !invoice.data) {
    return (
      <Result
        status="error"
        title="Không tải được hóa đơn"
        extra={<Button onClick={() => navigate('/pos/areas')}>Về khu vực</Button>}
      />
    );
  }
  const data = invoice.data;
  const invoicePrintData = buildPrintDataFromInvoice(data);
  invoicePrintData.paymentAllocations = data.allocations.map((allocation) => ({
    method: allocation.method,
    amountVnd: allocation.amountVnd,
  }));
  invoicePrintData.paidAmountVnd = data.allocations
    .filter((allocation) => allocation.method !== 'DEBT')
    .reduce((sum, allocation) => sum + allocation.amountVnd, 0);
  invoicePrintData.debtAmountVnd = data.allocations
    .filter((allocation) => allocation.method === 'DEBT')
    .reduce((sum, allocation) => sum + allocation.amountVnd, 0);
  const invoicePrintOptions = {
    data: invoicePrintData,
    printSettings: printSettings.data,
    storeInfo: {
      storeName: staffContext.data?.storeName ?? null,
      phone: staffContext.data?.storePhone ?? null,
      address: staffContext.data?.storeAddress ?? null,
      bankName: staffContext.data?.bankName ?? null,
      bankAccountNumber: staffContext.data?.bankAccountNumber ?? null,
      bankAccountName: staffContext.data?.bankAccountName ?? null,
    },
  };
  return (
    <main className="staff-invoice-page">
      {holder}
      <Result
        status="success"
        title="Thanh toán thành công"
        subTitle={`Hóa đơn ${data.invoice.displayCode}`}
      />
      <section className="staff-invoice-sheet">
        <header>
          <div>
            <strong>Pro POS</strong>
            <span>{data.invoice.orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang về'}</span>
          </div>
          <div>
            <b>{data.invoice.displayCode}</b>
            <span>{formatDateTime(data.invoice.issuedAt)}</span>
          </div>
        </header>
        <div className="staff-invoice-lines">
          {data.lines.map((line) => {
            const printLine = invoicePrintData.lines.find((item) => item.id === line.id);
            const snapshot = JSON.parse(line.snapshotJson) as {
              productType?: 'QUANTITY' | 'WEIGHT' | 'TIME';
              unitName?: string | null;
              variantName?: string | null;
              note?: string | null;
              elapsedSeconds?: number;
              startedAtMs?: number;
              endedAtMs?: number | null;
              segments?: Array<{
                name: string;
                elapsedSeconds: number;
                amountBeforeRoundingVnd: number;
              }>;
              tableSegments?: Array<{
                tableName: string;
                startedAtMs: number;
                endedAtMs: number | null;
                elapsedSeconds: number;
                amountAfterRoundingVnd: number;
                pricingConfig?: { basePriceVnd: number };
              }>;
            };
            const isTimeLine = line.lineType === 'TIME' || snapshot.productType === 'TIME';
            const hasTableTransfer = Boolean(
              snapshot.tableSegments && snapshot.tableSegments.length > 1,
            );

            if (isTimeLine && hasTableTransfer) {
              return (
                <div key={line.id} className="is-time staff-invoice-transfer-block">
                  <div className="staff-invoice-transfer-header">
                    <div className="staff-invoice-transfer-title">
                      <strong>Tiền giờ (Chuyển bàn)</strong>
                      <small className="staff-invoice-transfer-subtitle">
                        {snapshot.tableSegments!.map((s) => s.tableName).join(' → ')}
                      </small>
                    </div>
                    <b className="staff-invoice-transfer-total">{formatMoney(line.lineTotal)}</b>
                  </div>

                  <div className="staff-invoice-transfer-segments-table">
                    {snapshot.tableSegments!.map((tSeg, idx) => (
                      <div key={idx} className="staff-invoice-transfer-row">
                        <div className="staff-invoice-transfer-row__left">
                          <span className="staff-invoice-transfer-row__dot">•</span>
                          <strong className="staff-invoice-transfer-row__name">
                            {tSeg.tableName}:
                          </strong>{' '}
                          <span className="staff-invoice-transfer-row__time">
                            {formatClock(tSeg.startedAtMs)}–
                            {tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'} (
                            {formatElapsed(tSeg.elapsedSeconds)}
                            {tSeg.pricingConfig
                              ? ` @ ${formatMoney(tSeg.pricingConfig.basePriceVnd)}/h`
                              : ''}
                            )
                          </span>
                        </div>
                        <span className="staff-invoice-transfer-row__amount">
                          {formatMoney(tSeg.amountAfterRoundingVnd)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="staff-invoice-transfer-summary-line">
                    <small>
                      Tổng thời gian: {formatElapsed(snapshot.elapsedSeconds ?? 0)} (
                      {formatDateTime(snapshot.startedAtMs!)} –{' '}
                      {formatDateTime(snapshot.endedAtMs ?? data.invoice.issuedAt)})
                    </small>
                  </div>
                </div>
              );
            }

            return (
              <div key={line.id} className={isTimeLine ? 'is-time' : ''}>
                <span>
                  <strong>{line.description}</strong>
                  {isTimeLine && snapshot.startedAtMs ? (
                    <small>
                      {formatClock(snapshot.startedAtMs)}–
                      {snapshot.endedAtMs ? formatClock(snapshot.endedAtMs) : 'hiện tại'} ·{' '}
                      {formatElapsed(snapshot.elapsedSeconds ?? 0)}
                    </small>
                  ) : (
                    <small>
                      {[snapshot.variantName, snapshot.note].filter(Boolean).join(' · ')}
                    </small>
                  )}
                  {snapshot.segments?.map((segment, index) => (
                    <small key={`${segment.name}-${index}`}>
                      {segment.name}: {formatElapsed(segment.elapsedSeconds)} ·{' '}
                      {formatMoney(segment.amountBeforeRoundingVnd)}
                    </small>
                  ))}
                  <ItemDiscountDetail
                    amount={printLine?.discountAmount ?? 0}
                    reason={printLine?.discountReason ?? null}
                  />
                </span>
                <span>
                  {line.lineType === 'PRODUCT' && snapshot.productType !== 'TIME'
                    ? formatItemQuantity(
                      snapshot.productType ?? 'QUANTITY',
                      line.quantityMilli,
                      snapshot.unitName ?? null,
                    )
                    : ''}
                </span>
                <b>{formatMoney(line.lineTotal)}</b>
              </div>
            );
          })}
        </div>
        <footer>
          <div>
            <span>Tạm tính trước khuyến mại</span>
            <b>{formatMoney(data.invoice.total + (invoicePrintData.promotionDiscount ?? 0))}</b>
          </div>
          {(invoicePrintData.promotions ?? []).map((promotion) => (
            <div key={promotion.name}>
              <span>Khuyến mại · {promotion.name}</span>
              <b>-{formatMoney(promotion.discountAmountVnd)}</b>
            </div>
          ))}
          <div className="staff-invoice-grand-total">
            <span>Khách đã trả</span>
            <b>{formatMoney(data.invoice.total)}</b>
          </div>
          <div>
            <span>Phương thức</span>
            <b>{data.payment.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}</b>
          </div>
          {data.payment.method === 'CASH' ? (
            <>
              <div>
                <span>Tiền khách đưa</span>
                <b>{formatMoney(data.payment.cashReceived ?? 0)}</b>
              </div>
              <div>
                <span>Tiền thừa</span>
                <b>{formatMoney(data.payment.cashChange ?? 0)}</b>
              </div>
            </>
          ) : null}
          {data.allocations.length > 0 ? (
            <>
              {data.allocations.map((allocation) => (
                <div key={allocation.id}>
                  <span>
                    {allocation.method === 'CASH'
                      ? 'Tiền mặt'
                      : allocation.method === 'DEBT'
                        ? 'Ghi công nợ'
                        : 'Chuyển khoản'}
                  </span>
                  <b className={allocation.method === 'DEBT' ? 'text-danger' : ''}>
                    {formatMoney(allocation.amountVnd)}
                  </b>
                </div>
              ))}
              <div>
                <span>Đã thanh toán</span>
                <b>
                  {formatMoney(
                    data.allocations
                      .filter((allocation) => allocation.method !== 'DEBT')
                      .reduce((sum, allocation) => sum + allocation.amountVnd, 0),
                  )}
                </b>
              </div>
              <div>
                <span>Còn ghi nợ</span>
                <b className="text-danger">
                  {formatMoney(
                    data.allocations
                      .filter((allocation) => allocation.method === 'DEBT')
                      .reduce((sum, allocation) => sum + allocation.amountVnd, 0),
                  )}
                </b>
              </div>
            </>
          ) : null}
        </footer>
      </section>
      <div className="staff-invoice-actions">
        <Button size="large" onClick={() => navigate('/pos/areas')}>
          Về khu vực
        </Button>
        <Button size="large" icon={<FileTextOutlined />} onClick={() => setPrintPreviewOpen(true)}>
          Xem trước hóa đơn
        </Button>
        <Button
          type="primary"
          size="large"
          icon={<PrinterOutlined />}
          loading={printing}
          onClick={async () => {
            setPrinting(true);
            try {
              const result = await printReceipt(invoicePrintOptions);
              if (result.success) messageApi.success('Đã gửi lệnh in hóa đơn!');
              else messageApi.error(result.message ?? 'Không thể in hóa đơn.');
            } finally {
              setPrinting(false);
            }
          }}
        >
          In hóa đơn
        </Button>
      </div>
      {printPreviewOpen ? (
        <Suspense
          fallback={
            <ReceiptPreviewLoadingModal
              title={`Xem trước hóa đơn ${data.invoice.displayCode}`}
              onCancel={() => setPrintPreviewOpen(false)}
            />
          }
        >
          <ReceiptPreviewModal
            open
            title={`Xem trước hóa đơn ${data.invoice.displayCode}`}
            options={invoicePrintOptions}
            onCancel={() => setPrintPreviewOpen(false)}
            previewOnly
          />
        </Suspense>
      ) : null}
    </main>
  );
}

type PaymentMethodType = 'CASH' | 'BANK_TRANSFER' | 'DEBT';

interface PaymentMethodItem {
  key: PaymentMethodType;
  label: string;
  backendMethod: 'CASH' | 'BANK_TRANSFER';
  allocationMethod?: 'CASH' | 'BANK_TRANSFER';
  icon: React.ReactNode;
}

const PAYMENT_METHODS: PaymentMethodItem[] = [
  {
    key: 'CASH',
    label: 'Tiền mặt',
    backendMethod: 'CASH',
    allocationMethod: 'CASH',
    icon: (
      <div
        style={{
          width: 36,
          height: 24,
          background: '#10b981',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        $
      </div>
    ),
  },
  {
    key: 'BANK_TRANSFER',
    label: 'Chuyển khoản',
    backendMethod: 'BANK_TRANSFER',
    allocationMethod: 'BANK_TRANSFER',
    icon: <CreditCardOutlined style={{ fontSize: 24, color: '#0877ee' }} />,
  },
  {
    key: 'DEBT',
    label: 'Ghi nợ - Thanh toán sau',
    backendMethod: 'BANK_TRANSFER',
    icon: <HistoryOutlined style={{ fontSize: 26, color: '#0877ee' }} />,
  },
];

function quickCashAmounts(totalVnd: number) {
  const amounts = new Set<number>([totalVnd]);
  for (const denomination of [1_000, 5_000, 10_000, 50_000, 100_000, 200_000]) {
    amounts.add((Math.floor(totalVnd / denomination) + 1) * denomination);
  }
  return [...amounts].filter((amount) => amount >= totalVnd).slice(0, 6);
}

function formatBankAccountOption(account: BankAccountDto): string {
  const bankTitle = account.bankName || account.bankCode || 'Ngân hàng';
  const holder = account.accountName ? ` · ${account.accountName}` : '';
  const num = account.accountNumber ? ` (${account.accountNumber})` : '';
  const def = account.isDefault ? ' · Mặc định' : '';
  return `${bankTitle}${holder}${num}${def}`;
}

function PaymentPage({
  orderId,
  auth,
  presentation = 'page',
}: {
  orderId: string;
  auth: AuthContextResponse;
  presentation?: 'page' | 'drawer';
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: realtimeStatus } = useRealtime();
  const messageApi = toast;
  const holder = null;
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodType>('CASH');
  const [isMultiMethod, setIsMultiMethod] = useState(false);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [cashApplied, setCashApplied] = useState(0);
  const [bankApplied, setBankApplied] = useState(0);
  const [debtAmount, setDebtAmount] = useState(0);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [paymentPreviewOpen, setPaymentPreviewOpen] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [prepareCheckoutError, setPrepareCheckoutError] = useState<string | null>(null);
  const [returningToOrder, setReturningToOrder] = useState(false);
  const returningToOrderRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentSuccessData, setPaymentSuccessData] = useState<{
    orderId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    invoiceCode: string;
    tableName: string;
    totalVnd: number;
    method: 'CASH' | 'BANK_TRANSFER';
    printStatus: 'PRINTING' | 'PRINTED' | 'FAILED' | 'SKIPPED';
    printError: string | null;
    receiptOptions: PosReceiptPrintOptions;
  } | null>(null);
  const [paymentSnapshotId, setPaymentSnapshotId] = useState<string | null>(() => {
    const cached = queryClient.getQueryData<PaymentSnapshotResult>([
      'pos-payment-snapshot',
      orderId,
    ]);
    return cached?.paymentSnapshotId ?? null;
  });
  const checkoutPreparationStartedRef = useRef(false);
  const completionInFlightRef = useRef(false);
  const csrf = auth.csrfToken!;

  const quote = useQuery(
    orderQuoteQueryOptions<OrderQuote>({
      orderId,
      enabled: true,
      realtimeStatus,
    }),
  );
  const [verifiedQuoteOrderId, setVerifiedQuoteOrderId] = useState<string | null>(null);
  useEffect(() => {
    if (
      quote.data?.order.id === orderId &&
      quote.isFetchedAfterMount &&
      quote.isSuccess &&
      !quote.isFetching &&
      !quote.isRefetchError
    ) {
      setVerifiedQuoteOrderId(orderId);
    }
  }, [
    orderId,
    quote.data?.order.id,
    quote.isFetchedAfterMount,
    quote.isFetching,
    quote.isRefetchError,
    quote.isSuccess,
  ]);
  const quoteReady = verifiedQuoteOrderId === orderId;

  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const staffContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const paymentSnapshotV2Enabled = staffContext.data?.capabilities?.posPaymentSnapshotV2 !== false;

  useEffect(() => {
    if (returningToOrderRef.current || !quoteReady || !quote.data || !paymentSnapshotId) return;
    const snapshot = queryClient.getQueryData<PaymentSnapshotResult>([
      'pos-payment-snapshot',
      orderId,
    ]);
    if (
      !snapshot ||
      snapshot.orderId !== orderId ||
      snapshot.orderVersion !== quote.data.order.version
    ) {
      queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', orderId] });
      setPaymentSnapshotId(null);
      checkoutPreparationStartedRef.current = false;
    }
  }, [orderId, paymentSnapshotId, queryClient, quote.data, quoteReady]);

  const handleCelebrationComplete = useCallback(async () => {
    if (completionInFlightRef.current) return;
    if (!paymentSuccessData) return;
    const completedOrder = {
      id: paymentSuccessData.orderId,
      orderType: paymentSuccessData.orderType,
    };
    completionInFlightRef.current = true;
    clearPaymentPageActive(completedOrder.id);
    queryClient.removeQueries({ queryKey: ['pos-order-quote', completedOrder.id] });
    queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', completedOrder.id] });
    try {
      // Checkout responses contain table summaries but not the complete active
      // order list. Fetch one authoritative overview before returning to Areas
      // so refetchOnMount=false cannot leave the paid order visible.
      const overview = await queryClient.fetchQuery<PosOverviewSnapshot>({
        queryKey: ['pos-overview'],
        queryFn: ({ signal }) =>
          apiRequest<PosOverviewSnapshot>('/api/v1/pos/overview', { signal }),
        staleTime: 0,
      });
      queryClient.setQueryData(['pos-tables'], overview.tables);
      queryClient.setQueryData(['pos-orders-list'], overview.orders);
    } catch {
      // Keep navigation responsive if the refresh fails; the query remains
      // invalidated for the next realtime/full-sync opportunity.
      void queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
    } finally {
      setPaymentSuccessData(null);
      completionInFlightRef.current = false;
    }
    if (completedOrder.orderType === 'TAKEAWAY') {
      navigate('/pos/areas?tab=takeaway', {
        replace: true,
        state: { selectedArea: '__TAKEAWAY__' },
      });
    } else {
      navigate('/pos/areas', { replace: true });
    }
  }, [navigate, paymentSuccessData, queryClient]);

  useEffect(() => {
    if (!paymentSuccessData || paymentSuccessData.printStatus === 'PRINTING') return undefined;
    const delayMs = paymentSuccessData.printStatus === 'FAILED' ? 3_500 : 1_800;
    const timer = window.setTimeout(() => void handleCelebrationComplete(), delayMs);
    return () => window.clearTimeout(timer);
  }, [handleCelebrationComplete, paymentSuccessData]);

  const resumeFrozenCheckout = async (frozenQuote: OrderQuote, notify: boolean) => {
    const sendResume = (expectedOrderVersion: number) =>
      jsonRequest<{
        orderId: string;
        status: 'OPEN';
        resumedAt: number;
        quote: OrderQuote;
      }>(
        `/api/v1/pos/orders/${frozenQuote.order.id}/resume-checkout`,
        { expectedOrderVersion },
        { headers: mutationHeaders(csrf) },
      );

    let result;
    try {
      result = await sendResume(frozenQuote.order.version);
    } catch (error) {
      // Another tab may have updated customer/order metadata while checkout was
      // pending. Reload the authoritative version and retry the resume once.
      const refreshed = await apiRequest<OrderQuote>(
        `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
      );
      if (!refreshed.time || refreshed.order.status === 'OPEN') {
        queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', orderId] });
        setPaymentSnapshotId(null);
        checkoutPreparationStartedRef.current = true;
        queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], refreshed);
        clearPaymentPageActive(frozenQuote.order.id);
        await queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
        await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
        if (notify) {
          if (refreshed.time?.status === 'RUNNING') {
            messageApi.success(`Đã tiếp tục tính giờ cho ${frozenQuote.order.tableName ?? 'bàn'}.`);
          } else {
            messageApi.info('Đã quay lại đơn. Thời gian vẫn đang dừng.');
          }
        }
        return refreshed.order.status === 'OPEN';
      }
      if (
        refreshed.order.status !== 'PAYMENT_PENDING' ||
        refreshed.order.version === frozenQuote.order.version
      ) {
        throw error;
      }
      result = await sendResume(refreshed.order.version);
    }

    queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', orderId] });
    setPaymentSnapshotId(null);
    checkoutPreparationStartedRef.current = true;
    queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], result.quote);
    const verifiedQuote = await apiRequest<OrderQuote>(
      `/api/v1/pos/orders/${frozenQuote.order.id}/quote`,
    );
    queryClient.setQueryData<OrderQuote>(['pos-order-quote', orderId], verifiedQuote);
    clearPaymentPageActive(frozenQuote.order.id);
    await queryClient.invalidateQueries({ queryKey: ['pos-overview'] });
    await queryClient.invalidateQueries({ queryKey: ['pos-tables'] });
    if (notify) {
      if (verifiedQuote.time?.status === 'RUNNING') {
        messageApi.success(`Đã tiếp tục tính giờ cho ${frozenQuote.order.tableName ?? 'bàn'}.`);
      } else {
        messageApi.info(
          `Đã quay lại đơn ${frozenQuote.order.tableName ?? ''}. Thời gian vẫn đang dừng.`,
        );
      }
    }
    return verifiedQuote.order.status === 'OPEN';
  };

  // Payment must always use a server-frozen quote. Several screens can navigate
  // directly to this route, so the payment page is the final safety boundary.
  useEffect(() => {
    const currentQuote = quote.data;
    if (returningToOrderRef.current || returningToOrder || !quoteReady || !staffContext.isSuccess) {
      return;
    }
    if (
      currentQuote?.order.status === 'PAYMENT_PENDING' &&
      (!paymentSnapshotV2Enabled || paymentSnapshotId)
    ) {
      checkoutPreparationStartedRef.current = true;
      return;
    }
    if (
      !currentQuote?.time ||
      (currentQuote.order.status !== 'OPEN' && currentQuote.order.status !== 'PAYMENT_PENDING') ||
      checkoutPreparationStartedRef.current
    ) {
      return;
    }
    // Nếu session đã ENDED thủ công (giờ ra được chốt) thì không cần stop-time nữa.
    // Trigger DB sẽ tôn trọng ended_at đã set, nhưng ta tránh gọi thừa để không
    // tạo state không nhất quán ở table_time_segments.
    if (currentQuote.time.status === 'ENDED') {
      checkoutPreparationStartedRef.current = true;
      // Vẫn cần chuyển order sang PAYMENT_PENDING - gọi stop-time an toàn vì trigger đã bảo vệ ended_at
    }

    checkoutPreparationStartedRef.current = true;
    setPreparingCheckout(true);
    setPrepareCheckoutError(null);

    void jsonRequest<PaymentSnapshotResult>(
      `/api/v1/pos/orders/${currentQuote.order.id}/stop-time`,
      { expectedOrderVersion: currentQuote.order.version },
      { headers: mutationHeaders(csrf) },
    )
      .then(async (result) => {
        if (returningToOrderRef.current) return;
        const cachedQuote = queryClient.getQueryData<OrderQuote>(['pos-order-quote', orderId]);
        if (!cachedQuote || result.quote.order.version >= cachedQuote.order.version) {
          queryClient.setQueryData(['pos-order-quote', orderId], result.quote);
        } else if (cachedQuote.order.status === 'OPEN') {
          clearPaymentPageActive(result.quote.order.id);
          navigate(`/pos/orders/${result.quote.order.id}`, { replace: true });
        }
        if (paymentSnapshotV2Enabled) {
          setPaymentSnapshotId(result.paymentSnapshotId);
          queryClient.setQueryData(['pos-payment-snapshot', orderId], result);
        }
        if (result.tableSummary) {
          queryClient.setQueryData<PosTable[]>(['pos-tables'], (cached) =>
            cached?.map((table) =>
              table.id === result.tableSummary!.id ? result.tableSummary! : table,
            ),
          );
        }
      })
      .catch(async (error) => {
        // A concurrent order update can make the version stale. Refetching lets
        // this effect retry with the authoritative version; other failures stay
        // visible and keep all payment controls blocked.
        const refreshed = await quote.refetch();
        if (refreshed.data?.order.version !== currentQuote.order.version) {
          checkoutPreparationStartedRef.current = false;
          return;
        }
        setPrepareCheckoutError(errorText(error));
      })
      .finally(() => setPreparingCheckout(false));
  }, [
    csrf,
    navigate,
    orderId,
    paymentSnapshotV2Enabled,
    paymentSnapshotId,
    prepareCheckoutError,
    preparingCheckout,
    queryClient,
    quote.data,
    quoteReady,
    returningToOrder,
    staffContext.isSuccess,
  ]);

  // Mặc định tiền khách đưa điền đúng giá tiền khách phải trả
  useEffect(() => {
    if (quoteReady && quote.data && cashReceived === null) {
      setCashReceived(quote.data.totalVnd);
    }
  }, [quote.data, quoteReady, cashReceived]);

  useEffect(() => {
    const bankAccounts = quote.data?.bankAccounts ?? [];
    if (
      selectedBankAccountId &&
      bankAccounts.some((account) => account.id === selectedBankAccountId)
    ) {
      return;
    }
    setSelectedBankAccountId(bankAccounts.find((account) => account.isDefault)?.id ?? null);
  }, [quote.data?.bankAccounts, selectedBankAccountId]);

  const totalVnd = quote.data?.totalVnd ?? 0;
  const bankAccounts = quote.data?.bankAccounts ?? [];
  const selectedBankAccount =
    bankAccounts.find((account) => account.id === selectedBankAccountId) ??
    bankAccounts.find((account) => account.isDefault) ??
    null;
  const currentMethodItem =
    PAYMENT_METHODS.find((m) => m.key === selectedMethod) ?? PAYMENT_METHODS[0]!;
  const isDebtMethod = selectedMethod === 'DEBT';

  const changeVnd = selectedMethod === 'CASH' ? Math.max(0, (cashReceived ?? 0) - totalVnd) : 0;
  const currentDebtAmount = isMultiMethod
    ? debtAmount
    : isDebtMethod
      ? Math.max(0, totalVnd - cashApplied)
      : 0;
  const currentReceiptAllocations: Array<{
    method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
    amountVnd: number;
  }> = isMultiMethod
      ? [
        ...(cashApplied > 0 ? [{ method: 'CASH' as const, amountVnd: cashApplied }] : []),
        ...(bankApplied > 0 ? [{ method: 'BANK_TRANSFER' as const, amountVnd: bankApplied }] : []),
        ...(debtAmount > 0 ? [{ method: 'DEBT' as const, amountVnd: debtAmount }] : []),
      ]
      : isDebtMethod
        ? [
          ...(cashApplied > 0 ? [{ method: 'CASH' as const, amountVnd: cashApplied }] : []),
          ...(currentDebtAmount > 0
            ? [{ method: 'DEBT' as const, amountVnd: currentDebtAmount }]
            : []),
        ]
        : [
          {
            method: selectedMethod === 'CASH' ? ('CASH' as const) : ('BANK_TRANSFER' as const),
            amountVnd: totalVnd,
          },
        ];
  const buildCurrentPaymentPrintData = () => {
    if (!quote.data) return null;
    const data = buildPrintDataFromQuote(
      quote.data,
      'PAYMENT',
      currentMethodItem.backendMethod,
      cashReceived,
    );
    data.paymentAllocations = currentReceiptAllocations;
    data.paidAmountVnd = Math.max(0, totalVnd - currentDebtAmount);
    data.debtAmountVnd = currentDebtAmount;
    return data;
  };
  const paymentPreviewOptions = quote.data
    ? {
      data: buildCurrentPaymentPrintData()!,
      printSettings: printSettings.data,
      storeInfo: {
        storeName: staffContext.data?.storeName ?? null,
        phone: staffContext.data?.storePhone ?? null,
        address: staffContext.data?.storeAddress ?? null,
        bankName: selectedBankAccount?.bankBin ?? staffContext.data?.bankName ?? null,
        bankAccountNumber:
          selectedBankAccount?.accountNumber ?? staffContext.data?.bankAccountNumber ?? null,
        bankAccountName:
          selectedBankAccount?.accountName ?? staffContext.data?.bankAccountName ?? null,
      },
    }
    : null;

  const resumeCheckoutForReturn = async () => {
    if (!quote.data?.time || quote.data.order.status !== 'PAYMENT_PENDING') return true;
    returningToOrderRef.current = true;
    checkoutPreparationStartedRef.current = true;
    setReturningToOrder(true);
    try {
      return await resumeFrozenCheckout(quote.data, true);
    } catch (error) {
      returningToOrderRef.current = false;
      messageApi.error(errorText(error));
      return false;
    } finally {
      setReturningToOrder(false);
    }
  };

  const handleBackToOrder = async () => {
    if (!quote.data || returningToOrder || preparingCheckout || submitting) return;
    const resumed = await resumeCheckoutForReturn();
    if (!resumed) return;
    navigate(`/pos/orders/${orderId}`, { replace: true });
  };

  const handleConfirmPayment = async (andPrint = false) => {
    if (!quote.data || submitting) return;
    if (quote.data.time && quote.data.order.status !== 'PAYMENT_PENDING') {
      messageApi.error('Chưa thể chốt số tiền. Vui lòng đợi hệ thống dừng giờ của bàn.');
      return;
    }
    if (
      !isMultiMethod &&
      selectedMethod === 'CASH' &&
      (cashReceived === null || cashReceived < totalVnd)
    ) {
      messageApi.warning('Số tiền khách đưa chưa đủ để thanh toán.');
      return;
    }
    if (isMultiMethod && cashApplied + bankApplied + debtAmount !== totalVnd) {
      messageApi.warning('Tổng tiền mặt, chuyển khoản và công nợ phải bằng giá trị hóa đơn.');
      return;
    }
    if (debtAmount > 0 && !quote.data.order.customerId) {
      messageApi.warning('Vui lòng chọn khách hàng trước khi ghi nợ.');
      return;
    }
    if (isDebtMethod && !quote.data.order.customerId) {
      messageApi.warning('Vui lòng chọn hoặc tạo khách hàng để ghi nợ.');
      return;
    }
    const requiresBankAccount = isMultiMethod
      ? bankApplied > 0
      : selectedMethod === 'BANK_TRANSFER';
    if (requiresBankAccount && !selectedBankAccount) {
      messageApi.warning('Cửa hàng chưa có tài khoản ngân hàng nhận chuyển khoản.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await jsonRequest<{
        invoiceId: string;
        displayCode?: string;
        tableSummaries?: PosTable[];
      }>(
        `/api/v1/pos/orders/${quote.data.order.id}/checkout`,
        {
          expectedOrderVersion: quote.data.order.version,
          ...(paymentSnapshotV2Enabled && paymentSnapshotId ? { paymentSnapshotId } : {}),
          ...(requiresBankAccount && selectedBankAccount
            ? { bankAccountId: selectedBankAccount.id }
            : {}),
          method: currentMethodItem.backendMethod,
          cashReceivedVnd: currentMethodItem.backendMethod === 'CASH' ? cashReceived : null,
          allocations: isMultiMethod
            ? [
              ...(cashApplied > 0
                ? [
                  {
                    method: 'CASH',
                    amountVnd: cashApplied,
                    tenderedVnd: cashReceived ?? cashApplied,
                  },
                ]
                : []),
              ...(bankApplied > 0 ? [{ method: 'BANK_TRANSFER', amountVnd: bankApplied }] : []),
            ]
            : isDebtMethod
              ? cashApplied > 0
                ? [{ method: 'CASH', amountVnd: cashApplied, tenderedVnd: cashApplied }]
                : []
              : currentMethodItem.allocationMethod && selectedMethod !== 'CASH'
                ? [{ method: currentMethodItem.allocationMethod, amountVnd: totalVnd }]
                : undefined,
          debtAmountVnd: isMultiMethod ? debtAmount : isDebtMethod ? totalVnd - cashApplied : 0,
        },
        { headers: mutationHeaders(csrf) },
      );
      if (result.tableSummaries && result.tableSummaries.length > 0) {
        queryClient.setQueryData<PosTable[]>(['pos-tables'], (cached) => {
          if (!cached) return result.tableSummaries;
          const changed = new Map(result.tableSummaries!.map((table) => [table.id, table]));
          return cached.map((table) => changed.get(table.id) ?? table);
        });
      }

      const resolvedCode =
        result.displayCode ||
        quote.data.order.displayCode ||
        (quote.data.order.id ? `HD-${quote.data.order.id.slice(0, 8).toUpperCase()}` : '—');
      const completedOrderId = quote.data.order.id;

      const printData = buildCurrentPaymentPrintData()!;
      printData.orderCode = resolvedCode;
      printData.invoiceCode = resolvedCode;
      const receiptOptions: PosReceiptPrintOptions = {
        data: printData,
        printSettings: printSettings.data,
        storeInfo: {
          storeName: staffContext.data?.storeName ?? null,
          phone: staffContext.data?.storePhone ?? null,
          address: staffContext.data?.storeAddress ?? null,
          bankName: selectedBankAccount?.bankBin ?? staffContext.data?.bankName ?? null,
          bankAccountNumber:
            selectedBankAccount?.accountNumber ?? staffContext.data?.bankAccountNumber ?? null,
          bankAccountName:
            selectedBankAccount?.accountName ?? staffContext.data?.bankAccountName ?? null,
        },
      };
      playPosSound('PAYMENT_SUCCESS', { dedupeKey: `payment:${resolvedCode}` });
      setPaymentSuccessData({
        orderId: quote.data.order.id,
        orderType: quote.data.order.orderType,
        invoiceCode: resolvedCode,
        tableName:
          quote.data.order.tableName ||
          (quote.data.order.orderType === 'TAKEAWAY' ? 'Mang về' : 'Đơn hàng'),
        totalVnd: quote.data.totalVnd,
        method: currentMethodItem.backendMethod,
        printStatus: andPrint ? 'PRINTING' : 'SKIPPED',
        printError: null,
        receiptOptions,
      });
      if (andPrint) {
        void printReceipt(receiptOptions)
          .then((printResult) => {
            setPaymentSuccessData((current) =>
              current?.orderId === completedOrderId
                ? {
                  ...current,
                  printStatus: printResult.success ? 'PRINTED' : 'FAILED',
                  printError: printResult.success
                    ? null
                    : (printResult.message ?? 'Không thể in hóa đơn.'),
                }
                : current,
            );
            if (!printResult.success) {
              messageApi.warning(
                `Thanh toán thành công nhưng chưa in được hóa đơn: ${printResult.message ?? 'Không rõ lỗi'}`,
              );
            }
          })
          .catch((error: unknown) => {
            setPaymentSuccessData((current) =>
              current?.orderId === completedOrderId
                ? {
                  ...current,
                  printStatus: 'FAILED',
                  printError: errorText(error),
                }
                : current,
            );
            messageApi.warning(
              `Thanh toán thành công nhưng chưa in được hóa đơn: ${errorText(error)}`,
            );
          });
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'ORDER_VERSION_CONFLICT' || error.code === 'PAYMENT_SNAPSHOT_INVALID')
      ) {
        queryClient.removeQueries({ queryKey: ['pos-payment-snapshot', orderId] });
        setPaymentSnapshotId(null);
        checkoutPreparationStartedRef.current = false;
        const refreshed = await quote.refetch();
        setPrepareCheckoutError(
          refreshed.data
            ? errorText(error)
            : `Không thể tải lại đơn hàng. ${errorText(refreshed.error)}`,
        );
      } else {
        messageApi.error(errorText(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const attachCustomerDuringCheckout = async (customer: CustomerSummary | null) => {
    if (!quote.data || customerSaving) return;
    setCustomerSaving(true);
    try {
      let currentQuote = quote.data;
      const shouldRefreeze = Boolean(
        currentQuote.time && currentQuote.order.status === 'PAYMENT_PENDING',
      );
      if (shouldRefreeze) {
        const resumed = await jsonRequest<{
          orderId: string;
          status: 'OPEN';
          resumedAt: number;
          quote: OrderQuote;
        }>(
          `/api/v1/pos/orders/${orderId}/resume-checkout`,
          { expectedOrderVersion: currentQuote.order.version },
          { headers: mutationHeaders(csrf) },
        );
        currentQuote = resumed.quote;
      }
      const updated = await jsonRequest<OrderMutationSnapshot>(
        `/api/v1/pos/orders/${orderId}/guest`,
        {
          expectedOrderVersion: currentQuote.order.version,
          guestCount: currentQuote.order.guestCount ?? 1,
          customerId: customer?.id ?? null,
        },
        { method: 'PATCH', headers: mutationHeaders(csrf) },
      );
      currentQuote = updated.quote;
      if (shouldRefreeze) {
        const stopped = await jsonRequest<PaymentSnapshotResult>(
          `/api/v1/pos/orders/${orderId}/stop-time`,
          { expectedOrderVersion: currentQuote.order.version },
          { headers: mutationHeaders(csrf) },
        );
        currentQuote = stopped.quote;
        setPaymentSnapshotId(stopped.paymentSnapshotId);
        queryClient.setQueryData(['pos-payment-snapshot', orderId], stopped);
      }
      queryClient.setQueryData(['pos-order-quote', orderId], currentQuote);
      setCustomerModalOpen(false);
      messageApi.success(customer ? 'Đã cập nhật khách hàng.' : 'Đã chuyển về khách lẻ.');
    } catch (error) {
      messageApi.error(errorText(error));
    } finally {
      setCustomerSaving(false);
    }
  };

  const selectPaymentMethod = (method: PaymentMethodType) => {
    if (method === 'BANK_TRANSFER' && bankAccounts.length === 0) {
      messageApi.warning('Cửa hàng chưa cấu hình tài khoản ngân hàng.');
      return;
    }
    setSelectedMethod(method);
    if (method === 'DEBT') {
      setCashApplied(0);
      setBankApplied(0);
      setDebtAmount(totalVnd);
    } else {
      setDebtAmount(0);
    }
    if (cashReceived === null || cashReceived === 0) setCashReceived(totalVnd);
  };

  const productItems = (quote.data?.items ?? []).filter((item) => !item.promotionGift);
  const productCount = productItems.reduce(
    (sum, item) => sum + (item.productType === 'WEIGHT' ? 1 : item.quantityMilli / 1000),
    0,
  );
  const productTotalVnd = productItems.reduce((sum, item) => sum + item.grossLineTotalVnd, 0);
  const timeTotalVnd = quote.data?.time?.amountAfterRoundingVnd ?? 0;
  const transferNote = quote.data
    ? `TT ${quote.data.order.tableName ? `${quote.data.order.tableName} ` : ''}${quote.data.order.displayCode || quote.data.order.id.slice(0, 6)}`.trim()
    : '';
  const transferQrUrl = selectedBankAccount
    ? `https://img.vietqr.io/image/${encodeURIComponent(selectedBankAccount.bankBin)}-${encodeURIComponent(selectedBankAccount.accountNumber)}-compact2.png?amount=${isMultiMethod ? bankApplied : totalVnd}&addInfo=${encodeURIComponent(transferNote)}&accountName=${encodeURIComponent(selectedBankAccount.accountName)}`
    : null;
  const primaryActionDisabled =
    !quote.data ||
    preparingCheckout ||
    (selectedMethod === 'CASH' && (cashReceived ?? 0) < totalVnd) ||
    (selectedMethod === 'BANK_TRANSFER' && !selectedBankAccount) ||
    (selectedMethod === 'DEBT' && !quote.data?.order.customerId) ||
    (isMultiMethod && cashApplied + bankApplied + debtAmount !== totalVnd) ||
    (isMultiMethod && bankApplied > 0 && !selectedBankAccount);
  const advancedPaymentMenu: MenuProps = {
    items: [
      { key: 'preview', label: 'Xem trước hóa đơn', icon: <FileTextOutlined /> },
      { key: 'pay-only', label: 'Thanh toán không in', icon: <CheckCircleOutlined /> },
      {
        key: 'multi',
        label: isMultiMethod ? 'Tắt thanh toán kết hợp' : 'Thanh toán kết hợp',
        icon: <SwapOutlined />,
      },
    ],
    onClick: ({ key }) => {
      if (key === 'preview') setPaymentPreviewOpen(true);
      if (key === 'pay-only') void handleConfirmPayment(false);
      if (key === 'multi') {
        const enabled = !isMultiMethod;
        setIsMultiMethod(enabled);
        if (enabled) {
          setCashApplied(totalVnd);
          setBankApplied(0);
          setDebtAmount(0);
        }
      }
    },
  };
  const [isDesktopOrTablet, setIsDesktopOrTablet] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => setIsDesktopOrTablet(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const methodDetail = isMultiMethod ? (
    <div className="payment-workspace__allocations">
      <label>
        Tiền mặt
        <InputNumber
          min={0}
          max={totalVnd}
          value={cashApplied}
          onChange={(value) => setCashApplied(Number(value ?? 0))}
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
          parser={(value) => Number((value ?? '').replaceAll(',', ''))}
          addonAfter="đ"
        />
      </label>
      <label>
        Chuyển khoản
        <InputNumber
          min={0}
          max={totalVnd}
          value={bankApplied}
          onChange={(value) => setBankApplied(Number(value ?? 0))}
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
          parser={(value) => Number((value ?? '').replaceAll(',', ''))}
          addonAfter="đ"
        />
      </label>
      <label>
        Ghi nợ
        <InputNumber
          min={0}
          max={totalVnd}
          value={debtAmount}
          onChange={(value) => setDebtAmount(Number(value ?? 0))}
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
          parser={(value) => Number((value ?? '').replaceAll(',', ''))}
          addonAfter="đ"
        />
      </label>
      {bankApplied > 0 ? (
        <Select<string>
          value={selectedBankAccount?.id ?? null}
          placeholder="Chọn tài khoản nhận tiền"
          options={bankAccounts.map((account) => ({
            value: account.id,
            label: formatBankAccountOption(account),
          }))}
          onChange={(value) => setSelectedBankAccountId(value)}
        />
      ) : null}
      <Typography.Text
        type={cashApplied + bankApplied + debtAmount === totalVnd ? 'success' : 'danger'}
      >
        Còn lại: {formatMoney(totalVnd - cashApplied - bankApplied - debtAmount)}
      </Typography.Text>
    </div>
  ) : selectedMethod === 'CASH' ? (
    <div className="payment-workspace__cash-detail">
      <div className="payment-workspace__amount-input">
        <span className="payment-workspace__currency">VND</span>
        <InputNumber
          min={0}
          value={cashReceived}
          onChange={(value) => setCashReceived(Number(value ?? 0))}
          formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
          parser={(value) => Number((value ?? '').replaceAll(',', ''))}
          controls={false}
        />
      </div>
      <div className="payment-workspace__quick-cash">
        {quickCashAmounts(totalVnd).map((amount) => (
          <button type="button" key={amount} onClick={() => setCashReceived(amount)}>
            {formatMoney(amount)}
          </button>
        ))}
      </div>
      <div className="payment-workspace__change">
        <span>Tiền thừa trả khách</span>
        <strong>{formatMoney(changeVnd)}</strong>
      </div>
    </div>
  ) : selectedMethod === 'BANK_TRANSFER' ? (
    <div className="payment-workspace__bank-detail">
      {bankAccounts.length > 1 ? (
        <div className="payment-bank-picker-row">
          <span className="payment-bank-picker-label">Tài khoản nhận:</span>
          <Select<string>
            value={selectedBankAccount?.id ?? null}
            placeholder="Chọn tài khoản nhận tiền"
            options={bankAccounts.map((account) => ({
              value: account.id,
              label: formatBankAccountOption(account),
            }))}
            onChange={(value) => setSelectedBankAccountId(value)}
            style={{ width: '100%' }}
          />
        </div>
      ) : null}

      {transferQrUrl && selectedBankAccount ? (
        <div className="payment-vietqr-card payment-vietqr-card--hero">
          <div className="payment-vietqr-bank-header">
            <span className="payment-vietqr-bank-tag">
              <BankOutlined style={{ color: '#0975f7', fontSize: 16 }} />{' '}
              {selectedBankAccount.bankName || selectedBankAccount.bankCode || 'Ngân hàng'}
              {selectedBankAccount.accountNumber ? ` · ${selectedBankAccount.accountNumber}` : ''}
              {selectedBankAccount.accountName ? ` · ${selectedBankAccount.accountName}` : ''}
            </span>
            {selectedBankAccount.isDefault ? (
              <Tag color="blue" style={{ margin: 0 }}>
                Mặc định
              </Tag>
            ) : null}
          </div>

          <div className="payment-vietqr-hero-wrap">
            <button
              type="button"
              className="payment-workspace__qr payment-workspace__qr--hero"
              onClick={() => setQrModalOpen(true)}
              title="Nhấn để phóng to mã QR"
            >
              <img src={transferQrUrl} alt="VietQR thanh toán" />
              <span className="payment-workspace__qr-overlay">
                <QrcodeOutlined /> Phóng to QR
              </span>
            </button>
            <div className="payment-vietqr-hero-caption">
              <div className="payment-vietqr-hero-amount">
                {formatMoney(isMultiMethod ? bankApplied : totalVnd)}
              </div>
              <div className="payment-vietqr-hint">
                Quét mã bằng ứng dụng ngân hàng bất kỳ để thanh toán
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Alert type="warning" showIcon message="Chưa có tài khoản ngân hàng nhận chuyển khoản." />
      )}
    </div>
  ) : (
    <div className="payment-workspace__debt-detail">
      <div>
        <span>Ghi công nợ</span>
        <strong>{formatMoney(totalVnd)}</strong>
      </div>
      {quote.data?.order.customerId ? (
        <Alert
          type="info"
          showIcon
          message={`Khoản nợ được ghi cho ${quote.data.order.customerName || 'khách hàng'}.`}
        />
      ) : (
        <Alert type="error" showIcon message="Vui lòng chọn khách hàng trước khi ghi nợ." />
      )}
    </div>
  );

  const paymentPage = (
    <div className="staff-payment-page">
      {holder}
      <header
        className={`staff-payment-page__header${presentation === 'drawer' ? ' is-drawer' : ''}`}
      >
        <Button
          type="text"
          icon={presentation === 'drawer' ? <CloseOutlined /> : <LeftOutlined />}
          loading={returningToOrder || preparingCheckout}
          disabled={returningToOrder || preparingCheckout || submitting}
          className="staff-payment-page__back-btn"
          aria-label="Quay lại đơn hàng"
          onClick={() => void handleBackToOrder()}
        />
        <div className="staff-payment-page__heading-copy">
          <Typography.Title level={4} className="staff-payment-page__title">
            {presentation === 'drawer' && quote.data
              ? `Thanh toán #${quote.data.order.displayCode || quote.data.order.id.slice(0, 6).toUpperCase()} · ${[quote.data.order.tableName, quote.data.order.areaName].filter(Boolean).join(' / ') || 'Đơn mang về'}`
              : 'Thanh toán'}
          </Typography.Title>
          {quote.data ? (
            <span>
              {presentation === 'drawer' ? (
                formatDateTime(Date.now())
              ) : (
                <>
                  #{quote.data.order.displayCode || quote.data.order.id.slice(0, 6).toUpperCase()}
                  {quote.data.order.tableName ? ` · ${quote.data.order.tableName}` : ''}
                  {quote.data.order.areaName ? ` / ${quote.data.order.areaName}` : ''}
                </>
              )}
            </span>
          ) : null}
        </div>
        {presentation === 'page' ? (
          <Button
            type="text"
            icon={<FileTextOutlined />}
            className="staff-payment-page__preview-btn"
            aria-label="Xem trước hóa đơn"
            onClick={() => setPaymentPreviewOpen(true)}
          />
        ) : (
          <div className="staff-payment-page__header-spacer" />
        )}
      </header>

      {!quoteReady ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          {!quote.isFetching && (quote.isError || quote.isRefetchError) ? (
            <Alert
              type="error"
              showIcon
              title="Không thể xác minh dữ liệu thanh toán"
              description={errorText(quote.error)}
              action={
                <Space>
                  <Button onClick={() => navigate('/pos/areas')}>Về khu vực</Button>
                  <Button type="primary" onClick={() => void quote.refetch()}>
                    Thử lại
                  </Button>
                </Space>
              }
            />
          ) : (
            <Spin size="large" description="Đang xác minh số tiền mới nhất..." />
          )}
        </div>
      ) : quote.isError || !quote.data ? (
        <div style={{ padding: 40 }}>
          <Alert
            type="error"
            showIcon
            title="Không thể tải thông tin đơn hàng"
            description="Đơn hàng không tồn tại hoặc đã kết thúc."
            action={
              <Button type="primary" onClick={() => navigate('/pos/areas')}>
                Về khu vực
              </Button>
            }
          />
        </div>
      ) : prepareCheckoutError ? (
        <div style={{ padding: 40 }}>
          <Alert
            type="error"
            showIcon
            title="Chưa thể chốt số tiền thanh toán"
            description={prepareCheckoutError}
            action={
              <Button
                type="primary"
                onClick={() => {
                  checkoutPreparationStartedRef.current = false;
                  setPrepareCheckoutError(null);
                  void quote.refetch();
                }}
              >
                Thử lại
              </Button>
            }
          />
        </div>
      ) : preparingCheckout || (quote.data.time && quote.data.order.status === 'OPEN') ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin size="large" description="Đang dừng giờ và chốt số tiền trên máy chủ..." />
        </div>
      ) : (
        <>
          {presentation === 'drawer' || isDesktopOrTablet ? (
            <div className="payment-workspace payment-workspace--desktop">
              <section className="payment-workspace__order-column">
                <button
                  type="button"
                  className="payment-workspace__customer"
                  onClick={() => setCustomerModalOpen(true)}
                >
                  <UserOutlined />
                  <span>
                    <strong>{quote.data.order.customerName || 'Khách lẻ'}</strong>
                    {quote.data.order.customerPhone ? (
                      <small>{quote.data.order.customerPhone}</small>
                    ) : null}
                  </span>
                  <RightOutlined />
                </button>
                <div className="payment-workspace__items">
                  <div className="payment-workspace__items-heading">
                    <span>Mặt hàng</span>
                    <span>SL</span>
                    <span>Thành tiền</span>
                  </div>
                  {productItems.map((item) => (
                    <div className="payment-workspace__item" key={item.id}>
                      <span>
                        <strong>{item.productName}</strong>
                        {item.variantName ? <small>{item.variantName}</small> : null}
                      </span>
                      <span>{formatDecimal(item.quantityMilli / 1000)}</span>
                      <b>{formatMoney(item.netLineTotalVnd)}</b>
                    </div>
                  ))}
                  {quote.data.time ? (
                    <div className="payment-workspace__time-row">
                      <ClockCircleOutlined />
                      <span>
                        <strong>Tiền giờ</strong>
                        <small>{formatElapsed(quote.data.time.elapsedSeconds)}</small>
                      </span>
                      <b>{formatMoney(timeTotalVnd)}</b>
                    </div>
                  ) : null}
                </div>
                <div className="payment-workspace__order-total">
                  <span>Tổng cộng</span>
                  <strong>{formatMoney(totalVnd)}</strong>
                </div>
              </section>

              <section className="payment-workspace__transaction-column">
                <div className="payment-workspace__section-heading">
                  <strong>Chi tiết giao dịch</strong>
                  <Dropdown menu={advancedPaymentMenu} trigger={['click']}>
                    <Button icon={<EllipsisOutlined />} aria-label="Tùy chọn thanh toán">
                      Tùy chọn
                    </Button>
                  </Dropdown>
                </div>
                <div className="payment-workspace__summary">
                  <div>
                    <span>Tổng tiền hàng</span>
                    <b>{formatMoney(productTotalVnd)}</b>
                  </div>
                  {timeTotalVnd > 0 ? (
                    <div>
                      <span>Tiền giờ</span>
                      <b>{formatMoney(timeTotalVnd)}</b>
                    </div>
                  ) : null}
                  <div>
                    <span>Giảm giá</span>
                    <b>-{formatMoney(quote.data.discountTotalVnd)}</b>
                  </div>
                  <div className="is-total">
                    <span>Khách cần trả</span>
                    <b>{formatMoney(totalVnd)}</b>
                  </div>
                </div>
                <div className="payment-workspace__method-radios is-horizontal">
                  {PAYMENT_METHODS.map((method) => {
                    const disabled = method.key === 'BANK_TRANSFER' && bankAccounts.length === 0;
                    return (
                      <button
                        type="button"
                        key={method.key}
                        disabled={disabled}
                        className={selectedMethod === method.key && !isMultiMethod ? 'is-active' : ''}
                        onClick={() => {
                          setIsMultiMethod(false);
                          selectPaymentMethod(method.key);
                        }}
                      >
                        <span className="payment-workspace__method-icon">{method.icon}</span>
                        <span className="payment-workspace__method-text">
                          <strong>{method.label}</strong>
                        </span>
                        <span className="payment-workspace__radio" />
                      </button>
                    );
                  })}
                </div>
                <div className="payment-workspace__method-detail">{methodDetail}</div>
                <div className="payment-workspace__submit">
                  <Button
                    type="primary"
                    size="large"
                    loading={submitting}
                    disabled={primaryActionDisabled}
                    icon={<PrinterOutlined />}
                    onClick={() => void handleConfirmPayment(true)}
                  >
                    {selectedMethod === 'DEBT' ? 'Ghi nợ & in' : 'Thanh toán & in'}:{' '}
                    {formatMoney(totalVnd)}
                  </Button>
                </div>
              </section>
            </div>
          ) : (
            <div className="payment-workspace payment-workspace--mobile">
              <main className="payment-mobile__content">
                <button
                  type="button"
                  className="payment-workspace__customer"
                  onClick={() => setCustomerModalOpen(true)}
                >
                  <span className="payment-mobile__customer-icon">
                    <UserOutlined />
                  </span>
                  <span>
                    <strong>{quote.data.order.customerName || 'Khách lẻ'}</strong>
                    {quote.data.order.customerPhone ? (
                      <small>{quote.data.order.customerPhone}</small>
                    ) : null}
                  </span>
                  <RightOutlined />
                </button>
                <div className="payment-mobile__summary">
                  <div>
                    <span>
                      Tổng tiền hàng <em>{formatDecimal(productCount)}</em>
                    </span>
                    <b>{formatMoney(productTotalVnd)}</b>
                  </div>
                  {timeTotalVnd > 0 ? (
                    <div>
                      <span>Tiền giờ</span>
                      <b>{formatMoney(timeTotalVnd)}</b>
                    </div>
                  ) : null}
                  <div>
                    <span>Giảm giá</span>
                    <b>{formatMoney(quote.data.discountTotalVnd)}</b>
                  </div>
                  <div className="is-total">
                    <span>Khách cần trả</span>
                    <b>{formatMoney(totalVnd)}</b>
                  </div>
                </div>
                <div className="payment-mobile__methods-title">
                  <strong>PHƯƠNG THỨC THANH TOÁN</strong>
                  <Dropdown menu={advancedPaymentMenu} trigger={['click']}>
                    <Button
                      size="small"
                      icon={<EllipsisOutlined />}
                      aria-label="Tùy chọn thanh toán"
                    >
                      Tùy chọn
                    </Button>
                  </Dropdown>
                </div>
                <div className="payment-workspace__method-radios is-vertical">
                  {PAYMENT_METHODS.map((method) => {
                    const active = selectedMethod === method.key && !isMultiMethod;
                    const disabled = method.key === 'BANK_TRANSFER' && bankAccounts.length === 0;
                    return (
                      <div
                        className={`payment-mobile__method${active ? ' is-active' : ''}`}
                        key={method.key}
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setIsMultiMethod(false);
                            selectPaymentMethod(method.key);
                          }}
                        >
                          <span className="payment-workspace__radio" />
                          <strong>{method.label}</strong>
                        </button>
                        {active ? (
                          <div className="payment-mobile__method-detail">{methodDetail}</div>
                        ) : null}
                      </div>
                    );
                  })}
                  {isMultiMethod ? (
                    <div className="payment-mobile__method is-active">
                      <button type="button">
                        <span className="payment-workspace__radio" />
                        <strong>Kết hợp</strong>
                      </button>
                      <div className="payment-mobile__method-detail">{methodDetail}</div>
                    </div>
                  ) : null}
                </div>
              </main>
              <footer className="payment-mobile__footer">
                <Button
                  type="primary"
                  size="large"
                  loading={submitting}
                  disabled={primaryActionDisabled}
                  icon={<PrinterOutlined />}
                  onClick={() => void handleConfirmPayment(true)}
                >
                  {selectedMethod === 'DEBT' && !isMultiMethod ? 'Ghi nợ & in' : 'Thanh toán & in'}:{' '}
                  {formatMoney(totalVnd)}
                </Button>
              </footer>
            </div>
          )}
        </>
      )}

      <Modal
        open={qrModalOpen}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <QrcodeOutlined style={{ color: '#0877ee', fontSize: 18 }} />
            <span>Mã QR Chuyển khoản - {quote.data?.order.tableName || 'Đơn hàng'}</span>
          </div>
        }
        footer={[
          <Button key="close" type="primary" size="large" onClick={() => setQrModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        onCancel={() => setQrModalOpen(false)}
        centered
        width={420}
      >
        {(() => {
          if (!transferQrUrl) return null;
          return (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <img
                src={transferQrUrl}
                alt="VietQR Full"
                style={{
                  maxWidth: '100%',
                  width: '100%',
                  borderRadius: 12,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                  border: '1px solid #e2e8f0',
                }}
              />
              <div style={{ marginTop: 14, fontSize: 18, fontWeight: 800, color: '#0877ee' }}>
                {formatMoney(totalVnd)}
              </div>
              <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
                Nội dung CK: <strong style={{ color: '#d97706' }}>{transferNote}</strong>
              </div>
            </div>
          );
        })()}
      </Modal>
      {paymentPreviewOpen ? (
        <Suspense
          fallback={
            <ReceiptPreviewLoadingModal
              title="Xem trước hóa đơn thanh toán"
              onCancel={() => setPaymentPreviewOpen(false)}
            />
          }
        >
          <ReceiptPreviewModal
            open
            title="Xem trước hóa đơn thanh toán"
            options={paymentPreviewOptions}
            onCancel={() => setPaymentPreviewOpen(false)}
            previewOnly
          />
        </Suspense>
      ) : null}

      <Modal
        open={customerModalOpen}
        title="Chọn khách hàng"
        footer={null}
        onCancel={() => !customerSaving && setCustomerModalOpen(false)}
        width={680}
        className="pos-customer-selection-shell"
      >
        <PosCustomerSelector
          customerId={quote.data?.order.customerId ?? null}
          csrfToken={csrf}
          allowCreate
          reopenPickerOnDeselect
          onSelect={(customer) => attachCustomerDuringCheckout(customer)}
        />
      </Modal>

      {paymentSuccessData ? (
        <div className="pos-payment-celebration" role="alert" aria-live="assertive">
          <div className="pos-payment-celebration__card">
            <div className="pos-payment-celebration__icon-wrap">
              <div className="pos-payment-celebration__ring" />
              <svg className="pos-payment-celebration__checkmark" viewBox="0 0 52 52">
                <circle
                  className="pos-payment-celebration__circle"
                  cx="26"
                  cy="26"
                  r="24"
                  fill="none"
                />
                <path
                  className="pos-payment-celebration__check"
                  fill="none"
                  d="M14.1 27.2l7.1 7.2 16.7-16.8"
                />
              </svg>
            </div>

            <h3 className="pos-payment-celebration__title">Thanh toán thành công!</h3>
            <div className="pos-payment-celebration__amount">
              {formatMoney(paymentSuccessData.totalVnd)}
            </div>

            <div className="pos-payment-celebration__details">
              <div className="pos-payment-celebration__row">
                <span>Bàn / Đơn</span>
                <strong>{paymentSuccessData.tableName}</strong>
              </div>
              <div className="pos-payment-celebration__row">
                <span>Mã hóa đơn</span>
                <strong>{paymentSuccessData.invoiceCode}</strong>
              </div>
              <div className="pos-payment-celebration__row">
                <span>Phương thức</span>
                <strong>
                  {paymentSuccessData.method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt'}
                </strong>
              </div>
              <div className="pos-payment-celebration__row">
                <span>Hóa đơn</span>
                <span
                  className={`pos-payment-celebration__print-badge is-${paymentSuccessData.printStatus.toLowerCase()}`}
                  title={paymentSuccessData.printError ?? undefined}
                >
                  {paymentSuccessData.printStatus === 'PRINTING'
                    ? 'Đang in tự động...'
                    : paymentSuccessData.printStatus === 'PRINTED'
                      ? 'Đã in'
                      : paymentSuccessData.printStatus === 'FAILED'
                        ? 'Chưa in được'
                        : 'Chưa in'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
  return presentation === 'drawer' ? (
    <Drawer
      open
      placement="right"
      width={isDesktopOrTablet ? 'clamp(820px, 70vw, 1160px)' : '100%'}
      closable={false}
      maskClosable={!returningToOrder && !preparingCheckout && !submitting}
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
      className="staff-payment-drawer"
      onClose={() => void handleBackToOrder()}
    >
      {paymentPage}
    </Drawer>
  ) : (
    paymentPage
  );
}

export function StaffPosPortalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [onboardingRestartToken, setOnboardingRestartToken] = useState(0);
  const [desktopPayment, setDesktopPayment] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth >= 1200,
  );
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
    staleTime: 10 * 60_000,
    refetchOnMount: false,
  });
  const posContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<StaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1200px)');
    const sync = () => setDesktopPayment(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const routePaymentOrderId =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/payment')
      ? location.pathname.split('/')[3]
      : undefined;
  const routeDesktopCheckoutOrderId =
    desktopPayment &&
      /^\/pos\/orders\/[^/]+$/u.test(location.pathname) &&
      new URLSearchParams(location.search).get('checkout') === '1'
      ? location.pathname.split('/')[3]
      : undefined;
  const checkoutActive = Boolean(routePaymentOrderId || routeDesktopCheckoutOrderId);
  const checkoutActiveOrderId = routePaymentOrderId ?? routeDesktopCheckoutOrderId;
  const previousCheckoutRef = useRef<{
    active: boolean;
    orderId: string | undefined;
  }>({ active: false, orderId: undefined });

  useEffect(() => {
    const previous = previousCheckoutRef.current;
    if (
      previous.active &&
      previous.orderId &&
      (!checkoutActive || previous.orderId !== checkoutActiveOrderId)
    ) {
      const currentQuote = queryClient.getQueryData<OrderQuote>([
        'pos-order-quote',
        previous.orderId,
      ]);
      if (currentQuote?.time && currentQuote.order.status === 'PAYMENT_PENDING') {
        armPaymentReturn(previous.orderId, currentQuote.order.version);
      }
    }
    previousCheckoutRef.current = { active: checkoutActive, orderId: checkoutActiveOrderId };
  }, [checkoutActive, checkoutActiveOrderId, queryClient]);
  if (auth.isLoading) return <PosAppSplash message="Đang nạp dữ liệu POS..." />;
  if (auth.isError || auth.data?.actor?.kind !== 'EMPLOYEE') {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }

  const isInvoiceDetail = location.pathname.startsWith('/pos/invoices/');
  const isInvoicesList =
    location.pathname === '/pos/invoices' || location.pathname.startsWith('/pos/invoices?');
  const isCatalogNewProduct = location.pathname === '/pos/catalog/products/new';
  const isCatalogEditProduct =
    location.pathname.startsWith('/pos/catalog/products/') && !isCatalogNewProduct;
  const isCatalogCategoryDetail =
    location.pathname.startsWith('/pos/catalog/categories/') &&
    location.pathname !== '/pos/catalog/categories';
  const isCatalogCategories = location.pathname === '/pos/catalog/categories';
  const isCatalogList =
    location.pathname === '/pos/catalog' ||
    location.pathname === '/pos/catalog/' ||
    location.pathname === '/pos/catalog/products' ||
    location.pathname.startsWith('/pos/catalog/products?');
  const isCatalog =
    isCatalogNewProduct ||
    isCatalogEditProduct ||
    isCatalogCategoryDetail ||
    isCatalogCategories ||
    isCatalogList;
  const isPrinterSettings = location.pathname === '/pos/printers';

  // Customer routes
  const isCustomerNew = location.pathname === '/pos/customers/new';
  const isCustomerEdit =
    location.pathname.startsWith('/pos/customers/') &&
    location.pathname.endsWith('/edit') &&
    !location.pathname.includes('/groups');
  const isCustomerGroupNew = location.pathname === '/pos/customers/groups/new';
  const isCustomerGroupEdit =
    location.pathname.startsWith('/pos/customers/groups/') &&
    location.pathname !== '/pos/customers/groups' &&
    !isCustomerGroupNew;
  const isCustomerGroups = location.pathname === '/pos/customers/groups';
  const isCustomerDetail =
    location.pathname.startsWith('/pos/customers/') &&
    !isCustomerNew &&
    !isCustomerEdit &&
    !location.pathname.includes('/groups');
  const isCustomerList =
    location.pathname === '/pos/customers' ||
    location.pathname === '/pos/customers/' ||
    location.pathname.startsWith('/pos/customers?');
  const isCustomer =
    isCustomerNew ||
    isCustomerEdit ||
    isCustomerGroupNew ||
    isCustomerGroupEdit ||
    isCustomerGroups ||
    isCustomerDetail ||
    isCustomerList;

  // Staff routes
  const isStaffNew = location.pathname === '/pos/staff/new';
  const isStaffEdit = location.pathname.startsWith('/pos/staff/') && !isStaffNew;
  const isStaffList =
    location.pathname === '/pos/staff' ||
    location.pathname === '/pos/staff/' ||
    location.pathname.startsWith('/pos/staff?');
  const isStaff = isStaffNew || isStaffEdit || isStaffList;

  const isDetail =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/detail');
  const isPayment =
    location.pathname.startsWith('/pos/orders/') && location.pathname.endsWith('/payment');
  const isEditor = location.pathname.startsWith('/pos/orders/') && !isPayment && !isDetail;
  const isFullScreen =
    isInvoiceDetail ||
    isPayment ||
    isEditor ||
    isDetail ||
    isCatalog ||
    isPrinterSettings ||
    isCustomer ||
    isStaff;
  const active = location.pathname.startsWith('/pos/qr-order')
    ? 'qr'
    : location.pathname.startsWith('/pos/more') ||
      isInvoicesList ||
      isCatalog ||
      isPrinterSettings ||
      isCustomer ||
      isStaff
      ? 'more'
      : 'areas';

  const detailOrderId = isDetail ? location.pathname.split('/')[3] : undefined;
  const paymentOrderId = isPayment ? location.pathname.split('/')[3] : undefined;

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND, borderRadius: 8 } }}>
      <RealtimeProvider>
        <PosNotificationsProvider>
          <div className={`staff-pos-shell${isFullScreen ? ' staff-pos-shell--editor' : ''}`}>
            <PushNotificationControl csrfToken={auth.data.csrfToken} autoPrompt />
            <StaffOnboarding auth={auth.data} restartToken={onboardingRestartToken} />
            {!isFullScreen ? (
              <StaffHeader
                context={auth.data}
                onOpenNotifications={() => setNotificationCenterOpen(true)}
              />
            ) : null}
            <div className="staff-pos-main">
              {isPrinterSettings ? (
                renderLazyPosRoute(
                  <StaffPrinterSettingsPage
                    csrfToken={auth.data.csrfToken}
                    storeName={posContext.data?.storeName ?? 'PRO POS'}
                    onBack={() => navigate('/pos/more')}
                  />,
                )
              ) : isInvoiceDetail ? (
                <InvoicePage />
              ) : isInvoicesList ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerInvoicesPage
                        apiPrefix="/api/v1/pos/invoices"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/more')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerNew ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerFormPage
                        baseRoute="/pos/customers"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/customers')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerEdit ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerFormPage
                        customerId={location.pathname.split('/')[3]!}
                        baseRoute="/pos/customers"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() =>
                          navigate(`/pos/customers/${location.pathname.split('/')[3]!}`)
                        }
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerGroupNew ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerGroupFormPage
                        baseRoute="/pos/customers/groups"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/customers/groups')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerGroupEdit ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerGroupFormPage
                        groupId={location.pathname.split('/')[4]!}
                        baseRoute="/pos/customers/groups"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/customers/groups')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerGroups ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerGroupListPage
                        baseRoute="/pos/customers/groups"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/customers')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerDetail ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerDetailPage
                        customerId={location.pathname.split('/')[3]!}
                        baseRoute="/pos/customers"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/customers')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCustomerList ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCustomerListPage
                        baseRoute="/pos/customers"
                        apiPrefix="/api/v1/pos/customers"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/more')}
                      />,
                    )}
                  </div>
                </div>
              ) : isStaffNew ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerEmployeeFormPage
                        baseRoute="/pos/staff"
                        apiPrefix="/api/v1/pos/staff"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/staff')}
                      />,
                    )}
                  </div>
                </div>
              ) : isStaffEdit ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerEmployeeFormPage
                        userId={location.pathname.split('/').at(-1)!}
                        baseRoute="/pos/staff"
                        apiPrefix="/api/v1/pos/staff"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/staff')}
                      />,
                    )}
                  </div>
                </div>
              ) : isStaffList ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerStaffListPage
                        baseRoute="/pos/staff"
                        apiPrefix="/api/v1/pos/staff"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/more')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCatalogNewProduct ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerProductFormPage
                        baseRoute="/pos/catalog"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/catalog/products')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCatalogEditProduct ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerProductFormPage
                        productId={location.pathname.split('/').at(-1)!}
                        baseRoute="/pos/catalog"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/catalog/products')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCatalogCategoryDetail ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCategoryDetailPage
                        categoryId={location.pathname.split('/').at(-1)!}
                        baseRoute="/pos/catalog"
                        onBack={() => navigate('/pos/catalog/categories')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCatalogCategories ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerCategoryListPage
                        baseRoute="/pos/catalog"
                        onBack={() => navigate('/pos/catalog/products')}
                      />,
                    )}
                  </div>
                </div>
              ) : isCatalogList ? (
                <div className="staff-invoices-shell">
                  <div className="staff-invoices-container">
                    {renderLazyPosRoute(
                      <OwnerProductListPage
                        baseRoute="/pos/catalog"
                        userPermissions={posContext.data?.permissions}
                        isOwner={false}
                        onBack={() => navigate('/pos/more')}
                      />,
                    )}
                  </div>
                </div>
              ) : isDetail && detailOrderId ? (
                <OrderDetailPage orderId={detailOrderId} />
              ) : isPayment && paymentOrderId ? (
                desktopPayment ? (
                  <>
                    <OrderEditor
                      auth={auth.data}
                      orderIdOverride={paymentOrderId}
                      suppressPaymentAutoResume
                    />
                    <PaymentPage orderId={paymentOrderId} auth={auth.data} presentation="drawer" />
                  </>
                ) : (
                  <PaymentPage orderId={paymentOrderId} auth={auth.data} presentation="page" />
                )
              ) : isEditor ? (
                <OrderEditor auth={auth.data} />
              ) : active === 'qr' ? (
                <QrOrderPage />
              ) : active === 'more' ? (
                <MorePage
                  auth={auth.data}
                  onStartOnboarding={() => setOnboardingRestartToken((value) => value + 1)}
                />
              ) : (
                <AreasPage />
              )}
            </div>
            {!isFullScreen ? <StaffBottomNav active={active} /> : null}
            <StaffNotificationCenter
              open={notificationCenterOpen}
              onClose={() => setNotificationCenterOpen(false)}
            />
          </div>
        </PosNotificationsProvider>
      </RealtimeProvider>
    </ConfigProvider>
  );
}
