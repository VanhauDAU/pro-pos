import type { ApiErrorEnvelope, ApiSuccessEnvelope } from '@contracts/api';

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly details: unknown;

  constructor(envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = 'ApiError';
    this.code = envelope.error.code;
    this.requestId = envelope.error.requestId;
    this.details = envelope.error.details;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  const payload = (await response.json()) as ApiSuccessEnvelope<T> | ApiErrorEnvelope;

  if (!response.ok || 'error' in payload) {
    throw new ApiError(payload as ApiErrorEnvelope);
  }

  return payload.data;
}
