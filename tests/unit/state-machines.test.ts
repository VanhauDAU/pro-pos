import { describe, expect, it } from 'vitest';

import {
  canTransitionOrder,
  canTransitionTable,
  canTransitionTimeSession,
} from '@domain/state-machines';

describe('domain state machines', () => {
  it('rejects reopening a paid order', () => {
    expect(canTransitionOrder('PAID', 'OPEN')).toBe(false);
  });

  it('only occupies an available table', () => {
    expect(canTransitionTable('AVAILABLE', 'OCCUPIED')).toBe(true);
    expect(canTransitionTable('DISABLED', 'OCCUPIED')).toBe(false);
  });

  it('does not resume an ended time session', () => {
    expect(canTransitionTimeSession('ENDED', 'RUNNING')).toBe(false);
  });
});
