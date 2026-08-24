import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilterOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popover,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';

import type { AuthContextResponse } from '@contracts/auth';
import { apiRequest } from '@client/lib/api';
import { OrderDetailPage } from '@client/features/pos/OrderDetailPage';

// ─── Types ───────────────────────────────────────────────────────────────────

type InvoiceStatus = 'COMPLETED' | 'CANCELLED';
type OrderType = 'DINE_IN' | 'TAKEAWAY';
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

interface Invoice {
  id: string;
  orderId: string;
  displayCode: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  status: InvoiceStatus;
  issuedAt: number;
  orderType: OrderType;
  method: PaymentMethod | null;
  cashReceived: number | null;
  cashChange: number | null;
  actorName: string | null;
  tableName: string | null;
  areaName: string | null;
}

interface InvoiceListResponse {
  results: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type FilterStatus = 'ALL' | 'PAID' | 'CANCELLED';

interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function methodLabel(method: PaymentMethod | null) {
  if (method === 'CASH') return 'Tiền mặt';
  if (method === 'BANK_TRANSFER') return 'Chuyển khoản';
  return '—';
}

function statusTag(status: InvoiceStatus) {
  if (status === 'COMPLETED')
    return (
      <Tag color="success" icon={<CheckCircleOutlined />}>
        Đã thanh toán
      </Tag>
    );
  return (
    <Tag color="error" icon={<CloseCircleOutlined />}>
      Đã hủy
    </Tag>
  );
}

function orderTypeTag(type: OrderType) {
  if (type === 'DINE_IN')
    return (
      <Tag icon={<ShopOutlined />} color="blue">
        Tại chỗ
      </Tag>
    );
  return (
    <Tag icon={<ShoppingCartOutlined />} color="purple">
      Mang đi
    </Tag>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────

const ALL_OPTIONAL_COLUMNS: ColumnConfig[] = [
  { key: 'orderType', label: 'Loại hình', visible: true },
  { key: 'tableName', label: 'Bàn / Khu vực', visible: true },
  { key: 'actorName', label: 'Thu ngân / Người xử lý', visible: true },
  { key: 'method', label: 'Phương thức TT', visible: true },
  { key: 'subtotal', label: 'Tiền hàng', visible: false },
  { key: 'discountTotal', label: 'Giảm giá', visible: false },
  { key: 'cashReceived', label: 'Tiền nhận', visible: false },
  { key: 'cashChange', label: 'Tiền thối', visible: false },
];

// ─── Component ───────────────────────────────────────────────────────────────

export interface InvoicesPageProps {
  apiPrefix?: string | undefined;
  userPermissions?: string[] | undefined;
  isOwner?: boolean | undefined;
  onBack?: (() => void | Promise<void>) | undefined;
}

export function OwnerInvoicesPage({
  apiPrefix = '/api/v1/owner/invoices',
  userPermissions,
  isOwner,
  onBack,
}: InvoicesPageProps = {}) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerRole = isOwner ?? authQuery.data?.actor?.kind === 'OWNER';
  const hasPermission = (perm: string) =>
    isOwnerRole || (userPermissions ? userPermissions.includes(perm) : true);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [tabStatus, setTabStatus] = useState<FilterStatus>('ALL');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);

  // Advanced filter drawer
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterOrderType, setFilterOrderType] = useState<OrderType | undefined>();
  const [filterMethod, setFilterMethod] = useState<PaymentMethod | undefined>();
  const [filterDateFrom, setFilterDateFrom] = useState<string | null>(null);
  const [filterDateTo, setFilterDateTo] = useState<string | null>(null);

  // Column visibility
  const [columns, setColumns] = useState<ColumnConfig[]>(ALL_OPTIONAL_COLUMNS);
  const [columnPopoverOpen, setColumnPopoverOpen] = useState(false);

  const activeFilterCount = [filterOrderType, filterMethod, filterDateFrom, filterDateTo].filter(
    Boolean,
  ).length;

  // ── Delete Mutation ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (targetId: string) =>
      apiRequest<{ deleted: boolean }>(`${apiPrefix}/${targetId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authQuery.data?.csrfToken ?? '' },
      }),
    onSuccess: async () => {
      void messageApi.success('Đã xóa hóa đơn thành công.');
      setDeletingInvoice(null);
      setSelectedOrderId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [apiPrefix] }),
        queryClient.invalidateQueries({ queryKey: ['/api/v1/owner/invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/v1/pos/invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-invoice'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-order-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-tables'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-analytics'] }),
      ]);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Không thể xóa hóa đơn.';
      void messageApi.error(msg);
    },
  });

  // ── Query ──────────────────────────────────────────────────────────────────
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (tabStatus === 'PAID') p.set('status', 'PAID');
    else if (tabStatus === 'CANCELLED') p.set('status', 'CANCELLED');
    if (search) p.set('search', search);
    if (filterOrderType) p.set('orderType', filterOrderType);
    if (filterMethod) p.set('method', filterMethod);
    if (filterDateFrom) p.set('dateFrom', filterDateFrom);
    if (filterDateTo) p.set('dateTo', filterDateTo);
    p.set('page', String(page));
    p.set('limit', String(limit));
    return p.toString();
  }, [tabStatus, search, filterOrderType, filterMethod, filterDateFrom, filterDateTo, page, limit]);

  const invoiceQuery = useQuery({
    queryKey: [apiPrefix, params],
    queryFn: () => apiRequest<InvoiceListResponse>(`${apiPrefix}?${params}`),
  });

  const data = invoiceQuery.data;

  // ── Column config ──────────────────────────────────────────────────────────
  const visibleKeys = useMemo(
    () => new Set(columns.filter((c) => c.visible).map((c) => c.key)),
    [columns],
  );

  const tableColumns: TableColumnsType<Invoice> = useMemo(() => {
    const cols: TableColumnsType<Invoice> = [
      {
        key: 'displayCode',
        title: 'Mã đơn / HĐ',
        dataIndex: 'displayCode',
        fixed: 'left',
        width: 150,
        render: (code: string, row: Invoice) => (
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', fontWeight: 600 }}
            onClick={() => setSelectedOrderId(row.orderId)}
          >
            <span className="owner-invoice-code">{code}</span>
          </Button>
        ),
      },
      {
        key: 'issuedAt',
        title: 'Thời gian',
        dataIndex: 'issuedAt',
        width: 160,
        sorter: (a, b) => a.issuedAt - b.issuedAt,
        render: (ms: number) => (
          <span className="owner-invoice-datetime">{formatDateTime(ms)}</span>
        ),
      },
      {
        key: 'status',
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 150,
        render: (status: InvoiceStatus) => statusTag(status),
      },
    ];

    if (visibleKeys.has('orderType')) {
      cols.push({
        key: 'orderType',
        title: 'Loại hình',
        dataIndex: 'orderType',
        width: 120,
        render: (type: OrderType) => orderTypeTag(type),
      });
    }

    if (visibleKeys.has('tableName')) {
      cols.push({
        key: 'tableName',
        title: 'Bàn / Khu vực',
        dataIndex: 'tableName',
        width: 160,
        render: (_: unknown, row: Invoice) => {
          if (!row.tableName) return <span className="owner-invoice-dim">—</span>;
          return (
            <span>
              {row.tableName}
              {row.areaName ? (
                <small className="owner-invoice-sub-text"> · {row.areaName}</small>
              ) : null}
            </span>
          );
        },
      });
    }

    if (visibleKeys.has('actorName')) {
      cols.push({
        key: 'actorName',
        title: 'Thu ngân / Người xử lý',
        dataIndex: 'actorName',
        width: 170,
        render: (name: string | null) => name ?? <span className="owner-invoice-dim">—</span>,
      });
    }

    if (visibleKeys.has('method')) {
      cols.push({
        key: 'method',
        title: 'Phương thức TT',
        dataIndex: 'method',
        width: 145,
        render: (method: PaymentMethod | null) => (
          <span>
            {method === 'CASH' ? (
              <WalletOutlined style={{ marginRight: 6, color: '#22c55e' }} />
            ) : method === 'BANK_TRANSFER' ? (
              <WalletOutlined style={{ marginRight: 6, color: '#3b82f6' }} />
            ) : null}
            {methodLabel(method)}
          </span>
        ),
      });
    }

    if (visibleKeys.has('subtotal')) {
      cols.push({
        key: 'subtotal',
        title: 'Tiền hàng',
        dataIndex: 'subtotal',
        width: 130,
        align: 'right',
        render: (v: number) => formatMoney(v),
      });
    }

    if (visibleKeys.has('discountTotal')) {
      cols.push({
        key: 'discountTotal',
        title: 'Giảm giá',
        dataIndex: 'discountTotal',
        width: 120,
        align: 'right',
        render: (v: number) =>
          v > 0 ? (
            <span style={{ color: '#ef4444' }}>-{formatMoney(v)}</span>
          ) : (
            <span className="owner-invoice-dim">0đ</span>
          ),
      });
    }

    if (visibleKeys.has('cashReceived')) {
      cols.push({
        key: 'cashReceived',
        title: 'Tiền nhận',
        dataIndex: 'cashReceived',
        width: 130,
        align: 'right',
        render: (v: number | null) =>
          v !== null ? formatMoney(v) : <span className="owner-invoice-dim">—</span>,
      });
    }

    if (visibleKeys.has('cashChange')) {
      cols.push({
        key: 'cashChange',
        title: 'Tiền thối',
        dataIndex: 'cashChange',
        width: 120,
        align: 'right',
        render: (v: number | null) =>
          v !== null ? formatMoney(v) : <span className="owner-invoice-dim">—</span>,
      });
    }

    cols.push({
      key: 'total',
      title: 'Tổng tiền',
      dataIndex: 'total',
      width: 140,
      align: 'right',
      fixed: 'right',
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => <strong className="owner-invoice-total">{formatMoney(v)}</strong>,
    });

    cols.push({
      key: 'actions',
      title: 'Thao tác',
      fixed: 'right',
      width: hasPermission('invoice.delete') ? 145 : 95,
      align: 'center',
      render: (_: unknown, row: Invoice) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setSelectedOrderId(row.orderId)}
          >
            Chi tiết
          </Button>
          {hasPermission('invoice.delete') ? (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => setDeletingInvoice(row)}
            >
              Xóa
            </Button>
          ) : null}
        </Space>
      ),
    });

    return cols;
  }, [visibleKeys]);

  // ── Excel export ─────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!data?.results.length) {
      void messageApi.warning('Không có dữ liệu để xuất.');
      return;
    }
    const rows = data.results.map((inv) => ({
      'Mã đơn / HĐ': inv.displayCode,
      'Thời gian': formatDateTime(inv.issuedAt),
      'Trạng thái': inv.status === 'COMPLETED' ? 'Đã thanh toán' : 'Đã hủy',
      'Loại hình': inv.orderType === 'DINE_IN' ? 'Tại chỗ' : 'Mang đi',
      Bàn: inv.tableName ?? '',
      'Khu vực': inv.areaName ?? '',
      'Thu ngân / Người xử lý': inv.actorName ?? '',
      'Phương thức TT': methodLabel(inv.method),
      'Tiền hàng': inv.subtotal,
      'Giảm giá': inv.discountTotal,
      'Tổng tiền': inv.total,
      'Tiền nhận': inv.cashReceived ?? '',
      'Tiền thối': inv.cashChange ?? '',
    }));
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hóa đơn');
    const dateStr = new Date().toLocaleDateString('vi-VN').replaceAll('/', '-');
    XLSX.writeFile(wb, `hoa-don-${dateStr}.xlsx`);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleTabChange = (key: string) => {
    setTabStatus(key as FilterStatus);
    setPage(1);
  };

  const handleApplyFilter = () => {
    setPage(1);
    setFilterOpen(false);
  };

  const handleResetFilter = () => {
    setFilterOrderType(undefined);
    setFilterMethod(undefined);
    setFilterDateFrom(null);
    setFilterDateTo(null);
    setPage(1);
    setFilterOpen(false);
  };

  const handleColumnToggle = (key: string, checked: boolean) => {
    setColumns((prev) => prev.map((col) => (col.key === key ? { ...col, visible: checked } : col)));
  };

  // ── Column customization popover ──────────────────────────────────────────
  const columnPopoverContent = (
    <div className="owner-invoice-col-picker">
      <div className="owner-invoice-col-picker__title">Chọn cột hiển thị</div>
      {columns.map((col) => (
        <div key={col.key} className="owner-invoice-col-picker__row">
          <Checkbox
            checked={col.visible}
            onChange={(e) => handleColumnToggle(col.key, e.target.checked)}
          >
            {col.label}
          </Checkbox>
        </div>
      ))}
    </div>
  );

  // ── Tab items ──────────────────────────────────────────────────────────────
  const tabItems = [
    { key: 'ALL', label: 'Tất cả hóa đơn' },
    { key: 'PAID', label: 'Đã thanh toán' },
    { key: 'CANCELLED', label: 'Đã hủy' },
  ];

  return (
    <div className="owner-invoices-page">
      {contextHolder}

      {/* ── Page header ── */}
      <div className="owner-page-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack ? (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              size="middle"
              style={{ fontWeight: 600 }}
            >
              Quay lại
            </Button>
          ) : null}
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>
              <FileTextOutlined style={{ marginRight: 10, color: '#0975F7' }} />
              Hóa đơn bán hàng
            </Typography.Title>
            <Typography.Text type="secondary">
              Xem và tìm kiếm tất cả hóa đơn được lập trong hệ thống.
            </Typography.Text>
          </div>
        </div>
        {hasPermission('invoice.export') ? (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => void handleExport()}
            disabled={!data?.results.length}
            className="owner-invoices-export-btn"
          >
            Xuất Excel
          </Button>
        ) : null}
      </div>

      {/* ── Tabs ── */}
      <Tabs
        activeKey={tabStatus}
        onChange={handleTabChange}
        className="owner-invoices-tabs"
        items={tabItems.map((tab) => ({ key: tab.key, label: tab.label }))}
      />

      {/* ── Toolbar ── */}
      <div className="owner-invoices-toolbar">
        <Badge count={activeFilterCount} size="small" color="#0975F7">
          <Button
            icon={<FilterOutlined />}
            onClick={() => setFilterOpen(true)}
            className={activeFilterCount > 0 ? 'owner-invoices-filter-active' : ''}
          >
            Lọc hóa đơn
          </Button>
        </Badge>

        <Input.Search
          allowClear
          placeholder="Tìm kiếm mã hóa đơn..."
          prefix={<SearchOutlined />}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={handleSearch}
          onPressEnter={handleSearch}
          className="owner-invoices-search"
        />

        <div className="owner-invoices-toolbar-right">
          <Tooltip title="Làm mới">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void invoiceQuery.refetch()}
              loading={invoiceQuery.isFetching}
            />
          </Tooltip>

          <Popover
            trigger="click"
            content={columnPopoverContent}
            open={columnPopoverOpen}
            onOpenChange={setColumnPopoverOpen}
            placement="bottomRight"
          >
            <Button icon={<SettingOutlined />}>Tùy chỉnh cột</Button>
          </Popover>
        </div>
      </div>

      {/* ── Content (Desktop Table + Mobile Cards) ── */}
      {invoiceQuery.isError ? (
        <div className="owner-invoices-error">
          <Typography.Text type="danger">Không thể tải danh sách hóa đơn.</Typography.Text>
          <Button size="small" onClick={() => void invoiceQuery.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : invoiceQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          {/* Desktop Table View (>= 768px) */}
          <div className="owner-invoices-desktop-view">
            <Table<Invoice>
              rowKey="id"
              dataSource={data?.results ?? []}
              columns={tableColumns}
              scroll={{ x: 'max-content' }}
              className="owner-invoices-table"
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Không tìm thấy hóa đơn nào"
                  />
                ),
              }}
              pagination={{
                current: page,
                pageSize: limit,
                total: data?.total ?? 0,
                showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} trên tổng ${total}`,
                onChange: (p) => setPage(p),
                showSizeChanger: false,
                className: 'owner-invoices-pagination',
              }}
            />
          </div>

          {/* Mobile Card List View (< 768px) */}
          <div className="owner-invoices-mobile-view">
            {!data?.results || data.results.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Không tìm thấy hóa đơn nào"
                style={{ padding: '32px 0' }}
              />
            ) : (
              <div className="pos-invoice-mobile-list">
                {data.results.map((row) => (
                  <div className="pos-invoice-mobile-card" key={row.id}>
                    <div className="pos-invoice-mobile-card__header">
                      <div className="pos-invoice-mobile-card__code">
                        <Button
                          type="link"
                          style={{ padding: 0, height: 'auto', fontWeight: 700 }}
                          onClick={() => setSelectedOrderId(row.orderId)}
                        >
                          <span className="owner-invoice-code">{row.displayCode}</span>
                        </Button>
                        {orderTypeTag(row.orderType)}
                      </div>
                      <strong className="pos-invoice-mobile-card__total">
                        {formatMoney(row.total)}
                      </strong>
                    </div>

                    <div className="pos-invoice-mobile-card__meta">
                      <div className="pos-invoice-mobile-card__meta-item">
                        <ClockCircleOutlined style={{ color: '#94a3b8' }} />
                        <span>{formatDateTime(row.issuedAt)}</span>
                      </div>
                      {row.tableName ? (
                        <div className="pos-invoice-mobile-card__meta-item">
                          <ShopOutlined style={{ color: '#94a3b8' }} />
                          <span>
                            {row.tableName}
                            {row.areaName ? ` · ${row.areaName}` : ''}
                          </span>
                        </div>
                      ) : null}
                      <div className="pos-invoice-mobile-card__meta-item">
                        <WalletOutlined
                          style={{ color: row.method === 'CASH' ? '#22c55e' : '#3b82f6' }}
                        />
                        <span>{methodLabel(row.method)}</span>
                      </div>
                      {row.actorName ? (
                        <div className="pos-invoice-mobile-card__meta-item">
                          <UserOutlined style={{ color: '#94a3b8' }} />
                          <span>{row.actorName}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="pos-invoice-mobile-card__footer">
                      <div className="pos-invoice-mobile-card__status">
                        {statusTag(row.status)}
                        {row.discountTotal > 0 ? (
                          <span className="pos-invoice-mobile-card__discount">
                            Giảm: -{formatMoney(row.discountTotal)}
                          </span>
                        ) : null}
                      </div>
                      <div className="pos-invoice-mobile-card__actions">
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          icon={<EyeOutlined />}
                          onClick={() => setSelectedOrderId(row.orderId)}
                        >
                          Chi tiết
                        </Button>
                        {hasPermission('invoice.delete') ? (
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => setDeletingInvoice(row)}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Mobile Pagination */}
                {data.total > limit ? (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                    <Pagination
                      current={page}
                      pageSize={limit}
                      total={data.total}
                      onChange={(p) => setPage(p)}
                      simple
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Advanced filter drawer ── */}
      <Drawer
        title="Bộ lọc nâng cao"
        placement="right"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        width={340}
        footer={
          <div className="owner-invoices-filter-footer">
            <Button onClick={handleResetFilter}>Xóa bộ lọc</Button>
            <Button type="primary" onClick={handleApplyFilter}>
              Áp dụng
            </Button>
          </div>
        }
      >
        <Form layout="vertical" className="owner-invoices-filter-form">
          <Form.Item label="Loại hình đơn hàng">
            <Select
              allowClear
              placeholder="Tất cả loại hình"
              value={filterOrderType}
              onChange={(v) => setFilterOrderType(v)}
              options={[
                { label: 'Tại chỗ', value: 'DINE_IN' },
                { label: 'Mang đi', value: 'TAKEAWAY' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Phương thức thanh toán">
            <Select
              allowClear
              placeholder="Tất cả phương thức"
              value={filterMethod}
              onChange={(v) => setFilterMethod(v)}
              options={[
                { label: 'Tiền mặt', value: 'CASH' },
                { label: 'Chuyển khoản', value: 'BANK_TRANSFER' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Từ ngày">
            <input
              type="date"
              className="owner-invoices-date-input"
              value={filterDateFrom ?? ''}
              onChange={(e) => setFilterDateFrom(e.target.value || null)}
            />
          </Form.Item>

          <Form.Item label="Đến ngày">
            <input
              type="date"
              className="owner-invoices-date-input"
              value={filterDateTo ?? ''}
              onChange={(e) => setFilterDateTo(e.target.value || null)}
            />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ── Order Detail Drawer ── */}
      <Drawer
        open={Boolean(selectedOrderId)}
        onClose={() => setSelectedOrderId(null)}
        width="min(1100px, 92vw)"
        styles={{ body: { padding: 0 } }}
        destroyOnClose
        closable={false}
      >
        {selectedOrderId && (
          <OrderDetailPage orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
        )}
      </Drawer>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        open={Boolean(deletingInvoice)}
        title={null}
        onCancel={() => !deleteMutation.isPending && setDeletingInvoice(null)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeletingInvoice(null)}
            disabled={deleteMutation.isPending}
          >
            Hủy
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            loading={deleteMutation.isPending}
            onClick={() => deletingInvoice && deleteMutation.mutate(deletingInvoice.orderId)}
          >
            Xác nhận xóa
          </Button>,
        ]}
        centered
        width={480}
      >
        <div style={{ padding: '8px 0', fontSize: '14.5px', lineHeight: '1.6' }}>
          <div style={{ fontWeight: 600, fontSize: '16.5px', marginBottom: 14, color: '#0f172a' }}>
            Xin chào {authQuery.data?.actor?.displayName || 'Chủ cửa hàng'}
          </div>
          <p style={{ margin: '0 0 10px 0', color: '#334155' }}>
            Bạn đang thực hiện xóa hóa đơn này của cửa hàng.
          </p>
          <p style={{ margin: '0 0 10px 0', color: '#dc2626', fontWeight: 600 }}>
            Thao tác xóa hóa đơn sẽ xóa tất cả báo cáo liên quan tới hóa đơn
          </p>
          <p style={{ margin: 0, color: '#64748b' }}>
            Thao tác này sẽ không thể khôi phục, hãy cân nhắc kỹ trước khi xóa
          </p>
        </div>
      </Modal>
    </div>
  );
}
