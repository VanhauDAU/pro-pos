import type { CustomerGroupInput, CustomerInput } from '@contracts/customer';

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  provinceCode: number | null;
  provinceName: string | null;
  wardCode: number | null;
  wardName: string | null;
  addressLine: string | null;
  note: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  invoiceCount: number;
  totalSpentVnd: number;
  loyaltyPoints: number;
  debtBalanceVnd: number;
  lastOrderAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const CUSTOMER_SELECT = `
  SELECT id, name, phone, email, birth_date AS birthDate, gender,
    province_code AS provinceCode, province_name AS provinceName,
    ward_code AS wardCode, ward_name AS wardName, address_line AS addressLine,
    note, status, invoice_count AS invoiceCount, total_spent_vnd AS totalSpentVnd,
    loyalty_points AS loyaltyPoints, debt_balance_vnd AS debtBalanceVnd,
    last_order_at AS lastOrderAt, created_at AS createdAt, updated_at AS updatedAt
  FROM customers`;

export class CustomerRepository {
  constructor(private readonly db: D1Database) {}

  async list(
    storeId: string,
    input: { search?: string; status?: string; limit: number; offset: number },
  ) {
    const where = ['store_id = ?'];
    const params: unknown[] = [storeId];
    if (input.status) {
      where.push('status = ?');
      params.push(input.status);
    }
    if (input.search?.trim()) {
      where.push('(name LIKE ? COLLATE NOCASE OR normalized_phone LIKE ?)');
      const term = `%${input.search.trim()}%`;
      params.push(term, term);
    }
    const clause = where.join(' AND ');
    const [rows, count] = await Promise.all([
      this.db
        .prepare(`${CUSTOMER_SELECT} WHERE ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .bind(...params, input.limit, input.offset)
        .all<CustomerRow>(),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM customers WHERE ${clause}`)
        .bind(...params)
        .first<{ total: number }>(),
    ]);
    return { results: rows.results, total: count?.total ?? 0 };
  }

  findById(storeId: string, id: string) {
    return this.db
      .prepare(`${CUSTOMER_SELECT} WHERE store_id = ? AND id = ?`)
      .bind(storeId, id)
      .first<CustomerRow>();
  }

  findActiveById(storeId: string, id: string) {
    return this.db
      .prepare(`${CUSTOMER_SELECT} WHERE store_id = ? AND id = ? AND status = 'ACTIVE'`)
      .bind(storeId, id)
      .first<CustomerRow>();
  }

  findByPhone(storeId: string, normalizedPhone: string) {
    return this.db
      .prepare(`${CUSTOMER_SELECT} WHERE store_id = ? AND normalized_phone = ?`)
      .bind(storeId, normalizedPhone)
      .first<CustomerRow>();
  }

  create(input: {
    id: string;
    storeId: string;
    normalizedPhone: string;
    actorId: string;
    now: number;
    data: CustomerInput;
  }) {
    const d = input.data;
    return this.db
      .prepare(
        `INSERT INTO customers (
      id, store_id, name, phone, normalized_phone, email, birth_date, gender,
      province_code, province_name, ward_code, ward_name, address_line, note,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.storeId,
        d.name,
        input.normalizedPhone,
        input.normalizedPhone,
        d.email ?? null,
        d.birthDate ?? null,
        d.gender ?? null,
        d.provinceCode ?? null,
        d.provinceName ?? null,
        d.wardCode ?? null,
        d.wardName ?? null,
        d.addressLine ?? null,
        d.note ?? null,
        input.actorId,
        input.now,
        input.now,
      )
      .run();
  }

  update(input: {
    id: string;
    storeId: string;
    normalizedPhone: string;
    now: number;
    data: CustomerInput;
  }) {
    const d = input.data;
    return this.db
      .prepare(
        `UPDATE customers SET name = ?, phone = ?, normalized_phone = ?,
      email = ?, birth_date = ?, gender = ?, province_code = ?, province_name = ?,
      ward_code = ?, ward_name = ?, address_line = ?, note = ?, updated_at = ?
      WHERE store_id = ? AND id = ?`,
      )
      .bind(
        d.name,
        input.normalizedPhone,
        input.normalizedPhone,
        d.email ?? null,
        d.birthDate ?? null,
        d.gender ?? null,
        d.provinceCode ?? null,
        d.provinceName ?? null,
        d.wardCode ?? null,
        d.wardName ?? null,
        d.addressLine ?? null,
        d.note ?? null,
        input.now,
        input.storeId,
        input.id,
      )
      .run();
  }

  archive(storeId: string, id: string, now: number) {
    return this.db
      .prepare(
        `UPDATE customers SET status = 'ARCHIVED', archived_at = ?, updated_at = ?
      WHERE store_id = ? AND id = ?`,
      )
      .bind(now, now, storeId, id)
      .run();
  }

  async groupsForCustomer(storeId: string, customerId: string) {
    return this.db
      .prepare(
        `SELECT g.id, g.name FROM customer_groups g
      JOIN customer_group_members m ON m.group_id = g.id AND m.store_id = g.store_id
      WHERE g.store_id = ? AND m.customer_id = ? ORDER BY g.name`,
      )
      .bind(storeId, customerId)
      .all<{ id: string; name: string }>();
  }

  async invoices(storeId: string, customerId: string) {
    return this.db
      .prepare(
        `SELECT * FROM (
      SELECT id, display_code AS displayCode, total AS totalVnd, issued_at AS issuedAt
        FROM invoices WHERE store_id = ? AND customer_id = ? AND status = 'COMPLETED'
      UNION ALL
      SELECT id, display_code AS displayCode, total AS totalVnd, issued_at AS issuedAt
        FROM takeaway_invoices WHERE store_id = ? AND customer_id = ? AND status = 'COMPLETED'
      ) ORDER BY issuedAt DESC LIMIT 50`,
      )
      .bind(storeId, customerId, storeId, customerId)
      .all<{ id: string; displayCode: string; totalVnd: number; issuedAt: number }>();
  }

  loyaltyEntries(storeId: string, customerId: string) {
    return this.db
      .prepare(
        `SELECT id, invoice_id AS invoiceId, entry_type AS entryType,
      points, balance_after AS balanceAfter, note, created_at AS createdAt
      FROM customer_loyalty_entries WHERE store_id = ? AND customer_id = ?
      ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(storeId, customerId)
      .all();
  }

  debtEntries(storeId: string, customerId: string) {
    return this.db
      .prepare(
        `SELECT id, invoice_id AS invoiceId, entry_type AS entryType,
      amount_vnd AS amountVnd, payment_method AS paymentMethod, reference, note,
      created_at AS createdAt FROM customer_debt_entries
      WHERE store_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(storeId, customerId)
      .all();
  }

  findDebtPayment(storeId: string, documentId: string) {
    return this.db
      .prepare(
        `SELECT p.id, p.idempotency_key AS referenceCode, p.amount_vnd AS signedAmountVnd,
          p.payment_method AS paymentMethod, p.note, p.created_at AS createdAt,
          c.name AS customerName, c.phone AS customerPhone, c.address_line AS customerAddress,
          c.ward_name AS customerWardName, c.province_name AS customerProvinceName,
          COALESCE((SELECT SUM(e.amount_vnd) FROM customer_debt_entries e
            WHERE e.store_id = p.store_id AND e.customer_id = p.customer_id
              AND e.created_at <= p.created_at), 0) AS debtAfterVnd
        FROM customer_debt_entries p
        JOIN customers c ON c.store_id = p.store_id AND c.id = p.customer_id
        WHERE p.store_id = ? AND p.entry_type = 'PAYMENT'
          AND (p.id = ? OR p.idempotency_key = ? OR p.reference = ?)
        LIMIT 1`,
      )
      .bind(storeId, documentId, documentId, documentId)
      .first<{
        id: string;
        referenceCode: string | null;
        signedAmountVnd: number;
        paymentMethod: 'CASH' | 'BANK_TRANSFER';
        note: string | null;
        createdAt: number;
        customerName: string;
        customerPhone: string;
        customerAddress: string | null;
        customerWardName: string | null;
        customerProvinceName: string | null;
        debtAfterVnd: number;
      }>();
  }

  async listGroups(storeId: string) {
    return this.db
      .prepare(
        `SELECT g.id, g.name, g.membership_type AS membershipType,
      g.rules_json AS rulesJson, g.note, g.created_at AS createdAt, g.updated_at AS updatedAt,
      COUNT(m.customer_id) AS manualCount
      FROM customer_groups g LEFT JOIN customer_group_members m ON m.group_id = g.id
      WHERE g.store_id = ? GROUP BY g.id ORDER BY g.updated_at DESC`,
      )
      .bind(storeId)
      .all<{
        id: string;
        name: string;
        membershipType: 'MANUAL' | 'AUTOMATIC';
        rulesJson: string | null;
        note: string | null;
        createdAt: number;
        updatedAt: number;
        manualCount: number;
      }>();
  }

  async findGroup(storeId: string, id: string) {
    const group = await this.db
      .prepare(
        `SELECT id, name, membership_type AS membershipType,
      rules_json AS rulesJson, note, created_at AS createdAt, updated_at AS updatedAt
      FROM customer_groups WHERE store_id = ? AND id = ?`,
      )
      .bind(storeId, id)
      .first<{
        id: string;
        name: string;
        membershipType: 'MANUAL' | 'AUTOMATIC';
        rulesJson: string | null;
        note: string | null;
        createdAt: number;
        updatedAt: number;
      }>();
    if (!group) return null;
    const members = await this.db
      .prepare(
        `SELECT customer_id AS customerId FROM customer_group_members
      WHERE store_id = ? AND group_id = ?`,
      )
      .bind(storeId, id)
      .all<{ customerId: string }>();
    return { ...group, customerIds: members.results.map((row) => row.customerId) };
  }

  async saveGroup(input: {
    id: string;
    storeId: string;
    actorId: string;
    now: number;
    data: CustomerGroupInput;
    existing: boolean;
  }) {
    const rules =
      input.data.membershipType === 'AUTOMATIC' ? JSON.stringify(input.data.rules) : null;
    const statements: D1PreparedStatement[] = [];
    if (input.existing) {
      statements.push(
        this.db
          .prepare(
            `UPDATE customer_groups SET name = ?, membership_type = ?, rules_json = ?, note = ?, updated_at = ? WHERE store_id = ? AND id = ?`,
          )
          .bind(
            input.data.name,
            input.data.membershipType,
            rules,
            input.data.note ?? null,
            input.now,
            input.storeId,
            input.id,
          ),
      );
      statements.push(
        this.db
          .prepare('DELETE FROM customer_group_members WHERE store_id = ? AND group_id = ?')
          .bind(input.storeId, input.id),
      );
    } else {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO customer_groups (id, store_id, name, membership_type, rules_json, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.id,
            input.storeId,
            input.data.name,
            input.data.membershipType,
            rules,
            input.data.note ?? null,
            input.actorId,
            input.now,
            input.now,
          ),
      );
    }
    if (input.data.membershipType === 'MANUAL') {
      for (const customerId of input.data.customerIds) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO customer_group_members (store_id, group_id, customer_id, added_at)
          SELECT ?, ?, id, ? FROM customers WHERE store_id = ? AND id = ? AND status = 'ACTIVE'`,
            )
            .bind(input.storeId, input.id, input.now, input.storeId, customerId),
        );
      }
    }
    await this.db.batch(statements);
  }

  deleteGroup(storeId: string, id: string) {
    return this.db
      .prepare('DELETE FROM customer_groups WHERE store_id = ? AND id = ?')
      .bind(storeId, id)
      .run();
  }

  getLoyaltySettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT enabled = 1 AS enabled, vnd_per_point AS vndPerPoint
      FROM customer_loyalty_settings WHERE store_id = ?`,
      )
      .bind(storeId)
      .first<{ enabled: number; vndPerPoint: number }>();
  }

  saveLoyaltySettings(
    storeId: string,
    actorId: string,
    enabled: boolean,
    vndPerPoint: number,
    now: number,
  ) {
    return this.db
      .prepare(
        `INSERT INTO customer_loyalty_settings (store_id, enabled, vnd_per_point, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(store_id) DO UPDATE SET enabled = excluded.enabled,
      vnd_per_point = excluded.vnd_per_point, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .bind(storeId, enabled ? 1 : 0, vndPerPoint, actorId, now)
      .run();
  }

  async addDebtEntry(input: {
    id: string;
    storeId: string;
    customerId: string;
    type: 'PAYMENT' | 'ADJUSTMENT';
    amountVnd: number;
    method?: 'CASH' | 'BANK_TRANSFER';
    note: string | null;
    actorId: string;
    idempotencyKey: string;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_debt_entries (id, store_id, customer_id, entry_type, amount_vnd,
        payment_method, note, actor_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.storeId,
          input.customerId,
          input.type,
          input.amountVnd,
          input.method ?? null,
          input.note,
          input.actorId,
          input.idempotencyKey,
          input.now,
        ),
      this.db
        .prepare(
          `UPDATE customers SET debt_balance_vnd = debt_balance_vnd + ?, updated_at = ?
        WHERE store_id = ? AND id = ? AND debt_balance_vnd + ? >= 0`,
        )
        .bind(input.amountVnd, input.now, input.storeId, input.customerId, input.amountVnd),
    ]);
  }
}
