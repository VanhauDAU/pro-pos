import { describe, expect, it, vi } from 'vitest';

import { readStableVersionedSnapshot } from '@server/lib/consistent-read';

describe('stable versioned reads', () => {
  it('rebuilds a snapshot once when the aggregate changes during the read', async () => {
    const build = vi
      .fn<() => Promise<{ order: { version: number }; totalVnd: number }>>()
      .mockResolvedValueOnce({ order: { version: 12 }, totalVnd: 102_000 })
      .mockResolvedValueOnce({ order: { version: 14 }, totalVnd: 182_000 });
    const latestVersion = vi.fn<() => Promise<number>>().mockResolvedValue(14);
    const onVersionChange = vi.fn();

    await expect(
      readStableVersionedSnapshot({ build, latestVersion, onVersionChange }),
    ).resolves.toEqual({ order: { version: 14 }, totalVnd: 182_000 });
    expect(build).toHaveBeenCalledTimes(2);
    expect(onVersionChange).toHaveBeenCalledWith({
      attempt: 1,
      quotedVersion: 12,
      latestVersion: 14,
    });
  });

  it('returns null instead of a mixed snapshot when both attempts race', async () => {
    const build = vi.fn(async () => ({ order: { version: 12 }, totalVnd: 102_000 }));
    const latestVersion = vi.fn(async () => 14);

    await expect(readStableVersionedSnapshot({ build, latestVersion })).resolves.toBeNull();
    expect(build).toHaveBeenCalledTimes(2);
  });
});
