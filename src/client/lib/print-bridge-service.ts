import { apiRequest, jsonRequest } from './api';

export interface PrintAgentInfo {
  id: string;
  store_id: string;
  device_name: string;
  printer_role: string;
  printer_config_json?: string | null;
  last_seen_at?: number | null;
  is_online?: boolean;
  created_at: number;
}

/** Check if this platform is desktop */
export function isDesktopPlatform(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return !/iPhone|iPad|iPod|Android|Mobile/i.test(ua);
}

export async function listPrintAgents(): Promise<PrintAgentInfo[]> {
  try {
    const agents = await apiRequest<PrintAgentInfo[]>('/api/v1/pos/print-agent/list');
    return Array.isArray(agents) ? agents : [];
  } catch {
    return [];
  }
}

export async function confirmPrintAgentPairing(
  pairingCode: string,
  deviceName?: string,
  csrfToken?: string | null,
): Promise<{ agentId: string; deviceName: string }> {
  return jsonRequest<{ agentId: string; deviceName: string }>(
    '/api/v1/pos/print-agent/pair/confirm',
    {
      pairingCode: pairingCode.replace(/\s|-/g, ''),
      deviceName,
    },
    csrfToken ? { headers: { 'X-CSRF-Token': csrfToken } } : {},
  );
}

export async function removePrintAgent(agentId: string, csrfToken?: string | null): Promise<void> {
  return jsonRequest<void>(
    `/api/v1/pos/print-agent/${agentId}`,
    {},
    {
      method: 'DELETE',
      ...(csrfToken ? { headers: { 'X-CSRF-Token': csrfToken } } : {}),
    },
  );
}
