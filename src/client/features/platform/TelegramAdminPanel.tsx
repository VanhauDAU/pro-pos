import {
  CheckCircleOutlined,
  DisconnectOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Modal,
  Popconfirm,
  Row,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import { useState } from 'react';

import type {
  CreateTelegramLinkCodeResponse,
  TelegramAdminLinkStatusResponse,
} from '@contracts/platform';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';

interface TelegramAdminPanelProps {
  csrfToken?: string | null;
  active?: boolean;
}

function readableError(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function TelegramAdminPanel({ csrfToken, active = true }: TelegramAdminPanelProps) {
  const queryClient = useQueryClient();
  const [generatingCode, setGeneratingCode] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [pairingData, setPairingData] = useState<CreateTelegramLinkCodeResponse | null>(null);

  const statusQuery = useQuery({
    queryKey: ['platform-telegram-status'],
    queryFn: () => apiRequest<TelegramAdminLinkStatusResponse>('/api/v1/platform/telegram/status'),
    enabled: active,
  });

  const resolveCsrf = async (): Promise<string> => {
    if (csrfToken) return csrfToken;
    try {
      const auth = await apiRequest<{ csrfToken?: string }>('/api/v1/auth/context');
      return auth?.csrfToken ?? '';
    } catch {
      return '';
    }
  };

  const handleGenerateCode = async () => {
    try {
      setGeneratingCode(true);
      const token = await resolveCsrf();
      const data = await jsonRequest<CreateTelegramLinkCodeResponse>(
        '/api/v1/platform/telegram/link-code',
        {},
        {
          headers: token ? { 'X-CSRF-Token': token } : {},
        },
      );
      setPairingData(data);
      setPairingModalOpen(true);
    } catch (error) {
      message.error(readableError(error, 'Không thể tạo mã kết nối Telegram. Vui lòng thử lại.'));
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleUnlink = async () => {
    try {
      setUnlinking(true);
      const token = await resolveCsrf();
      await apiRequest('/api/v1/platform/telegram/link', {
        method: 'DELETE',
        headers: token ? { 'X-CSRF-Token': token } : {},
      });
      message.success('Đã ngắt kết nối Telegram bot thành công.');
      await queryClient.invalidateQueries({ queryKey: ['platform-telegram-status'] });
    } catch (error) {
      message.error(readableError(error, 'Không thể ngắt kết nối Telegram bot.'));
    } finally {
      setUnlinking(false);
    }
  };

  const data = statusQuery.data;
  const isLinked = data?.linked ?? false;
  const link = data?.link;
  const botUsername = data?.botUsername || 'Proposbida_bot';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card
        title={
          <Space>
            <SendOutlined style={{ color: '#0ea5e9' }} />
            <span>Tích Hợp Telegram Bot Quản Trị Viên (SUPER_ADMIN)</span>
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            loading={statusQuery.isFetching}
            onClick={() => statusQuery.refetch()}
          >
            Làm mới
          </Button>
        }
      >
        {statusQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip="Đang tải trạng thái Telegram bot..." />
          </div>
        ) : statusQuery.isError ? (
          <Alert
            type="error"
            message="Lỗi tải trạng thái kết nối Telegram"
            description={readableError(statusQuery.error, 'Vui lòng kiểm tra lại kết nối mạng.')}
            showIcon
          />
        ) : (
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={14}>
              <Descriptions
                title="Thông tin cấu hình Bot"
                bordered
                column={1}
                size="middle"
                style={{ background: '#fff' }}
              >
                <Descriptions.Item label="Bot Telegram">
                  <Space orientation="horizontal">
                    <Typography.Text strong>@{botUsername}</Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      icon={<LinkOutlined />}
                      href={`https://t.me/${botUsername}`}
                      target="_blank"
                    >
                      Mở trong Telegram
                    </Button>
                  </Space>
                </Descriptions.Item>

                <Descriptions.Item label="Trạng thái liên kết">
                  {isLinked ? (
                    <Badge
                      status="success"
                      text={
                        <Typography.Text strong style={{ color: '#16a34a' }}>
                          Đã kết nối
                        </Typography.Text>
                      }
                    />
                  ) : (
                    <Badge
                      status="default"
                      text={<Typography.Text type="secondary">Chưa kết nối</Typography.Text>}
                    />
                  )}
                </Descriptions.Item>

                {isLinked && link ? (
                  <>
                    <Descriptions.Item label="Tài khoản Telegram">
                      <Space>
                        <UserOutlined />
                        <span>
                          {link.telegramFirstName} {link.telegramLastName || ''}
                          {link.telegramUsername ? ` (@${link.telegramUsername})` : ''}
                        </span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Telegram User ID">
                      <Typography.Text code copyable>
                        {link.telegramUserId}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Thời gian kết nối">
                      {new Date(link.linkedAt).toLocaleString('vi-VN')}
                    </Descriptions.Item>
                  </>
                ) : null}
              </Descriptions>

              <div style={{ marginTop: 20 }}>
                {isLinked ? (
                  <Popconfirm
                    title="Ngắt kết nối Telegram Bot?"
                    description="Sau khi ngắt kết nối, bot sẽ từ chối truy cập và không cung cấp dữ liệu quản trị cho tài khoản Telegram này."
                    onConfirm={handleUnlink}
                    okText="Ngắt kết nối"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true, loading: unlinking }}
                  >
                    <Button danger icon={<DisconnectOutlined />} loading={unlinking}>
                      Ngắt kết nối Bot
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    type="primary"
                    icon={<QrcodeOutlined />}
                    loading={generatingCode}
                    onClick={handleGenerateCode}
                    style={{ background: '#0ea5e9', borderColor: '#0ea5e9' }}
                  >
                    Tạo mã kết nối Telegram
                  </Button>
                )}
              </div>
            </Col>

            <Col xs={24} lg={10}>
              <Card
                size="small"
                title="Tính năng Bot Quản trị (Phase 1)"
                style={{ background: '#f8fafc' }}
              >
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <div>
                    <Typography.Text strong>
                      <CheckCircleOutlined style={{ color: '#10b981', marginRight: 8 }} />
                      Chế độ READ-ONLY An Toàn
                    </Typography.Text>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: '4px 0 0 24px', fontSize: 13 }}
                    >
                      Không thực hiện các thao tác phá hủy dữ liệu, không xóa cửa hàng hay hóa đơn.
                    </Typography.Paragraph>
                  </div>

                  <div>
                    <Typography.Text strong>
                      <CheckCircleOutlined style={{ color: '#10b981', marginRight: 8 }} />
                      Giao diện Nút bấm Tương tác (Inline Keyboard)
                    </Typography.Text>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: '4px 0 0 24px', fontSize: 13 }}
                    >
                      Điều hướng mượt mà, cập nhật trực tiếp trên tin nhắn hiện tại, không gây spam
                      chat.
                    </Typography.Paragraph>
                  </div>

                  <div>
                    <Typography.Text strong>
                      <CheckCircleOutlined style={{ color: '#10b981', marginRight: 8 }} />
                      Giám sát Toàn Diện
                    </Typography.Text>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: '4px 0 0 24px', fontSize: 13 }}
                    >
                      Tình trạng hệ thống, dung lượng cơ sở dữ liệu, Top 10 bảng lớn nhất, danh sách
                      & chi tiết cửa hàng.
                    </Typography.Paragraph>
                  </div>
                </Space>
              </Card>
            </Col>
          </Row>
        )}
      </Card>

      {/* Pairing Modal */}
      <Modal
        title={
          <Space>
            <SendOutlined style={{ color: '#0ea5e9' }} />
            <span>Kết Nối Telegram Bot Cho SUPER_ADMIN</span>
          </Space>
        }
        open={pairingModalOpen}
        onCancel={() => {
          setPairingModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ['platform-telegram-status'] });
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setPairingModalOpen(false);
              queryClient.invalidateQueries({ queryKey: ['platform-telegram-status'] });
            }}
          >
            Đóng
          </Button>,
          <Button
            key="open"
            type="primary"
            icon={<SendOutlined />}
            href={pairingData?.deepLink || '#'}
            target="_blank"
            style={{ background: '#0ea5e9', borderColor: '#0ea5e9' }}
          >
            Mở Telegram & Kết Nối Ngay
          </Button>,
        ]}
      >
        {pairingData ? (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message="Mã liên kết có hiệu lực trong 15 phút và chỉ sử dụng một lần."
            />

            <div
              style={{
                textAlign: 'center',
                padding: '20px 0',
                background: '#f1f5f9',
                borderRadius: 8,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                MÃ GHÉP ĐÔI CỦA BẠN
              </Typography.Text>
              <div style={{ margin: '10px 0' }}>
                <Typography.Title level={2} copyable style={{ letterSpacing: 4, margin: 0 }}>
                  {pairingData.code}
                </Typography.Title>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Bấm vào biểu tượng sao chép để copy mã
              </Typography.Text>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <Typography.Text strong>Cách 1: Mở liên kết tự động</Typography.Text>
              <p style={{ margin: '4px 0 12px 0', color: '#64748b' }}>
                Bấm nút &quot;Mở Telegram &amp; Kết Nối Ngay&quot; bên dưới để tự động mở ứng dụng
                Telegram và ghép đôi.
              </p>

              <Typography.Text strong>Cách 2: Gửi lệnh thủ công</Typography.Text>
              <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>
                Mở bot <Typography.Text strong>@{pairingData.botUsername}</Typography.Text> trên
                Telegram và gửi tin nhắn:
              </p>
              <div style={{ marginTop: 6 }}>
                <Typography.Text code copyable>
                  /start {pairingData.code}
                </Typography.Text>
              </div>
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
