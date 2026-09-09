import { describe, expect, it } from 'vitest';
import { formatBytes } from '@client/lib/format-bytes';

describe('formatBytes utility', () => {
  it('handles zero, negative, and invalid inputs', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-100)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1229)).toBe('1.2 KB');
    expect(formatBytes(664 * 1024)).toBe('664 KB');
    expect(formatBytes(1.21 * 1024 * 1024)).toBe('1.21 MB');
    expect(formatBytes(2.4 * 1024 * 1024 * 1024)).toBe('2.4 GB');
  });
});
