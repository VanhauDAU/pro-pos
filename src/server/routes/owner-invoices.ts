import { Hono } from 'hono';

import { success } from '@server/lib/response';
import { requireActor } from '@server/middleware/authorization';
import { OwnerInvoiceService } from '@server/services/owner-invoice-service';
import type { AppEnv } from '@server/types';

const ownerInvoiceRoutes = new Hono<AppEnv>();
ownerInvoiceRoutes.use('*', requireActor('OWNER'));

/**
 * GET /api/v1/owner/invoices
 * Query params:
 *   status:     'PAID' | 'CANCELLED' (omit for all)
 *   search:     string — match displayCode
 *   orderType:  'DINE_IN' | 'TAKEAWAY' (omit for all)
 *   method:     'CASH' | 'BANK_TRANSFER' (omit for all)
 *   dateFrom:   ISO date string (e.g. 2026-08-01)
 *   dateTo:     ISO date string (e.g. 2026-08-31)
 *   page:       number (default 1)
 *   limit:      number (default 20, max 100)
 */
ownerInvoiceRoutes.get('/', async (c) => {
  const storeId = c.get('actor').storeId!;
  const qs = c.req.query();

  const rawStatus = qs['status'];
  const status: 'PAID' | 'CANCELLED' | undefined =
    rawStatus === 'PAID' || rawStatus === 'CANCELLED' ? rawStatus : undefined;

  const rawOrderType = qs['orderType'];
  const orderType: 'DINE_IN' | 'TAKEAWAY' | undefined =
    rawOrderType === 'DINE_IN' || rawOrderType === 'TAKEAWAY' ? rawOrderType : undefined;

  const rawMethod = qs['method'];
  const method: 'CASH' | 'BANK_TRANSFER' | undefined =
    rawMethod === 'CASH' || rawMethod === 'BANK_TRANSFER' ? rawMethod : undefined;

  const search = qs['search']?.trim() ?? '';
  const dateFrom = qs['dateFrom'] ?? null;
  const dateTo = qs['dateTo'] ?? null;
  const page = Math.max(1, Number(qs['page'] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(qs['limit'] ?? 20)));

  const result = await new OwnerInvoiceService(c.env).listInvoices({
    storeId,
    status,
    search,
    orderType,
    method,
    dateFrom,
    dateTo,
    page,
    limit,
  });
  return success(c, result);
});

/**
 * DELETE /api/v1/owner/invoices/:id
 * Permanently deletes an invoice/order and its lines/payments/sessions from the database.
 */
ownerInvoiceRoutes.delete('/:id', async (c) => {
  const storeId = c.get('actor').storeId!;
  const id = c.req.param('id');
  const actor = c.get('actor');
  const requestId = c.get('requestId') || 'req-delete-invoice';

  const result = await new OwnerInvoiceService(c.env).deleteInvoice({
    storeId,
    targetId: id,
    actorUserId: actor.id,
    requestId,
  });

  return success(c, result);
});

export { ownerInvoiceRoutes };
