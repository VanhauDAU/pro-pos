import type {
  RevenueReportPrintSnapshotDto,
  RevenueReportResponseDto,
} from '@contracts/revenue-report';

interface RevenueReportPrintSnapshotRow {
  id: string;
  storeId: string;
  requestedByName: string;
  payloadJson: string;
  createdAt: number;
  expiresAt: number;
}

export class RevenueReportPrintRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    id: string;
    storeId: string;
    requestedByUserId: string;
    requestedByName: string;
    report: RevenueReportResponseDto;
    createdAt: number;
    expiresAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO revenue_report_print_snapshots
         (id, store_id, requested_by_user_id, requested_by_name, payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.storeId,
        input.requestedByUserId,
        input.requestedByName,
        JSON.stringify(input.report),
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  async get(storeId: string, id: string): Promise<RevenueReportPrintSnapshotDto | null> {
    const row = await this.db
      .prepare(
        `SELECT id, store_id AS storeId, requested_by_name AS requestedByName,
                payload_json AS payloadJson, created_at AS createdAt, expires_at AS expiresAt
         FROM revenue_report_print_snapshots
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, id)
      .first<RevenueReportPrintSnapshotRow>();
    if (!row) return null;
    return {
      id: row.id,
      storeId: row.storeId,
      requestedByName: row.requestedByName,
      report: JSON.parse(row.payloadJson) as RevenueReportResponseDto,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}
