import {
  EllipsisOutlined,
  LeftOutlined,
  PlusOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Row,
  Space,
  Typography,
} from 'antd';
import { useState } from 'react';
import { toast } from 'sonner';

import type { StorePrintSettings } from '@contracts/store';
import { ApiError, apiRequest } from '@client/lib/api';
import {
  listPrintAgents,
  confirmPrintAgentPairing,
  removePrintAgent,
  type PrintAgentInfo,
} from '@client/lib/print-bridge-service';
import { browserPrintFallback, dispatchRemotePrintJob } from '@client/lib/pos-receipt-printer';

interface StaffPrinterSettingsPageProps {
  csrfToken: string | null | undefined;
  storeName: string;
  onBack: () => void;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function formatRelativeTime(timestampMs: number | null | undefined): string {
  if (!timestampMs) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} ngày trước`;
}

function formatAgentPrinterSummary(configJson?: string | null): string {
  if (!configJson) return 'Máy in nhiệt · ESC/POS · K80';
  try {
    const parsed = JSON.parse(configJson) as {
      connectionType?: string;
      printerName?: string;
      printerIp?: string;
      printerPort?: number;
      paperSize?: string;
    };
    const paper = parsed.paperSize || 'K80';
    if (parsed.connectionType === 'WINDOWS_PRINTER' || parsed.printerName) {
      return `${parsed.printerName || 'Máy in Windows'} · USB · Windows · ${paper}`;
    }
    if (parsed.printerIp) {
      return `${parsed.printerIp}:${parsed.printerPort || 9100} · LAN · ${paper}`;
    }
    return `ESC/POS · ${paper}`;
  } catch {
    return 'Máy in nhiệt · ESC/POS · K80';
  }
}

export function StaffPrinterSettingsPage({
  csrfToken,
  storeName,
  onBack,
}: StaffPrinterSettingsPageProps) {
  const [testing, setTesting] = useState(false);
  const [browserTesting, setBrowserTesting] = useState(false);
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingDeviceName, setPairingDeviceName] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);

  const settings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: 30_000,
    refetchOnMount: true,
  });

  const agentsQuery = useQuery({
    queryKey: ['pos-print-agents'],
    queryFn: () => listPrintAgents(),
    refetchInterval: 10_000,
  });

  const handleTestPrintAgent = async () => {
    try {
      setTesting(true);
      const res = await dispatchRemotePrintJob({
        documentType: 'invoice',
        documentId: 'TEST-PRINT-JOB',
        csrfToken: csrfToken ?? null,
      });
      if (res.success) {
        toast.success('Đã gửi lệnh in thử tới Print Agent');
      } else {
        toast.error(res.message || 'Gửi lệnh in thử thất bại');
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'In thử thất bại'));
    } finally {
      setTesting(false);
    }
  };

  const handleBrowserFallbackPrint = async () => {
    try {
      setBrowserTesting(true);
      const res = await browserPrintFallback({
        data: {
          receiptType: 'PAYMENT',
          orderCode: 'TEST-001',
          invoiceCode: 'TEST-BROWSER',
          orderType: 'DINE_IN',
          total: 50000,
          subtotal: 50000,
          discountTotal: 0,
          issuedAtMs: Date.now(),
          tableName: 'Bàn Test In',
          cashierName: 'Thu ngân Test',
          lines: [
            {
              id: '1',
              name: 'In thử trình duyệt (Dự phòng)',
              quantity: 1,
              unitPrice: 50000,
              totalPrice: 50000,
            },
          ],
        },
        printSettings: settings.data,
        storeInfo: { storeName },
      });
      if (res.success) {
        toast.success('Đã mở hộp thoại in trình duyệt');
      } else {
        toast.error(res.message || 'Không thể mở hộp thoại in');
      }
    } finally {
      setBrowserTesting(false);
    }
  };

  const handleConfirmPairing = async () => {
    if (!pairingCode || pairingCode.trim().length < 6) {
      toast.error('Vui lòng nhập đầy đủ mã ghép nối 6 chữ số');
      return;
    }

    try {
      setPairingLoading(true);
      const res = await confirmPrintAgentPairing(
        pairingCode,
        pairingDeviceName.trim() || undefined,
        csrfToken,
      );
      toast.success(`Đã ghép nối thành công Print Agent: ${res.deviceName}`);
      setPairModalOpen(false);
      setPairingCode('');
      setPairingDeviceName('');
      await agentsQuery.refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Mã ghép nối không hợp lệ hoặc đã hết hạn'));
    } finally {
      setPairingLoading(false);
    }
  };

  const handleRemoveAgent = async (agentId: string) => {
    try {
      await removePrintAgent(agentId, csrfToken);
      toast.success('Đã xóa Print Agent');
      await agentsQuery.refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Xóa Print Agent thất bại'));
    }
  };

  const agents = agentsQuery.data || [];
  const hasOnlineAgent = agents.some((a) => a.is_online);

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '20px 16px' }}>
      <Space orientation="vertical" size={24} style={{ width: '100%' }}>
        {/* Header */}
        <Row justify="space-between" align="middle">
          <Col>
            <Space align="center" size={12}>
              <Button icon={<LeftOutlined />} onClick={onBack}>
                Quay lại
              </Button>
              <div>
                <Typography.Title level={4} style={{ margin: 0, fontWeight: 600 }}>
                  Máy in & Print Agent
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {storeName}
                </Typography.Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void agentsQuery.refetch();
                void settings.refetch();
              }}
              loading={agentsQuery.isFetching || settings.isFetching}
            >
              Làm mới
            </Button>
          </Col>
        </Row>

        {/* SECTION A: Print Agent */}
        <Card
          style={{
            borderRadius: 10,
            borderColor: '#e5e7eb',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
          bodyStyle={{ padding: 20 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 16,
            }}
          >
            <div>
              <Typography.Title level={5} style={{ margin: 0, fontWeight: 600 }}>
                Print Agent
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                Tự động nhận lệnh in từ Điện thoại, iPad và Web POS.
              </Typography.Text>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                {hasOnlineAgent ? (
                  <span style={{ color: '#16a34a', fontWeight: 500 }}>
                    ● Hệ thống in đang hoạt động
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af', fontWeight: 500 }}>
                    ○ Chưa có Print Agent đang hoạt động
                  </span>
                )}
              </div>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setPairModalOpen(true)}
              style={{ borderRadius: 8 }}
            >
              Thêm Print Agent
            </Button>
          </div>

          <Divider style={{ margin: '14px 0' }} />

          {agents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {agents.map((agent: PrintAgentInfo) => (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderRadius: 8,
                    background: '#f9fafb',
                    border: '1px solid #f0f2f5',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#1f2937' }}>
                      {agent.device_name}
                    </div>
                    <div style={{ marginTop: 3, fontSize: 13 }}>
                      {agent.is_online ? (
                        <span style={{ color: '#16a34a', fontWeight: 500 }}>● Online</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>
                          ○ Offline
                          {agent.last_seen_at
                            ? ` · Hoạt động ${formatRelativeTime(agent.last_seen_at)}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12.5, color: '#6b7280' }}>
                      Máy in: {formatAgentPrinterSummary(agent.printer_config_json)}
                    </div>
                  </div>

                  <Space size="small">
                    <Button
                      size="middle"
                      onClick={handleTestPrintAgent}
                      loading={testing}
                      icon={<PrinterOutlined />}
                    >
                      In thử
                    </Button>
                    <Dropdown
                      menu={{
                        items: [
                          {
                            key: 'delete',
                            danger: true,
                            label: (
                              <Popconfirm
                                title="Xóa Print Agent này?"
                                description="Thiết bị này sẽ không thể nhận lệnh in từ xa nữa."
                                onConfirm={() => handleRemoveAgent(agent.id)}
                                okText="Xóa"
                                cancelText="Hủy"
                              >
                                <span>Xóa Print Agent</span>
                              </Popconfirm>
                            ),
                          },
                        ],
                      }}
                      trigger={['click']}
                    >
                      <Button size="middle" icon={<EllipsisOutlined />} />
                    </Dropdown>
                  </Space>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '28px 16px',
                background: '#f9fafb',
                borderRadius: 8,
                border: '1px dashed #e5e7eb',
              }}
            >
              <Typography.Text strong style={{ display: 'block', fontSize: 14, color: '#374151' }}>
                Chưa có Print Agent nào được kết nối.
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{
                  display: 'block',
                  fontSize: 13,
                  marginTop: 4,
                  marginBottom: 16,
                  maxWidth: 420,
                  marginRight: 'auto',
                  marginLeft: 'auto',
                  lineHeight: 1.5,
                }}
              >
                Để in tự động từ Điện thoại, iPad hoặc Web POS, hãy cài PRO POS Print Agent trên máy
                tính tại quầy.
              </Typography.Text>
              <Space size="middle">
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setPairModalOpen(true)}
                  style={{ borderRadius: 6 }}
                >
                  + Kết nối Print Agent
                </Button>
                <Button
                  type="link"
                  icon={<QuestionCircleOutlined />}
                  onClick={() => setGuideModalOpen(true)}
                  style={{ padding: 0 }}
                >
                  Hướng dẫn cài đặt
                </Button>
              </Space>
            </div>
          )}
        </Card>

        {/* SECTION B: In dự phòng */}
        <Card
          title={<span style={{ fontWeight: 600, fontSize: 15 }}>In dự phòng</span>}
          style={{
            borderRadius: 10,
            borderColor: '#e5e7eb',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
          }}
          bodyStyle={{ padding: 20 }}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14 }}>
            Nếu Print Agent hoặc máy in không khả dụng, bạn có thể sử dụng hộp thoại in của trình
            duyệt.
          </Typography.Paragraph>
          <Button
            icon={<PrinterOutlined />}
            onClick={handleBrowserFallbackPrint}
            loading={browserTesting}
            style={{ borderRadius: 8 }}
          >
            In bằng trình duyệt
          </Button>
        </Card>
      </Space>

      {/* Modal: Ghép nối Print Agent */}
      <Modal
        title="Thêm Print Agent"
        open={pairModalOpen}
        onCancel={() => {
          setPairModalOpen(false);
          setPairingCode('');
          setPairingDeviceName('');
        }}
        onOk={handleConfirmPairing}
        confirmLoading={pairingLoading}
        okText="Xác nhận ghép nối"
        cancelText="Hủy"
        centered
        width={460}
      >
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '12px 14px',
              background: '#f9fafb',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              marginBottom: 16,
              fontSize: 13,
              lineHeight: 1.5,
              color: '#374151',
            }}
          >
            <div>
              <strong>1.</strong> Mở ứng dụng PRO POS Print Agent trên máy tính quầy.
            </div>
            <div style={{ marginTop: 4 }}>
              <strong>2.</strong> Nhập mã 6 chữ số đang hiển thị trên màn hình Print Agent vào bên
              dưới:
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              Mã ghép nối (6 chữ số):
            </Typography.Text>
            <Input
              size="large"
              placeholder="VD: 842 165"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              style={{
                textAlign: 'center',
                fontSize: 24,
                letterSpacing: 4,
                marginTop: 6,
                fontWeight: 600,
                borderRadius: 8,
              }}
              maxLength={10}
            />
          </div>

          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              Tên gợi nhớ thiết bị (tùy chọn):
            </Typography.Text>
            <Input
              placeholder="VD: Máy quầy thu ngân"
              value={pairingDeviceName}
              onChange={(e) => setPairingDeviceName(e.target.value)}
              style={{ marginTop: 6, borderRadius: 8 }}
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Hướng dẫn cài đặt */}
      <Modal
        title="Hướng dẫn kết nối Print Agent"
        open={guideModalOpen}
        onCancel={() => setGuideModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setGuideModalOpen(false)}>
            Đã hiểu
          </Button>,
        ]}
        centered
        width={500}
      >
        <div style={{ padding: '8px 0', fontSize: 13.5, lineHeight: 1.6, color: '#374151' }}>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li style={{ marginBottom: 8 }}>
              Tải và mở ứng dụng <strong>PRO POS Print Agent</strong> trên máy tính kết nối máy in
              (Windows / macOS).
            </li>
            <li style={{ marginBottom: 8 }}>
              Trong ứng dụng Print Agent, chọn kiểu kết nối máy in (<strong>Mạng LAN</strong> hoặc{' '}
              <strong>Máy in trên Windows</strong>), sau đó nhấn <strong>Kiểm tra & In thử</strong>.
            </li>
            <li style={{ marginBottom: 8 }}>
              Khi máy in in thử thành công, nhấn <strong>Tiếp tục kết nối PRO POS</strong> để lấy{' '}
              <strong>Mã ghép nối 6 số</strong>.
            </li>
            <li>
              Quay lại màn hình này, bấm nút <strong>+ Thêm Print Agent</strong> và nhập mã 6 số để
              hoàn tất.
            </li>
          </ol>
        </div>
      </Modal>
    </div>
  );
}
