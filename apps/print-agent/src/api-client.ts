import type { PrintAgentConfig } from './config';

export class AgentApiClient {
  constructor(private readonly config: PrintAgentConfig) {}

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
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
