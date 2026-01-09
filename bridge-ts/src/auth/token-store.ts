/**
 * OAuth Token Store
 * 
 * Persistent storage for OAuth tokens managed by the Harbor OAuth Broker.
 * Uses a separate file from the general secrets store for clarity.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../native-messaging.js';
import { StoredServerTokens } from './harbor-oauth.js';

const TOKENS_DIR = join(homedir(), '.harbor', 'auth');
const TOKENS_FILE = join(TOKENS_DIR, 'oauth-tokens.json');

// Storage format version for migrations
const STORAGE_VERSION = 1;

interface StorageFormat {
  version: number;
  tokens: StoredServerTokens[];
  updatedAt: number;
}

/**
 * Token store for Harbor-managed OAuth tokens.
 */
export class TokenStore {
  private tokens: Map<string, StoredServerTokens> = new Map();
  
  constructor() {
    this.ensureDir();
    this.load();
  }
  
  private ensureDir(): void {
    try {
      mkdirSync(TOKENS_DIR, { recursive: true });
      chmodSync(TOKENS_DIR, 0o700);
    } catch {
      // Ignore permission errors
    }
  }
  
  private load(): void {
    if (!existsSync(TOKENS_FILE)) {
      return;
    }
    
    try {
      const data = JSON.parse(readFileSync(TOKENS_FILE, 'utf-8')) as StorageFormat;
      
      if (data.version !== STORAGE_VERSION) {
        log('[TokenStore] Unknown storage version, starting fresh');
        return;
      }
      
      for (const token of data.tokens) {
        this.tokens.set(token.serverId, token);
      }
      
      log(`[TokenStore] Loaded ${this.tokens.size} stored tokens`);
    } catch (e) {
      log(`[TokenStore] Failed to load tokens: ${e}`);
    }
  }
  
  private save(): void {
    try {
      const data: StorageFormat = {
        version: STORAGE_VERSION,
        tokens: Array.from(this.tokens.values()),
        updatedAt: Date.now(),
      };
      
      writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
      chmodSync(TOKENS_FILE, 0o600);
    } catch (e) {
      log(`[TokenStore] Failed to save tokens: ${e}`);
    }
  }
  
  /**
   * Store tokens for a server.
   */
  saveTokens(tokens: StoredServerTokens): void {
    this.tokens.set(tokens.serverId, {
      ...tokens,
      updatedAt: Date.now(),
    });
    this.save();
    log(`[TokenStore] Saved tokens for ${tokens.serverId}`);
  }
  
  /**
   * Get tokens for a server.
   */
  getTokens(serverId: string): StoredServerTokens | null {
    return this.tokens.get(serverId) || null;
  }
  
  /**
   * Check if tokens exist and are not expired.
   */
  hasValidTokens(serverId: string): boolean {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return false;
    
    if (tokens.expiresAt) {
      // Consider invalid if less than 1 minute remaining
      return tokens.expiresAt > Date.now() + 60000;
    }
    
    return true;
  }
  
  /**
   * Check if tokens need refresh (less than 5 minutes remaining).
   */
  needsRefresh(serverId: string): boolean {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return false;
    if (!tokens.expiresAt) return false;
    
    // Needs refresh if less than 5 minutes remaining
    return tokens.expiresAt < Date.now() + 5 * 60 * 1000;
  }
  
  /**
   * Check if tokens are fully expired (no time remaining).
   */
  isExpired(serverId: string): boolean {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return true;
    if (!tokens.expiresAt) return false;
    
    return tokens.expiresAt < Date.now();
  }
  
  /**
   * Delete tokens for a server.
   */
  deleteTokens(serverId: string): void {
    if (this.tokens.delete(serverId)) {
      this.save();
      log(`[TokenStore] Deleted tokens for ${serverId}`);
    }
  }
  
  /**
   * Get all stored tokens.
   */
  getAllTokens(): StoredServerTokens[] {
    return Array.from(this.tokens.values());
  }
  
  /**
   * Get list of servers with stored tokens.
   */
  listServers(): string[] {
    return Array.from(this.tokens.keys());
  }
  
  /**
   * Get tokens that are about to expire (within threshold).
   */
  getExpiringTokens(thresholdMs: number = 5 * 60 * 1000): StoredServerTokens[] {
    const now = Date.now();
    return Array.from(this.tokens.values()).filter(t => {
      if (!t.expiresAt) return false;
      return t.expiresAt < now + thresholdMs;
    });
  }
  
  /**
   * Clean up expired tokens without refresh capability.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [serverId, tokens] of this.tokens.entries()) {
      if (tokens.expiresAt && tokens.expiresAt < now && !tokens.refreshToken) {
        this.tokens.delete(serverId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.save();
      log(`[TokenStore] Cleaned up ${cleaned} expired tokens`);
    }
    
    return cleaned;
  }
  
  /**
   * Get token statistics.
   */
  getStats(): {
    total: number;
    valid: number;
    expiring: number;
    expired: number;
    byProvider: Record<string, number>;
  } {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    const stats = {
      total: this.tokens.size,
      valid: 0,
      expiring: 0,
      expired: 0,
      byProvider: {} as Record<string, number>,
    };
    
    for (const tokens of this.tokens.values()) {
      // Count by provider
      stats.byProvider[tokens.provider] = (stats.byProvider[tokens.provider] || 0) + 1;
      
      // Check status
      if (!tokens.expiresAt) {
        stats.valid++;
      } else if (tokens.expiresAt < now) {
        stats.expired++;
      } else if (tokens.expiresAt < now + fiveMinutes) {
        stats.expiring++;
      } else {
        stats.valid++;
      }
    }
    
    return stats;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _store: TokenStore | null = null;

/**
 * Get the token store singleton.
 */
export function getTokenStore(): TokenStore {
  if (!_store) {
    _store = new TokenStore();
  }
  return _store;
}

/**
 * Reset the token store (for testing).
 */
export function resetTokenStore(): void {
  _store = null;
}

