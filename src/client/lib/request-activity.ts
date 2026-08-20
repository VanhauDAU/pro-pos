import { useSyncExternalStore } from 'react';

let activeMutations = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function beginMutation() {
  activeMutations += 1;
  notify();
}

export function endMutation() {
  activeMutations = Math.max(0, activeMutations - 1);
  notify();
}

export function useMutationInFlight() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activeMutations > 0,
    () => false,
  );
}
