import { describe, expect, it, vi } from 'vitest';

import {
  recordPwaPrintTcpStart,
  trackPwaPrintRequest,
} from '../../src/client/lib/print-performance';

describe('PWA print performance metric', () => {
  it('measures request-to-start once using the local monotonic clock', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    trackPwaPrintRequest('JOB-METRIC', 100, 1_000);

    expect(recordPwaPrintTcpStart('JOB-METRIC', 'EVENT-1', 375)).toBe(275);
    expect(recordPwaPrintTcpStart('JOB-METRIC', 'EVENT-2', 400)).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"durationMs":275'));
    info.mockRestore();
  });
});
