import { AppError } from '@server/lib/app-error';

export function requireSecret(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError('SERVER_MISCONFIGURED', `Missing required secret: ${name}`, 503);
  }
  return value;
}
