import type { ProductReportPrintSnapshotDto, ProductReportResponseDto } from '@contracts/reports';

interface ProductReportPrintSnapshotRow {
  id: string;
  storeId: string;
  requestedByUserId: string;
  requestedByName: string;
  payloadJson: string;
  createdAt: number;
  expiresAt: number;
}

export class ProductReportPrintRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    id: string;
    storeId: string;
    requestedByUserId: string;
    requestedByName: string;
    report: ProductReportResponseDto;
    createdAt: number;
    expiresAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO product_report_print_snapshots
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

  async get(storeId: string, id: string): Promise<ProductReportPrintSnapshotDto | null> {
    const row = await this.db
      .prepare(
        `SELECT id, store_id AS storeId, requested_by_user_id AS requestedByUserId,
                requested_by_name AS requestedByName, payload_json AS payloadJson,
                created_at AS createdAt, expires_at AS expiresAt
         FROM product_report_print_snapshots
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, id)
      .first<ProductReportPrintSnapshotRow>();
    if (!row) return null;
    return {
      id: row.id,
      storeId: row.storeId,
      requestedByUserId: row.requestedByUserId,
      requestedByName: row.requestedByName,
      report: JSON.parse(row.payloadJson) as ProductReportResponseDto,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}
