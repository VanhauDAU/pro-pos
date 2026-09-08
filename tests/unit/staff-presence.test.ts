import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { formatStaffLastSeen, type Employee } from '@client/features/owner/staff-presence';
import { PosRealtimeClient } from '@client/realtime/client';

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('Staff Presence Realtime & Formatting', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createSessionStorage());
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
  });

  it('formats last seen timestamps accurately', () => {
    const now = Date.now();

    expect(formatStaffLastSeen(null, true)).toBe('Đang hoạt động');
    expect(formatStaffLastSeen(now, true)).toBe('Đang hoạt động');
    expect(formatStaffLastSeen(null, false)).toBe('Ngoại tuyến');
    expect(formatStaffLastSeen(undefined, false)).toBe('Ngoại tuyến');

    expect(formatStaffLastSeen(now - 20_000, false)).toBe('Vừa mới đây');
    expect(formatStaffLastSeen(now - 5 * 60_000, false)).toBe('5 phút trước');
    expect(formatStaffLastSeen(now - 2 * 3600_000, false)).toBe('2 giờ trước');
    expect(formatStaffLastSeen(now - 2 * 86400_000, false)).toBe('2 ngày trước');
  });

  it('updates React Query cache in memory when staff presence changes', () => {
    const queryClient = new QueryClient();
    const storeId = 'store-test-123';

    const initialEmployees: Employee[] = [
      {
        id: 'emp-1',
        username: 'nhanvien1',
        displayName: 'Nhân viên 1',
        email: 'nv1@example.com',
        roleId: 'role-1',
        roleName: 'Nhân viên',
        status: 'ACTIVE',
        isOnline: false,
        lastSeenAt: null,
      },
      {
        id: 'emp-2',
        username: 'nhanvien2',
        displayName: 'Nhân viên 2',
        email: 'nv2@example.com',
        roleId: 'role-1',
        roleName: 'Nhân viên',
        status: 'ACTIVE',
        isOnline: true,
        lastSeenAt: Date.now() - 1000,
      },
    ];

    queryClient.setQueryData(['staff-employees-list', '/api/v1/owner/staff'], initialEmployees);
    queryClient.setQueryData(['staff-employees-list', '/api/v1/pos/staff'], initialEmployees);

    const client = new PosRealtimeClient(
      storeId,
      queryClient,
      () => {},
      () => {},
    );

    // Apply individual staff presence update
    const activeTime = Date.now();
    client.applyStaffPresence('emp-1', true, activeTime);

    const updatedOwner = queryClient.getQueryData<Employee[]>([
      'staff-employees-list',
      '/api/v1/owner/staff',
    ]);
    const emp1 = updatedOwner?.find((e) => e.id === 'emp-1');
    expect(emp1?.isOnline).toBe(true);
    expect(emp1?.lastSeenAt).toBe(activeTime);

    const updatedPos = queryClient.getQueryData<Employee[]>([
      'staff-employees-list',
      '/api/v1/pos/staff',
    ]);
    const emp1Pos = updatedPos?.find((e) => e.id === 'emp-1');
    expect(emp1Pos?.isOnline).toBe(true);

    // Disconnect emp-2
    const disconnectTime = Date.now();
    client.applyStaffPresence('emp-2', false, disconnectTime);

    const finalOwner = queryClient.getQueryData<Employee[]>([
      'staff-employees-list',
      '/api/v1/owner/staff',
    ]);
    const emp2 = finalOwner?.find((e) => e.id === 'emp-2');
    expect(emp2?.isOnline).toBe(false);
    expect(emp2?.lastSeenAt).toBe(disconnectTime);

    // Apply batch online user list
    client.applyOnlineUsers(['emp-2']);
    const batchUpdated = queryClient.getQueryData<Employee[]>([
      'staff-employees-list',
      '/api/v1/owner/staff',
    ]);
    expect(batchUpdated?.find((e) => e.id === 'emp-1')?.isOnline).toBe(false);
    expect(batchUpdated?.find((e) => e.id === 'emp-2')?.isOnline).toBe(true);
  });
});
