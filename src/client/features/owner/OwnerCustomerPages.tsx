import {
  ArrowLeftOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
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

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}
function mutationHeaders(token?: string | null) {
  return { 'X-CSRF-Token': token ?? '' };
}

export function OwnerCustomerListPage() {
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
  const customers = useQuery({
    queryKey: ['owner-customers', search, status, page],
    queryFn: () =>
      apiRequest<CustomerListResponse>(
        `/api/v1/owner/customers?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=20`,
      ),
  });
  const loyalty = useQuery({
    queryKey: ['customer-loyalty-settings'],
    queryFn: () =>
      apiRequest<{ enabled: boolean; vndPerPoint: number }>(
        '/api/v1/owner/customers/loyalty-settings',
      ),
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
    await jsonRequest(
      '/api/v1/owner/customers/loyalty-settings',
      { enabled, vndPerPoint: rate },
      { method: 'PUT', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    setLoyaltyOpen(false);
    message.success('Đã lưu thiết lập tích điểm.');
  };
  const exportCustomers = () => {
    const rows = (customers.data?.results ?? []).map((c) => ({
      'Họ tên': c.name,
      'Số điện thoại': c.phone,
      Email: c.email ?? '',
      'Số đơn': c.invoiceCount,
      'Tổng chi tiêu': c.totalSpentVnd,
      'Công nợ': c.debtBalanceVnd,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Khách hàng');
    XLSX.writeFile(workbook, 'danh-sach-khach-hang.xlsx');
  };
  const importCustomers = async (file: File) => {
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
      '/api/v1/owner/customers/import/validate',
      { rows },
      { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    if (!validation.valid) {
      Modal.error({
        title: 'File chưa hợp lệ',
        content: validation.errors.map((e) => `Dòng ${e.row}: ${e.message}`).join('\n'),
      });
      return;
    }
    await jsonRequest(
      '/api/v1/owner/customers/import',
      { rows },
      { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    message.success(`Đã nhập ${rows.length} khách hàng.`);
    await customers.refetch();
  };
  return (
    <div className="owner-customer-page">
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>Khách hàng</Typography.Title>
          <Typography.Text type="secondary">
            Quản lý hồ sơ, chi tiêu, điểm và công nợ khách hàng
          </Typography.Text>
        </div>
        <Space wrap>
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
          <Button icon={<DownloadOutlined />} onClick={exportCustomers}>
            Xuất Excel
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setLoyaltyOpen(true)}>
            Thiết lập tích điểm
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/owner/customers/new')}
          >
            Thêm khách hàng
          </Button>
        </Space>
      </div>
      <Card>
        <div className="owner-customer-toolbar">
          <Input.Search
            allowClear
            placeholder="Tìm theo họ tên hoặc số điện thoại"
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Select
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
        <Table
          rowKey="id"
          loading={customers.isLoading}
          dataSource={customers.data?.results ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: customers.data?.total ?? 0,
            onChange: setPage,
          }}
          onRow={(record) => ({ onClick: () => navigate(`/owner/customers/${record.id}`) })}
          columns={[
            {
              title: 'Khách hàng',
              render: (_, r) => (
                <Space>
                  <UserOutlined />
                  <div>
                    <strong>{r.name}</strong>
                    <div>{r.phone}</div>
                  </div>
                </Space>
              ),
            },
            {
              title: 'Nhóm',
              render: (_, r) => (
                <Space wrap>
                  {r.groups.map((g) => (
                    <Tag key={g.id}>{g.name}</Tag>
                  ))}
                </Space>
              ),
            },
            { title: 'Số đơn', dataIndex: 'invoiceCount' },
            { title: 'Tổng chi tiêu', render: (_, r) => money(r.totalSpentVnd) },
            { title: 'Điểm', dataIndex: 'loyaltyPoints' },
            {
              title: 'Công nợ',
              render: (_, r) => (
                <strong style={{ color: r.debtBalanceVnd ? '#dc2626' : undefined }}>
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
      </Card>
      <Modal
        title="Thiết lập tích điểm"
        open={loyaltyOpen}
        onCancel={() => setLoyaltyOpen(false)}
        onOk={() => void saveLoyalty()}
        okText="Lưu"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Space>
            <Switch checked={enabled} onChange={setEnabled} />
            <span>Tự động tích điểm khi hoàn tất hóa đơn</span>
          </Space>
          <label>
            Số tiền tương ứng 1 điểm
            <InputNumber
              min={1}
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

export function OwnerCustomerFormPage({ customerId }: { customerId?: string }) {
  const navigate = useNavigate();
  const [form] = Form.useForm<CustomerInput>();
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const customer = useQuery({
    queryKey: ['owner-customer', customerId],
    queryFn: () => apiRequest<CustomerDetail>(`/api/v1/owner/customers/${customerId}`),
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
  const save = async (values: CustomerInput) => {
    const province = provinces.data?.find((i) => i.code === values.provinceCode);
    const ward = wards.data?.find((i) => i.code === values.wardCode);
    const payload = {
      ...values,
      provinceName: province?.name ?? null,
      wardName: ward?.name ?? null,
    };
    await jsonRequest(
      customerId ? `/api/v1/owner/customers/${customerId}` : '/api/v1/owner/customers',
      payload,
      { method: customerId ? 'PUT' : 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    message.success('Đã lưu khách hàng.');
    navigate('/owner/customers');
  };
  return (
    <div className="owner-customer-form">
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/owner/customers')}>
        Danh sách khách hàng
      </Button>
      <Typography.Title level={2}>
        {customerId ? 'Chỉnh sửa khách hàng' : 'Thêm mới khách hàng'}
      </Typography.Title>
      <Form form={form} layout="vertical" onFinish={(v) => void save(v)}>
        <Card title="Thông tin cơ bản">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Họ tên"
                rules={[{ required: true, message: 'Vui lòng nhập họ tên' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="phone"
                label="Số điện thoại"
                rules={[
                  { required: true },
                  {
                    pattern: /^(?:02\d{8,9}|0[35789]\d{8})$/,
                    message: 'SĐT Việt Nam không hợp lệ',
                  },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="birthDate" label="Ngày sinh">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="gender" label="Giới tính">
                <Select
                  allowClear
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
        <Card title="Địa chỉ mới" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="provinceCode" label="Tỉnh / Thành phố">
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={provinces.data?.map((i) => ({ value: i.code, label: i.name })) ?? []}
                  onChange={() => form.setFieldValue('wardCode', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="wardCode" label="Phường / Xã">
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={!provinceCode}
                  options={wards.data?.map((i) => ({ value: i.code, label: i.name })) ?? []}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="addressLine" label="Địa chỉ cụ thể">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Card>
        <Card title="Ghi chú" style={{ marginTop: 16 }}>
          <Form.Item name="note">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Card>
        <Space style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/owner/customers')}>Hủy</Button>
          <Button type="primary" htmlType="submit">
            Lưu
          </Button>
        </Space>
      </Form>
    </div>
  );
}

export function OwnerCustomerDetailPage({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [debtOpen, setDebtOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const customer = useQuery({
    queryKey: ['owner-customer', customerId],
    queryFn: () => apiRequest<CustomerDetail>(`/api/v1/owner/customers/${customerId}`),
  });
  const c = customer.data;
  if (!c) return <Empty description="Đang tải khách hàng" />;
  const collect = async () => {
    if (!amount) return;
    await jsonRequest(
      `/api/v1/owner/customers/${customerId}/debt-payments`,
      { amountVnd: amount, method, idempotencyKey: crypto.randomUUID() },
      { method: 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    setDebtOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['owner-customer', customerId] });
  };
  const archive = async () => {
    await apiRequest(`/api/v1/owner/customers/${customerId}`, {
      method: 'DELETE',
      headers: mutationHeaders(auth.data?.csrfToken),
    });
    message.success('Đã lưu trữ khách hàng.');
    navigate('/owner/customers');
  };
  const stats: Array<[string, string | number]> = [
    ['Tổng thanh toán', money(c.totalSpentVnd)],
    ['Số hóa đơn', c.invoiceCount],
    ['Chi tiêu trung bình', money(c.averageSpentVnd)],
    ['Điểm tích lũy', c.loyaltyPoints],
    ['Công nợ', money(c.debtBalanceVnd)],
  ];
  return (
    <div className="owner-customer-page">
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/owner/customers')}>
        Danh sách khách hàng
      </Button>
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>{c.name}</Typography.Title>
          <Typography.Text>{c.phone}</Typography.Text>
        </div>
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => navigate(`/owner/customers/${customerId}/edit`)}
          >
            Chỉnh sửa
          </Button>
          <Popconfirm title="Lưu trữ khách hàng?" onConfirm={() => void archive()}>
            <Button danger icon={<DeleteOutlined />}>
              Lưu trữ
            </Button>
          </Popconfirm>
        </Space>
      </div>
      <Row gutter={12}>
        {stats.map(([cTitle, value]) => (
          <Col xs={12} lg={4} key={cTitle}>
            <Card>
              <Statistic title={cTitle} value={value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card>
            <Tabs
              items={[
                {
                  key: 'invoices',
                  label: 'Hóa đơn gần nhất',
                  children: (
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={c.invoices}
                      columns={[
                        { title: 'Mã hóa đơn', dataIndex: 'displayCode' },
                        {
                          title: 'Thời gian',
                          render: (_, r) => new Date(r.issuedAt).toLocaleString('vi-VN'),
                        },
                        { title: 'Tổng tiền', render: (_, r) => money(r.totalVnd) },
                      ]}
                    />
                  ),
                },
                {
                  key: 'points',
                  label: 'Lịch sử tích điểm',
                  children: (
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={c.loyaltyEntries}
                      columns={[
                        {
                          title: 'Thời gian',
                          render: (_, r) => new Date(r.createdAt).toLocaleString('vi-VN'),
                        },
                        { title: 'Điểm', dataIndex: 'points' },
                        { title: 'Số dư', dataIndex: 'balanceAfter' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'debt',
                  label: 'Công nợ',
                  children: (
                    <>
                      <Button
                        type="primary"
                        disabled={!c.debtBalanceVnd}
                        onClick={() => setDebtOpen(true)}
                      >
                        Thu nợ
                      </Button>
                      <Table
                        rowKey="id"
                        pagination={false}
                        dataSource={c.debtEntries}
                        columns={[
                          {
                            title: 'Thời gian',
                            render: (_, r) => new Date(r.createdAt).toLocaleString('vi-VN'),
                          },
                          { title: 'Loại', dataIndex: 'entryType' },
                          { title: 'Số tiền', render: (_, r) => money(r.amountVnd) },
                          { title: 'Ghi chú', dataIndex: 'note' },
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
              items={[
                { key: 'phone', label: 'Số điện thoại', children: c.phone },
                { key: 'email', label: 'Email', children: c.email || '—' },
                { key: 'gender', label: 'Giới tính', children: c.gender || '—' },
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
                      {c.groups.map((g) => (
                        <Tag key={g.id}>{g.name}</Tag>
                      ))}
                    </Space>
                  ),
                },
                { key: 'note', label: 'Ghi chú', children: c.note || '—' },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Modal
        title="Thu nợ"
        open={debtOpen}
        onCancel={() => setDebtOpen(false)}
        onOk={() => void collect()}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <InputNumber
            min={1}
            max={c.debtBalanceVnd}
            value={amount}
            onChange={(v) => setAmount(v === null ? null : Number(v))}
            style={{ width: '100%' }}
            addonAfter="đ"
          />
          <Radio.Group value={method} onChange={(e) => setMethod(e.target.value)}>
            <Radio value="CASH">Tiền mặt</Radio>
            <Radio value="BANK_TRANSFER">Chuyển khoản</Radio>
          </Radio.Group>
        </Space>
      </Modal>
    </div>
  );
}

export function OwnerCustomerGroupListPage() {
  const navigate = useNavigate();
  const groups = useQuery({
    queryKey: ['customer-groups'],
    queryFn: () => apiRequest<CustomerGroup[]>('/api/v1/owner/customers/groups'),
  });
  return (
    <div className="owner-customer-page">
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>Nhóm khách hàng</Typography.Title>
          <Typography.Text type="secondary">
            Phân loại khách hàng để chuẩn bị áp dụng khuyến mãi
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/owner/customer-groups/new')}
        >
          Thêm nhóm khách hàng
        </Button>
      </div>
      <Card>
        <Table
          rowKey="id"
          dataSource={groups.data ?? []}
          loading={groups.isLoading}
          onRow={(r) => ({ onClick: () => navigate(`/owner/customer-groups/${r.id}`) })}
          columns={[
            { title: 'Tên nhóm', dataIndex: 'name' },
            {
              title: 'Loại',
              render: (_, r) => (
                <Tag color={r.membershipType === 'AUTOMATIC' ? 'blue' : 'default'}>
                  {r.membershipType === 'AUTOMATIC' ? 'Tự động' : 'Thủ công'}
                </Tag>
              ),
            },
            { title: 'Số khách hàng', dataIndex: 'customerCount' },
            { title: 'Ghi chú', dataIndex: 'note' },
          ]}
        />
      </Card>
    </div>
  );
}

export function OwnerCustomerGroupFormPage({ groupId }: { groupId?: string }) {
  const navigate = useNavigate();
  const [form] = Form.useForm<CustomerGroupInput>();
  const auth = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const group = useQuery({
    queryKey: ['customer-group', groupId],
    queryFn: () => apiRequest<CustomerGroup>(`/api/v1/owner/customers/groups/${groupId}`),
    enabled: Boolean(groupId),
  });
  const customers = useQuery({
    queryKey: ['owner-customers-all'],
    queryFn: () =>
      apiRequest<CustomerListResponse>('/api/v1/owner/customers?status=ACTIVE&limit=100'),
  });
  const type = Form.useWatch('membershipType', form) ?? 'MANUAL';
  const [rules, setRules] = useState<CustomerGroupRule[]>([]);
  useEffect(() => {
    if (group.data) {
      form.setFieldsValue({ ...group.data, customerIds: group.data.customerIds });
      setRules(group.data.rules);
    }
  }, [group.data, form]);
  const save = async (v: CustomerGroupInput) => {
    await jsonRequest(
      groupId ? `/api/v1/owner/customers/groups/${groupId}` : '/api/v1/owner/customers/groups',
      { ...v, rules },
      { method: groupId ? 'PUT' : 'POST', headers: mutationHeaders(auth.data?.csrfToken) },
    );
    message.success('Đã lưu nhóm khách hàng.');
    navigate('/owner/customer-groups');
  };
  return (
    <div className="owner-customer-form">
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/owner/customer-groups')}
      >
        Nhóm khách hàng
      </Button>
      <Typography.Title level={2}>
        {groupId ? 'Chỉnh sửa nhóm khách hàng' : 'Thêm nhóm khách hàng'}
      </Typography.Title>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ membershipType: 'MANUAL', customerIds: [] }}
        onFinish={(v) => void save(v)}
      >
        <Card>
          <Form.Item name="name" label="Tên nhóm khách hàng" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="membershipType" label="Lựa chọn khách hàng">
            <Radio.Group>
              <Radio value="MANUAL">Thêm khách hàng thủ công</Radio>
              <Radio value="AUTOMATIC">Thêm khách hàng tự động</Radio>
            </Radio.Group>
          </Form.Item>
          {type === 'MANUAL' ? (
            <Form.Item name="customerIds" label="Khách hàng">
              <Select
                mode="multiple"
                showSearch
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
              <Space direction="vertical" style={{ width: '100%' }}>
                {rules.map((rule, index) => (
                  <Card size="small" key={index}>
                    <Space wrap>
                      <Select
                        value={rule.field}
                        onChange={(field) =>
                          setRules((rs) => rs.map((r, i) => (i === index ? { ...r, field } : r)))
                        }
                        options={[
                          ['BIRTH_MONTH', 'Tháng sinh'],
                          ['PROVINCE', 'Tỉnh/Thành phố'],
                          ['WARD', 'Phường/Xã'],
                          ['INVOICE_COUNT', 'Tổng số hóa đơn'],
                          ['TOTAL_SPENT', 'Tổng chi tiêu'],
                          ['GENDER', 'Giới tính'],
                        ].map(([value, label]) => ({ value, label }))}
                      />
                      <Select
                        value={rule.operator}
                        onChange={(operator) =>
                          setRules((rs) => rs.map((r, i) => (i === index ? { ...r, operator } : r)))
                        }
                        options={[
                          ['EQUAL', 'Bằng'],
                          ['LESS_THAN', 'Nhỏ hơn'],
                          ['GREATER_THAN', 'Lớn hơn'],
                          ['BETWEEN', 'Trong khoảng'],
                        ].map(([value, label]) => ({ value, label }))}
                      />
                      <Input
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
                      />
                      <Button
                        danger
                        onClick={() => setRules((rs) => rs.filter((_, i) => i !== index))}
                      >
                        Xóa
                      </Button>
                    </Space>
                  </Card>
                ))}
              </Space>
              <Button
                style={{ marginTop: 12 }}
                onClick={() =>
                  setRules((rs) => [
                    ...rs,
                    { field: 'TOTAL_SPENT', operator: 'GREATER_THAN', value: 0 },
                  ])
                }
              >
                + Thêm điều kiện
              </Button>
            </div>
          )}
          <Form.Item name="note" label="Ghi chú" style={{ marginTop: 16 }}>
            <Input.TextArea />
          </Form.Item>
        </Card>
        <Space style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/owner/customer-groups')}>Hủy</Button>
          <Button type="primary" htmlType="submit">
            Lưu
          </Button>
        </Space>
      </Form>
    </div>
  );
}
