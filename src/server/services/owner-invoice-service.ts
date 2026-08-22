import { OwnerInvoiceRepository } from '@server/repositories/owner-invoice-repository';
import { AppError } from '@server/lib/app-error';
import type { AppEnv } from '@server/types';

interface ListInvoicesInput {
  storeId: string;
  status: 'PAID' | 'CANCELLED' | undefined;
  search: string;
  orderType: 'DINE_IN' | 'TAKEAWAY' | undefined;
  method: 'CASH' | 'BANK_TRANSFER' | undefined;
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  limit: number;
}

export class OwnerInvoiceService {
  private repository: OwnerInvoiceRepository;
  private db: D1Database;

  constructor(env: AppEnv['Bindings']) {
    this.repository = new OwnerInvoiceRepository(env.DB);
    this.db = env.DB;
  }

  async listInvoices(input: ListInvoicesInput) {
    const { results, total } = await this.repository.listInvoices(input);
    return {
      results,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async deleteInvoice(input: {
    storeId: string;
    targetId: string;
    actorUserId: string;
    requestId: string;
  }) {
    const financial = await this.db
      .prepare(
        `SELECT * FROM (
      SELECT i.id AS invoiceId, i.customer_id AS customerId, i.total, i.issued_at AS issuedAt
        FROM invoices i WHERE i.store_id = ? AND (i.id = ? OR i.order_id = ?)
      UNION ALL
      SELECT i.id AS invoiceId, i.customer_id AS customerId, i.total, i.issued_at AS issuedAt
        FROM takeaway_invoices i WHERE i.store_id = ? AND (i.id = ? OR i.order_id = ?)
      ) LIMIT 1`,
      )
      .bind(
        input.storeId,
        input.targetId,
        input.targetId,
        input.storeId,
        input.targetId,
        input.targetId,
      )
      .first<{ invoiceId: string; customerId: string | null; total: number; issuedAt: number }>();
    if (financial?.customerId) {
      const charge = await this.db
        .prepare(
          `SELECT amount_vnd AS amountVnd, created_at AS createdAt
        FROM customer_debt_entries WHERE store_id = ? AND invoice_id = ? AND entry_type = 'CHARGE'`,
        )
        .bind(input.storeId, financial.invoiceId)
        .first<{ amountVnd: number; createdAt: number }>();
      if (charge) {
        const laterPayment = await this.db
          .prepare(
            `SELECT 1 AS found FROM customer_debt_entries
          WHERE store_id = ? AND customer_id = ? AND entry_type = 'PAYMENT' AND created_at >= ? LIMIT 1`,
          )
          .bind(input.storeId, financial.customerId, charge.createdAt)
          .first();
        if (laterPayment)
          throw new AppError(
            'INVOICE_DEBT_ALREADY_COLLECTED',
            'Không thể xóa hóa đơn vì công nợ liên quan đã được thu.',
            409,
          );
      }
    }
    const result = await this.repository.deleteInvoice(
      input.storeId,
      input.targetId,
      input.actorUserId,
      input.requestId,
    );
    if (financial?.customerId) {
      const earned = await this.db
        .prepare(
          `SELECT COALESCE(SUM(points), 0) AS points FROM customer_loyalty_entries
        WHERE store_id = ? AND invoice_id = ? AND entry_type = 'EARN'`,
        )
        .bind(input.storeId, financial.invoiceId)
        .first<{ points: number }>();
      const charge = await this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_vnd), 0) AS amountVnd FROM customer_debt_entries
        WHERE store_id = ? AND invoice_id = ? AND entry_type = 'CHARGE'`,
        )
        .bind(input.storeId, financial.invoiceId)
        .first<{ amountVnd: number }>();
      const points = earned?.points ?? 0;
      const debt = charge?.amountVnd ?? 0;
      const now = Date.now();
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `UPDATE customers SET
        invoice_count = MAX(0, invoice_count - 1), total_spent_vnd = MAX(0, total_spent_vnd - ?),
        loyalty_points = loyalty_points - ?, debt_balance_vnd = MAX(0, debt_balance_vnd - ?), updated_at = ?
        WHERE store_id = ? AND id = ?`,
          )
          .bind(financial.total, points, debt, now, input.storeId, financial.customerId),
        this.db
          .prepare('DELETE FROM invoice_payment_allocations WHERE store_id = ? AND invoice_id = ?')
          .bind(input.storeId, financial.invoiceId),
      ];
      if (points)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO customer_loyalty_entries
        (id, store_id, customer_id, invoice_id, entry_type, points, balance_after, note, actor_user_id, created_at)
        SELECT ?, ?, ?, ?, 'REVERSAL', ?, loyalty_points, 'Đảo điểm do xóa hóa đơn', ?, ? FROM customers WHERE store_id = ? AND id = ?`,
            )
            .bind(
              crypto.randomUUID(),
              input.storeId,
              financial.customerId,
              financial.invoiceId,
              -points,
              input.actorUserId,
              now,
              input.storeId,
              financial.customerId,
            ),
        );
      if (debt)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO customer_debt_entries
        (id, store_id, customer_id, invoice_id, entry_type, amount_vnd, note, actor_user_id, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, 'REVERSAL', ?, 'Đảo công nợ do xóa hóa đơn', ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              input.storeId,
              financial.customerId,
              financial.invoiceId,
              -debt,
              input.actorUserId,
              `delete-invoice:${financial.invoiceId}`,
              now,
            ),
        );
      await this.db.batch(statements);
    }
    return result;
  }
}
