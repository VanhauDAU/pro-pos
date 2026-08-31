import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  FileExcelOutlined,
  InfoCircleOutlined,
  PrinterOutlined,
  ReloadOutlined,
  RightOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  InputNumber,
  Modal,
  Radio,
  Select,
  Skeleton,
  Tooltip,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

import { apiRequest, jsonRequest } from '@client/lib/api';
import type { AuthContextResponse } from '@contracts/auth';
import type {
  ProductReportCancelledRow,
  ProductReportCategoryProductItem,
  ProductReportCompareWith,
  ProductReportDetailResponseDto,
  ProductReportResponseDto,
  ProductReportTimeRange,
  ProductReportTopSellingRow,
  ProductReportType,
} from '@contracts/reports';

type SupportedReportType = Extract<
  ProductReportType,
  'CATEGORY' | 'TOP_SELLING' | 'CANCELLED_ITEMS'
>;

type SelectedProduct = {
  productId: string;
  productName: string;
};

const REPORT_OPTIONS: Array<{ value: SupportedReportType; label: string }> = [
  { value: 'CATEGORY', label: 'Theo danh mục' },
  { value: 'TOP_SELLING', label: 'Mặt hàng bán chạy' },
  { value: 'CANCELLED_ITEMS', label: 'Mặt hàng đã hủy' },
];

const RANGE_OPTIONS: Array<{ value: ProductReportTimeRange; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: 'last_7_days', label: '7 ngày gần đây' },
  { value: 'this_week', label: 'Tuần này' },
  { value: 'last_week', label: 'Tuần trước' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'this_year', label: 'Năm nay' },
  { value: 'custom', label: 'Khoảng tùy chọn' },
];

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function formatDateTime(value: number) {
  return dayjs(value).format('DD/MM/YYYY · HH:mm');
}

function reportTitle(reportType: SupportedReportType) {
  if (reportType === 'TOP_SELLING') return 'Mặt hàng bán chạy';
  if (reportType === 'CANCELLED_ITEMS') return 'Mặt hàng đã hủy';
  return 'Doanh thu theo danh mục';
}

function GrowthBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="product-report-growth is-neutral">Chưa có kỳ đối chiếu</span>;
  }
  const isUp = value > 0;
  const isDown = value < 0;
  return (
    <span className={`product-report-growth ${isUp ? 'is-up' : isDown ? 'is-down' : 'is-neutral'}`}>
      {isUp ? <ArrowUpOutlined /> : isDown ? <ArrowDownOutlined /> : null}
      {value === 0 ? 'Không đổi' : `${Math.abs(value)}%`}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  growth,
  helper,
  accent,
}: {
  label: string;
  value: string;
  growth: number | null | undefined;
  helper?: string | undefined;
  accent: 'blue' | 'green' | 'orange' | 'violet';
}) {
  return (
    <div className={`product-report-summary-card is-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? (
        <span className="product-report-growth is-neutral">{helper}</span>
      ) : (
        <GrowthBadge value={growth} />
      )}
    </div>
  );
}

function CategoryChart({
  data,
  metric,
}: {
  data: ProductReportResponseDto;
  metric: 'amount' | 'quantity';
}) {
  const rows = metric === 'amount' ? data.chart : data.quantityChart;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="product-report-bars" aria-label="Biểu đồ theo danh mục">
      {rows.map((row) => (
        <div className="product-report-bar" key={row.key}>
          <div className="product-report-bar__meta">
            <span title={row.label}>{row.label}</span>
            <strong>
              {metric === 'amount' ? formatMoney(row.value) : formatQuantity(row.value)}
            </strong>
          </div>
          <div className="product-report-bar__track">
            <span
              style={{ width: `${Math.max((row.value / max) * 100, 1.5)}%`, background: row.color }}
            />
          </div>
          <small>{row.percentage}% tổng báo cáo</small>
        </div>
      ))}
    </div>
  );
}

function ProductRow({
  product,
  onOpen,
}: {
  product: ProductReportCategoryProductItem;
  onOpen: (product: SelectedProduct) => void;
}) {
  return (
    <button
      type="button"
      className="product-report-data-row product-report-product-row"
      onClick={() => onOpen(product)}
    >
      <span className="product-report-data-row__name">
        <strong>{product.productName}</strong>
        <small>
          {product.productCode} · {product.unitName}
        </small>
      </span>
      <span data-label="Số lượng">{formatQuantity(product.quantity)}</span>
      <span data-label="Tiền hàng">{formatMoney(product.grossAmount)}</span>
      <span data-label="Giảm giá">{formatMoney(product.discountAmount)}</span>
      <strong data-label="Doanh thu thuần">{formatMoney(product.netAmount)}</strong>
      <RightOutlined className="product-report-row-arrow" />
    </button>
  );
}

function CategoryReport({
  data,
  onOpen,
}: {
  data: ProductReportResponseDto;
  onOpen: (product: SelectedProduct) => void;
}) {
  return (
    <div className="product-report-category-list">
      {data.categoryRows.map((category, index) => (
        <details className="product-report-category" key={category.categoryId} open={index === 0}>
          <summary>
            <span className="product-report-category__identity">
              <span className="product-report-category__marker" />
              <span>
                <strong>{category.categoryName}</strong>
                <small>{category.products.length} mặt hàng</small>
              </span>
            </span>
            <span data-label="Số lượng">{formatQuantity(category.quantity)}</span>
            <span data-label="Tiền hàng">{formatMoney(category.grossAmount)}</span>
            <span data-label="Tỷ trọng">{category.grossAmountRatio}%</span>
            <strong data-label="Doanh thu thuần">{formatMoney(category.netAmount)}</strong>
            <RightOutlined className="product-report-category__chevron" />
          </summary>
          <div className="product-report-data-head" aria-hidden="true">
            <span>Mặt hàng</span>
            <span>Số lượng</span>
            <span>Tiền hàng</span>
            <span>Giảm giá</span>
            <span>Doanh thu thuần</span>
            <span />
          </div>
          {category.products.map((product) => (
            <ProductRow product={product} onOpen={onOpen} key={product.productId} />
          ))}
        </details>
      ))}
    </div>
  );
}

function TopSellingReport({
  rows,
  onOpen,
}: {
  rows: ProductReportTopSellingRow[];
  onOpen: (product: SelectedProduct) => void;
}) {
  return (
    <div className="product-report-ranking">
      {rows.map((row) => (
        <button
          type="button"
          className="product-report-ranking-row"
          key={row.productId}
          onClick={() => onOpen(row)}
        >
          <span className={`product-report-rank is-rank-${Math.min(row.rank, 4)}`}>
            #{row.rank}
          </span>
          <span className="product-report-ranking-row__name">
            <strong>{row.productName}</strong>
            <small>
              {row.productCode} · {row.categoryName} · {row.unitName}
            </small>
          </span>
          <span data-label="Số lượng">
            <strong>{formatQuantity(row.quantity)}</strong>
            <small>{row.quantityRatio}% tổng SL</small>
          </span>
          <span data-label="Tiền hàng">
            <strong>{formatMoney(row.grossAmount)}</strong>
            <small>{row.grossAmountRatio}% doanh thu</small>
          </span>
          <span data-label="Giá bán TB">{formatMoney(row.averagePrice)}</span>
          <RightOutlined className="product-report-row-arrow" />
        </button>
      ))}
    </div>
  );
}

function CancelledReport({ rows }: { rows: ProductReportCancelledRow[] }) {
  return (
    <div className="product-report-cancelled-list">
      {rows.map((row) => (
        <div className="product-report-cancelled-row" key={row.id}>
          <span className="product-report-cancelled-row__name">
            <strong>{row.productName}</strong>
            <small>
              {row.categoryName} · {row.unitName}
            </small>
          </span>
          <span data-label="Số lượng hủy">{formatQuantity(row.quantity)}</span>
          <strong data-label="Giá trị hủy">{formatMoney(row.totalAmount)}</strong>
          <span data-label="Lý do">{row.cancelReason}</span>
          <span data-label="Thời gian">
            {formatDateTime(row.cancelledAt)}
            <small>{row.cancelledByName}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function DetailDrawer({
  selected,
  onClose,
  queryParams,
  apiPrefix,
}: {
  selected: SelectedProduct | null;
  onClose: () => void;
  queryParams: string;
  apiPrefix: string;
}) {
  const detailQuery = useQuery({
    queryKey: ['owner-product-report-detail', selected?.productId, queryParams],
    queryFn: () =>
      apiRequest<ProductReportDetailResponseDto>(
        `${apiPrefix}/reports/products/${encodeURIComponent(selected!.productId)}/details?${queryParams}`,
      ),
    enabled: selected !== null,
  });
  const detail = detailQuery.data;

  return (
    <Drawer
      open={selected !== null}
      onClose={onClose}
      width="min(760px, 100vw)"
      rootClassName="product-report-detail-drawer"
      title={
        <span className="product-report-detail-title">
          <small>Chi tiết mặt hàng</small>
          <strong>{detail?.productName ?? selected?.productName}</strong>
        </span>
      }
    >
      {detailQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 9 }} />
      ) : detailQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không tải được chi tiết mặt hàng"
          description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
          action={<Button onClick={() => void detailQuery.refetch()}>Thử lại</Button>}
        />
      ) : detail ? (
        <div className="product-report-detail">
          <div className="product-report-detail__meta">
            <span>{detail.productCode}</span>
            <span>{detail.categoryName}</span>
            <span>{detail.unitName}</span>
            <span>
              {dayjs(detail.fromMs).format('DD/MM/YYYY')} –{' '}
              {dayjs(detail.toMs).format('DD/MM/YYYY')}
            </span>
          </div>
          <div className="product-report-detail__summary">
            <div>
              <span>Số lượng bán</span>
              <strong>{formatQuantity(detail.summary.totalQuantity)}</strong>
            </div>
            <div>
              <span>Tiền hàng</span>
              <strong>{formatMoney(detail.summary.grossAmount)}</strong>
            </div>
            <div>
              <span>Giảm giá</span>
              <strong>{formatMoney(detail.summary.discountAmount)}</strong>
            </div>
            <div>
              <span>Doanh thu thuần</span>
              <strong>{formatMoney(detail.summary.netAmount)}</strong>
            </div>
          </div>
          <div className="product-report-detail-table">
            <div className="product-report-detail-table__head">
              <span>Thời gian / Hóa đơn</span>
              <span>Số lượng</span>
              <span>Tiền hàng</span>
              <span>Giảm giá</span>
              <span>Thành tiền</span>
            </div>
            {detail.rows.map((row) => (
              <div className="product-report-detail-table__row" key={row.invoiceId}>
                <span>
                  <strong>{formatDateTime(row.issuedAt)}</strong>
                  <small>
                    {row.referenceCode} · {row.orderType === 'DINE_IN' ? 'Tại bàn' : 'Mang về'}
                  </small>
                </span>
                <span data-label="Số lượng">{formatQuantity(row.quantity)}</span>
                <span data-label="Tiền hàng">{formatMoney(row.grossAmount)}</span>
                <span data-label="Giảm giá">{formatMoney(row.discountAmount)}</span>
                <strong data-label="Thành tiền">{formatMoney(row.totalAmount)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

export function OwnerProductReportPage({
  apiPrefix = '/api/v1/owner/analytics',
  onBack,
  userPermissions,
}: {
  apiPrefix?: string;
  onBack?: (() => void | Promise<void>) | undefined;
  userPermissions?: readonly string[] | undefined;
} = {}) {
  const [reportType, setReportType] = useState<SupportedReportType>('CATEGORY');
  const [timeRange, setTimeRange] = useState<ProductReportTimeRange>('this_week');
  const [customDates, setCustomDates] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [compareWith, setCompareWith] = useState<ProductReportCompareWith>('previous_period');
  const [chartMetric, setChartMetric] = useState<'amount' | 'quantity'>('amount');
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [hourMode, setHourMode] = useState<'all' | 'custom'>('all');
  const [fromHour, setFromHour] = useState(0);
  const [fromMinute, setFromMinute] = useState(0);
  const [toHour, setToHour] = useState(0);
  const [toMinute, setToMinute] = useState(0);
  const [hourModalOpen, setHourModalOpen] = useState(false);
  const [draftHourMode, setDraftHourMode] = useState<'all' | 'custom'>('all');
  const [draftFromHour, setDraftFromHour] = useState(0);
  const [draftFromMinute, setDraftFromMinute] = useState(0);
  const [draftToHour, setDraftToHour] = useState(0);
  const [draftToMinute, setDraftToMinute] = useState(0);
  const [printing, setPrinting] = useState(false);

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
    staleTime: 600_000,
  });
  const isOwner = auth.data?.actor?.kind === 'OWNER';
  const canExport = isOwner || !userPermissions || userPermissions.includes('report.product');
  const canPrint = isOwner || !userPermissions || userPermissions.includes('report.product');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      reportType,
      timeRange,
      hourMode,
      fromHour: String(fromHour),
      fromMinute: String(fromMinute),
      toHour: String(toHour),
      toMinute: String(toMinute),
      compareWith,
    });
    if (timeRange === 'custom' && customDates) {
      params.set('dateFrom', customDates[0].format('YYYY-MM-DD'));
      params.set('dateTo', customDates[1].format('YYYY-MM-DD'));
    }
    return params.toString();
  }, [
    reportType,
    timeRange,
    hourMode,
    fromHour,
    fromMinute,
    toHour,
    toMinute,
    compareWith,
    customDates,
  ]);
  const [appliedQueryParams, setAppliedQueryParams] = useState<string | null>(null);

  const canLoad = timeRange !== 'custom' || customDates !== null;
  const reportQuery = useQuery({
    queryKey: ['owner-product-report', appliedQueryParams],
    queryFn: () =>
      apiRequest<ProductReportResponseDto>(`${apiPrefix}/reports/products?${appliedQueryParams!}`),
    enabled: appliedQueryParams !== null,
  });
  const data = reportQuery.data;
  const appliedReportType = (data?.reportType ?? reportType) as SupportedReportType;
  const hasRows =
    appliedReportType === 'CATEGORY'
      ? Boolean(data?.categoryRows.length)
      : appliedReportType === 'TOP_SELLING'
        ? Boolean(data?.topSellingRows.length)
        : Boolean(data?.cancelledRows.length);

  const hourLabel =
    hourMode === 'all'
      ? 'Cả ngày'
      : `${String(fromHour).padStart(2, '0')}:${String(fromMinute).padStart(2, '0')} – ${String(toHour).padStart(2, '0')}:${String(toMinute).padStart(2, '0')}${fromHour * 60 + fromMinute >= toHour * 60 + toMinute ? ' (+1)' : ''}`;

  const openHourModal = () => {
    setDraftHourMode(hourMode);
    setDraftFromHour(fromHour);
    setDraftFromMinute(fromMinute);
    setDraftToHour(toHour);
    setDraftToMinute(toMinute);
    setHourModalOpen(true);
  };

  const exportReport = () => {
    if (!data || !hasRows) {
      message.warning('Chưa có dữ liệu để xuất báo cáo.');
      return;
    }
    let rows: Array<Record<string, string | number>> = [];
    if (appliedReportType === 'CATEGORY') {
      rows = data.categoryRows.flatMap((category) => [
        {
          'Danh mục / Mặt hàng': `[${category.categoryName}]`,
          'Mã mặt hàng': '',
          'Đơn vị': '',
          'Số lượng': category.quantity,
          'Tiền hàng': category.grossAmount,
          'Giảm giá': category.discountAmount,
          'Doanh thu thuần': category.netAmount,
        },
        ...category.products.map((product) => ({
          'Danh mục / Mặt hàng': product.productName,
          'Mã mặt hàng': product.productCode,
          'Đơn vị': product.unitName,
          'Số lượng': product.quantity,
          'Tiền hàng': product.grossAmount,
          'Giảm giá': product.discountAmount,
          'Doanh thu thuần': product.netAmount,
        })),
      ]);
    } else if (appliedReportType === 'TOP_SELLING') {
      rows = data.topSellingRows.map((row) => ({
        Hạng: row.rank,
        'Mã mặt hàng': row.productCode,
        'Tên mặt hàng': row.productName,
        'Danh mục': row.categoryName,
        'Đơn vị': row.unitName,
        'Số lượng': row.quantity,
        'Tiền hàng': row.grossAmount,
        'Giảm giá': row.discountAmount,
        'Doanh thu thuần': row.netAmount,
        'Giá bán trung bình': row.averagePrice,
      }));
    } else {
      rows = data.cancelledRows.map((row) => ({
        'Tên mặt hàng': row.productName,
        'Danh mục': row.categoryName,
        'Đơn vị': row.unitName,
        'Số lượng hủy': row.quantity,
        'Giá trị hủy': row.totalAmount,
        'Lý do': row.cancelReason,
        'Thời gian': formatDateTime(row.cancelledAt),
        'Người hủy': row.cancelledByName,
      }));
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(14, key.length + 4),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'BaoCaoMatHang');
    XLSX.writeFile(workbook, `BaoCaoMatHang_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
    message.success('Đã xuất báo cáo Excel.');
  };

  const printReport = async () => {
    if (!data || !hasRows || !appliedQueryParams) {
      message.warning('Chưa có dữ liệu để in báo cáo.');
      return;
    }
    setPrinting(true);
    const idempotencyKey = `product-report:${crypto.randomUUID()}`;
    try {
      await jsonRequest(
        `${apiPrefix}/reports/products/print`,
        { ...Object.fromEntries(new URLSearchParams(appliedQueryParams)), idempotencyKey },
        {
          headers: {
            'X-CSRF-Token': auth.data?.csrfToken ?? '',
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
      message.success('Đã gửi báo cáo tới Print Agent.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không thể in báo cáo.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="owner-product-report-page">
      <section className="product-report-hero">
        <div className="product-report-hero-main">
          {onBack ? (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              size="middle"
              className="product-report-back-btn"
            >
              Quay lại
            </Button>
          ) : null}
          <div className="product-report-hero-titles">
            <span className="product-report-eyebrow">BÁO CÁO KINH DOANH</span>
            <h1>Báo cáo mặt hàng</h1>
            <p>Theo dõi số lượng, doanh thu và từng hóa đơn phát sinh của mặt hàng.</p>
          </div>
        </div>
        <div className="product-report-hero-actions">
          {canExport && (
            <Button
              className="product-report-hero__export"
              icon={<FileExcelOutlined />}
              aria-label="Xuất báo cáo Excel"
              onClick={exportReport}
              disabled={!hasRows}
            >
              Xuất Excel
            </Button>
          )}
          {canPrint && (
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              aria-label="In Báo Cáo"
              onClick={() => void printReport()}
              disabled={!hasRows}
              loading={printing}
            >
              In Báo Cáo
            </Button>
          )}
        </div>
      </section>

      <section className="product-report-filter-bar" aria-label="Bộ lọc báo cáo">
        <div className="product-report-filter-group">
          <label className="product-report-filter-item">
            <span className="product-report-filter-label">Loại báo cáo</span>
            <Select
              value={reportType}
              options={REPORT_OPTIONS}
              onChange={(value) => setReportType(value)}
              popupMatchSelectWidth={false}
            />
          </label>
          <label className="product-report-filter-item">
            <span className="product-report-filter-label">Thời gian</span>
            <Select
              value={timeRange}
              options={RANGE_OPTIONS}
              onChange={(value) => {
                setTimeRange(value);
                if (value === 'custom' && !customDates) {
                  setCustomDates([dayjs().subtract(6, 'day'), dayjs()]);
                }
              }}
              popupMatchSelectWidth={false}
            />
          </label>
          {timeRange === 'custom' ? (
            <label className="product-report-filter-item product-report-filter-item--dates">
              <span className="product-report-filter-label">Khoảng ngày</span>
              <DatePicker.RangePicker
                value={customDates}
                format="DD/MM/YYYY"
                allowClear={false}
                onChange={(value) => setCustomDates(value as [dayjs.Dayjs, dayjs.Dayjs] | null)}
              />
            </label>
          ) : null}
          <label className="product-report-filter-item">
            <span className="product-report-filter-label">Khung giờ</span>
            <Button className="product-report-hour-button" onClick={openHourModal}>
              <ClockCircleOutlined /> {hourLabel}
            </Button>
          </label>
          <label className="product-report-filter-item">
            <span className="product-report-filter-label">So sánh</span>
            <Select<ProductReportCompareWith>
              value={compareWith}
              onChange={setCompareWith}
              options={[
                { value: 'previous_period', label: 'Giai đoạn trước' },
                { value: 'same_period_last_week', label: 'Cùng kỳ tuần trước' },
                { value: 'same_period_last_month', label: 'Cùng kỳ tháng trước' },
                { value: 'same_period_last_year', label: 'Cùng kỳ năm trước' },
                { value: 'none', label: 'Không so sánh' },
              ]}
              popupMatchSelectWidth={false}
            />
          </label>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={reportQuery.isFetching}
          disabled={!canLoad}
          onClick={() => setAppliedQueryParams(queryParams)}
        >
          Xem báo cáo
        </Button>
      </section>

      {!canLoad ? (
        <Alert type="info" showIcon title="Vui lòng chọn khoảng ngày để xem báo cáo." />
      ) : reportQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không tải được báo cáo mặt hàng"
          description={reportQuery.error instanceof Error ? reportQuery.error.message : undefined}
          action={<Button onClick={() => void reportQuery.refetch()}>Thử lại</Button>}
        />
      ) : reportQuery.isLoading ? (
        <div className="product-report-loading">
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      ) : data ? (
        <>
          <section className="product-report-context-line">
            <div>
              <h2>
                {reportTitle(appliedReportType)}
                <Tooltip title="Số liệu lấy từ các dòng hóa đơn đã hoàn tất; tiền hàng là trước giảm giá.">
                  <InfoCircleOutlined />
                </Tooltip>
              </h2>
              <p>
                {formatDateTime(data.fromMs)} – {formatDateTime(data.toMs)} · Cập nhật{' '}
                {formatDateTime(data.generatedAt)}
              </p>
            </div>
            <span className="product-report-paid-only">Chỉ tính hóa đơn hoàn tất</span>
          </section>

          <section className="product-report-summary-grid">
            <SummaryCard
              label={
                appliedReportType === 'CANCELLED_ITEMS' ? 'Số lượng đã hủy' : 'Số lượng đã bán'
              }
              value={formatQuantity(data.summary.totalQuantity)}
              growth={data.summary.comparison?.quantityGrowth}
              accent="blue"
            />
            <SummaryCard
              label={appliedReportType === 'CANCELLED_ITEMS' ? 'Giá trị hủy' : 'Tiền hàng'}
              value={formatMoney(data.summary.grossAmount)}
              growth={data.summary.comparison?.grossAmountGrowth}
              accent="violet"
            />
            <SummaryCard
              label={
                appliedReportType === 'CANCELLED_ITEMS' ? 'Dòng mặt hàng hủy' : 'Tổng giảm giá'
              }
              value={
                appliedReportType === 'CANCELLED_ITEMS'
                  ? formatQuantity(data.cancelledRows.length)
                  : formatMoney(data.summary.discountAmount)
              }
              growth={
                appliedReportType === 'CANCELLED_ITEMS'
                  ? null
                  : data.summary.comparison?.discountGrowth
              }
              helper={appliedReportType === 'CANCELLED_ITEMS' ? 'Trong kỳ đã chọn' : undefined}
              accent="orange"
            />
            <SummaryCard
              label={appliedReportType === 'CANCELLED_ITEMS' ? 'Giá trị hủy TB' : 'Doanh thu thuần'}
              value={
                appliedReportType === 'CANCELLED_ITEMS'
                  ? formatMoney(
                      data.summary.totalQuantity > 0
                        ? Math.round(data.summary.totalAmount / data.summary.totalQuantity)
                        : 0,
                    )
                  : formatMoney(data.summary.netAmount)
              }
              growth={
                appliedReportType === 'CANCELLED_ITEMS'
                  ? null
                  : data.summary.comparison?.netAmountGrowth
              }
              helper={appliedReportType === 'CANCELLED_ITEMS' ? 'Trên mỗi đơn vị hủy' : undefined}
              accent="green"
            />
          </section>

          {hasRows && data.categoryRows.length ? (
            <section className="product-report-chart-card-container">
              <div className="product-report-section-head">
                <div>
                  <span>PHÂN BỔ DANH MỤC</span>
                  <h3>Tỷ trọng mặt hàng đã bán</h3>
                </div>
                <div className="product-report-chart-tabs">
                  <button
                    type="button"
                    className={chartMetric === 'amount' ? 'is-active' : ''}
                    onClick={() => setChartMetric('amount')}
                  >
                    Tiền hàng
                  </button>
                  <button
                    type="button"
                    className={chartMetric === 'quantity' ? 'is-active' : ''}
                    onClick={() => setChartMetric('quantity')}
                  >
                    Số lượng
                  </button>
                </div>
              </div>
              <CategoryChart data={data} metric={chartMetric} />
            </section>
          ) : null}

          <section className="product-report-results">
            <div className="product-report-section-head">
              <div>
                <span>CHI TIẾT BÁO CÁO</span>
                <h3>{reportTitle(appliedReportType)}</h3>
              </div>
              {appliedReportType !== 'CANCELLED_ITEMS' && hasRows ? (
                <small>
                  <EyeOutlined /> Chọn mặt hàng để xem từng hóa đơn
                </small>
              ) : null}
            </div>
            {hasRows ? (
              appliedReportType === 'CATEGORY' ? (
                <CategoryReport data={data} onOpen={setSelectedProduct} />
              ) : appliedReportType === 'TOP_SELLING' ? (
                <TopSellingReport rows={data.topSellingRows} onOpen={setSelectedProduct} />
              ) : (
                <CancelledReport rows={data.cancelledRows} />
              )
            ) : (
              <Empty
                image={<ShoppingOutlined className="product-report-empty-icon" />}
                description={
                  <span>
                    Chưa có dữ liệu trong khoảng đã chọn
                    <small>Thử đổi thời gian hoặc khung giờ báo cáo.</small>
                  </span>
                }
              />
            )}
          </section>
        </>
      ) : null}

      <DetailDrawer
        selected={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        queryParams={appliedQueryParams ?? ''}
        apiPrefix={apiPrefix}
      />

      <Modal
        title="Khung giờ báo cáo"
        open={hourModalOpen}
        onCancel={() => setHourModalOpen(false)}
        width={440}
        centered
        className="hour-window-modal"
        footer={[
          <Button key="cancel" onClick={() => setHourModalOpen(false)}>
            Hủy
          </Button>,
          <Button
            key="apply"
            type="primary"
            onClick={() => {
              setHourMode(draftHourMode);
              setFromHour(draftFromHour);
              setFromMinute(draftFromMinute);
              setToHour(draftToHour);
              setToMinute(draftToMinute);
              setHourModalOpen(false);
            }}
          >
            Áp dụng
          </Button>,
        ]}
      >
        <div className="hour-window-modal-content">
          <Radio.Group
            value={draftHourMode}
            onChange={(event) => setDraftHourMode(event.target.value)}
          >
            <Radio value="all">Cả ngày</Radio>
            <Radio value="custom">Khung giờ tùy chọn</Radio>
          </Radio.Group>
          <div className={`hour-window-rows ${draftHourMode === 'all' ? 'is-disabled' : ''}`}>
            {[
              {
                label: 'Từ',
                hour: draftFromHour,
                minute: draftFromMinute,
                setHour: setDraftFromHour,
                setMinute: setDraftFromMinute,
              },
              {
                label: 'Đến',
                hour: draftToHour,
                minute: draftToMinute,
                setHour: setDraftToHour,
                setMinute: setDraftToMinute,
              },
            ].map((row) => (
              <div className="hour-window-row" key={row.label}>
                <span className="hour-window-row-label">{row.label}</span>
                <InputNumber
                  min={0}
                  max={23}
                  value={row.hour}
                  disabled={draftHourMode === 'all'}
                  onChange={(value) => row.setHour(value ?? 0)}
                />
                <span>giờ</span>
                <InputNumber
                  min={0}
                  max={59}
                  value={row.minute}
                  disabled={draftHourMode === 'all'}
                  onChange={(value) => row.setMinute(value ?? 0)}
                />
                <span>phút</span>
              </div>
            ))}
          </div>
          {draftHourMode === 'custom' ? (
            <Alert
              type="info"
              showIcon
              title="Nếu giờ kết thúc sớm hơn hoặc bằng giờ bắt đầu, báo cáo sẽ tính qua ngày hôm sau."
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
