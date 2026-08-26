import { ApiError } from '@client/lib/api';

interface ValidationIssue {
  path?: Array<string | number>;
  message?: string;
}

function requestSuffix(requestId: string) {
  return requestId ? ` (Mã yêu cầu: ${requestId})` : '';
}

export function posErrorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR') {
      const issue = (error.details as { issues?: ValidationIssue[] } | null)?.issues?.[0];
      if (issue?.message) {
        const path = issue.path?.length ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}${requestSuffix(error.requestId)}`;
      }
    }
    if (error.code === 'ORDER_VERSION_CONFLICT') {
      return `Đơn vừa thay đổi trên thiết bị khác. Hệ thống đang tải dữ liệu mới nhất.${requestSuffix(error.requestId)}`;
    }
    return `${error.message}${requestSuffix(error.requestId)}`;
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
}
