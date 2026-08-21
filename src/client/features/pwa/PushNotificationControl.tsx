import { BellOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Button, message, Tooltip } from 'antd';

import { apiRequest, jsonRequest } from '@client/lib/api';

function vapidKeyToBytes(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function PushNotificationControl({ csrfToken }: { csrfToken: string | null | undefined }) {
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const supported =
    typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const enabled = supported && Notification.permission === 'granted';

  const enable = async () => {
    if (!supported) {
      messageApi.warning('Trình duyệt này chưa hỗ trợ push notification.');
      return;
    }
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        messageApi.info('Bạn chưa cho phép nhận thông báo.');
        return;
      }
      const [{ publicKey }, registration] = await Promise.all([
        apiRequest<{ publicKey: string }>('/api/v1/pos/push/public-key'),
        navigator.serviceWorker.ready,
      ]);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(publicKey),
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error('Không thể tạo push subscription hợp lệ.');
      }
      await jsonRequest(
        '/api/v1/pos/push/subscriptions',
        { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
        { headers: { 'X-CSRF-Token': csrfToken ?? '' } },
      );
      messageApi.success('Đã bật thông báo QR Order trên thiết bị này.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể bật thông báo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {holder}
      <Tooltip title={enabled ? 'Thông báo đơn: Đã bật' : 'Bật thông báo QR Order'}>
        <Button
          type={enabled ? 'primary' : 'default'}
          size="middle"
          icon={<BellOutlined />}
          loading={loading}
          onClick={() => void enable()}
          className={`pos-push-btn ${enabled ? 'is-enabled' : ''}`}
          aria-label={enabled ? 'Thông báo đã bật' : 'Bật thông báo'}
        >
          <span className="pos-push-btn-text">{enabled ? 'Đã bật' : 'Thông báo'}</span>
        </Button>
      </Tooltip>
    </>
  );
}
