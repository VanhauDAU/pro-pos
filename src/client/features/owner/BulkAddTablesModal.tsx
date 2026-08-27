import { AppstoreAddOutlined, EyeOutlined } from '@ant-design/icons';
import {
  Alert,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';

export interface BulkTableItem {
  name: string;
  timeProductId?: string | null;
}

export interface BulkAddTablesModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (tables: BulkTableItem[]) => Promise<void> | void;
  loading?: boolean;
  initialPrefix?: string;
  initialStartNumber?: number;
  initialQuantity?: number;
  showPricingSelect?: boolean;
  pricingOptions?: Array<{ value: string; label: string }>;
  existingNames?: string[];
}

export function BulkAddTablesModal({
  open,
  onCancel,
  onConfirm,
  loading = false,
  initialPrefix = 'Bàn ',
  initialStartNumber = 1,
  initialQuantity = 10,
  showPricingSelect = false,
  pricingOptions = [],
  existingNames = [],
}: BulkAddTablesModalProps) {
  const [form] = Form.useForm();
  const [prefix, setPrefix] = useState(initialPrefix);
  const [startNumber, setStartNumber] = useState<number>(initialStartNumber);
  const [quantity, setQuantity] = useState<number>(initialQuantity);
  const [useZeroPadding, setUseZeroPadding] = useState(false);
  const [selectedPricingId, setSelectedPricingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrefix(initialPrefix);
      setStartNumber(initialStartNumber);
      setQuantity(initialQuantity);
      setUseZeroPadding(false);
      setSelectedPricingId(null);
      form.setFieldsValue({
        prefix: initialPrefix,
        startNumber: initialStartNumber,
        quantity: initialQuantity,
        useZeroPadding: false,
        timeProductId: null,
      });
    }
  }, [open, initialPrefix, initialStartNumber, initialQuantity, form]);

  const existingSet = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  const generatedTables = useMemo(() => {
    const validQty = Math.max(1, Math.min(100, quantity || 1));
    const validStart = Math.max(1, startNumber || 1);
    const result: BulkTableItem[] = [];

    for (let i = 0; i < validQty; i++) {
      const currentNum = validStart + i;
      const numStr =
        useZeroPadding && currentNum < 10
          ? String(currentNum).padStart(2, '0')
          : String(currentNum);
      const name = `${prefix}${numStr}`.trim();
      result.push({
        name,
        timeProductId: selectedPricingId || null,
      });
    }
    return result;
  }, [prefix, startNumber, quantity, useZeroPadding, selectedPricingId]);

  const duplicateCount = useMemo(() => {
    return generatedTables.filter((t) => existingSet.has(t.name.toLowerCase())).length;
  }, [generatedTables, existingSet]);

  const handleFinish = async () => {
    if (!generatedTables.length) return;
    await onConfirm(generatedTables);
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
          <AppstoreAddOutlined style={{ color: '#0975f7', fontSize: 18 }} />
          <span>Thêm nhiều bàn/phòng</span>
        </div>
      }
      open={open}
      width={560}
      okText={loading ? 'Đang thêm...' : `Thêm ${generatedTables.length} bàn/phòng`}
      cancelText="Hủy"
      confirmLoading={loading}
      onOk={() => form.submit()}
      onCancel={onCancel}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={handleFinish}
        style={{ marginTop: 14 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 12 }}>
          <Form.Item
            name="prefix"
            label="Tiền tố"
            rules={[{ required: true, message: 'Vui lòng nhập tiền tố.' }]}
            tooltip="Chữ đứng trước số thứ tự (ví dụ: 'Bàn ', 'Phòng ', 'VIP ')"
          >
            <Input
              placeholder="Ví dụ: Bàn "
              maxLength={60}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </Form.Item>

          <Form.Item
            name="startNumber"
            label="Số bắt đầu"
            rules={[{ required: true, message: 'Nhập số bắt đầu.' }]}
          >
            <InputNumber
              min={1}
              max={99999}
              style={{ width: '100%' }}
              value={startNumber}
              onChange={(val) => setStartNumber(val ?? 1)}
            />
          </Form.Item>

          <Form.Item
            name="quantity"
            label="Số lượng"
            rules={[{ required: true, message: 'Nhập số lượng.' }]}
          >
            <InputNumber
              min={1}
              max={100}
              style={{ width: '100%' }}
              value={quantity}
              onChange={(val) => setQuantity(val ?? 1)}
            />
          </Form.Item>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            marginTop: -4,
          }}
        >
          <Form.Item name="useZeroPadding" valuePropName="checked" noStyle>
            <Checkbox
              checked={useZeroPadding}
              onChange={(e) => setUseZeroPadding(e.target.checked)}
            >
              Đệm 2 chữ số (ví dụ: 01, 02... thay vì 1, 2...)
            </Checkbox>
          </Form.Item>
        </div>

        {showPricingSelect ? (
          <Form.Item
            name="timeProductId"
            label="Bảng giá tính giờ (áp dụng đồng loạt)"
            style={{ marginBottom: 16 }}
          >
            <Select
              allowClear
              placeholder="Chọn bảng giá (tùy chọn)"
              options={pricingOptions}
              value={selectedPricingId}
              onChange={(val) => setSelectedPricingId(val ?? null)}
              notFoundContent="Chưa có bảng giá tính giờ"
            />
          </Form.Item>
        ) : null}

        {duplicateCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`Có ${duplicateCount} tên bàn đã tồn tại trong danh sách. Vui lòng kiểm tra lại tiền tố hoặc số bắt đầu để tránh trùng lặp.`}
          />
        ) : null}

        <div className="bulk-table-preview-box">
          <div className="bulk-table-preview-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <EyeOutlined /> Xem trước ({generatedTables.length} bàn/phòng)
            </span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Từ <strong>{generatedTables[0]?.name || '—'}</strong> đến{' '}
              <strong>{generatedTables[generatedTables.length - 1]?.name || '—'}</strong>
            </Typography.Text>
          </div>

          <div className="bulk-table-preview-tags">
            {generatedTables.slice(0, 30).map((item, idx) => {
              const isDuplicate = existingSet.has(item.name.toLowerCase());
              return (
                <Tag
                  key={idx}
                  color={isDuplicate ? 'warning' : 'blue'}
                  className="bulk-table-preview-tag"
                >
                  {isDuplicate ? '⚠️ ' : ''}
                  {item.name}
                </Tag>
              );
            })}
            {generatedTables.length > 30 ? (
              <Tag color="default" className="bulk-table-preview-tag">
                +{generatedTables.length - 30} bàn khác...
              </Tag>
            ) : null}
          </div>
        </div>
      </Form>
    </Modal>
  );
}
