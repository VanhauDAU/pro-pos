import {
  ArrowLeftOutlined,
  DeleteOutlined,
  LockOutlined,
  PlusCircleOutlined,
  SafetyCertificateOutlined,
  UnlockOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
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

export interface Employee {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roleId: string;
  roleName: string;
}

export interface EmployeeDetail extends Employee {
  userStatus: 'ACTIVE' | 'DISABLED';
  membershipStatus: 'ACTIVE' | 'DISABLED';
  roleCode: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  isSystem: 0 | 1;
  memberCount: number;
  permissionCount: number;
}

export interface EmployeeFormValues {
  displayName: string;
  username: string;
  email?: string;
  pin: string;
  roleId: string;
}

export interface StaffPageProps {
  baseRoute?: string;
  apiPrefix?: string;
  userPermissions?: string[] | undefined;
  isOwner?: boolean | undefined;
  onBack?: () => void;
}

function feedback(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function useAuthContext() {
  return useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
}

// ─── STAFF LIST PAGE ─────────────────────────────────────────────────────────

export function OwnerStaffListPage({
  baseRoute = '/owner/staff',
  apiPrefix = '/api/v1/owner/staff',
  userPermissions,
  isOwner,
  onBack,
}: StaffPageProps = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authContext = useAuthContext();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isOwnerUser = isOwner ?? authContext.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];

  const canView = isOwnerUser || perms.includes('staff.employees.view');
  const canCreate = isOwnerUser || perms.includes('staff.employees.create');
  const canEdit = isOwnerUser || perms.includes('staff.employees.edit');
  const canDelete = isOwnerUser || perms.includes('staff.employees.delete');

  const employees = useQuery({
    queryKey: ['staff-employees-list', apiPrefix],
    queryFn: () => apiRequest<Employee[]>(apiPrefix),
    enabled: canView,
  });

  const rows = employees.data ?? [];
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleAll = (checked: boolean) =>
    setSelectedIds(checked ? rows.map((row) => row.id) : []);
  const toggleOne = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((currentId) => currentId !== id),
    );

  const bulkAction = async (action: string) => {
    if (!selectedIds.length) return;
    if (action === 'DELETE' && !canDelete) {
      messageApi.error('Bạn không có quyền xóa nhân viên.');
      return;
    }
    if (action !== 'DELETE' && !canEdit) {
      messageApi.error('Bạn không có quyền sửa trạng thái nhân viên.');
      return;
    }

    setBusy(true);
    try {
      await jsonRequest(
        `${apiPrefix}/bulk-action`,
        { userIds: selectedIds, action },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: ['staff-employees-list', apiPrefix] });
      setSelectedIds([]);
      messageApi.success('Đã áp dụng thao tác cho nhân viên đã chọn.');
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể áp dụng thao tác hàng loạt.'));
    } finally {
      setBusy(false);
    }
  };

  const bulkOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    if (canEdit) {
      opts.push(
        { value: 'ACTIVATE', label: 'Kích hoạt' },
        { value: 'DISABLE', label: 'Ngừng kích hoạt' },
        { value: 'REVOKE_SESSIONS', label: 'Chấm dứt các phiên đăng nhập' },
      );
    }
    if (canDelete) {
      opts.push({ value: 'DELETE', label: 'Xóa nhân viên' });
    }
    return opts;
  }, [canEdit, canDelete]);

  if (!canView) {
    return (
      <div className="owner-staff-page" style={{ padding: '24px 0' }}>
        <Alert
          type="warning"
          showIcon
          title="Không có quyền truy cập"
          description="Bạn không có quyền xem danh sách nhân viên. Vui lòng liên hệ quản lý để được phân quyền."
        />
      </div>
    );
  }

  return (
    <div className="owner-staff-page">
      {contextHolder}

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

      <div className="owner-staff-heading">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Danh sách nhân viên
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13.5 }}>
            Quản lý tài khoản, thông tin và vai trò của nhân viên cửa hàng
          </Typography.Text>
        </div>

        {canCreate ? (
          <Button
            type="primary"
            size="large"
            icon={<PlusCircleOutlined />}
            onClick={() => navigate(`${baseRoute}/new`)}
          >
            Thêm nhân viên
          </Button>
        ) : null}
      </div>

      <Card className="owner-staff-list-card" styles={{ body: { padding: 0 } }}>
        <div className="owner-staff-list-card__tab">Tất cả nhân viên ({rows.length})</div>

        {selectedIds.length && bulkOptions.length ? (
          <div className="owner-staff-bulk-toolbar">
            <Typography.Text strong>{selectedIds.length} nhân viên đã chọn</Typography.Text>
            <Select
              placeholder="Chọn thao tác"
              disabled={busy}
              options={bulkOptions}
              onChange={(action: string) => void bulkAction(action)}
            />
          </div>
        ) : null}

        {/* ── Desktop View (Table format) ─────────────────────────────── */}
        <div className="owner-staff-desktop-view">
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
                    onClick={() => navigate(`${baseRoute}/${employee.id}`)}
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
              {canCreate ? (
                <Button type="primary" onClick={() => navigate(`${baseRoute}/new`)}>
                  Thêm nhân viên đầu tiên
                </Button>
              ) : null}
            </Empty>
          )}
        </div>

        {/* ── Mobile Touch Cards View (< 769px) ────────────────────────── */}
        <div className="owner-staff-mobile-view" style={{ padding: '12px' }}>
          {employees.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : employees.isError ? (
            <Alert
              type="error"
              showIcon
              title="Không thể tải danh sách nhân viên"
              action={<Button onClick={() => void employees.refetch()}>Thử lại</Button>}
            />
          ) : rows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map((employee) => (
                <div
                  key={employee.id}
                  className="customer-mobile-card"
                  onClick={() => navigate(`${baseRoute}/${employee.id}`)}
                >
                  <div className="customer-mobile-card__header">
                    <div className="customer-mobile-card__user">
                      <Avatar
                        size={40}
                        style={{ background: '#0975f7', color: '#fff', fontWeight: 700, flexShrink: 0 }}
                        icon={<UserOutlined />}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="customer-mobile-card__name">{employee.displayName}</div>
                        <div className="customer-mobile-card__phone">@{employee.username}</div>
                      </div>
                    </div>
                    <Tag color={employee.status === 'ACTIVE' ? 'success' : 'default'} style={{ margin: 0 }}>
                      {employee.status === 'ACTIVE' ? 'Kích hoạt' : 'Tạm khóa'}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <Tag color="blue" style={{ fontSize: 12, margin: 0 }}>
                      {employee.roleName}
                    </Tag>
                    {employee.email ? (
                      <span style={{ fontSize: 12, color: '#64748b' }}>{employee.email}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="Chưa có nhân viên" style={{ padding: '24px 0' }}>
              {canCreate ? (
                <Button type="primary" onClick={() => navigate(`${baseRoute}/new`)}>
                  Thêm nhân viên đầu tiên
                </Button>
              ) : null}
            </Empty>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── EMPLOYEE FORM PAGE (CREATE / EDIT) ──────────────────────────────────────

export function OwnerEmployeeFormPage({
  userId: propUserId,
  baseRoute = '/owner/staff',
  apiPrefix = '/api/v1/owner/staff',
  userPermissions,
  isOwner,
  onBack,
}: StaffPageProps & { userId?: string } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();

  const urlUserId =
    location.pathname === `${baseRoute}/new` || location.pathname.endsWith('/new')
      ? undefined
      : location.pathname.split('/').at(-1);

  const userId = propUserId ?? urlUserId;
  const isCreate = !userId;

  const authContext = useAuthContext();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<EmployeeFormValues>();
  const [pinForm] = Form.useForm<{ pin: string }>();
  const [saving, setSaving] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);

  const isOwnerUser = isOwner ?? authContext.data?.actor?.kind === 'OWNER';
  const perms = userPermissions ?? [];

  const canCreate = isOwnerUser || perms.includes('staff.employees.create');
  const canEdit = isOwnerUser || perms.includes('staff.employees.edit');
  const canDelete = isOwnerUser || perms.includes('staff.employees.delete');

  const roles = useQuery({
    queryKey: ['staff-roles-list', apiPrefix],
    queryFn: () => apiRequest<Role[]>(`${apiPrefix}/roles`),
  });

  const employee = useQuery({
    queryKey: ['staff-employee-detail', apiPrefix, userId],
    queryFn: () => apiRequest<EmployeeDetail>(`${apiPrefix}/${userId}`),
    enabled: !isCreate && Boolean(userId),
  });

  const roleOptions = useMemo(
    () => (roles.data ?? []).map((role) => ({ value: role.id, label: role.name })),
    [roles.data],
  );

  useEffect(() => {
    if (isCreate) {
      const defaultRole = roles.data?.find((role) => role.code === 'EMPLOYEE') ?? roles.data?.[0];
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

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(baseRoute);
    }
  };

  const save = async (values: EmployeeFormValues) => {
    if (isCreate && !canCreate) {
      messageApi.error('Bạn không có quyền tạo nhân viên mới.');
      return;
    }
    if (!isCreate && !canEdit) {
      messageApi.error('Bạn không có quyền sửa thông tin nhân viên.');
      return;
    }

    setSaving(true);
    try {
      if (isCreate) {
        await jsonRequest(
          apiPrefix,
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
          `${apiPrefix}/${userId}`,
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
      await queryClient.invalidateQueries({ queryKey: ['staff-employees-list', apiPrefix] });
      handleBack();
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể lưu nhân viên.'));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'DISABLED') => {
    if (!userId) return;
    if (!canEdit) {
      messageApi.error('Bạn không có quyền thay đổi trạng thái nhân viên.');
      return;
    }
    try {
      await jsonRequest(
        `${apiPrefix}/${userId}/status`,
        { status },
        { method: 'PATCH', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: ['staff-employee-detail', apiPrefix, userId] });
      await queryClient.invalidateQueries({ queryKey: ['staff-employees-list', apiPrefix] });
      messageApi.success(
        status === 'ACTIVE' ? 'Đã kích hoạt nhân viên.' : 'Đã ngừng kích hoạt nhân viên.',
      );
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể thay đổi trạng thái nhân viên.'));
    }
  };

  const deleteEmployee = async () => {
    if (!userId) return;
    if (!canDelete) {
      messageApi.error('Bạn không có quyền xóa nhân viên.');
      return;
    }
    try {
      await apiRequest(`${apiPrefix}/${userId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: ['staff-employees-list', apiPrefix] });
      messageApi.success('Đã xóa nhân viên.');
      handleBack();
    } catch (error) {
      messageApi.error(feedback(error, 'Không thể xóa nhân viên.'));
    }
  };

  const resetPin = async ({ pin }: { pin: string }) => {
    if (!userId) return;
    if (!canEdit) {
      messageApi.error('Bạn không có quyền đổi mã PIN nhân viên.');
      return;
    }
    setPinSaving(true);
    try {
      await jsonRequest(
        `${apiPrefix}/${userId}/pin`,
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

  if (isCreate && !canCreate) {
    return (
      <div className="owner-staff-form-page" style={{ padding: '24px 0' }}>
        <Alert
          type="warning"
          showIcon
          title="Không có quyền tạo nhân viên"
          description="Bạn không có quyền tạo nhân viên mới. Vui lòng liên hệ quản lý để được cấp quyền."
        />
      </div>
    );
  }

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

      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={handleBack}
        style={{ paddingLeft: 0, marginBottom: 12 }}
      >
        Danh sách nhân viên
      </Button>

      <div className="owner-staff-form-heading">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {isCreate ? 'Thêm nhân viên' : employee.data?.displayName}
          </Typography.Title>
          {!isCreate ? (
            <Typography.Text type="secondary">@{employee.data?.username}</Typography.Text>
          ) : null}
        </div>
        {!isCreate ? (
          <Tag color={status === 'ACTIVE' ? 'success' : 'default'} style={{ fontSize: 13, padding: '4px 10px' }}>
            {status === 'ACTIVE' ? 'Đang kích hoạt' : 'Ngừng kích hoạt'}
          </Tag>
        ) : null}
      </div>

      <div className="owner-staff-form-layout">
        <aside className="owner-staff-form-intro">
          <Typography.Title level={4}>Tài khoản nhân viên</Typography.Title>
          <Typography.Paragraph type="secondary">
            Thông tin tài khoản, mã PIN và phân quyền vai trò của nhân viên.
          </Typography.Paragraph>
          <div className="owner-staff-form-tip">
            <SafetyCertificateOutlined />
            <span>
              Nhân viên đăng nhập bằng tên đăng nhập và mã PIN 4 số do quản lý cửa hàng cấp.
            </span>
          </div>
        </aside>

        <Card className="owner-staff-form-card" styles={{ body: { padding: 0 } }}>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
            <div className="owner-staff-form-section">
              <Row gutter={[12, 12]}>
                <Col xs={12} sm={12} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Họ tên" />}
                    name="displayName"
                    rules={[{ required: true, message: 'Vui lòng nhập họ tên.' }]}
                  >
                    <Input size="middle" maxLength={128} placeholder="Nhập họ tên" disabled={!isCreate && !canEdit} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Tên đăng nhập" />}
                    name="username"
                    rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}
                  >
                    <Input disabled={!isCreate} size="middle" maxLength={128} placeholder="Tên đăng nhập" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12} md={12}>
                  <Form.Item label="Email" name="email">
                    <Input size="middle" type="email" maxLength={254} placeholder="nhanvien@example.com" disabled={!isCreate && !canEdit} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12} md={12}>
                  <Form.Item
                    label={<RequiredLabel text="Vai trò" />}
                    name="roleId"
                    rules={[{ required: true, message: 'Vui lòng chọn vai trò.' }]}
                  >
                    <Select size="middle" options={roleOptions} placeholder="Chọn vai trò" disabled={!isCreate && !canEdit} />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            <div className="owner-staff-form-section owner-staff-form-section--pin">
              <Typography.Title level={5}>
                {isCreate ? 'Mã PIN đăng nhập' : 'Mã PIN'}
              </Typography.Title>
              <Typography.Paragraph type="secondary" className="owner-staff-form-pin-desc">
                {isCreate
                  ? 'Mã PIN gồm 4 chữ số để nhân viên đăng nhập vào hệ thống.'
                  : 'Đổi mã PIN khi cần cấp lại quyền truy cập cho nhân viên.'}
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
              ) : canEdit ? (
                <Button icon={<LockOutlined />} size="large" onClick={() => setPinModalOpen(true)}>
                  Đổi mã PIN
                </Button>
              ) : (
                <Typography.Text type="secondary">Không có quyền đổi mã PIN</Typography.Text>
              )}
            </div>

            <div className="owner-staff-form-actions">
              {!isCreate && canDelete ? (
                <Popconfirm
                  title="Xóa nhân viên?"
                  description="Tài khoản sẽ bị vô hiệu hóa và không thể đăng nhập."
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  onConfirm={deleteEmployee}
                >
                  <Button danger icon={<DeleteOutlined />} size="large">
                    Xóa
                  </Button>
                </Popconfirm>
              ) : (
                <span />
              )}
              <Space wrap>
                {!isCreate && canEdit ? (
                  <Button
                    size="large"
                    danger={status === 'ACTIVE'}
                    icon={status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />}
                    onClick={() => void setStatus(status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                  >
                    {status === 'ACTIVE' ? 'Ngừng kích hoạt' : 'Kích hoạt'}
                  </Button>
                ) : null}
                {(isCreate && canCreate) || (!isCreate && canEdit) ? (
                  <Button type="primary" size="large" htmlType="submit" loading={saving}>
                    Lưu nhân viên
                  </Button>
                ) : null}
              </Space>
            </div>
          </Form>
        </Card>
      </div>

      <Modal
        title="Đổi mã PIN đăng nhập"
        open={pinModalOpen}
        forceRender
        okText="Lưu mã PIN"
        cancelText="Hủy"
        width="min(440px, 95vw)"
        confirmLoading={pinSaving}
        onOk={() => pinForm.submit()}
        onCancel={() => setPinModalOpen(false)}
      >
        <Form form={pinForm} layout="vertical" onFinish={resetPin}>
          <Form.Item
            name="pin"
            label="Mã PIN mới (4 số)"
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
    <div className="owner-staff-page__spinner" style={{ padding: '40px 0' }}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {description}
      </Typography.Text>
      <Skeleton active paragraph={{ rows: 5 }} />
    </div>
  );
}
