export interface VersionedSnapshot {
  order: { version: number };
}

export async function readStableVersionedSnapshot<T extends VersionedSnapshot>(input: {
  build: () => Promise<T>;
  latestVersion: () => Promise<number | null>;
  maxAttempts?: number;
  onVersionChange?: (values: {
    attempt: number;
    quotedVersion: number;
    latestVersion: number | null;
  }) => void;
}): Promise<T | null> {
  const maxAttempts = input.maxAttempts ?? 2;
  // Attempts must be sequential: the second build is useful only after the
  // first snapshot has been compared with the latest aggregate version.
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- intentional optimistic read retry
    const snapshot = await input.build();
    // eslint-disable-next-line no-await-in-loop -- must validate the snapshot just built
    const latestVersion = await input.latestVersion();
    if (latestVersion === snapshot.order.version) return snapshot;
    input.onVersionChange?.({
      attempt,
      quotedVersion: snapshot.order.version,
      latestVersion,
    });
  }
  return null;
}
