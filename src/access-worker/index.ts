import { hashExchangeCode, randomOpaqueToken } from '../server/lib/crypto';
import { AccessAuthRepository } from '../server/repositories/access-auth-repository';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/complete' || request.method !== 'GET') {
      return errorResponse(404, 'Not found');
    }

    const requestId = url.searchParams.get('request');
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      return errorResponse(400, 'Invalid access request');
    }

    if (!ctx.access) {
      return errorResponse(401, 'Cloudflare Access authentication required');
    }
    const identity = await ctx.access.getIdentity();
    if (!identity?.email) {
      return errorResponse(403, 'Cloudflare Access email missing');
    }

    const code = randomOpaqueToken();
    const result = await new AccessAuthRepository(env.DB).authorizeRequest({
      id: requestId,
      email: identity.email.trim().toLocaleLowerCase('en-US'),
      subject: typeof identity.user_uuid === 'string' ? identity.user_uuid : null,
      codeHash: await hashExchangeCode(code),
      now: Date.now(),
    });
    if ((result.meta.changes ?? 0) !== 1) {
      return errorResponse(409, 'Access request is expired or already used');
    }

    const target = new URL('/api/v1/auth/access/complete', env.MAIN_APP_ORIGIN);
    target.searchParams.set('code', code);
    return new Response(null, {
      status: 303,
      headers: {
        'Cache-Control': 'no-store',
        Location: target.toString(),
        'Referrer-Policy': 'no-referrer',
      },
    });
  },
} satisfies ExportedHandler<AccessWorkerBindings>;
