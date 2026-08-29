import { AppError } from '@server/lib/app-error';
import {
  PrintAgentRepository,
  type PrintAgentRecord,
} from '@server/repositories/print-agent-repository';

const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class PrintAgentService {
  private readonly repository: PrintAgentRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PrintAgentRepository(env.DB);
  }

  private async hashSecret(secret: string): Promise<string> {
    const pepper = this.env.DEVICE_TOKEN_PEPPER || 'print-agent-secret-pepper';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async createPairingSession(): Promise<{
    sessionId: string;
    pairingCode: string;
    expiresAt: number;
  }> {
    const sessionId = crypto.randomUUID();
    // Generate a secure 6-digit numeric code
    const rawNumber = Math.floor(100000 + Math.random() * 900000);
    const pairingCode = String(rawNumber);
    const expiresAt = Date.now() + PAIRING_TTL_MS;

    await this.repository.createPairingSession(sessionId, pairingCode, expiresAt);

    return { sessionId, pairingCode, expiresAt };
  }

  async getPairingStatus(sessionId: string): Promise<{
    status: 'PENDING' | 'APPROVED' | 'EXPIRED';
    agentId?: string;
    agentSecret?: string;
    storeId?: string;
  }> {
    const session = await this.repository.getPairingSession(sessionId);
    if (!session) {
      return { status: 'EXPIRED' };
    }
    if (
      session.status === 'APPROVED' &&
      session.agent_id &&
      session.agent_secret &&
      session.store_id
    ) {
      return {
        status: 'APPROVED',
        agentId: session.agent_id,
        agentSecret: session.agent_secret,
        storeId: session.store_id,
      };
    }
    return { status: 'PENDING' };
  }

  async confirmPairing(
    pairingCode: string,
    storeId: string,
    deviceName?: string,
  ): Promise<{ agentId: string; deviceName: string }> {
    const session = await this.repository.findPairingByCode(pairingCode);
    if (!session) {
      throw new AppError(
        'INVALID_PAIRING_CODE',
        'Mã ghép nối không hợp lệ hoặc đã hết hạn (5 phút).',
        400,
      );
    }

    const agentId = crypto.randomUUID();
    const rawSecretBytes = new Uint8Array(32);
    crypto.getRandomValues(rawSecretBytes);
    const agentSecret = Array.from(rawSecretBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const secretHash = await this.hashSecret(agentSecret);
    const finalDeviceName = deviceName?.trim() || 'Máy in quầy thu ngân';

    await this.repository.createAgent(agentId, storeId, finalDeviceName, secretHash);
    await this.repository.approvePairingSession(session.session_id, storeId, agentId, agentSecret);

    return { agentId, deviceName: finalDeviceName };
  }

  async verifyAgent(agentId: string, agentSecret: string): Promise<PrintAgentRecord> {
    const agent = await this.repository.findAgentById(agentId);
    if (!agent) {
      throw new AppError('UNAUTHORIZED', 'Print Agent không tồn tại.', 401);
    }
    const hash = await this.hashSecret(agentSecret);
    if (hash !== agent.agent_secret_hash) {
      throw new AppError('UNAUTHORIZED', 'Khóa bảo mật Print Agent không hợp lệ.', 401);
    }
    await this.repository.updateLastSeen(agentId);
    return agent;
  }

  async listStoreAgents(storeId: string): Promise<PrintAgentRecord[]> {
    return this.repository.listAgentsByStore(storeId);
  }

  async removeAgent(agentId: string, storeId: string): Promise<void> {
    const ok = await this.repository.deleteAgent(agentId, storeId);
    if (!ok) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy Print Agent cần xóa.', 404);
    }
  }
}
