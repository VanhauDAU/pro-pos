import type { PrintAgentConfig } from './config';

export class AgentApiClient {
  constructor(private readonly config: PrintAgentConfig) {}

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

  async get<T>(path: string): Promise<T> {
    const url = new URL(path, this.config.serverUrl).toString();
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API GET ${path} failed (${response.status}): ${errorText}`);
    }
    const json = (await response.json()) as { data?: T } | T;
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
  }

  async getBytes(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const url = new URL(path, this.config.serverUrl).toString();
    const response = await fetch(url, { method: 'GET', headers: this.headers });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API GET ${path} failed (${response.status}): ${errorText}`);
    }
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
    const response = await fetch(parsed, {
      method: 'GET',
      headers: { Accept: 'image/png' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Không thể tải VietQR image (${response.status}).`);
    }
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('png')) {
      throw new Error(`VietQR trả về định dạng không hỗ trợ: ${contentType || 'unknown'}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.config.serverUrl).toString();
    const options: RequestInit = {
      method: 'POST',
      headers: this.headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API POST ${path} failed (${response.status}): ${errorText}`);
    }
    const json = (await response.json()) as { data?: T } | T;
    return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
  }
}
