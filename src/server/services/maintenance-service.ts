import {
  DAY_MS,
  DEFAULT_RETENTION_POLICY,
  MaintenanceRepository,
  type MaintenanceCleanupResult,
} from '@server/repositories/maintenance-repository';
import type { AppEnv } from '@server/types';

export class MaintenanceService {
  private readonly repository: MaintenanceRepository;

  constructor(private readonly env: AppEnv['Bindings']) {
    this.repository = new MaintenanceRepository(env.DB);
  }

  async runRetentionCleanup(): Promise<MaintenanceCleanupResult> {
    const startedAt = Date.now();
    const result = await this.repository.runRetentionCleanup(DEFAULT_RETENTION_POLICY, startedAt);
    const mediaBefore = startedAt - DEFAULT_RETENTION_POLICY.mediaTombstoneDays * DAY_MS;
    const candidates = await this.repository.listDeletedMediaBefore(
      mediaBefore,
      DEFAULT_RETENTION_POLICY.mediaCleanupBatchSize,
    );
    let deletedMediaRows = 0;

    for (const candidate of candidates) {
      try {
        // R2 delete is idempotent. Verify absence before dropping the only retry metadata in D1.
        // eslint-disable-next-line no-await-in-loop -- bounded maintenance retries are intentional.
        await this.env.MEDIA.delete(candidate.objectKey);
        // eslint-disable-next-line no-await-in-loop -- verify each object before deleting its tombstone.
        if (await this.env.MEDIA.head(candidate.objectKey)) continue;
        // eslint-disable-next-line no-await-in-loop -- D1 row is removed only after R2 confirms absence.
        deletedMediaRows += await this.repository.deleteMediaTombstone(
          candidate.id,
          candidate.objectKey,
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'media tombstone cleanup deferred',
            mediaId: candidate.id,
            objectKey: candidate.objectKey,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    result.tables.media_objects = deletedMediaRows;
    result.totalDeleted += deletedMediaRows;
    result.durationMs = Date.now() - startedAt;
    return result;
  }
}
