import {
  ClearOutlined,
  CloudDownloadOutlined,
  LinkOutlined,
  SnippetsOutlined,
} from '@ant-design/icons';
import { Alert, Button, Input, message, Modal, Space, Typography } from 'antd';
import { useState } from 'react';

import type { AuthContextResponse } from '@contracts/auth';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

export interface ImageUrlModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (dataUrl: string) => void;
  title?: string;
  csrfToken?: string | null | undefined;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function ImageUrlModal({
  open,
  onClose,
  onSuccess,
  title = 'Tải ảnh từ liên kết URL',
  csrfToken,
}: ImageUrlModalProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handlePasteClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        message.warning('Trình duyệt không hỗ trợ truy cập bộ nhớ tạm trực tiếp.');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setUrl(text.trim());
        setFetchError(null);
      } else {
        message.info('Bộ nhớ tạm đang trống.');
      }
    } catch {
      message.error('Không thể đọc từ bộ nhớ tạm. Bạn hãy dùng phím tắt Ctrl+V / Cmd+V.');
    }
  };

  const handleFetch = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setFetchError('Vui lòng nhập hoặc dán đường dẫn ảnh (URL).');
      return;
    }

    // Direct Data URL handling
    if (trimmed.startsWith('data:image/')) {
      onSuccess(trimmed);
      setUrl('');
      setFetchError(null);
      onClose();
      return;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setFetchError('Đường dẫn ảnh phải bắt đầu bằng http:// hoặc https://');
      return;
    }

    setLoading(true);
    setFetchError(null);

    try {
      let activeCsrf = csrfToken;
      if (!activeCsrf) {
        const auth = await apiRequest<AuthContextResponse>('/api/v1/auth/context');
        activeCsrf = auth.csrfToken ?? '';
      }

      const response = await jsonRequest<{ dataUrl: string }>(
        '/api/v1/media/fetch-url',
        { url: trimmed },
        {
          headers: {
            'X-CSRF-Token': activeCsrf ?? '',
          },
        },
      );

      if (!response.dataUrl) {
        throw new Error('Dữ liệu ảnh trả về không hợp lệ.');
      }

      onSuccess(response.dataUrl);
      setUrl('');
      setFetchError(null);
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Không thể tải ảnh từ liên kết URL đã nhập.');
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleModalClose = () => {
    if (!loading) {
      setUrl('');
      setFetchError(null);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0975f7' }}>
          <LinkOutlined style={{ fontSize: 18 }} />
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{title}</span>
        </div>
      }
      onCancel={handleModalClose}
      footer={null}
      destroyOnHidden
      centered
      width={520}
      closable={!loading}
      maskClosable={!loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Dán đường dẫn ảnh từ bất kỳ trang web nào. Ảnh sẽ được tự động nạp vào công cụ căn chỉnh &
          xóa phông trước khi lưu.
        </Typography.Text>

        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <label
              htmlFor="image-url-input"
              style={{ fontWeight: 600, fontSize: 13, color: '#334155' }}
            >
              Đường dẫn URL ảnh <span style={{ color: '#ff4d4f' }}>(*)</span>
            </label>
            <Space size={6}>
              <Button
                size="small"
                icon={<SnippetsOutlined />}
                onClick={() => void handlePasteClipboard()}
                disabled={loading}
              >
                Dán từ bộ nhớ tạm
              </Button>
              {url && (
                <Button
                  size="small"
                  icon={<ClearOutlined />}
                  onClick={() => {
                    setUrl('');
                    setFetchError(null);
                  }}
                  disabled={loading}
                >
                  Xóa
                </Button>
              )}
            </Space>
          </div>
          <Input.TextArea
            id="image-url-input"
            rows={3}
            placeholder="https://example.com/images/san-pham.jpg"
            value={url}
            disabled={loading}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fetchError) setFetchError(null);
            }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void handleFetch();
              }
            }}
            autoFocus
          />
        </div>

        {fetchError && <Alert type="error" showIcon message={fetchError} />}

        <Alert
          type="info"
          showIcon
          description="Hỗ trợ ảnh định dạng PNG, JPG, WEBP, GIF, AVIF (dung lượng tối đa 10 MB). Nhấn Enter để tải nhanh."
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 4,
            paddingTop: 10,
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <Button onClick={handleModalClose} disabled={loading}>
            Hủy bỏ
          </Button>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={loading}
            disabled={!url.trim()}
            onClick={() => void handleFetch()}
          >
            {loading ? 'Đang tải ảnh...' : 'Tải & Căn chỉnh ảnh'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
