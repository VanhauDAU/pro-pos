import webpush from 'web-push';

import { PushSubscriptionRepository } from '@server/repositories/push-subscription-repository';

export interface StorePushNotification {
  storeId: string;
  kind:
    | 'QR_ORDER'
    | 'CALL_STAFF'
    | 'CHECKOUT_REQUEST'
    | 'TABLE_OPEN_REQUEST'
    | 'PRINT_COMPLETED'
    | 'PRINT_FAILED'
    | 'PRINT_UNCERTAIN';
  soundType?: 'NEW_QR_ORDER' | 'CHECKOUT_REQUEST' | 'TABLE_OPEN_REQUEST' | 'NOTIFICATION_CHIME';
  title: string;
  body: string;
  url: string;
  tag: string;
  timestamp: number;
  requestId?: string;
  orderId?: string;
  actionTitle?: string;
  badgeCount?: number;
  requireInteraction?: boolean;
}

export class PushNotificationService {
  private readonly repository: PushSubscriptionRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PushSubscriptionRepository(env.DB);
  }

  isConfigured() {
    return Boolean(
      this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY && this.env.VAPID_SUBJECT,
    );
  }

  async sendStoreNotification(input: StorePushNotification) {
    if (!this.isConfigured()) return { sent: 0, disabled: true };
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      this.env.VAPID_PUBLIC_KEY,
      this.env.VAPID_PRIVATE_KEY,
    );
    const subscriptions = await this.repository.listStore(input.storeId);
    const payload = JSON.stringify(input);
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: 60 * 60, urgency: 'high' },
          );
          sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.repository.removeByEndpoint(subscription.endpoint);
          } else {
            failed += 1;
            console.error(
              JSON.stringify({
                level: 'error',
                message: 'push notification delivery failed',
                storeId: input.storeId,
                kind: input.kind,
                requestId: input.requestId,
                statusCode: statusCode ?? null,
              }),
            );
          }
        }
      }),
    );
    return { sent, failed, disabled: false };
  }
}
