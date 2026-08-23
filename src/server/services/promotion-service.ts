import type {
  PosPromotionFlatPriceItem,
  PosPromotionGiftItem,
  PosPromotionOption,
  PromotionDetail,
  PromotionInput,
  PromotionSummary,
} from '@contracts/promotion';
import { AppError } from '@server/lib/app-error';
import { PromotionRepository, type PromotionRow } from '@server/repositories/promotion-repository';

interface PromotionItem {
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  productName: string;
  variantName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  grossLineTotalVnd: number;
  netLineTotalVnd: number;
}

function allocateGiftItems(
  details: Array<Omit<PosPromotionGiftItem, 'quantityMilli' | 'grossAmountVnd'>>,
  maximumQuantity: number,
) {
  if (details.length === 0 || maximumQuantity <= 0) return [];
  const allocated = new Map<string, PosPromotionGiftItem>();
  for (let index = 0; index < maximumQuantity; index += 1) {
    const detail = details[index % details.length]!;
    const key = `${detail.productId}:${detail.variantId}`;
    const current = allocated.get(key);
    const quantityMilli = (current?.quantityMilli ?? 0) + 1000;
    allocated.set(key, {
      ...detail,
      quantityMilli,
      grossAmountVnd: Math.round((detail.unitPriceVnd * quantityMilli) / 1000),
    });
  }
  return [...allocated.values()];
}

function computedStatus(row: PromotionRow, now: number): PromotionSummary['computedStatus'] {
  if (row.status === 'PAUSED') return 'PAUSED';
  if (now < row.startsAt) return 'UPCOMING';
  if (row.endsAt !== null && now > row.endsAt) return 'ENDED';
  return 'ACTIVE';
}

function summary(row: PromotionRow, now: number): PromotionSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scope: row.scope,
    value: row.value,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    autoApply: row.autoApply === 1,
    computedStatus: computedStatus(row, now),
  };
}

function localClock(now: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday ?? '');
  return { weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function minuteInRange(minute: number, start: number, end: number) {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export class PromotionService {
  private readonly repository: PromotionRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PromotionRepository(env.DB);
  }

  async list(storeId: string, filters: { search?: string; status?: string; type?: string }) {
    const rows = await this.repository.list(storeId, filters);
    const now = Date.now();
    return rows.results.map((row) => summary(row, now));
  }

  async detail(storeId: string, id: string): Promise<PromotionDetail> {
    const row = await this.repository.find(storeId, id);
    if (!row)
      throw new AppError('PROMOTION_NOT_FOUND', 'Không tìm thấy chương trình khuyến mại.', 404);
    const [categories, products, groups, gifts] = await Promise.all([
      this.repository.targetIds(storeId, id, 'CATEGORY'),
      this.repository.targetRows(storeId, id, 'PRODUCT'),
      this.repository.customerGroupIds(storeId, id),
      this.repository.targetRows(storeId, id, 'GIFT_PRODUCT'),
    ]);
    return {
      ...summary(row, Date.now()),
      minimumOrderVnd: row.minimumOrderVnd,
      maximumDiscountVnd: row.maximumDiscountVnd,
      weekdaysMask: row.weekdaysMask,
      timeRanges: JSON.parse(row.timeRangesJson) as Array<{
        startMinute: number;
        endMinute: number;
      }>,
      categoryIds: categories.results.map((item) => item.id),
      productIds: [...new Set(products.results.map((item) => item.productId))],
      productTargets: products.results,
      customerGroupIds: groups.results.map((item) => item.id),
      giftProductIds: [...new Set(gifts.results.map((item) => item.productId))],
      giftTargets: gifts.results,
      giftBuyAny: row.giftBuyAny === 1,
      maximumGiftQuantity: row.maximumGiftQuantity,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async save(storeId: string, actorId: string, values: PromotionInput, id?: string) {
    const promotionId = id ?? crypto.randomUUID();
    if (id && !(await this.repository.find(storeId, id))) {
      throw new AppError('PROMOTION_NOT_FOUND', 'Không tìm thấy chương trình khuyến mại.', 404);
    }
    const categoryIds = [...new Set(values.categoryIds)];
    const productTargets = (
      values.productTargets.length > 0
        ? values.productTargets
        : values.productIds.map((productId) => ({ productId, variantId: null, quantity: 1 }))
    ).filter(
      (target, index, all) =>
        all.findIndex(
          (item) => item.productId === target.productId && item.variantId === target.variantId,
        ) === index,
    );
    const giftTargets = (
      values.giftTargets.length > 0
        ? values.giftTargets
        : values.giftProductIds.map((productId) => ({ productId, variantId: null, quantity: 1 }))
    ).filter(
      (target, index, all) =>
        all.findIndex(
          (item) => item.productId === target.productId && item.variantId === target.variantId,
        ) === index,
    );
    const productTargetIds = [...new Set(productTargets.map((target) => target.productId))];
    const giftProductIds = [...new Set(giftTargets.map((target) => target.productId))];
    const productIds = [...new Set([...productTargetIds, ...giftProductIds])];
    const groupIds = [...new Set(values.customerGroupIds)];
    const [
      categoryCount,
      productCount,
      groupCount,
      giftPurchaseEligibleCount,
      giftEligibleCount,
      targetsValid,
    ] = await Promise.all([
      this.repository.countOwnedIds(storeId, 'categories', categoryIds),
      this.repository.countOwnedIds(storeId, 'products', productIds),
      this.repository.countOwnedIds(storeId, 'customer_groups', groupIds),
      this.repository.countGiftPurchaseEligibleProducts(
        storeId,
        values.type === 'GIFT' ? productTargetIds : [],
      ),
      this.repository.countGiftEligibleProducts(storeId, giftProductIds),
      this.repository.targetsBelongToStore(storeId, [...productTargets, ...giftTargets]),
    ]);
    if (
      categoryCount !== categoryIds.length ||
      productCount !== productIds.length ||
      groupCount !== groupIds.length ||
      !targetsValid
    ) {
      throw new AppError(
        'PROMOTION_TARGET_INVALID',
        'Danh mục, mặt hàng hoặc nhóm khách hàng không hợp lệ.',
        422,
      );
    }
    if (
      giftPurchaseEligibleCount !== (values.type === 'GIFT' ? productTargetIds.length : 0) ||
      giftEligibleCount !== giftProductIds.length
    ) {
      throw new AppError(
        'PROMOTION_GIFT_WEIGHT_INVALID',
        'Chỉ mặt hàng bán theo số lượng mới có thể dùng làm món tặng.',
        422,
      );
    }
    await this.repository.save({
      id: promotionId,
      storeId,
      actorId,
      values: {
        ...values,
        categoryIds,
        productIds: productTargetIds,
        productTargets,
        giftProductIds,
        giftTargets,
        customerGroupIds: groupIds,
      },
      now: Date.now(),
      updating: Boolean(id),
    });
    return this.detail(storeId, promotionId);
  }

  listProductOptions(storeId: string) {
    return this.repository.listProductOptions(storeId);
  }

  async setActive(storeId: string, id: string, active: boolean) {
    if (!(await this.repository.find(storeId, id))) {
      throw new AppError('PROMOTION_NOT_FOUND', 'Không tìm thấy chương trình khuyến mại.', 404);
    }
    await this.repository.updateStatus(storeId, id, active ? 'ACTIVE' : 'PAUSED', Date.now());
    return this.detail(storeId, id);
  }

  async optionsForOrder(input: {
    storeId: string;
    orderId: string;
    subtotalVnd: number;
    customerId: string | null;
    items: PromotionItem[];
    now: number;
  }): Promise<{ options: PosPromotionOption[]; applied: PosPromotionOption[] }> {
    const [programs, selectedRows, suppressedRows, categories] = await Promise.all([
      this.repository.listActive(input.storeId),
      this.repository.listSelected(input.storeId, input.orderId),
      this.repository.listSuppressed(input.storeId, input.orderId),
      this.repository.productCategories(input.storeId, [
        ...new Set(input.items.map((item) => item.productId)),
      ]),
    ]);
    const explicitlySelected = new Set(selectedRows.results.map((row) => row.promotionId));
    const suppressed = new Set(suppressedRows.results.map((row) => row.promotionId));
    const options = await Promise.all(
      programs.results.map(async (program) => {
        const [
          categoryTargets,
          categoryNames,
          productTargets,
          configuredProductTargets,
          giftDetails,
          groups,
        ] = await Promise.all([
          this.repository.targetIds(input.storeId, program.id, 'CATEGORY'),
          this.repository.targetCategoryNames(input.storeId, program.id),
          this.repository.targetRows(input.storeId, program.id, 'PRODUCT'),
          this.repository.targetItemDetails(input.storeId, program.id, 'PRODUCT'),
          this.repository.giftItemDetails(input.storeId, program.id),
          this.repository.customerGroupIds(input.storeId, program.id),
        ]);
        const categoryIds = new Set(categoryTargets.results.map((item) => item.id));
        const groupIds = groups.results.map((item) => item.id);
        let reason: string | null = null;
        if (computedStatus(program, input.now) !== 'ACTIVE')
          reason = 'Chương trình chưa đến hoặc đã hết thời gian áp dụng';
        if (!reason && program.weekdaysMask !== null) {
          const clock = localClock(input.now, this.env.STORE_TIMEZONE);
          if ((program.weekdaysMask & (1 << clock.weekday)) === 0)
            reason = 'Không áp dụng vào hôm nay';
          const ranges = JSON.parse(program.timeRangesJson) as Array<{
            startMinute: number;
            endMinute: number;
          }>;
          if (
            !reason &&
            ranges.length > 0 &&
            !ranges.some((r) => minuteInRange(clock.minute, r.startMinute, r.endMinute))
          ) {
            reason = 'Ngoài khung giờ áp dụng';
          }
        } else if (!reason) {
          const ranges = JSON.parse(program.timeRangesJson) as Array<{
            startMinute: number;
            endMinute: number;
          }>;
          if (ranges.length > 0) {
            const clock = localClock(input.now, this.env.STORE_TIMEZONE);
            if (!ranges.some((r) => minuteInRange(clock.minute, r.startMinute, r.endMinute)))
              reason = 'Ngoài khung giờ áp dụng';
          }
        }
        if (!reason && input.subtotalVnd < program.minimumOrderVnd)
          reason = `Hóa đơn tối thiểu ${program.minimumOrderVnd.toLocaleString('vi-VN')}đ`;
        if (!reason && groupIds.length > 0) {
          if (
            !input.customerId ||
            !(await this.repository.customerInAnyGroup(input.storeId, input.customerId, groupIds))
          ) {
            reason = 'Khách hàng không thuộc nhóm được áp dụng';
          }
        }
        const targetItems =
          program.scope === 'INVOICE'
            ? input.items
            : input.items.filter((item) =>
                program.scope === 'PRODUCT'
                  ? productTargets.results.some(
                      (target) =>
                        target.productId === item.productId &&
                        (target.variantId === null || target.variantId === item.variantId),
                    )
                  : categoryIds.has(categories.get(item.productId) ?? ''),
              );
        if (!reason && program.scope !== 'INVOICE' && targetItems.length === 0)
          reason = 'Đơn chưa có mặt hàng được áp dụng';
        if (!reason && program.type === 'GIFT' && program.scope === 'PRODUCT') {
          const requirementMet = (target: (typeof productTargets.results)[number]) =>
            input.items
              .filter(
                (item) =>
                  item.productId === target.productId &&
                  (target.variantId === null || target.variantId === item.variantId),
              )
              .reduce((sum, item) => sum + item.quantityMilli, 0) >=
            target.quantity * 1000;
          const qualified =
            program.giftBuyAny === 1
              ? productTargets.results.some(requirementMet)
              : productTargets.results.every(requirementMet);
          if (!qualified) reason = 'Chưa đủ số lượng mặt hàng mua để nhận món tặng';
        }
        if (!reason && program.type === 'GIFT' && giftDetails.results.length === 0) {
          reason = 'Mặt hàng tặng không còn kinh doanh';
        }
        const targetGross =
          program.scope === 'INVOICE'
            ? input.subtotalVnd
            : targetItems.reduce((sum, item) => sum + item.netLineTotalVnd, 0);
        let discount = 0;
        let flatPriceItems: PosPromotionFlatPriceItem[] = [];
        if (!reason && program.type === 'FIXED_AMOUNT')
          discount = Math.min(targetGross, program.value ?? 0);
        if (!reason && program.type === 'PERCENT') {
          discount = Math.round((targetGross * (program.value ?? 0)) / 100);
          if (program.maximumDiscountVnd !== null)
            discount = Math.min(discount, program.maximumDiscountVnd);
        }
        if (!reason && program.type === 'FLAT_PRICE') {
          flatPriceItems = targetItems.flatMap((item) => {
            const flatLineTotal = Math.round(((program.value ?? 0) * item.quantityMilli) / 1000);
            const discountAmountVnd = Math.max(0, item.netLineTotalVnd - flatLineTotal);
            if (discountAmountVnd <= 0) return [];
            return [
              {
                productId: item.productId,
                variantId: item.variantId,
                productName: item.productName,
                variantName: item.variantName,
                quantityMilli: item.quantityMilli,
                originalUnitPriceVnd: item.unitPriceVnd,
                flatUnitPriceVnd: program.value ?? 0,
                discountAmountVnd,
              },
            ];
          });
          discount = flatPriceItems.reduce((sum, item) => sum + item.discountAmountVnd, 0);
        }
        const giftItems =
          !reason && program.type === 'GIFT'
            ? allocateGiftItems(giftDetails.results, program.maximumGiftQuantity ?? 1)
            : [];
        const names = [...new Set(giftDetails.results.map((item) => item.productName))];
        return {
          id: program.id,
          name: program.name,
          type: program.type,
          scope: program.scope,
          value: program.value,
          minimumOrderVnd: program.minimumOrderVnd,
          maximumDiscountVnd: program.maximumDiscountVnd,
          eligible: reason === null,
          reason,
          discountAmountVnd: Math.min(input.subtotalVnd, discount),
          selected: false,
          autoApply: program.autoApply === 1,
          giftProductNames: names,
          giftItems,
          flatPriceItems,
          categoryNames: categoryNames.results.map((item) => item.name),
          configuredProductTargets: configuredProductTargets.results,
          giftBuyAny: program.giftBuyAny === 1,
          maximumGiftQuantity: program.maximumGiftQuantity,
        } satisfies PosPromotionOption;
      }),
    );
    const candidateIds = new Set(
      options
        .filter(
          (item) =>
            item.eligible &&
            (explicitlySelected.has(item.id) || (item.autoApply && !suppressed.has(item.id))),
        )
        .map((item) => item.id),
    );
    let remainingDiscountable = input.subtotalVnd;
    const applied: PosPromotionOption[] = [];
    const resolvedOptions = options.map((option) => {
      if (!candidateIds.has(option.id)) return option;
      const discountAmountVnd = Math.min(remainingDiscountable, option.discountAmountVnd);
      remainingDiscountable -= discountAmountVnd;
      const resolved = Object.assign({}, option, { selected: true, discountAmountVnd });
      applied.push(resolved);
      return resolved;
    });
    return { options: resolvedOptions, applied };
  }

  async applyToOrder(input: {
    storeId: string;
    orderId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    promotionIds: string[];
    actorId: string;
    expectedOrderVersion: number;
    subtotalVnd: number;
    customerId: string | null;
    items: PromotionItem[];
  }) {
    const promotionIds = [...new Set(input.promotionIds)];
    const current = await this.optionsForOrder({
      storeId: input.storeId,
      orderId: input.orderId,
      subtotalVnd: input.subtotalVnd,
      customerId: input.customerId,
      items: input.items,
      now: Date.now(),
    });
    for (const promotionId of promotionIds) {
      const option = current.options.find((item) => item.id === promotionId);
      if (!option) {
        throw new AppError('PROMOTION_NOT_FOUND', 'Không tìm thấy chương trình khuyến mại.', 404);
      }
      if (!option.eligible) {
        throw new AppError(
          'PROMOTION_NOT_ELIGIBLE',
          option.reason ?? 'Chương trình chưa đủ điều kiện áp dụng.',
          422,
        );
      }
    }
    const selected = new Set(promotionIds);
    const suppressedPromotionIds = current.options
      .filter((item) => item.autoApply && item.eligible && !selected.has(item.id))
      .map((item) => item.id);
    try {
      await this.repository.setOrderPromotions({
        storeId: input.storeId,
        orderId: input.orderId,
        orderType: input.orderType,
        actorId: input.actorId,
        promotionIds,
        suppressedPromotionIds,
        expectedVersion: input.expectedOrderVersion,
        now: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('ORDER_VERSION_CONFLICT')) {
        throw new AppError(
          'ORDER_VERSION_CONFLICT',
          'Đơn hàng đã thay đổi. Vui lòng tải lại.',
          409,
        );
      }
      throw error;
    }
    return { orderId: input.orderId, promotionIds };
  }
}
