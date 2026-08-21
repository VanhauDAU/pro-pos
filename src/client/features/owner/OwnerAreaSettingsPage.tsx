import {
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  PlusCircleOutlined,
  QrcodeOutlined,
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
  Select,
  Skeleton,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import QRCode from 'qrcode';

import type { AuthContextResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface AreaTable {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED';
  sortOrder: number;
  timeProductId: string | null;
  timeProductName: string | null;
}

interface TimeProduct {
  id: string;
  name: string;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  status: 'ACTIVE' | 'DISABLED';
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
  const [detailAreaId, setDetailAreaId] = useState<string | null>(null);
  const [renamingArea, setRenamingArea] = useState<{ id: string; name: string } | null>(null);
  const [renamingAreaSaving, setRenamingAreaSaving] = useState(false);
  const [editingTable, setEditingTable] = useState<AreaTable | null>(null);
  const [savingTable, setSavingTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableTimeProductId, setNewTableTimeProductId] = useState<string | null>(null);
  const [addingTable, setAddingTable] = useState(false);
  const [orderingAreaId, setOrderingAreaId] = useState<string | null>(null);
  const [pricingTableId, setPricingTableId] = useState<string | null>(null);
  const [qrGeneratingTableId, setQrGeneratingTableId] = useState<string | null>(null);
  const [qrPreview, setQrPreview] = useState<{
    tableName: string;
    url: string;
    image: string;
  } | null>(null);
  const [draggedTable, setDraggedTable] = useState<{ areaId: string; tableId: string } | null>(
    null,
  );
  const [tableForm] = Form.useForm<TableNameValues>();
  const [areaRenameForm] = Form.useForm<{ name: string }>();

  const layouts = useQuery({
    queryKey: AREA_LAYOUTS_QUERY,
    queryFn: () => apiRequest<AreaLayout[]>('/api/v1/owner/catalog/area-layouts'),
  });
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const timeProducts = useQuery({
    queryKey: ['owner-time-products'],
    queryFn: () => apiRequest<TimeProduct[]>('/api/v1/owner/catalog/products'),
  });

  const totalTables = useMemo(
    () => layouts.data?.reduce((sum, area) => sum + area.tables.length, 0) ?? 0,
    [layouts.data],
  );

  const detailArea = useMemo(
    () => layouts.data?.find((area) => area.id === detailAreaId) ?? null,
    [layouts.data, detailAreaId],
  );

  const openEdit = (table: AreaTable) => {
    setEditingTable(table);
    tableForm.setFieldsValue({ name: table.name });
  };

  const openRenameArea = (area: { id: string; name: string }) => {
    setRenamingArea(area);
    areaRenameForm.setFieldsValue({ name: area.name });
  };

  const generateTableQr = async (table: AreaTable) => {
    setQrGeneratingTableId(table.id);
    try {
      const result = await apiRequest<{ path: string }>(
        `/api/v1/owner/catalog/tables/${table.id}/qr-code/rotate`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      const url = new URL(result.path, window.location.origin).toString();
      setQrPreview({
        tableName: table.name,
        url,
        image: await QRCode.toDataURL(url, { width: 640, margin: 2 }),
      });
      messageApi.success('Đã tạo mã QR mới. Mã cũ của bàn không còn hiệu lực.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể tạo mã QR.'));
    } finally {
      setQrGeneratingTableId(null);
    }
  };

  const saveAreaName = async ({ name }: { name: string }) => {
    if (!renamingArea) return;
    setRenamingAreaSaving(true);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/areas/${renamingArea.id}`,
        { name: name.trim() },
        {
          method: 'PUT',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã đổi tên khu vực.');
      setRenamingArea(null);
      areaRenameForm.resetFields();
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể đổi tên khu vực.'));
    } finally {
      setRenamingAreaSaving(false);
    }
  };

  const saveTableName = async ({ name }: TableNameValues) => {
    if (!editingTable) return;
    setSavingTable(true);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/tables/${editingTable.id}`,
        { name: name.trim() },
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã cập nhật tên bàn/phòng.');
      setEditingTable(null);
      tableForm.resetFields();
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật bàn/phòng.'));
    } finally {
      setSavingTable(false);
    }
  };

  const createTableInArea = async () => {
    if (!detailArea || !newTableName.trim()) return;
    setAddingTable(true);
    try {
      await jsonRequest(
        '/api/v1/owner/catalog/tables',
        {
          areaId: detailArea.id,
          name: newTableName.trim(),
          timeProductId: newTableTimeProductId || null,
          sortOrder: detailArea.tables.length + 1,
        },
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success(`Đã thêm bàn "${newTableName.trim()}" vào khu vực ${detailArea.name}.`);
      setNewTableName('');
      setNewTableTimeProductId(null);
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể thêm bàn/phòng mới.'));
    } finally {
      setAddingTable(false);
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
      if (detailAreaId === area.id) {
        setDetailAreaId(null);
      }
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

  const saveTablePricing = async (table: AreaTable, timeProductId: string | null) => {
    if (table.status === 'OCCUPIED' || timeProductId === table.timeProductId) return;
    setPricingTableId(table.id);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/tables/${table.id}/pricing`,
        { timeProductId: timeProductId || null },
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
        },
      );
      await queryClient.invalidateQueries({ queryKey: AREA_LAYOUTS_QUERY });
      messageApi.success('Đã cập nhật bảng giá cho bàn/phòng.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật bảng giá.'));
    } finally {
      setPricingTableId(null);
    }
  };

  const pricingOptions = (table?: AreaTable) => {
    const options = (timeProducts.data ?? [])
      .filter((product) => product.productType === 'TIME' && product.status === 'ACTIVE')
      .map((product) => ({ value: product.id, label: product.name }));
    if (table?.timeProductId && !options.some((option) => option.value === table.timeProductId)) {
      options.unshift({
        value: table.timeProductId,
        label: table.timeProductName ?? 'Bảng giá hiện tại',
      });
    }
    return options;
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
            Thiết lập, sắp xếp, đổi tên và quản lý chi tiết các bàn/phòng theo từng khu vực trong
            cửa hàng.
          </Typography.Paragraph>
          <Card className="owner-area-stat-card" size="small">
            <div className="owner-area-stat-item">
              <Typography.Text type="secondary">Tổng số khu vực:</Typography.Text>
              <Typography.Text strong>{layouts.data?.length ?? 0} khu vực</Typography.Text>
            </div>
            <div className="owner-area-stat-item">
              <Typography.Text type="secondary">Tổng số bàn/phòng:</Typography.Text>
              <Typography.Text strong>{totalTables} bàn/phòng</Typography.Text>
            </div>
          </Card>
        </aside>

        <Card className="owner-area-list-card" styles={{ body: { padding: 0 } }}>
          <div className="owner-area-list-card__tab">Tất cả khu vực</div>
          <div className="owner-area-table__header">
            <span>Tên khu vực</span>
            <span style={{ textAlign: 'center' }}>Số lượng bàn/phòng</span>
            <span style={{ textAlign: 'right' }}>Thao tác</span>
          </div>

          {layouts.isLoading ? (
            <div className="owner-area-list-card__loading">
              <Skeleton active paragraph={{ rows: 5 }} />
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
              {layouts.data.map((area, index) => (
                <div className="owner-area-table__group" key={area.id}>
                  <div className="owner-area-table__row">
                    <button
                      type="button"
                      className="owner-area-table__name"
                      title="Bấm để xem chi tiết và quản lý bàn"
                      onClick={() => setDetailAreaId(area.id)}
                    >
                      <span className="owner-area-index">
                        {String(index + 1).padStart(2, '0')}.
                      </span>
                      <strong className="owner-area-name-text">{area.name}</strong>
                    </button>
                    <div style={{ textAlign: 'center' }}>
                      <Tag color="blue" className="owner-area-count-badge">
                        {area.tables.length} bàn/phòng
                      </Tag>
                    </div>
                    <div className="owner-area-row-actions">
                      <Button
                        type="primary"
                        ghost
                        size="small"
                        icon={<AppstoreOutlined />}
                        onClick={() => setDetailAreaId(area.id)}
                      >
                        Xem chi tiết
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        title="Đổi tên khu vực"
                        onClick={() => openRenameArea(area)}
                      />
                      <Popconfirm
                        title="Xóa khu vực?"
                        description="Khu vực và toàn bộ bàn/phòng đang trống sẽ không còn hiển thị."
                        okText="Xóa khu vực"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => deleteArea(area)}
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          title="Xóa khu vực"
                        />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="Chưa có khu vực nào" className="owner-area-empty">
              <Button type="primary" onClick={() => navigate('/owner/settings/areas/new')}>
                Thêm khu vực đầu tiên
              </Button>
            </Empty>
          )}
        </Card>
      </div>

      {/* POPUP MODAL: CHI TIẾT KHU VỰC VÀ QUẢN LÝ DANH SÁCH BÀN */}
      <Modal
        title={
          detailArea ? (
            <div className="owner-area-modal-title">
              <span className="owner-area-modal-title__icon">
                <AppstoreOutlined />
              </span>
              <span>
                Khu vực: <strong>{detailArea.name}</strong>
              </span>
              <Tag color="blue">{detailArea.tables.length} bàn/phòng</Tag>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openRenameArea(detailArea)}
              >
                Đổi tên
              </Button>
            </div>
          ) : (
            'Chi tiết khu vực'
          )
        }
        open={detailArea !== null}
        width={860}
        footer={[
          detailArea ? (
            <Popconfirm
              key="delete-area"
              title="Xóa toàn bộ khu vực?"
              description="Khu vực và các bàn/phòng trong khu vực này sẽ bị xóa."
              okText="Xóa khu vực"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteArea(detailArea)}
            >
              <Button danger type="text" icon={<DeleteOutlined />} style={{ float: 'left' }}>
                Xóa khu vực này
              </Button>
            </Popconfirm>
          ) : null,
          <Button key="close" type="primary" onClick={() => setDetailAreaId(null)}>
            Đóng
          </Button>,
        ]}
        onCancel={() => setDetailAreaId(null)}
      >
        {detailArea ? (
          <div className="owner-area-modal-content">
            {/* Thanh thêm bàn nhanh vào khu vực */}
            <div className="owner-area-add-table-bar">
              <Typography.Text strong className="owner-area-add-table-bar__title">
                Thêm bàn vào khu vực:
              </Typography.Text>
              <div className="owner-area-add-table-bar__form">
                <Input
                  placeholder="Ví dụ: Bàn 01, Bàn VIP 2..."
                  value={newTableName}
                  maxLength={120}
                  style={{ width: 220 }}
                  onChange={(e) => setNewTableName(e.target.value)}
                  onPressEnter={() => void createTableInArea()}
                />
                <Select
                  placeholder="Chọn bảng giá (tùy chọn)"
                  allowClear
                  style={{ width: 220 }}
                  value={newTableTimeProductId}
                  onChange={(value) => setNewTableTimeProductId(value ?? null)}
                  options={pricingOptions()}
                  notFoundContent="Chưa có bảng giá tính giờ"
                />
                <Button
                  type="primary"
                  icon={<PlusCircleOutlined />}
                  loading={addingTable}
                  disabled={!newTableName.trim()}
                  onClick={() => void createTableInArea()}
                >
                  Thêm bàn
                </Button>
              </div>
            </div>

            {/* Hướng dẫn sắp xếp */}
            <div className="owner-area-table-list-header">
              <Typography.Text type="secondary" className="owner-area-order-hint">
                💡 Dùng nút Lên / Xuống hoặc kéo biểu tượng ☰ để thay đổi thứ tự bàn hiển thị trên
                POS.
              </Typography.Text>
            </div>

            {/* Danh sách bàn chi tiết, rộng rãi */}
            {detailArea.tables.length ? (
              <div className="owner-area-modal-table-list">
                {detailArea.tables.map((table, tableIndex) => (
                  <div
                    className={`owner-area-modal-table-row${
                      orderingAreaId === detailArea.id
                        ? ' owner-area-modal-table-row--ordering'
                        : ''
                    }`}
                    key={table.id}
                    draggable={orderingAreaId === null}
                    onDragStart={() =>
                      setDraggedTable({ areaId: detailArea.id, tableId: table.id })
                    }
                    onDragEnd={() => setDraggedTable(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!draggedTable || draggedTable.areaId !== detailArea.id) return;
                      void saveTableOrder(
                        detailArea,
                        moveItemToTarget(detailArea.tables, draggedTable.tableId, table.id),
                      );
                    }}
                  >
                    <div className="owner-area-modal-table-col owner-area-modal-table-col--order">
                      <span className="owner-area-drag-handle" title="Kéo để sắp xếp thứ tự">
                        <MenuOutlined />
                      </span>
                      <span className="owner-area-order-number">#{tableIndex + 1}</span>
                    </div>

                    <div className="owner-area-modal-table-col owner-area-modal-table-col--name">
                      <span className="owner-area-table-icon">
                        <AppstoreOutlined />
                      </span>
                      <strong className="owner-area-table-title">{table.name}</strong>
                    </div>

                    <div className="owner-area-modal-table-col owner-area-modal-table-col--pricing">
                      <span className="owner-area-pricing-label">Bảng giá:</span>
                      <Select
                        className="owner-area-table-pricing-select"
                        allowClear
                        placeholder="Chọn bảng giá giờ"
                        value={table.timeProductId ?? null}
                        loading={timeProducts.isLoading || pricingTableId === table.id}
                        disabled={table.status === 'OCCUPIED' || pricingTableId === table.id}
                        options={pricingOptions(table)}
                        onChange={(value: string | null) => void saveTablePricing(table, value)}
                        notFoundContent="Chưa có bảng giá tính giờ"
                      />
                    </div>

                    <div className="owner-area-modal-table-col owner-area-modal-table-col--status">
                      {table.status === 'OCCUPIED' ? (
                        <Tag color="orange">Đang phục vụ</Tag>
                      ) : (
                        <Tag color="green">Sẵn sàng</Tag>
                      )}
                    </div>

                    <div className="owner-area-modal-table-col owner-area-modal-table-col--actions">
                      <Button
                        type="text"
                        size="small"
                        aria-label={`Tạo QR Order cho ${table.name}`}
                        icon={<QrcodeOutlined />}
                        title="Tạo mã QR Order"
                        loading={qrGeneratingTableId === table.id}
                        onClick={() => void generateTableQr(table)}
                      />
                      <Button
                        type="text"
                        size="small"
                        disabled={tableIndex === 0 || orderingAreaId === detailArea.id}
                        aria-label={`Đưa ${table.name} lên`}
                        icon={<ArrowUpOutlined />}
                        title="Đưa lên trên"
                        onClick={() =>
                          void saveTableOrder(
                            detailArea,
                            moveItem(detailArea.tables, tableIndex, tableIndex - 1),
                          )
                        }
                      />
                      <Button
                        type="text"
                        size="small"
                        disabled={
                          tableIndex === detailArea.tables.length - 1 ||
                          orderingAreaId === detailArea.id
                        }
                        aria-label={`Đưa ${table.name} xuống`}
                        icon={<ArrowDownOutlined />}
                        title="Đưa xuống dưới"
                        onClick={() =>
                          void saveTableOrder(
                            detailArea,
                            moveItem(detailArea.tables, tableIndex, tableIndex + 1),
                          )
                        }
                      />
                      <Button
                        type="text"
                        size="small"
                        aria-label={`Sửa ${table.name}`}
                        icon={<EditOutlined />}
                        title="Sửa tên bàn"
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
                          size="small"
                          disabled={table.status === 'OCCUPIED'}
                          aria-label={`Xóa ${table.name}`}
                          icon={<DeleteOutlined />}
                          title="Xóa bàn"
                        />
                      </Popconfirm>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Khu vực này hiện chưa có bàn/phòng nào"
                style={{ margin: '30px 0' }}
              />
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        title={`QR Order · ${qrPreview?.tableName ?? ''}`}
        open={qrPreview !== null}
        onCancel={() => setQrPreview(null)}
        footer={[
          <Button key="close" onClick={() => setQrPreview(null)}>
            Đóng
          </Button>,
          <Button
            key="download"
            type="primary"
            onClick={() => {
              if (!qrPreview) return;
              const link = document.createElement('a');
              link.href = qrPreview.image;
              link.download = `qr-order-${qrPreview.tableName}.png`;
              link.click();
            }}
          >
            Tải QR để in
          </Button>,
        ]}
      >
        {qrPreview ? (
          <div style={{ textAlign: 'center' }}>
            <img
              src={qrPreview.image}
              alt={`QR Order ${qrPreview.tableName}`}
              style={{ width: 280, maxWidth: '100%' }}
            />
            <Input
              value={qrPreview.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Alert
              style={{ marginTop: 12, textAlign: 'left' }}
              type="warning"
              showIcon
              title="Hãy tải và lưu mã này ngay. Tạo mã mới sẽ vô hiệu hóa QR cũ."
            />
          </div>
        ) : null}
      </Modal>

      {/* MODAL: SỬA TÊN BÀN */}
      <Modal
        title="Sửa tên bàn/phòng"
        open={editingTable !== null}
        okText="Lưu tên bàn"
        cancelText="Hủy"
        confirmLoading={savingTable}
        onOk={() => tableForm.submit()}
        onCancel={() => {
          setEditingTable(null);
          tableForm.resetFields();
        }}
      >
        <Form form={tableForm} layout="vertical" requiredMark={false} onFinish={saveTableName}>
          <Form.Item
            name="name"
            label="Tên bàn/phòng"
            rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên bàn/phòng.' }]}
          >
            <Input autoFocus maxLength={120} placeholder="Ví dụ: Bàn 01 hoặc Bàn VIP" />
          </Form.Item>
        </Form>
      </Modal>

      {/* MODAL: ĐỔI TÊN KHU VỰC */}
      <Modal
        title="Đổi tên khu vực"
        open={renamingArea !== null}
        okText="Lưu tên khu vực"
        cancelText="Hủy"
        confirmLoading={renamingAreaSaving}
        onOk={() => areaRenameForm.submit()}
        onCancel={() => {
          setRenamingArea(null);
          areaRenameForm.resetFields();
        }}
      >
        <Form form={areaRenameForm} layout="vertical" requiredMark={false} onFinish={saveAreaName}>
          <Form.Item
            name="name"
            label="Tên khu vực"
            rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên khu vực.' }]}
          >
            <Input autoFocus maxLength={160} placeholder="Ví dụ: Tầng 1, Tầng 2, Khu VIP" />
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
