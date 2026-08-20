import {
  ArrowLeftOutlined,
  DeleteOutlined,
  LockOutlined,
  PlusCircleOutlined,
  SafetyCertificateOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface Employee {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roleId: string;
  roleName: string;
}

interface EmployeeDetail extends Employee {
  userStatus: 'ACTIVE' | 'DISABLED';
  membershipStatus: 'ACTIVE' | 'DISABLED';
  roleCode: string;
}

interface Role {
  id: string;
  code: string;
  name: string;
  isSystem: 0 | 1;
  memberCount: number;
  permissionCount: number;
}

interface EmployeeFormValues {
  displayName: string;
  username: string;
  email?: string;
  pin: string;
  roleId: string;
}

const EMPLOYEES_QUERY = ['owner-employees'] as const;
const ROLES_QUERY = ['owner-roles'] as const;

function feedback(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function StaffBackLink({ label = 'Quay lại danh sách nhân viên' }: { label?: string }) {
  const navigate = useNavigate();
  return (
    <button className="owner-back-link" type="button" onClick={() => navigate('/owner/staff')}>
      <ArrowLeftOutlined /> {label}
    </button>
  );
}

function useAuthContext() {
  return useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
}

export function OwnerStaffListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authContext = useAuthContext();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const employees = useQuery({
    queryKey: EMPLOYEES_QUERY,
    queryFn: () => apiRequest<Employee[]>('/api/v1/owner/staff'),
  });

  const rows = employees.data ?? [];
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleAll = (checked: boolean) => setSelectedIds(checked ? rows.map((row) => row.id) : []);
  const toggleOne = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((currentId) => currentId !== id),
    );

  const bulkAction = async (action: string) => {
    if (!selectedIds.length) return;
    setBusy(true);
    try {
      await jsonRequest(
        '/api/v1/owner/staff/bulk-action',
        { userIds: selectedIds, action },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY });
      setSelectedIds([]);
      messageApi.success('Đã áp dụng thao tác cho nhân viên đã chọn.');
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể áp dụng thao tác hàng loạt.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="owner-staff-page">
      {contextHolder}
      <div className="owner-staff-heading">
        <Typography.Title level={2}>Danh sách nhân viên</Typography.Title>
        <Button
          type="primary"
          size="large"
          icon={<PlusCircleOutlined />}
          onClick={() => navigate('/owner/staff/new')}
        >
          Thêm nhân viên
        </Button>
      </div>
      <Card className="owner-staff-list-card" styles={{ body: { padding: 0 } }}>
        <div className="owner-staff-list-card__tab">Tất cả nhân viên</div>
        {selectedIds.length ? (
          <div className="owner-staff-bulk-toolbar">
            <Typography.Text strong>{selectedIds.length} nhân viên đã chọn</Typography.Text>
            <Select
              placeholder="Chọn thao tác"
              disabled={busy}
              options={[
                { value: 'ACTIVATE', label: 'Kích hoạt' },
                { value: 'DISABLE', label: 'Ngừng kích hoạt' },
                { value: 'DELETE', label: 'Xóa nhân viên' },
                { value: 'REVOKE_SESSIONS', label: 'Chấm dứt các phiên đăng nhập' },
              ]}
              onChange={(action: string) => void bulkAction(action)}
            />
          </div>
        ) : null}
        <div className="owner-staff-table__header">
          <Checkbox
            aria-label="Chọn tất cả nhân viên"
            checked={allSelected}
            indeterminate={someSelected}
            onChange={(event) => toggleAll(event.target.checked)}
          />
          <span>Tên nhân viên</span>
          <span>Vai trò</span>
          <span>Trạng thái</span>
        </div>
        {employees.isLoading ? (
          <div className="owner-staff-list-loading">
            <Skeleton active />
          </div>
        ) : employees.isError ? (
          <Alert
            type="error"
            showIcon
            title="Không thể tải danh sách nhân viên"
            action={<Button onClick={() => void employees.refetch()}>Thử lại</Button>}
          />
        ) : rows.length ? (
          <div className="owner-staff-table">
            {rows.map((employee, index) => (
              <div className="owner-staff-table__row" key={employee.id}>
                <Checkbox
                  aria-label={`Chọn ${employee.displayName}`}
                  checked={selectedIds.includes(employee.id)}
                  onChange={(event) => toggleOne(employee.id, event.target.checked)}
                />
                <button
                  className="owner-staff-table__name"
                  type="button"
                  onClick={() => navigate(`/owner/staff/${employee.id}`)}
                >
                  <span>{String(index + 1).padStart(2, '0')}.</span> {employee.displayName}
                </button>
                <span>{employee.roleName}</span>
                <Tag color={employee.status === 'ACTIVE' ? 'success' : 'default'}>
                  {employee.status === 'ACTIVE' ? 'Đang kích hoạt' : 'Ngừng kích hoạt'}
                </Tag>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="Chưa có nhân viên" className="owner-staff-empty">
            <Button type="primary" onClick={() => navigate('/owner/staff/new')}>
              Thêm nhân viên đầu tiên
            </Button>
          </Empty>
        )}
      </Card>
    </div>
  );
}

export function OwnerEmployeeFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const userId =
    location.pathname === '/owner/staff/new' ? undefined : location.pathname.split('/').at(-1);
  const isCreate = !userId;
  const authContext = useAuthContext();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<EmployeeFormValues>();
  const [pinForm] = Form.useForm<{ pin: string }>();
  const [saving, setSaving] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);

  const roles = useQuery({
    queryKey: ROLES_QUERY,
    queryFn: () => apiRequest<Role[]>('/api/v1/owner/staff/roles'),
  });
  const employee = useQuery({
    queryKey: ['owner-employee', userId],
    queryFn: () => apiRequest<EmployeeDetail>(`/api/v1/owner/staff/${userId}`),
    enabled: !isCreate,
  });

  const roleOptions = useMemo(
    () => (roles.data ?? []).map((role) => ({ value: role.id, label: role.name })),
    [roles.data],
  );

  useEffect(() => {
    if (isCreate) {
      const defaultRole = roles.data?.find((role) => role.code === 'EMPLOYEE');
      if (defaultRole) form.setFieldValue('roleId', defaultRole.id);
      return;
    }
    if (employee.data) {
      form.setFieldsValue({
        displayName: employee.data.displayName,
        username: employee.data.username,
        roleId: employee.data.roleId,
        pin: '',
        ...(employee.data.email ? { email: employee.data.email } : {}),
      });
    }
  }, [employee.data, form, isCreate, roles.data]);

  const save = async (values: EmployeeFormValues) => {
    setSaving(true);
    try {
      if (isCreate) {
        await jsonRequest(
          '/api/v1/owner/staff',
          {
            displayName: values.displayName,
            username: values.username,
            email: values.email || null,
            pin: values.pin,
            roleId: values.roleId,
            permissionKeys: [],
          },
          { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
        );
        messageApi.success('Đã thêm nhân viên.');
      } else {
        await jsonRequest(
          `/api/v1/owner/staff/${userId}`,
          {
            displayName: values.displayName,
            email: values.email || null,
            roleId: values.roleId,
            ...(values.pin ? { pin: values.pin } : {}),
          },
          { method: 'PUT', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
        );
        messageApi.success('Đã lưu thông tin nhân viên.');
      }
      await queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY });
      navigate('/owner/staff');
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể lưu nhân viên.'));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'DISABLED') => {
    if (!userId) return;
    try {
      await jsonRequest(
        `/api/v1/owner/staff/${userId}/status`,
        { status },
        { method: 'PATCH', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: ['owner-employee', userId] });
      await queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY });
      messageApi.success(
        status === 'ACTIVE' ? 'Đã kích hoạt nhân viên.' : 'Đã ngừng kích hoạt nhân viên.',
      );
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể thay đổi trạng thái nhân viên.'));
    }
  };

  const deleteEmployee = async () => {
    if (!userId) return;
    try {
      await apiRequest(`/api/v1/owner/staff/${userId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY });
      messageApi.success('Đã xóa nhân viên.');
      navigate('/owner/staff');
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể xóa nhân viên.'));
    }
  };

  const resetPin = async ({ pin }: { pin: string }) => {
    if (!userId) return;
    setPinSaving(true);
    try {
      await jsonRequest(
        `/api/v1/owner/staff/${userId}/pin`,
        { pin },
        { method: 'PUT', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      messageApi.success('Đã đổi mã PIN.');
      setPinModalOpen(false);
      pinForm.resetFields();
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể đổi mã PIN.'));
    } finally {
      setPinSaving(false);
    }
  };

  if (roles.isLoading || (!isCreate && employee.isLoading)) {
    return <SpinPage description="Đang tải thông tin nhân viên" />;
  }
  if (roles.isError || (!isCreate && (employee.isError || !employee.data))) {
    return <Alert type="error" showIcon title="Không thể tải thông tin nhân viên" />;
  }

  const status = employee.data?.status;
  return (
    <div className="owner-staff-form-page">
      {contextHolder}
      <div className="owner-staff-form-heading">
        <div>
          <StaffBackLink />
          <Typography.Title level={2}>
            {isCreate ? 'Thêm nhân viên' : employee.data?.displayName}
          </Typography.Title>
        </div>
        {!isCreate ? (
          <Tag color={status === 'ACTIVE' ? 'success' : 'default'}>
            {status === 'ACTIVE' ? 'Đang kích hoạt' : 'Ngừng kích hoạt'}
          </Tag>
        ) : null}
      </div>
      <div className="owner-staff-form-layout">
        <aside className="owner-staff-form-intro">
          <Typography.Title level={4}>Tài khoản nhân viên</Typography.Title>
          <Typography.Paragraph type="secondary">
            Thông tin tài khoản, mã PIN và phân quyền của nhân viên.
          </Typography.Paragraph>
          <div className="owner-staff-form-tip">
            <SafetyCertificateOutlined />
            <span>
              Nhân viên đăng nhập bằng tên đăng nhập và mã PIN 4 số do chủ cửa hàng cung cấp.
            </span>
          </div>
        </aside>
        <Card className="owner-staff-form-card" styles={{ body: { padding: 0 } }}>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
            <div className="owner-staff-form-section">
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Họ tên nhân viên" />}
                    name="displayName"
                    rules={[{ required: true, message: 'Vui lòng nhập họ tên nhân viên.' }]}
                  >
                    <Input maxLength={128} placeholder="Nhập họ tên nhân viên" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Tên đăng nhập" />}
                    name="username"
                    rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
                  >
                    <Input disabled={!isCreate} maxLength={128} placeholder="Nhập tên đăng nhập" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="Email" name="email">
                    <Input type="email" maxLength={254} placeholder="Ví dụ: nhanvien@example.com" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Vai trò" />}
                    name="roleId"
                    rules={[{ required: true, message: 'Vui lòng chọn vai trò.' }]}
                  >
                    <Select options={roleOptions} placeholder="Chọn vai trò" />
                  </Form.Item>
                </Col>
              </Row>
            </div>
            <div className="owner-staff-form-section owner-staff-form-section--pin">
              <Typography.Title level={5}>
                {isCreate ? 'Mã PIN đăng nhập' : 'Mã PIN'}
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                {isCreate
                  ? 'Mã PIN gồm 4 chữ số để nhân viên đăng nhập vào hệ thống.'
                  : 'Đổi mã PIN khi cần cấp lại quyền truy cập.'}
              </Typography.Paragraph>
              {isCreate ? (
                <Form.Item
                  label={<RequiredLabel text="Mã PIN 4 số" />}
                  name="pin"
                  rules={[
                    { required: true, message: 'Vui lòng nhập mã PIN 4 số.' },
                    { pattern: /^\d{4}$/, message: 'Mã PIN phải gồm đúng 4 chữ số.' },
                  ]}
                >
                  <Input.OTP
                    length={4}
                    formatter={(value) => value.replace(/\D/g, '')}
                    inputMode="numeric"
                  />
                </Form.Item>
              ) : (
                <Button icon={<LockOutlined />} onClick={() => setPinModalOpen(true)}>
                  Đổi mã PIN
                </Button>
              )}
            </div>
            <div className="owner-staff-form-actions">
              {!isCreate ? (
                <Popconfirm
                  title="Xóa nhân viên?"
                  description="Tài khoản sẽ bị vô hiệu hóa và không thể đăng nhập."
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  onConfirm={deleteEmployee}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    Xóa
                  </Button>
                </Popconfirm>
              ) : (
                <span />
              )}
              <Space>
                {!isCreate ? (
                  <Button
                    danger={status === 'ACTIVE'}
                    icon={status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                    onClick={() => void setStatus(status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                  >
                    {status === 'ACTIVE' ? 'Ngừng kích hoạt' : 'Kích hoạt'}
                  </Button>
                ) : null}
                <Button type="primary" htmlType="submit" loading={saving}>
                  Lưu
                </Button>
              </Space>
            </div>
          </Form>
        </Card>
      </div>
      <Modal
        title="Đổi mã PIN"
        open={pinModalOpen}
        forceRender
        okText="Lưu mã PIN"
        cancelText="Hủy"
        confirmLoading={pinSaving}
        onOk={() => pinForm.submit()}
        onCancel={() => setPinModalOpen(false)}
      >
        <Form form={pinForm} layout="vertical" onFinish={resetPin}>
          <Form.Item
            name="pin"
            label="Mã PIN mới"
            rules={[
              { required: true, message: 'Vui lòng nhập mã PIN.' },
              { pattern: /^\d{4}$/, message: 'Mã PIN phải gồm đúng 4 chữ số.' },
            ]}
          >
            <Input.OTP
              length={4}
              formatter={(value) => value.replace(/\D/g, '')}
              inputMode="numeric"
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function RequiredLabel({ text }: { text: string }) {
  return (
    <span>
      {text} <b className="owner-required">(*)</b>
    </span>
  );
}

function SpinPage({ description }: { description: string }) {
  return (
    <div className="owner-staff-page__spinner">
      <Typography.Text type="secondary">{description}</Typography.Text>
      <Skeleton active paragraph={{ rows: 5 }} />
    </div>
  );
}
