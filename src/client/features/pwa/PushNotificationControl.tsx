import { BellOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { Button, message, Modal, Tooltip } from 'antd';

import { apiRequest, jsonRequest } from '@client/lib/api';
import { playPosSound, unlockPosAudio } from '@client/lib/sound';

function vapidKeyToBytes(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function PushNotificationControl({
  csrfToken,
  showGuide = false,
  autoPrompt = false,
}: {
  csrfToken: string | null | undefined;
  showGuide?: boolean;
  autoPrompt?: boolean;
}) {
  const [messageApi, holder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [autoPromptOpen, setAutoPromptOpen] = useState(
    () =>
      autoPrompt && typeof Notification !== 'undefined' && Notification.permission === 'default',
  );
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  );
  const supported =
    typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const enabled = supported && permission === 'granted' && subscriptionActive;

  useEffect(() => {
    if (!supported) return undefined;
    const refreshPermission = () => setPermission(Notification.permission);
    document.addEventListener('visibilitychange', refreshPermission);
    window.addEventListener('focus', refreshPermission);
    return () => {
      document.removeEventListener('visibilitychange', refreshPermission);
      window.removeEventListener('focus', refreshPermission);
    };
  }, [supported]);

  const persistSubscription = useCallback(
    async (subscription: PushSubscription) => {
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error('Không thể tạo push subscription hợp lệ.');
      }
      await jsonRequest(
        '/api/v1/pos/push/subscriptions',
        { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
        { headers: { 'X-CSRF-Token': csrfToken ?? '' } },
      );
    },
    [csrfToken],
  );

  const ensureSubscription = useCallback(async () => {
    const [{ publicKey }, registration] = await Promise.all([
      apiRequest<{ publicKey: string }>('/api/v1/pos/push/public-key'),
      navigator.serviceWorker.ready,
    ]);
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(publicKey),
      }));
    await persistSubscription(subscription);
    setSubscriptionActive(true);
  }, [persistSubscription]);

  useEffect(() => {
    if (!supported || permission !== 'granted' || !csrfToken) return;
    let cancelled = false;
    void ensureSubscription().catch(() => {
      if (!cancelled) setSubscriptionActive(false);
    });
    return () => {
      cancelled = true;
    };
  }, [csrfToken, ensureSubscription, permission, supported]);

  const enable = async () => {
    if (!supported) {
      messageApi.warning('Trình duyệt này chưa hỗ trợ push notification.');
      return;
    }
    unlockPosAudio();
    setLoading(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      setAutoPromptOpen(false);
      window.dispatchEvent(new Event('propos:push-prompt-finished'));
      if (nextPermission !== 'granted') {
        messageApi.info('Bạn chưa cho phép nhận thông báo.');
        return;
      }
      await ensureSubscription();
      playPosSound('NEW_QR_ORDER', `push-sound-test:${Date.now()}`);
      messageApi.success('Đã đồng bộ thông báo và phát thử âm QR Order.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể bật thông báo.');
    } finally {
      setLoading(false);
    }
  };

  const control = (
    <>
      {holder}
      <Tooltip
        title={
          enabled
            ? 'Thông báo đã bật · Chạm để đồng bộ lại và thử âm thanh'
            : permission === 'granted'
              ? 'Đang kiểm tra đăng ký thông báo trên thiết bị'
              : 'Bật thông báo QR Order'
        }
      >
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

  if (autoPrompt) {
    return (
      <>
        {holder}
        <Modal
          open={autoPromptOpen && supported && permission === 'default'}
          title="Cho phép thông báo từ Pro POS?"
          okText="Cho phép thông báo"
          cancelText="Để sau"
          confirmLoading={loading}
          onOk={() => void enable()}
          onCancel={() => {
            setAutoPromptOpen(false);
            window.dispatchEvent(new Event('propos:push-prompt-finished'));
          }}
        >
          <p>
            Pro POS cần quyền thông báo để báo ngay khi khách gọi món, gọi nhân viên hoặc yêu cầu
            thanh toán, kể cả khi PWA đang chạy nền.
          </p>
          <p style={{ marginBottom: 0, color: '#64748b' }}>
            Sau khi bấm cho phép, hãy bật Âm thanh cho Pro POS trong cài đặt thông báo của điện
            thoại.
          </p>
        </Modal>
      </>
    );
  }

  if (!showGuide) return control;
  return (
    <div className="pos-push-guide">
      <div className="pos-push-guide__heading">
        <div>
          <strong>Âm thanh & thông báo điện thoại</strong>
          <span>Chạm nút để đồng bộ lại subscription và phát thử âm báo.</span>
        </div>
        {control}
      </div>
    </div>
  );
}
