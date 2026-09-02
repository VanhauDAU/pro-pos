import type { AuthContextResponse } from './auth';
import type { PosOverviewSnapshot, PosStaffContext } from './pos';

export type AppBootstrapSurface = 'areas' | 'shell';

export interface AppBootstrapResponse {
  auth: AuthContextResponse;
  pos: null | {
    context: PosStaffContext;
    overview: PosOverviewSnapshot | null;
  };
}
