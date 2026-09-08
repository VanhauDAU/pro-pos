import dayjs from 'dayjs';

export interface Employee {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roleId: string;
  roleName: string;
  isOnline?: boolean;
  lastSeenAt?: number | null;
}

export function formatStaffLastSeen(lastSeenAt?: number | null, isOnline?: boolean): string {
  if (isOnline) return 'Đang hoạt động';
  if (!lastSeenAt) return 'Ngoại tuyến';
  const diffMs = Date.now() - lastSeenAt;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Vừa mới đây';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ngày trước`;
  return dayjs(lastSeenAt).format('DD/MM/YYYY HH:mm');
}
