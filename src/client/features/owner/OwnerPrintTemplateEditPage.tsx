import { SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Radio,
  Row,
  Select,
  Skeleton,
  Space,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import {
  type PrintTemplateDisplayConfig,
  type PrintTemplateSettingsMap,
  type StorePrintSettings,
  defaultPrintTemplateConfigFor,
  parsePrintTemplateConfigs,
} from '@contracts/store';
import { ApiError, apiRequest, jsonRequest } from '@client/lib/api';
import { ReceiptPreviewPaper } from '@client/features/pos/ReceiptPreviewModal';
import { ThermalHourlySegmentsPreview } from '@client/components/ThermalHourlySegmentsPreview';
import { buildOwnerPrintPreviewSample } from './print-preview-sample';

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

const PRINT_SETTINGS_QUERY = ['owner-print-settings'];

export function OwnerPrintTemplateEditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<PrintTemplateDisplayConfig>();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Top selector bar
  const [previewInvoiceType, setPreviewInvoiceType] = useState<'PROVISIONAL' | 'PAYMENT'>(
    'PAYMENT',
  );
  const [previewPaperSize, setPreviewPaperSize] = useState<'K80' | 'K58'>('K80');

  // Multi-template configs state
  const [templateConfigs, setTemplateConfigs] = useState<PrintTemplateSettingsMap>(() =>
    parsePrintTemplateConfigs(null),
  );

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
  const activeDefaultTemplate = defaultPrintTemplateConfigFor(previewInvoiceType);

  // Watch form fields for live receipt preview
  const showLogo = Form.useWatch('showLogo', form) ?? activeDefaultTemplate.showLogo;
  const showTableAreaName =
    Form.useWatch('showTableAreaName', form) ?? activeDefaultTemplate.showTableAreaName;
  const showCashierName =
    Form.useWatch('showCashierName', form) ?? activeDefaultTemplate.showCashierName;
  const showCheckInTime =
    Form.useWatch('showCheckInTime', form) ?? activeDefaultTemplate.showCheckInTime;
  const showCustomerPhone =
    Form.useWatch('showCustomerPhone', form) ?? activeDefaultTemplate.showCustomerPhone;
  const showCustomerAddress =
    Form.useWatch('showCustomerAddress', form) ?? activeDefaultTemplate.showCustomerAddress;
  const showOrderNote = Form.useWatch('showOrderNote', form) ?? activeDefaultTemplate.showOrderNote;

  const itemFontSize = Form.useWatch('itemFontSize', form) ?? activeDefaultTemplate.itemFontSize;
  const showItemTableBorder =
    Form.useWatch('showItemTableBorder', form) ?? activeDefaultTemplate.showItemTableBorder;
  const showItemIndex = Form.useWatch('showItemIndex', form) ?? activeDefaultTemplate.showItemIndex;
  const showItemNote = Form.useWatch('showItemNote', form) ?? activeDefaultTemplate.showItemNote;
  const showItemDiscounts =
    Form.useWatch('showItemDiscounts', form) ?? activeDefaultTemplate.showItemDiscounts;

  const showHourlyDetail =
    Form.useWatch('showHourlyDetail', form) ?? activeDefaultTemplate.showHourlyDetail;
  const hourlyDetailMode =
    Form.useWatch('hourlyDetailMode', form) ?? activeDefaultTemplate.hourlyDetailMode;
  const showHourlyUnitPrice =
    Form.useWatch('showHourlyUnitPrice', form) ?? activeDefaultTemplate.showHourlyUnitPrice;
  const showHourlyUnitDuration =
    Form.useWatch('showHourlyUnitDuration', form) ?? activeDefaultTemplate.showHourlyUnitDuration;
  const showHourlyTimeWithSeconds =
    Form.useWatch('showHourlyTimeWithSeconds', form) ??
    activeDefaultTemplate.showHourlyTimeWithSeconds;

  const showItemPriceName =
    Form.useWatch('showItemPriceName', form) ?? activeDefaultTemplate.showItemPriceName;
  const showItemUnitPrice =
    Form.useWatch('showItemUnitPrice', form) ?? activeDefaultTemplate.showItemUnitPrice;
  const itemUnitPricePlacement =
    Form.useWatch('itemUnitPricePlacement', form) ?? activeDefaultTemplate.itemUnitPricePlacement;
  const hideZeroPriceItems =
    Form.useWatch('hideZeroPriceItems', form) ?? activeDefaultTemplate.hideZeroPriceItems;

  const combineGoodsAndServiceTotal =
    Form.useWatch('combineGoodsAndServiceTotal', form) ??
    activeDefaultTemplate.combineGoodsAndServiceTotal;
  const showPromotionsList =
    Form.useWatch('showPromotionsList', form) ?? activeDefaultTemplate.showPromotionsList;
  const showProvisionalTotal =
    Form.useWatch('showProvisionalTotal', form) ?? activeDefaultTemplate.showProvisionalTotal;
  const showBottomImage =
    Form.useWatch('showBottomImage', form) ?? activeDefaultTemplate.showBottomImage;
  const isPaymentTemplate = previewInvoiceType === 'PAYMENT';
  const bottomImageIsVietQr = printSettings.data?.bottomImageType === 'VIETQR';

  // Initialize form values from DB
  useEffect(() => {
    if (!printSettings.data) return;
    const configs = parsePrintTemplateConfigs(printSettings.data.templateConfigJson);
    setTemplateConfigs(configs);
    form.resetFields();
    form.setFieldsValue(configs[previewInvoiceType]);
    if (printSettings.data.paperSize) {
      setPreviewPaperSize(printSettings.data.paperSize);
    }
    setIsDirty(false);
  }, [printSettings.data]); // only run when data from server arrives

  // Switch invoice type handler
  const handleSwitchInvoiceType = (newType: 'PROVISIONAL' | 'PAYMENT') => {
    if (newType === previewInvoiceType) return;
    const currentValues = form.getFieldsValue(true);
    const updatedMap: PrintTemplateSettingsMap = {
      ...templateConfigs,
      [previewInvoiceType]: {
        ...templateConfigs[previewInvoiceType],
        ...currentValues,
      },
    };
    setTemplateConfigs(updatedMap);
    form.resetFields();
    form.setFieldsValue(updatedMap[newType]);
    setPreviewInvoiceType(newType);
  };

  // Form value change handler
  const handleFormValuesChange = (
    _changed: Partial<PrintTemplateDisplayConfig>,
    allValues: PrintTemplateDisplayConfig,
  ) => {
    setIsDirty(true);
    setTemplateConfigs((prev) => ({
      ...prev,
      [previewInvoiceType]: {
        ...prev[previewInvoiceType],
        ...allValues,
      },
    }));
  };

  // Cancel handler
  const handleCancel = () => {
    if (!isDirty) {
      navigate('/owner/settings/printing');
      return;
    }
    const configs = parsePrintTemplateConfigs(printSettings.data?.templateConfigJson);
    setTemplateConfigs(configs);
    form.resetFields();
    form.setFieldsValue(configs[previewInvoiceType]);
    setIsDirty(false);
    messageApi.info('Đã hủy các thay đổi chưa lưu.');
  };

  // Save handler
  const handleSave = async (values: PrintTemplateDisplayConfig) => {
    if (!printSettings.data) return;
    setSaving(true);
    try {
      const updatedMap: PrintTemplateSettingsMap = {
        ...templateConfigs,
        [previewInvoiceType]: {
          ...templateConfigs[previewInvoiceType],
          ...values,
        },
      };
      const payload: StorePrintSettings = {
        ...printSettings.data,
        paperSize: previewPaperSize,
        templateConfigJson: JSON.stringify(updatedMap),
      };
      await jsonRequest('/api/v1/owner/store/print-settings', payload, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': authContext.data?.csrfToken ?? '' },
      });
      setTemplateConfigs(updatedMap);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PRINT_SETTINGS_QUERY }),
        queryClient.invalidateQueries({ queryKey: ['pos-print-settings'] }),
      ]);
      setIsDirty(false);
      messageApi.success(
        `Đã lưu cấu hình ${previewInvoiceType === 'PROVISIONAL' ? 'hóa đơn tạm tính' : 'hóa đơn thanh toán'}.`,
      );
    } catch (error) {
      messageApi.error(errorMessage(error, 'Không thể lưu mẫu in.'));
    } finally {
      setSaving(false);
    }
  };

  // Computed display values for receipt preview
  const previewStoreName = storeSettings.data?.name || 'Vanhau1410rr';
  const previewPhone = storeSettings.data?.phone || '0777464347';
  const previewAddress = useMemo(() => {
    if (printSettings.data?.customAddressEnabled && printSettings.data?.customAddress?.trim()) {
      return printSettings.data.customAddress.trim();
    }
    return (
      storeSettings.data?.address ||
      'Số 55 610B thôn Hà An, xã Gò Nổi, Thành Phố Đà Nẵng, Xã Gò Nổi, Đà Nẵng'
    );
  }, [printSettings.data, storeSettings.data]);

  const previewLogoUrl = useMemo(() => {
    if (!showLogo) return null;
    if (printSettings.data?.logoMediaId) {
      return `/api/v1/media/${printSettings.data.logoMediaId}`;
    }
    return null;
  }, [showLogo, printSettings.data?.logoMediaId]);

  const previewBottomQrUrl = useMemo(() => {
    if (!showBottomImage) return null;
    const settings = printSettings.data;
    if (!settings) return null;
    if (settings.bottomImageType === 'VIETQR') {
      if (settings.bottomBankName && settings.bottomBankAccountNumber) {
        const accountName = settings.bottomBankAccountName?.trim();
        return `https://img.vietqr.io/image/${encodeURIComponent(settings.bottomBankName.trim())}-${encodeURIComponent(
          settings.bottomBankAccountNumber.trim(),
        )}-qr_only.png${accountName ? `?accountName=${encodeURIComponent(accountName)}` : ''}`;
      }
    } else if (settings.bottomImageType === 'UPLOAD' && settings.bottomImageMediaId) {
      return `/api/v1/media/${settings.bottomImageMediaId}`;
    }
    return null;
  }, [showBottomImage, printSettings.data]);

  if (printSettings.isLoading) {
    return (
      <div className="owner-print-settings-page">
        <Skeleton active paragraph={{ rows: 14 }} />
      </div>
    );
  }

  const liveTemplateConfigs: PrintTemplateSettingsMap = {
    ...templateConfigs,
    [previewInvoiceType]: {
      ...templateConfigs[previewInvoiceType],
      ...form.getFieldsValue(true),
    },
  };
  const livePreviewSettings = {
    ...printSettings.data,
    storeId: printSettings.data?.storeId ?? '',
    updatedAt: printSettings.data?.updatedAt ?? Date.now(),
    paperSize: previewPaperSize,
    templateConfigJson: JSON.stringify(liveTemplateConfigs),
  } as StorePrintSettings;
  const previewReceiptData = buildOwnerPrintPreviewSample(previewInvoiceType);

  return (
    <div className="owner-print-settings-page">
      {contextHolder}

      {/* Sticky Header with Back link, Title, Unsaved badge & Actions */}
      <div className="owner-print-settings-header">
        <div>
          <Link to="/owner/settings/printing" className="owner-print-settings-backlink">
            ‹ Quay lại thiết lập in
          </Link>
          <Typography.Title level={2} style={{ margin: '2px 0 0', fontSize: 21 }}>
            Chỉnh sửa thông tin hiển thị mẫu in
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Lưu ý: Nếu không chọn được thông tin hiển thị trên mẫu in, bạn vui lòng thiết lập thông
            tin đầy đủ để chọn lại
          </Typography.Text>
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
              form="print-template-edit-form"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
            >
              Lưu {previewInvoiceType === 'PROVISIONAL' ? 'mẫu tạm tính' : 'mẫu thanh toán'}
            </Button>
          </Space>
        </div>
      </div>

      {/* Top Selector Bar: Invoice Type & Paper Size */}
      <Card
        bordered={false}
        className="owner-print-card owner-print-template-scope-bar"
        style={{ marginBottom: 20 }}
        styles={{ body: { padding: '14px 20px' } }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <Typography.Text strong>Loại hóa đơn đang cấu hình</Typography.Text>
            <Select
              size="middle"
              style={{ width: '100%' }}
              value={previewInvoiceType}
              onChange={handleSwitchInvoiceType}
              options={[
                { value: 'PAYMENT', label: 'Hóa đơn thanh toán' },
                { value: 'PROVISIONAL', label: 'Hóa đơn tạm tính' },
              ]}
            />
          </Col>
          <Col xs={24} sm={12}>
            <Typography.Text strong>Khổ giấy xem trước</Typography.Text>
            <Select
              size="middle"
              style={{ width: '100%' }}
              value={previewPaperSize}
              onChange={(val) => {
                setPreviewPaperSize(val);
                setIsDirty(true);
              }}
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
          </Col>
        </Row>
      </Card>

      <Form
        id="print-template-edit-form"
        form={form}
        layout="vertical"
        onValuesChange={handleFormValuesChange}
        onFinish={handleSave}
      >
        <Row gutter={[24, 24]}>
          {/* Left Column: 6 Configuration Groups */}
          <Col xs={24} lg={13} xl={14}>
            <Space direction="vertical" size={20} style={{ width: '100%' }}>
              {/* ── Nhóm 1: Thông tin chung ── */}
              <Card title="Thông tin chung" bordered={false} className="owner-print-card">
                <Form.Item name="showLogo" valuePropName="checked" noStyle>
                  <Checkbox>Hiển thị logo</Checkbox>
                </Form.Item>
              </Card>

              {/* ── Nhóm 2: Thông tin đơn hàng ── */}
              <Card title="Thông tin đơn hàng" bordered={false} className="owner-print-card">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Form.Item name="showTableAreaName" valuePropName="checked" noStyle>
                    <Checkbox>Tên khu vực bàn</Checkbox>
                  </Form.Item>
                  <Form.Item name="showCashierName" valuePropName="checked" noStyle>
                    <Checkbox>Tên thu ngân</Checkbox>
                  </Form.Item>
                  <Form.Item name="showCheckInTime" valuePropName="checked" noStyle>
                    <Checkbox>Giờ vào</Checkbox>
                  </Form.Item>
                  <Form.Item name="showCustomerName" valuePropName="checked" noStyle>
                    <Checkbox>Tên khách hàng</Checkbox>
                  </Form.Item>
                  <Form.Item name="showCustomerPhone" valuePropName="checked" noStyle>
                    <Checkbox>Số điện thoại khách hàng</Checkbox>
                  </Form.Item>
                  <Form.Item name="showCustomerAddress" valuePropName="checked" noStyle>
                    <Checkbox>Địa chỉ khách hàng</Checkbox>
                  </Form.Item>
                  <Form.Item name="showOrderNote" valuePropName="checked" noStyle>
                    <Checkbox>Ghi chú hóa đơn</Checkbox>
                  </Form.Item>
                </Space>
              </Card>

              {/* ── Nhóm 3: Thông tin mặt hàng ── */}
              <Card title="Thông tin mặt hàng" bordered={false} className="owner-print-card">
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, color: '#334155', marginBottom: 8 }}>Cỡ chữ</div>
                  <Form.Item name="itemFontSize" noStyle>
                    <Radio.Group>
                      <Space size={32}>
                        <Radio value="SMALL">Nhỏ</Radio>
                        <Radio value="MEDIUM">Vừa</Radio>
                        <Radio value="LARGE">Lớn</Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </div>
                <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
                  <Form.Item name="showItemTableBorder" valuePropName="checked" noStyle>
                    <Checkbox>Khung danh sách mặt hàng</Checkbox>
                  </Form.Item>
                  <Form.Item name="showItemIndex" valuePropName="checked" noStyle>
                    <Checkbox>Số thứ tự mặt hàng</Checkbox>
                  </Form.Item>
                  <Form.Item name="showItemNote" valuePropName="checked" noStyle>
                    <Checkbox>Ghi chú theo mặt hàng/ dịch vụ</Checkbox>
                  </Form.Item>
                  <Form.Item name="showItemDiscounts" valuePropName="checked" noStyle>
                    <Checkbox>Chi tiết giảm giá thủ công và lý do theo mặt hàng</Checkbox>
                  </Form.Item>
                </Space>
              </Card>

              {/* ── Nhóm 4: Thông tin giờ ── */}
              <Card title="Thông tin giờ" bordered={false} className="owner-print-card">
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Form.Item name="showHourlyDetail" valuePropName="checked" noStyle>
                    <Checkbox>Hiển thị thông tin chi tiết</Checkbox>
                  </Form.Item>

                  {showHourlyDetail && (
                    <div style={{ paddingLeft: 24, marginTop: -4 }}>
                      <Form.Item name="hourlyDetailMode" noStyle>
                        <Radio.Group style={{ width: '100%' }}>
                          <Space direction="vertical" size={8}>
                            <Radio value="FULL_TIMELOG">
                              Hiển thị đầy đủ thông tin từng khung giờ sử dụng
                            </Radio>
                            <Radio value="TOTAL_ONLY">Chỉ hiển thị tổng thời gian sử dụng</Radio>
                          </Space>
                        </Radio.Group>
                      </Form.Item>
                    </div>
                  )}

                  <Form.Item name="showHourlyUnitPrice" valuePropName="checked" noStyle>
                    <Checkbox>Hiển thị đơn giá</Checkbox>
                  </Form.Item>

                  <Form.Item name="showHourlyUnitDuration" valuePropName="checked" noStyle>
                    <Checkbox>Hiển thị đơn vị thời gian của đơn giá</Checkbox>
                  </Form.Item>

                  <Form.Item name="showHourlyTimeWithSeconds" valuePropName="checked" noStyle>
                    <Checkbox>Hiển thị thời gian đến đơn vị giây</Checkbox>
                  </Form.Item>
                </Space>
              </Card>

              {/* ── Nhóm 5: Mặt hàng ── */}
              <Card title="Mặt hàng" bordered={false} className="owner-print-card">
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Form.Item name="showItemPriceName" valuePropName="checked" noStyle>
                    <Checkbox>Tên giá mặt hàng</Checkbox>
                  </Form.Item>

                  <div>
                    <Form.Item name="showItemUnitPrice" valuePropName="checked" noStyle>
                      <Checkbox>Hiển thị đơn giá</Checkbox>
                    </Form.Item>
                    {showItemUnitPrice && (
                      <div style={{ paddingLeft: 24, marginTop: 8 }}>
                        <Form.Item name="itemUnitPricePlacement" noStyle>
                          <Radio.Group style={{ width: '100%' }}>
                            <Space direction="vertical" size={8}>
                              <Radio value="INLINE">Hiển thị đơn giá cùng tên mặt hàng</Radio>
                              <Radio value="SEPARATE_COLUMN" disabled={previewPaperSize === 'K58'}>
                                Hiển thị riêng cột đơn giá
                              </Radio>
                            </Space>
                          </Radio.Group>
                        </Form.Item>
                        <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 12.5 }}>
                          Lưu ý: Khổ giấy 58mm không hỗ trợ tách riêng cột đơn giá
                        </p>
                      </div>
                    )}
                  </div>

                  <Form.Item name="hideZeroPriceItems" valuePropName="checked" noStyle>
                    <Checkbox>Không in mặt hàng được thiết lập giá 0đ</Checkbox>
                  </Form.Item>
                </Space>
              </Card>

              {/* ── Nhóm 6: Thông tin thanh toán ── */}
              <Card
                title={isPaymentTemplate ? 'Thông tin thanh toán' : 'Thông tin tổng tiền'}
                bordered={false}
                className="owner-print-card"
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Form.Item name="combineGoodsAndServiceTotal" valuePropName="checked" noStyle>
                    <Checkbox>Tính tổng Tiền hàng và Tiền dịch vụ</Checkbox>
                  </Form.Item>
                  <Form.Item name="showPromotionsList" valuePropName="checked" noStyle>
                    <Checkbox>Chi tiết chương trình khuyến mại (tên và số tiền giảm)</Checkbox>
                  </Form.Item>
                  <Form.Item name="showProvisionalTotal" valuePropName="checked" noStyle>
                    <Checkbox>Thông tin tổng tiền tạm tính</Checkbox>
                  </Form.Item>
                  {isPaymentTemplate ? (
                    <>
                      <Form.Item name="showPaymentMethod" valuePropName="checked" noStyle>
                        <Checkbox>Phương thức và phân bổ thanh toán</Checkbox>
                      </Form.Item>
                      <Form.Item name="showCashDetails" valuePropName="checked" noStyle>
                        <Checkbox>Tiền khách đưa và tiền thừa</Checkbox>
                      </Form.Item>
                    </>
                  ) : null}
                  {!bottomImageIsVietQr || isPaymentTemplate ? (
                    <Form.Item name="showBottomImage" valuePropName="checked" noStyle>
                      <Checkbox>
                        {bottomImageIsVietQr
                          ? 'Hiển thị VietQR tài khoản cố định'
                          : 'Hiển thị ảnh cuối hóa đơn'}
                      </Checkbox>
                    </Form.Item>
                  ) : (
                    <Typography.Text type="secondary">
                      VietQR không hiển thị trên hóa đơn tạm tính vì bàn vẫn chạy giờ và tổng tiền
                      chưa được chốt.
                    </Typography.Text>
                  )}
                </Space>
              </Card>
            </Space>
          </Col>

          {/* Right Column: Live Thermal Receipt Preview */}
          <Col xs={24} lg={11} xl={10}>
            <Card
              title="Xem trước mẫu in"
              bordered={false}
              className="owner-print-card owner-print-preview-card"
            >
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
              <div
                className={`thermal-receipt-preview thermal-receipt-preview--${previewPaperSize.toLowerCase()}`}
                style={{ display: 'none' }}
              >
                <div className="thermal-receipt-inner">
                  {/* Header: Logo & Store info */}
                  {previewLogoUrl && (
                    <div className="thermal-receipt-logo-centered">
                      <img src={previewLogoUrl} alt="Store logo" />
                    </div>
                  )}

                  <div className="thermal-receipt-header-vertical">
                    <div className="thermal-receipt-store-name">{previewStoreName}</div>
                    <div className="thermal-receipt-store-address">{previewAddress}</div>
                    <div className="thermal-receipt-store-phone">SĐT: {previewPhone}</div>
                  </div>

                  {/* Title */}
                  <div className="thermal-receipt-title">
                    {previewInvoiceType === 'PROVISIONAL'
                      ? 'HÓA ĐƠN TẠM TÍNH'
                      : 'HÓA ĐƠN THANH TOÁN'}
                  </div>
                  <div className="thermal-receipt-copy-count">Liên 1/3</div>

                  <div className="thermal-receipt-divider-dash" />

                  {/* Order Metadata */}
                  <div className="thermal-receipt-meta">
                    {showTableAreaName && (
                      <div className="thermal-receipt-row">
                        <span className="thermal-receipt-label">Tại bàn</span>
                        <span className="thermal-receipt-value">Khu vực 1 - bàn 1 (+3)</span>
                      </div>
                    )}
                    <div className="thermal-receipt-row">
                      {showCheckInTime && <span>Giờ vào: 08:00 25/12/2022</span>}
                      <span>Giờ in: 08:08</span>
                    </div>
                    {showCashierName && (
                      <div className="thermal-receipt-row">
                        <span className="thermal-receipt-label">Thu ngân</span>
                        <span className="thermal-receipt-value">Nguyễn Văn A</span>
                      </div>
                    )}

                    {(showCustomerPhone || showCustomerAddress || showOrderNote) && (
                      <div className="thermal-receipt-divider-dash" />
                    )}

                    <div className="thermal-receipt-row">
                      <span className="thermal-receipt-label">Khách hàng</span>
                      <span className="thermal-receipt-value">Nguyễn Nhật Quang Minh</span>
                    </div>
                    {showCustomerPhone && (
                      <div className="thermal-receipt-row">
                        <span className="thermal-receipt-label">Điện thoại</span>
                        <span className="thermal-receipt-value">0966 690 040</span>
                      </div>
                    )}
                    {showCustomerAddress && (
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
                          266 Đội Cấn, P. Liễu Giai, Q. Ba Đình, Hà Nội
                        </span>
                      </div>
                    )}
                    {showOrderNote && (
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

                  {/* Hourly Services Table */}
                  <div
                    className="thermal-receipt-items"
                    style={{
                      fontSize:
                        previewPaperSize === 'K58'
                          ? itemFontSize === 'SMALL'
                            ? '8px'
                            : itemFontSize === 'LARGE'
                              ? '10px'
                              : '8.5px'
                          : itemFontSize === 'SMALL'
                            ? '9.5px'
                            : itemFontSize === 'LARGE'
                              ? '12px'
                              : '10.5px',
                    }}
                  >
                    <div className="thermal-receipt-table-header">
                      <span style={{ flex: 1 }}>Thông tin giờ</span>
                      {previewPaperSize === 'K80' && showHourlyUnitPrice && (
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
                        {!showHourlyDetail || hourlyDetailMode === 'TOTAL_ONLY' ? (
                          <>
                            {previewPaperSize === 'K80' && showHourlyUnitPrice && (
                              <span style={{ width: 65, textAlign: 'right' }}>
                                60,000{showHourlyUnitDuration ? '/1h' : ''}
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

                      {!showHourlyDetail || hourlyDetailMode === 'TOTAL_ONLY' ? (
                        <>
                          {previewPaperSize === 'K58' && showHourlyUnitPrice && (
                            <div className="thermal-receipt-item-sub">
                              Đ.Giá: 60,000{showHourlyUnitDuration ? '/1h' : ''}
                            </div>
                          )}
                          {showHourlyDetail && (
                            <div className="thermal-receipt-item-sub" style={{ color: '#64748b' }}>
                              = 2 giờ 30 phút
                            </div>
                          )}
                        </>
                      ) : (
                        <ThermalHourlySegmentsPreview
                          paperSize={previewPaperSize}
                          showUnitPrice={showHourlyUnitPrice}
                          showUnitDuration={showHourlyUnitDuration}
                          showSeconds={showHourlyTimeWithSeconds}
                        />
                      )}
                    </div>
                  </div>

                  <div className="thermal-receipt-divider-dash" />

                  {/* Products Table */}
                  <div
                    className={`thermal-receipt-items ${showItemTableBorder ? 'thermal-receipt-items--bordered' : ''}`}
                    style={{
                      fontSize:
                        previewPaperSize === 'K58'
                          ? itemFontSize === 'SMALL'
                            ? '8px'
                            : itemFontSize === 'LARGE'
                              ? '10px'
                              : '8.5px'
                          : itemFontSize === 'SMALL'
                            ? '9.5px'
                            : itemFontSize === 'LARGE'
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
                        showItemUnitPrice &&
                        itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                          <span style={{ width: 60, textAlign: 'right' }}>Đ.Giá</span>
                        )}
                      <span
                        style={{
                          width: previewPaperSize === 'K58' ? 48 : 60,
                          textAlign: 'right',
                        }}
                      >
                        T.Tiền
                      </span>
                    </div>

                    {/* Item 1 */}
                    <div className="thermal-receipt-item-row">
                      <div className="thermal-receipt-item-main">
                        <span style={{ flex: 1, fontWeight: 600 }}>
                          {showItemIndex ? '1. ' : ''}Trà sữa Ô long
                          {showItemPriceName ? ' (Size L)' : ''}
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
                          showItemUnitPrice &&
                          itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                            <span style={{ width: 60, textAlign: 'right' }}>65,000</span>
                          )}
                        <span
                          style={{
                            width: previewPaperSize === 'K58' ? 55 : 60,
                            textAlign: 'right',
                            fontWeight: 600,
                          }}
                        >
                          65,000
                        </span>
                      </div>
                      {showItemUnitPrice &&
                        (itemUnitPricePlacement === 'INLINE' || previewPaperSize === 'K58') && (
                          <div className="thermal-receipt-item-sub">Đơn giá: 65,000</div>
                        )}
                      {showItemNote && (
                        <div className="thermal-receipt-item-sub" style={{ fontStyle: 'italic' }}>
                          * Chú ý: Không lấy ống hút
                        </div>
                      )}
                      {showItemDiscounts && (
                        <div className="thermal-receipt-item-sub" style={{ color: '#d4380d' }}>
                          * Giảm thủ công: -10,000 · Lý do: Khách thân thiết
                        </div>
                      )}
                    </div>

                    {/* Item 2 */}
                    <div className="thermal-receipt-item-row">
                      <div className="thermal-receipt-item-main">
                        <span style={{ flex: 1, fontWeight: 600 }}>
                          {showItemIndex ? '2. ' : ''}Cơm gà chua ngọt
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
                          showItemUnitPrice &&
                          itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                            <span style={{ width: 60, textAlign: 'right' }}>60,000</span>
                          )}
                        <span
                          style={{
                            width: previewPaperSize === 'K58' ? 55 : 60,
                            textAlign: 'right',
                            fontWeight: 600,
                          }}
                        >
                          60,000
                        </span>
                      </div>
                    </div>

                    {/* Item 3 (0d promo) */}
                    {!hideZeroPriceItems && (
                      <div className="thermal-receipt-item-row">
                        <div className="thermal-receipt-item-main">
                          <span style={{ flex: 1, fontWeight: 600 }}>
                            {showItemIndex ? '3. ' : ''}Khăn lạnh (tặng kèm)
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
                            showItemUnitPrice &&
                            itemUnitPricePlacement === 'SEPARATE_COLUMN' && (
                              <span style={{ width: 60, textAlign: 'right' }}>0</span>
                            )}
                          <span
                            style={{
                              width: previewPaperSize === 'K58' ? 55 : 60,
                              textAlign: 'right',
                            }}
                          >
                            0
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="thermal-receipt-divider-dash" />

                  {/* Summary */}
                  <div className="thermal-receipt-summary">
                    <div className="thermal-receipt-row">
                      <span>Tiền giờ (1)</span>
                      <span>48,000</span>
                    </div>
                    <div className="thermal-receipt-row">
                      <span>Tiền hàng (2)</span>
                      <span>125,000</span>
                    </div>
                    {combineGoodsAndServiceTotal && (
                      <div className="thermal-receipt-row" style={{ fontWeight: 600 }}>
                        <span>Tổng tiền hàng & dịch vụ</span>
                        <span>173,000</span>
                      </div>
                    )}
                    {showPromotionsList && (
                      <div
                        className="thermal-receipt-row"
                        style={{ color: '#64748b', fontSize: 10.5 }}
                      >
                        <span>KM: Giảm giá khai trương [10%]</span>
                        <span>-10,000</span>
                      </div>
                    )}

                    {showProvisionalTotal && (
                      <div className="thermal-receipt-grand-total">
                        <span>
                          {previewInvoiceType === 'PROVISIONAL' ? 'TỔNG TẠM TÍNH' : 'TỔNG CỘNG'}
                        </span>
                        <span className="thermal-receipt-grand-total-amount">163,000đ</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom QR image */}
                  {previewBottomQrUrl && (
                    <div className="thermal-receipt-bottom-qr-container">
                      <img
                        src={previewBottomQrUrl}
                        alt="Payment QR"
                        className="thermal-receipt-bottom-qr-img"
                      />
                      <div className="thermal-receipt-qr-desc">
                        {printSettings.data?.bottomImageDescription || 'QR thanh toán'}
                      </div>
                    </div>
                  )}

                  <div className="thermal-receipt-star-divider">
                    ----------------*----------------
                  </div>

                  {/* Wifi */}
                  {printSettings.data?.printWifiEnabled && printSettings.data.wifiName && (
                    <div className="thermal-receipt-wifi">
                      Wifi: {printSettings.data.wifiName} | Pass:{' '}
                      {printSettings.data.wifiPassword || ''}
                    </div>
                  )}

                  {/* Footers */}
                  {printSettings.data?.footerLine1 && (
                    <div
                      className="thermal-receipt-footer-text"
                      style={{
                        fontWeight: printSettings.data.footerLine1Bold ? 700 : 400,
                      }}
                    >
                      {printSettings.data.footerLine1}
                    </div>
                  )}
                  {printSettings.data?.footerLine2 && (
                    <div
                      className="thermal-receipt-footer-text"
                      style={{
                        fontWeight: printSettings.data.footerLine2Bold ? 700 : 400,
                      }}
                    >
                      {printSettings.data.footerLine2}
                    </div>
                  )}
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
              Lưu {previewInvoiceType === 'PROVISIONAL' ? 'mẫu tạm tính' : 'mẫu thanh toán'}
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}
