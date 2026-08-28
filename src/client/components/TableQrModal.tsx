import React, { useRef, useState } from 'react';
import {
  CopyOutlined,
  DownloadOutlined,
  PrinterOutlined,
  QrcodeOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Input, Modal, Tag, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';

export interface TableQrModalProps {
  open: boolean;
  onClose: () => void;
  tableName: string;
  url: string;
  qrImageSrc: string;
  storeName?: string | null | undefined;
  orderCode?: string | null | undefined;
}

/**
 * Generates the same high-resolution table card shown in the preview modal.
 * and returns the Data URL (PNG) ready for download or print.
 */
export async function generateStandeeDataUrl({
  tableName,
  storeName,
  qrImageSrc,
}: {
  tableName: string;
  storeName?: string | null;
  qrImageSrc: string;
}): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrImageSrc;

  // Rounded card background
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(8, 8, 884, 984, 44);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 1000);

  // Header banner
  const headerGrad = ctx.createLinearGradient(0, 0, 900, 280);
  headerGrad.addColorStop(0, '#0284c7');
  headerGrad.addColorStop(1, '#0369a1');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(8, 8, 884, 272);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`▦ ${(storeName || 'PRO POS').toUpperCase()}`, 450, 66);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 50px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('QUÉT MÃ GỌI MÓN', 450, 142);

  const badgeLabel = `BÀN: ${tableName.toUpperCase()}`;
  ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const badgeWidth = Math.max(290, ctx.measureText(badgeLabel).width + 92);
  const badgeX = 450 - badgeWidth / 2;
  const badgeY = 176;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeWidth, 64, 32);
  ctx.fill();

  ctx.fillStyle = '#0369a1';
  ctx.fillText(badgeLabel, 450, 218);

  // Load QR image
  const qrImg = new Image();
  await new Promise<void>((resolve) => {
    qrImg.addEventListener('load', () => resolve(), { once: true });
    qrImg.addEventListener('error', () => resolve(), { once: true });
    qrImg.src = qrImageSrc;
  });

  // QR frame
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(170, 320, 560, 560, 36);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.08)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.drawImage(qrImg, 210, 360, 480, 480);

  // Scanner corner accents
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 7;
  const cornerLength = 40;
  const corners = [
    { x: 190, y: 340, horizontal: 1, vertical: 1 },
    { x: 710, y: 340, horizontal: -1, vertical: 1 },
    { x: 190, y: 860, horizontal: 1, vertical: -1 },
    { x: 710, y: 860, horizontal: -1, vertical: -1 },
  ];
  for (const corner of corners) {
    ctx.beginPath();
    ctx.moveTo(corner.x, corner.y + corner.vertical * cornerLength);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x + corner.horizontal * cornerLength, corner.y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = 'italic 21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('✨ Chúc quý khách có những phút giây thư giãn tuyệt vời! ✨', 450, 940);
  ctx.restore();

  // Outer cyan border matching the preview card
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#bae6fd';
  ctx.beginPath();
  ctx.roundRect(8, 8, 884, 984, 44);
  ctx.stroke();

  return canvas.toDataURL('image/png');
}

export function TableQrModal({
  open,
  onClose,
  tableName,
  url,
  qrImageSrc,
  storeName,
  orderCode,
}: TableQrModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Đã sao chép liên kết gọi món.');
    } catch {
      message.error('Không thể sao chép liên kết.');
    }
  };

  const handleDownloadStandee = async () => {
    setDownloading(true);
    try {
      const standeeDataUrl = await generateStandeeDataUrl({
        tableName,
        ...(storeName === undefined ? {} : { storeName }),
        qrImageSrc,
      });
      const link = document.createElement('a');
      link.href = standeeDataUrl;
      link.download = `standee-qr-${tableName.replaceAll(/\s+/gu, '-').toLowerCase()}.png`;
      link.click();
      message.success('Đã tải ảnh Standee thành công.');
    } catch {
      message.error('Không thể tạo ảnh Standee.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadOnlyQr = () => {
    const link = document.createElement('a');
    link.href = qrImageSrc;
    link.download = `qr-only-${tableName.replaceAll(/\s+/gu, '-').toLowerCase()}.png`;
    link.click();
    message.success('Đã tải mã QR gốc.');
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const standeeDataUrl = await generateStandeeDataUrl({
        tableName,
        ...(storeName === undefined ? {} : { storeName }),
        qrImageSrc,
      });

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        message.error('Không thể mở cửa sổ in. Vui lòng cho phép popup trình duyệt.');
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>In Standee QR - ${tableName}</title>
            <style>
              @page {
                size: auto;
                margin: 0;
              }
              body {
                margin: 0;
                padding: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #fff;
              }
              img {
                max-width: 100%;
                max-height: 98vh;
                object-fit: contain;
                display: block;
              }
            </style>
          </head>
          <body>
            <img src="${standeeDataUrl}" onload="window.print(); window.close();" />
          </body>
        </html>
      `);
      printWindow.document.close();
    } catch {
      message.error('Không thể khởi tạo lệnh in.');
    } finally {
      setPrinting(false);
    }
  };

  const downloadMenu: MenuProps = {
    items: [
      {
        key: 'standee',
        icon: <QrcodeOutlined />,
        label: 'Tải trọn bộ Standee (Khung + Hướng dẫn)',
        onClick: handleDownloadStandee,
      },
      {
        key: 'qr_only',
        icon: <DownloadOutlined />,
        label: 'Chỉ tải mã QR đơn lẻ',
        onClick: handleDownloadOnlyQr,
      },
    ],
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" size="large" onClick={onClose}>
          Đóng
        </Button>,
        <Button key="copy" size="large" icon={<CopyOutlined />} onClick={handleCopyLink}>
          Chép link
        </Button>,
        <Button
          key="print"
          size="large"
          icon={<PrinterOutlined />}
          loading={printing}
          onClick={handlePrint}
        >
          In Standee
        </Button>,
        <Dropdown key="download" menu={downloadMenu} trigger={['click']}>
          <Button type="primary" size="large" icon={<DownloadOutlined />} loading={downloading}>
            Tải ảnh để in
          </Button>
        </Dropdown>,
      ]}
      centered
      width={460}
      className="table-qr-standee-modal"
    >
      <div className="table-qr-standee-wrapper" ref={cardRef}>
        {/* Main Standee Card Preview */}
        <div className="table-qr-standee-card">
          {/* Header Banner */}
          <div className="table-qr-standee-header">
            <div className="table-qr-standee-store">
              <ShopOutlined /> {storeName || 'PRO POS'}
            </div>
            <h3 className="table-qr-standee-title">QUÉT MÃ GỌI MÓN</h3>
            <div className="table-qr-standee-badge">
              <span>BÀN:</span> <strong>{tableName}</strong>
            </div>
          </div>

          {/* QR Code Container with Frame */}
          <div className="table-qr-standee-qr-frame">
            <div className="table-qr-standee-corner top-left" />
            <div className="table-qr-standee-corner top-right" />
            <div className="table-qr-standee-corner bottom-left" />
            <div className="table-qr-standee-corner bottom-right" />
            <img src={qrImageSrc} alt={`QR Order ${tableName}`} className="table-qr-standee-img" />
          </div>

          {/* Order Code if active */}
          {orderCode ? (
            <div className="table-qr-standee-order-code">
              <Tag color="cyan">Mã đơn: {orderCode}</Tag>
            </div>
          ) : null}
          {/* Footer note */}
          <div className="table-qr-standee-footer">
            <span>✨ Chúc quý khách có những phút giây thư giãn tuyệt vời! ✨</span>
          </div>
        </div>

        {/* Copy Link Input Bar */}
        <div className="table-qr-standee-link-bar">
          <Input
            value={url}
            readOnly
            size="middle"
            prefix={<QrcodeOutlined style={{ color: '#0284c7' }} />}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Tooltip title="Sao chép liên kết">
            <Button icon={<CopyOutlined />} onClick={handleCopyLink} />
          </Tooltip>
        </div>
      </div>
    </Modal>
  );
}
