import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownOutlined,
  PlusCircleOutlined,
  SafetyCertificateOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  Popconfirm,
  Skeleton,
  Space,
  Typography,
  message,
} from 'antd';
import type { CollapseProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
import { AuthContextResponse } from '@contracts/auth';

interface PermissionEntry {
  key: string;
  label: string;
}

interface PermissionSection {
  key: string;
  title: string;
  description: string;
  permissions: PermissionEntry[];
}

interface PermissionGroup {
  key: string;
  title: string;
  description: string;
  sections: PermissionSection[];
}

interface Role {
  id: string;
  code: string;
  name: string;
  isSystem: 0 | 1;
  memberCount: number;
  permissionCount: number;
}

interface RoleDetail extends Role {
  permissionKeys: string[];
}

const ROLES_QUERY = ['owner-roles'] as const;
const PERMISSIONS_QUERY = ['owner-role-permissions'] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function RoleBackLink({ label = 'Quay lại danh sách vai trò' }: { label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      className="owner-back-link"
      type="button"
      onClick={() => navigate('/owner/staff/roles')}
    >
      <ArrowLeftOutlined /> {label}
    </button>
  );
}

function useRoleAuthContext() {
  return useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
}

export function OwnerRolesPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const roles = useQuery({
    queryKey: ROLES_QUERY,
    queryFn: () => apiRequest<Role[]>('/api/v1/owner/staff/roles'),
  });
  const authContext = useRoleAuthContext();

  const deleteRole = async (role: Role) => {
    try {
      await apiRequest(`/api/v1/owner/staff/roles/${role.id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await roles.refetch();
      messageApi.success('Đã xóa vai trò.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể xóa vai trò.'));
    }
  };

  return (
    <div className="owner-role-page">
      {contextHolder}
      <div className="owner-role-heading">
        <Typography.Title level={2}>Danh sách vai trò</Typography.Title>
        <Button
          type="primary"
          size="large"
          icon={<PlusCircleOutlined />}
          onClick={() => navigate('/owner/staff/roles/new')}
        >
          Thêm vai trò
        </Button>
      </div>
      <div className="owner-role-layout">
        <aside className="owner-role-intro">
          <Typography.Title level={4}>Phân quyền vai trò chi tiết</Typography.Title>
          <Typography.Paragraph type="secondary">
            Thêm mới vai trò để quản lý nhân viên trong cửa hàng.
          </Typography.Paragraph>
          <div className="owner-role-tip">
            <SafetyCertificateOutlined />
            <span>Chỉ các quyền đã chọn mới được áp dụng cho nhân viên thuộc vai trò.</span>
          </div>
        </aside>
        <Card className="owner-role-list-card" styles={{ body: { padding: 0 } }}>
          <div className="owner-role-list-card__title">Phân quyền vai trò</div>
          {roles.isLoading ? (
            <div className="owner-role-list-loading">
              <Skeleton active />
            </div>
          ) : roles.isError ? (
            <Alert type="error" showIcon title="Không thể tải danh sách vai trò" />
          ) : roles.data?.length ? (
            <div className="owner-role-list">
              {roles.data.map((role) => {
                const expanded = expandedRole === role.id;
                return (
                  <div className="owner-role-list__item" key={role.id}>
                    <div className="owner-role-list__row">
                      <button
                        className="owner-role-list__name"
                        type="button"
                        onClick={() => navigate(`/owner/staff/roles/${role.id}`)}
                      >
                        {role.name}
                      </button>
                      <span className="owner-role-list__meta">
                        {role.memberCount} nhân viên · {role.permissionCount} quyền
                      </span>
                      <Button
                        type="text"
                        aria-label={`${expanded ? 'Ẩn' : 'Hiện'} thao tác vai trò ${role.name}`}
                        icon={expanded ? <UpOutlined /> : <DownOutlined />}
                        onClick={() => setExpandedRole(expanded ? null : role.id)}
                      />
                    </div>
                    {expanded ? (
                      <div className="owner-role-list__actions">
                        <Button onClick={() => navigate(`/owner/staff/roles/${role.id}`)}>
                          Sửa vai trò
                        </Button>
                        <Popconfirm
                          title="Xóa vai trò?"
                          description="Chỉ có thể xóa vai trò không còn nhân viên sử dụng."
                          okText="Xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          disabled={role.isSystem === 1 || role.memberCount > 0}
                          onConfirm={() => deleteRole(role)}
                        >
                          <Button
                            danger
                            disabled={role.isSystem === 1 || role.memberCount > 0}
                            icon={<DeleteOutlined />}
                          >
                            Xóa vai trò
                          </Button>
                        </Popconfirm>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="Chưa có vai trò" />
          )}
        </Card>
      </div>
    </div>
  );
}

export function OwnerRoleFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const roleId =
    location.pathname === '/owner/staff/roles/new'
      ? undefined
      : location.pathname.split('/').at(-1);
  const isCreate = !roleId;
  const authContext = useRoleAuthContext();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<{ name: string }>();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const permissions = useQuery({
    queryKey: PERMISSIONS_QUERY,
    queryFn: () => apiRequest<PermissionGroup[]>('/api/v1/owner/staff/roles/permissions'),
  });
  const role = useQuery({
    queryKey: ['owner-role', roleId],
    queryFn: () => apiRequest<RoleDetail>(`/api/v1/owner/staff/roles/${roleId}`),
    enabled: !isCreate,
  });

  const allKeys = useMemo(
    () =>
      permissions.data?.flatMap((group) =>
        group.sections.flatMap((section) =>
          section.permissions.map((permission) => permission.key),
        ),
      ) ?? [],
    [permissions.data],
  );

  useEffect(() => {
    if (isCreate) {
      form.setFieldValue('name', '');
      return;
    }
    if (role.data) {
      form.setFieldValue('name', role.data.name);
      setSelectedKeys(role.data.permissionKeys);
    }
  }, [form, isCreate, role.data]);

  const toggleSection = (section: PermissionSection, checked: boolean) => {
    const keys = section.permissions.map((permission) => permission.key);
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (checked ? next.add(key) : next.delete(key)));
      return [...next];
    });
  };

  const save = async ({ name }: { name: string }) => {
    setSaving(true);
    try {
      const body = { name, permissionKeys: selectedKeys };
      if (isCreate) {
        await jsonRequest('/api/v1/owner/staff/roles', body, {
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        });
        messageApi.success('Đã thêm vai trò.');
      } else {
        await jsonRequest(`/api/v1/owner/staff/roles/${roleId}`, body, {
          method: 'PUT',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        });
        messageApi.success('Đã lưu vai trò.');
      }
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY });
      navigate('/owner/staff/roles');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể lưu vai trò.'));
    } finally {
      setSaving(false);
    }
  };

  if (permissions.isLoading || (!isCreate && role.isLoading)) {
    return (
      <div className="owner-role-form-page">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }
  if (permissions.isError || (!isCreate && (role.isError || !role.data))) {
    return <Alert type="error" showIcon title="Không thể tải quyền của vai trò" />;
  }

  const collapseItems: CollapseProps['items'] =
    permissions.data?.flatMap((group) => [
      {
        key: group.key,
        label: (
          <div className="owner-role-permission-group-label">
            <Checkbox
              checked={group.sections
                .flatMap((section) => section.permissions)
                .every((permission) => selectedKeys.includes(permission.key))}
              indeterminate={
                group.sections
                  .flatMap((section) => section.permissions)
                  .some((permission) => selectedKeys.includes(permission.key)) &&
                !group.sections
                  .flatMap((section) => section.permissions)
                  .every((permission) => selectedKeys.includes(permission.key))
              }
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const keys = group.sections.flatMap((section) =>
                  section.permissions.map((permission) => permission.key),
                );
                setSelectedKeys((current) => {
                  const next = new Set(current);
                  keys.forEach((key) => (event.target.checked ? next.add(key) : next.delete(key)));
                  return [...next];
                });
              }}
            >
              <strong>{group.title}</strong>
            </Checkbox>
            <small>{group.description}</small>
          </div>
        ),
        children: (
          <div className="owner-role-permission-group">
            {group.sections.map((section) => {
              const keys = section.permissions.map((permission) => permission.key);
              const checkedCount = keys.filter((key) => selectedKeys.includes(key)).length;
              return (
                <section className="owner-role-permission-section" key={section.key}>
                  <div className="owner-role-permission-section__heading">
                    <Checkbox
                      checked={checkedCount === keys.length}
                      indeterminate={checkedCount > 0 && checkedCount < keys.length}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => toggleSection(section, event.target.checked)}
                    >
                      <strong>{section.title}</strong>
                    </Checkbox>
                    <Typography.Text type="secondary">
                      {checkedCount}/{keys.length}
                    </Typography.Text>
                  </div>
                  <Typography.Text type="secondary">{section.description}</Typography.Text>
                  <div className="owner-role-permission-grid">
                    {section.permissions.map((permission) => (
                      <Checkbox
                        key={permission.key}
                        checked={selectedKeys.includes(permission.key)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          setSelectedKeys((current) =>
                            event.target.checked
                              ? [...current, permission.key]
                              : current.filter((key) => key !== permission.key),
                          );
                        }}
                      >
                        {permission.label}
                      </Checkbox>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ),
      },
    ]) ?? [];

  return (
    <div className="owner-role-form-page">
      {contextHolder}
      <div className="owner-role-form-heading">
        <RoleBackLink />
        <Typography.Title level={2}>{isCreate ? 'Thêm vai trò' : role.data?.name}</Typography.Title>
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Card className="owner-role-name-card">
          <Form.Item
            label={
              <span>
                Tên vai trò <b className="owner-required">(*)</b>
              </span>
            }
            name="name"
            rules={[{ required: true, message: 'Vui lòng nhập tên vai trò.' }]}
          >
            <Input maxLength={128} placeholder="Ví dụ: Thu ngân" />
          </Form.Item>
        </Card>
        <div className="owner-role-permission-toolbar">
          <Typography.Text strong>DANH SÁCH QUYỀN ÁP DỤNG</Typography.Text>
          <Space>
            <Button
              type="link"
              onClick={() => setSelectedKeys(selectedKeys.length === allKeys.length ? [] : allKeys)}
            >
              {selectedKeys.length === allKeys.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </Button>
            <Button
              type="link"
              onClick={() =>
                setActiveKeys(
                  activeKeys.length ? [] : (permissions.data?.map((group) => group.key) ?? []),
                )
              }
            >
              {activeKeys.length ? 'Đóng tất cả' : 'Mở tất cả'}
            </Button>
          </Space>
        </div>
        <Collapse
          className="owner-role-permission-collapse"
          items={collapseItems}
          activeKey={activeKeys}
          onChange={(keys) =>
            setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])
          }
        />
        <div className="owner-role-form-actions">
          <Button onClick={() => navigate('/owner/staff/roles')}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            Lưu
          </Button>
        </div>
      </Form>
    </div>
  );
}
