import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Radio,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import type {
  CustomerDetail,
  CustomerGroup,
  CustomerGroupInput,
  CustomerGroupRule,
  CustomerInput,
  CustomerSummary,
} from '@contracts/customer';
import { apiRequest, jsonRequest } from '@client/lib/api';

const LOCATION_API = 'https://provinces.open-api.vn/api/v2';

interface LocationItem {
  code: number;
  name: string;
}

interface CustomerListResponse {
  results: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerPageProps {
  baseRoute?: string;
  apiPrefix?: string;
  userPermissions?: string[] | undefined;
  isOwner?: boolean | undefined;
  onBack?: () => void;
}

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

function mutationHeaders(token?: string | null) {
  return { 'X-CSRF-Token': token ?? '' };
}

// ─── CUSTOMER LIST PAGE ──────────────────────────────────────────────────────

export function OwnerCustomerListPage({
  baseRoute = '/owner/customers',
  apiPrefix = '/api/v1/owner/customers',
  userPermissions,
  isOwner,
  onBack,
}: CustomerPageProps = {}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerUser = isOwner ?? auth.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];

  const canView = isOwnerUser || perms.includes('customer.list.view');
  const canCreate = isOwnerUser || perms.includes('customer.list.create');
  const canEditDebt = isOwnerUser || perms.includes('customer.list.edit_debt');
  const canImportExport = isOwnerUser || perms.includes('customer.list.import_export');
  const canViewGroups = isOwnerUser || perms.includes('customer.groups.view');

  const customers = useQuery({
    queryKey: ['customers-list', apiPrefix, search, status, page],
    queryFn: () =>
      apiRequest<CustomerListResponse>(
        `${apiPrefix}?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=20`,
      ),
    enabled: canView,
  });

  const loyalty = useQuery({
    queryKey: ['customer-loyalty-settings', apiPrefix],
    queryFn: () =>
      apiRequest<{ enabled: boolean; vndPerPoint: number }>(`${apiPrefix}/loyalty-settings`),
    enabled: canView,
  });

  const [enabled, setEnabled] = useState(true);
  const [rate, setRate] = useState(10000);

  useEffect(() => {
    if (loyalty.data) {
      setEnabled(loyalty.data.enabled);
      setRate(loyalty.data.vndPerPoint);
    }
  }, [loyalty.data]);

  const saveLoyalty = async () => {
    try {
      await jsonRequest(
        `${apiPrefix}/loyalty-settings`,
        { enabled, vndPerPoint: rate },
        { method: 'PUT', headers: mutationHeaders(auth.data?.csrfToken) },
      );
      setLoyaltyOpen(false);
      message.success('Đã lưu thiết lập tích điểm.');
    } catch (err: any) {
      message.error(err?.message || 'Không thể lưu thiết lập tích điểm.');
    }
  };

  const exportCustomers = async () => {
    const rows = (customers.data?.results ?? []).map((c) => ({
      'Họ tên': c.name,
      'Số điện thoại': c.phone,
      Email: c.email ?? '',
      'Số đơn': c.invoiceCount,
      'Tổng chi tiêu': c.totalSpentVnd,
      'Điểm tích lũy': c.loyaltyPoints,
      'Công nợ': c.debtBalanceVnd,
      'Trạng thái': c.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã lưu trữ',
    }));
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Khách hàng');
    XLSX.writeFile(workbook, 'danh-sach-khach-hang.xlsx');
  };

  const importCustomers = async (file: File) => {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]!];
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(sheet!);
      const rows = raw.map((r) => ({
        name: String(r['Họ tên'] ?? '').trim(),
        phone: String(r['Số điện thoại'] ?? '').trim(),
        email: String(r['Email'] ?? '').trim() || null,
      }));

      const validation = await jsonRequest<{
        valid: boolean;
        errors: Array<{ row: number; message: string }>;
      }>(
        `${apiPrefix}/import/validate`,
        { rows },
        { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
      );

      if (!validation.valid) {
        Modal.error({
          title: 'File chưa hợp lệ',
          content: (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {validation.errors.map((e, idx) => (
                <div key={idx} style={{ color: '#dc2626', marginBottom: 4 }}>
                  Dòng {e.row}: {e.message}
                </div>
              ))}
            </div>
          ),
        });
        return;
      }

      await jsonRequest(
        `${apiPrefix}/import`,
        { rows },
        { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
      );
      message.success(`Đã nhập thành công ${rows.length} khách hàng.`);
      await customers.refetch();
    } catch (err: any) {
      message.error(err?.message || 'Không thể nhập file Excel.');
    }
  };

  if (!canView) {
    return (
      <div className="owner-customer-page" style={{ padding: '24px 0' }}>
        <Alert
          type="warning"
          showIcon
          title="Không có quyền truy cập"
          description="Bạn không có quyền xem danh sách khách hàng. Vui lòng liên hệ quản lý để được phân quyền."
        />
      </div>
    );
  }

  const groupsRoute =
    baseRoute === '/owner/customers' ? '/owner/customer-groups' : `${baseRoute}/groups`;

  return (
    <div className="owner-customer-page">
      {onBack ? (
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          style={{ paddingLeft: 0, marginBottom: 12 }}
        >
          Quay lại
        </Button>
      ) : null}

      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Khách hàng
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13.5 }}>
            Quản lý hồ sơ, chi tiêu, điểm tích lũy và công nợ khách hàng
          </Typography.Text>
        </div>
        <Space wrap size={[8, 8]}>
          {canViewGroups ? (
            <Button icon={<TeamOutlined />} onClick={() => navigate(groupsRoute)}>
              Nhóm khách hàng
            </Button>
          ) : null}

          {canImportExport ? (
            <>
              <input
                ref={importInput}
                hidden
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importCustomers(file);
                  e.target.value = '';
                }}
              />
              <Button icon={<UploadOutlined />} onClick={() => importInput.current?.click()}>
                Nhập Excel
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => void exportCustomers()}>
                Xuất Excel
              </Button>
            </>
          ) : null}

          {isOwnerUser || canEditDebt ? (
            <Button icon={<SettingOutlined />} onClick={() => setLoyaltyOpen(true)}>
              Thiết lập tích điểm
            </Button>
          ) : null}

          {canCreate ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate(`${baseRoute}/new`)}
            >
              Thêm khách hàng
            </Button>
          ) : null}
        </Space>
      </div>

      <Card styles={{ body: { padding: '16px' } }}>
        <div className="owner-customer-toolbar">
          <Input.Search
            allowClear
            size="large"
            placeholder="Tìm theo họ tên hoặc số điện thoại"
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Select
            size="large"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'ACTIVE', label: 'Đang hoạt động' },
              { value: 'ARCHIVED', label: 'Đã lưu trữ' },
            ]}
          />
        </div>

        {/* ── Desktop Table View (>= 769px) ───────────────────────────── */}
        <div className="owner-customer-desktop-view">
          <Table
            rowKey="id"
            loading={customers.isLoading}
            dataSource={customers.data?.results ?? []}
            pagination={{
              current: page,
              pageSize: 20,
              total: customers.data?.total ?? 0,
              onChange: setPage,
              showTotal: (total) => `Tổng ${total} khách hàng`,
            }}
            onRow={(record) => ({
              onClick: () => navigate(`${baseRoute}/${record.id}`),
            })}
            columns={[
              {
                title: 'Khách hàng',
                render: (_, r) => (
                  <Space>
                    <Avatar
                      style={{ background: '#0975f7', color: '#fff' }}
                      icon={<UserOutlined />}
                    />
                    <div>
                      <strong style={{ color: '#0f172a' }}>{r.name}</strong>
                      <div style={{ color: '#64748b', fontSize: 13 }}>{r.phone}</div>
                    </div>
                  </Space>
                ),
              },
              {
                title: 'Nhóm',
                render: (_, r) => (
                  <Space wrap>
                    {r.groups?.length ? (
                      r.groups.map((g) => (
                        <Tag color="blue" key={g.id}>
                          {g.name}
                        </Tag>
                      ))
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Số đơn',
                dataIndex: 'invoiceCount',
                align: 'center',
                render: (count) => <strong>{count}</strong>,
              },
              {
                title: 'Tổng chi tiêu',
                render: (_, r) => <strong>{money(r.totalSpentVnd)}</strong>,
              },
              {
                title: 'Điểm',
                dataIndex: 'loyaltyPoints',
                align: 'center',
                render: (pts) => <Tag color="gold">{pts} đ</Tag>,
              },
              {
                title: 'Công nợ',
                render: (_, r) => (
                  <strong style={{ color: r.debtBalanceVnd > 0 ? '#dc2626' : '#166534' }}>
                    {money(r.debtBalanceVnd)}
                  </strong>
                ),
              },
              {
                title: 'Trạng thái',
                render: (_, r) => (
                  <Tag color={r.status === 'ACTIVE' ? 'green' : 'default'}>
                    {r.status === 'ACTIVE' ? 'Hoạt động' : 'Đã lưu trữ'}
                  </Tag>
                ),
              },
            ]}
          />
        </div>

        {/* ── Mobile Touch Cards View (< 769px) ────────────────────────── */}
        <div className="owner-customer-mobile-view">
          {customers.isLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (customers.data?.results ?? []).length === 0 ? (
            <Empty description="Không tìm thấy khách hàng nào" style={{ padding: '24px 0' }} />
          ) : (
            <>
              {(customers.data?.results ?? []).map((r) => (
                <div
                  key={r.id}
                  className="customer-mobile-card"
                  onClick={() => navigate(`${baseRoute}/${r.id}`)}
                >
                  <div className="customer-mobile-card__header">
                    <div className="customer-mobile-card__user">
                      <Avatar
                        size={40}
                        style={{
                          background: '#0975f7',
                          color: '#fff',
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                        icon={<UserOutlined />}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="customer-mobile-card__name">{r.name}</div>
                        <div className="customer-mobile-card__phone">{r.phone}</div>
                      </div>
                    </div>
                    <Tag color={r.status === 'ACTIVE' ? 'green' : 'default'} style={{ margin: 0 }}>
                      {r.status === 'ACTIVE' ? 'Hoạt động' : 'Lưu trữ'}
                    </Tag>
                  </div>

                  {r.groups?.length ? (
                    <div style={{ marginBottom: 6 }}>
                      <Space wrap size={[4, 4]}>
                        {r.groups.map((g) => (
                          <Tag color="blue" key={g.id} style={{ fontSize: 11, margin: 0 }}>
                            {g.name}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  ) : null}

                  <div className="customer-mobile-card__metrics">
                    <div className="customer-mobile-card__metric-item">
                      <span className="customer-mobile-card__metric-label">Tổng chi tiêu</span>
                      <span className="customer-mobile-card__metric-val">
                        {money(r.totalSpentVnd)}
                      </span>
                    </div>
                    <div className="customer-mobile-card__metric-item">
                      <span className="customer-mobile-card__metric-label">Công nợ</span>
                      <span
                        className="customer-mobile-card__metric-val"
                        style={{ color: r.debtBalanceVnd > 0 ? '#dc2626' : '#166534' }}
                      >
                        {money(r.debtBalanceVnd)}
                      </span>
                    </div>
                    <div className="customer-mobile-card__metric-item">
                      <span className="customer-mobile-card__metric-label">Số đơn</span>
                      <span className="customer-mobile-card__metric-val">{r.invoiceCount} đơn</span>
                    </div>
                    <div className="customer-mobile-card__metric-item">
                      <span className="customer-mobile-card__metric-label">Điểm tích lũy</span>
                      <span
                        className="customer-mobile-card__metric-val"
                        style={{ color: '#d97706' }}
                      >
                        {r.loyaltyPoints} đ
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <Pagination
                  simple
                  current={page}
                  pageSize={20}
                  total={customers.data?.total ?? 0}
                  onChange={setPage}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      <Modal
        title="Thiết lập tích điểm thành viên"
        open={loyaltyOpen}
        onCancel={() => setLoyaltyOpen(false)}
        onOk={() => void saveLoyalty()}
        okText="Lưu thiết lập"
        cancelText="Hủy"
        width="min(460px, 95vw)"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Space>
            <Switch checked={enabled} onChange={setEnabled} />
            <span>Tự động tích điểm khi hoàn tất hóa đơn</span>
          </Space>
          <label>
            Số tiền chi tiêu tương ứng 1 điểm
            <InputNumber
              min={1}
              size="large"
              value={rate}
              onChange={(v) => setRate(v ?? 10000)}
              addonAfter="đ / điểm"
              style={{ width: '100%', marginTop: 6 }}
            />
          </label>
        </Space>
      </Modal>
    </div>
  );
}

// ─── CUSTOMER FORM PAGE (CREATE / EDIT) ──────────────────────────────────────

export function OwnerCustomerFormPage({
  customerId,
  baseRoute = '/owner/customers',
  apiPrefix = '/api/v1/owner/customers',
  userPermissions,
  isOwner,
  onBack,
}: CustomerPageProps & { customerId?: string } = {}) {
  const navigate = useNavigate();
  const [form] = Form.useForm<CustomerInput>();

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerUser = isOwner ?? auth.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];
  const canCreate = isOwnerUser || perms.includes('customer.list.create');
  const canEdit = isOwnerUser || perms.includes('customer.list.edit_debt');

  const customer = useQuery({
    queryKey: ['customer-detail', apiPrefix, customerId],
    queryFn: () => apiRequest<CustomerDetail>(`${apiPrefix}/${customerId}`),
    enabled: Boolean(customerId),
  });

  const provinces = useQuery({
    queryKey: ['vn-provinces-v2'],
    queryFn: () => apiRequest<LocationItem[]>(`${LOCATION_API}/p/`),
  });

  const provinceCode = Form.useWatch('provinceCode', form);
  const wards = useQuery({
    queryKey: ['vn-wards-v2', provinceCode],
    queryFn: () => apiRequest<LocationItem[]>(`${LOCATION_API}/w/?province=${provinceCode}`),
    enabled: Boolean(provinceCode),
  });

  useEffect(() => {
    if (customer.data) form.setFieldsValue(customer.data);
  }, [customer.data, form]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(baseRoute);
    }
  };

  const save = async (values: CustomerInput) => {
    if (customerId && !canEdit) {
      message.error('Bạn không có quyền chỉnh sửa khách hàng.');
      return;
    }
    if (!customerId && !canCreate) {
      message.error('Bạn không có quyền tạo khách hàng mới.');
      return;
    }

    try {
      const province = provinces.data?.find((i) => i.code === values.provinceCode);
      const ward = wards.data?.find((i) => i.code === values.wardCode);
      const payload = {
        ...values,
        provinceName: province?.name ?? null,
        wardName: ward?.name ?? null,
      };

      await jsonRequest(customerId ? `${apiPrefix}/${customerId}` : apiPrefix, payload, {
        method: customerId ? 'PUT' : 'POST',
        headers: mutationHeaders(auth.data?.csrfToken),
      });
      message.success(customerId ? 'Đã cập nhật khách hàng.' : 'Đã thêm khách hàng mới.');
      handleBack();
    } catch (err: any) {
      message.error(err?.message || 'Không thể lưu thông tin khách hàng.');
    }
  };

  return (
    <div className="owner-customer-form">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={handleBack}
        style={{ paddingLeft: 0, marginBottom: 12 }}
      >
        Danh sách khách hàng
      </Button>

      <Typography.Title level={2} style={{ marginBottom: 20 }}>
        {customerId ? 'Chỉnh sửa khách hàng' : 'Thêm mới khách hàng'}
      </Typography.Title>

      <Form form={form} layout="vertical" onFinish={(v) => void save(v)}>
        <Card title="Thông tin cơ bản">
          <Row gutter={[16, 12]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Họ tên"
                rules={[{ required: true, message: 'Vui lòng nhập họ tên' }]}
              >
                <Input size="large" placeholder="Ví dụ: Nguyễn Văn A" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="phone"
                label="Số điện thoại"
                rules={[
                  { required: true, message: 'Vui lòng nhập số điện thoại' },
                  {
                    pattern: /^(?:02\d{8,9}|0[35789]\d{8})$/,
                    message: 'SĐT Việt Nam không hợp lệ',
                  },
                ]}
              >
                <Input size="large" placeholder="0901234567" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email">
                <Input size="large" placeholder="email@domain.com" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="birthDate" label="Ngày sinh">
                <Input size="large" type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="gender" label="Giới tính">
                <Select
                  size="large"
                  allowClear
                  placeholder="Chọn giới tính"
                  options={[
                    { value: 'MALE', label: 'Nam' },
                    { value: 'FEMALE', label: 'Nữ' },
                    { value: 'OTHER', label: 'Khác' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="Địa chỉ" style={{ marginTop: 16 }}>
          <Row gutter={[16, 12]}>
            <Col xs={24} md={12}>
              <Form.Item name="provinceCode" label="Tỉnh / Thành phố">
                <Select
                  size="large"
                  showSearch
                  allowClear
                  placeholder="Chọn Tỉnh / Thành phố"
                  optionFilterProp="label"
                  options={provinces.data?.map((i) => ({ value: i.code, label: i.name })) ?? []}
                  onChange={() => form.setFieldValue('wardCode', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="wardCode" label="Phường / Xã">
                <Select
                  size="large"
                  showSearch
                  allowClear
                  placeholder="Chọn Phường / Xã"
                  optionFilterProp="label"
                  disabled={!provinceCode}
                  options={wards.data?.map((i) => ({ value: i.code, label: i.name })) ?? []}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="addressLine" label="Địa chỉ cụ thể">
                <Input size="large" placeholder="Số nhà, tên đường..." />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="Ghi chú" style={{ marginTop: 16 }}>
          <Form.Item name="note">
            <Input.TextArea rows={3} placeholder="Ghi chú về sở thích, thói quen của khách..." />
          </Form.Item>
        </Card>

        <Space wrap size="middle" style={{ marginTop: 20 }}>
          <Button size="large" onClick={handleBack}>
            Hủy
          </Button>
          <Button size="large" type="primary" htmlType="submit">
            Lưu khách hàng
          </Button>
        </Space>
      </Form>
    </div>
  );
}

// ─── CUSTOMER DETAIL PAGE ────────────────────────────────────────────────────

export function OwnerCustomerDetailPage({
  customerId,
  baseRoute = '/owner/customers',
  apiPrefix = '/api/v1/owner/customers',
  userPermissions,
  isOwner,
  onBack,
}: CustomerPageProps & { customerId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [debtPayOpen, setDebtPayOpen] = useState(false);
  const [debtPayAmount, setDebtPayAmount] = useState<number | null>(null);
  const [debtPayMethod, setDebtPayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [debtPayNote, setDebtPayNote] = useState('');

  const [debtAdjustOpen, setDebtAdjustOpen] = useState(false);
  const [debtAdjustAmount, setDebtAdjustAmount] = useState<number | null>(null);
  const [debtAdjustReason, setDebtAdjustReason] = useState('');

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerUser = isOwner ?? auth.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];
  const canEdit = isOwnerUser || perms.includes('customer.list.edit_debt');
  const canDelete = isOwnerUser || perms.includes('customer.list.delete');
  const canEditDebt = isOwnerUser || perms.includes('customer.list.edit_debt');

  const customer = useQuery({
    queryKey: ['customer-detail', apiPrefix, customerId],
    queryFn: () => apiRequest<CustomerDetail>(`${apiPrefix}/${customerId}`),
  });

  const c = customer.data;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(baseRoute);
    }
  };

  const collectDebt = async () => {
    if (!debtPayAmount || debtPayAmount <= 0) {
      message.error('Vui lòng nhập số tiền thu nợ.');
      return;
    }
    try {
      await jsonRequest(
        `${apiPrefix}/${customerId}/debt-payments`,
        {
          amountVnd: debtPayAmount,
          method: debtPayMethod,
          note: debtPayNote.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
        { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
      );
      message.success('Thu nợ thành công.');
      setDebtPayOpen(false);
      setDebtPayAmount(null);
      setDebtPayNote('');
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', apiPrefix, customerId] });
    } catch (err: any) {
      message.error(err?.message || 'Không thể thu nợ.');
    }
  };

  const adjustDebt = async () => {
    if (!debtAdjustAmount || debtAdjustAmount === 0) {
      message.error('Vui lòng nhập số tiền điều chỉnh khác 0.');
      return;
    }
    if (!debtAdjustReason.trim()) {
      message.error('Vui lòng nhập lý do điều chỉnh công nợ.');
      return;
    }
    try {
      await jsonRequest(
        `${apiPrefix}/${customerId}/debt-adjustments`,
        {
          amountVnd: debtAdjustAmount,
          reason: debtAdjustReason.trim(),
          idempotencyKey: crypto.randomUUID(),
        },
        { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
      );
      message.success('Điều chỉnh công nợ thành công.');
      setDebtAdjustOpen(false);
      setDebtAdjustAmount(null);
      setDebtAdjustReason('');
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', apiPrefix, customerId] });
    } catch (err: any) {
      message.error(err?.message || 'Không thể điều chỉnh công nợ.');
    }
  };

  const archiveCustomer = async () => {
    try {
      await apiRequest(`${apiPrefix}/${customerId}`, {
        method: 'DELETE',
        headers: mutationHeaders(auth.data?.csrfToken),
      });
      message.success('Đã lưu trữ khách hàng.');
      handleBack();
    } catch (err: any) {
      message.error(err?.message || 'Không thể lưu trữ khách hàng.');
    }
  };

  if (!c) {
    return (
      <div className="owner-customer-page" style={{ padding: '40px 0' }}>
        <Empty description="Đang tải dữ liệu khách hàng..." />
      </div>
    );
  }

  const stats: Array<[string, string | number, string?]> = [
    ['Tổng chi tiêu', money(c.totalSpentVnd), '#0975f7'],
    ['Số hóa đơn', c.invoiceCount],
    ['Chi tiêu trung bình', money(c.averageSpentVnd)],
    ['Điểm tích lũy', `${c.loyaltyPoints} đ`, '#d97706'],
    ['Công nợ hiện tại', money(c.debtBalanceVnd), c.debtBalanceVnd > 0 ? '#dc2626' : '#166534'],
  ];

  return (
    <div className="owner-customer-page">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={handleBack}
        style={{ paddingLeft: 0, marginBottom: 12 }}
      >
        Danh sách khách hàng
      </Button>

      <div className="owner-page-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar
            size={52}
            style={{ background: '#0975f7', color: '#fff', fontSize: 24, flexShrink: 0 }}
            icon={<UserOutlined />}
          />
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={2} style={{ margin: 0, wordBreak: 'break-word' }}>
              {c.name}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              {c.phone} {c.email ? `· ${c.email}` : ''}
            </Typography.Text>
          </div>
        </div>

        <Space wrap>
          {canEdit ? (
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`${baseRoute}/${customerId}/edit`)}
            >
              Chỉnh sửa
            </Button>
          ) : null}

          {canDelete ? (
            <Popconfirm
              title="Lưu trữ khách hàng?"
              description="Khách hàng này sẽ được đưa vào danh sách lưu trữ."
              onConfirm={() => void archiveCustomer()}
              okText="Lưu trữ"
              cancelText="Hủy"
            >
              <Button danger icon={<DeleteOutlined />}>
                Lưu trữ
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>

      <Row gutter={[10, 10]}>
        {stats.map(([cTitle, value, color]) => (
          <Col xs={12} sm={8} lg={4} key={cTitle} style={{ flexGrow: 1 }}>
            <Card styles={{ body: { padding: '14px 12px' } }} style={{ borderRadius: 10 }}>
              <Statistic
                title={<span style={{ fontSize: 12, color: '#64748b' }}>{cTitle}</span>}
                value={value}
                valueStyle={
                  color
                    ? { color, fontWeight: 700, fontSize: 18 }
                    : { fontWeight: 700, fontSize: 18 }
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card styles={{ body: { padding: '16px' } }}>
            <Tabs
              items={[
                {
                  key: 'invoices',
                  label: (
                    <span>
                      <FileTextOutlined /> Hóa đơn ({c.invoices?.length ?? 0})
                    </span>
                  ),
                  children: (
                    <Table
                      rowKey="id"
                      scroll={{ x: 'max-content' }}
                      pagination={c.invoices?.length > 10 ? { pageSize: 10 } : false}
                      dataSource={c.invoices ?? []}
                      columns={[
                        {
                          title: 'Mã hóa đơn',
                          dataIndex: 'displayCode',
                          render: (code) => <strong>{code}</strong>,
                        },
                        {
                          title: 'Thời gian',
                          render: (_, r) => new Date(r.issuedAt).toLocaleString('vi-VN'),
                        },
                        {
                          title: 'Tổng tiền',
                          render: (_, r) => (
                            <strong style={{ color: '#0f172a' }}>{money(r.totalVnd)}</strong>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'points',
                  label: (
                    <span>
                      <WalletOutlined /> Điểm tích lũy ({c.loyaltyEntries?.length ?? 0})
                    </span>
                  ),
                  children: (
                    <Table
                      rowKey="id"
                      scroll={{ x: 'max-content' }}
                      pagination={c.loyaltyEntries?.length > 10 ? { pageSize: 10 } : false}
                      dataSource={c.loyaltyEntries ?? []}
                      columns={[
                        {
                          title: 'Thời gian',
                          render: (_, r) => new Date(r.createdAt).toLocaleString('vi-VN'),
                        },
                        {
                          title: 'Loại',
                          dataIndex: 'entryType',
                          render: (type) => (
                            <Tag
                              color={
                                type === 'EARN' ? 'green' : type === 'REVERSAL' ? 'red' : 'blue'
                              }
                            >
                              {type === 'EARN'
                                ? 'Tích điểm'
                                : type === 'REVERSAL'
                                  ? 'Đảo điểm'
                                  : 'Điều chỉnh'}
                            </Tag>
                          ),
                        },
                        {
                          title: 'Điểm',
                          render: (_, r) => (
                            <strong style={{ color: r.points > 0 ? '#166534' : '#dc2626' }}>
                              {r.points > 0 ? `+${r.points}` : r.points}
                            </strong>
                          ),
                        },
                        {
                          title: 'Số dư sau',
                          dataIndex: 'balanceAfter',
                          render: (bal) => `${bal} đ`,
                        },
                        {
                          title: 'Ghi chú',
                          dataIndex: 'note',
                          render: (note) => note || '—',
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'debt',
                  label: (
                    <span>
                      <WalletOutlined /> Sổ công nợ ({c.debtEntries?.length ?? 0})
                    </span>
                  ),
                  children: (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          marginBottom: 16,
                          padding: '12px 14px',
                          background: '#f8fafc',
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div>
                          <span style={{ color: '#64748b', fontSize: 13 }}>Công nợ hiện tại: </span>
                          <strong
                            style={{
                              fontSize: 18,
                              color: c.debtBalanceVnd > 0 ? '#dc2626' : '#166534',
                              marginLeft: 6,
                            }}
                          >
                            {money(c.debtBalanceVnd)}
                          </strong>
                        </div>

                        {canEditDebt ? (
                          <Space wrap>
                            <Button
                              type="primary"
                              disabled={!c.debtBalanceVnd || c.debtBalanceVnd <= 0}
                              onClick={() => {
                                setDebtPayAmount(c.debtBalanceVnd);
                                setDebtPayOpen(true);
                              }}
                            >
                              Thu nợ
                            </Button>
                            <Button onClick={() => setDebtAdjustOpen(true)}>Điều chỉnh nợ</Button>
                          </Space>
                        ) : null}
                      </div>

                      <Table
                        rowKey="id"
                        scroll={{ x: 'max-content' }}
                        pagination={c.debtEntries?.length > 10 ? { pageSize: 10 } : false}
                        dataSource={c.debtEntries ?? []}
                        columns={[
                          {
                            title: 'Thời gian',
                            render: (_, r) => new Date(r.createdAt).toLocaleString('vi-VN'),
                          },
                          {
                            title: 'Loại',
                            dataIndex: 'entryType',
                            render: (type) => (
                              <Tag
                                color={
                                  type === 'CHARGE'
                                    ? 'red'
                                    : type === 'PAYMENT'
                                      ? 'green'
                                      : 'purple'
                                }
                              >
                                {type === 'CHARGE'
                                  ? 'Ghi nợ đơn'
                                  : type === 'PAYMENT'
                                    ? 'Thanh toán nợ'
                                    : 'Điều chỉnh'}
                              </Tag>
                            ),
                          },
                          {
                            title: 'Hình thức',
                            dataIndex: 'paymentMethod',
                            render: (m) =>
                              m === 'CASH'
                                ? 'Tiền mặt'
                                : m === 'BANK_TRANSFER'
                                  ? 'Chuyển khoản'
                                  : '—',
                          },
                          {
                            title: 'Số tiền',
                            render: (_, r) => (
                              <strong
                                style={{
                                  color: r.entryType === 'CHARGE' ? '#dc2626' : '#166534',
                                }}
                              >
                                {money(r.amountVnd)}
                              </strong>
                            ),
                          },
                          {
                            title: 'Ghi chú',
                            dataIndex: 'note',
                            render: (note) => note || '—',
                          },
                        ]}
                      />
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Thông tin khách hàng">
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                { key: 'phone', label: 'Số điện thoại', children: <strong>{c.phone}</strong> },
                { key: 'email', label: 'Email', children: c.email || '—' },
                {
                  key: 'gender',
                  label: 'Giới tính',
                  children:
                    c.gender === 'MALE'
                      ? 'Nam'
                      : c.gender === 'FEMALE'
                        ? 'Nữ'
                        : c.gender === 'OTHER'
                          ? 'Khác'
                          : '—',
                },
                { key: 'birthDate', label: 'Ngày sinh', children: c.birthDate || '—' },
                {
                  key: 'address',
                  label: 'Địa chỉ',
                  children:
                    [c.addressLine, c.wardName, c.provinceName].filter(Boolean).join(', ') || '—',
                },
                {
                  key: 'groups',
                  label: 'Nhóm',
                  children: (
                    <Space wrap>
                      {c.groups?.length ? (
                        c.groups.map((g) => (
                          <Tag color="blue" key={g.id}>
                            {g.name}
                          </Tag>
                        ))
                      ) : (
                        <span>Chưa phân nhóm</span>
                      )}
                    </Space>
                  ),
                },
                { key: 'note', label: 'Ghi chú', children: c.note || '—' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Thu nợ Modal */}
      <Modal
        title={`Thu nợ khách hàng: ${c.name}`}
        open={debtPayOpen}
        onCancel={() => setDebtPayOpen(false)}
        onOk={() => void collectDebt()}
        okText="Xác nhận thu nợ"
        cancelText="Hủy"
        width="min(460px, 95vw)"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert type="info" message={`Dư nợ hiện tại: ${money(c.debtBalanceVnd)}`} showIcon />
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Số tiền thu nợ:
            </label>
            <InputNumber
              size="large"
              min={1}
              max={c.debtBalanceVnd}
              value={debtPayAmount}
              onChange={(v) => setDebtPayAmount(v === null ? null : Number(v))}
              style={{ width: '100%' }}
              addonAfter="đ"
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Hình thức thanh toán:
            </label>
            <Radio.Group value={debtPayMethod} onChange={(e) => setDebtPayMethod(e.target.value)}>
              <Radio value="CASH">Tiền mặt</Radio>
              <Radio value="BANK_TRANSFER">Chuyển khoản</Radio>
            </Radio.Group>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Ghi chú thu nợ:
            </label>
            <Input
              size="large"
              value={debtPayNote}
              onChange={(e) => setDebtPayNote(e.target.value)}
              placeholder="Ví dụ: Thu nợ tiền chơi ngày 20/08..."
            />
          </div>
        </Space>
      </Modal>

      {/* Điều chỉnh nợ Modal */}
      <Modal
        title={`Điều chỉnh công nợ: ${c.name}`}
        open={debtAdjustOpen}
        onCancel={() => setDebtAdjustOpen(false)}
        onOk={() => void adjustDebt()}
        okText="Xác nhận điều chỉnh"
        cancelText="Hủy"
        width="min(460px, 95vw)"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="warning"
            message="Nhập số tiền dương để TĂNG nợ, hoặc số tiền âm để GIẢM nợ."
            showIcon
          />
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Số tiền điều chỉnh (+/- VND):
            </label>
            <InputNumber
              size="large"
              value={debtAdjustAmount}
              onChange={(v) => setDebtAdjustAmount(v === null ? null : Number(v))}
              style={{ width: '100%' }}
              addonAfter="đ"
              placeholder="Ví dụ: -50000 hoặc 50000"
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Lý do điều chỉnh (Bắt buộc):
            </label>
            <Input.TextArea
              rows={3}
              value={debtAdjustReason}
              onChange={(e) => setDebtAdjustReason(e.target.value)}
              placeholder="Nhập lý do chi tiết điều chỉnh công nợ..."
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}

// ─── CUSTOMER GROUP LIST PAGE ────────────────────────────────────────────────

export function OwnerCustomerGroupListPage({
  baseRoute = '/owner/customer-groups',
  apiPrefix = '/api/v1/owner/customers',
  userPermissions,
  isOwner,
  onBack,
}: CustomerPageProps = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerUser = isOwner ?? auth.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];
  const canView = isOwnerUser || perms.includes('customer.groups.view');
  const canCreate = isOwnerUser || perms.includes('customer.groups.create');
  const canEdit = isOwnerUser || perms.includes('customer.groups.edit');
  const canDelete = isOwnerUser || perms.includes('customer.groups.delete');

  const groups = useQuery({
    queryKey: ['customer-groups-list', apiPrefix],
    queryFn: () => apiRequest<CustomerGroup[]>(`${apiPrefix}/groups`),
    enabled: canView,
  });

  const deleteGroup = async (groupId: string) => {
    try {
      await apiRequest(`${apiPrefix}/groups/${groupId}`, {
        method: 'DELETE',
        headers: mutationHeaders(auth.data?.csrfToken),
      });
      message.success('Đã xóa nhóm khách hàng.');
      await queryClient.invalidateQueries({ queryKey: ['customer-groups-list', apiPrefix] });
    } catch (err: any) {
      message.error(err?.message || 'Không thể xóa nhóm khách hàng.');
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      const customersRoute = baseRoute.includes('/customer-groups')
        ? '/owner/customers'
        : baseRoute.replace(/\/groups$/, '');
      navigate(customersRoute);
    }
  };

  if (!canView) {
    return (
      <div className="owner-customer-page" style={{ padding: '24px 0' }}>
        <Alert
          type="warning"
          showIcon
          title="Không có quyền truy cập"
          description="Bạn không có quyền xem nhóm khách hàng. Vui lòng liên hệ quản lý để được cấp quyền."
        />
      </div>
    );
  }

  return (
    <div className="owner-customer-page">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={handleBack}
        style={{ paddingLeft: 0, marginBottom: 12 }}
      >
        Danh sách khách hàng
      </Button>

      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Nhóm khách hàng
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13.5 }}>
            Phân loại nhóm khách hàng để thiết lập chính sách ưu đãi và khuyến mãi
          </Typography.Text>
        </div>
        {canCreate ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate(`${baseRoute}/new`)}
          >
            Thêm nhóm khách hàng
          </Button>
        ) : null}
      </div>

      <Card styles={{ body: { padding: '16px' } }}>
        <Table
          rowKey="id"
          scroll={{ x: 'max-content' }}
          dataSource={groups.data ?? []}
          loading={groups.isLoading}
          columns={[
            {
              title: 'Tên nhóm',
              dataIndex: 'name',
              render: (name, r) => (
                <div>
                  <strong style={{ color: '#0f172a' }}>{name}</strong>
                  {r.note ? <div style={{ color: '#64748b', fontSize: 13 }}>{r.note}</div> : null}
                </div>
              ),
            },
            {
              title: 'Loại phân nhóm',
              render: (_, r) => (
                <Tag color={r.membershipType === 'AUTOMATIC' ? 'blue' : 'default'}>
                  {r.membershipType === 'AUTOMATIC'
                    ? 'Tự động (Theo điều kiện)'
                    : 'Thủ công (Chọn danh sách)'}
                </Tag>
              ),
            },
            {
              title: 'Số thành viên',
              dataIndex: 'customerCount',
              align: 'center',
              render: (count) => <Tag color="cyan">{count} khách hàng</Tag>,
            },
            {
              title: 'Thao tác',
              align: 'right',
              render: (_, r) => (
                <Space>
                  {canEdit ? (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`${baseRoute}/${r.id}`);
                      }}
                    >
                      Sửa
                    </Button>
                  ) : null}

                  {canDelete ? (
                    <Popconfirm
                      title="Xóa nhóm khách hàng?"
                      description="Hành động này không xóa dữ liệu khách hàng bên trong."
                      onConfirm={() => void deleteGroup(r.id)}
                      okText="Xóa"
                      cancelText="Hủy"
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Xóa
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

// ─── CUSTOMER GROUP FORM PAGE (CREATE / EDIT) ────────────────────────────────

export function OwnerCustomerGroupFormPage({
  groupId,
  baseRoute = '/owner/customer-groups',
  apiPrefix = '/api/v1/owner/customers',
  userPermissions,
  isOwner,
  onBack,
}: CustomerPageProps & { groupId?: string } = {}) {
  const navigate = useNavigate();
  const [form] = Form.useForm<CustomerGroupInput>();

  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const isOwnerUser = isOwner ?? auth.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];
  const canCreate = isOwnerUser || perms.includes('customer.groups.create');
  const canEdit = isOwnerUser || perms.includes('customer.groups.edit');

  const group = useQuery({
    queryKey: ['customer-group', apiPrefix, groupId],
    queryFn: () => apiRequest<CustomerGroup>(`${apiPrefix}/groups/${groupId}`),
    enabled: Boolean(groupId),
  });

  const customers = useQuery({
    queryKey: ['customers-all-picker', apiPrefix],
    queryFn: () => apiRequest<CustomerListResponse>(`${apiPrefix}?status=ACTIVE&limit=100`),
  });

  const type = Form.useWatch('membershipType', form) ?? 'MANUAL';
  const [rules, setRules] = useState<CustomerGroupRule[]>([]);

  useEffect(() => {
    if (group.data) {
      form.setFieldsValue({ ...group.data, customerIds: group.data.customerIds });
      setRules(group.data.rules ?? []);
    }
  }, [group.data, form]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(baseRoute);
    }
  };

  const save = async (v: CustomerGroupInput) => {
    if (groupId && !canEdit) {
      message.error('Bạn không có quyền chỉnh sửa nhóm khách hàng.');
      return;
    }
    if (!groupId && !canCreate) {
      message.error('Bạn không có quyền tạo nhóm khách hàng.');
      return;
    }

    try {
      await jsonRequest(
        groupId ? `${apiPrefix}/groups/${groupId}` : `${apiPrefix}/groups`,
        { ...v, rules },
        {
          method: groupId ? 'PUT' : 'POST',
          headers: mutationHeaders(auth.data?.csrfToken),
        },
      );
      message.success(groupId ? 'Đã cập nhật nhóm khách hàng.' : 'Đã tạo nhóm khách hàng mới.');
      handleBack();
    } catch (err: any) {
      message.error(err?.message || 'Không thể lưu nhóm khách hàng.');
    }
  };

  return (
    <div className="owner-customer-form">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={handleBack}
        style={{ paddingLeft: 0, marginBottom: 12 }}
      >
        Nhóm khách hàng
      </Button>

      <Typography.Title level={2} style={{ marginBottom: 20 }}>
        {groupId ? 'Chỉnh sửa nhóm khách hàng' : 'Thêm nhóm khách hàng'}
      </Typography.Title>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ membershipType: 'MANUAL', customerIds: [] }}
        onFinish={(v) => void save(v)}
      >
        <Card>
          <Form.Item
            name="name"
            label="Tên nhóm khách hàng"
            rules={[{ required: true, message: 'Vui lòng nhập tên nhóm khách hàng' }]}
          >
            <Input size="large" placeholder="Ví dụ: Khách VIP, Khách quen..." />
          </Form.Item>

          <Form.Item name="membershipType" label="Lựa chọn phương thức phân nhóm">
            <Radio.Group size="large">
              <Radio value="MANUAL">Thêm khách hàng thủ công</Radio>
              <Radio value="AUTOMATIC">Thêm khách hàng tự động (Theo điều kiện)</Radio>
            </Radio.Group>
          </Form.Item>

          {type === 'MANUAL' ? (
            <Form.Item name="customerIds" label="Chọn khách hàng vào nhóm">
              <Select
                size="large"
                mode="multiple"
                showSearch
                placeholder="Tìm và chọn khách hàng"
                optionFilterProp="label"
                options={
                  customers.data?.results.map((c) => ({
                    value: c.id,
                    label: `${c.name} · ${c.phone}`,
                  })) ?? []
                }
              />
            </Form.Item>
          ) : (
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                Thiết lập điều kiện tự động:
              </Typography.Text>
              <Space direction="vertical" style={{ width: '100%' }}>
                {rules.map((rule, index) => (
                  <div className="customer-group-rule-card" key={index}>
                    <div className="customer-group-rule-row">
                      <Select
                        size="large"
                        value={rule.field}
                        onChange={(field) =>
                          setRules((rs) => rs.map((r, i) => (i === index ? { ...r, field } : r)))
                        }
                        options={[
                          { value: 'BIRTH_MONTH', label: 'Tháng sinh' },
                          { value: 'PROVINCE', label: 'Tỉnh/Thành phố' },
                          { value: 'WARD', label: 'Phường/Xã' },
                          { value: 'INVOICE_COUNT', label: 'Tổng số hóa đơn' },
                          { value: 'TOTAL_SPENT', label: 'Tổng chi tiêu' },
                          { value: 'GENDER', label: 'Giới tính' },
                        ]}
                        style={{ minWidth: 160 }}
                      />
                      <Select
                        size="large"
                        value={rule.operator}
                        onChange={(operator) =>
                          setRules((rs) => rs.map((r, i) => (i === index ? { ...r, operator } : r)))
                        }
                        options={[
                          { value: 'EQUAL', label: 'Bằng' },
                          { value: 'LESS_THAN', label: 'Nhỏ hơn' },
                          { value: 'GREATER_THAN', label: 'Lớn hơn' },
                          { value: 'BETWEEN', label: 'Trong khoảng' },
                        ]}
                        style={{ minWidth: 120 }}
                      />
                      <Input
                        size="large"
                        value={String(rule.value)}
                        onChange={(e) =>
                          setRules((rs) =>
                            rs.map((r, i) =>
                              i === index
                                ? { ...r, value: Number(e.target.value) || e.target.value }
                                : r,
                            ),
                          )
                        }
                        style={{ width: 140 }}
                      />
                      <Button
                        size="large"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setRules((rs) => rs.filter((_, i) => i !== index))}
                      >
                        Xóa
                      </Button>
                    </div>
                  </div>
                ))}
              </Space>
              <Button
                type="dashed"
                size="large"
                style={{ marginTop: 12 }}
                onClick={() =>
                  setRules((rs) => [
                    ...rs,
                    { field: 'TOTAL_SPENT', operator: 'GREATER_THAN', value: 0 },
                  ])
                }
              >
                + Thêm điều kiện lọc
              </Button>
            </div>
          )}

          <Form.Item name="note" label="Ghi chú nhóm" style={{ marginTop: 20 }}>
            <Input.TextArea rows={3} placeholder="Mô tả mục đích của nhóm khách hàng..." />
          </Form.Item>
        </Card>

        <Space wrap size="middle" style={{ marginTop: 20 }}>
          <Button size="large" onClick={handleBack}>
            Hủy
          </Button>
          <Button size="large" type="primary" htmlType="submit">
            Lưu nhóm khách hàng
          </Button>
        </Space>
      </Form>
    </div>
  );
}
