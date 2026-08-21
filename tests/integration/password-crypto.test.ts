import { describe, expect, it } from 'vitest';

import {
  derivePasswordDigest,
  derivePinDigest,
  verifyPasswordDigest,
  verifyPinDigest,
} from '@server/lib/crypto';

describe('Employee PIN credential crypto', () => {
  it('matches an independent HMAC-SHA256 test vector', async () => {
    await expect(
      derivePinDigest({
        pin: '1234',
        pepper: 'pepper-1',
        salt: 'salt-1',
        userId: 'user-1',
        storeId: 'store-1',
      }),
    ).resolves.toBe('EXsM2Zcsr-WP9rLHFqD6MIhTa8mX6eopDic_cgTqiUA');
  });

  it('verifies the correct PIN and rejects a wrong PIN', async () => {
    const input = {
      pepper: 'test-auth-pepper-at-least-32-bytes-long',
      salt: 'test-salt',
      userId: 'employee-1',
      storeId: 'store-1',
    };
    const expectedDigest = await derivePinDigest({
      ...input,
      pin: '1234',
    });

    await expect(verifyPinDigest({ ...input, pin: '1234', expectedDigest })).resolves.toBe(true);
    await expect(verifyPinDigest({ ...input, pin: '9999', expectedDigest })).resolves.toBe(false);
  });
});

describe('Owner & SuperAdmin PBKDF2 password crypto', () => {
  it('derives consistent PBKDF2 password digest and verifies correctly', async () => {
    const input = {
      password: 'OwnerSecretPassword123!',
      salt: 'owner-salt-16-bytes',
      pepper: 'test-auth-pepper-at-least-32-bytes-long',
      workFactor: 10_000,
    };
    const digest = await derivePasswordDigest(input);
    expect(digest).toBeTypeOf('string');
    expect(digest.length).toBeGreaterThan(20);

    await expect(verifyPasswordDigest({ ...input, expectedDigest: digest })).resolves.toBe(true);
    await expect(
      verifyPasswordDigest({ ...input, password: 'WrongPassword!', expectedDigest: digest }),
    ).resolves.toBe(false);
  });
});
