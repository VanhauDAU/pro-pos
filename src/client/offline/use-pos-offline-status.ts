import { useSyncExternalStore } from 'react';

import { posOfflineRuntime } from './runtime';

export function usePosOfflineStatus() {
  return useSyncExternalStore(
    posOfflineRuntime.subscribe,
    posOfflineRuntime.getStatus,
    posOfflineRuntime.getStatus,
  );
}
