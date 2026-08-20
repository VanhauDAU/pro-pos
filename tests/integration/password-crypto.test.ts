import { describe, expect, it } from 'vitest';

import { derivePasswordDigest, randomSalt, verifyPasswordDigest } from '@server/lib/crypto';

describe('Password credential crypto', () => {
  it('supports a PBKDF2 work factor above the Workers Web Crypto limit', async () => {
    const salt = randomSalt();
    const iterations = 100_001;
    const digest = await derivePasswordDigest({
      secret: 'correct horse battery staple',
      pepper: 'test-auth-pepper-at-least-32-bytes-long',
      salt,
      iterations,
    });

    await expect(
      verifyPasswordDigest({
        candidate: 'correct horse battery staple',
        pepper: 'test-auth-pepper-at-least-32-bytes-long',
        salt,
        iterations,
        expectedDigest: digest,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPasswordDigest({
        candidate: 'wrong password',
        pepper: 'test-auth-pepper-at-least-32-bytes-long',
        salt,
        iterations,
        expectedDigest: digest,
      }),
    ).resolves.toBe(false);
  });
});
