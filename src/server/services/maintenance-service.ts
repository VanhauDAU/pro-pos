import {
  MaintenanceRepository,
  type MaintenanceCleanupResult,
} from '@server/repositories/maintenance-repository';
import type { AppEnv } from '@server/types';

export class MaintenanceService {
  private readonly repository: MaintenanceRepository;

  constructor(private readonly env: AppEnv['Bindings']) {
    this.repository = new MaintenanceRepository(env.DB);
  }

  async runRetentionCleanup(retentionDays = 7): Promise<MaintenanceCleanupResult> {
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 7;
    return this.repository.runRetentionCleanup(days);
  }
}
