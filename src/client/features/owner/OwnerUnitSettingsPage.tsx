import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface Unit {
  id: string;
  name: string;
  productCount: number;
}

interface UnitListResponse {
  items: Unit[];
  total: number;
  page: number;
  pageSize: number;
}

interface UnitProduct {
  id: string;
  name: string;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  status: 'ACTIVE' | 'DISABLED';
  categoryName: string | null;
}

interface UnitProductResponse {
  items: UnitProduct[];
  total: number;
  page: number;
  pageSize: number;
}

interface UnitDetail {
  id: string;
  name: string;
}

const UNIT_QUERY = ['owner-units'] as const;

const productTypeLabels: Record<UnitProduct['productType'], string> = {
  QUANTITY: 'Số lượng',
  WEIGHT: 'Trọng lượng',
  TIME: 'Thời gian',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function BackLink() {
  const navigate = useNavigate();
  return (
    <button className="owner-back-link" type="button" onClick={() => navigate('/owner/settings')}>
      <ArrowLeftOutlined /> Quay lại thiết lập cửa hàng
    </button>
  );
}

function useAuthContext() {
  return useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
}

export function OwnerUnitSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const authContext = useAuthContext();
  const units = useQuery({
    queryKey: [...UNIT_QUERY, search, page],
    queryFn: () =>
      apiRequest<UnitListResponse>(
        `/api/v1/owner/catalog/units?page=${page}&pageSize=10&q=${encodeURIComponent(search)}`,
      ),
  });

  const create = async ({ name }: { name: string }) => {
    try {
      await jsonRequest(
        '/api/v1/owner/catalog/units',
        { name },
        { headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: UNIT_QUERY });
      setOpen(false);
      form.resetFields();
      messageApi.success('Đã thêm đơn vị.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể thêm đơn vị.'));
    }
  };

  const columns: TableColumnsType<Unit> = [
    {
      title: 'Đơn vị',
      dataIndex: 'name',
      render: (name, unit) => (
        <Button
          type="link"
          className="owner-unit-name-link"
          onClick={() => navigate(`/owner/settings/units/${unit.id}`)}
        >
          {name}
        </Button>
      ),
    },
    {
      title: 'Số lượng mặt hàng sử dụng',
      dataIndex: 'productCount',
      align: 'right',
      render: (count) => count ?? 0,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      align: 'right',
      render: (_, unit) => (
        <Button
          type="link"
          icon={<EditOutlined />}
          onClick={() => navigate(`/owner/settings/units/${unit.id}`)}
        >
          Chỉnh sửa
        </Button>
      ),
    },
  ];

  return (
    <div className="owner-unit-page">
      {contextHolder}
      <BackLink />
      <div className="owner-unit-heading">
        <div>
          <Typography.Title level={2}>Đơn vị</Typography.Title>
          <Typography.Text type="secondary">
            Quản lý đơn vị dùng cho mặt hàng số lượng và trọng lượng.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Thêm đơn vị
        </Button>
      </div>
      <Card className="owner-unit-card">
        <Input
          prefix={<SearchOutlined />}
          placeholder="Tìm kiếm đơn vị"
          value={search}
          allowClear
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="owner-unit-search"
        />
        {units.isLoading ? (
          <Skeleton active />
        ) : units.isError ? (
          <Alert type="error" showIcon title="Không thể tải danh sách đơn vị" />
        ) : units.data?.items.length ? (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={units.data.items}
            scroll={{ x: 680 }}
            pagination={{
              current: units.data.page,
              pageSize: units.data.pageSize,
              total: units.data.total,
              showSizeChanger: false,
              showTotal: (total, range) =>
                `Hiển thị từ ${range[0]} đến ${range[1]} trên tổng ${total}`,
              onChange: (nextPage) => setPage(nextPage),
            }}
          />
        ) : (
          <Empty description="Chưa có đơn vị" />
        )}
      </Card>
      <Modal
        title="Thêm đơn vị"
        open={open}
        onCancel={() => setOpen(false)}
        okText="Thêm đơn vị"
        cancelText="Hủy"
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={create}>
          <Form.Item
            name="name"
            label="Tên đơn vị"
            rules={[{ required: true, message: 'Vui lòng nhập tên đơn vị.' }]}
          >
            <Input autoFocus maxLength={120} placeholder="Ví dụ: Cái, Chai, Ly, Kilogram" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function OwnerUnitDetailPage({ unitId }: { unitId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const authContext = useAuthContext();
  const unit = useQuery({
    queryKey: ['owner-unit', unitId],
    queryFn: () => apiRequest<UnitDetail>(`/api/v1/owner/catalog/units/${unitId}`),
  });
  const products = useQuery({
    queryKey: ['owner-unit-products', unitId, search, page],
    queryFn: () =>
      apiRequest<UnitProductResponse>(
        `/api/v1/owner/catalog/units/${unitId}/products?page=${page}&pageSize=10&q=${encodeURIComponent(search)}`,
      ),
  });

  useEffect(() => {
    if (unit.data) setName(unit.data.name);
  }, [unit.data]);

  const save = async () => {
    setSaving(true);
    try {
      await jsonRequest(
        `/api/v1/owner/catalog/units/${unitId}`,
        { name },
        { method: 'PUT', headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' } },
      );
      await queryClient.invalidateQueries({ queryKey: UNIT_QUERY });
      await queryClient.invalidateQueries({ queryKey: ['owner-unit', unitId] });
      messageApi.success('Đã cập nhật đơn vị.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể cập nhật đơn vị.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await apiRequest(`/api/v1/owner/catalog/units/${unitId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: UNIT_QUERY });
      messageApi.success('Đã xóa đơn vị.');
      navigate('/owner/settings/units');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể xóa đơn vị.'));
    }
  };

  const columns: TableColumnsType<UnitProduct> = [
    {
      title: 'Mặt hàng',
      dataIndex: 'name',
      render: (value) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: 'Loại mặt hàng',
      dataIndex: 'productType',
      render: (value) => productTypeLabels[value as UnitProduct['productType']],
    },
    { title: 'Danh mục', dataIndex: 'categoryName', render: (value) => value || 'Chưa phân loại' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      render: (value) => (
        <Tag color={value === 'ACTIVE' ? 'success' : 'default'}>
          {value === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}
        </Tag>
      ),
    },
  ];

  if (unit.isLoading) return <Skeleton active />;
  if (unit.isError || !unit.data)
    return <Alert type="error" showIcon title="Không thể tải đơn vị" />;

  return (
    <div className="owner-unit-page">
      {contextHolder}
      <button
        className="owner-back-link"
        type="button"
        onClick={() => navigate('/owner/settings/units')}
      >
        <ArrowLeftOutlined /> Quay lại danh sách đơn vị
      </button>
      <div className="owner-unit-heading">
        <div>
          <Typography.Title level={2}>Chỉnh sửa đơn vị</Typography.Title>
          <Typography.Text type="secondary">
            Cập nhật tên đơn vị và xem các mặt hàng đang sử dụng.
          </Typography.Text>
        </div>
        <Space>
          <Popconfirm
            title="Xóa đơn vị này?"
            description="Chỉ xóa được đơn vị chưa được mặt hàng sử dụng."
            onConfirm={remove}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button danger icon={<DeleteOutlined />}>
              Xóa
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            Lưu
          </Button>
        </Space>
      </div>
      <Row gutter={[20, 20]}>
        <Col xs={24} md={8}>
          <Card className="owner-unit-summary-card">
            <Statistic title="Đơn vị" value={name} prefix={<TagOutlined />} />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className="owner-unit-name-input"
            />
            <Typography.Paragraph type="secondary" className="owner-unit-summary-note">
              Số lượng mặt hàng sử dụng được cập nhật tự động từ dữ liệu cửa hàng.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="Mặt hàng sử dụng đơn vị này" className="owner-unit-card">
            <Input
              prefix={<SearchOutlined />}
              placeholder="Tìm kiếm mặt hàng"
              value={search}
              allowClear
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="owner-unit-search"
            />
            {products.isLoading ? (
              <Skeleton active />
            ) : products.data?.items.length ? (
              <Table
                rowKey="id"
                columns={columns}
                dataSource={products.data.items}
                scroll={{ x: 650 }}
                pagination={{
                  current: products.data.page,
                  pageSize: products.data.pageSize,
                  total: products.data.total,
                  showSizeChanger: false,
                  showTotal: (total, range) =>
                    `Hiển thị từ ${range[0]} đến ${range[1]} trên tổng ${total}`,
                  onChange: (nextPage) => setPage(nextPage),
                }}
              />
            ) : (
              <Empty description="Chưa có mặt hàng sử dụng đơn vị này" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
