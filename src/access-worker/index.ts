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

function handleLogout(url: URL, env: AccessWorkerBindings): Response {
  const targetParam =
    url.searchParams.get('target') ||
    url.searchParams.get('returnTo') ||
    url.searchParams.get('return_to');

  let destination = `${env.MAIN_APP_ORIGIN}/?tab=owner&loggedOut=1`;
  if (targetParam) {
    try {
      const parsed = new URL(targetParam, env.MAIN_APP_ORIGIN);
      const appOrigin = new URL(env.MAIN_APP_ORIGIN).origin;
      if (parsed.origin === appOrigin) {
        destination = parsed.toString();
      }
    } catch {
      // keep default destination
    }
  }

  const headers = new Headers();
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Location', destination);
  headers.set('Referrer-Policy', 'no-referrer');

  const cookieNames = [
    'CF_Authorization',
    'CF_AppSession',
    'cf_clearance',
    'cf_use_ob',
    'cf_ob_info',
  ];
  const host = url.hostname;
  const isLocal = host === '127.0.0.1' || host === 'localhost';
  const secure = isLocal ? '' : ' Secure;';

  for (const name of cookieNames) {
    // 1. Host-only Lax
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly;${secure} SameSite=Lax`,
    );
    // 2. Host-only None
    if (!isLocal) {
      headers.append(
        'Set-Cookie',
        `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=None`,
      );
    }
    // 3. Host-only Strict
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly;${secure} SameSite=Strict`,
    );
    // 4. Host-only without SameSite
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly;${secure}`,
    );
    // 5. Domain-scoped
    if (!isLocal) {
      headers.append(
        'Set-Cookie',
        `${name}=; Domain=${host}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      );
      headers.append(
        'Set-Cookie',
        `${name}=; Domain=.${host}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      );
      headers.append(
        'Set-Cookie',
        `${name}=; Domain=${host}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=None`,
      );
      headers.append(
        'Set-Cookie',
        `${name}=; Domain=.${host}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=None`,
      );
    }
  }

  return new Response(null, {
    status: 303,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      url.pathname === '/logout' ||
      url.pathname === '/logout-callback' ||
      url.pathname === '/cdn-cgi/access/logout'
    ) {
      return handleLogout(url, env);
    }

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
