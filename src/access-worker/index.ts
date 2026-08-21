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

    if (url.pathname === '/logout' || url.pathname === '/cdn-cgi/access/logout') {
      const returnTo =
        url.searchParams.get('returnTo') ||
        url.searchParams.get('return_to') ||
        env.MAIN_APP_ORIGIN;
      return new Response(null, {
        status: 303,
        headers: {
          'Cache-Control': 'no-store',
          Location: returnTo,
          'Set-Cookie':
            'CF_Authorization=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None',
        },
      });
    }

    if (url.pathname !== '/complete' || request.method !== 'GET') {
      return errorResponse(404, 'Not found');
    }

    const requestId = url.searchParams.get('request');
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      return errorResponse(400, 'Invalid access request');
    }

    let email: string | null = null;
    let subject: string | null = null;

    if (env.ENVIRONMENT === 'local') {
      const paramEmail = url.searchParams.get('email')?.trim().toLocaleLowerCase('en-US');
      if (paramEmail) {
        email = paramEmail;
        subject = `local-${paramEmail}`;
      } else {
        // Render Dev Account Selection UI for seamless local testing
        interface IdentityRow {
          email: string;
          display_name: string | null;
          role_code: string | null;
          store_name: string | null;
        }

        let identities: IdentityRow[] = [];
        try {
          const res = await env.DB.prepare(
            `SELECT ai.email, u.display_name, r.code AS role_code, s.name AS store_name
             FROM access_identities ai
             JOIN users u ON u.id = ai.user_id
             LEFT JOIN store_memberships sm ON sm.user_id = u.id
             LEFT JOIN stores s ON s.id = sm.store_id
             LEFT JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
             ORDER BY ai.email ASC`,
          ).all<IdentityRow>();
          identities = res.results || [];
        } catch {
          // ignore DB read error in local dev
        }

        const buttonsHtml =
          identities.length > 0
            ? identities
                .map(
                  (id) => `
              <a href="/complete?request=${encodeURIComponent(requestId)}&email=${encodeURIComponent(id.email)}" class="btn-account">
                <div>${id.display_name || id.email} <small style="color: #0975f7; font-weight: 700;">[${id.role_code || 'USER'}]</small></div>
                <span>${id.email}${id.store_name ? ` · Quán: ${id.store_name}` : ''}</span>
              </a>
            `,
                )
                .join('')
            : `<a href="/complete?request=${encodeURIComponent(requestId)}&email=owner.local@example.com" class="btn-account">
               <div>Owner Local <strong>[OWNER]</strong></div>
               <span>owner.local@example.com</span>
             </a>`;

        const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>ProPOS — Chọn tài khoản Local Dev</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #ffffff; border-radius: 18px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); padding: 32px; width: 100%; max-width: 440px; }
    h2 { margin: 0 0 6px; font-size: 19px; color: #0f172a; }
    p { margin: 0 0 18px; font-size: 13px; color: #64748b; }
    .btn-list { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; }
    .btn-account { display: flex; flex-direction: column; align-items: flex-start; padding: 12px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; background: #f8fafc; color: #0f172a; text-decoration: none; transition: all 0.15s ease; font-size: 13.5px; font-weight: 600; cursor: pointer; text-align: left; }
    .btn-account:hover { border-color: #0975f7; background: #eff6ff; }
    .btn-account span { font-size: 12px; font-weight: 400; color: #64748b; margin-top: 2px; }
    .divider { display: flex; align-items: center; text-align: center; color: #94a3b8; font-size: 12px; margin: 16px 0; }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid #e2e8f0; }
    .divider::before { margin-right: 10px; }
    .divider::after { margin-left: 10px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; }
    input:focus { border-color: #0975f7; }
    button[type="submit"] { padding: 10px 18px; background: #0975f7; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
    button[type="submit"]:hover { background: #075ec7; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚡ Chọn tài khoản (Local Dev)</h2>
    <p>Chọn tài khoản Owner hoặc Super Admin để đăng nhập:</p>
    <div class="btn-list">
      ${buttonsHtml}
    </div>
    <div class="divider">hoặc nhập email bất kỳ</div>
    <form method="GET" action="/complete">
      <input type="hidden" name="request" value="${requestId}" />
      <input type="email" name="email" placeholder="owner@example.com" required />
      <button type="submit">Vào</button>
    </form>
  </div>
</body>
</html>`;

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
    } else {
      if (!ctx.access) {
        return errorResponse(401, 'Cloudflare Access authentication required');
      }
      const identity = await ctx.access.getIdentity();
      if (!identity?.email) {
        return errorResponse(403, 'Cloudflare Access email missing');
      }
      email = identity.email.trim().toLocaleLowerCase('en-US');
      subject = typeof identity.user_uuid === 'string' ? identity.user_uuid : null;
    }

    const code = randomOpaqueToken();
    const result = await new AccessAuthRepository(env.DB).authorizeRequest({
      id: requestId,
      email,
      subject,
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
