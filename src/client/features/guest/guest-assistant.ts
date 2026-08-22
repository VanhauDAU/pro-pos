import type { GuestOrderContext, GuestVoiceName } from '@contracts/qr-order';

export type GuestAssistantTableStatus = GuestOrderContext['tableStatus'];

export type GuestAssistantAction = 'OPEN_TABLE' | 'BROWSE_MENU' | 'CALL_STAFF' | 'CHECKOUT';

export type GuestAssistantPhase = 'SPEAKING' | 'CHOOSING' | 'DOCKED' | 'FEEDBACK';

export interface GuestAssistantActionOption {
  action: GuestAssistantAction;
  label: string;
  description: string;
  disabled?: boolean;
}

export interface GuestAssistantFeedback {
  id: number;
  tone: 'success' | 'error';
  message: string;
  audioSrc?: string;
}

export function guestAssistantVoiceUrl(voiceName: GuestVoiceName) {
  return `/api/v1/guest-order/voice/${voiceName}`;
}

export function getGuestAssistantVoiceUrl(status: GuestAssistantTableStatus): string {
  if (status === 'AVAILABLE') return guestAssistantVoiceUrl('guest_qr_available.ogg');
  if (status === 'OPEN_REQUESTED') {
    return guestAssistantVoiceUrl('guest_qr_open_requested.ogg');
  }
  return guestAssistantVoiceUrl('guest_qr_open.ogg');
}

export function guestAssistantStorageKey(token: string) {
  return `pro-pos:guest-assistant:intro:${token}`;
}

export function getGuestAssistantNarration(status: GuestAssistantTableStatus): string {
  if (status === 'AVAILABLE') {
    return 'Xin chào! Bàn hiện chưa mở. Tôi có thể giúp bạn yêu cầu mở bàn hoặc xem thực đơn trước.';
  }
  if (status === 'OPEN_REQUESTED') {
    return 'Tôi đã báo nhân viên mở bàn. Trong lúc chờ, bạn có thể xem và chọn món.';
  }
  return 'Xin chào! Bàn đã sẵn sàng. Bạn muốn tôi giúp gì cho bạn?';
}

export function getGuestAssistantActions(
  status: GuestAssistantTableStatus,
): GuestAssistantActionOption[] {
  if (status === 'AVAILABLE') {
    return [
      {
        action: 'OPEN_TABLE',
        label: 'Yêu cầu mở bàn',
        description: 'Báo nhân viên đến mở bàn',
      },
      {
        action: 'BROWSE_MENU',
        label: 'Tôi muốn gọi món',
        description: 'Xem thực đơn và chọn món trước',
      },
    ];
  }

  if (status === 'OPEN_REQUESTED') {
    return [
      {
        action: 'OPEN_TABLE',
        label: 'Đang chờ mở bàn',
        description: 'Yêu cầu đã được gửi tới nhân viên',
        disabled: true,
      },
      {
        action: 'BROWSE_MENU',
        label: 'Tôi muốn gọi món',
        description: 'Chọn món trong lúc chờ',
      },
    ];
  }

  return [
    {
      action: 'BROWSE_MENU',
      label: 'Tôi muốn gọi món',
      description: 'Mở thực đơn của quán',
    },
    {
      action: 'CALL_STAFF',
      label: 'Gọi nhân viên',
      description: 'Nhờ nhân viên hỗ trợ tại bàn',
    },
    {
      action: 'CHECKOUT',
      label: 'Gọi thanh toán',
      description: 'Yêu cầu chốt giờ và tính tiền',
    },
  ];
}
