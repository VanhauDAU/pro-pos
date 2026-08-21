import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { AppEnv } from '@server/types';

export type CredentialCookieKind = 'device' | 'session' | 'activation' | 'access' | 'guest';

function cookieName(c: Context<AppEnv>, kind: CredentialCookieKind): string {
  const prefix = c.env.COOKIE_MODE === 'secure' ? '__Host-' : '';
  return `${prefix}propos-${kind}`;
}

function cookieOptions(c: Context<AppEnv>, maxAge: number) {
  return {
    httpOnly: true,
    secure: c.env.COOKIE_MODE === 'secure',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

export function readCredentialCookie(c: Context<AppEnv>, kind: CredentialCookieKind) {
  return getCookie(c, cookieName(c, kind));
}

export function setCredentialCookie(
  c: Context<AppEnv>,
  kind: CredentialCookieKind,
  value: string,
  maxAge: number,
) {
  setCookie(c, cookieName(c, kind), value, cookieOptions(c, maxAge));
}

export function clearCredentialCookie(c: Context<AppEnv>, kind: CredentialCookieKind) {
  deleteCookie(c, cookieName(c, kind), {
    path: '/',
    secure: c.env.COOKIE_MODE === 'secure',
    httpOnly: true,
    sameSite: 'Lax',
  });
  if (c.env.COOKIE_MODE === 'secure') {
    deleteCookie(c, `propos-${kind}`, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });
  }
}
