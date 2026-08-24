import { describe, expect, it } from 'vitest';

import {
  getGuestAssistantActions,
  getGuestAssistantNarration,
  guestAssistantStorageKey,
} from '../../src/client/features/guest/guest-assistant';

describe('guest QR robot assistant', () => {
  it('offers table opening and menu browsing for an available table', () => {
    const actions = getGuestAssistantActions('AVAILABLE');

    expect(actions.map((option) => option.action)).toEqual(['OPEN_TABLE', 'BROWSE_MENU']);
    expect(actions.every((option) => !option.disabled)).toBe(true);
  });

  it('shows the pending opening state without exposing unavailable service actions', () => {
    const actions = getGuestAssistantActions('OPEN_REQUESTED');

    expect(actions.map((option) => option.action)).toEqual(['OPEN_TABLE', 'BROWSE_MENU']);
    expect(actions[0]).toMatchObject({ label: 'Đang chờ mở bàn', disabled: true });
  });

  it('offers ordering, staff assistance and checkout for an open table', () => {
    expect(getGuestAssistantActions('OPEN').map((option) => option.action)).toEqual([
      'BROWSE_MENU',
      'CALL_STAFF',
      'CHECKOUT',
    ]);
  });

  it('keeps narration and session storage scoped to the current QR token', () => {
    expect(getGuestAssistantNarration('AVAILABLE')).toContain('Bàn hiện chưa mở');
    expect(getGuestAssistantNarration('OPEN_REQUESTED')).toContain('đã báo nhân viên');
    expect(getGuestAssistantNarration('OPEN')).toContain('Bàn đã sẵn sàng');
    expect(guestAssistantStorageKey('qr-token-a')).not.toBe(guestAssistantStorageKey('qr-token-b'));
  });
});
