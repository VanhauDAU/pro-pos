import { PrinterOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import { useMemo } from 'react';

import { parsePrinterDeviceConfig } from '@contracts/store';
import { buildEscPosReceipt, type PosReceiptPrintOptions } from '@domain/receipt/receipt-generator';
import { generateThermalReceiptHtml } from '@client/lib/pos-receipt-printer';

function escPosPreviewText(raw: string) {
  let output = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const command = raw.charCodeAt(index + 1);
    if (code === 27) {
      if (command === 64)
        index += 1; // ESC @
      else if (command === 97 || command === 69)
        index += 2; // ESC a / ESC E
      else if (command === 112) index += 4; // ESC p
      continue;
    }
    if (code === 29 && command === 86) {
      index += 3; // GS V
      continue;
    }
    if (code === 9 || code === 10 || code === 13 || code >= 32) output += raw[index];
  }
  return output;
}

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
  const printer = parsePrinterDeviceConfig(options.printSettings?.printersJson);
  const rawPreview = useMemo(
    () =>
      printer.connectionType === 'NETWORK_TCP'
        ? escPosPreviewText(buildEscPosReceipt(options, { index: 1, total: copies }).escPosData)
        : null,
    [copies, options, printer.connectionType],
  );
  return (
    <div
      className={`pos-receipt-preview-stage pos-receipt-preview-stage--${paperSize.toLowerCase()}`}
    >
      {rawPreview === null ? (
        <div className="pos-receipt-preview-paper" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="pos-receipt-preview-paper pos-receipt-preview-paper--raw">
          <div className="pos-receipt-preview-mode">ESC/POS · Máy in mạng</div>
          <pre>{rawPreview}</pre>
        </div>
      )}
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
