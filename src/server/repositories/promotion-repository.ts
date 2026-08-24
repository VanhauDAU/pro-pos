import type { PromotionInput, PromotionScope, PromotionType } from '@contracts/promotion';

export interface PromotionRow {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  value: number | null;
  minimumOrderVnd: number;
  maximumDiscountVnd: number | null;
  autoApply: 0 | 1;
  startsAt: number;
  endsAt: number | null;
  weekdaysMask: number | null;
  timeRangesJson: string;
  maximumGiftQuantity: number | null;
  giftBuyAny: 0 | 1;
  status: 'ACTIVE' | 'PAUSED';
  createdAt: number;
  updatedAt: number;
}

const PROMOTION_SELECT = `SELECT id, name, promotion_type AS type, scope, value,
  minimum_order_vnd AS minimumOrderVnd, maximum_discount_vnd AS maximumDiscountVnd,
  auto_apply AS autoApply, starts_at AS startsAt, ends_at AS endsAt,
  weekdays_mask AS weekdaysMask, time_ranges_json AS timeRangesJson,
  maximum_gift_quantity AS maximumGiftQuantity, gift_buy_any AS giftBuyAny, status,
  created_at AS createdAt, updated_at AS updatedAt FROM promotions`;

export class PromotionRepository {
  constructor(private readonly db: D1Database) {}

  async list(storeId: string, input: { search?: string; status?: string; type?: string }) {
    const where = ['store_id = ?'];
    const params: unknown[] = [storeId];
    if (input.search) {
      where.push('name LIKE ? COLLATE NOCASE');
      params.push(`%${input.search}%`);
    }
    if (input.status === 'ACTIVE' || input.status === 'PAUSED') {
      where.push('status = ?');
      params.push(input.status);
    }
    if (input.type) {
      where.push('promotion_type = ?');
      params.push(input.type);
    }
    return this.db
      .prepare(`${PROMOTION_SELECT} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
      .bind(...params)
      .all<PromotionRow>();
  }

  listActive(storeId: string) {
    return this.db
      .prepare(`${PROMOTION_SELECT} WHERE store_id = ? AND status = 'ACTIVE' ORDER BY created_at`)
      .bind(storeId)
      .all<PromotionRow>();
  }

  async loadActiveRelations(storeId: string) {
    const [targets, gifts, groups] = await Promise.all([
      this.db
        .prepare(
          `SELECT pt.promotion_id AS promotionId, pt.target_type AS targetType,
                  pt.target_id AS targetId,
                  CASE WHEN pt.variant_id = '' THEN NULL ELSE pt.variant_id END AS variantId,
                  pt.required_quantity AS requiredQuantity,
                  p.name AS productName, pv.name AS variantName, c.name AS categoryName
           FROM promotion_targets pt
           LEFT JOIN products p
             ON p.store_id = pt.store_id AND p.id = pt.target_id
           LEFT JOIN product_variants pv
             ON pv.store_id = pt.store_id AND pv.id = NULLIF(pt.variant_id, '')
           LEFT JOIN categories c
             ON c.store_id = pt.store_id AND c.id = pt.target_id
           JOIN promotions promotion
             ON promotion.store_id = pt.store_id AND promotion.id = pt.promotion_id
            AND promotion.status = 'ACTIVE'
           WHERE pt.store_id = ?
           ORDER BY pt.promotion_id, pt.target_type, pt.target_id, pt.variant_id`,
        )
        .bind(storeId)
        .all<{
          promotionId: string;
          targetType: 'CATEGORY' | 'PRODUCT' | 'GIFT_PRODUCT';
          targetId: string;
          variantId: string | null;
          requiredQuantity: number;
          productName: string | null;
          variantName: string | null;
          categoryName: string | null;
        }>(),
      this.db
        .prepare(
          `SELECT pt.promotion_id AS promotionId, p.id AS productId, pv.id AS variantId,
                  p.name AS productName, pv.name AS variantName, u.name AS unitName,
                  COALESCE(pv.sale_price, 0) AS unitPriceVnd
           FROM promotion_targets pt
           JOIN promotions promotion
             ON promotion.store_id = pt.store_id AND promotion.id = pt.promotion_id
            AND promotion.status = 'ACTIVE'
           JOIN products p
             ON p.store_id = pt.store_id AND p.id = pt.target_id
            AND p.status = 'ACTIVE' AND p.product_type = 'QUANTITY'
           JOIN product_variants pv
             ON pv.store_id = p.store_id AND pv.product_id = p.id
            AND pv.id = CASE
              WHEN pt.variant_id <> '' THEN pt.variant_id
              ELSE (
                SELECT fallback.id FROM product_variants fallback
                WHERE fallback.store_id = p.store_id AND fallback.product_id = p.id
                  AND fallback.status = 'ACTIVE'
                ORDER BY fallback.created_at, fallback.id LIMIT 1
              )
            END
            AND pv.status = 'ACTIVE'
           LEFT JOIN units u ON u.store_id = p.store_id AND u.id = p.unit_id
           WHERE pt.store_id = ? AND pt.target_type = 'GIFT_PRODUCT'
           ORDER BY pt.promotion_id, p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
        )
        .bind(storeId)
        .all<{
          promotionId: string;
          productId: string;
          variantId: string;
          productName: string;
          variantName: string | null;
          unitName: string | null;
          unitPriceVnd: number;
        }>(),
      this.db
        .prepare(
          `SELECT pcg.promotion_id AS promotionId, pcg.customer_group_id AS groupId
           FROM promotion_customer_groups pcg
           JOIN promotions promotion
             ON promotion.store_id = pcg.store_id AND promotion.id = pcg.promotion_id
            AND promotion.status = 'ACTIVE'
           WHERE pcg.store_id = ?
           ORDER BY pcg.promotion_id, pcg.customer_group_id`,
        )
        .bind(storeId)
        .all<{ promotionId: string; groupId: string }>(),
    ]);
    return { targets: targets.results, gifts: gifts.results, groups: groups.results };
  }

  find(storeId: string, id: string) {
    return this.db
      .prepare(`${PROMOTION_SELECT} WHERE store_id = ? AND id = ? LIMIT 1`)
      .bind(storeId, id)
      .first<PromotionRow>();
  }

  async targetIds(storeId: string, promotionId: string, targetType: string) {
    return this.db
      .prepare(
        `SELECT target_id AS id FROM promotion_targets
        WHERE store_id = ? AND promotion_id = ? AND target_type = ? ORDER BY target_id`,
      )
      .bind(storeId, promotionId, targetType)
      .all<{ id: string }>();
  }

  async targetRows(storeId: string, promotionId: string, targetType: string) {
    return this.db
      .prepare(
        `SELECT target_id AS productId,
          CASE WHEN variant_id = '' THEN NULL ELSE variant_id END AS variantId,
          required_quantity AS quantity
         FROM promotion_targets
         WHERE store_id = ? AND promotion_id = ? AND target_type = ?
         ORDER BY target_id, variant_id`,
      )
      .bind(storeId, promotionId, targetType)
      .all<{ productId: string; variantId: string | null; quantity: number }>();
  }

  targetItemDetails(storeId: string, promotionId: string, targetType: 'PRODUCT') {
    return this.db
      .prepare(
        `SELECT p.id AS productId,
          CASE WHEN pt.variant_id = '' THEN NULL ELSE pt.variant_id END AS variantId,
          p.name AS productName, pv.name AS variantName,
          pt.required_quantity AS requiredQuantity
         FROM promotion_targets pt
         JOIN products p ON p.store_id = pt.store_id AND p.id = pt.target_id
         LEFT JOIN product_variants pv
           ON pv.store_id = pt.store_id AND pv.id = NULLIF(pt.variant_id, '')
         WHERE pt.store_id = ? AND pt.promotion_id = ? AND pt.target_type = ?
         ORDER BY p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId, promotionId, targetType)
      .all<{
        productId: string;
        variantId: string | null;
        productName: string;
        variantName: string | null;
        requiredQuantity: number;
      }>();
  }

  targetCategoryNames(storeId: string, promotionId: string) {
    return this.db
      .prepare(
        `SELECT c.name FROM promotion_targets pt
         JOIN categories c ON c.store_id = pt.store_id AND c.id = pt.target_id
         WHERE pt.store_id = ? AND pt.promotion_id = ? AND pt.target_type = 'CATEGORY'
         ORDER BY c.name COLLATE NOCASE`,
      )
      .bind(storeId, promotionId)
      .all<{ name: string }>();
  }

  async customerGroupIds(storeId: string, promotionId: string) {
    return this.db
      .prepare(
        `SELECT customer_group_id AS id FROM promotion_customer_groups
        WHERE store_id = ? AND promotion_id = ? ORDER BY customer_group_id`,
      )
      .bind(storeId, promotionId)
      .all<{ id: string }>();
  }

  async countOwnedIds(
    storeId: string,
    table: 'categories' | 'products' | 'customer_groups',
    ids: string[],
  ) {
    if (ids.length === 0) return 0;
    const marks = ids.map(() => '?').join(',');
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE store_id = ? AND id IN (${marks})`)
      .bind(storeId, ...ids)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async countGiftEligibleProducts(storeId: string, ids: string[]) {
    if (ids.length === 0) return 0;
    const marks = ids.map(() => '?').join(',');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM products
         WHERE store_id = ? AND id IN (${marks}) AND product_type = 'QUANTITY'`,
      )
      .bind(storeId, ...ids)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async countGiftPurchaseEligibleProducts(storeId: string, ids: string[]) {
    if (ids.length === 0) return 0;
    const marks = ids.map(() => '?').join(',');
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM products
         WHERE store_id = ? AND id IN (${marks}) AND product_type <> 'WEIGHT'`,
      )
      .bind(storeId, ...ids)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async targetsBelongToStore(
    storeId: string,
    targets: Array<{ productId: string; variantId: string | null }>,
  ) {
    const checks = await Promise.all(
      targets.map((target) =>
        this.db
          .prepare(
            `SELECT 1 AS found FROM product_variants
             WHERE store_id = ? AND product_id = ? AND (? = '' OR id = ?) LIMIT 1`,
          )
          .bind(storeId, target.productId, target.variantId ?? '', target.variantId ?? '')
          .first<{ found: 1 }>(),
      ),
    );
    return checks.every(Boolean);
  }

  async save(input: {
    id: string;
    storeId: string;
    actorId: string;
    values: PromotionInput;
    now: number;
    updating: boolean;
  }) {
    const v = input.values;
    const statements: D1PreparedStatement[] = [];
    if (input.updating) {
      statements.push(
        this.db
          .prepare(
            `UPDATE promotions SET name = ?, promotion_type = ?, scope = ?, value = ?,
            minimum_order_vnd = ?, maximum_discount_vnd = ?, auto_apply = ?, starts_at = ?,
            ends_at = ?, weekdays_mask = ?, time_ranges_json = ?, maximum_gift_quantity = ?,
            gift_buy_any = ?, updated_at = ? WHERE store_id = ? AND id = ?`,
          )
          .bind(
            v.name,
            v.type,
            v.scope,
            v.value,
            v.minimumOrderVnd,
            v.maximumDiscountVnd,
            v.autoApply ? 1 : 0,
            v.startsAt,
            v.endsAt,
            v.weekdaysMask,
            JSON.stringify(v.timeRanges),
            v.maximumGiftQuantity,
            v.giftBuyAny ? 1 : 0,
            input.now,
            input.storeId,
            input.id,
          ),
      );
      statements.push(
        this.db
          .prepare('DELETE FROM promotion_targets WHERE store_id = ? AND promotion_id = ?')
          .bind(input.storeId, input.id),
        this.db
          .prepare('DELETE FROM promotion_customer_groups WHERE store_id = ? AND promotion_id = ?')
          .bind(input.storeId, input.id),
      );
    } else {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO promotions (id, store_id, name, promotion_type, scope, value,
          minimum_order_vnd, maximum_discount_vnd, auto_apply, starts_at, ends_at,
          weekdays_mask, time_ranges_json, maximum_gift_quantity, gift_buy_any,
          status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
          )
          .bind(
            input.id,
            input.storeId,
            v.name,
            v.type,
            v.scope,
            v.value,
            v.minimumOrderVnd,
            v.maximumDiscountVnd,
            v.autoApply ? 1 : 0,
            v.startsAt,
            v.endsAt,
            v.weekdaysMask,
            JSON.stringify(v.timeRanges),
            v.maximumGiftQuantity,
            v.giftBuyAny ? 1 : 0,
            input.actorId,
            input.now,
            input.now,
          ),
      );
    }
    for (const id of v.categoryIds) statements.push(this.target(input, 'CATEGORY', id, null, 1));
    for (const target of v.productTargets) {
      statements.push(
        this.target(input, 'PRODUCT', target.productId, target.variantId, target.quantity),
      );
    }
    for (const target of v.giftTargets) {
      statements.push(
        this.target(input, 'GIFT_PRODUCT', target.productId, target.variantId, target.quantity),
      );
    }
    for (const id of v.customerGroupIds) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO promotion_customer_groups
        (promotion_id, store_id, customer_group_id) VALUES (?, ?, ?)`,
          )
          .bind(input.id, input.storeId, id),
      );
    }
    await this.db.batch(statements);
  }

  private target(
    input: { id: string; storeId: string },
    type: string,
    targetId: string,
    variantId: string | null,
    quantity: number,
  ) {
    return this.db
      .prepare(
        `INSERT INTO promotion_targets
      (promotion_id, store_id, target_type, target_id, variant_id, required_quantity)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.storeId, type, targetId, variantId ?? '', quantity);
  }

  updateStatus(storeId: string, id: string, status: 'ACTIVE' | 'PAUSED', now: number) {
    return this.db
      .prepare('UPDATE promotions SET status = ?, updated_at = ? WHERE store_id = ? AND id = ?')
      .bind(status, now, storeId, id)
      .run();
  }

  listSelected(storeId: string, orderId: string) {
    return this.db
      .prepare(
        'SELECT promotion_id AS promotionId FROM order_promotions WHERE store_id = ? AND order_id = ?',
      )
      .bind(storeId, orderId)
      .all<{ promotionId: string }>();
  }

  listSuppressed(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT promotion_id AS promotionId FROM order_promotion_suppressions
         WHERE store_id = ? AND order_id = ?`,
      )
      .bind(storeId, orderId)
      .all<{ promotionId: string }>();
  }

  customerInAnyGroup(storeId: string, customerId: string, groupIds: string[]) {
    if (groupIds.length === 0) return Promise.resolve(true);
    const marks = groupIds.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT 1 AS found FROM customer_group_members
      WHERE store_id = ? AND customer_id = ? AND group_id IN (${marks}) LIMIT 1`,
      )
      .bind(storeId, customerId, ...groupIds)
      .first<{ found: 1 }>()
      .then(Boolean);
  }

  async giftProductNames(storeId: string, productIds: string[]) {
    if (productIds.length === 0) return [];
    const marks = productIds.map(() => '?').join(',');
    const result = await this.db
      .prepare(`SELECT name FROM products WHERE store_id = ? AND id IN (${marks}) ORDER BY name`)
      .bind(storeId, ...productIds)
      .all<{ name: string }>();
    return result.results.map((row) => row.name);
  }

  giftItemDetails(storeId: string, promotionId: string) {
    return this.db
      .prepare(
        `SELECT p.id AS productId, pv.id AS variantId,
          p.name AS productName, pv.name AS variantName, u.name AS unitName,
          COALESCE(pv.sale_price, 0) AS unitPriceVnd
         FROM promotion_targets pt
         JOIN products p
           ON p.store_id = pt.store_id AND p.id = pt.target_id
          AND p.status = 'ACTIVE' AND p.product_type = 'QUANTITY'
         JOIN product_variants pv
           ON pv.store_id = p.store_id AND pv.product_id = p.id
          AND pv.id = CASE
            WHEN pt.variant_id <> '' THEN pt.variant_id
            ELSE (
              SELECT fallback.id FROM product_variants fallback
              WHERE fallback.store_id = p.store_id AND fallback.product_id = p.id
                AND fallback.status = 'ACTIVE'
              ORDER BY fallback.created_at, fallback.id LIMIT 1
            )
          END
          AND pv.status = 'ACTIVE'
         LEFT JOIN units u ON u.store_id = p.store_id AND u.id = p.unit_id
         WHERE pt.store_id = ? AND pt.promotion_id = ? AND pt.target_type = 'GIFT_PRODUCT'
         ORDER BY p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId, promotionId)
      .all<{
        productId: string;
        variantId: string;
        productName: string;
        variantName: string | null;
        unitName: string | null;
        unitPriceVnd: number;
      }>();
  }

  async productCategories(storeId: string, productIds: string[]) {
    if (productIds.length === 0) return new Map<string, string | null>();
    const marks = productIds.map(() => '?').join(',');
    const result = await this.db
      .prepare(
        `SELECT id, category_id AS categoryId FROM products
      WHERE store_id = ? AND id IN (${marks})`,
      )
      .bind(storeId, ...productIds)
      .all<{ id: string; categoryId: string | null }>();
    return new Map(result.results.map((row) => [row.id, row.categoryId]));
  }

  async listProductOptions(storeId: string) {
    const result = await this.db
      .prepare(
        `SELECT p.id AS productId, p.name AS productName, p.product_type AS productType,
          p.avatar_type AS avatarType, p.avatar_color AS avatarColor, p.media_id AS mediaId,
          c.id AS categoryId, c.name AS categoryName,
          pv.id AS variantId, pv.name AS variantName, pv.sale_price AS salePriceVnd,
          pv.prompt_price AS promptPrice
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
         WHERE p.store_id = ? AND p.status = 'ACTIVE' AND pv.status = 'ACTIVE'
         ORDER BY p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<{
        productId: string;
        productName: string;
        productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
        avatarType: 'COLOR' | 'IMAGE';
        avatarColor: string | null;
        mediaId: string | null;
        categoryId: string | null;
        categoryName: string | null;
        variantId: string;
        variantName: string;
        salePriceVnd: number | null;
        promptPrice: 0 | 1;
      }>();
    const products = new Map<
      string,
      {
        id: string;
        name: string;
        productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
        avatarType: 'COLOR' | 'IMAGE';
        avatarColor: string | null;
        mediaId: string | null;
        categoryId: string | null;
        categoryName: string | null;
        variants: Array<{
          id: string;
          name: string;
          salePriceVnd: number | null;
          promptPrice: boolean;
        }>;
      }
    >();
    for (const row of result.results) {
      const product = products.get(row.productId) ?? {
        id: row.productId,
        name: row.productName,
        productType: row.productType,
        avatarType: row.avatarType,
        avatarColor: row.avatarColor,
        mediaId: row.mediaId,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        variants: [],
      };
      product.variants.push({
        id: row.variantId,
        name: row.variantName,
        salePriceVnd: row.salePriceVnd,
        promptPrice: row.promptPrice === 1,
      });
      products.set(row.productId, product);
    }
    return [...products.values()];
  }

  async setOrderPromotions(input: {
    storeId: string;
    orderId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    promotionIds: string[];
    suppressedPromotionIds: string[];
    actorId: string;
    expectedVersion: number;
    now: number;
  }) {
    const table = input.orderType === 'TAKEAWAY' ? 'takeaway_orders' : 'orders';
    const order = await this.db
      .prepare(
        `SELECT version FROM ${table} WHERE store_id = ? AND id = ? AND status IN ('OPEN', 'PAYMENT_PENDING')`,
      )
      .bind(input.storeId, input.orderId)
      .first<{ version: number }>();
    if (!order || order.version !== input.expectedVersion)
      throw new Error('ORDER_VERSION_CONFLICT');
    await this.db.batch(this.buildSetOrderPromotionStatements(input));
  }

  buildSetOrderPromotionStatements(input: {
    storeId: string;
    orderId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    promotionIds: string[];
    suppressedPromotionIds: string[];
    actorId: string;
    expectedVersion: number;
    now: number;
  }) {
    const table = input.orderType === 'TAKEAWAY' ? 'takeaway_orders' : 'orders';
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare('DELETE FROM order_promotions WHERE store_id = ? AND order_id = ?')
        .bind(input.storeId, input.orderId),
      this.db
        .prepare('DELETE FROM order_promotion_suppressions WHERE store_id = ? AND order_id = ?')
        .bind(input.storeId, input.orderId),
    ];
    for (const promotionId of input.promotionIds) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO order_promotions
      (store_id, order_id, order_type, promotion_id, applied_by, applied_at) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.storeId,
            input.orderId,
            input.orderType,
            promotionId,
            input.actorId,
            input.now,
          ),
      );
    }
    for (const promotionId of input.suppressedPromotionIds) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO order_promotion_suppressions
             (store_id, order_id, order_type, promotion_id, suppressed_by, suppressed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.storeId,
            input.orderId,
            input.orderType,
            promotionId,
            input.actorId,
            input.now,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE ${table}
           SET version = version + 1, updated_at = ?, promotion_auto_apply_suppressed = ?
           WHERE store_id = ? AND id = ? AND version = ?`,
        )
        .bind(
          input.now,
          input.suppressedPromotionIds.length > 0 ? 1 : 0,
          input.storeId,
          input.orderId,
          input.expectedVersion,
        ),
    );
    return statements;
  }

  saveInvoicePromotion(input: {
    storeId: string;
    invoiceId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    promotionId: string;
    promotionName: string;
    promotionType: string;
    discountAmountVnd: number;
    snapshotJson: string;
    now: number;
  }) {
    return this.buildSaveInvoicePromotionStatement(input).run();
  }

  buildSaveInvoicePromotionStatement(input: {
    storeId: string;
    invoiceId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    promotionId: string;
    promotionName: string;
    promotionType: string;
    discountAmountVnd: number;
    snapshotJson: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO invoice_promotions
      (id, store_id, invoice_id, order_type, promotion_id, promotion_name, promotion_type,
       discount_amount_vnd, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.storeId,
        input.invoiceId,
        input.orderType,
        input.promotionId,
        input.promotionName,
        input.promotionType,
        input.discountAmountVnd,
        input.snapshotJson,
        input.now,
      );
  }
}
