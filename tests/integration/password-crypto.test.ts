import { describe, expect, it } from 'vitest';

import { derivePasswordDigest, randomSalt } from '@server/lib/crypto';

describe('Password credential crypto', () => {
  it('matches an independent PBKDF2-HMAC-SHA256 test vector', async () => {
    await expect(
      derivePasswordDigest({
        secret: 'password',
        pepper: 'pepper',
        salt: 'c2FsdA',
        iterations: 1_000,
      }),
    ).resolves.toBe('JAa5pr_m0FXbO6AooDSNfIDHf-rI16G4NHqtavJIWlQ');
  });

  it('supports a PBKDF2 work factor above the Workers Web Crypto limit', async () => {
    const salt = randomSalt();
    const iterations = 100_001;
    const digest = await derivePasswordDigest({
      secret: 'correct horse battery staple',
      pepper: 'test-auth-pepper-at-least-32-bytes-long',
      salt,
      iterations,
    });

    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  }, 10_000);
});
