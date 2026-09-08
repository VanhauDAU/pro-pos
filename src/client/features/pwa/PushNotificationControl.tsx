import { BellOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { Button, message, Modal, Popconfirm, Tag, Tooltip } from 'antd';

import { apiRequest, jsonRequest } from '@client/lib/api';
import { playPushNotificationSound, warmPosSounds } from '@client/lib/sound';

let subscriptionSyncPromise: Promise<PushSubscription> | null = null;
const SUBSCRIPTION_SYNC_TTL_MS = 2 * 60 * 60_000;

function areApplicationServerKeysEqual(
  existingKey: ArrayBuffer | null | undefined,
  targetBytes: Uint8Array,
): boolean {
  if (!existingKey) return false;
  const existingBytes = new Uint8Array(existingKey);
  if (existingBytes.length !== targetBytes.length) return false;
  for (let i = 0; i < existingBytes.length; i++) {
    if (existingBytes[i] !== targetBytes[i]) return false;
  }
  return true;
}

function scheduleIdle(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(callback, { timeout: 3_000 });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 500);
  return () => window.clearTimeout(id);
}

async function subscriptionSyncKey(endpoint: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const fingerprint = Array.from(new Uint8Array(bytes).slice(0, 8))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `propos:push-synced:${fingerprint}`;
}

function vapidKeyToBytes(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function isUserDisabled(): boolean {
  try {
    return localStorage.getItem('propos:push:user-disabled') === 'true';
  } catch {
    return false;
  }
}

async function getRegistrationWithTimeout(timeoutMs = 6000): Promise<ServiceWorkerRegistration> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Trình duyệt này không hỗ trợ Service Worker.');
  }
  if (!window.isSecureContext) {
    throw new Error('Push Notification yêu cầu kết nối bảo mật (HTTPS hoặc localhost).');
  }

  let existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) {
    return existing;
  }

  if (!existing) {
    try {
      existing = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (err) {
      throw new Error(
        `Không thể đăng ký Service Worker: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  if (existing.active) {
    return existing;
  }

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        reject(
          new Error('Service Worker chưa kịp kích hoạt. Vui lòng tải lại trang (F5) và thử lại.'),
        );
      }
    }, timeoutMs);

    navigator.serviceWorker.ready
      .then((reg) => {
        if (!done) {
          done = true;
          window.clearTimeout(timer);
          resolve(reg);
        }
      })
      .catch((err) => {
        if (!done) {
          done = true;
          window.clearTimeout(timer);
          reject(err);
        }
      });
  });
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
  const [adminRequested, setAdminRequested] = useState(false);
  const [autoPromptOpen, setAutoPromptOpen] = useState(
    () =>
      autoPrompt &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default' &&
      !isUserDisabled(),
  );
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  );
  const supported =
    typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const enabled = supported && permission === 'granted' && subscriptionActive && !isUserDisabled();

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

  useEffect(() => {
    const handleAdminRequest = () => {
      try {
        localStorage.removeItem('propos:push:user-disabled');
      } catch {}
      setAdminRequested(true);
      setAutoPromptOpen(true);
    };
    window.addEventListener('propos:request-push-prompt', handleAdminRequest);
    return () => {
      window.removeEventListener('propos:request-push-prompt', handleAdminRequest);
    };
  }, []);

  useEffect(() => {
    if (!supported || permission !== 'granted' || isUserDisabled()) {
      setSubscriptionActive(false);
      return;
    }
    getRegistrationWithTimeout()
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscriptionActive(Boolean(sub));
      })
      .catch(() => {});
  }, [permission, supported]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    warmPosSounds(['PAYMENT_SUCCESS']);
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_NOTIFICATION_RECEIVED') {
        playPushNotificationSound(event.data.payload);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, []);

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

  const ensureSubscription = useCallback(
    async (forceSync = false) => {
      if (!subscriptionSyncPromise) {
        subscriptionSyncPromise = (async () => {
          const registration = await getRegistrationWithTimeout(6000);
          const { publicKey } = await apiRequest<{ publicKey: string }>(
            '/api/v1/pos/push/public-key',
          );
          const targetBytes = vapidKeyToBytes(publicKey);

          let existing = await registration.pushManager.getSubscription();
          if (
            existing &&
            !areApplicationServerKeysEqual(existing.options?.applicationServerKey, targetBytes)
          ) {
            try {
              await existing.unsubscribe();
            } catch {
              // ignore
            }
            existing = null;
          }

          const created = !existing;
          const subscription = existing
            ? existing
            : await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: targetBytes,
              });

          const syncKey = await subscriptionSyncKey(
            `${subscription.endpoint}:${publicKey.slice(0, 16)}`,
          );
          const lastSyncedAt = Number(localStorage.getItem(syncKey) ?? '0');
          if (forceSync || created || Date.now() - lastSyncedAt >= SUBSCRIPTION_SYNC_TTL_MS) {
            await persistSubscription(subscription);
            localStorage.setItem(syncKey, String(Date.now()));
          }
          return subscription;
        })().catch((error) => {
          subscriptionSyncPromise = null;
          throw error;
        });
      }
      await subscriptionSyncPromise;
      setSubscriptionActive(true);
    },
    [persistSubscription],
  );

  useEffect(() => {
    if (!supported || permission !== 'granted' || !csrfToken) return;
    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      void ensureSubscription().catch(() => {
        if (!cancelled) setSubscriptionActive(false);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [csrfToken, ensureSubscription, permission, supported]);

  const enable = async () => {
    if (!supported) {
      messageApi.warning('Trình duyệt này chưa hỗ trợ push notification.');
      return;
    }
    setLoading(true);
    try {
      try {
        localStorage.removeItem('propos:push:user-disabled');
      } catch {}
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      setAutoPromptOpen(false);
      setAdminRequested(false);
      if (nextPermission !== 'granted') {
        messageApi.info('Bạn chưa cho phép nhận thông báo.');
        return;
      }
      await ensureSubscription(true);
      messageApi.success('Đã bật và đồng bộ thông báo trên thiết bị.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể bật thông báo.');
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    if (!supported) return;
    setLoading(true);
    try {
      try {
        localStorage.setItem('propos:push:user-disabled', 'true');
      } catch {}
      if ('serviceWorker' in navigator) {
        try {
          const registration = await getRegistrationWithTimeout(2500);
          const existing = await registration.pushManager.getSubscription();
          if (existing) {
            await existing.unsubscribe();
          }
        } catch {}
      }
      await jsonRequest(
        '/api/v1/pos/push/subscriptions',
        {},
        { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken ?? '' } },
      ).catch(() => {});
      subscriptionSyncPromise = null;
      setSubscriptionActive(false);
      messageApi.success('Đã tắt thông báo trên thiết bị này.');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể tắt thông báo.');
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
    const modalVisible =
      autoPromptOpen &&
      supported &&
      (adminRequested || (permission === 'default' && !isUserDisabled()));

    return (
      <>
        {holder}
        <Modal
          open={modalVisible}
          title={
            adminRequested
              ? '🔔 Quản trị viên yêu cầu bật thông báo'
              : '🔔 Cho phép nhận thông báo từ Pro POS?'
          }
          okText="Bật thông báo ngay"
          cancelText="Để sau"
          confirmLoading={loading}
          onOk={() => void enable()}
          onCancel={() => {
            setAutoPromptOpen(false);
            setAdminRequested(false);
          }}
        >
          {adminRequested ? (
            <p style={{ fontSize: 14 }}>
              Quản trị viên vừa gửi yêu cầu thiết bị POS này bật thông báo PWA để nhận chuông báo
              khi có <strong>đơn thanh toán thành công</strong>, <strong>khách gọi phục vụ</strong>{' '}
              hoặc <strong>gọi món QR mới</strong>.
            </p>
          ) : (
            <p style={{ fontSize: 14 }}>
              Pro POS cần quyền gửi thông báo để báo ngay khi có{' '}
              <strong>đơn thanh toán thành công</strong>, <strong>khách gọi nhân viên</strong> hoặc{' '}
              <strong>gọi món QR mới</strong>, kể cả khi thiết bị đang khóa màn hình.
            </p>
          )}
          <p style={{ marginBottom: 0, color: '#64748b', fontSize: 12.5 }}>
            💡 Bạn có thể tắt hoặc bật lại bất cứ lúc nào trong mục <strong>Cài đặt POS</strong>.
          </p>
        </Modal>
      </>
    );
  }

  if (!showGuide) return control;
  return (
    <div className={`pos-push-guide ${enabled ? 'is-enabled' : ''}`}>
      {holder}
      <div className="pos-push-guide__heading">
        <div className="pos-push-guide__info">
          <div className="pos-push-guide__title-row">
            <span className="pos-push-guide__title">Thông báo PWA & âm thanh</span>
            {enabled ? (
              <Tag color="success" className="pos-push-guide__status-tag">
                🟢 Đang nhận thông báo
              </Tag>
            ) : (
              <Tag color="default" className="pos-push-guide__status-tag">
                ⚪ Chưa bật
              </Tag>
            )}
          </div>
          <span className="pos-push-guide__desc">
            {enabled
              ? 'Thiết bị đang nhận thông báo đẩy khi thanh toán thành công, gọi món và gọi nhân viên.'
              : 'Bật thông báo để nghe chuông báo khi có thanh toán thành công hoặc khách gọi món.'}
          </span>
          {permission === 'denied' && (
            <div className="pos-push-guide__denied-alert">
              ⚠️ Quyền thông báo đang bị chặn trong trình duyệt. Vui lòng mở Cài đặt trang web của
              trình duyệt để cho phép lại.
            </div>
          )}
        </div>
        <div className="pos-push-guide__actions">
          {enabled ? (
            <Popconfirm
              title="Tắt thông báo trên thiết bị này?"
              description="Thiết bị này sẽ không còn nhận thông báo đẩy khi thanh toán thành công hoặc gọi món."
              okText="Tắt thông báo"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => void disable()}
            >
              <Button
                loading={loading}
                icon={<BellOutlined />}
                className="pos-push-action-btn pos-push-action-btn--disable"
              >
                <span>Tắt thông báo</span>
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              loading={loading}
              icon={<BellOutlined />}
              onClick={() => void enable()}
              className="pos-push-action-btn pos-push-action-btn--enable"
            >
              <span>Bật thông báo</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
