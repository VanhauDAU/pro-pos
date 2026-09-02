import type { AuthContextResponse, LoginResponse } from '@contracts/auth';

export function authContextAfterOwnerLogin(
  current: AuthContextResponse | undefined,
  login: LoginResponse,
): AuthContextResponse {
  return {
    actor: login.actor,
    device: current?.device ?? null,
    allowedEntrypoints: [...new Set([...(current?.allowedEntrypoints ?? []), 'OWNER' as const])],
    csrfToken: login.csrfToken,
  };
}
