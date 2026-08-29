import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class CredentialStore {
  constructor(private readonly filePath: string, private readonly protector: SecretProtector) {}

  load(): string | undefined {
    if (!existsSync(this.filePath)) return undefined;
    try {
      return this.protector.decryptString(Buffer.from(readFileSync(this.filePath, 'utf8'), 'base64'));
    } catch {
      return undefined;
    }
  }

  save(secret: string | undefined): void {
    if (!secret) return;
    if (!this.protector.isEncryptionAvailable()) {
      throw new Error('Windows credential protection không khả dụng; không thể lưu secret pairing.');
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, this.protector.encryptString(secret).toString('base64'), 'utf8');
  }
}
