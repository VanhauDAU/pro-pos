export interface RequestPrincipal {
  actor: {
    id: string;
    displayName: string;
    kind: 'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE';
    storeId: string | null;
  };
  device: null | {
    id: string;
    name: string;
    status: 'ACTIVE' | 'REVOKED';
    storeId: string;
    storeName?: string;
  };
  sessionId: string;
  storeStatus: 'ACTIVE' | 'LOCKED' | null;
  permissions: ReadonlySet<string>;
}

export interface AppVariables {
  requestId: string;
  actionId: string | null;
  requestTimings: Record<string, number>;
  actor: RequestPrincipal['actor'];
  device: RequestPrincipal['device'];
  rawSession: string;
  sessionId: string;
  principal: RequestPrincipal | null;
}

export interface AppEnv {
  Bindings: CloudflareBindings;
  Variables: AppVariables;
}
