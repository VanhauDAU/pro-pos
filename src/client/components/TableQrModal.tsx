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
 * Generates a high-resolution Standee Card (900x1260px) onto an offscreen canvas
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
  canvas.height = 1260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrImageSrc;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 1260);

  // Outer border with subtle gradient
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#0284c7';
  ctx.strokeRect(6, 6, 888, 1248);

  // Header Banner Gradient
  const headerGrad = ctx.createLinearGradient(0, 0, 900, 220);
  headerGrad.addColorStop(0, '#0284c7');
  headerGrad.addColorStop(1, '#0369a1');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(12, 12, 876, 210);

  // Store Name
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((storeName || 'PRO POS').toUpperCase(), 450, 68);

  // Main Header Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('QUÉT MÃ GỌI MÓN', 450, 128);

  // Table Badge (Pill)
  const badgeLabel = `BÀN: ${tableName.toUpperCase()}`;
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const badgeWidth = Math.max(260, ctx.measureText(badgeLabel).width + 80);
  const badgeX = 450 - badgeWidth / 2;
  const badgeY = 154;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeWidth, 52, 26);
  ctx.fill();

  ctx.fillStyle = '#0369a1';
  ctx.fillText(badgeLabel, 450, 190);

  // Load and Draw QR Code Image
  const qrImg = new Image();
  qrImg.crossOrigin = 'anonymous';
  await new Promise<void>((resolve) => {
    qrImg.addEventListener('load', () => resolve(), { once: true });
    qrImg.addEventListener('error', () => resolve(), { once: true });
    qrImg.src = qrImageSrc;
  });

  // QR Container Box
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(180, 260, 540, 540, 24);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  // Draw QR in Center
  ctx.drawImage(qrImg, 210, 290, 480, 480);

  // Corner Scanner Accents
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 6;
  const cLen = 32;

  // Top-Left
  ctx.beginPath();
  ctx.moveTo(195, 275 + cLen);
  ctx.lineTo(195, 275);
  ctx.lineTo(195 + cLen, 275);
  ctx.stroke();

  // Top-Right
  ctx.beginPath();
  ctx.moveTo(705 - cLen, 275);
  ctx.lineTo(705, 275);
  ctx.lineTo(705, 275 + cLen);
  ctx.stroke();

  // Bottom-Left
  ctx.beginPath();
  ctx.moveTo(195, 785 - cLen);
  ctx.lineTo(195, 785);
  ctx.lineTo(195 + cLen, 785);
  ctx.stroke();

  // Bottom-Right
  ctx.beginPath();
  ctx.moveTo(705 - cLen, 785);
  ctx.lineTo(705, 785);
  ctx.lineTo(705, 785 - cLen);
  ctx.stroke();

  // Instructions Container
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(70, 835, 760, 320, 20);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  // Instructions Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HƯỚNG DẪN ĐẶT MÓN TẠI BÀN', 450, 878);

  // 3 Steps with 2-line clean layout (Title + Subtext)
  const steps = [
    {
      num: '1',
      title: 'Mở Camera hoặc app Zalo',
      desc: 'Quét mã QR trên bàn để truy cập menu gọi món',
    },
    {
      num: '2',
      title: 'Chọn món yêu thích',
      desc: 'Thêm món vào giỏ hàng và tùy chỉnh ghi chú nếu cần',
    },
    {
      num: '3',
      title: 'Bấm gửi gọi món',
      desc: 'Nhân viên và nhà bếp tiếp nhận phục vụ ngay tại bàn',
    },
  ];

  steps.forEach((step, idx) => {
    const centerY = 934 + idx * 72;

    // Circle Badge
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(120, centerY, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.num, 120, centerY + 7);

    // Step Title (Line 1)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(step.title, 160, centerY - 6);

    // Step Description (Line 2)
    ctx.fillStyle = '#64748b';
    ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(step.desc, 160, centerY + 18);
  });

  // Footer Note
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('✨ Chúc quý khách có bữa ăn ngon miệng và trải nghiệm vui vẻ! ✨', 450, 1210);

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

          {/* 3 Step Instructions */}
          <div className="table-qr-standee-steps">
            <div className="table-qr-standee-steps-title">3 bước gọi món siêu nhanh:</div>
            <div className="table-qr-standee-step-row">
              <span className="table-qr-standee-step-num">1</span>
              <div className="table-qr-standee-step-text">
                <div className="table-qr-standee-step-heading">Mở Camera / app Zalo</div>
                <div className="table-qr-standee-step-sub">Quét mã QR trên bàn để xem menu</div>
              </div>
            </div>
            <div className="table-qr-standee-step-row">
              <span className="table-qr-standee-step-num">2</span>
              <div className="table-qr-standee-step-text">
                <div className="table-qr-standee-step-heading">Chọn món yêu thích</div>
                <div className="table-qr-standee-step-sub">Xem thực đơn & thêm món vào đơn</div>
              </div>
            </div>
            <div className="table-qr-standee-step-row">
              <span className="table-qr-standee-step-num">3</span>
              <div className="table-qr-standee-step-text">
                <div className="table-qr-standee-step-heading">Bấm gửi gọi món</div>
                <div className="table-qr-standee-step-sub">Bếp và nhân viên phục vụ ngay</div>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="table-qr-standee-footer">
            <span>✨ Chúc quý khách có bữa ăn thật ngon miệng! ✨</span>
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
