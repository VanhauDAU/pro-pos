import { PrinterOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import { useMemo } from 'react';

import type { PosReceiptPrintOptions } from '@domain/receipt/receipt-generator';
import { generateThermalReceiptHtml } from '@client/lib/pos-receipt-printer';

export function ReceiptPreviewPaper({ options }: { options: PosReceiptPrintOptions }) {
  const copies = Math.max(
    1,
    options.data.receiptType === 'PROVISIONAL'
      ? (options.printSettings?.provisionalCopyCount ?? 1)
      : (options.printSettings?.paymentCopyCount ?? 1),
  );
  const html = useMemo(
    () => generateThermalReceiptHtml(options, { index: 1, total: copies }),
    [copies, options],
  );
  const paperSize = options.printSettings?.paperSize ?? 'K80';
  return (
    <div
      className={`pos-receipt-preview-stage pos-receipt-preview-stage--${paperSize.toLowerCase()}`}
    >
      <div className="pos-receipt-preview-paper" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export function ReceiptPreviewModal({
  open,
  title,
  options,
  printing = false,
  previewOnly = false,
  onCancel,
  onPrint,
}: {
  open: boolean;
  title: string;
  options: PosReceiptPrintOptions | null;
  printing?: boolean;
  previewOnly?: boolean;
  onCancel: () => void;
  onPrint?: () => void | Promise<void>;
}) {
  return (
    <Modal
      open={open}
      title={title}
      width={650}
      centered
      className="pos-receipt-preview-modal"
      onCancel={onCancel}
      footer={
        previewOnly
          ? [
              <Button key="close" type="primary" onClick={onCancel}>
                Đóng
              </Button>,
            ]
          : [
              <Button key="close" onClick={onCancel} disabled={printing}>
                Đóng
              </Button>,
              <Button
                key="print"
                type="primary"
                icon={<PrinterOutlined />}
                loading={printing}
                onClick={() => void onPrint?.()}
              >
                Xác nhận in
              </Button>,
            ]
      }
    >
      {options ? <ReceiptPreviewPaper options={options} /> : null}
    </Modal>
  );
}
