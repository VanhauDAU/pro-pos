import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PrinterOutlined,
  QrcodeOutlined,
  SaveOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import {
  type PaperSize,
  type PrintTemplateDisplayConfig,
  type PrinterDeviceConfig,
  type StorePrintSettings,
  defaultPrinterDeviceConfig,
  getReceiptPrintProfile,
  parsePrintTemplateConfigs,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import {
  checkQzTrayStatus,
  connectQzTray,
  fetchQzPrinters,
  getClientDeviceName,
  printCalibrationTest,
  printTestReceipt,
} from '@client/lib/qz-tray-service';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
import { ReceiptPreviewPaper } from '@client/features/pos/ReceiptPreviewModal';
import {
  OWNER_PRINT_PREVIEW_TOTAL_VND,
  buildOwnerPrintPreviewSample,
} from './print-preview-sample';

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

interface StoreSettings {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
}

interface VietQRBank {
  id: number;
  name: string;
  code: string;
  bin: string;
  shortName: string;
  logo: string;
}

const PRINT_SETTINGS_QUERY = ['owner-print-settings'];

export function OwnerPrintSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<StorePrintSettings>();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'invoice' | 'printers'>('invoice');

  // Preview options
  const [previewInvoiceType, setPreviewInvoiceType] = useState<'PROVISIONAL' | 'PAYMENT'>(
    'PAYMENT',
  );
  const [previewPaperSize, setPreviewPaperSize] = useState<'K80' | 'K58'>('K80');

  // Image upload refs & states
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const bottomImageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBottomImage, setUploadingBottomImage] = useState(false);

  const [logoMediaId, setLogoMediaId] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  const [bottomImageMediaId, setBottomImageMediaId] = useState<string | null>(null);
  const [bottomImagePreviewUrl, setBottomImagePreviewUrl] = useState<string | null>(null);

  // Tab 2: Printer Device Settings & QZ Tray states
  const [printerForm] = Form.useForm<PrinterDeviceConfig>();
  const [qzStatus, setQzStatus] = useState<{
    connected: boolean;
    version?: string | undefined;
    loading: boolean;
  }>({
    connected: false,
    loading: false,
  });
  const [systemPrinters, setSystemPrinters] = useState<string[]>([]);
  const [fetchingPrinters, setFetchingPrinters] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [savingPrinter, setSavingPrinter] = useState(false);

  const printerConnectionType = Form.useWatch('connectionType', printerForm) ?? 'SYSTEM';
  const printerPaperSize = Form.useWatch('paperSize', printerForm) ?? 'K80';

  // Queries
  const authContext = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  const storeSettings = useQuery({
    queryKey: ['owner-settings'],
    queryFn: () => apiRequest<StoreSettings>('/api/v1/owner/store/settings'),
  });

  const printSettings = useQuery({
    queryKey: PRINT_SETTINGS_QUERY,
    queryFn: () => apiRequest<StorePrintSettings>('/api/v1/owner/store/print-settings'),
  });

  const vietqrBanks = useQuery({
    queryKey: ['vietqr-banks'],
    queryFn: async () => {
      const res = await fetch('https://api.vietqr.io/v2/banks');
      const json = (await res.json()) as { data?: VietQRBank[] };
      return json.data ?? [];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });

  // Watch form fields for live preview and conditional UI
  const paymentCopyCount = Form.useWatch('paymentCopyCount', form) ?? 1;
  const allowProvisionalPrint = Form.useWatch('allowProvisionalPrint', form) ?? true;
  const provisionalCopyCount = Form.useWatch('provisionalCopyCount', form) ?? 1;
  const logoHorizontalLayout = Form.useWatch('logoHorizontalLayout', form) ?? false;
  const bottomImageDescription = Form.useWatch('bottomImageDescription', form) ?? 'QR thanh toán';
  const bottomImageType = Form.useWatch('bottomImageType', form) ?? 'UPLOAD';
  const bottomBankName = Form.useWatch('bottomBankName', form);
  const bottomBankAccountNumber = Form.useWatch('bottomBankAccountNumber', form);
  const bottomBankAccountName = Form.useWatch('bottomBankAccountName', form);
  const customAddressEnabled = Form.useWatch('customAddressEnabled', form) ?? false;
  const customAddress = Form.useWatch('customAddress', form);
  const footerLine1 = Form.useWatch('footerLine1', form);
  const footerLine1Bold = Form.useWatch('footerLine1Bold', form) ?? false;
  const footerLine2 = Form.useWatch('footerLine2', form);
  const footerLine2Bold = Form.useWatch('footerLine2Bold', form) ?? true;
  const printWifiEnabled = Form.useWatch('printWifiEnabled', form) ?? false;
  const wifiName = Form.useWatch('wifiName', form);
  const wifiPassword = Form.useWatch('wifiPassword', form);

  // Initialize form
  useEffect(() => {
    if (!printSettings.data) return;
    const initialLogo = printSettings.data.logoMediaId ?? null;
    const initialBottomImage = printSettings.data.bottomImageMediaId ?? null;

    setLogoMediaId(initialLogo);
    setLogoPreviewUrl(initialLogo ? `/api/v1/media/${initialLogo}` : null);

    setBottomImageMediaId(initialBottomImage);
    setBottomImagePreviewUrl(initialBottomImage ? `/api/v1/media/${initialBottomImage}` : null);

    form.setFieldsValue({
      maxReceiptReprintCount: printSettings.data.maxReceiptReprintCount ?? 0,
      paymentCopyCount: printSettings.data.paymentCopyCount ?? 1,
      allowProvisionalPrint: printSettings.data.allowProvisionalPrint ?? true,
      provisionalCopyCount: printSettings.data.provisionalCopyCount ?? 1,
      logoHorizontalLayout: printSettings.data.logoHorizontalLayout ?? false,
      logoMediaId: initialLogo,
      bottomImageDescription: printSettings.data.bottomImageDescription ?? 'QR thanh toán',
      bottomImageType: printSettings.data.bottomImageType ?? 'UPLOAD',
      bottomImageMediaId: initialBottomImage,
      bottomBankName: printSettings.data.bottomBankName || storeSettings.data?.bankName || null,
      bottomBankAccountNumber:
        printSettings.data.bottomBankAccountNumber || storeSettings.data?.bankAccountNumber || null,
      bottomBankAccountName:
        printSettings.data.bottomBankAccountName || storeSettings.data?.bankAccountName || null,
      customAddressEnabled: printSettings.data.customAddressEnabled ?? false,
      customAddress: printSettings.data.customAddress || storeSettings.data?.address || null,
      footerLine1: printSettings.data.footerLine1 ?? 'Cảm ơn quý khách và hẹn gặp lại',
      footerLine1Bold: printSettings.data.footerLine1Bold ?? false,
      footerLine2: printSettings.data.footerLine2 ?? 'Một sản phẩm của Văn Hậu IT',
      footerLine2Bold: printSettings.data.footerLine2Bold ?? true,
      printWifiEnabled: printSettings.data.printWifiEnabled ?? false,
      wifiName: printSettings.data.wifiName ?? null,
      wifiPassword: printSettings.data.wifiPassword ?? null,
      paperSize: printSettings.data.paperSize ?? 'K80',
      printersJson: printSettings.data.printersJson ?? null,
    });
    if (printSettings.data.paperSize) {
      setPreviewPaperSize(printSettings.data.paperSize);
    }
    setIsDirty(false);
  }, [printSettings.data, storeSettings.data, form]);

  // Upload helper
  const handleUploadFile = async (file: File): Promise<string | null> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      messageApi.error('Chỉ chấp nhận file ảnh PNG, JPEG hoặc WebP.');
      return null;
    }
    if (file.size > 1024 * 1024) {
      messageApi.error('Dung lượng ảnh tối đa 1MB.');
      return null;
    }
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/v1/media', {
      method: 'POST',
      body: formData,
      headers: {
        'X-CSRF-Token': authContext.data?.csrfToken ?? '',
      },
    });
    if (!response.ok) {
      throw new Error('Upload ảnh thất bại.');
    }
    const json = (await response.json()) as { data: { id: string } };
    return json.data.id;
  };

  const handleLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(localUrl);
    setUploadingLogo(true);
    setIsDirty(true);
    try {
      const mediaId = await handleUploadFile(file);
      if (mediaId) {
        setLogoMediaId(mediaId);
        setLogoPreviewUrl(`/api/v1/media/${mediaId}`);
        form.setFieldValue('logoMediaId', mediaId);
        messageApi.success('Đã tải ảnh logo thành công.');
      }
    } catch (error) {
      setLogoMediaId(null);
      setLogoPreviewUrl(null);
      messageApi.error(errorMessage(error, 'Không thể tải ảnh logo.'));
    } finally {
      setUploadingLogo(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleDeleteLogo = () => {
    setLogoMediaId(null);
    setLogoPreviewUrl(null);
    form.setFieldValue('logoMediaId', null);
    setIsDirty(true);
  };

  const handleBottomImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setBottomImagePreviewUrl(localUrl);
    setUploadingBottomImage(true);
    setIsDirty(true);
    try {
      const mediaId = await handleUploadFile(file);
      if (mediaId) {
        setBottomImageMediaId(mediaId);
        setBottomImagePreviewUrl(`/api/v1/media/${mediaId}`);
        form.setFieldValue('bottomImageMediaId', mediaId);
        messageApi.success('Đã tải ảnh cuối hóa đơn thành công.');
      }
    } catch (error) {
      setBottomImageMediaId(null);
      setBottomImagePreviewUrl(null);
      messageApi.error(errorMessage(error, 'Không thể tải ảnh cuối hóa đơn.'));
    } finally {
      setUploadingBottomImage(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleDeleteBottomImage = () => {
    setBottomImageMediaId(null);
    setBottomImagePreviewUrl(null);
    form.setFieldValue('bottomImageMediaId', null);
    setIsDirty(true);
  };

  // Generate QR from Bank
  const handleGenerateVietQR = () => {
    const bank = form.getFieldValue('bottomBankName') as string | undefined;
    const account = form.getFieldValue('bottomBankAccountNumber') as string | undefined;
    if (!bank || !account) {
      messageApi.warning('Vui lòng chọn ngân hàng và nhập số tài khoản trước khi tạo mã.');
      return;
    }
    setIsDirty(true);
    messageApi.success('Đã tạo mã QR ngân hàng thành công.');
  };

  // Cancel handler
  const handleCancel = () => {
    if (!isDirty) {
      navigate('/owner/settings');
      return;
    }
    if (printSettings.data) {
      const initialLogo = printSettings.data.logoMediaId ?? null;
      const initialBottomImage = printSettings.data.bottomImageMediaId ?? null;

      setLogoMediaId(initialLogo);
      setLogoPreviewUrl(initialLogo ? `/api/v1/media/${initialLogo}` : null);

      setBottomImageMediaId(initialBottomImage);
      setBottomImagePreviewUrl(initialBottomImage ? `/api/v1/media/${initialBottomImage}` : null);

      form.setFieldsValue({
        maxReceiptReprintCount: printSettings.data.maxReceiptReprintCount ?? 0,
        paymentCopyCount: printSettings.data.paymentCopyCount ?? 1,
        allowProvisionalPrint: printSettings.data.allowProvisionalPrint ?? true,
        provisionalCopyCount: printSettings.data.provisionalCopyCount ?? 1,
        logoHorizontalLayout: printSettings.data.logoHorizontalLayout ?? false,
        logoMediaId: initialLogo,
        bottomImageDescription: printSettings.data.bottomImageDescription ?? 'QR thanh toán',
        bottomImageType: printSettings.data.bottomImageType ?? 'UPLOAD',
        bottomImageMediaId: initialBottomImage,
        bottomBankName: printSettings.data.bottomBankName || storeSettings.data?.bankName || null,
        bottomBankAccountNumber:
          printSettings.data.bottomBankAccountNumber ||
          storeSettings.data?.bankAccountNumber ||
          null,
        bottomBankAccountName:
          printSettings.data.bottomBankAccountName || storeSettings.data?.bankAccountName || null,
        customAddressEnabled: printSettings.data.customAddressEnabled ?? false,
        customAddress: printSettings.data.customAddress || storeSettings.data?.address || null,
        footerLine1: printSettings.data.footerLine1 ?? 'Cảm ơn quý khách và hẹn gặp lại',
        footerLine1Bold: printSettings.data.footerLine1Bold ?? false,
        footerLine2: printSettings.data.footerLine2 ?? 'Một sản phẩm của Văn Hậu IT',
        footerLine2Bold: printSettings.data.footerLine2Bold ?? true,
        printWifiEnabled: printSettings.data.printWifiEnabled ?? false,
        wifiName: printSettings.data.wifiName ?? null,
        wifiPassword: printSettings.data.wifiPassword ?? null,
        paperSize: printSettings.data.paperSize ?? 'K80',
        printersJson: printSettings.data.printersJson ?? null,
      });
      if (printSettings.data.paperSize) {
        setPreviewPaperSize(printSettings.data.paperSize);
      }
    }
    setIsDirty(false);
    messageApi.info('Đã hủy các thay đổi chưa lưu.');
  };

  const printProfile = useMemo(() => {
    return getReceiptPrintProfile(previewPaperSize);
  }, [previewPaperSize]);

  const templateConfig: PrintTemplateDisplayConfig = useMemo(() => {
    const configs = parsePrintTemplateConfigs(printSettings.data?.templateConfigJson);
    return previewInvoiceType === 'PROVISIONAL' ? configs.PROVISIONAL : configs.PAYMENT;
  }, [printSettings.data?.templateConfigJson, previewInvoiceType]);

  // Save handler
  const handleSave = async (values: StorePrintSettings) => {
    setSaving(true);
    try {
      const payload: StorePrintSettings = {
        ...values,
        logoMediaId: logoMediaId ?? null,
        bottomImageMediaId: bottomImageMediaId ?? null,
        templateConfigJson: printSettings.data?.templateConfigJson ?? null,
      };
      await jsonRequest('/api/v1/owner/store/print-settings', payload, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: PRINT_SETTINGS_QUERY });
      setIsDirty(false);
      messageApi.success('Đã lưu thiết lập in thành công.');
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể lưu thiết lập in.'));
    } finally {
      setSaving(false);
    }
  };

  // Populate printerForm when printSettings.data loads
  useEffect(() => {
    if (!printSettings.data) return;
    const currentPrinterConfig = parsePrinterDeviceConfig(printSettings.data.printersJson);
    if (printSettings.data.paperSize) {
      currentPrinterConfig.paperSize = printSettings.data.paperSize;
    }
    printerForm.setFieldsValue(currentPrinterConfig);
  }, [printSettings.data, printerForm]);

  // Initial check for QZ Tray
  useEffect(() => {
    let isMounted = true;
    checkQzTrayStatus().then((res) => {
      if (!isMounted) return;
      if (res.connected) {
        setQzStatus({ connected: true, version: res.version, loading: false });
        fetchQzPrinters()
          .then((printers) => {
            if (isMounted) setSystemPrinters(printers);
          })
          .catch(() => {});
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Connect to QZ Tray & discover printers
  const handleConnectQzTray = async () => {
    setQzStatus((prev) => ({ ...prev, loading: true }));
    const res = await connectQzTray();
    if (res.connected) {
      setQzStatus({ connected: true, version: res.version, loading: false });
      messageApi.success(`Đã kết nối QZ Tray thành công (v${res.version || '2.2.x'})`);
      try {
        setFetchingPrinters(true);
        const printers = await fetchQzPrinters();
        setSystemPrinters(printers);
      } catch (err: unknown) {
        console.warn('Could not fetch printers:', err);
      } finally {
        setFetchingPrinters(false);
      }
    } else {
      setQzStatus({ connected: false, loading: false });
      messageApi.warning(res.error || 'Chưa tìm thấy ứng dụng QZ Tray đang chạy trên máy này.');
    }
  };

  const handleFetchPrinters = async () => {
    try {
      setFetchingPrinters(true);
      const printers = await fetchQzPrinters();
      setSystemPrinters(printers);
      messageApi.success(`Tìm thấy ${printers.length} máy in từ hệ thống.`);
    } catch (err: unknown) {
      messageApi.error(errorMessage(err, 'Không thể lấy danh sách máy in từ QZ Tray.'));
    } finally {
      setFetchingPrinters(false);
    }
  };

  const handleCheckNetworkConnection = async () => {
    const ip = printerForm.getFieldValue('networkIp');
    const port = printerForm.getFieldValue('networkPort') || 9100;
    if (!ip?.trim()) {
      messageApi.warning('Vui lòng nhập IP máy in mạng.');
      return;
    }
    setCheckingConnection(true);
    try {
      const res = await printTestReceipt({
        connectionType: 'NETWORK_TCP',
        networkIp: ip.trim(),
        networkPort: port,
        paperSize: printerForm.getFieldValue('paperSize') || 'K80',
        autoCut: false,
        openCashDrawer: false,
        storeName: storeSettings.data?.name || 'PRO POS',
      });
      if (res.success) {
        messageApi.success(`Kết nối tới máy in ${ip}:${port} thành công!`);
      } else {
        messageApi.error(
          `Kiểm tra kết nối thất bại: ${res.message || 'Không thể kết nối tới máy in mạng'}`,
        );
      }
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleTestPrint = async () => {
    const values = printerForm.getFieldsValue();
    setTestingPrint(true);
    try {
      const res = await printTestReceipt({
        connectionType: values.connectionType || 'SYSTEM',
        printerName: values.printerName,
        networkIp: values.networkIp,
        networkPort: values.networkPort,
        paperSize: values.paperSize || 'K80',
        printableDots: values.printableDots,
        autoCut: Boolean(values.autoCut),
        openCashDrawer: Boolean(values.openCashDrawer),
        storeName: storeSettings.data?.name || 'PRO POS',
      });
      if (res.success) {
        messageApi.success('Đã gửi lệnh in thử thành công tới máy in!');
      } else {
        messageApi.error(`In thử thất bại: ${res.message || 'Không thể in'}`);
      }
    } finally {
      setTestingPrint(false);
    }
  };

  const handleCalibrationTest = async () => {
    const values = printerForm.getFieldsValue();
    setTestingPrint(true);
    try {
      const res = await printCalibrationTest({
        connectionType: values.connectionType || 'SYSTEM',
        printerName: values.printerName,
        networkIp: values.networkIp,
        networkPort: values.networkPort,
        paperSize: values.paperSize || 'K80',
        printableDots: values.printableDots,
        autoCut: Boolean(values.autoCut),
        openCashDrawer: false,
        storeName: storeSettings.data?.name || 'PRO POS',
      });
      if (res.success) {
        messageApi.success('Đã gửi bản in hiệu chuẩn (Calibration) tới máy in!');
      } else {
        messageApi.error(`In hiệu chuẩn thất bại: ${res.message || 'Không thể in'}`);
      }
    } finally {
      setTestingPrint(false);
    }
  };

  const handleSavePrinterConfig = async (values: PrinterDeviceConfig) => {
    if (!printSettings.data) return;
    setSavingPrinter(true);
    try {
      const payload: StorePrintSettings = {
        ...printSettings.data,
        paperSize: values.paperSize,
        printersJson: JSON.stringify(values),
        templateConfigJson: printSettings.data.templateConfigJson ?? null,
      };
      await jsonRequest('/api/v1/owner/store/print-settings', payload, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      await queryClient.invalidateQueries({ queryKey: PRINT_SETTINGS_QUERY });
      messageApi.success('Đã lưu cấu hình máy in thành công.');
    } catch (err: unknown) {
      messageApi.error(errorMessage(err, 'Không thể lưu cấu hình máy in.'));
    } finally {
      setSavingPrinter(false);
    }
  };

  // VietQR URL calculation for preview (pure QR only for compact thermal receipt)
  const previewVietQrUrl = useMemo(() => {
    if (bottomImageType === 'VIETQR') {
      if (bottomBankName && bottomBankAccountNumber) {
        return `https://img.vietqr.io/image/${encodeURIComponent(bottomBankName.trim())}-${encodeURIComponent(
          bottomBankAccountNumber.trim(),
        )}-qr_only.png?amount=${OWNER_PRINT_PREVIEW_TOTAL_VND}&addInfo=Thanh+toan+bill&accountName=${encodeURIComponent(
          bottomBankAccountName?.trim() || '',
        )}`;
      }
    } else if (bottomImageType === 'UPLOAD' && bottomImagePreviewUrl) {
      return bottomImagePreviewUrl;
    }
    return null;
  }, [
    bottomImageType,
    bottomBankName,
    bottomBankAccountNumber,
    bottomBankAccountName,
    bottomImagePreviewUrl,
  ]);

  // Display Address calculation
  const previewAddress = useMemo(() => {
    if (customAddressEnabled && customAddress?.trim()) {
      return customAddress.trim();
    }
    return (
      storeSettings.data?.address ||
      'Số 55 610B thôn Hà An, xã Gò Nổi, Thành Phố Đà Nẵng, Xã Gò Nổi, Đà Nẵng'
    );
  }, [customAddressEnabled, customAddress, storeSettings.data?.address]);

  const previewStoreName = storeSettings.data?.name || 'Vanhau1410rr';
  const previewPhone = storeSettings.data?.phone || '0777464347';

  if (printSettings.isLoading) {
    return (
      <div className="owner-print-settings-page">
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    );
  }

  const livePreviewSettings = {
    ...printSettings.data,
    ...form.getFieldsValue(),
    storeId: printSettings.data?.storeId ?? '',
    updatedAt: printSettings.data?.updatedAt ?? Date.now(),
    paperSize: previewPaperSize,
    logoMediaId: logoMediaId ?? null,
    bottomImageMediaId: bottomImageMediaId ?? null,
    templateConfigJson: printSettings.data?.templateConfigJson ?? null,
  } as StorePrintSettings;
  const previewReceiptData = buildOwnerPrintPreviewSample(previewInvoiceType);

  return (
    <div className="owner-print-settings-page">
      {contextHolder}

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={logoInputRef}
        style={{ display: 'none' }}
        accept="image/png,image/jpeg,image/webp"
        onChange={handleLogoFileChange}
      />
      <input
        type="file"
        ref={bottomImageInputRef}
        style={{ display: 'none' }}
        accept="image/png,image/jpeg,image/webp"
        onChange={handleBottomImageFileChange}
      />

      {/* Sticky Top Header with Back link, Title, Unsaved Badge & Action Buttons */}
      <div className="owner-print-settings-header">
        <div>
          <Link to="/owner/settings" className="owner-print-settings-backlink">
            ‹ Quay lại Thiết lập cửa hàng
          </Link>
          <Typography.Title level={2} style={{ margin: '2px 0 0', fontSize: 21 }}>
            Thiết lập in
          </Typography.Title>
        </div>
        <div className="owner-print-settings-header__actions">
          {isDirty ? (
            <div className="owner-print-unsaved-text">
              <span className="owner-print-unsaved-dot">●</span> Có thao tác chỉnh sửa chưa lưu
            </div>
          ) : null}
          <Space size={10}>
            <Button onClick={handleCancel}>Hủy</Button>
            <Button
              type="primary"
              form="print-settings-form"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
            >
              Lưu
            </Button>
          </Space>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="owner-print-settings-tabs-wrapper">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'invoice' | 'printers')}
          items={[
            { key: 'invoice', label: 'Mẫu in hóa đơn' },
            { key: 'label_disabled', label: 'Mẫu in tem', disabled: true },
            { key: 'kitchen_disabled', label: 'Mẫu in bếp', disabled: true },
            { key: 'check_disabled', label: 'Mẫu in phiếu kiểm đồ', disabled: true },
          ]}
        />
      </div>

      {activeTab === 'invoice' ? (
        <Form
          id="print-settings-form"
          form={form}
          layout="vertical"
          onValuesChange={() => setIsDirty(true)}
          onFinish={handleSave}
          initialValues={{
            maxReceiptReprintCount: 0,
            paymentCopyCount: 1,
            allowProvisionalPrint: true,
            provisionalCopyCount: 1,
            logoHorizontalLayout: false,
            bottomImageDescription: 'QR thanh toán',
            bottomImageType: 'UPLOAD',
            customAddressEnabled: false,
            footerLine1: 'Cảm ơn quý khách và hẹn gặp lại',
            footerLine1Bold: false,
            footerLine2: 'Một sản phẩm của Văn Hậu IT',
            footerLine2Bold: true,
            printWifiEnabled: false,
            paperSize: 'K80',
          }}
        >
          <Form.Item name="logoMediaId" hidden noStyle>
            <Input />
          </Form.Item>
          <Form.Item name="bottomImageMediaId" hidden noStyle>
            <Input />
          </Form.Item>
          <Row gutter={[24, 24]}>
            {/* Left Column: 4 Setting Groups */}
            <Col xs={24} lg={14} xl={15}>
              <Space direction="vertical" size={20} style={{ width: '100%' }}>
                {/* ── Nhóm 1: Thiết lập thông tin chung ── */}
                <Card
                  title="Thiết lập thông tin chung"
                  bordered={false}
                  className="owner-print-card"
                >
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Số lần in biên lai tối đa"
                        name="maxReceiptReprintCount"
                        extra="0 = không giới hạn số lần in"
                      >
                        <InputNumber min={0} max={999} style={{ width: '100%' }} size="large" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Số liên in hoá đơn thanh toán" name="paymentCopyCount">
                        <Select
                          size="large"
                          options={[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
                            value: n,
                            label: `${n}`,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <div className="owner-print-switch-row">
                    <div className="owner-print-switch-row__label">
                      <strong>Cho phép in hoá đơn tạm tính</strong>
                    </div>
                    <Form.Item name="allowProvisionalPrint" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>

                  {allowProvisionalPrint ? (
                    <Row gutter={16} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Số liên in hoá đơn tạm tính" name="provisionalCopyCount">
                          <Select
                            size="large"
                            options={[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
                              value: n,
                              label: `${n}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : null}
                </Card>

                {/* ── Nhóm 2: Logo ── */}
                <Card title="Logo" bordered={false} className="owner-print-card">
                  <Row gutter={24} align="middle">
                    <Col xs={24} sm={16}>
                      <Form.Item name="logoHorizontalLayout" valuePropName="checked">
                        <Checkbox>Hiển thị logo và thông tin cửa hàng theo bố cục ngang</Checkbox>
                      </Form.Item>
                      <div className="owner-print-instruction">
                        <p style={{ margin: '0 0 4px', fontWeight: 500 }}>
                          Thiết lập logo hiển thị trên đầu hóa đơn
                        </p>
                        <ul style={{ margin: 0, paddingLeft: 18, color: '#64748b' }}>
                          <li>Kích thước ảnh không quá 512 x 512px, dung lượng tối đa 1Mb</li>
                        </ul>
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <Space>
                          <Button
                            size="middle"
                            onClick={() => logoInputRef.current?.click()}
                            loading={uploadingLogo}
                          >
                            Chọn ảnh
                          </Button>
                          {logoPreviewUrl && (
                            <Button
                              danger
                              size="middle"
                              icon={<DeleteOutlined />}
                              onClick={handleDeleteLogo}
                            >
                              Xóa logo
                            </Button>
                          )}
                        </Space>
                      </div>
                    </Col>
                    <Col xs={24} sm={8} style={{ textAlign: 'center' }}>
                      <div className="owner-print-media-box">
                        {logoPreviewUrl ? (
                          <img
                            src={logoPreviewUrl}
                            alt="Logo preview"
                            className="owner-print-media-box__img"
                          />
                        ) : (
                          <div className="owner-print-media-box__placeholder">
                            <PictureOutlined style={{ fontSize: 44, color: '#cbd5e1' }} />
                          </div>
                        )}
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* ── Nhóm 3: Ảnh cuối hoá đơn ── */}
                <Card title="Ảnh cuối hoá đơn" bordered={false} className="owner-print-card">
                  <Row gutter={24}>
                    <Col xs={24} sm={16}>
                      <Form.Item label="Mô tả (tối đa 90 ký tự)" name="bottomImageDescription">
                        <Input maxLength={90} placeholder="QR thanh toán" size="large" />
                      </Form.Item>

                      <Form.Item name="bottomImageType">
                        <Radio.Group style={{ width: '100%' }}>
                          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                            {/* Option 1: Tải ảnh */}
                            <div>
                              <Radio value="UPLOAD">
                                <span style={{ fontWeight: 600 }}>Tải ảnh</span>
                              </Radio>
                              {bottomImageType === 'UPLOAD' ? (
                                <div style={{ paddingLeft: 24, marginTop: 8 }}>
                                  <p style={{ margin: '0 0 4px', color: '#475569' }}>
                                    QR code thanh toán, QR code trang bán hàng online ...
                                  </p>
                                  <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 13 }}>
                                    Kích thước ảnh không quá 512 x 512px, dung lượng tối đa 1Mb
                                  </p>
                                  <Space>
                                    <Button
                                      size="middle"
                                      onClick={() => bottomImageInputRef.current?.click()}
                                      loading={uploadingBottomImage}
                                    >
                                      Chọn ảnh
                                    </Button>
                                    {bottomImagePreviewUrl && (
                                      <Button
                                        danger
                                        size="middle"
                                        icon={<DeleteOutlined />}
                                        onClick={handleDeleteBottomImage}
                                      >
                                        Xóa ảnh
                                      </Button>
                                    )}
                                  </Space>
                                </div>
                              ) : null}
                            </div>

                            {/* Option 2: Tạo mã QR tài khoản ngân hàng */}
                            <div>
                              <Radio value="VIETQR">
                                <span style={{ fontWeight: 600 }}>
                                  Tạo mã QR tài khoản ngân hàng
                                </span>
                              </Radio>
                              {bottomImageType === 'VIETQR' ? (
                                <div style={{ paddingLeft: 24, marginTop: 12 }}>
                                  <Form.Item label="Ngân hàng" name="bottomBankName">
                                    <Select
                                      size="large"
                                      showSearch
                                      placeholder="Chọn ngân hàng"
                                      optionFilterProp="label"
                                      options={(vietqrBanks.data ?? []).map((b) => ({
                                        value: b.shortName,
                                        label: `${b.shortName} - ${b.name} (${b.code})`,
                                      }))}
                                    />
                                  </Form.Item>

                                  <Form.Item label="Số tài khoản" name="bottomBankAccountNumber">
                                    <Input placeholder="Nhập số tài khoản" size="large" />
                                  </Form.Item>

                                  <Form.Item label="Tên chủ tài khoản" name="bottomBankAccountName">
                                    <Input
                                      placeholder="Nhập tên chủ tài khoản (không dấu)"
                                      size="large"
                                    />
                                  </Form.Item>

                                  <Button onClick={handleGenerateVietQR} size="middle">
                                    Tạo mã
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </Space>
                        </Radio.Group>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8} style={{ textAlign: 'center' }}>
                      <div className="owner-print-media-box">
                        {previewVietQrUrl ? (
                          <img
                            src={previewVietQrUrl}
                            alt="Bottom QR preview"
                            className="owner-print-media-box__img"
                          />
                        ) : (
                          <div className="owner-print-media-box__placeholder">
                            <QrcodeOutlined style={{ fontSize: 44, color: '#cbd5e1' }} />
                          </div>
                        )}
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* ── Nhóm 4: Thông tin cửa hàng ── */}
                <Card title="Thông tin cửa hàng" bordered={false} className="owner-print-card">
                  <div className="owner-print-switch-row" style={{ marginBottom: 12 }}>
                    <div className="owner-print-switch-row__label">
                      <strong>Tuỳ chỉnh địa chỉ in trên hoá đơn</strong>
                    </div>
                    <Form.Item name="customAddressEnabled" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>

                  <Form.Item name="customAddress">
                    <Input.TextArea
                      rows={3}
                      size="large"
                      disabled={!customAddressEnabled}
                      placeholder={
                        storeSettings.data?.address ||
                        'Số 55 610B thôn Hà An, xã Gò Nổi, Thành Phố Đà Nẵng, Xã Gò Nổi, Đà Nẵng'
                      }
                    />
                  </Form.Item>

                  <Divider style={{ margin: '16px 0' }} />

                  <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
                    Thông tin chân trang hoá đơn
                  </Typography.Text>

                  <div className="owner-print-footer-line">
                    <div className="owner-print-footer-line__header">
                      <span>Nội dung 1</span>
                      <Form.Item name="footerLine1Bold" valuePropName="checked" noStyle>
                        <Checkbox>In đậm chữ</Checkbox>
                      </Form.Item>
                    </div>
                    <Form.Item name="footerLine1" style={{ marginBottom: 16 }}>
                      <Input
                        placeholder="Cảm ơn quý khách và hẹn gặp lại"
                        size="large"
                        maxLength={255}
                      />
                    </Form.Item>
                  </div>

                  <div className="owner-print-footer-line">
                    <div className="owner-print-footer-line__header">
                      <span>Nội dung 2</span>
                      <Form.Item name="footerLine2Bold" valuePropName="checked" noStyle>
                        <Checkbox>In đậm chữ</Checkbox>
                      </Form.Item>
                    </div>
                    <Form.Item name="footerLine2" style={{ marginBottom: 16 }}>
                      <Input
                        placeholder="Một sản phẩm của Văn Hậu IT"
                        size="large"
                        maxLength={255}
                        allowClear
                      />
                    </Form.Item>
                  </div>

                  <div className="owner-print-switch-row" style={{ marginTop: 8 }}>
                    <div className="owner-print-switch-row__label">
                      <strong>In thông tin wifi dưới chân trang hoá đơn</strong>
                    </div>
                    <Form.Item name="printWifiEnabled" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>

                  {printWifiEnabled ? (
                    <Row gutter={16} style={{ marginTop: 12 }}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Tên Wifi" name="wifiName">
                          <Input
                            placeholder="Ví dụ: Cafe_VIP_5G"
                            size="large"
                            prefix={<WifiOutlined />}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Mật khẩu Wifi" name="wifiPassword">
                          <Input placeholder="Ví dụ: 88888888" size="large" />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : null}
                </Card>
              </Space>
            </Col>

            {/* Right Column: Live Receipt Preview */}
            <Col xs={24} lg={10} xl={9}>
              <Card
                title="Xem trước"
                extra={
                  <Button
                    type="default"
                    icon={<EditOutlined />}
                    style={{ color: '#1677ff', borderColor: '#1677ff' }}
                    onClick={() => navigate('/owner/settings/printing/template')}
                  >
                    Sửa mẫu in
                  </Button>
                }
                bordered={false}
                className="owner-print-card owner-print-preview-card"
              >
                <div style={{ marginBottom: 16 }}>
                  <Select
                    value={previewInvoiceType}
                    onChange={setPreviewInvoiceType}
                    size="large"
                    style={{ width: '100%', marginBottom: 10 }}
                    options={[
                      { value: 'PAYMENT', label: 'Hóa đơn thanh toán' },
                      { value: 'PROVISIONAL', label: 'Hóa đơn tạm tính' },
                    ]}
                  />
                  <Select
                    value={previewPaperSize}
                    onChange={(size: PaperSize) => {
                      setPreviewPaperSize(size);
                      form.setFieldValue('paperSize', size);
                      setIsDirty(true);
                    }}
                    size="large"
                    style={{ width: '100%' }}
                    options={[
                      {
                        value: 'K80',
                        label: 'Khổ giấy 80mm (K80 - Vùng in chuẩn 72mm / 576 dots)',
                      },
                      {
                        value: 'K58',
                        label: 'Khổ giấy 58mm (K58 - Vùng in chuẩn 52.5mm / 420 dots)',
                      },
                    ]}
                  />
                </div>

                <ReceiptPreviewPaper
                  options={{
                    data: previewReceiptData,
                    printSettings: livePreviewSettings,
                    storeInfo: {
                      storeName: previewStoreName,
                      phone: previewPhone,
                      address: previewAddress,
                      bankName: storeSettings.data?.bankName ?? null,
                      bankAccountNumber: storeSettings.data?.bankAccountNumber ?? null,
                      bankAccountName: storeSettings.data?.bankAccountName ?? null,
                    },
                  }}
                />

                {/* ── Thermal Paper Simulated Container ── */}
                <div
                  className={`thermal-receipt-preview thermal-receipt-preview--${previewPaperSize.toLowerCase()}`}
                  style={{ display: 'none' }}
                >
                  <div className="thermal-receipt-inner">
                    {/* Header: Logo & Store Info */}
                    {logoHorizontalLayout ? (
                      <div className="thermal-receipt-header-horizontal">
                        {templateConfig.showLogo && logoPreviewUrl ? (
                          <div className="thermal-receipt-logo-thumb">
                            <img src={logoPreviewUrl} alt="Logo" />
                          </div>
                        ) : null}
                        <div className="thermal-receipt-store-info">
                          <div className="thermal-receipt-store-name">{previewStoreName}</div>
                          <div className="thermal-receipt-store-address">{previewAddress}</div>
                          <div className="thermal-receipt-store-phone">SĐT: {previewPhone}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="thermal-receipt-header-vertical">
                        {templateConfig.showLogo && logoPreviewUrl ? (
                          <div className="thermal-receipt-logo-centered">
                            <img src={logoPreviewUrl} alt="Logo" />
                          </div>
                        ) : null}
                        <div className="thermal-receipt-store-name">{previewStoreName}</div>
                        <div className="thermal-receipt-store-address">{previewAddress}</div>
                        <div className="thermal-receipt-store-phone">SĐT: {previewPhone}</div>
                      </div>
                    )}

                    {/* Title & Copy count */}
                    <div className="thermal-receipt-title">
                      {previewInvoiceType === 'PROVISIONAL'
                        ? 'HÓA ĐƠN TẠM TÍNH'
                        : 'HÓA ĐƠN THANH TOÁN'}
                    </div>
                    <div className="thermal-receipt-copy-count">
                      Liên 1/
                      {previewInvoiceType === 'PROVISIONAL'
                        ? provisionalCopyCount || 1
                        : paymentCopyCount || 1}
                    </div>

                    <div className="thermal-receipt-divider-dash" />

                    {/* Order Metadata */}
                    <div className="thermal-receipt-meta">
                      {templateConfig.showTableAreaName && (
                        <div className="thermal-receipt-row">
                          <span className="thermal-receipt-label">Tại bàn</span>
                          <span className="thermal-receipt-value">Khu vực 1 - bàn 1 (+3)</span>
                        </div>
                      )}
                      <div className="thermal-receipt-row">
                        {templateConfig.showCheckInTime && <span>Giờ vào: 08:00 25/12/2026</span>}
                        <span>Giờ in: 08:08</span>
                      </div>
                      {templateConfig.showCashierName && (
                        <div className="thermal-receipt-row">
                          <span className="thermal-receipt-label">Thu ngân</span>
                          <span className="thermal-receipt-value">Nguyễn Văn A</span>
                        </div>
                      )}
                      {(templateConfig.showCustomerPhone ||
                        templateConfig.showCustomerAddress ||
                        templateConfig.showOrderNote) && (
                        <div className="thermal-receipt-divider-dash" />
                      )}

                      <div className="thermal-receipt-row">
                        <span className="thermal-receipt-label">Khách hàng</span>
                        <span className="thermal-receipt-value">Nguyễn Nhật Quang Minh</span>
                      </div>
                      {templateConfig.showCustomerPhone && (
                        <div className="thermal-receipt-row">
                          <span className="thermal-receipt-label">Điện thoại</span>
                          <span className="thermal-receipt-value">0966 690 040</span>
                        </div>
                      )}
                      {templateConfig.showCustomerAddress && (
                        <div className="thermal-receipt-row">
                          <span
                            className="thermal-receipt-label"
                            style={{ textDecoration: 'underline' }}
                          >
                            Địa chỉ:
                          </span>
                          <span
                            className="thermal-receipt-value"
                            style={{ textAlign: 'right', maxWidth: 190 }}
                          >
                            266 Đội Cấn, Ba Đình, Hà Nội
                          </span>
                        </div>
                      )}
                      {templateConfig.showOrderNote && (
                        <div
                          className="thermal-receipt-row"
                          style={{ fontStyle: 'italic', marginTop: 3 }}
                        >
                          <span>*Ghi chú:</span>
                          <span>Thêm nhiều hàng tỏi các loại</span>
                        </div>
                      )}
                    </div>

                    <div className="thermal-receipt-divider-dash" />

                    {/* Items Table: Hourly Services */}
                    <div
                      className="thermal-receipt-items"
                      style={{
                        fontSize:
                          previewPaperSize === 'K58'
                            ? templateConfig.itemFontSize === 'SMALL'
                              ? '8px'
                              : templateConfig.itemFontSize === 'LARGE'
                                ? '10px'
                                : '8.5px'
                            : templateConfig.itemFontSize === 'SMALL'
                              ? '9.5px'
                              : templateConfig.itemFontSize === 'LARGE'
                                ? '12px'
                                : '10.5px',
                      }}
                    >
                      <div className="thermal-receipt-table-header">
                        <span style={{ flex: 1 }}>Thông tin giờ</span>
                        {previewPaperSize === 'K80' && templateConfig.showHourlyUnitPrice && (
                          <span style={{ width: 65, textAlign: 'right' }}>Đ.Giá</span>
                        )}
                        <span
                          style={{
                            width: previewPaperSize === 'K58' ? 48 : 65,
                            textAlign: 'right',
                          }}
                        >
                          T.Tiền
                        </span>
                      </div>
                      <div className="thermal-receipt-item-row">
                        <div className="thermal-receipt-item-main">
                          <span style={{ flex: 1, fontWeight: 600 }}>1. Billiard</span>
                          {!templateConfig.showHourlyDetail ||
                          templateConfig.hourlyDetailMode === 'TOTAL_ONLY' ? (
                            <>
                              {previewPaperSize === 'K80' && templateConfig.showHourlyUnitPrice && (
                                <span style={{ width: 65, textAlign: 'right' }}>
                                  60,000{templateConfig.showHourlyUnitDuration ? '/1h' : ''}
                                </span>
                              )}
                              <span
                                style={{
                                  width: previewPaperSize === 'K58' ? 48 : 65,
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              >
                                150,000
                              </span>
                            </>
                          ) : null}
                        </div>

                        {!templateConfig.showHourlyDetail ||
                        templateConfig.hourlyDetailMode === 'TOTAL_ONLY' ? (
                          <>
                            {previewPaperSize === 'K58' && templateConfig.showHourlyUnitPrice && (
                              <div className="thermal-receipt-item-sub">
                                Đ.Giá: 60,000{templateConfig.showHourlyUnitDuration ? '/1h' : ''}
                              </div>
                            )}
                            {templateConfig.showHourlyDetail && (
                              <div
                                className="thermal-receipt-item-sub"
                                style={{ color: '#64748b' }}
                              >
                                = 2 giờ 30 phút
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="thermal-receipt-item-sub">
                            {/* Segment 1: Giờ đầu */}
                            <div style={{ marginTop: 3 }}>
                              <div>
                                {templateConfig.showHourlyTimeWithSeconds
                                  ? '18:00:00 - 18:30:00'
                                  : '18:00 - 18:30'}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1 }}>20/06/2024</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice && (
                                    <span style={{ width: 65, textAlign: 'right' }}>60,000</span>
                                  )}
                                <span
                                  style={{
                                    width: previewPaperSize === 'K58' ? 48 : 65,
                                    textAlign: 'right',
                                    fontWeight: 600,
                                  }}
                                >
                                  60,000
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1, color: '#64748b' }}>=Giờ đầu</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice &&
                                  templateConfig.showHourlyUnitDuration && (
                                    <span
                                      style={{ width: 65, textAlign: 'right', color: '#64748b' }}
                                    >
                                      /1h
                                    </span>
                                  )}
                                <span style={{ width: previewPaperSize === 'K58' ? 48 : 65 }} />
                              </div>
                              {previewPaperSize === 'K58' && templateConfig.showHourlyUnitPrice && (
                                <div className="thermal-receipt-item-sub">
                                  Đ.Giá: 60,000{templateConfig.showHourlyUnitDuration ? '/1h' : ''}
                                </div>
                              )}
                            </div>

                            {/* Segment 2: Giá thường */}
                            <div style={{ marginTop: 6 }}>
                              <div>
                                {templateConfig.showHourlyTimeWithSeconds
                                  ? '18:30:00 - 19:30:00'
                                  : '18:30 - 19:30'}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1 }}>20/06/2024</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice && (
                                    <span style={{ width: 65, textAlign: 'right' }}>40,000</span>
                                  )}
                                <span
                                  style={{
                                    width: previewPaperSize === 'K58' ? 48 : 65,
                                    textAlign: 'right',
                                    fontWeight: 600,
                                  }}
                                >
                                  40,000
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1, color: '#64748b' }}>=1 giờ</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice &&
                                  templateConfig.showHourlyUnitDuration && (
                                    <span
                                      style={{ width: 65, textAlign: 'right', color: '#64748b' }}
                                    >
                                      /1h
                                    </span>
                                  )}
                                <span style={{ width: previewPaperSize === 'K58' ? 48 : 65 }} />
                              </div>
                              {previewPaperSize === 'K58' && templateConfig.showHourlyUnitPrice && (
                                <div className="thermal-receipt-item-sub">
                                  Đ.Giá: 40,000{templateConfig.showHourlyUnitDuration ? '/1h' : ''}
                                </div>
                              )}
                            </div>

                            {/* Segment 3: Khung giờ tối */}
                            <div style={{ marginTop: 6 }}>
                              <div>
                                {templateConfig.showHourlyTimeWithSeconds
                                  ? '19:30:00 - 20:30:00'
                                  : '19:30 - 20:30'}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1 }}>20/06/2024</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice && (
                                    <span style={{ width: 65, textAlign: 'right' }}>50,000</span>
                                  )}
                                <span
                                  style={{
                                    width: previewPaperSize === 'K58' ? 48 : 65,
                                    textAlign: 'right',
                                    fontWeight: 600,
                                  }}
                                >
                                  50,000
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                                <span style={{ flex: 1, color: '#64748b' }}>=1 giờ</span>
                                {previewPaperSize === 'K80' &&
                                  templateConfig.showHourlyUnitPrice &&
                                  templateConfig.showHourlyUnitDuration && (
                                    <span
                                      style={{ width: 65, textAlign: 'right', color: '#64748b' }}
                                    >
                                      /1h
                                    </span>
                                  )}
                                <span style={{ width: previewPaperSize === 'K58' ? 48 : 65 }} />
                              </div>
                              {previewPaperSize === 'K58' && templateConfig.showHourlyUnitPrice && (
                                <div className="thermal-receipt-item-sub">
                                  Đ.Giá: 50,000{templateConfig.showHourlyUnitDuration ? '/1h' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="thermal-receipt-divider-dash" />

                      {/* Items Table: Quantity Goods */}
                      <div
                        className={`thermal-receipt-items ${templateConfig.showItemTableBorder ? 'thermal-receipt-items--bordered' : ''}`}
                        style={{
                          fontSize:
                            previewPaperSize === 'K58'
                              ? templateConfig.itemFontSize === 'SMALL'
                                ? '8px'
                                : templateConfig.itemFontSize === 'LARGE'
                                  ? '10px'
                                  : '8.5px'
                              : templateConfig.itemFontSize === 'SMALL'
                                ? '9.5px'
                                : templateConfig.itemFontSize === 'LARGE'
                                  ? '12px'
                                  : '10.5px',
                        }}
                      >
                        <div className="thermal-receipt-table-header">
                          <span style={{ flex: 1 }}>Mặt hàng</span>
                          <span
                            style={{
                              width: previewPaperSize === 'K58' ? 22 : 45,
                              textAlign: 'center',
                            }}
                          >
                            {previewPaperSize === 'K58' ? 'SL' : 'SL/TL'}
                          </span>
                          {previewPaperSize === 'K80' &&
                            templateConfig.showItemUnitPrice &&
                            templateConfig.itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                              <span style={{ width: 60, textAlign: 'right' }}>Đ.Giá</span>
                            )}
                          <span
                            style={{
                              width: previewPaperSize === 'K58' ? 48 : 65,
                              textAlign: 'right',
                            }}
                          >
                            T.Tiền
                          </span>
                        </div>

                        <div className="thermal-receipt-item-row">
                          <div className="thermal-receipt-item-main">
                            <span style={{ flex: 1, fontWeight: 600 }}>
                              {templateConfig.showItemIndex ? '1. ' : ''}Trà sữa ô long (size L)
                              {templateConfig.showItemPriceName ? ' (Giá chuẩn)' : ''}
                            </span>
                            <span
                              style={{
                                width: previewPaperSize === 'K58' ? 22 : 45,
                                textAlign: 'center',
                              }}
                            >
                              1
                            </span>
                            {previewPaperSize === 'K80' &&
                              templateConfig.showItemUnitPrice &&
                              templateConfig.itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                                <span style={{ width: 60, textAlign: 'right' }}>65,000</span>
                              )}
                            <span
                              style={{
                                width: previewPaperSize === 'K58' ? 48 : 65,
                                textAlign: 'right',
                                fontWeight: 600,
                              }}
                            >
                              65,000
                            </span>
                          </div>
                          {templateConfig.showItemUnitPrice &&
                            (templateConfig.itemUnitPricePlacement === 'INLINE' ||
                              previewPaperSize === 'K58') && (
                              <div className="thermal-receipt-item-sub">Đơn giá: 65,000</div>
                            )}
                          {templateConfig.showItemNote && (
                            <div
                              className="thermal-receipt-item-sub"
                              style={{ fontStyle: 'italic' }}
                            >
                              * G/chú: Không lấy ống hút
                            </div>
                          )}
                          {templateConfig.showItemDiscounts && (
                            <div className="thermal-receipt-item-sub" style={{ color: '#d4380d' }}>
                              * Giảm thủ công: -10,000 · Lý do: Khách thân thiết
                            </div>
                          )}
                        </div>

                        <div className="thermal-receipt-item-row" style={{ marginTop: 4 }}>
                          <div className="thermal-receipt-item-main">
                            <span style={{ flex: 1, fontWeight: 600 }}>
                              {templateConfig.showItemIndex ? '2. ' : ''}Cơm gà chua ngọt
                            </span>
                            <span
                              style={{
                                width: previewPaperSize === 'K58' ? 30 : 45,
                                textAlign: 'center',
                              }}
                            >
                              1
                            </span>
                            {previewPaperSize === 'K80' &&
                              templateConfig.showItemUnitPrice &&
                              templateConfig.itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                                <span style={{ width: 60, textAlign: 'right' }}>60,000</span>
                              )}
                            <span
                              style={{
                                width: previewPaperSize === 'K58' ? 55 : 65,
                                textAlign: 'right',
                                fontWeight: 600,
                              }}
                            >
                              60,000
                            </span>
                          </div>
                        </div>

                        {!templateConfig.hideZeroPriceItems && (
                          <div className="thermal-receipt-item-row" style={{ marginTop: 4 }}>
                            <div className="thermal-receipt-item-main">
                              <span style={{ flex: 1, fontWeight: 600 }}>
                                {templateConfig.showItemIndex ? '3. ' : ''}Khăn lạnh (tặng kèm)
                              </span>
                              <span
                                style={{
                                  width: previewPaperSize === 'K58' ? 30 : 45,
                                  textAlign: 'center',
                                }}
                              >
                                2
                              </span>
                              {previewPaperSize === 'K80' &&
                                templateConfig.showItemUnitPrice &&
                                templateConfig.itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                                  <span style={{ width: 60, textAlign: 'right' }}>0</span>
                                )}
                              <span
                                style={{
                                  width: previewPaperSize === 'K58' ? 55 : 65,
                                  textAlign: 'right',
                                }}
                              >
                                0
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="thermal-receipt-divider-dash" />

                    {/* Totals Summary */}
                    <div className="thermal-receipt-summary">
                      <div className="thermal-receipt-row">
                        <span>Tiền giờ (1)</span>
                        <span>48,000</span>
                      </div>
                      <div className="thermal-receipt-row">
                        <span>Tiền hàng (2)</span>
                        <span>125,000</span>
                      </div>
                      {templateConfig.combineGoodsAndServiceTotal && (
                        <div className="thermal-receipt-row" style={{ fontWeight: 600 }}>
                          <span>Tổng tiền hàng & dịch vụ</span>
                          <span>173,000</span>
                        </div>
                      )}
                      {templateConfig.showPromotionsList && (
                        <div
                          className="thermal-receipt-row"
                          style={{ fontSize: 10.5, color: '#64748b' }}
                        >
                          <span>KM: Giảm giá khai trương (10%)</span>
                          <span>-10,000</span>
                        </div>
                      )}
                    </div>

                    {templateConfig.showProvisionalTotal && (
                      <>
                        <div className="thermal-receipt-divider-dash" />
                        <div className="thermal-receipt-grand-total">
                          <span>
                            {previewInvoiceType === 'PROVISIONAL' ? 'TỔNG TẠM TÍNH' : 'TỔNG CỘNG'}
                          </span>
                          <span className="thermal-receipt-grand-total-amount">163,000đ</span>
                        </div>
                      </>
                    )}

                    {/* Star Separator */}
                    <div className="thermal-receipt-star-divider">
                      ----------------*----------------
                    </div>

                    {/* Bottom Image / VietQR */}
                    {templateConfig.showBottomImage && previewVietQrUrl ? (
                      <div className="thermal-receipt-bottom-qr-container">
                        <img
                          src={previewVietQrUrl}
                          alt="QR Bill"
                          className="thermal-receipt-bottom-qr-img"
                          style={{
                            width: printProfile.maxQrSizePx,
                            height: printProfile.maxQrSizePx,
                          }}
                        />
                        {bottomImageDescription ? (
                          <div className="thermal-receipt-qr-desc">{bottomImageDescription}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Wifi info */}
                    {printWifiEnabled && (wifiName || wifiPassword) ? (
                      <div className="thermal-receipt-wifi">
                        <WifiOutlined /> Wifi: <strong>{wifiName || 'Store_Wifi'}</strong>
                        {wifiPassword ? ` - Pass: ${wifiPassword}` : ''}
                      </div>
                    ) : null}

                    {/* Footer lines */}
                    {footerLine1 ? (
                      <div
                        className="thermal-receipt-footer-text"
                        style={{ fontWeight: footerLine1Bold ? 700 : 400 }}
                      >
                        {footerLine1}
                      </div>
                    ) : null}

                    {footerLine2 ? (
                      <div
                        className="thermal-receipt-footer-text"
                        style={{ fontWeight: footerLine2Bold ? 700 : 400 }}
                      >
                        {footerLine2}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
          <div className="owner-form-actions owner-sticky-form-bar" style={{ marginTop: 24 }}>
            <div className="owner-sticky-form-bar__left">
              {isDirty ? (
                <div className="owner-print-unsaved-text">
                  <span className="owner-print-unsaved-dot">●</span> Có thao tác chỉnh sửa chưa lưu
                </div>
              ) : null}
            </div>
            <div className="owner-sticky-form-bar__right">
              <Button size="large" onClick={handleCancel}>
                Hủy
              </Button>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
              >
                Lưu thiết lập in
              </Button>
            </div>
          </div>
        </Form>
      ) : (
        /* Tab 2: Cấu hình máy in & thiết bị */
        <div className="owner-printer-devices-container">
          {/* Card 1: MÁY IN & THIẾT BỊ / Thiết bị hiện tại & QZ Tray */}
          <Card
            title="MÁY IN & THIẾT BỊ"
            bordered={false}
            className="owner-print-card"
            style={{ marginBottom: 20 }}
          >
            <Row gutter={[24, 24]} align="middle">
              <Col xs={24} md={12}>
                <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>
                  Thiết bị hiện tại
                </div>
                <Typography.Title level={4} style={{ margin: 0, color: '#1e293b' }}>
                  {getClientDeviceName()}
                </Typography.Title>
              </Col>
              <Col xs={24} md={12}>
                <div className="qz-tray-status-box">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>QZ Tray</div>
                    {qzStatus.connected ? (
                      <span className="qz-badge qz-badge--connected">
                        <span className="qz-badge-dot">●</span> Đã kết nối
                      </span>
                    ) : (
                      <span className="qz-badge qz-badge--disconnected">
                        <span className="qz-badge-dot">○</span> Chưa kết nối
                      </span>
                    )}
                  </div>

                  {qzStatus.connected ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#64748b' }}>
                        Phiên bản: <strong>{qzStatus.version || '2.2.x'}</strong>
                      </span>
                      <Button size="small" onClick={handleConnectQzTray} loading={qzStatus.loading}>
                        Kết nối lại
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 12px' }}>
                        Để in trực tiếp không cần hộp thoại, hãy cài QZ Tray trên máy này.
                      </p>
                      <Space>
                        <Button
                          type="default"
                          href="https://qz.io/download/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Tải QZ Tray
                        </Button>
                        <Button
                          type="primary"
                          onClick={handleConnectQzTray}
                          loading={qzStatus.loading}
                        >
                          Thử kết nối
                        </Button>
                      </Space>
                    </div>
                  )}
                </div>
              </Col>
            </Row>
          </Card>

          {/* Card 2: MÁY IN HÓA ĐƠN */}
          <Card title="MÁY IN HÓA ĐƠN" bordered={false} className="owner-print-card">
            <Form
              form={printerForm}
              layout="vertical"
              initialValues={defaultPrinterDeviceConfig}
              onFinish={handleSavePrinterConfig}
            >
              <Row gutter={[24, 16]}>
                {/* Chế độ / Kiểu kết nối */}
                <Col xs={24}>
                  <Form.Item
                    name="connectionType"
                    label={<span style={{ fontWeight: 600 }}>Chế độ / Kiểu kết nối</span>}
                  >
                    <Radio.Group>
                      <Space direction="horizontal" size={24}>
                        <Radio value="SYSTEM">Máy in hệ thống</Radio>
                        <Radio value="NETWORK_TCP">LAN / TCP (Máy in mạng TCP/IP)</Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </Col>

                {/* System Printer Dropdown */}
                {printerConnectionType === 'SYSTEM' ? (
                  <Col xs={24} md={16}>
                    <Form.Item
                      name="printerName"
                      label={<span style={{ fontWeight: 600 }}>Máy in</span>}
                      extra={
                        systemPrinters.length === 0
                          ? 'Chưa tìm thấy máy in. Hãy kết nối QZ Tray để tự động nhận diện danh sách máy in trên máy tính.'
                          : `Tìm thấy ${systemPrinters.length} máy in từ hệ thống.`
                      }
                    >
                      <Select
                        placeholder="-- Chọn máy in hệ thống --"
                        size="large"
                        loading={fetchingPrinters}
                        options={systemPrinters.map((p) => ({ value: p, label: p }))}
                        suffixIcon={
                          <Button
                            type="link"
                            size="small"
                            style={{ padding: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFetchPrinters();
                            }}
                          >
                            Làm mới
                          </Button>
                        }
                      />
                    </Form.Item>
                  </Col>
                ) : (
                  <>
                    <Col xs={24} md={10}>
                      <Form.Item
                        name="networkIp"
                        label={<span style={{ fontWeight: 600 }}>IP máy in</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập IP máy in mạng' }]}
                      >
                        <Input placeholder="192.168.1.150" size="large" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                      <Form.Item
                        name="networkPort"
                        label={<span style={{ fontWeight: 600 }}>Port</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập Port' }]}
                      >
                        <InputNumber
                          placeholder="9100"
                          style={{ width: '100%' }}
                          size="large"
                          min={1}
                          max={65535}
                        />
                      </Form.Item>
                    </Col>
                    <Col
                      xs={24}
                      md={8}
                      style={{ display: 'flex', alignItems: 'center', paddingTop: 8 }}
                    >
                      <Button onClick={handleCheckNetworkConnection} loading={checkingConnection}>
                        Kiểm tra kết nối
                      </Button>
                    </Col>
                  </>
                )}

                {/* Khổ giấy */}
                <Col xs={24}>
                  <Form.Item
                    name="paperSize"
                    label={<span style={{ fontWeight: 600 }}>Khổ giấy</span>}
                  >
                    <Radio.Group onChange={(e) => setPreviewPaperSize(e.target.value)}>
                      <Space size={24}>
                        <Radio value="K80">80mm (K80 - Vùng in chuẩn 72mm / 576 dots)</Radio>
                        <Radio value="K58">58mm (K58 - Vùng in chuẩn 52.5mm / 420 dots)</Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </Col>

                {/* Vùng in thực tế / Calibration Dots */}
                <Col xs={24} md={12}>
                  <Form.Item
                    name="printableDots"
                    label={
                      <span style={{ fontWeight: 600 }}>
                        Số dot in thực tế (Printable Dots Calibration)
                      </span>
                    }
                    extra="Tùy chọn: Để trống để dùng chuẩn mặc định (K80: 576 dots, K58: 420 dots). Tùy chỉnh nếu model máy in nhiệt của bạn có thông số vùng in khác."
                  >
                    <InputNumber
                      placeholder={printerPaperSize === 'K58' ? '420' : '576'}
                      min={200}
                      max={1200}
                      style={{ width: '100%' }}
                      size="large"
                    />
                  </Form.Item>
                </Col>

                {/* Tùy chọn in nhiệt */}
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="autoCut"
                    valuePropName="checked"
                    label={<span style={{ fontWeight: 600 }}>Tự động cắt giấy</span>}
                  >
                    <Switch checkedChildren="BẬT" unCheckedChildren="TẮT" />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="openCashDrawer"
                    valuePropName="checked"
                    label={<span style={{ fontWeight: 600 }}>Mở két tiền sau thanh toán</span>}
                  >
                    <Switch checkedChildren="BẬT" unCheckedChildren="TẮT" />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Divider style={{ margin: '12px 0 20px' }} />
                  <Space size={14} wrap>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SaveOutlined />}
                      loading={savingPrinter}
                      size="large"
                    >
                      Lưu cấu hình máy in
                    </Button>
                    <Button
                      icon={<PrinterOutlined />}
                      onClick={handleTestPrint}
                      loading={testingPrint}
                      size="large"
                    >
                      In thử hóa đơn
                    </Button>
                    <Button
                      icon={<CheckCircleOutlined />}
                      onClick={handleCalibrationTest}
                      loading={testingPrint}
                      size="large"
                    >
                      In hiệu chuẩn (Calibration)
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Form>
          </Card>
        </div>
      )}
    </div>
  );
}
