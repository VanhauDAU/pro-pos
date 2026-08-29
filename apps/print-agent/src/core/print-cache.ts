import type { PrintBootstrap, PrintStoreContext } from '@contracts/print-bootstrap';
import type { StorePrintSettings } from '@contracts/store';
import type { AgentApiClient } from '../api-client';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_STALE_MS = 5 * 60_000;
const DEFAULT_MAX_RASTERS = 32;

interface BootstrapEntry {
  value: PrintBootstrap;
  fetchedAt: number;
}

export interface AgentPrintCacheOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  maxRasters?: number;
  now?: () => number;
}

export interface RasterCacheKey {
  kind: 'logo' | 'bottom' | 'vietqr';
  mediaId: string;
  paperSize: string;
  configVersion: number;
  width: number;
  height: number;
}

export type PrintBootstrapCacheStatus = 'HIT' | 'REFRESH' | 'STALE';

export interface PrintBootstrapResolution {
  bootstrap: PrintBootstrap;
  cacheStatus: PrintBootstrapCacheStatus;
}

export class PrintBootstrapStaleError extends Error {
  constructor(message = 'Print bootstrap cache đã quá thời gian stale cho phép.') {
    super(message);
    this.name = 'PrintBootstrapStaleError';
  }
}

function isMissingBootstrapEndpoint(error: unknown): boolean {
  return error instanceof Error && /\/print-bootstrap failed \(404\)/.test(error.message);
}

export class AgentPrintCache {
  private entry: BootstrapEntry | null = null;
  private desiredVersion = 0;
  private refreshPromise: Promise<PrintBootstrap> | null = null;
  private readonly rasters = new Map<string, Uint8Array>();
  private readonly rasterLoads = new Map<string, Promise<Uint8Array>>();
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly maxRasters: number;
  private readonly now: () => number;

  constructor(
    private readonly apiClient: AgentApiClient,
    options: AgentPrintCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    this.maxRasters = options.maxRasters ?? DEFAULT_MAX_RASTERS;
    this.now = options.now ?? Date.now;
  }

  peek(): PrintBootstrap | null {
    return this.entry?.value ?? null;
  }

  clear(): void {
    this.entry = null;
    this.desiredVersion = 0;
    this.refreshPromise = null;
    this.rasters.clear();
    this.rasterLoads.clear();
  }

  async prewarm(): Promise<void> {
    try {
      await this.resolve();
    } catch (error) {
      console.warn(
        `[PrintAgent] Không thể prewarm print bootstrap: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  invalidate(configVersion: number): void {
    if (!Number.isSafeInteger(configVersion) || configVersion < 0) return;
    this.desiredVersion = Math.max(this.desiredVersion, configVersion);
    if ((this.entry?.value.configVersion ?? -1) < this.desiredVersion) {
      void this.refresh().catch((error) => {
        console.warn(
          `[PrintAgent] Refresh print bootstrap sau invalidation thất bại: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  async resolve(): Promise<PrintBootstrap> {
    return (await this.resolveWithMetadata()).bootstrap;
  }

  async resolveWithMetadata(): Promise<PrintBootstrapResolution> {
    const entry = this.entry;
    const age = entry ? this.now() - entry.fetchedAt : Number.POSITIVE_INFINITY;
    if (entry && age <= this.ttlMs && entry.value.configVersion >= this.desiredVersion) {
      return { bootstrap: entry.value, cacheStatus: 'HIT' };
    }

    try {
      return { bootstrap: await this.refresh(), cacheStatus: 'REFRESH' };
    } catch (error) {
      const staleEntry = this.entry;
      const staleAge = staleEntry ? this.now() - staleEntry.fetchedAt : Number.POSITIVE_INFINITY;
      if (staleEntry && staleAge <= this.maxStaleMs) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'using stale print bootstrap',
            configVersion: staleEntry.value.configVersion,
            staleAgeMs: staleAge,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return { bootstrap: staleEntry.value, cacheStatus: 'STALE' };
      }
      throw new PrintBootstrapStaleError(
        error instanceof Error ? error.message : 'Không thể tải print bootstrap.',
      );
    }
  }

  private refresh(): Promise<PrintBootstrap> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchUntilCurrent().finally(() => {
      this.refreshPromise = null;
      if (
        this.desiredVersion > 0 &&
        (this.entry?.value.configVersion ?? -1) < this.desiredVersion
      ) {
        queueMicrotask(() => void this.prewarm());
      }
    });
    return this.refreshPromise;
  }

  private async fetchUntilCurrent(): Promise<PrintBootstrap> {
    let value = await this.fetchBootstrap();
    if (value.configVersion < this.desiredVersion) value = await this.fetchBootstrap();
    if (value.configVersion < this.desiredVersion) {
      throw new Error(
        `Print bootstrap version ${value.configVersion} thấp hơn desired version ${this.desiredVersion}.`,
      );
    }
    if (!this.entry || value.configVersion >= this.entry.value.configVersion) {
      this.entry = { value, fetchedAt: this.now() };
      for (const key of this.rasters.keys()) {
        if (!key.includes(`:${value.configVersion}:`)) this.rasters.delete(key);
      }
    }
    return this.entry.value;
  }

  private async fetchBootstrap(): Promise<PrintBootstrap> {
    try {
      const bootstrap = await this.apiClient.get<PrintBootstrap>('/api/v1/pos/print-bootstrap');
      if (
        !bootstrap ||
        typeof bootstrap !== 'object' ||
        typeof bootstrap.configVersion !== 'number' ||
        !bootstrap.printSettings
      ) {
        throw new Error('Print bootstrap response không hợp lệ.');
      }
      return bootstrap;
    } catch (error) {
      if (!isMissingBootstrapEndpoint(error)) throw error;
      const [context, printSettings] = await Promise.all([
        this.apiClient.get<PrintStoreContext>('/api/v1/pos/context'),
        this.apiClient.get<StorePrintSettings>('/api/v1/pos/print-settings'),
      ]);
      return {
        context,
        printSettings,
        configVersion: this.entry?.value.configVersion ?? 0,
      };
    }
  }

  async getRaster(key: RasterCacheKey, loader: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const serialized = `${key.kind}:${key.mediaId}:${key.paperSize}:${key.configVersion}:${key.width}x${key.height}`;
    const cached = this.rasters.get(serialized);
    if (cached) {
      this.rasters.delete(serialized);
      this.rasters.set(serialized, cached);
      return cached;
    }
    const inFlight = this.rasterLoads.get(serialized);
    if (inFlight) return inFlight;
    const load = loader()
      .then((raster) => {
        this.rasters.set(serialized, raster);
        while (this.rasters.size > this.maxRasters) {
          const oldest = this.rasters.keys().next().value as string | undefined;
          if (!oldest) break;
          this.rasters.delete(oldest);
        }
        return raster;
      })
      .finally(() => this.rasterLoads.delete(serialized));
    this.rasterLoads.set(serialized, load);
    return load;
  }
}
