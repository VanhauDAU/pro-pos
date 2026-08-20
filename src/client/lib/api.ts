import type { ApiErrorEnvelope, ApiSuccessEnvelope } from '@contracts/api';

import { beginMutation, endMutation } from './request-activity';

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
  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isMutation) beginMutation();
  try {
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
  } finally {
    if (isMutation) endMutation();
  }
}

export function jsonRequest<T>(path: string, body: unknown, init?: RequestInit) {
  return apiRequest<T>(path, {
    ...init,
    method: init?.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    body: JSON.stringify(body),
  });
}
