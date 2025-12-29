/**
 * Secret store for API keys and credentials.
 * 
 * Uses a JSON file with restrictive permissions for now.
 * TODO: Use system keychain (Keychain on macOS, libsecret on Linux, etc.)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../native-messaging.js';

const SECRETS_DIR = join(homedir(), '.harbor', 'secrets');
const SECRETS_FILE = join(SECRETS_DIR, 'credentials.json');

export class SecretStore {
  private secrets: Record<string, Record<string, string>> = {};

  constructor() {
    mkdirSync(SECRETS_DIR, { recursive: true });
    try {
      chmodSync(SECRETS_DIR, 0o700);
    } catch {
      // Ignore permission errors
    }
    this.load();
  }

  private load(): void {
    if (existsSync(SECRETS_FILE)) {
      try {
        const data = readFileSync(SECRETS_FILE, 'utf-8');
        this.secrets = JSON.parse(data);
      } catch (e) {
        log(`[SecretStore] Failed to load secrets: ${e}`);
        this.secrets = {};
      }
    }
  }

  private save(): void {
    try {
      writeFileSync(SECRETS_FILE, JSON.stringify(this.secrets, null, 2));
      chmodSync(SECRETS_FILE, 0o600);
    } catch (e) {
      log(`[SecretStore] Failed to save secrets: ${e}`);
    }
  }

  get(serverId: string, key: string): string | undefined {
    return this.secrets[serverId]?.[key];
  }

  getAll(serverId: string): Record<string, string> {
    return { ...(this.secrets[serverId] || {}) };
  }

  set(serverId: string, key: string, value: string): void {
    if (!this.secrets[serverId]) {
      this.secrets[serverId] = {};
    }
    this.secrets[serverId][key] = value;
    this.save();
  }

  setAll(serverId: string, secrets: Record<string, string>): void {
    this.secrets[serverId] = { ...secrets };
    this.save();
  }

  delete(serverId: string, key?: string): void {
    if (key) {
      delete this.secrets[serverId]?.[key];
    } else {
      delete this.secrets[serverId];
    }
    this.save();
  }

  hasSecrets(serverId: string): boolean {
    return serverId in this.secrets && Object.keys(this.secrets[serverId]).length > 0;
  }

  listServers(): string[] {
    return Object.keys(this.secrets);
  }

  getMissingSecrets(
    serverId: string,
    required: Array<{ name: string; isSecret?: boolean }>
  ): Array<{ name: string; isSecret?: boolean }> {
    const stored = this.secrets[serverId] || {};
    return required.filter(
      envVar => envVar.isSecret && envVar.name && !(envVar.name in stored)
    );
  }
}

// Singleton
let _store: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (!_store) {
    _store = new SecretStore();
  }
  return _store;
}

