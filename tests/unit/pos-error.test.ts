import { describe, expect, it } from 'vitest';

import { ApiError } from '@client/lib/api';
import { posErrorText } from '@client/features/pos/pos-error';

describe('POS error text', () => {
  it('shows the first validation issue, field path and request id', () => {
    const error = new ApiError(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dữ liệu không hợp lệ.',
          requestId: 'req-validation-1',
          details: {
            issues: [{ path: ['items', 0, 'quantityMilli'], message: 'Số lượng phải lớn hơn 0.' }],
          },
        },
      },
      422,
    );

    expect(posErrorText(error)).toBe(
      'items.0.quantityMilli: Số lượng phải lớn hơn 0. (Mã yêu cầu: req-validation-1)',
    );
  });

  it('explains version conflicts and keeps the request id', () => {
    const error = new ApiError(
      {
        error: {
          code: 'ORDER_VERSION_CONFLICT',
          message: 'Đơn hàng đã thay đổi.',
          requestId: 'req-conflict-1',
        },
      },
      409,
    );

    expect(posErrorText(error)).toContain('đang tải dữ liệu mới nhất');
    expect(posErrorText(error)).toContain('req-conflict-1');
  });
});
