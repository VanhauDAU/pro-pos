import type { PrintAgentConfig } from './config';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;

export interface AgentApiClientOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentApiError';
  }
}

function parseRetryAfter(response: Response, now = Date.now()): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export class AgentApiClient {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private retryTotal = 0;

  constructor(
    private readonly config: PrintAgentConfig,
    options: AgentApiClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep =
      options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.random = options.random ?? Math.random;
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Print-Agent-Protocol': '2',
    };
    if (this.config.agentId && this.config.agentSecret) {
      headers['X-Agent-Id'] = this.config.agentId;
      headers['X-Agent-Secret'] = this.config.agentSecret;
    }
    return headers;
  }

  private retryDelay(attempt: number, response?: Response): number {
    const requested = response ? parseRetryAfter(response) : null;
    if (requested !== null) return Math.min(requested, MAX_RETRY_DELAY_MS);
    const base = Math.min(200 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    return Math.round(base * (0.8 + this.random() * 0.4));
  }

  getRetryTotal(): number {
    return this.retryTotal;
  }

  private async request(path: string, init: RequestInit, allowRetry = true): Promise<Response> {
    const url = new URL(path, this.config.serverUrl).toString();
    let lastError: AgentApiError | null = null;
    const attempts = allowRetry ? this.maxAttempts : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
        response = await fetch(url, {
          ...init,
          signal,
        });
      } catch (error) {
        if (init.signal?.aborted) {
          throw new AgentApiError(
            `API ${init.method ?? 'GET'} ${path} aborted.`,
            null,
            path,
            false,
            { cause: error },
          );
        }
        lastError = new AgentApiError(
          `API ${init.method ?? 'GET'} ${path} network failure: ${error instanceof Error ? error.message : String(error)}`,
          null,
          path,
          true,
          { cause: error },
        );
        if (attempt === attempts) throw lastError;
        const delayMs = this.retryDelay(attempt);
        this.retryTotal += 1;
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'print agent API retry',
            path,
            attempt,
            delayMs,
            reason: 'NETWORK',
          }),
        );
        await this.sleep(delayMs);
        continue;
      }

      if (response.ok) return response;
      const responseText = await response.text().catch(() => '');
      const canRetry = isRetryableStatus(response.status);
      lastError = new AgentApiError(
        `API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${responseText}`,
        response.status,
        path,
        canRetry,
      );
      if (!canRetry || attempt === attempts) throw lastError;
      const delayMs = this.retryDelay(attempt, response);
      this.retryTotal += 1;
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'print agent API retry',
          path,
          attempt,
          delayMs,
          status: response.status,
        }),
      );
      await this.sleep(delayMs);
    }
    throw lastError ?? new AgentApiError(`API request failed: ${path}`, null, path, true);
  }

  private async json<T>(response: Response): Promise<T> {
    const value = (await response.json()) as { data?: T } | T;
    return (value && typeof value === 'object' && 'data' in value ? value.data : value) as T;
  }

  async get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.json<T>(
      await this.request(path, {
        method: 'GET',
        headers: this.headers,
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
    );
  }

  async getBytes(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const response = await this.request(path, { method: 'GET', headers: this.headers });
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('Content-Type'),
    };
  }

  /** Downloads a whitelisted public QR image without forwarding Agent credentials. */
  async getPublicPng(url: string): Promise<Uint8Array> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'img.vietqr.io') {
      throw new Error('Public receipt image URL không nằm trong danh sách cho phép.');
    }
    const response = await this.request(parsed.toString(), {
      method: 'GET',
      headers: { Accept: 'image/png' },
    });
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('png')) {
      throw new Error(`VietQR trả về định dạng không hỗ trợ: ${contentType || 'unknown'}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async post<T>(path: string, body?: unknown, options?: { retry?: boolean }): Promise<T> {
    const response = await this.request(
      path,
      {
        method: 'POST',
        headers: this.headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      options?.retry ?? true,
    );
    return this.json<T>(response);
  }
}
