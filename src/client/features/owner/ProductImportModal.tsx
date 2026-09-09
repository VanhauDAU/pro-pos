import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Empty,
  Modal,
  Result,
  Spin,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useRef, useState } from 'react';

import type {
  CatalogImportCommitResult,
  CatalogImportIssue,
  CatalogImportPreviewItem,
  CatalogImportPreviewResult,
  CatalogImportRow,
} from '@contracts/catalog';
import type { AuthContextResponse } from '@contracts/auth';
import { apiRequest, jsonRequest } from '@client/lib/api';

import {
  downloadCatalogImportReport,
  downloadCatalogWorkbook,
  CATALOG_TEMPLATE_SAMPLE_ROWS,
  parseCatalogImportFile,
  type CatalogExcelError,
} from './catalog-excel';

interface ProductImportModalProps {
  open: boolean;
  onClose: () => void;
  onCommitted: () => Promise<void>;
}

function stamp() {
  return new Date().toISOString().replaceAll(/[-:]/gu, '').slice(0, 13).replace('T', '-');
}

async function downloadTemplate() {
  await downloadCatalogWorkbook(
    CATALOG_TEMPLATE_SAMPLE_ROWS,
    'pro-pos-mau-nhap-mat-hang.xlsx',
    true,
  );
}

export function ProductImportModal({ open, onClose, onCommitted }: ProductImportModalProps) {
  const [stage, setStage] = useState(0);
  const [rows, setRows] = useState<CatalogImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [autoCreateCategories, setAutoCreateCategories] = useState(false);
  const [autoCreateUnits, setAutoCreateUnits] = useState(false);
  const [skipInvalidGroups, setSkipInvalidGroups] = useState(false);
  const [preview, setPreview] = useState<CatalogImportPreviewResult | null>(null);
  const [result, setResult] = useState<CatalogImportCommitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('valid');
  const commitIdRef = useRef<string | null>(null);

  const reset = () => {
    setStage(0);
    setRows([]);
    setFileName('');
    setPreview(null);
    setResult(null);
    setError(null);
    setSkipInvalidGroups(false);
    setActiveTab('valid');
    commitIdRef.current = null;
  };

  const close = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseCatalogImportFile(file);
      setRows(parsed);
      setFileName(file.name);
      setStage(1);
    } catch (exception) {
      const parsedError = exception as CatalogExcelError;
      setError(parsedError.message || 'Không thể đọc file Excel.');
    } finally {
      setLoading(false);
    }
  };

  const runPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await jsonRequest<CatalogImportPreviewResult>(
        '/api/v1/owner/catalog/import/preview',
        { rows, autoCreateCategories, autoCreateUnits },
        {
          headers: {
            'X-CSRF-Token':
              (await apiRequest<AuthContextResponse>('/api/v1/auth/context')).csrfToken ?? '',
          },
        },
      );
      setPreview(data);
      commitIdRef.current = crypto.randomUUID();
      const validCount = (data.summary.createProducts ?? 0) + (data.summary.updateProducts ?? 0);
      setActiveTab(validCount > 0 ? 'valid' : 'errors');
      setStage(2);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Không thể kiểm tra dữ liệu.');
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const csrfToken =
        (await apiRequest<AuthContextResponse>('/api/v1/auth/context')).csrfToken ?? '';
      const idempotencyKey = commitIdRef.current ?? crypto.randomUUID();
      commitIdRef.current = idempotencyKey;
      const data = await jsonRequest<CatalogImportCommitResult>(
        '/api/v1/owner/catalog/import/commit',
        {
          rows,
          autoCreateCategories,
          autoCreateUnits,
          normalizedPayloadHash: preview.normalizedPayloadHash,
          skipInvalidGroups,
        },
        {
          headers: {
            'X-CSRF-Token': csrfToken,
            'Idempotency-Key': idempotencyKey,
          },
        },
      );
      setResult(data);
      setStage(3);
      await onCommitted();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Không thể nhập dữ liệu.');
    } finally {
      setLoading(false);
    }
  };

  const report = () => {
    const source = result ?? preview;
    if (!source) return;
    void downloadCatalogImportReport({
      rows,
      issues: source.issues,
      summary: source.summary,
      fileName: `pro-pos-${result ? 'ket-qua-nhap' : 'mat-hang-loi'}-${stamp()}.xlsx`,
      mode: result ? 'result' : 'error',
    });
  };

  const validItems =
    preview?.items?.filter((item) => item.action === 'CREATE' || item.action === 'UPDATE') ?? [];
  const errorIssues = preview?.issues.filter((issue) => issue.action === 'ERROR') ?? [];
  const skippedIssues = preview?.issues.filter((issue) => issue.action === 'SKIP') ?? [];
  const hasErrors = (preview?.summary.errorRows ?? 0) > 0 || errorIssues.length > 0;

  const validColumns = [
    {
      title: 'Dòng',
      dataIndex: 'sourceRow',
      key: 'sourceRow',
      width: 65,
      align: 'center' as const,
      render: (row: number) => <span className="catalog-import-row-badge">#{row}</span>,
    },
    {
      title: 'Mặt hàng',
      dataIndex: 'name',
      key: 'name',
      minWidth: 160,
      render: (_: unknown, item: CatalogImportPreviewItem) => (
        <div className="catalog-import-item-name-cell">
          <strong className="catalog-import-item-name">{item.name}</strong>
          {item.productId ? (
            <span className="catalog-import-item-id" title={item.productId}>
              ID: {item.productId.slice(0, 8)}...
            </span>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Phân loại',
      key: 'type',
      minWidth: 150,
      render: (_: unknown, item: CatalogImportPreviewItem) => {
        let typeColor = 'default';
        let typeText = 'Số lượng';
        if (item.productType === 'TIME' || item.productType === 'Thời gian') {
          typeColor = 'cyan';
          typeText = 'Tính giờ';
        } else if (item.productType === 'WEIGHT' || item.productType === 'Trọng lượng') {
          typeColor = 'purple';
          typeText = 'Trọng lượng';
        } else if (item.productType === 'QUANTITY' || item.productType === 'Số lượng') {
          typeColor = 'blue';
          typeText = 'Số lượng';
        }

        return (
          <div className="catalog-import-type-cell">
            <Tag color={typeColor} style={{ marginRight: 4, fontSize: 11 }}>
              {typeText}
            </Tag>
            {item.categoryName ? (
              <span className="catalog-import-meta-pill" title="Danh mục">
                📁 {item.categoryName}
              </span>
            ) : null}
            {item.unitName ? (
              <span className="catalog-import-meta-pill" title="Đơn vị tính">
                🏷️ {item.unitName}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: 'Giá bán / Phiên bản',
      key: 'pricing',
      minWidth: 180,
      render: (_: unknown, item: CatalogImportPreviewItem) => (
        <div className="catalog-import-price-cell">
          <span className="catalog-import-main-price">{item.priceDisplay}</span>
          {item.variantsSummary ? (
            <div className="catalog-import-variants-summary" title={item.variantsSummary}>
              <small>{item.variantsSummary}</small>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      key: 'action',
      width: 110,
      align: 'center' as const,
      render: (action: string) =>
        action === 'CREATE' ? (
          <Tag color="success" style={{ fontWeight: 600 }}>
            Tạo mới
          </Tag>
        ) : (
          <Tag color="processing" style={{ fontWeight: 600 }}>
            Cập nhật
          </Tag>
        ),
    },
  ];

  const errorColumns = [
    {
      title: 'Dòng',
      dataIndex: 'sourceRow',
      key: 'sourceRow',
      width: 75,
      align: 'center' as const,
      render: (row: number) => (
        <Tag color="error" style={{ fontWeight: 600 }}>
          Dòng {row}
        </Tag>
      ),
    },
    {
      title: 'Mặt hàng',
      dataIndex: 'productGroup',
      key: 'productGroup',
      minWidth: 140,
      render: (group: string) => <strong>{group}</strong>,
    },
    {
      title: 'Cột bị lỗi',
      dataIndex: 'field',
      key: 'field',
      minWidth: 120,
      render: (field: string | null) =>
        field ? (
          <Tag color="warning" style={{ fontWeight: 500 }}>
            {field}
          </Tag>
        ) : (
          <Tag color="default">Dữ liệu</Tag>
        ),
    },
    {
      title: 'Chi tiết lỗi',
      dataIndex: 'message',
      key: 'message',
      minWidth: 200,
      render: (msg: string) => <span className="catalog-import-error-msg">{msg}</span>,
    },
    {
      title: 'Gợi ý sửa',
      dataIndex: 'suggestion',
      key: 'suggestion',
      minWidth: 180,
      render: (sug: string | null) => (
        <span className="catalog-import-suggestion-text">{sug || '--'}</span>
      ),
    },
  ];

  const skippedColumns = [
    {
      title: 'Dòng',
      dataIndex: 'sourceRow',
      key: 'sourceRow',
      width: 75,
      align: 'center' as const,
      render: (row: number) => <span className="catalog-import-row-badge">#{row}</span>,
    },
    {
      title: 'Mặt hàng',
      dataIndex: 'productGroup',
      key: 'productGroup',
      minWidth: 160,
      render: (group: string) => <strong>{group}</strong>,
    },
    {
      title: 'Lý do bỏ qua',
      dataIndex: 'message',
      key: 'message',
      minWidth: 200,
      render: (msg: string) => <Tag color="warning">{msg}</Tag>,
    },
    {
      title: 'Gợi ý',
      dataIndex: 'suggestion',
      key: 'suggestion',
      minWidth: 200,
      render: (sug: string | null) => <span>{sug || '--'}</span>,
    },
  ];

  const tabItems = [
    {
      key: 'valid',
      label: (
        <span>
          Sẽ đưa vào{' '}
          <Badge
            count={validItems.length}
            overflowCount={9999}
            style={{ backgroundColor: '#16a34a', marginLeft: 4 }}
          />
        </span>
      ),
      children: (
        <div className="catalog-import-table-wrap">
          <Table<CatalogImportPreviewItem>
            size="small"
            rowKey={(item) => `${item.sourceRow}-${item.productId ?? item.name}`}
            dataSource={validItems}
            columns={validColumns}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 650 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Không có mặt hàng nào hợp lệ để đưa vào"
                />
              ),
            }}
          />
        </div>
      ),
    },
    {
      key: 'errors',
      label: (
        <span>
          Bị lỗi{' '}
          <Badge
            count={preview?.summary.errorRows ?? 0}
            overflowCount={9999}
            style={{ backgroundColor: hasErrors ? '#dc2626' : '#94a3b8', marginLeft: 4 }}
          />
        </span>
      ),
      children: (
        <div className="catalog-import-table-wrap">
          {errorIssues.length > 0 ? (
            <Table<CatalogImportIssue>
              size="small"
              rowKey={(row) => `${row.sourceRow}-${row.errorCode}-${row.field}`}
              dataSource={errorIssues}
              columns={errorColumns}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              scroll={{ x: 650 }}
            />
          ) : (
            <Result
              status="success"
              title="Dữ liệu hợp lệ, không có dòng nào bị lỗi!"
              style={{ padding: '24px 0' }}
            />
          )}
        </div>
      ),
    },
    ...(preview && (preview.summary.skippedProducts > 0 || skippedIssues.length > 0)
      ? [
          {
            key: 'skipped',
            label: (
              <span>
                Bỏ qua{' '}
                <Badge
                  count={preview.summary.skippedProducts || skippedIssues.length}
                  overflowCount={9999}
                  style={{ backgroundColor: '#d97706', marginLeft: 4 }}
                />
              </span>
            ),
            children: (
              <div className="catalog-import-table-wrap">
                <Table<CatalogImportIssue>
                  size="small"
                  rowKey={(row) => `${row.sourceRow}-${row.productGroup}`}
                  dataSource={skippedIssues}
                  columns={skippedColumns}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  scroll={{ x: 600 }}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <Modal
      open={open}
      title="Nhập danh sách mặt hàng"
      width={960}
      className="catalog-import-modal"
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      <Steps
        current={stage}
        items={[
          { title: 'Chọn file' },
          { title: 'Kiểm tra dữ liệu' },
          { title: 'Xác nhận' },
          { title: 'Kết quả' },
        ]}
      />
      <Divider />
      {loading ? (
        <Spin
          description={
            stage === 0
              ? 'Đang đọc file'
              : stage < 3
                ? 'Đang kiểm tra dữ liệu'
                : 'Đang nhập dữ liệu'
          }
        />
      ) : null}
      {error ? (
        <Result
          status="error"
          title="Không thể xử lý file"
          subTitle={error}
          extra={
            stage === 2 ? (
              <>
                <Button onClick={() => setError(null)}>Quay lại xác nhận</Button>
                <Button type="primary" onClick={() => void commit()}>
                  Thử lại
                </Button>
              </>
            ) : (
              <Button type="primary" onClick={() => setError(null)}>
                Chọn lại file
              </Button>
            )
          }
        />
      ) : null}
      {!loading && !error && stage === 0 ? (
        <div>
          <Typography.Paragraph>
            Chỉ hỗ trợ .xlsx, tối đa 1 MB và 2.000 dòng. Hệ thống luôn kiểm tra trước khi nhập.
          </Typography.Paragraph>
          <input
            aria-label="Chọn file Excel"
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          <Divider />
          <Button icon={<DownloadOutlined />} onClick={() => void downloadTemplate()}>
            Tải file mẫu
          </Button>
        </div>
      ) : null}
      {!loading && !error && stage === 1 ? (
        <div>
          <Typography.Paragraph>
            Đã đọc {rows.length} dòng từ {fileName}.
          </Typography.Paragraph>
          <Checkbox
            checked={autoCreateCategories}
            onChange={(event) => setAutoCreateCategories(event.target.checked)}
          >
            Tự động tạo danh mục chưa tồn tại
          </Checkbox>
          <br />
          <Checkbox
            checked={autoCreateUnits}
            onChange={(event) => setAutoCreateUnits(event.target.checked)}
          >
            Tự động tạo đơn vị chưa tồn tại
          </Checkbox>
          <Divider />
          <Button onClick={() => setStage(0)}>Chọn file khác</Button>{' '}
          <Button type="primary" onClick={() => void runPreview()}>
            Kiểm tra dữ liệu
          </Button>
        </div>
      ) : null}
      {!loading && !error && stage === 2 && preview ? (
        <div>
          {/* Summary KPI cards */}
          <div className="catalog-import-summary">
            <div className="catalog-import-kpi-card catalog-import-kpi-card--success">
              <div className="catalog-import-kpi-card__header">
                <CheckCircleOutlined className="catalog-import-kpi-card__icon" />
                <span className="catalog-import-kpi-card__label">Sẽ đưa vào</span>
              </div>
              <div className="catalog-import-kpi-card__val">
                {validItems.length} <small>mặt hàng</small>
              </div>
              <div className="catalog-import-kpi-card__sub">
                Tạo mới: {preview.summary.createProducts} · Cập nhật:{' '}
                {preview.summary.updateProducts}
              </div>
            </div>

            <div
              className={`catalog-import-kpi-card ${hasErrors ? 'catalog-import-kpi-card--error' : 'catalog-import-kpi-card--muted'}`}
            >
              <div className="catalog-import-kpi-card__header">
                <CloseCircleOutlined className="catalog-import-kpi-card__icon" />
                <span className="catalog-import-kpi-card__label">Mặt hàng lỗi</span>
              </div>
              <div className="catalog-import-kpi-card__val">
                {preview.summary.errorRows} <small>dòng</small>
              </div>
              <div className="catalog-import-kpi-card__sub">
                {hasErrors ? 'Cần sửa hoặc chọn bỏ qua' : 'Không có lỗi nào'}
              </div>
            </div>

            {preview.summary.skippedProducts > 0 ? (
              <div className="catalog-import-kpi-card catalog-import-kpi-card--warning">
                <div className="catalog-import-kpi-card__header">
                  <MinusCircleOutlined className="catalog-import-kpi-card__icon" />
                  <span className="catalog-import-kpi-card__label">Bỏ qua</span>
                </div>
                <div className="catalog-import-kpi-card__val">
                  {preview.summary.skippedProducts} <small>mặt hàng</small>
                </div>
                <div className="catalog-import-kpi-card__sub">Đã tồn tại trên hệ thống</div>
              </div>
            ) : null}

            {(preview.summary.categoriesToCreate?.length ?? 0) > 0 ||
            (preview.summary.unitsToCreate?.length ?? 0) > 0 ? (
              <div className="catalog-import-kpi-card catalog-import-kpi-card--info">
                <div className="catalog-import-kpi-card__header">
                  <PlusCircleOutlined className="catalog-import-kpi-card__icon" />
                  <span className="catalog-import-kpi-card__label">Tự tạo mới</span>
                </div>
                <div className="catalog-import-kpi-card__val">
                  {(preview.summary.categoriesToCreate?.length ?? 0) +
                    (preview.summary.unitsToCreate?.length ?? 0)}{' '}
                  <small>mục</small>
                </div>
                <div className="catalog-import-kpi-card__sub">
                  Danh mục: {preview.summary.categoriesToCreate?.length ?? 0} · Đơn vị:{' '}
                  {preview.summary.unitsToCreate?.length ?? 0}
                </div>
              </div>
            ) : null}
          </div>

          {/* Interactive Tabs for reviewing valid items vs error issues */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            style={{ marginTop: 8 }}
          />

          {/* Warning and skip option if there are invalid rows */}
          {hasErrors ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 14 }}
              message="Phát hiện dữ liệu không hợp lệ trong file"
              description={
                <div style={{ marginTop: 4 }}>
                  <div>
                    Có <strong>{preview.summary.errorRows} dòng dữ liệu bị lỗi</strong>. Bạn có thể
                    tải file lỗi để xem chi tiết và sửa lại, hoặc tích chọn bên dưới để bỏ qua các
                    dòng lỗi và chỉ nhập các mặt hàng hợp lệ.
                  </div>
                  <Checkbox
                    checked={skipInvalidGroups}
                    onChange={(event) => setSkipInvalidGroups(event.target.checked)}
                    style={{ marginTop: 8, fontWeight: 600 }}
                  >
                    Bỏ qua {preview.summary.errorRows} dòng lỗi và tiếp tục nhập {validItems.length}{' '}
                    mặt hàng hợp lệ
                  </Checkbox>
                </div>
              }
            />
          ) : null}

          <Divider style={{ margin: '16px 0' }} />

          {/* Action buttons */}
          <div className="catalog-import-actions">
            <div className="catalog-import-actions__left">
              {hasErrors ? (
                <Button icon={<DownloadOutlined />} onClick={report}>
                  Tải file lỗi để sửa
                </Button>
              ) : null}
            </div>
            <div className="catalog-import-actions__right">
              <Button onClick={() => setStage(1)}>Quay lại</Button>
              <Button
                type="primary"
                disabled={validItems.length === 0 || (hasErrors && !skipInvalidGroups)}
                loading={loading}
                onClick={() => void commit()}
              >
                Xác nhận nhập ({validItems.length} mặt hàng)
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {!loading && !error && stage === 3 && result ? (
        <Result
          status={result.failedProducts ? 'warning' : 'success'}
          title="Nhập danh sách hoàn tất"
          subTitle={`Tạo mới: ${result.createdProducts} · Cập nhật: ${result.updatedProducts} · Bỏ qua: ${result.skippedProducts} · Lỗi: ${result.failedProducts}`}
          extra={[
            <Button key="report" icon={<DownloadOutlined />} onClick={report}>
              Tải báo cáo
            </Button>,
            <Button key="close" type="primary" onClick={close}>
              Đóng
            </Button>,
          ]}
        />
      ) : null}
    </Modal>
  );
}
