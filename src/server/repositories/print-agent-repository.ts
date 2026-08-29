export interface PrintAgentRecord {
  id: string;
  store_id: string;
  device_name: string;
  agent_secret_hash: string;
  printer_role: string;
  printer_config_json: string | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PrintAgentPairingRecord {
  session_id: string;
  pairing_code: string;
  store_id: string | null;
  agent_id: string | null;
  agent_secret: string | null;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED';
  expires_at: number;
  created_at: number;
}

export class PrintAgentRepository {
  constructor(private readonly db: D1Database) {}

  async createPairingSession(
    sessionId: string,
    pairingCode: string,
    expiresAt: number,
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO print_agent_pairings (session_id, pairing_code, status, expires_at, created_at)
         VALUES (?, ?, 'PENDING', ?, ?)`,
      )
      .bind(sessionId, pairingCode, expiresAt, now)
      .run();
  }

  async getPairingSession(sessionId: string): Promise<PrintAgentPairingRecord | null> {
    const now = Date.now();
    const row = await this.db
      .prepare(`SELECT * FROM print_agent_pairings WHERE session_id = ? AND expires_at > ?`)
      .bind(sessionId, now)
      .first<PrintAgentPairingRecord>();
    return row ?? null;
  }

  async findPairingByCode(pairingCode: string): Promise<PrintAgentPairingRecord | null> {
    const now = Date.now();
    const row = await this.db
      .prepare(
        `SELECT * FROM print_agent_pairings WHERE pairing_code = ? AND status = 'PENDING' AND expires_at > ?`,
      )
      .bind(pairingCode.replace(/\s|-/g, ''), now)
      .first<PrintAgentPairingRecord>();
    return row ?? null;
  }

  async approvePairingSession(
    sessionId: string,
    storeId: string,
    agentId: string,
    agentSecret: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE print_agent_pairings
         SET status = 'APPROVED', store_id = ?, agent_id = ?, agent_secret = ?
         WHERE session_id = ? AND status = 'PENDING'`,
      )
      .bind(storeId, agentId, agentSecret, sessionId)
      .run();
  }

  async createAgent(
    id: string,
    storeId: string,
    deviceName: string,
    agentSecretHash: string,
    printerRole = 'receipt',
    printerConfigJson?: string | null,
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO print_agents (id, store_id, device_name, agent_secret_hash, printer_role, printer_config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        storeId,
        deviceName,
        agentSecretHash,
        printerRole,
        printerConfigJson ?? null,
        now,
        now,
      )
      .run();
  }

  async findAgentById(id: string): Promise<PrintAgentRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM print_agents WHERE id = ?`)
      .bind(id)
      .first<PrintAgentRecord>();
    return row ?? null;
  }

  async listAgentsByStore(storeId: string): Promise<PrintAgentRecord[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM print_agents WHERE store_id = ? ORDER BY created_at DESC`)
      .bind(storeId)
      .all<PrintAgentRecord>();
    return rows.results ?? [];
  }

  async updateLastSeen(agentId: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(`UPDATE print_agents SET last_seen_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, agentId)
      .run();
  }

  async deleteAgent(agentId: string, storeId: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM print_agents WHERE id = ? AND store_id = ?`)
      .bind(agentId, storeId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}
