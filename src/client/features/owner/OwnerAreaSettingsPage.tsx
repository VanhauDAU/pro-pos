import {
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  MenuOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface AreaTable {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED';
  sortOrder: number;
}

interface AreaLayout {
  id: string;
  name: string;
  sortOrder: number;
  tables: AreaTable[];
}

interface DraftTable {
  id: string;
  name: string;
}

interface TableNameValues {
  name: string;
}

const AREA_LAYOUTS_QUERY = ['owner-area-layouts'] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return items;
  next.splice(toIndex, 0, item);
  return next;
}

function moveItemToTarget<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
) {
  return moveItem(
    items,
    items.findIndex((item) => item.id === sourceId),
    items.findIndex((item) => item.id === targetId),
  );
}

function AreaBackLink({ label = 'Quay lại thiết lập cửa hàng' }: { label?: string }) {
  const navigate = useNavigate();
  return (
    <button className="owner-back-link" type="button" onClick={() => navigate('/owner/settings')}>
      <ArrowLeftOutlined /> {label}
    </button>
  );
}

export function OwnerAreaSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [expandedAreaId, setExpandedAreaId] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<AreaTable | null>(null);
  const [savingTable, setSavingTable] = useState(false);
  const [orderingAreaId, setOrderingAreaId] = useState<string | null>(null);
  const [draggedTable, setDraggedTable] = useState<{ areaId: string; tableId: string } | null>(
    null,
  );
  const [form] = Form.useForm<TableNameValues>();

  const layouts = useQuery({
    queryKey: AREA_LAYOUTS_QUERY,
    queryFn: () => apiRequest<AreaLayout[]>('/api/v1/owner/catalog/area-layouts'),
  });
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const totalTables = useMemo(
    () => layouts.data?.reduce((sum, area) => sum + area.tables.length, 0) ?? 0,
    [layouts.data],
  );

  const openEdit = (table: AreaTable) => {
    setEditingTable(table);
    form.setFieldsValue({ name: table.name });
  };

  const saveTableName = async ({ name }: TableNameValues) => {
    if (!editingTable) return;
    setSavingTable(true);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/tables/${editingTable.id}`,
        { name },
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã cập nhật tên bàn/phòng.');
      setEditingTable(null);
      form.resetFields();
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật bàn/phòng.'));
    } finally {
      setSavingTable(false);
    }
  };

  const deleteTable = async (table: AreaTable) => {
    try {
      await apiRequest(`/api/v1/owner/catalog/tables/${table.id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã xóa bàn/phòng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể xóa bàn/phòng.'));
    }
  };

  const deleteArea = async (area: AreaLayout) => {
    try {
      await apiRequest(`/api/v1/owner/catalog/area-layouts/${area.id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      setExpandedAreaId(null);
      messageApi.success('Đã xóa khu vực và các bàn/phòng thuộc khu vực.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể xóa khu vực.'));
    }
  };

  const saveTableOrder = async (area: AreaLayout, orderedTables: AreaTable[]) => {
    if (orderedTables.every((table, index) => table.id === area.tables[index]?.id)) return;
    setOrderingAreaId(area.id);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/area-layouts/${area.id}/table-order`,
        { tableIds: orderedTables.map((table) => table.id) },
        {
          method: 'PUT',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã cập nhật thứ tự bàn/phòng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật thứ tự bàn/phòng.'));
    } finally {
      setOrderingAreaId(null);
      setDraggedTable(null);
    }
  };

  return (
    <div className="owner-area-page">
      {contextHolder}
      <div className="owner-area-heading">
        <div>
          <AreaBackLink />
          <Typography.Title level={2}>Thiết lập khu vực</Typography.Title>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusCircleOutlined />}
          onClick={() => navigate('/owner/settings/areas/new')}
        >
          Thêm khu vực
        </Button>
      </div>

      <div className="owner-area-list-layout">
        <aside className="owner-area-intro">
          <Typography.Title level={4}>Danh sách khu vực</Typography.Title>
          <Typography.Paragraph type="secondary">
            Cho phép thiết lập, sắp xếp, chỉnh sửa các khu vực, bàn/phòng trong cửa hàng.
          </Typography.Paragraph>
          <Typography.Text>
            Tổng số: {totalTables} bàn/phòng / {layouts.data?.length ?? 0} khu vực
          </Typography.Text>
        </aside>

        <Card className="owner-area-list-card" styles={{ body: { padding: 0 } }}>
          <div className="owner-area-list-card__tab">Tất cả khu vực</div>
          <div className="owner-area-table__header">
            <span>Tên khu vực</span>
            <span>Số lượng bàn/phòng</span>
            <span aria-hidden="true" />
          </div>

          {layouts.isLoading ? (
            <div className="owner-area-list-card__loading">
              <Skeleton active />
            </div>
          ) : layouts.isError ? (
            <Alert
              type="error"
              showIcon
              title="Không thể tải danh sách khu vực"
              action={<Button onClick={() => void layouts.refetch()}>Thử lại</Button>}
            />
          ) : layouts.data?.length ? (
            <div className="owner-area-table">
              {layouts.data.map((area, index) => {
                const expanded = expandedAreaId === area.id;
                return (
                  <div className="owner-area-table__group" key={area.id}>
                    <div className="owner-area-table__row">
                      <button
                        type="button"
                        className="owner-area-table__name"
                        aria-expanded={expanded}
                        onClick={() => setExpandedAreaId(expanded ? null : area.id)}
                      >
                        <span>{String(index + 1).padStart(2, '0')}.</span> {area.name}
                      </button>
                      <span className="owner-area-table__count">{area.tables.length}</span>
                      <Button
                        type="text"
                        aria-label={`${expanded ? 'Ẩn' : 'Hiện'} bàn/phòng của ${area.name}`}
                        icon={<HolderOutlined />}
                        onClick={() => setExpandedAreaId(expanded ? null : area.id)}
                      />
                    </div>
                    {expanded ? (
                      <div className="owner-area-table__details">
                        <div className="owner-area-detail-toolbar">
                          {area.tables.length ? (
                            <Typography.Text className="owner-area-order-hint" type="secondary">
                              Kéo thả hoặc dùng nút lên/xuống để đổi thứ tự hiển thị.
                            </Typography.Text>
                          ) : (
                            <span />
                          )}
                          <Popconfirm
                            title="Xóa khu vực?"
                            description="Khu vực và toàn bộ bàn/phòng đang trống sẽ không còn hiển thị."
                            okText="Xóa khu vực"
                            cancelText="Hủy"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => deleteArea(area)}
                          >
                            <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                              Xóa khu vực
                            </Button>
                          </Popconfirm>
                        </div>
                        {area.tables.length ? (
                          area.tables.map((table, tableIndex) => (
                            <div
                              className={`owner-area-existing-table${
                                orderingAreaId === area.id
                                  ? ' owner-area-existing-table--ordering'
                                  : ''
                              }`}
                              key={table.id}
                              draggable={orderingAreaId === null}
                              onDragStart={() =>
                                setDraggedTable({ areaId: area.id, tableId: table.id })
                              }
                              onDragEnd={() => setDraggedTable(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => {
                                if (!draggedTable || draggedTable.areaId !== area.id) return;
                                void saveTableOrder(
                                  area,
                                  moveItemToTarget(area.tables, draggedTable.tableId, table.id),
                                );
                              }}
                            >
                              <span className="owner-area-drag-handle" title="Kéo để sắp xếp">
                                <MenuOutlined />
                              </span>
                              <span className="owner-area-table-icon">
                                <AppstoreOutlined />
                              </span>
                              <span className="owner-area-existing-table__name">{table.name}</span>
                              {table.status === 'OCCUPIED' ? (
                                <Tag color="processing">Đang dùng</Tag>
                              ) : null}
                              <Button
                                type="text"
                                disabled={tableIndex === 0 || orderingAreaId === area.id}
                                aria-label={`Đưa ${table.name} lên`}
                                icon={<ArrowUpOutlined />}
                                onClick={() =>
                                  void saveTableOrder(
                                    area,
                                    moveItem(area.tables, tableIndex, tableIndex - 1),
                                  )
                                }
                              />
                              <Button
                                type="text"
                                disabled={
                                  tableIndex === area.tables.length - 1 ||
                                  orderingAreaId === area.id
                                }
                                aria-label={`Đưa ${table.name} xuống`}
                                icon={<ArrowDownOutlined />}
                                onClick={() =>
                                  void saveTableOrder(
                                    area,
                                    moveItem(area.tables, tableIndex, tableIndex + 1),
                                  )
                                }
                              />
                              <Button
                                type="text"
                                aria-label={`Sửa ${table.name}`}
                                icon={<EditOutlined />}
                                onClick={() => openEdit(table)}
                              />
                              <Popconfirm
                                title="Xóa bàn/phòng?"
                                description="Bàn/phòng sẽ không còn hiển thị trong khu vực."
                                okText="Xóa"
                                cancelText="Hủy"
                                okButtonProps={{ danger: true }}
                                disabled={table.status === 'OCCUPIED'}
                                onConfirm={() => deleteTable(table)}
                              >
                                <Button
                                  type="text"
                                  danger
                                  disabled={table.status === 'OCCUPIED'}
                                  aria-label={`Xóa ${table.name}`}
                                  icon={<DeleteOutlined />}
                                />
                              </Popconfirm>
                            </div>
                          ))
                        ) : (
                          <Typography.Text type="secondary">
                            Khu vực chưa có bàn/phòng.
                          </Typography.Text>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="Chưa có khu vực" className="owner-area-empty">
              <Button type="primary" onClick={() => navigate('/owner/settings/areas/new')}>
                Thêm khu vực đầu tiên
              </Button>
            </Empty>
          )}
        </Card>
      </div>

      <Modal
        title="Sửa bàn/phòng"
        open={editingTable !== null}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={savingTable}
        onOk={() => form.submit()}
        onCancel={() => {
          setEditingTable(null);
          form.resetFields();
        }}
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={saveTableName}>
          <Form.Item
            name="name"
            label="Tên bàn/phòng"
            rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên bàn/phòng.' }]}
          >
            <Input autoFocus maxLength={120} placeholder="Ví dụ: Bàn 01" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function OwnerAreaCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [areaName, setAreaName] = useState('');
  const [tables, setTables] = useState<DraftTable[]>([]);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<DraftTable | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggedDraftId, setDraggedDraftId] = useState<string | null>(null);
  const [tableForm] = Form.useForm<TableNameValues>();
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const openTableModal = (table?: DraftTable) => {
    setEditingDraft(table ?? null);
    tableForm.setFieldsValue({ name: table?.name ?? '' });
    setTableModalOpen(true);
  };

  const closeTableModal = () => {
    setTableModalOpen(false);
    setEditingDraft(null);
    tableForm.resetFields();
  };

  const saveDraftTable = ({ name }: TableNameValues) => {
    const normalizedName = name.trim();
    if (editingDraft) {
      setTables((current) =>
        current.map((table) =>
          table.id === editingDraft.id ? { ...table, name: normalizedName } : table,
        ),
      );
    } else {
      setTables((current) => [...current, { id: crypto.randomUUID(), name: normalizedName }]);
    }
    closeTableModal();
  };

  const saveArea = async () => {
    if (!areaName.trim() || tables.length === 0) return;
    setSaving(true);
    try {
      await jsonRequest(
        '/api/v1/owner/catalog/area-layouts',
        { name: areaName, tables: tables.map(({ name }) => ({ name })) },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã tạo khu vực và bàn/phòng.');
      navigate('/owner/settings/areas');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể tạo khu vực.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="owner-area-page owner-area-create-page">
      {contextHolder}
      <div className="owner-area-heading">
        <div>
          <AreaBackLink label="Quản lý bàn/phòng" />
          <Typography.Title level={2}>Tạo khu vực</Typography.Title>
        </div>
        <Button type="primary" size="large" onClick={() => openTableModal()}>
          Thêm bàn/phòng mới
        </Button>
      </div>

      <Card className="owner-area-create-card" styles={{ body: { padding: 0 } }}>
        <div className="owner-area-name-field">
          <label htmlFor="area-name">Tên khu vực</label>
          <Input
            id="area-name"
            value={areaName}
            maxLength={160}
            placeholder="Nhập tên khu vực"
            onChange={(event) => setAreaName(event.target.value)}
          />
        </div>
        <div className="owner-area-canvas">
          {tables.length ? (
            <div className="owner-area-draft-layout">
              <Typography.Text className="owner-area-order-hint" type="secondary">
                Kéo thả hoặc dùng nút lên/xuống để đổi thứ tự hiển thị.
              </Typography.Text>
              <div className="owner-area-draft-grid">
                {tables.map((table, tableIndex) => (
                  <div
                    className="owner-area-draft-table"
                    key={table.id}
                    draggable
                    onDragStart={() => setDraggedDraftId(table.id)}
                    onDragEnd={() => setDraggedDraftId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!draggedDraftId) return;
                      setTables((current) => moveItemToTarget(current, draggedDraftId, table.id));
                      setDraggedDraftId(null);
                    }}
                  >
                    <div className="owner-area-draft-table__shape">
                      <span>{table.name}</span>
                    </div>
                    <div className="owner-area-draft-table__actions">
                      <Button
                        size="small"
                        type="text"
                        disabled={tableIndex === 0}
                        icon={<ArrowUpOutlined />}
                        aria-label={`Đưa ${table.name} lên`}
                        onClick={() =>
                          setTables((current) => moveItem(current, tableIndex, tableIndex - 1))
                        }
                      />
                      <Button
                        size="small"
                        type="text"
                        disabled={tableIndex === tables.length - 1}
                        icon={<ArrowDownOutlined />}
                        aria-label={`Đưa ${table.name} xuống`}
                        onClick={() =>
                          setTables((current) => moveItem(current, tableIndex, tableIndex + 1))
                        }
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Sửa ${table.name}`}
                        onClick={() => openTableModal(table)}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`Xóa ${table.name}`}
                        onClick={() =>
                          setTables((current) => current.filter((item) => item.id !== table.id))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Thêm ít nhất 1 bàn/phòng để tạo khu vực"
            >
              <Button type="primary" ghost onClick={() => openTableModal()}>
                Thêm bàn/phòng mới
              </Button>
            </Empty>
          )}
        </div>
      </Card>

      <div className="owner-area-create-actions">
        <Button size="large" onClick={() => navigate('/owner/settings/areas')}>
          Hủy
        </Button>
        <Button
          type="primary"
          size="large"
          loading={saving}
          disabled={!areaName.trim() || tables.length === 0}
          onClick={saveArea}
        >
          Lưu
        </Button>
      </div>

      <Modal
        title={editingDraft ? 'Sửa bàn/phòng' : 'Thêm bàn/phòng mới'}
        open={tableModalOpen}
        okText={editingDraft ? 'Lưu' : 'Thêm'}
        cancelText="Hủy"
        onOk={() => tableForm.submit()}
        onCancel={closeTableModal}
      >
        <Form form={tableForm} layout="vertical" requiredMark={false} onFinish={saveDraftTable}>
          <Form.Item
            name="name"
            label="Tên bàn/phòng"
            rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên bàn/phòng.' }]}
          >
            <Input autoFocus maxLength={120} placeholder="Ví dụ: Bàn 01 hoặc Phòng VIP" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
