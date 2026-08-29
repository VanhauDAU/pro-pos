import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../apps/print-agent/src/desktop/main/credential-store';

describe('CredentialStore', () => {
  it('persists only encrypted bytes and restores the secret through the OS protector', () => {
    const dir = mkdtempSync(join(tmpdir(), 'propos-print-agent-'));
    const protector = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) => value.toString().replace('encrypted:', ''),
    };
    const store = new CredentialStore(join(dir, 'credentials.bin'), protector);
    store.save('agent-secret');
    expect(readFileSync(join(dir, 'credentials.bin'), 'utf8')).not.toContain('agent-secret');
    expect(store.load()).toBe('agent-secret');
    store.clear();
    expect(existsSync(join(dir, 'credentials.bin'))).toBe(false);
    expect(store.load()).toBeUndefined();
  });
});
