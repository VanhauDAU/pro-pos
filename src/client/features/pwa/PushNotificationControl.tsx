import { BellOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { Button, message, Modal, Tooltip } from 'antd';

import { apiRequest, jsonRequest } from '@client/lib/api';

let subscriptionSyncPromise: Promise<PushSubscription> | null = null;

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
    if (!subscriptionSyncPromise) {
      subscriptionSyncPromise = (async () => {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing
          ? existing
          : await (async () => {
              const { publicKey } = await apiRequest<{ publicKey: string }>(
                '/api/v1/pos/push/public-key',
              );
              return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidKeyToBytes(publicKey),
              });
            })();
        const syncKey = `propos:push-synced:${subscription.endpoint}`;
        if (sessionStorage.getItem(syncKey) !== '1') {
          await persistSubscription(subscription);
          sessionStorage.setItem(syncKey, '1');
        }
        return subscription;
      })().catch((error) => {
        subscriptionSyncPromise = null;
        throw error;
      });
    }
    await subscriptionSyncPromise;
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
    setLoading(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      setAutoPromptOpen(false);
      if (nextPermission !== 'granted') {
        messageApi.info('Bạn chưa cho phép nhận thông báo.');
        return;
      }
      await ensureSubscription();
      messageApi.success('Đã đồng bộ thông báo trên thiết bị.');
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
            ? 'Thông báo đã bật · Chạm để đồng bộ lại'
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
