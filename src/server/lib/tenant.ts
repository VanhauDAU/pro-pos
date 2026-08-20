import { AppError } from '@server/lib/app-error';

export function assertSameStore(actorStoreId: string, resourceStoreId: string): void {
  if (actorStoreId !== resourceStoreId) {
    throw new AppError(
      'TENANT_BOUNDARY_VIOLATION',
      'Bạn không có quyền thực hiện thao tác này.',
      403,
    );
  }
}
