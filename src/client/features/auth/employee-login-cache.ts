import type { AuthContextResponse, LoginResponse } from '@contracts/auth';

export function authContextAfterEmployeeLogin(
  current: AuthContextResponse | undefined,
  login: LoginResponse,
): AuthContextResponse | null {
  if (current?.device?.status !== 'ACTIVE') return null;
  return {
    actor: login.actor,
    device: current.device,
    allowedEntrypoints: [...new Set([...current.allowedEntrypoints, 'EMPLOYEE' as const])],
    csrfToken: login.csrfToken,
  };
}
