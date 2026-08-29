import {
  CheckCircleOutlined,
  LeftOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
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
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Space,
  Spin,
  Switch,
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
  isDesktopPlatform,
  isPrintBridgeEnabled,
  isPrintBridgeLeader,
  setPrintBridgeEnabled,
  startPrintBridgeLeaderElection,
  subscribePrintBridgeLeader,
} from '@client/lib/print-bridge-service';
import { getClientDeviceName } from '@client/lib/qz-tray-service';
import { printerAction, printerService } from '@printing/printer-service';
import { QzTrustedSetupModal } from '@client/components/QzTrustedSetupModal';

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
  const messageApi = toast;
  const holder = null;
  const [form] = Form.useForm<PrinterDeviceConfig>();
  const [qzStatus, setQzStatus] = useState<{
    connected: boolean;
    loading: boolean;
    version?: string;
    error?: string;
  }>({ connected: false, loading: false });
  const [systemPrinters, setSystemPrinters] = useState<string[]>([]);
  const [selectedDiscoveredPrinter, setSelectedDiscoveredPrinter] = useState<string>();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [bridgeEnabled, setBridgeEnabled] = useState(isPrintBridgeEnabled());
  const [isLeader, setIsLeader] = useState(isPrintBridgeLeader());
  const [trustedModalOpen, setTrustedModalOpen] = useState(false);

  useEffect(() => {
    void startPrintBridgeLeaderElection();
    return subscribePrintBridgeLeader(setIsLeader);
  }, []);

  const connectionType = Form.useWatch('connectionType', form) ?? 'SYSTEM';
  const paperSize = Form.useWatch('paperSize', form) ?? 'K80';

  const settings = useQuery({
    queryKey: ['pos-print-settings'],
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/pos/print-settings'),
    staleTime: 30_000,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!settings.data) return;
    const config = parsePrinterDeviceConfig(settings.data.printersJson);
    form.setFieldsValue({
      ...config,
      paperSize: settings.data.paperSize ?? config.paperSize,
    });
  }, [form, settings.data]);

  useEffect(() => {
    let mounted = true;
    void printerService.checkConnection(isDesktopPlatform()).then(async (status) => {
      if (!mounted) return;
      if (!status.connected) {
        setQzStatus({
          connected: false,
          loading: false,
          ...(status.error ? { error: status.error } : {}),
        });
        return;
      }
      setQzStatus({
        connected: true,
        loading: false,
        ...(status.version ? { version: status.version } : {}),
      });
      try {
        const printers = await printerService.listPrinters();
        if (mounted) setSystemPrinters(printers);
      } catch {
        // The user can retry from the discovery dialog.
      }
    });
    if (window.matchMedia('(max-width: 768px)').matches) setDiscoveryOpen(true);
    return () => {
      mounted = false;
    };
  }, []);

  const discoverPrinters = async () => {
    setDiscovering(true);
    try {
      let connected = qzStatus.connected;
      if (!connected) {
        const result = await printerService.checkConnection(true);
        connected = result.connected;
        setQzStatus({
          connected: result.connected,
          loading: false,
          ...(result.version ? { version: result.version } : {}),
          ...(!result.connected && result.error ? { error: result.error } : {}),
        });
      }
      if (!connected) {
        setSystemPrinters([]);
        return;
      }
      const printers = await printerService.listPrinters(true);
      setSystemPrinters(printers);
      setSelectedDiscoveredPrinter((current) => current ?? printers[0]);
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể dò tìm máy in.'));
    } finally {
      setDiscovering(false);
    }
  };

  const connectQz = async () => {
    setQzStatus((current) => ({ ...current, loading: true }));
    const result = qzStatus.connected
      ? await printerService.reconnect()
      : await printerService.checkConnection(true);
    setQzStatus({
      connected: result.connected,
      loading: false,
      ...(result.version ? { version: result.version } : {}),
      ...(!result.connected && result.error ? { error: result.error } : {}),
    });
    if (result.connected) {
      messageApi.success('Đã kết nối QZ Tray.');
      try {
        setDiscovering(true);
        const printers = await printerService.listPrinters();
        setSystemPrinters(printers);
        setSelectedDiscoveredPrinter((current) => current ?? printers[0]);
      } catch (error) {
        messageApi.error(errorMessage(error, 'Không thể lấy danh sách máy in từ QZ Tray.'));
      } finally {
        setDiscovering(false);
      }
    } else {
      messageApi.warning(result.error ?? 'Không tìm thấy QZ Tray trên thiết bị này.');
    }
  };

  const printerOptions = () => {
    const values = form.getFieldsValue();
    return {
      connectionType: values.connectionType ?? 'SYSTEM',
      printerName: values.printerName,
      networkIp: values.networkIp,
      networkPort: values.networkPort,
      paperSize: values.paperSize ?? 'K80',
      printableDots: values.printableDots,
      autoCut: Boolean(values.autoCut),
      openCashDrawer: Boolean(values.openCashDrawer),
      storeName,
    };
  };

  const testPrint = async (calibration = false) => {
    try {
      await form.validateFields();
      setTesting(true);
      const result = calibration
        ? await printerAction(() =>
            printerService.calibrationPrint({ ...printerOptions(), openCashDrawer: false }),
          )
        : await printerAction(() => printerService.testPrint(printerOptions(), storeName));
      if (result.success) {
        const status = await printerService.checkConnection();
        setQzStatus({
          connected: status.connected,
          loading: false,
          ...(status.version ? { version: status.version } : {}),
          ...(!status.connected && status.error ? { error: status.error } : {}),
        });
        messageApi.success(calibration ? 'Đã gửi bản in hiệu chuẩn.' : 'Đã gửi lệnh in thử.');
      } else {
        messageApi.error(result.message ?? 'Không thể in thử.');
      }
    } finally {
      setTesting(false);
    }
  };

  const checkNetworkConnection = async () => {
    try {
      await form.validateFields(['networkIp', 'networkPort']);
      setCheckingConnection(true);
      const result = await printerAction(() =>
        printerService.testPrint(
          {
            ...printerOptions(),
            connectionType: 'NETWORK_TCP',
            autoCut: false,
            openCashDrawer: false,
          },
          storeName,
        ),
      );
      if (result.success) {
        const status = await printerService.checkConnection();
        setQzStatus({
          connected: status.connected,
          loading: false,
          ...(status.version ? { version: status.version } : {}),
          ...(!status.connected && status.error ? { error: status.error } : {}),
        });
        messageApi.success('Máy in mạng đã phản hồi lệnh in thử.');
      } else messageApi.error(result.message ?? 'Không thể kết nối tới máy in mạng.');
    } finally {
      setCheckingConnection(false);
    }
  };

  const save = async (values: PrinterDeviceConfig) => {
    setSaving(true);
    try {
      await jsonRequest('/api/v1/pos/printer-settings', values, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: ['pos-print-settings'] });
      messageApi.success('Đã lưu cấu hình máy in.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể lưu cấu hình máy in.'));
    } finally {
      setSaving(false);
    }
  };

  if (settings.isLoading) return <Spin fullscreen description="Đang tải cấu hình máy in" />;

  return (
    <div className="staff-printer-settings-page">
      {holder}
      <div className="staff-printer-settings-header">
        <Button type="text" icon={<LeftOutlined />} onClick={onBack} aria-label="Quay lại" />
        <div>
          <Typography.Title level={3}>Máy in</Typography.Title>
          <Typography.Text type="secondary">Thiết lập máy in cho thiết bị POS này</Typography.Text>
        </div>
      </div>

      <Card className="staff-printer-device-card" bordered={false}>
        <div className="staff-printer-device-summary">
          <div>
            <Typography.Text type="secondary">Thiết bị hiện tại</Typography.Text>
            <Typography.Title level={5}>{getClientDeviceName()}</Typography.Title>
          </div>
          <div className="qz-tray-status-box">
            <div className="staff-printer-qz-heading">
              <strong>QZ Tray</strong>
              <span
                className={`qz-badge qz-badge--${qzStatus.connected ? 'connected' : 'disconnected'}`}
              >
                {qzStatus.connected
                  ? '● Đã kết nối'
                  : qzStatus.error
                    ? '○ QZ Tray chưa chạy'
                    : '○ Chưa kết nối'}
              </span>
            </div>
            <Typography.Text type="secondary">
              {qzStatus.connected
                ? `Phiên bản ${qzStatus.version ?? '2.2.x'}`
                : qzStatus.error || 'Cần QZ Tray để in trực tiếp tới máy in hệ thống hoặc IP.'}
            </Typography.Text>
            <Space wrap>
              <Button onClick={() => void connectQz()} loading={qzStatus.loading}>
                {qzStatus.connected ? 'Kết nối lại' : 'Kết nối QZ Tray'}
              </Button>
              <Button
                icon={<SafetyCertificateOutlined />}
                onClick={() => setTrustedModalOpen(true)}
              >
                Bỏ qua hộp thoại Allow
              </Button>
              {!qzStatus.connected ? (
                <Button href="https://qz.io/download/" target="_blank" rel="noreferrer">
                  Tải QZ Tray
                </Button>
              ) : null}
            </Space>
          </div>
        </div>
      </Card>

      <Card className="staff-printer-device-card" bordered={false}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                Cầu nối in từ xa (Print Bridge)
              </Typography.Title>
              <span
                className={`qz-badge qz-badge--${bridgeEnabled && isLeader ? 'connected' : 'disconnected'}`}
              >
                {!bridgeEnabled
                  ? '○ Đã tắt'
                  : isLeader
                    ? '● Đang nhận lệnh in (Leader)'
                    : '○ Tab dự phòng (Standby)'}
              </span>
            </div>
            <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              Cho phép điện thoại, iPad và các thiết bị khác trong cửa hàng gửi yêu cầu in hóa đơn
              tới máy in này.
            </Typography.Text>
          </div>
          <Switch
            checked={bridgeEnabled}
            onChange={(checked) => {
              setPrintBridgeEnabled(checked);
              setBridgeEnabled(checked);
              if (checked) {
                messageApi.success('Đã bật nhận lệnh in từ xa trên thiết bị này.');
              } else {
                messageApi.info('Đã tắt nhận lệnh in từ xa.');
              }
            }}
            checkedChildren="BẬT"
            unCheckedChildren="TẮT"
          />
        </div>
      </Card>

      <Card title="Máy in hóa đơn" bordered={false}>
        <Form
          form={form}
          layout="vertical"
          initialValues={defaultPrinterDeviceConfig}
          onFinish={(values) => void save(values)}
        >
          <Row gutter={[20, 8]}>
            <Col xs={24} md={16}>
              <Form.Item
                name="configurationName"
                label="Tên cấu hình"
                rules={[{ required: true, message: 'Vui lòng nhập tên cấu hình.' }]}
              >
                <Input size="large" placeholder="Máy in quầy" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="isDefault" valuePropName="checked" label="Máy in mặc định">
                <Switch checkedChildren="MẶC ĐỊNH" unCheckedChildren="KHÔNG" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="connectionType" label="Kiểu kết nối">
                <Radio.Group>
                  <Space wrap>
                    <Radio value="SYSTEM">Máy in đã cài trên thiết bị</Radio>
                    <Radio value="NETWORK_TCP">Kết nối trực tiếp bằng địa chỉ IP</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
            </Col>

            {connectionType === 'SYSTEM' ? (
              <Col xs={24} md={16}>
                <Form.Item
                  name="printerName"
                  label="Tên máy in"
                  rules={[{ required: true, message: 'Vui lòng chọn máy in.' }]}
                >
                  <Input
                    size="large"
                    readOnly
                    placeholder="Chưa chọn máy in"
                    addonAfter={
                      <Button
                        type="link"
                        icon={<WifiOutlined />}
                        onClick={() => setDiscoveryOpen(true)}
                      >
                        Chọn máy in đã cài
                      </Button>
                    }
                  />
                </Form.Item>
              </Col>
            ) : (
              <>
                <Col xs={24} md={8}>
                  <Form.Item name="printerName" label="Tên máy in">
                    <Input size="large" placeholder="Ví dụ: Máy in quầy thu ngân" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="networkIp"
                    label="Địa chỉ IP máy in Wi‑Fi / LAN"
                    rules={[{ required: true, message: 'Vui lòng nhập địa chỉ IP máy in.' }]}
                  >
                    <Input size="large" inputMode="decimal" placeholder="192.168.1.73" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  <Form.Item
                    name="networkPort"
                    label="Cổng"
                    rules={[{ required: true, message: 'Nhập cổng.' }]}
                  >
                    <InputNumber min={1} max={65535} size="large" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4} className="staff-printer-test-connection">
                  <Button
                    loading={checkingConnection}
                    onClick={() => void checkNetworkConnection()}
                  >
                    Kiểm tra
                  </Button>
                </Col>
              </>
            )}

            <Col xs={24}>
              <Form.Item name="paperSize" label="Khổ giấy in">
                <Radio.Group>
                  <Space wrap>
                    <Radio value="K80">80 mm (K80)</Radio>
                    <Radio value="K58">58 mm (K58)</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="printableDots"
                label="Số dot vùng in thực tế"
                extra={`Để trống để dùng chuẩn ${paperSize === 'K58' ? '420' : '576'} dots.`}
              >
                <InputNumber
                  min={200}
                  max={1200}
                  placeholder={paperSize === 'K58' ? '420' : '576'}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="autoCut" valuePropName="checked" label="Tự động cắt giấy">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="openCashDrawer" valuePropName="checked" label="Mở két tiền">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Divider />
              <Space wrap>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                  Lưu cấu hình
                </Button>
                <Button
                  icon={<PrinterOutlined />}
                  loading={testing}
                  onClick={() => void testPrint()}
                >
                  In thử
                </Button>
                <Button
                  icon={<CheckCircleOutlined />}
                  loading={testing}
                  onClick={() => void testPrint(true)}
                >
                  In hiệu chuẩn
                </Button>
              </Space>
            </Col>
          </Row>
        </Form>
      </Card>

      <Modal
        title="Máy in có trên thiết bị"
        open={discoveryOpen}
        onCancel={() => setDiscoveryOpen(false)}
        afterOpenChange={(open) => {
          if (open) void discoverPrinters();
        }}
        footer={[
          <Button
            key="manual"
            onClick={() => {
              setDiscoveryOpen(false);
              form.setFieldValue('connectionType', 'NETWORK_TCP');
            }}
          >
            Nhập IP thủ công
          </Button>,
          <Button
            key="scan"
            icon={<ReloadOutlined />}
            loading={discovering}
            onClick={() => void discoverPrinters()}
          >
            Làm mới danh sách
          </Button>,
          <Button
            key="select"
            type="primary"
            disabled={!selectedDiscoveredPrinter}
            onClick={() => {
              if (!selectedDiscoveredPrinter) return;
              form.setFieldsValue({
                connectionType: 'SYSTEM',
                printerName: selectedDiscoveredPrinter,
              });
              setDiscoveryOpen(false);
            }}
          >
            Chọn
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          message="Danh sách này gồm các máy in đã được cài trên thiết bị và được QZ Tray cung cấp. Để kết nối trực tiếp tới máy in Wi‑Fi/LAN, hãy chọn “Nhập IP thủ công”."
          style={{ marginBottom: 16 }}
        />
        {discovering ? (
          <div className="staff-printer-discovery-loading">
            <Spin />
            <span>Đang tải danh sách máy in…</span>
          </div>
        ) : systemPrinters.length ? (
          <Radio.Group
            className="staff-printer-discovery-list"
            value={selectedDiscoveredPrinter}
            onChange={(event) => setSelectedDiscoveredPrinter(event.target.value as string)}
          >
            {systemPrinters.map((printer) => (
              <Radio key={printer} value={printer}>
                <PrinterOutlined /> {printer}
              </Radio>
            ))}
          </Radio.Group>
        ) : (
          <Empty description="Chưa có máy in đã cài. Hãy mở QZ Tray hoặc nhập địa chỉ IP của máy in Wi‑Fi/LAN." />
        )}
      </Modal>

      <QzTrustedSetupModal open={trustedModalOpen} onClose={() => setTrustedModalOpen(false)} />
    </div>
  );
}
