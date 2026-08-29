import {
  CheckOutlined,
  CopyOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Modal, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { toast } from 'sonner';

interface QzTrustedSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export function QzTrustedSetupModal({ open, onClose }: QzTrustedSetupModalProps) {
  const [copiedMac, setCopiedMac] = useState(false);
  const [copiedWin, setCopiedWin] = useState(false);

  const macCommand = `"/Applications/QZ Tray.app/Contents/MacOS/QZ Tray" --whitelist ~/Downloads/propos-qz-cert.pem`;
  const winCommand = `"C:\\Program Files\\QZ Tray\\qz-tray.exe" --whitelist "%USERPROFILE%\\Downloads\\propos-qz-cert.pem"`;

  const copyToClipboard = (text: string, isMac: boolean) => {
    void navigator.clipboard.writeText(text);
    if (isMac) {
      setCopiedMac(true);
      setTimeout(() => setCopiedMac(false), 2000);
    } else {
      setCopiedWin(true);
      setTimeout(() => setCopiedWin(false), 2000);
    }
    toast.success('Đã sao chép lệnh cài đặt vào clipboard!');
  };

  const macTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Typography.Text strong>Bước 1: Tải chứng chỉ bảo mật của Pro POS</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            href="/api/v1/pos/printing/qz/certificate?download=1"
            download="propos-qz-cert.pem"
          >
            Tải file chứng chỉ (propos-qz-cert.pem)
          </Button>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
          File sẽ được lưu vào thư mục <code>~/Downloads/propos-qz-cert.pem</code> trên máy Mac của
          bạn.
        </Typography.Text>
      </div>

      <div>
        <Typography.Text strong>Bước 2: Chạy lệnh Whitelist trên Terminal</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
          Mở ứng dụng <strong>Terminal</strong> trên macOS, dán lệnh dưới đây và nhấn{' '}
          <strong>Enter</strong>:
        </Typography.Text>
        <Card
          size="small"
          style={{
            marginTop: 8,
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            color: '#38bdf8',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <code style={{ wordBreak: 'break-all', color: '#38bdf8' }}>{macCommand}</code>
            <Button
              size="small"
              icon={copiedMac ? <CheckOutlined /> : <CopyOutlined />}
              onClick={() => copyToClipboard(macCommand, true)}
            >
              {copiedMac ? 'Đã chép' : 'Sao chép'}
            </Button>
          </div>
        </Card>
      </div>

      <div>
        <Typography.Text strong>Bước 3: Khởi động lại QZ Tray & Thưởng thức</Typography.Text>
        <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13, color: '#475569' }}>
          <li>
            Nhấp vào biểu tượng QZ Tray trên thanh Menu Bar và chọn <strong>Exit</strong>.
          </li>
          <li>Mở lại ứng dụng QZ Tray từ Launchpad hoặc Spotlight.</li>
          <li>
            Quay lại màn hình POS và bấm <strong>Kết nối lại QZ Tray</strong>.
          </li>
          <li>
            Từ nay, QZ Tray sẽ <strong>tự động in ngầm tức thì</strong> mà không bao giờ hiện hộp
            thoại "Allow" nữa!
          </li>
        </ul>
      </div>
    </div>
  );

  const winTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Typography.Text strong>Bước 1: Tải chứng chỉ bảo mật của Pro POS</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            href="/api/v1/pos/printing/qz/certificate?download=1"
            download="propos-qz-cert.pem"
          >
            Tải file chứng chỉ (propos-qz-cert.pem)
          </Button>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
          File sẽ được lưu vào thư mục Downloads của người dùng.
        </Typography.Text>
      </div>

      <div>
        <Typography.Text strong>Bước 2: Chạy lệnh Whitelist trên Command Prompt</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
          Mở <strong>Command Prompt (cmd.exe)</strong>, dán lệnh dưới đây và nhấn{' '}
          <strong>Enter</strong>:
        </Typography.Text>
        <Card
          size="small"
          style={{
            marginTop: 8,
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            color: '#38bdf8',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <code style={{ wordBreak: 'break-all', color: '#38bdf8' }}>{winCommand}</code>
            <Button
              size="small"
              icon={copiedWin ? <CheckOutlined /> : <CopyOutlined />}
              onClick={() => copyToClipboard(winCommand, false)}
            >
              {copiedWin ? 'Đã chép' : 'Sao chép'}
            </Button>
          </div>
        </Card>
      </div>

      <div>
        <Typography.Text strong>Bước 3: Khởi động lại QZ Tray & Thưởng thức</Typography.Text>
        <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13, color: '#475569' }}>
          <li>
            Nhấp chuột phải vào biểu tượng QZ Tray dưới khay hệ thống (System Tray) và chọn{' '}
            <strong>Exit</strong>.
          </li>
          <li>Mở lại ứng dụng QZ Tray từ Start Menu hoặc Desktop.</li>
          <li>
            Quay lại màn hình POS và bấm <strong>Kết nối lại QZ Tray</strong>.
          </li>
          <li>Từ nay, QZ Tray sẽ tự động in ngầm mà không còn hiện hộp thoại xác nhận "Allow".</li>
        </ul>
      </div>
    </div>
  );

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SafetyCertificateOutlined style={{ color: '#16a34a', fontSize: 20 }} />
          <span>Cấu hình QZ Tray Không Cần Bấm Allow (Trusted Mode)</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          Đã hiểu & Đóng
        </Button>,
      ]}
      width={680}
    >
      <Alert
        type="success"
        showIcon
        message="Bảo mật & Tự động hóa hoàn toàn"
        description="Khi thêm chứng chỉ của Pro POS vào danh sách tin cậy của QZ Tray, bạn sẽ không phải bấm Allow mỗi khi in, và máy in sẽ tự động nhận lệnh in từ điện thoại/iPad từ xa."
        style={{ marginBottom: 16 }}
      />

      <Tabs
        defaultActiveKey="macos"
        items={[
          { key: 'macos', label: '🍏 macOS', children: macTab },
          { key: 'windows', label: '🪟 Windows', children: winTab },
        ]}
      />
    </Modal>
  );
}
