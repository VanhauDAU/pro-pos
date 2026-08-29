import { DollarOutlined, PlusOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useState } from 'react';

import type { CustomerDetail, CustomerInput, CustomerSummary } from '@contracts/customer';
import type { StorePrintSettings } from '@contracts/store';
import { apiRequest, jsonRequest } from '@client/lib/api';
import { smartPrintReceipt } from '@client/lib/pos-receipt-printer';

const LOCATION_API = 'https://provinces.open-api.vn/api/v2';
interface LocationItem {
  code: number;
  name: string;
}
async function locationRequest<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Không tải được dữ liệu địa chỉ.');
  return response.json() as Promise<T>;
}

interface ListResponse {
  results: CustomerSummary[];
  total: number;
}
interface Props {
  customerId: string | null;
  csrfToken?: string | null;
  allowCreate: boolean;
  onSelect: (customer: CustomerSummary | null) => Promise<void> | void;
  buttonLabel?: string;
  variant?: 'full' | 'compact';
  reopenPickerOnDeselect?: boolean;
}
const money = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`;

export function PosCustomerSelector({
  customerId,
  csrfToken,
  allowCreate,
  onSelect,
  buttonLabel,
  variant = 'full',
  reopenPickerOnDeselect = false,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [debtPaymentOpen, setDebtPaymentOpen] = useState(false);
  const [debtPaymentAmount, setDebtPaymentAmount] = useState<number | null>(null);
  const [debtPaymentMethod, setDebtPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [collectingDebt, setCollectingDebt] = useState(false);
  const [printDebtReceipt, setPrintDebtReceipt] = useState(true);
  const [createForm] = Form.useForm<CustomerInput>();
  const provinceCode = Form.useWatch('provinceCode', createForm);
  const list = useQuery({
    queryKey: ['pos-customers', search],
    queryFn: () =>
      apiRequest<ListResponse>(`/api/v1/pos/customers?search=${encodeURIComponent(search)}`),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: ['pos-customer', customerId],
    queryFn: () => apiRequest<CustomerDetail>(`/api/v1/pos/customers/${customerId}`),
    enabled: Boolean(customerId),
  });
  const printSettings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: 30_000,
  });
  const posContext = useQuery({
    queryKey: ['pos-context'],
    queryFn: () =>
      apiRequest<{
        storeName?: string | null;
        storePhone?: string | null;
        storeAddress?: string | null;
      }>('/api/v1/pos/context'),
    staleTime: Infinity,
  });
  const provinces = useQuery({
    queryKey: ['vn-provinces-v2'],
    queryFn: () => locationRequest<LocationItem[]>(`${LOCATION_API}/p/`),
    enabled: createOpen,
    staleTime: 24 * 60 * 60_000,
  });
  const wards = useQuery({
    queryKey: ['vn-wards-v2', provinceCode],
    queryFn: () => locationRequest<LocationItem[]>(`${LOCATION_API}/w/?province=${provinceCode}`),
    enabled: createOpen && Boolean(provinceCode),
    staleTime: 24 * 60 * 60_000,
  });
  const create = async () => {
    try {
      const values = await createForm.validateFields();
      const province = provinces.data?.find((item) => item.code === values.provinceCode);
      const ward = wards.data?.find((item) => item.code === values.wardCode);
      setCreating(true);
      const customer = await jsonRequest<CustomerDetail>(
        '/api/v1/pos/customers',
        {
          name: values.name.trim(),
          phone: values.phone.trim(),
          email: values.email?.trim() || null,
          birthDate: values.birthDate || null,
          gender: values.gender ?? 'OTHER',
          provinceCode: province?.code ?? null,
          provinceName: province?.name ?? null,
          wardCode: ward?.code ?? null,
          wardName: ward?.name ?? null,
          addressLine: values.addressLine?.trim() || null,
          note: null,
        },
        { method: 'POST', headers: { 'X-CSRF-Token': csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      await onSelect(customer);
      setCreateOpen(false);
      setOpen(false);
      createForm.resetFields();
    } catch (error) {
      if (error instanceof Error && !('errorFields' in error)) message.error(error.message);
    } finally {
      setCreating(false);
    }
  };
  const c = detail.data;
  const address = c
    ? [c.addressLine, c.wardName, c.provinceName].filter(Boolean).join(', ') || '---'
    : '---';
  const deselect = async () => {
    await onSelect(null);
    if (reopenPickerOnDeselect) setOpen(true);
  };
  const collectDebt = async () => {
    if (!c || !debtPaymentAmount || debtPaymentAmount <= 0) {
      message.warning('Vui lòng nhập số tiền khách thanh toán.');
      return;
    }
    if (debtPaymentAmount > c.debtBalanceVnd) {
      message.warning('Số tiền thu không được vượt quá công nợ hiện tại.');
      return;
    }
    setCollectingDebt(true);
    try {
      const debtBefore = c.debtBalanceVnd;
      const referenceCode = `PTN-${Date.now().toString(36).toUpperCase()}`;
      const updated = await jsonRequest<CustomerDetail & { debtPaymentId: string }>(
        `/api/v1/pos/customers/${c.id}/debt-payments`,
        {
          amountVnd: debtPaymentAmount,
          method: debtPaymentMethod,
          note: 'Thu nợ tại POS',
          idempotencyKey: referenceCode,
        },
        { method: 'POST', headers: { 'X-CSRF-Token': csrfToken ?? '' } },
      );
      queryClient.setQueryData(['pos-customer', c.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos-customers'] }),
        queryClient.invalidateQueries({ queryKey: ['owner-customers'] }),
      ]);
      let printFailedMessage: string | null = null;
      if (printDebtReceipt) {
        const printResult = await smartPrintReceipt(
          {
            data: {
              receiptType: 'DEBT_PAYMENT',
              orderCode: referenceCode,
              invoiceCode: referenceCode,
              orderType: 'TAKEAWAY',
              cashierName: null,
              customerName: c.name,
              guestPhone: c.phone,
              guestAddress: [c.addressLine, c.wardName, c.provinceName].filter(Boolean).join(', '),
              issuedAtMs: Date.now(),
              subtotal: debtBefore,
              discountTotal: 0,
              total: debtPaymentAmount,
              paymentMethod: debtPaymentMethod,
              debtBeforeVnd: debtBefore,
              debtPaymentVnd: debtPaymentAmount,
              debtAfterVnd: updated.debtBalanceVnd,
              referenceCode,
              lines: [],
            },
            printSettings: printSettings.data,
            storeInfo: {
              storeName: posContext.data?.storeName ?? null,
              phone: posContext.data?.storePhone ?? null,
              address: posContext.data?.storeAddress ?? null,
            },
          },
          {
            type: 'debt_payment',
            id: updated.debtPaymentId,
          },
          csrfToken,
        );
        if (!printResult.success)
          printFailedMessage = printResult.message ?? 'Không thể in phiếu thu.';
      }
      if (printFailedMessage) {
        message.warning(`Đã thu nợ thành công nhưng chưa in được phiếu: ${printFailedMessage}`);
      } else {
        message.success(
          updated.debtBalanceVnd > 0
            ? `Đã thu ${money(debtPaymentAmount)}. Còn nợ ${money(updated.debtBalanceVnd)}.`
            : 'Đã thu đủ công nợ của khách hàng.',
        );
      }
      setDebtPaymentOpen(false);
      setDebtPaymentAmount(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không thể thu nợ khách hàng.');
    } finally {
      setCollectingDebt(false);
    }
  };
  return (
    <>
      {c && variant === 'compact' ? (
        <div className="pos-selected-customer-compact">
          <div className="pos-selected-customer__avatar">
            <UserOutlined />
          </div>
          <div className="pos-selected-customer-compact__identity">
            <strong>{c.name}</strong>
            <span>{c.phone}</span>
          </div>
          <Button type="link" onClick={() => setOpen(true)}>
            Thay đổi
          </Button>
        </div>
      ) : c ? (
        <div className="pos-selected-customer">
          <div className="pos-selected-customer__profile">
            <div className="pos-selected-customer__avatar">
              <UserOutlined />
            </div>
            <div className="pos-selected-customer__identity">
              <strong>{c.name}</strong>
              <span>{c.phone}</span>
            </div>
            <Button type="link" onClick={() => setOpen(true)}>
              Thay đổi
            </Button>
          </div>

          <div className="pos-selected-customer__metrics">
            <div className="pos-selected-customer__metric pos-selected-customer__metric--debt">
              <span>Công nợ hiện tại</span>
              <strong className={c.debtBalanceVnd > 0 ? 'is-debt' : ''}>
                {money(c.debtBalanceVnd)}
              </strong>
            </div>
            <div className="pos-selected-customer__metric">
              <span>Đơn hàng</span>
              <strong>{c.invoiceCount} đơn</strong>
            </div>
            <div className="pos-selected-customer__metric">
              <span>Tổng chi tiêu</span>
              <strong>{money(c.totalSpentVnd)}</strong>
            </div>
          </div>

          <div className="pos-selected-customer__member-info">
            <Typography.Title level={5}>Thông tin thẻ thành viên</Typography.Title>
            <dl>
              <div>
                <dt>Số điện thoại</dt>
                <dd className="is-primary">{c.phone}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{c.email || '---'}</dd>
              </div>
              <div>
                <dt>Địa chỉ</dt>
                <dd>{address}</dd>
              </div>
              {c.groups.length ? (
                <div>
                  <dt>Nhóm khách hàng</dt>
                  <dd>
                    <Space size={[4, 4]} wrap>
                      {c.groups.map((group) => (
                        <Tag key={group.id}>{group.name}</Tag>
                      ))}
                    </Space>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="pos-selected-customer__actions">
            {c.debtBalanceVnd > 0 ? (
              <Button
                className="pos-customer-collect-debt-btn"
                icon={<DollarOutlined />}
                onClick={() => {
                  setDebtPaymentAmount(c.debtBalanceVnd);
                  setDebtPaymentOpen(true);
                }}
              >
                Thanh toán công nợ
              </Button>
            ) : null}
            <Button onClick={() => void deselect()}>Bỏ chọn</Button>
            <Button type="primary" ghost onClick={() => setDetailOpen(true)}>
              Xem chi tiết
            </Button>
          </div>
        </div>
      ) : (
        <div className="pos-customer-empty">
          <Empty description="Chưa có khách hàng nào" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            {buttonLabel ?? 'Thêm khách hàng'}
          </Button>
        </div>
      )}
      <Modal
        title="Thanh toán công nợ"
        open={debtPaymentOpen}
        centered
        width={480}
        className="pos-customer-debt-payment-modal"
        okText="Xác nhận thu nợ"
        cancelText="Hủy"
        okButtonProps={{ loading: collectingDebt, disabled: !debtPaymentAmount }}
        onOk={() => void collectDebt()}
        onCancel={() => {
          if (!collectingDebt) setDebtPaymentOpen(false);
        }}
      >
        {c ? (
          <div className="pos-customer-debt-payment">
            <div className="pos-customer-debt-payment__summary">
              <span>Công nợ hiện tại</span>
              <strong>{money(c.debtBalanceVnd)}</strong>
            </div>
            <label>
              <span>Số tiền khách trả</span>
              <InputNumber
                autoFocus
                min={1}
                max={c.debtBalanceVnd}
                value={debtPaymentAmount}
                onChange={(value) => setDebtPaymentAmount(value === null ? null : Number(value))}
                formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}
                parser={(value) => Number((value ?? '').replaceAll(',', ''))}
                addonAfter="đ"
              />
            </label>
            <div className="pos-customer-debt-payment__remaining">
              <span>Công nợ còn lại</span>
              <strong>{money(Math.max(0, c.debtBalanceVnd - (debtPaymentAmount ?? 0)))}</strong>
            </div>
            <label>
              <span>Phương thức thanh toán</span>
              <Radio.Group
                value={debtPaymentMethod}
                onChange={(event) => setDebtPaymentMethod(event.target.value)}
              >
                <Radio.Button value="CASH">Tiền mặt</Radio.Button>
                <Radio.Button value="BANK_TRANSFER">Chuyển khoản</Radio.Button>
              </Radio.Group>
            </label>
            <Checkbox
              checked={printDebtReceipt}
              onChange={(event) => setPrintDebtReceipt(event.target.checked)}
            >
              In phiếu thu công nợ sau khi xác nhận
            </Checkbox>
          </div>
        ) : null}
      </Modal>
      <Modal
        title={
          <div className="pos-customer-picker-header">
            <span>Chọn khách hàng</span>
            {allowCreate ? (
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setCreateOpen(true)}
              >
                Thêm khách hàng
              </Button>
            ) : null}
          </div>
        }
        open={open}
        footer={null}
        onCancel={() => setOpen(false)}
        width={620}
      >
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm theo họ tên hoặc số điện thoại"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <List
          loading={list.isLoading}
          dataSource={list.data?.results ?? []}
          locale={{ emptyText: <Empty description="Không tìm thấy khách hàng" /> }}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="select"
                  type="primary"
                  onClick={async () => {
                    await onSelect(item);
                    setOpen(false);
                  }}
                >
                  Chọn
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<UserOutlined />}
                title={item.name}
                description={
                  <Space split="·">
                    <span>{item.phone}</span>
                    <span>{item.invoiceCount} đơn hàng</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Modal>
      <Modal
        title="Tạo khách hàng"
        open={createOpen}
        onCancel={() => {
          if (!creating) setCreateOpen(false);
        }}
        width={760}
        centered
        className="pos-customer-create-modal"
        footer={
          <Button
            type="primary"
            size="large"
            block
            loading={creating}
            onClick={() => void create()}
          >
            Lưu
          </Button>
        }
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ gender: 'OTHER' }}
          className="pos-customer-create-form"
        >
          <Typography.Title level={4}>Thông tin khách hàng</Typography.Title>
          <Row gutter={14}>
            <Col span={24}>
              <Form.Item
                name="name"
                label="Họ tên"
                rules={[{ required: true, message: 'Vui lòng nhập họ tên.' }]}
              >
                <Input size="large" placeholder="Nhập họ tên" maxLength={160} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="phone"
                label="Số điện thoại"
                rules={[
                  { required: true, message: 'Vui lòng nhập số điện thoại.' },
                  {
                    pattern: /^(?:02\d{8,9}|0[35789]\d{8})$/u,
                    message: 'Số điện thoại Việt Nam không hợp lệ.',
                  },
                ]}
              >
                <Input size="large" inputMode="tel" placeholder="Nhập số điện thoại" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ type: 'email', message: 'Email không hợp lệ.' }]}
              >
                <Input size="large" inputMode="email" placeholder="Nhập email" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="birthDate" label="Ngày sinh">
                <Input size="large" type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="gender" label="Giới tính">
                <Select
                  size="large"
                  options={[
                    { value: 'MALE', label: 'Nam' },
                    { value: 'FEMALE', label: 'Nữ' },
                    { value: 'OTHER', label: 'Khác' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="addressLine" label="Địa chỉ chi tiết">
                <Input size="large" placeholder="Số nhà, tên đường…" maxLength={500} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="provinceCode" label="Tỉnh / Thành phố">
                <Select
                  size="large"
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  loading={provinces.isLoading}
                  placeholder="Chọn tỉnh / thành phố"
                  options={
                    provinces.data?.map((item) => ({ value: item.code, label: item.name })) ?? []
                  }
                  onChange={() => createForm.setFieldValue('wardCode', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="wardCode" label="Phường / Xã">
                <Select
                  size="large"
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  loading={wards.isLoading}
                  disabled={!provinceCode}
                  placeholder={provinceCode ? 'Chọn phường / xã' : 'Chọn tỉnh / thành phố trước'}
                  options={
                    wards.data?.map((item) => ({ value: item.code, label: item.name })) ?? []
                  }
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      <Modal
        title="Chi tiết khách hàng"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={760}
        centered
        className="pos-customer-detail-modal"
      >
        {c ? (
          <div className="pos-customer-detail">
            <div className="pos-customer-detail__profile">
              <div className="pos-selected-customer__avatar">
                <UserOutlined />
              </div>
              <div>
                <strong>{c.name}</strong>
                <span>{c.phone}</span>
              </div>
            </div>

            <div className="pos-customer-detail__metrics">
              <div className="pos-customer-detail__metric pos-customer-detail__metric--debt">
                <span>Công nợ hiện tại</span>
                <strong className={c.debtBalanceVnd > 0 ? 'is-debt' : ''}>
                  {money(c.debtBalanceVnd)}
                </strong>
              </div>
              <div className="pos-customer-detail__metric">
                <span>Đơn hàng</span>
                <strong>{c.invoiceCount} đơn</strong>
              </div>
              <div className="pos-customer-detail__metric">
                <span>Tổng chi tiêu</span>
                <strong>{money(c.totalSpentVnd)}</strong>
              </div>
            </div>

            <section className="pos-customer-detail__section">
              <Typography.Title level={5}>Thông tin thẻ thành viên</Typography.Title>
              <dl>
                <div>
                  <dt>Mã thẻ</dt>
                  <dd>---</dd>
                </div>
                <div>
                  <dt>Hạng thẻ</dt>
                  <dd>---</dd>
                </div>
                <div>
                  <dt>Điểm tích lũy</dt>
                  <dd>{c.loyaltyPoints}</dd>
                </div>
              </dl>
            </section>

            <section className="pos-customer-detail__section">
              <Typography.Title level={5}>Thông tin khách hàng</Typography.Title>
              <dl>
                <div>
                  <dt>Số điện thoại</dt>
                  <dd className="is-primary">{c.phone}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{c.email || '---'}</dd>
                </div>
                <div>
                  <dt>Địa chỉ</dt>
                  <dd>{address}</dd>
                </div>
                <div>
                  <dt>Ngày sinh</dt>
                  <dd>{c.birthDate || '---'}</dd>
                </div>
                <div>
                  <dt>Giới tính</dt>
                  <dd>
                    {c.gender === 'MALE'
                      ? 'Nam'
                      : c.gender === 'FEMALE'
                        ? 'Nữ'
                        : c.gender === 'OTHER'
                          ? 'Khác'
                          : '---'}
                  </dd>
                </div>
                <div>
                  <dt>Nhóm khách hàng</dt>
                  <dd>
                    {c.groups.length ? (
                      <Space size={[4, 4]} wrap>
                        {c.groups.map((group) => (
                          <Tag key={group.id}>{group.name}</Tag>
                        ))}
                      </Space>
                    ) : (
                      '---'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Ghi chú</dt>
                  <dd>{c.note || '---'}</dd>
                </div>
              </dl>
            </section>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
