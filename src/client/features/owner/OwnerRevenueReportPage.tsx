import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  FileExcelOutlined,
  PrinterOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Modal,
  Radio,
  Select,
  Skeleton,
  Table,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiRequest, jsonRequest } from '@client/lib/api';
import type { AuthContextResponse } from '@contracts/auth';
import {
  revenueReportTypePermissions,
  type RevenueReportResponseDto,
  type RevenueReportTimeRange,
  type RevenueReportTimelineRowDto,
  type RevenueReportType,
} from '@contracts/revenue-report';

const REPORT_OPTIONS: Array<{ value: RevenueReportType; label: string }> = [
  { value: 'OVERVIEW', label: 'Doanh thu tổng quan' },
  { value: 'PAYMENT_METHOD', label: 'Phương thức thanh toán' },
  { value: 'SERVICE_MODE', label: 'Hình thức phục vụ' },
  { value: 'CANCELLATIONS', label: 'Hủy đơn' },
  { value: 'STAFF_REVENUE', label: 'Doanh thu theo nhân viên' },
];
const RANGE_OPTIONS: Array<{ value: RevenueReportTimeRange; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'yesterday', label: 'Hôm qua' },
  { value: 'last_7_days', label: '7 ngày gần đây' },
  { value: 'this_week', label: 'Tuần này' },
  { value: 'last_week', label: 'Tuần trước' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'this_year', label: 'Năm nay' },
  { value: 'custom', label: 'Tùy chọn' },
];
const TITLES = Object.fromEntries(REPORT_OPTIONS.map((item) => [item.value, item.label])) as Record<
  RevenueReportType,
  string
>;
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
function timestamp(value: number, timezone: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
function MiniKpi({
  label,
  value,
  tone = 'blue',
  detail,
  featured = false,
}: {
  label: string;
  value: string;
  tone?: string;
  detail?: string;
  featured?: boolean;
}) {
  return (
    <div className={`revenue-compact-kpi is-${tone}${featured ? ' is-featured' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

const RevenueTrendChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.RevenueTrendChart };
});

const HourlyRevenueChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.HourlyRevenueChart };
});

const BreakdownBarChart = lazy(async () => {
  const module = await import('./OwnerAnalyticsCharts');
  return { default: module.BreakdownBarChart };
});

function ChartFallback() {
  return <Skeleton active paragraph={{ rows: 5 }} />;
}

export function OwnerRevenueReportPage({
  apiPrefix = '/api/v1/owner/analytics',
  onBack,
  userPermissions,
}: {
  apiPrefix?: string;
  onBack?: () => void;
  userPermissions?: readonly string[];
}) {
  const [messageApi, holder] = message.useMessage();
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
    staleTime: 600_000,
  });
  const isOwner = auth.data?.actor?.kind === 'OWNER';
  const allowedReports = useMemo(
    () =>
      REPORT_OPTIONS.filter(
        (item) => isOwner || userPermissions?.includes(revenueReportTypePermissions[item.value]),
      ),
    [isOwner, userPermissions],
  );
  const [reportType, setReportType] = useState<RevenueReportType>('OVERVIEW');
  const [timeRange, setTimeRange] = useState<RevenueReportTimeRange>('today');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [hourMode, setHourMode] = useState<'all' | 'custom'>('all');
  const [fromHour, setFromHour] = useState(0);
  const [fromMinute, setFromMinute] = useState(0);
  const [toHour, setToHour] = useState(0);
  const [toMinute, setToMinute] = useState(0);
  const [hourOpen, setHourOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [draft, setDraft] = useState({
    mode: 'all' as 'all' | 'custom',
    fromHour: 0,
    fromMinute: 0,
    toHour: 0,
    toMinute: 0,
  });
  const [appliedParams, setAppliedParams] = useState<string | null>(null);
  useEffect(() => {
    if (!allowedReports.some((item) => item.value === reportType) && allowedReports[0])
      setReportType(allowedReports[0].value);
  }, [allowedReports, reportType]);
  useEffect(() => {
    if (reportType !== 'STAFF_REVENUE') setEmployeeId(null);
  }, [reportType]);
  const params = useMemo(() => {
    const value = new URLSearchParams({
      reportType,
      timeRange,
      hourMode,
      fromHour: String(fromHour),
      fromMinute: String(fromMinute),
      toHour: String(toHour),
      toMinute: String(toMinute),
    });
    if (timeRange === 'custom' && dates) {
      value.set('dateFrom', dates[0].format('YYYY-MM-DD'));
      value.set('dateTo', dates[1].format('YYYY-MM-DD'));
    }
    if (reportType === 'STAFF_REVENUE' && employeeId) value.set('employeeId', employeeId);
    return value.toString();
  }, [dates, employeeId, fromHour, fromMinute, hourMode, reportType, timeRange, toHour, toMinute]);
  const canLoad = allowedReports.length > 0 && (timeRange !== 'custom' || dates !== null);
  const reportQuery = useQuery({
    queryKey: ['revenue-report', apiPrefix, appliedParams],
    queryFn: () =>
      apiRequest<RevenueReportResponseDto>(`${apiPrefix}/reports/revenue?${appliedParams!}`),
    enabled: appliedParams !== null,
  });
  const data = reportQuery.data;
  const hasData = Boolean(
    data && (data.summary.completedInvoiceCount || data.summary.cancelledOrderCount),
  );
  const canExport = isOwner || userPermissions?.includes('report.revenue.export');
  const canPrint = isOwner || userPermissions?.includes('report.revenue.print');
  const hourLabel =
    hourMode === 'all'
      ? 'Cả ngày'
      : `${String(fromHour).padStart(2, '0')}:${String(fromMinute).padStart(2, '0')}–${String(toHour).padStart(2, '0')}:${String(toMinute).padStart(2, '0')}`;
  const columns: TableColumnsType<RevenueReportTimelineRowDto> = [
    { title: 'Thời gian', dataIndex: 'label', fixed: 'left', width: 105 },
    { title: 'HĐ', dataIndex: 'completedInvoiceCount', width: 60 },
    { title: 'Hủy', dataIndex: 'cancelledOrderCount', width: 60 },
    {
      title: 'Tiền hàng',
      dataIndex: 'goodsRevenue',
      render: (value, row) => money(value ?? row.grossRevenue - (row.timeRevenue ?? 0)),
      width: 125,
    },
    {
      title: 'Tiền giờ',
      dataIndex: 'timeRevenue',
      render: (value) => money(value ?? 0),
      width: 115,
    },
    { title: 'Giảm giá', dataIndex: 'discountAmount', render: money, width: 115 },
    {
      title: 'Doanh thu',
      dataIndex: 'netRevenue',
      render: (value) => <b>{money(value)}</b>,
      width: 135,
    },
  ];
  const exportExcel = () => {
    if (!data || !hasData) return messageApi.warning('Chưa có dữ liệu để xuất.');
    const workbook = XLSX.utils.book_new();

    const rows: (string | number)[][] = [
      ['BÁO CÁO DOANH THU - ' + (TITLES[data.reportType] ?? '').toUpperCase()],
      [
        'Thời gian áp dụng:',
        `${timestamp(data.fromMs, data.timezone)} – ${timestamp(data.toMs, data.timezone)}`,
      ],
      ['Thời điểm xuất file:', timestamp(Date.now(), data.timezone)],
      [],
      ['TỔNG HỢP CHỈ TIÊU KINH DOANH'],
      ['Chỉ tiêu', 'Giá trị'],
      ['Số hóa đơn hoàn tất', data.summary.completedInvoiceCount],
      ['Số đơn hàng đã hủy', data.summary.cancelledOrderCount],
      ['Tổng tiền hàng (đ)', data.summary.goodsRevenue ?? data.summary.grossRevenue],
      ['Tổng tiền giờ (đ)', data.summary.timeRevenue ?? 0],
      ['Tổng trước giảm giá (đ)', data.summary.grossRevenue],
      ['Tổng tiền hủy (đ)', data.summary.cancelledAmount],
      ['Tổng giảm giá (đ)', data.summary.discountAmount],
      ['Doanh thu thuần (đ)', data.summary.netRevenue],
      ['Doanh thu trung bình / HĐ (đ)', data.summary.averageRevenuePerInvoice],
      [],
    ];

    if (data.reportType === 'OVERVIEW') {
      rows.push(
        ['BẢNG CHI TIẾT THEO THỜI GIAN'],
        [
          'Thời gian',
          'Số HĐ hoàn tất',
          'Số đơn hủy',
          'Tiền hàng (đ)',
          'Tiền giờ (đ)',
          'Tiền hủy (đ)',
          'Giảm giá (đ)',
          'Doanh thu thuần (đ)',
          'TB / HĐ (đ)',
        ],
      );
      for (const row of data.timeline) {
        rows.push([
          row.label,
          row.completedInvoiceCount,
          row.cancelledOrderCount,
          row.goodsRevenue ?? row.grossRevenue - (row.timeRevenue ?? 0),
          row.timeRevenue ?? 0,
          row.cancelledAmount,
          row.discountAmount,
          row.netRevenue,
          row.averageRevenuePerInvoice,
        ]);
      }
      rows.push([
        'TỔNG CỘNG',
        data.summary.completedInvoiceCount,
        data.summary.cancelledOrderCount,
        data.summary.goodsRevenue ?? data.summary.grossRevenue - (data.summary.timeRevenue ?? 0),
        data.summary.timeRevenue ?? 0,
        data.summary.cancelledAmount,
        data.summary.discountAmount,
        data.summary.netRevenue,
        data.summary.averageRevenuePerInvoice,
      ]);
    } else if (data.reportType === 'PAYMENT_METHOD') {
      rows.push(
        ['BẢNG CHI TIẾT THEO PHƯƠNG THỨC THANH TOÁN'],
        ['Phương thức thanh toán', 'Số lượng hóa đơn', 'Tỷ lệ đóng góp (%)', 'Doanh thu (đ)'],
      );
      for (const row of data.paymentMethods) {
        rows.push([row.label, row.invoiceCount, `${row.percentage}%`, row.amount]);
      }
      rows.push(['TỔNG CỘNG', data.summary.completedInvoiceCount, '100%', data.summary.netRevenue]);
    } else if (data.reportType === 'SERVICE_MODE') {
      rows.push(
        ['BẢNG CHI TIẾT THEO HÌNH THỨC PHỤC VỤ'],
        ['Hình thức phục vụ', 'Số lượng hóa đơn', 'Tỷ lệ đóng góp (%)', 'Doanh thu (đ)'],
      );
      for (const row of data.orderTypes) {
        rows.push([row.label, row.invoiceCount, `${row.percentage}%`, row.amount]);
      }
      rows.push(['TỔNG CỘNG', data.summary.completedInvoiceCount, '100%', data.summary.netRevenue]);
    } else if (data.reportType === 'STAFF_REVENUE') {
      rows.push(
        ['BẢNG CHI TIẾT DOANH THU THEO NHÂN VIÊN'],
        ['Nhân viên', 'Vai trò', 'Số lượng hóa đơn', 'Tỷ lệ đóng góp (%)', 'Doanh thu (đ)'],
      );
      for (const row of data.staffRevenue) {
        rows.push([
          row.label,
          row.roleName ?? 'Nhân viên',
          row.invoiceCount,
          `${row.percentage}%`,
          row.amount,
        ]);
      }
      rows.push([
        'TỔNG CỘNG',
        '',
        data.summary.completedInvoiceCount,
        '100%',
        data.summary.netRevenue,
      ]);
    } else if (data.reportType === 'CANCELLATIONS') {
      rows.push(
        ['BẢNG CHI TIẾT CÁC ĐƠN ĐÃ HỦY'],
        ['Mã đơn', 'Thời gian hủy', 'Loại hình', 'Người hủy', 'Lý do hủy', 'Số tiền hủy (đ)'],
      );
      for (const row of data.cancellations) {
        rows.push([
          row.id ? `D-${row.id.slice(0, 8)}` : '',
          timestamp(row.cancelledAt, data.timezone),
          row.orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang về',
          row.cancelledByName,
          row.reason,
          row.amount,
        ]);
      }
      rows.push([
        'TỔNG CỘNG',
        '',
        '',
        '',
        `${data.cancellations.length} đơn`,
        data.summary.cancelledAmount,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    const maxCols = Math.max(...rows.map((r) => r.length), 1);
    const colWidths = Array.from({ length: maxCols }, (_, colIdx) => {
      let maxLen = 14;
      for (const row of rows) {
        const val = row[colIdx];
        if (val !== undefined && val !== null) {
          const str = typeof val === 'number' ? val.toLocaleString('vi-VN') : String(val);
          if (str.length > maxLen) maxLen = Math.min(str.length + 3, 40);
        }
      }
      return { wch: maxLen };
    });
    worksheet['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Báo cáo doanh thu');
    XLSX.writeFile(workbook, `BaoCaoDoanhThu_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
    messageApi.success('Đã xuất báo cáo Excel.');
  };
  const print = async () => {
    if (!data || !hasData || !appliedParams) return messageApi.warning('Chưa có dữ liệu để in.');
    setPrinting(true);
    const idempotencyKey = `revenue-report:${crypto.randomUUID()}`;
    try {
      await jsonRequest(
        `${apiPrefix}/reports/revenue/print`,
        { ...Object.fromEntries(new URLSearchParams(appliedParams)), idempotencyKey },
        {
          headers: {
            'X-CSRF-Token': auth.data?.csrfToken ?? '',
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
      messageApi.success('Đã gửi báo cáo tới Print Agent.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể in báo cáo.');
    } finally {
      setPrinting(false);
    }
  };
  if (!isOwner && allowedReports.length === 0 && auth.data)
    return <Alert type="warning" showIcon title="Chưa được cấp quyền báo cáo doanh thu" />;
  return (
    <div className="owner-revenue-report-page revenue-compact-page">
      {holder}
      <header className="revenue-compact-header">
        <div>
          {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
          <div>
            <h1>Báo cáo doanh thu</h1>
            <p>Dữ liệu vận hành theo quyền được cấp</p>
          </div>
        </div>
        <div>
          {canExport && (
            <Button
              size="small"
              icon={<FileExcelOutlined />}
              disabled={!hasData}
              onClick={exportExcel}
            >
              Xuất Excel
            </Button>
          )}
          {canPrint && (
            <Button
              size="small"
              type="primary"
              icon={<PrinterOutlined />}
              disabled={!hasData}
              loading={printing}
              onClick={() => void print()}
            >
              In Báo Cáo
            </Button>
          )}
        </div>
      </header>
      <section className="revenue-compact-filter">
        <label>
          <span>Loại báo cáo</span>
          <Select value={reportType} options={allowedReports} onChange={setReportType} />
        </label>
        <label>
          <span>Thời gian</span>
          <Select
            value={timeRange}
            options={RANGE_OPTIONS}
            onChange={(value) => {
              setTimeRange(value);
              if (value === 'custom' && !dates) setDates([dayjs().subtract(6, 'day'), dayjs()]);
            }}
          />
        </label>
        {timeRange === 'custom' && (
          <label className="is-date">
            <span>Khoảng ngày</span>
            <DatePicker.RangePicker
              value={dates}
              format="DD/MM/YYYY"
              allowClear={false}
              onChange={(value) => setDates(value as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            />
          </label>
        )}
        <label>
          <span>Khung giờ</span>
          <Button
            icon={<ClockCircleOutlined />}
            onClick={() => {
              setDraft({ mode: hourMode, fromHour, fromMinute, toHour, toMinute });
              setHourOpen(true);
            }}
          >
            {hourLabel}
          </Button>
        </label>
        {reportType === 'STAFF_REVENUE' && (
          <label>
            <span>Nhân viên</span>
            <Select
              allowClear
              placeholder="Tất cả"
              value={employeeId}
              onChange={setEmployeeId}
              options={
                data?.staffOptions.map((staff) => ({
                  value: staff.userId,
                  label: `${staff.displayName}${staff.roleName ? ` · ${staff.roleName}` : ''}`,
                })) ?? []
              }
            />
          </label>
        )}
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={reportQuery.isFetching}
          disabled={!canLoad}
          onClick={() => setAppliedParams(params)}
        >
          Xem
        </Button>
      </section>
      {reportQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Không tải được báo cáo"
          description={reportQuery.error instanceof Error ? reportQuery.error.message : undefined}
        />
      ) : reportQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 7 }} />
      ) : data ? (
        <>
          <div className="revenue-compact-meta">
            <strong>{TITLES[data.reportType]}</strong>
            <span>
              {timestamp(data.fromMs, data.timezone)} – {timestamp(data.toMs, data.timezone)}
            </span>
            <small>Cập nhật {timestamp(data.generatedAt, data.timezone)}</small>
          </div>
          <section className="revenue-compact-kpis">
            {data.reportType === 'CANCELLATIONS' ? (
              <>
                <MiniKpi
                  label="Đơn hủy"
                  value={String(data.summary.cancelledOrderCount)}
                  tone="red"
                />
                <MiniKpi
                  label="Giá trị hủy"
                  value={money(data.summary.cancelledAmount)}
                  tone="red"
                />
              </>
            ) : (
              <>
                <MiniKpi
                  label="Doanh thu thuần"
                  value={money(data.summary.netRevenue)}
                  tone="green"
                  detail={`${data.summary.completedInvoiceCount} hóa đơn · TB ${money(data.summary.averageRevenuePerInvoice)}/HĐ`}
                  featured
                />
                <MiniKpi
                  label="Tiền hàng"
                  value={money(data.summary.goodsRevenue ?? data.summary.grossRevenue)}
                  detail="Mặt hàng trước giảm giá"
                />
                <MiniKpi
                  label="Tiền giờ"
                  value={money(data.summary.timeRevenue ?? 0)}
                  tone="violet"
                  detail="Dịch vụ bàn/phòng"
                />
                <MiniKpi
                  label="Giảm giá"
                  value={money(data.summary.discountAmount)}
                  tone="orange"
                  detail={
                    data.summary.grossRevenue > 0
                      ? `${((data.summary.discountAmount / data.summary.grossRevenue) * 100).toFixed(1)}% tổng trước giảm`
                      : '0% tổng trước giảm'
                  }
                />
                <MiniKpi
                  label="Hóa đơn"
                  value={String(data.summary.completedInvoiceCount)}
                  tone="violet"
                  detail={`${data.summary.productQuantity} mặt hàng`}
                />
                <MiniKpi
                  label="TB/HĐ"
                  value={money(data.summary.averageRevenuePerInvoice)}
                  tone="green"
                  detail={`${data.summary.averageItemsPerInvoice} mặt hàng/HĐ`}
                />
              </>
            )}
          </section>
          {hasData ? (
            <>
              <div className="revenue-dashboard-grid">
                <section className="revenue-compact-card is-main">
                  <div className="revenue-card-title">
                    <h3>{TITLES[data.reportType]}</h3>
                    <span>{data.summary.completedInvoiceCount} hóa đơn</span>
                  </div>
                  {data.reportType === 'PAYMENT_METHOD' ? (
                    <Suspense fallback={<ChartFallback />}>
                      <BreakdownBarChart rows={data.paymentMethods} />
                    </Suspense>
                  ) : data.reportType === 'SERVICE_MODE' ? (
                    <Suspense fallback={<ChartFallback />}>
                      <BreakdownBarChart rows={data.orderTypes} color="#8b5cf6" />
                    </Suspense>
                  ) : data.reportType === 'STAFF_REVENUE' ? (
                    <Suspense fallback={<ChartFallback />}>
                      <BreakdownBarChart rows={data.staffRevenue} color="#10b981" />
                    </Suspense>
                  ) : data.reportType === 'CANCELLATIONS' ? (
                    <div className="revenue-cancel-list">
                      {data.cancellations.slice(0, 8).map((row) => (
                        <div key={row.id}>
                          <span>
                            {timestamp(row.cancelledAt, data.timezone)}
                            <small>
                              {row.cancelledByName} ·{' '}
                              {row.orderType === 'DINE_IN' ? 'Tại bàn' : 'Mang về'}
                            </small>
                          </span>
                          <span>{row.reason}</span>
                          <b>{money(row.amount)}</b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Suspense fallback={<ChartFallback />}>
                      <RevenueTrendChart
                        points={data.timeline.map((row) => ({
                          label: row.label,
                          revenue: row.netRevenue,
                          grossRevenue: row.grossRevenue,
                          goodsRevenue:
                            row.goodsRevenue ?? row.grossRevenue - (row.timeRevenue ?? 0),
                          timeRevenue: row.timeRevenue ?? 0,
                          invoiceCount: row.completedInvoiceCount,
                        }))}
                      />
                    </Suspense>
                  )}
                </section>
                {data.reportType !== 'CANCELLATIONS' ? (
                  <section className="revenue-compact-card">
                    <div className="revenue-card-title">
                      <h3>Nhịp doanh thu 24 giờ</h3>
                      <span>TB/{data.dayCount} ngày</span>
                    </div>
                    <Suspense fallback={<ChartFallback />}>
                      <HourlyRevenueChart
                        points={data.hourlyAverage.map((row) => ({
                          hour: row.hour,
                          label: row.label,
                          revenue: row.averageRevenue,
                          invoiceCount: row.invoiceCount,
                        }))}
                      />
                    </Suspense>
                  </section>
                ) : null}
              </div>
              {data.reportType === 'OVERVIEW' ? (
                <section className="revenue-compact-card revenue-detail-table-card">
                  <div className="revenue-card-title">
                    <h3>Chi tiết theo thời gian</h3>
                    <span>Vuốt ngang để xem đủ chỉ tiêu</span>
                  </div>
                  <Table
                    size="small"
                    rowKey="key"
                    columns={columns}
                    dataSource={data.timeline}
                    pagination={false}
                    scroll={{ x: 820, y: 280 }}
                  />
                </section>
              ) : null}
            </>
          ) : (
            <Empty description="Chưa có dữ liệu trong kỳ đã chọn" />
          )}
        </>
      ) : null}
      <Modal
        open={hourOpen}
        title="Khung giờ báo cáo"
        okText="Áp dụng"
        cancelText="Hủy"
        onCancel={() => setHourOpen(false)}
        onOk={() => {
          setHourMode(draft.mode);
          setFromHour(draft.fromHour);
          setFromMinute(draft.fromMinute);
          setToHour(draft.toHour);
          setToMinute(draft.toMinute);
          setHourOpen(false);
        }}
      >
        <Radio.Group
          value={draft.mode}
          onChange={(event) => setDraft({ ...draft, mode: event.target.value })}
        >
          <Radio value="all">Cả ngày</Radio>
          <Radio value="custom">Tùy chọn</Radio>
        </Radio.Group>
        {draft.mode === 'custom' && (
          <div className="revenue-report-hour-fields">
            {(['from', 'to'] as const).map((side) => (
              <div key={side}>
                <span>{side === 'from' ? 'Từ' : 'Đến'}</span>
                <Select
                  value={side === 'from' ? draft.fromHour : draft.toHour}
                  onChange={(value) =>
                    setDraft({ ...draft, [side === 'from' ? 'fromHour' : 'toHour']: value })
                  }
                  options={Array.from({ length: 24 }, (_, value) => ({
                    value,
                    label: String(value).padStart(2, '0'),
                  }))}
                />
                <Select
                  value={side === 'from' ? draft.fromMinute : draft.toMinute}
                  onChange={(value) =>
                    setDraft({ ...draft, [side === 'from' ? 'fromMinute' : 'toMinute']: value })
                  }
                  options={[0, 15, 30, 45].map((value) => ({
                    value,
                    label: String(value).padStart(2, '0'),
                  }))}
                />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
