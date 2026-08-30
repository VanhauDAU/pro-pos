import type { ApiErrorEnvelope, ApiSuccessEnvelope } from '@contracts/api';

import { beginMutation, endMutation } from './request-activity';
import { posApiContext, recordPosApiMetric } from './pos-performance';

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly details: unknown;
  readonly status: number;

  constructor(envelope: ApiErrorEnvelope, status: number) {
    super(envelope.error.message);
    this.name = 'ApiError';
    this.code = envelope.error.code;
    this.requestId = envelope.error.requestId;
    this.details = envelope.error.details;
    this.status = status;
  }
}

interface ApiRequestOptions {
  skipMutationTracking?: boolean;
  actionId?: string;
}

function requestActionId(method: string, supplied?: string) {
  if (supplied) return supplied;
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? crypto.randomUUID() : null;
}

function rememberMutationId(headers: Headers) {
  const mutationId = headers.get('Idempotency-Key');
  if (!mutationId || typeof sessionStorage === 'undefined') return;
  try {
    const key = 'propos:recent-mutations';
    const now = Date.now();
    const previous = JSON.parse(sessionStorage.getItem(key) ?? '[]') as Array<{
      id: string;
      at: number;
    }>;
    const recent = previous.filter((item) => now - item.at < 60_000).slice(-99);
    recent.push({ id: mutationId, at: now });
    sessionStorage.setItem(key, JSON.stringify(recent));
  } catch {
    // Session storage is an optimization only.
  }
}

function logRequestMetric(input: {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  actionId: string | null;
  requestId: string | null;
  attempt: number;
}) {
  if (!import.meta.env.DEV) return;
  const level = input.durationMs > 500 ? 'warn' : 'debug';
  console[level]('[API]', input);
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit & ApiRequestOptions,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutation =
    !init?.skipMutationTracking && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isMutation) beginMutation();
  try {
    const actionId = requestActionId(method, init?.actionId);
    const requestInit: RequestInit = {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(actionId ? { 'X-Action-ID': actionId } : {}),
        ...init?.headers,
      },
    };
    const execute = async (attempt: number) => {
      const startedAt = performance.now();
      const response = await fetch(path, requestInit);
      const payload = (await response.json()) as ApiSuccessEnvelope<T> | ApiErrorEnvelope;
      const durationMs = performance.now() - startedAt;
      logRequestMetric({
        path,
        method,
        status: response.status,
        durationMs: Math.round(durationMs),
        actionId,
        requestId: response.headers.get('X-Request-ID'),
        attempt,
      });
      if (path.startsWith('/api/v1/pos/')) {
        recordPosApiMetric({
          context: posApiContext(path),
          method,
          status: response.status,
          durationMs,
        });
      }
      if (!response.ok || 'error' in payload) {
        throw new ApiError(payload as ApiErrorEnvelope, response.status);
      }
      if (isMutation) rememberMutationId(new Headers(requestInit.headers));
      return payload.data;
    };
    try {
      return await execute(1);
    } catch (error) {
      const headers = new Headers(requestInit.headers);
      const canSafelyRetry =
        isMutation &&
        headers.has('Idempotency-Key') &&
        !(error instanceof ApiError) &&
        !(error instanceof DOMException && error.name === 'AbortError');
      if (!canSafelyRetry) throw error;
      return execute(2);
    }
  } finally {
    if (isMutation) endMutation();
  }
}

export function jsonRequest<T>(
  path: string,
  body: unknown,
  init?: RequestInit & ApiRequestOptions,
) {
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
