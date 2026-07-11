import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { Logger } from 'pino';

type ProviderWithToken = 'lm-studio' | 'openai-compatible';

interface StoredCredentials {
  schemaVersion: 1;
  values: Partial<Record<ProviderWithToken, string>>;
}

export class CredentialStore {
  private readonly memory = new Map<ProviderWithToken, string>();
  private readonly filePath: string;

  constructor(
    dataDirectory: string,
    private readonly logger: Logger,
  ) {
    this.filePath = path.join(dataDirectory, 'credentials.enc.json');
  }

  private read(): StoredCredentials {
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredCredentials;
      if (value.schemaVersion !== 1 || typeof value.values !== 'object') {
        throw new Error('Unsupported credential store format.');
      }
      return value;
    } catch {
      return { schemaVersion: 1, values: {} };
    }
  }

  private write(value: StoredCredentials): void {
    writeFileSync(this.filePath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  }

  set(provider: ProviderWithToken, token: string): void {
    if (!token || token.length > 4_096) throw new Error('Invalid provider token.');
    if (!safeStorage.isEncryptionAvailable()) {
      this.memory.set(provider, token);
      this.logger.warn(
        { provider },
        'OS credential encryption unavailable; token retained in memory for this session only',
      );
      return;
    }
    const store = this.read();
    store.values[provider] = safeStorage.encryptString(token).toString('base64');
    this.write(store);
  }

  get(provider: ProviderWithToken): string | undefined {
    const memoryValue = this.memory.get(provider);
    if (memoryValue) return memoryValue;
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    const encrypted = this.read().values[provider];
    if (!encrypted) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (error) {
      this.logger.warn(
        { provider, error: error instanceof Error ? error.message : 'unknown' },
        'Could not decrypt local provider token',
      );
      return undefined;
    }
  }

  has(provider: ProviderWithToken): boolean {
    return this.get(provider) !== undefined;
  }

  forget(provider: ProviderWithToken): void {
    this.memory.delete(provider);
    const store = this.read();
    delete store.values[provider];
    if (safeStorage.isEncryptionAvailable()) this.write(store);
  }
}
