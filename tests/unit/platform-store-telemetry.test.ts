import { describe, expect, it } from 'vitest';

describe('Platform Store Telemetry & Session Presence Logic', () => {
  const PRESENCE_ONLINE_WINDOW_MS = 5 * 60_000;

  function calculatePresenceStatus(
    session: {
      status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
      expiresAt: number;
      lastSeenAt: number;
    },
    now: number,
  ): 'ONLINE' | 'OFFLINE' | 'REVOKED' | 'EXPIRED' {
    if (session.status === 'REVOKED') return 'REVOKED';
    if (session.status === 'EXPIRED' || now >= session.expiresAt) return 'EXPIRED';
    if (session.status === 'ACTIVE') {
      const isOnline = now - session.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS;
      return isOnline ? 'ONLINE' : 'OFFLINE';
    }
    return 'EXPIRED';
  }

  it('determines ONLINE when session is ACTIVE, unexpired, and touched within 5 minutes', () => {
    const now = 1_700_000_000_000;
    const session = {
      status: 'ACTIVE' as const,
      expiresAt: now + 3600_000,
      lastSeenAt: now - 60_000, // 1 minute ago
    };

    expect(calculatePresenceStatus(session, now)).toBe('ONLINE');
  });

  it('determines OFFLINE when session is ACTIVE and unexpired but touched over 5 minutes ago', () => {
    const now = 1_700_000_000_000;
    const session = {
      status: 'ACTIVE' as const,
      expiresAt: now + 3600_000,
      lastSeenAt: now - 350_000, // ~5.8 minutes ago
    };

    expect(calculatePresenceStatus(session, now)).toBe('OFFLINE');
  });

  it('determines REVOKED when session status is REVOKED even if touched recently', () => {
    const now = 1_700_000_000_000;
    const session = {
      status: 'REVOKED' as const,
      expiresAt: now + 3600_000,
      lastSeenAt: now - 10_000,
    };

    expect(calculatePresenceStatus(session, now)).toBe('REVOKED');
  });

  it('determines EXPIRED when now >= expiresAt or status is EXPIRED', () => {
    const now = 1_700_000_000_000;
    const session1 = {
      status: 'ACTIVE' as const,
      expiresAt: now - 1000,
      lastSeenAt: now - 10_000,
    };
    const session2 = {
      status: 'EXPIRED' as const,
      expiresAt: now + 3600_000,
      lastSeenAt: now - 10_000,
    };

    expect(calculatePresenceStatus(session1, now)).toBe('EXPIRED');
    expect(calculatePresenceStatus(session2, now)).toBe('EXPIRED');
  });

  it('maps device telemetry properly: only 1 active session per device', () => {
    const now = 1_700_000_000_000;
    const devices = [
      { id: 'dev-1', name: 'Máy POS Thu Ngân', status: 'ACTIVE' as const },
      { id: 'dev-2', name: 'Điện thoại Order 1', status: 'ACTIVE' as const },
      { id: 'dev-3', name: 'Điện thoại Order 2', status: 'ACTIVE' as const },
      { id: 'dev-4', name: 'Điện thoại Order 3', status: 'REVOKED' as const },
    ];

    // Historical sessions: dev-1 has an active online session, dev-2 has an active offline session, dev-3 has old expired sessions
    const sessions = [
      {
        id: 'sess-1',
        deviceId: 'dev-1',
        userId: 'u-1',
        userName: 'Nguyễn Văn A',
        userUsername: 'nva',
        userRoleName: 'Thu ngân',
        status: 'ACTIVE' as const,
        expiresAt: now + 3600_000,
        createdAt: now - 1800_000,
        lastSeenAt: now - 60_000, // 1 min ago -> ONLINE
      },
      {
        id: 'sess-2',
        deviceId: 'dev-2',
        userId: 'u-2',
        userName: 'Trần Thị B',
        userUsername: 'ttb',
        userRoleName: 'Phục vụ',
        status: 'ACTIVE' as const,
        expiresAt: now + 3600_000,
        createdAt: now - 7200_000,
        lastSeenAt: now - 600_000, // 10 mins ago -> OFFLINE
      },
      {
        id: 'sess-3',
        deviceId: 'dev-3',
        userId: 'u-3',
        userName: 'Lê Văn C',
        userUsername: 'lvc',
        userRoleName: 'Phục vụ',
        status: 'EXPIRED' as const,
        expiresAt: now - 3600_000,
        createdAt: now - 14400_000,
        lastSeenAt: now - 7200_000,
      },
    ];

    const mappedDevices = devices.map((d) => {
      const devSessions = sessions.filter((s) => s.deviceId === d.id);
      const currentSession =
        devSessions.find((s) => s.status === 'ACTIVE' && now < s.expiresAt) ?? null;
      const isOnline =
        d.status === 'ACTIVE' &&
        currentSession !== null &&
        now - currentSession.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS;

      return {
        ...d,
        isOnline,
        currentSession,
        sessionCount: devSessions.length,
      };
    });

    // dev-1 should be Online with currentSession
    expect(mappedDevices[0]!.isOnline).toBe(true);
    expect(mappedDevices[0]!.currentSession?.userName).toBe('Nguyễn Văn A');

    // dev-2 should be Offline but has currentSession
    expect(mappedDevices[1]!.isOnline).toBe(false);
    expect(mappedDevices[1]!.currentSession?.userName).toBe('Trần Thị B');

    // dev-3 should be Offline with no currentSession
    expect(mappedDevices[2]!.isOnline).toBe(false);
    expect(mappedDevices[2]!.currentSession).toBeNull();

    // dev-4 revoked should be Offline
    expect(mappedDevices[3]!.isOnline).toBe(false);

    // Online devices count
    const onlineCount = mappedDevices.filter((d) => d.isOnline).length;
    expect(onlineCount).toBe(1);
  });

  it('correctly calculates cancellation rate and order metrics', () => {
    const totalOrders = 200;
    const cancelledOrders = 8;
    const cancelRate =
      totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 1000) / 10 : 0;
    expect(cancelRate).toBe(4);

    const todayInvoices = 15;
    const todayRevenue = 4_500_000;
    const todayAvgOrderValue = todayInvoices > 0 ? Math.round(todayRevenue / todayInvoices) : 0;
    expect(todayAvgOrderValue).toBe(300_000);
  });
});
