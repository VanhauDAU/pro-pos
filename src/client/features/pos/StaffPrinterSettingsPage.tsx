import {
  CheckCircleOutlined,
  DesktopOutlined,
  LeftOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SaveOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  type PrinterDeviceConfig,
  type StorePrintSettings,
  defaultPrinterDeviceConfig,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
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

export function StaffPrinterSettingsPage({
  csrfToken,
  storeName,
  onBack,
}: StaffPrinterSettingsPageProps) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PrinterDeviceConfig>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [browserTesting, setBrowserTesting] = useState(false);
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingDeviceName, setPairingDeviceName] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);

  const paperSize = Form.useWatch('paperSize', form) ?? 'K80';

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

  useEffect(() => {
    if (!settings.data) return;
    const config = parsePrinterDeviceConfig(settings.data.printersJson);
    form.setFieldsValue({
      ...config,
      connectionType: 'NETWORK_TCP',
      paperSize: settings.data.paperSize ?? config.paperSize,
    });
  }, [form, settings.data]);

  const handleSaveSettings = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        printersJson: JSON.stringify({
          ...values,
          connectionType: 'NETWORK_TCP',
        }),
        paperSize: values.paperSize,
      };

      await jsonRequest(
        '/api/v1/pos/print-settings',
        payload,
        csrfToken ? { headers: { 'X-CSRF-Token': csrfToken } } : {},
      );

      toast.success('Đã lưu cấu hình máy in thành công');
      await queryClient.invalidateQueries({ queryKey: ['pos-print-settings'] });
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lưu cấu hình máy in thất bại'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrintAgent = async () => {
    try {
      setTesting(true);
      const res = await dispatchRemotePrintJob({
        documentType: 'invoice',
        documentId: 'TEST-PRINT-JOB',
        csrfToken: csrfToken ?? null,
      });
      if (res.success) {
        toast.success('Đã gửi lệnh in thử tới Print Agent!');
      } else {
        toast.error(res.message || 'Gửi lệnh in thử thất bại.');
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
        storeInfo: { storeName: storeName },
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
  const hasOnlineAgent = agents.length > 0;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px' }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space align="center" size="middle">
              <Button icon={<LeftOutlined />} onClick={onBack}>
                Quay lại
              </Button>
              <div>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  Máy In & Print Agent
                </Typography.Title>
                <Typography.Text type="secondary">{storeName}</Typography.Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => agentsQuery.refetch()}
                loading={agentsQuery.isFetching}
              >
                Làm mới
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveSettings}
                loading={saving}
              >
                Lưu cấu hình
              </Button>
            </Space>
          </Col>
        </Row>

        {/* 1. Print Agent Status Banner */}
        <Card
          title={
            <Space>
              <DesktopOutlined />
              <span>Pro POS Print Agent (In ngầm tự động)</span>
            </Space>
          }
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setPairModalOpen(true)}>
              Thêm Print Agent
            </Button>
          }
        >
          {hasOnlineAgent ? (
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              message="Print Agent đang hoạt động"
              description="Mọi yêu cầu in từ Điện thoại / iPad / Web POS sẽ được Print Agent tự động gửi thẳng tới máy in LAN mà không cần bấm xác nhận."
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              message="Chưa có Print Agent nào được ghép nối"
              description="Vui lòng mở ứng dụng Pro POS Print Agent trên máy tính quầy, sau đó bấm 'Thêm Print Agent' và nhập mã 6 số để tự động in hóa đơn."
            />
          )}

          <Divider style={{ margin: '16px 0' }} />

          <Typography.Title level={5}>Danh sách Print Agent đã ghép nối</Typography.Title>
          <Table
            dataSource={agents}
            rowKey="id"
            pagination={false}
            locale={{ emptyText: 'Chưa có Print Agent nào' }}
            columns={[
              {
                title: 'Tên thiết bị',
                dataIndex: 'device_name',
                key: 'device_name',
                render: (val: string) => (
                  <Space>
                    <DesktopOutlined />
                    <Typography.Text strong>{val}</Typography.Text>
                  </Space>
                ),
              },
              {
                title: 'Trạng thái',
                key: 'status',
                render: () => <Tag color="green">Sẵn sàng</Tag>,
              },
              {
                title: 'Vai trò',
                dataIndex: 'printer_role',
                key: 'printer_role',
                render: (val: string) => <Tag color="blue">{val || 'receipt'}</Tag>,
              },
              {
                title: 'Thao tác',
                key: 'action',
                render: (_: unknown, record: PrintAgentInfo) => (
                  <Popconfirm
                    title="Xóa Print Agent này?"
                    description="Thiết bị này sẽ không thể nhận lệnh in từ xa nữa."
                    onConfirm={() => handleRemoveAgent(record.id)}
                    okText="Xóa"
                    cancelText="Hủy"
                  >
                    <Button danger type="link" size="small">
                      Xóa
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Card>

        {/* 2. LAN Printer Configuration Form */}
        <Card
          title={
            <Space>
              <PrinterOutlined />
              <span>Cấu hình máy in nhiệt LAN (Cổng TCP 9100)</span>
            </Space>
          }
        >
          <Form form={form} layout="vertical" initialValues={defaultPrinterDeviceConfig}>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Form.Item
                  label="Địa chỉ IP Máy in LAN (Ethernet / Wi-Fi)"
                  name="networkIp"
                  rules={[{ required: true, message: 'Vui lòng nhập địa chỉ IP của máy in' }]}
                  tooltip="Địa chỉ IP của máy in nhiệt trong mạng nội bộ, ví dụ 192.168.1.73"
                >
                  <Input placeholder="192.168.1.73" prefix={<WifiOutlined />} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  label="Cổng kết nối (Port)"
                  name="networkPort"
                  rules={[{ required: true, message: 'Vui lòng nhập cổng' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item label="Khổ giấy in nhiệt" name="paperSize">
                  <Radio.Group buttonStyle="solid">
                    <Radio.Button value="K80">K80 (80mm - Phổ biến)</Radio.Button>
                    <Radio.Button value="K58">K58 (58mm - Nhỏ gọn)</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Vùng in (Printable Dots)"
                  name="printableDots"
                  tooltip="Mặc định 576 dots cho K80, 384 dots cho K58"
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={200}
                    max={1200}
                    placeholder={paperSize === 'K58' ? '384' : '576'}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: '12px 0' }} />

            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Tự động cắt giấy khi in xong"
                  name="autoCut"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Tự động bật két tiền khi thanh toán tiền mặt"
                  name="openCashDrawer"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
            </Row>

            <Space size="middle" style={{ marginTop: 8 }}>
              <Button
                type="primary"
                icon={<PrinterOutlined />}
                onClick={handleTestPrintAgent}
                loading={testing}
              >
                In thử qua Print Agent
              </Button>
            </Space>
          </Form>
        </Card>

        {/* 3. Browser Print Fallback */}
        <Card title="Phương thức dự phòng">
          <Typography.Paragraph type="secondary">
            Nếu Print Agent ngoại tuyến hoặc máy in gặp sự cố, bạn có thể in thủ công bằng hộp thoại
            in của trình duyệt:
          </Typography.Paragraph>
          <Button
            icon={<PrinterOutlined />}
            onClick={handleBrowserFallbackPrint}
            loading={browserTesting}
          >
            In bằng hộp thoại trình duyệt
          </Button>
        </Card>
      </Space>

      {/* Modal: Ghép nối Print Agent */}
      <Modal
        title="Ghép nối Pro POS Print Agent"
        open={pairModalOpen}
        onCancel={() => setPairModalOpen(false)}
        onOk={handleConfirmPairing}
        confirmLoading={pairingLoading}
        okText="Xác nhận ghép nối"
        cancelText="Hủy"
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%', marginTop: 8 }}>
          <Alert
            type="info"
            message="Cách lấy mã ghép nối:"
            description="Mở ứng dụng Print Agent trên máy tính quầy (Terminal / Daemon). Ứng dụng sẽ hiển thị mã gồm 6 chữ số."
          />

          <div>
            <Typography.Text strong>Mã ghép nối (6 chữ số):</Typography.Text>
            <Input
              size="large"
              placeholder="VD: 748291 hoặc 748-291"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              style={{ textAlign: 'center', fontSize: 22, letterSpacing: 4, marginTop: 4 }}
              maxLength={10}
            />
          </div>

          <div>
            <Typography.Text strong>Tên gợi nhớ thiết bị (tùy chọn):</Typography.Text>
            <Input
              placeholder="VD: Mac quầy thu ngân"
              value={pairingDeviceName}
              onChange={(e) => setPairingDeviceName(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
