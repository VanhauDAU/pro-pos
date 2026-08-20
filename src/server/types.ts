export interface AppVariables {
  requestId: string;
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
  };
  rawSession: string;
  sessionId: string;
}

export interface AppEnv {
  Bindings: CloudflareBindings;
  Variables: AppVariables;
}
