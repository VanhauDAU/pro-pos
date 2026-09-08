import {
  ClearOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';

import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';

import type {
  DatabaseStorageReport,
  DatabaseTableCategory,
  DatabaseTableStorageRow,
} from '@contracts/platform';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
import { formatBytes } from '@client/lib/format-bytes';

interface DatabaseMaintenancePanelProps {
  csrfToken?: string | null;
  active?: boolean;
}

function readableError(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Không thể phân tích dung lượng cơ sở dữ liệu. Hoạt động POS không bị ảnh hưởng.';
}

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function formatRelativeTime(timestamp: number | null | undefined) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  return `${Math.floor(diffSec / 86400)} ngày trước`;
}

function renderCategoryTag(category: DatabaseTableCategory) {
  switch (category) {
    case 'OPERATIONAL':
      return <Tag color="orange">Operational</Tag>;
    case 'FINANCIAL':
      return <Tag color="green">Financial</Tag>;
    case 'SECURITY':
      return <Tag color="purple">Security</Tag>;
    case 'CONFIGURATION':
      return <Tag color="blue">Configuration</Tag>;
    case 'OTHER':
    default:
      return <Tag color="default">Other</Tag>;
  }
}

export function DatabaseMaintenancePanel({
  csrfToken,
  active = true,
}: DatabaseMaintenancePanelProps) {
  const queryClient = useQueryClient();
  const [cleaningDb, setCleaningDb] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, isFetching, error, refetch } = useQuery<DatabaseStorageReport>({
    queryKey: ['platform-database-storage'],
    queryFn: () => apiRequest<DatabaseStorageReport>('/api/v1/platform/maintenance/storage'),
    enabled: active,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    message.info('Đang phân tích lại cơ sở dữ liệu...');
    try {
      await refetch();
      message.success('Đã cập nhật số liệu cơ sở dữ liệu.');
    } catch {
      // Error handled by query state
    }
  };

  const handleCleanup = async () => {
    setCleaningDb(true);
    try {
      const res = await jsonRequest<{
        totalDeleted: number;
        durationMs: number;
        policy: Record<string, number>;
        tables: Record<string, number>;
      }>(
        '/api/v1/platform/maintenance/cleanup',
        {},
        {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        },
      );

      const activeDeletions = Object.entries(res.tables || {}).filter(([, count]) => count > 0);
      Modal.success({
        title: 'Dọn dẹp dữ liệu vận hành hoàn tất',
        width: 480,
        content: (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Tổng cộng đã dọn: {res.totalDeleted.toLocaleString('vi-VN')} bản ghi ({res.durationMs}{' '}
              ms)
            </p>
            {activeDeletions.length > 0 ? (
              <div
                style={{
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '8px 12px',
                }}
              >
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#334155' }}>
                  {activeDeletions.map(([tbl, count]) => (
                    <li key={tbl} style={{ padding: '2px 0' }}>
                      <strong>{tbl}</strong>: {count.toLocaleString('vi-VN')} bản ghi
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ color: '#64748b', margin: 0 }}>
                Hệ thống sạch sẽ, không có bản ghi nào hết hạn cần dọn.
              </p>
            )}
          </div>
        ),
      });

      void queryClient.invalidateQueries({ queryKey: ['platform-database-storage'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-analytics'] });
      await refetch();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Không thể hoàn tất thao tác dọn dẹp.');
    } finally {
      setCleaningDb(false);
    }
  };

  const top10Tables = useMemo(() => {
    if (!data?.tables) return [];
    return data.tables.slice(0, 10);
  }, [data?.tables]);

  const maxTopBytes = useMemo(() => {
    return top10Tables[0]?.estimatedDataBytes || 1;
  }, [top10Tables]);

  const filteredTables = useMemo(() => {
    if (!data?.tables) return [];
    if (!searchQuery.trim()) return data.tables;
    const q = searchQuery.trim().toLowerCase();
    return data.tables.filter((t) => t.tableName.toLowerCase().includes(q));
  }, [data?.tables, searchQuery]);

  const columns: ColumnsType<DatabaseTableStorageRow> = useMemo(
    () => [
      {
        title: 'Bảng',
        dataIndex: 'tableName',
        key: 'tableName',
        render: (name: string) => (
          <code style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{name}</code>
        ),
      },
      {
        title: 'Số bản ghi',
        dataIndex: 'rowCount',
        key: 'rowCount',
        align: 'right',
        sorter: (a, b) => a.rowCount - b.rowCount,
        render: (count: number) => count.toLocaleString('vi-VN'),
      },
      {
        title: (
          <Tooltip title="Dung lượng từng bảng được ước tính từ dữ liệu logic đang lưu. Số liệu này dùng để xác định bảng tăng trưởng lớn, không bao gồm chính xác toàn bộ SQLite page và index overhead.">
            <span>
              Dung lượng ước tính <InfoCircleOutlined style={{ fontSize: 12, color: '#94a3b8' }} />
            </span>
          </Tooltip>
        ),
        dataIndex: 'estimatedDataBytes',
        key: 'estimatedDataBytes',
        align: 'right',
        defaultSortOrder: 'descend',
        sorter: (a, b) => a.estimatedDataBytes - b.estimatedDataBytes,
        render: (bytes: number) => (
          <Tooltip title={`${bytes.toLocaleString('vi-VN')} bytes`}>
            <span style={{ fontWeight: 600 }}>~{formatBytes(bytes)}</span>
          </Tooltip>
        ),
      },
      {
        title: 'TB / bản ghi',
        dataIndex: 'averageRowBytes',
        key: 'averageRowBytes',
        align: 'right',
        sorter: (a, b) => a.averageRowBytes - b.averageRowBytes,
        render: (bytes: number, row) => (
          <Tooltip title={`${bytes.toLocaleString('vi-VN')} bytes/bản ghi`}>
            <span style={{ color: '#475569' }}>
              {row.rowCount > 0 ? `~${formatBytes(bytes)}` : '0 B'}
            </span>
          </Tooltip>
        ),
      },
      {
        title: (
          <Tooltip title="Tỷ trọng dựa trên dữ liệu logic ước tính của các bảng, không phải kích thước vật lý SQLite.">
            <span>
              Tỷ trọng <InfoCircleOutlined style={{ fontSize: 12, color: '#94a3b8' }} />
            </span>
          </Tooltip>
        ),
        dataIndex: 'estimatedSharePercent',
        key: 'estimatedSharePercent',
        align: 'right',
        sorter: (a, b) => a.estimatedSharePercent - b.estimatedSharePercent,
        render: (percent: number) => (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}
          >
            <Progress
              percent={percent}
              size="small"
              showInfo={false}
              style={{ width: 60, margin: 0 }}
              strokeColor="#3b82f6"
            />
            <span style={{ fontSize: 12.5, minWidth: 42, textAlign: 'right' }}>
              {percent.toFixed(1)}%
            </span>
          </div>
        ),
      },
      {
        title: 'Index',
        dataIndex: 'indexCount',
        key: 'indexCount',
        align: 'center',
        sorter: (a, b) => a.indexCount - b.indexCount,
        render: (count: number) => (
          <Tag style={{ borderRadius: 4, margin: 0 }}>
            {count} {count <= 1 ? 'index' : 'indexes'}
          </Tag>
        ),
      },
      {
        title: 'Loại dữ liệu',
        dataIndex: 'category',
        key: 'category',
        align: 'center',
        render: (cat: DatabaseTableCategory) => renderCategoryTag(cat),
      },
      {
        title: 'Chính sách lưu trữ',
        dataIndex: 'retentionLabel',
        key: 'retentionLabel',
        render: (label: string, row) =>
          row.automaticallyCleaned ? (
            <Tag color="cyan" style={{ borderRadius: 6 }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              {label}
            </Tag>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {label}
            </Typography.Text>
          ),
      },
    ],
    [],
  );

  if (isLoading) {
    return (
      <Card
        style={{
          marginTop: 16,
          textAlign: 'center',
          padding: '80px 0',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
        }}
      >
        <Spin size="large" description="Đang phân tích cơ sở dữ liệu..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không thể phân tích dung lượng cơ sở dữ liệu. Hoạt động POS không bị ảnh hưởng."
        description={readableError(error)}
        action={
          <Button type="primary" danger size="small" onClick={() => void refetch()}>
            Thử lại
          </Button>
        }
        style={{ borderRadius: 12, marginTop: 16 }}
      />
    );
  }

  if (!data || data.tables.length === 0) {
    return (
      <Card style={{ marginTop: 16, borderRadius: 16, border: '1px solid #e2e8f0', padding: 40 }}>
        <Empty description="Chưa có dữ liệu để phân tích." />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
      {/* Header Info & Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            Cơ sở dữ liệu
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Theo dõi dung lượng D1 và dữ liệu vận hành. Dung lượng theo từng bảng là số liệu ước
            tính từ dữ liệu logic.
          </Typography.Text>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            icon={<ReloadOutlined spin={isFetching} />}
            loading={isFetching}
            onClick={() => void handleRefresh()}
          >
            Phân tích lại
          </Button>

          <Popconfirm
            title="Dọn dẹp dữ liệu vận hành?"
            description="Dọn dữ liệu vận hành đã hết hạn theo chính sách lưu trữ. Không xóa hóa đơn, thanh toán, đơn hàng đang tồn tại, danh mục hoặc cấu hình."
            okText="Dọn dẹp ngay"
            cancelText="Hủy"
            okButtonProps={{ danger: true, loading: cleaningDb }}
            onConfirm={() => void handleCleanup()}
          >
            <Button icon={<ClearOutlined />} loading={cleaningDb} danger>
              Dọn dữ liệu vận hành
            </Button>
          </Popconfirm>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="platform-kpi-grid">
        {/* Card 1: Tổng dung lượng D1 */}
        <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
          <div className="stat-card-inner">
            <div className="stat-icon-wrapper stat-icon-wrapper--blue">
              <DatabaseOutlined />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                  TỔNG DUNG LƯỢNG D1
                </Typography.Text>
                <Tooltip
                  title={
                    data.databaseSizeBytes !== null
                      ? 'Tổng dung lượng D1 hiện tại.'
                      : 'Cloudflare D1 không cung cấp số liệu này qua runtime hiện tại.'
                  }
                >
                  <InfoCircleOutlined style={{ fontSize: 12, color: '#94a3b8' }} />
                </Tooltip>
              </div>
              <div style={{ marginTop: 4 }}>
                <Typography.Title level={3} style={{ margin: 0, fontWeight: 800 }}>
                  {data.databaseSizeBytes !== null
                    ? formatBytes(data.databaseSizeBytes)
                    : 'Không khả dụng'}
                </Typography.Title>
              </div>
            </div>
          </div>
        </Card>

        {/* Card 2: Số bảng */}
        <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
          <div className="stat-card-inner">
            <div className="stat-icon-wrapper stat-icon-wrapper--purple">
              <TableOutlined />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                SỐ BẢNG
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Typography.Title level={3} style={{ margin: 0, fontWeight: 800 }}>
                  {data.tableCount}
                </Typography.Title>
              </div>
            </div>
          </div>
        </Card>

        {/* Card 3: Dữ liệu ước tính */}
        <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
          <div className="stat-card-inner">
            <div className="stat-icon-wrapper stat-icon-wrapper--green">
              <CloudServerOutlined />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                  DỮ LIỆU ƯỚC TÍNH
                </Typography.Text>
                <Tooltip title="Dung lượng từng bảng được ước tính từ dữ liệu logic đang lưu. Số liệu này dùng để xác định bảng tăng trưởng lớn, không bao gồm chính xác toàn bộ SQLite page và index overhead.">
                  <InfoCircleOutlined style={{ fontSize: 12, color: '#94a3b8' }} />
                </Tooltip>
              </div>
              <div style={{ marginTop: 4 }}>
                <Typography.Title level={3} style={{ margin: 0, fontWeight: 800 }}>
                  ~{formatBytes(data.totalEstimatedDataBytes)}
                </Typography.Title>
              </div>
            </div>
          </div>
        </Card>

        {/* Card 4: Cập nhật lần cuối */}
        <Card className="platform-stat-card-v2" styles={{ body: { padding: '20px 22px' } }}>
          <div className="stat-card-inner">
            <div className="stat-icon-wrapper stat-icon-wrapper--amber">
              <ClockCircleOutlined />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 650 }}>
                CẬP NHẬT LẦN CUỐI
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Typography.Text strong style={{ fontSize: 15, display: 'block' }}>
                  {formatDateTime(data.capturedAt)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatRelativeTime(data.capturedAt)}
                </Typography.Text>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* TOP 10 BẢNG THEO DUNG LƯỢNG ƯỚC TÍNH */}
      <Card
        className="platform-chart-card"
        styles={{ body: { padding: '22px 24px' } }}
        title={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>TOP BẢNG THEO DUNG LƯỢNG ƯỚC TÍNH</span>
            <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
              10 bảng chứa dung lượng logic lớn nhất
            </Typography.Text>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {top10Tables.map((table) => {
            const barWidthPercent =
              maxTopBytes > 0
                ? Math.min(
                    100,
                    Math.max(1, Math.round((table.estimatedDataBytes / maxTopBytes) * 100)),
                  )
                : 0;

            return (
              <div
                key={table.tableName}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '6px 0',
                }}
              >
                {/* Table Name */}
                <div
                  style={{
                    width: 220,
                    minWidth: 160,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <code style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {table.tableName}
                  </code>
                </div>

                {/* Bar */}
                <div style={{ flex: 1, position: 'relative' }}>
                  <div
                    style={{
                      height: 14,
                      borderRadius: 7,
                      background: '#f1f5f9',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        width: `${barWidthPercent}%`,
                        height: '100%',
                        borderRadius: 7,
                        background:
                          table.category === 'FINANCIAL'
                            ? 'linear-gradient(90deg, #10b981, #059669)'
                            : table.category === 'OPERATIONAL'
                              ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                              : table.category === 'SECURITY'
                                ? 'linear-gradient(90deg, #8b5cf6, #7c3aed)'
                                : 'linear-gradient(90deg, #3b82f6, #2563eb)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>

                {/* Size Label */}
                <div style={{ width: 90, textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                  ~{formatBytes(table.estimatedDataBytes)}
                </div>

                {/* Records & Category */}
                <div
                  style={{
                    width: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {table.rowCount.toLocaleString('vi-VN')} bản ghi
                  </span>
                  {renderCategoryTag(table.category)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* CHI TIẾT BẢNG */}
      <Card
        className="platform-chart-card"
        styles={{ body: { padding: '22px 24px' } }}
        title={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>CHI TIẾT BẢNG</span>
              <Badge
                count={filteredTables.length}
                overflowCount={999}
                style={{ backgroundColor: '#e2e8f0', color: '#475569' }}
              />
            </div>

            <Input
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              placeholder="Tìm theo tên bảng..."
              allowClear
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 240, borderRadius: 8 }}
            />
          </div>
        }
      >
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="Dữ liệu tài chính và cấu hình có thể tăng theo thời gian và không được tự động xóa chỉ để giảm dung lượng."
          style={{ marginBottom: 16, borderRadius: 8, fontSize: 13 }}
        />

        <Table<DatabaseTableStorageRow>
          rowKey="tableName"
          columns={columns}
          dataSource={filteredTables}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total, range) => `${range[0]}-${range[1]} của ${total} bảng`,
          }}
          scroll={{ x: 960 }}
          size="middle"
        />
      </Card>
    </div>
  );
}
