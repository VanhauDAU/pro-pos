import { DownloadOutlined } from '@ant-design/icons';
import { Button, Checkbox, Divider, Modal, Result, Spin, Steps, Table, Typography } from 'antd';
import { useRef, useState } from 'react';

import type {
  CatalogImportCommitResult,
  CatalogImportPreviewResult,
  CatalogImportRow,
} from '@contracts/catalog';
import type { AuthContextResponse } from '@contracts/auth';
import { apiRequest, jsonRequest } from '@client/lib/api';

import {
  downloadCatalogImportReport,
  downloadCatalogWorkbook,
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
  await downloadCatalogWorkbook([], 'pro-pos-mau-nhap-mat-hang.xlsx', true);
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
  const commitIdRef = useRef<string | null>(null);

  const reset = () => {
    setStage(0);
    setRows([]);
    setFileName('');
    setPreview(null);
    setResult(null);
    setError(null);
    setSkipInvalidGroups(false);
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

  const hasErrors = (preview?.summary.errorRows ?? 0) > 0;
  return (
    <Modal
      open={open}
      title="Nhập danh sách mặt hàng"
      width={900}
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
          <Typography.Paragraph>
            Tạo mới: {preview.summary.createProducts} · Cập nhật: {preview.summary.updateProducts} ·
            Bỏ qua: {preview.summary.skippedProducts} · Lỗi: {preview.summary.errorRows}
          </Typography.Paragraph>
          {preview.issues.length ? (
            <Table
              size="small"
              pagination={{ pageSize: 8 }}
              rowKey={(row) => `${row.sourceRow}-${row.errorCode}-${row.field}`}
              dataSource={preview.issues}
              columns={[
                { title: 'Dòng', dataIndex: 'sourceRow' },
                { title: 'Trạng thái', dataIndex: 'action' },
                { title: 'Lỗi', dataIndex: 'message' },
                { title: 'Gợi ý', dataIndex: 'suggestion' },
              ]}
            />
          ) : (
            <Result status="success" title="Dữ liệu hợp lệ" />
          )}
          {hasErrors ? (
            <Checkbox
              checked={skipInvalidGroups}
              onChange={(event) => setSkipInvalidGroups(event.target.checked)}
            >
              Bỏ qua nhóm lỗi và nhập dữ liệu hợp lệ
            </Checkbox>
          ) : null}
          <Divider />
          {preview.issues.length ? (
            <Button icon={<DownloadOutlined />} onClick={report}>
              Tải file cần sửa
            </Button>
          ) : null}{' '}
          <Button onClick={() => setStage(1)}>Quay lại</Button>{' '}
          <Button
            type="primary"
            disabled={hasErrors && !skipInvalidGroups}
            onClick={() => void commit()}
          >
            Xác nhận nhập
          </Button>
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
