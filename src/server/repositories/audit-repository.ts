export interface AuditContext {
  actorUserId: string;
  actorSessionId: string | null;
  deviceId: string | null;
  requestId: string;
}

export class AuditRepository {
  constructor(private readonly db: D1Database) {}

  record(input: {
    storeId: string;
    context: AuditContext;
    action: string;
    entityType: string;
    entityId: string | null;
    before: unknown;
    after: unknown;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, store_id, actor_user_id, actor_session_id, device_id,
          action, entity_type, entity_id, request_id, before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.storeId,
        input.context.actorUserId,
        input.context.actorSessionId,
        input.context.deviceId,
        input.action,
        input.entityType,
        input.entityId,
        input.context.requestId,
        input.before === null ? null : JSON.stringify(input.before),
        input.after === null ? null : JSON.stringify(input.after),
        input.now,
      )
      .run();
  }

  enrichByRequest(storeId: string, requestId: string, context: AuditContext) {
    return this.db
      .prepare(
        `UPDATE audit_logs
         SET actor_session_id = ?, device_id = ?
         WHERE store_id = ? AND request_id = ? AND actor_user_id = ?`,
      )
      .bind(context.actorSessionId, context.deviceId, storeId, requestId, context.actorUserId)
      .run();
  }
}
