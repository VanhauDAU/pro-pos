export interface ProPosAccessIdentity {
  email?: string;
  user_uuid?: string;
}

interface ProPosAccessContext {
  getIdentity(): Promise<ProPosAccessIdentity | undefined>;
}

function isAccessContext(value: unknown): value is ProPosAccessContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getIdentity' in value &&
    typeof value.getIdentity === 'function'
  );
}

export function getAccessContext(ctx: object): ProPosAccessContext | undefined {
  if (!('access' in ctx)) return undefined;
  return isAccessContext(ctx.access) ? ctx.access : undefined;
}
