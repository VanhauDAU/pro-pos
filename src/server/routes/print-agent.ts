import { Hono } from 'hono';
import { z } from 'zod';

import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requireActorOrPrintAgent } from '@server/middleware/authorization';
import { PrintAgentService } from '@server/services/print-agent-service';
import type { AppEnv } from '@server/types';

export const publicPrintAgentRoutes = new Hono<AppEnv>();
export const posPrintAgentRoutes = new Hono<AppEnv>();

const confirmPairingSchema = z.object({
  pairingCode: z.string().min(6).max(10),
  deviceName: z.string().optional(),
});

/**
 * Public routes for Print Agent installation & pairing
 */
publicPrintAgentRoutes.post('/pair/request', async (c) => {
  const service = new PrintAgentService(c.env);
  const session = await service.createPairingSession();
  return success(c, session, 201);
});

publicPrintAgentRoutes.get('/pair/status', async (c) => {
  const sessionId = c.req.query('sessionId');
  if (!sessionId) {
    return success(c, { status: 'EXPIRED' });
  }
  const service = new PrintAgentService(c.env);
  const status = await service.getPairingStatus(sessionId);
  return success(c, status);
});

publicPrintAgentRoutes.post('/heartbeat', requireActorOrPrintAgent(), async (c) => {
  const agentId = c.req.header('X-Agent-Id');
  if (agentId) await new PrintAgentService(c.env).heartbeat(agentId);
  return success(c, { ok: true });
});

/**
 * Authenticated POS routes for managing Print Agents
 */
posPrintAgentRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

posPrintAgentRoutes.post('/pair/confirm', async (c) => {
  const body = await parseJson(c.req.raw, confirmPairingSchema);
  const actor = c.get('actor');
  const service = new PrintAgentService(c.env);

  const result = await service.confirmPairing(body.pairingCode, actor.storeId!, body.deviceName);

  return success(c, result);
});

posPrintAgentRoutes.get('/list', async (c) => {
  const actor = c.get('actor');
  const service = new PrintAgentService(c.env);
  const agents = await service.listStoreAgents(actor.storeId!);
  return success(c, agents);
});

posPrintAgentRoutes.delete('/:id', async (c) => {
  const actor = c.get('actor');
  const service = new PrintAgentService(c.env);
  await service.removeAgent(c.req.param('id'), actor.storeId!);
  return success(c, { success: true });
});
