import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilterOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Popover,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

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

export function OwnerInvoicesPage() {
  const [messageApi, contextHolder] = message.useMessage();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [tabStatus, setTabStatus] = useState<FilterStatus>('ALL');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

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
    queryKey: ['owner-invoices', params],
    queryFn: () => apiRequest<InvoiceListResponse>(`/api/v1/owner/invoices?${params}`),
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
      width: 100,
      align: 'center',
      render: (_: unknown, row: Invoice) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setSelectedOrderId(row.orderId)}
        >
          Chi tiết
        </Button>
      ),
    });

    return cols;
  }, [visibleKeys]);

  // ── Excel export ─────────────────────────────────────────────────────────
  const handleExport = () => {
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
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 10, color: '#0975F7' }} />
            Hóa đơn bán hàng
          </Typography.Title>
          <Typography.Text type="secondary">
            Xem và tìm kiếm tất cả hóa đơn được lập trong hệ thống.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          disabled={!data?.results.length}
          className="owner-invoices-export-btn"
        >
          Xuất Excel
        </Button>
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

      {/* ── Table ── */}
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
    </div>
  );
}
