/**
 * Tests for Token Store
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenStore } from '../token-store.js';
import { StoredServerTokens } from '../harbor-oauth.js';

// Mock filesystem
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const createTokens = (overrides: Partial<StoredServerTokens> = {}): StoredServerTokens => ({
  serverId: 'test-server',
  provider: 'google',
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  expiresAt: Date.now() + 3600000, // 1 hour from now
  scopes: ['scope1', 'scope2'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('TokenStore', () => {
  let store: TokenStore;
  
  beforeEach(() => {
    store = new TokenStore();
  });
  
  describe('saveTokens and getTokens', () => {
    it('stores and retrieves tokens', () => {
      const tokens = createTokens();
      store.saveTokens(tokens);
      
      const retrieved = store.getTokens('test-server');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.accessToken).toBe('access-123');
      expect(retrieved!.refreshToken).toBe('refresh-456');
    });
    
    it('returns null for missing tokens', () => {
      expect(store.getTokens('nonexistent')).toBeNull();
    });
    
    it('overwrites existing tokens', () => {
      store.saveTokens(createTokens({ accessToken: 'old-token' }));
      store.saveTokens(createTokens({ accessToken: 'new-token' }));
      
      const retrieved = store.getTokens('test-server');
      expect(retrieved!.accessToken).toBe('new-token');
    });
  });
  
  describe('hasValidTokens', () => {
    it('returns true for non-expired tokens', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() + 3600000, // 1 hour from now
      }));
      
      expect(store.hasValidTokens('test-server')).toBe(true);
    });
    
    it('returns false for expired tokens', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() - 1000, // 1 second ago
      }));
      
      expect(store.hasValidTokens('test-server')).toBe(false);
    });
    
    it('returns false for tokens expiring within 1 minute', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() + 30000, // 30 seconds from now
      }));
      
      expect(store.hasValidTokens('test-server')).toBe(false);
    });
    
    it('returns true for tokens without expiry', () => {
      store.saveTokens(createTokens({
        expiresAt: undefined,
      }));
      
      expect(store.hasValidTokens('test-server')).toBe(true);
    });
    
    it('returns false for missing tokens', () => {
      expect(store.hasValidTokens('nonexistent')).toBe(false);
    });
  });
  
  describe('needsRefresh', () => {
    it('returns true when less than 5 minutes remaining', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now
      }));
      
      expect(store.needsRefresh('test-server')).toBe(true);
    });
    
    it('returns false when more than 5 minutes remaining', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      }));
      
      expect(store.needsRefresh('test-server')).toBe(false);
    });
    
    it('returns false for tokens without expiry', () => {
      store.saveTokens(createTokens({
        expiresAt: undefined,
      }));
      
      expect(store.needsRefresh('test-server')).toBe(false);
    });
    
    it('returns false for missing tokens', () => {
      expect(store.needsRefresh('nonexistent')).toBe(false);
    });
  });
  
  describe('isExpired', () => {
    it('returns true for expired tokens', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() - 1000,
      }));
      
      expect(store.isExpired('test-server')).toBe(true);
    });
    
    it('returns false for non-expired tokens', () => {
      store.saveTokens(createTokens({
        expiresAt: Date.now() + 3600000,
      }));
      
      expect(store.isExpired('test-server')).toBe(false);
    });
    
    it('returns false for tokens without expiry', () => {
      store.saveTokens(createTokens({
        expiresAt: undefined,
      }));
      
      expect(store.isExpired('test-server')).toBe(false);
    });
    
    it('returns true for missing tokens', () => {
      expect(store.isExpired('nonexistent')).toBe(true);
    });
  });
  
  describe('deleteTokens', () => {
    it('removes tokens for a server', () => {
      store.saveTokens(createTokens());
      expect(store.getTokens('test-server')).not.toBeNull();
      
      store.deleteTokens('test-server');
      expect(store.getTokens('test-server')).toBeNull();
    });
    
    it('handles deleting non-existent tokens', () => {
      // Should not throw
      store.deleteTokens('nonexistent');
    });
  });
  
  describe('getAllTokens', () => {
    it('returns all stored tokens', () => {
      store.saveTokens(createTokens({ serverId: 'server-1' }));
      store.saveTokens(createTokens({ serverId: 'server-2' }));
      store.saveTokens(createTokens({ serverId: 'server-3' }));
      
      const all = store.getAllTokens();
      expect(all).toHaveLength(3);
      expect(all.map(t => t.serverId).sort()).toEqual(['server-1', 'server-2', 'server-3']);
    });
    
    it('returns empty array when no tokens', () => {
      expect(store.getAllTokens()).toEqual([]);
    });
  });
  
  describe('listServers', () => {
    it('returns list of server IDs with tokens', () => {
      store.saveTokens(createTokens({ serverId: 'server-a' }));
      store.saveTokens(createTokens({ serverId: 'server-b' }));
      
      const servers = store.listServers();
      expect(servers.sort()).toEqual(['server-a', 'server-b']);
    });
  });
  
  describe('getExpiringTokens', () => {
    it('returns tokens expiring within threshold', () => {
      // Expiring in 3 minutes (within 5 minute threshold)
      store.saveTokens(createTokens({
        serverId: 'expiring',
        expiresAt: Date.now() + 3 * 60 * 1000,
      }));
      
      // Not expiring (1 hour)
      store.saveTokens(createTokens({
        serverId: 'valid',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }));
      
      const expiring = store.getExpiringTokens();
      expect(expiring).toHaveLength(1);
      expect(expiring[0].serverId).toBe('expiring');
    });
    
    it('respects custom threshold', () => {
      store.saveTokens(createTokens({
        serverId: 'test',
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      }));
      
      // Default 5 minute threshold - should not be expiring
      expect(store.getExpiringTokens()).toHaveLength(0);
      
      // 15 minute threshold - should be expiring
      expect(store.getExpiringTokens(15 * 60 * 1000)).toHaveLength(1);
    });
  });
  
  describe('cleanupExpired', () => {
    it('removes expired tokens without refresh tokens', () => {
      // Expired without refresh token
      store.saveTokens(createTokens({
        serverId: 'expired-no-refresh',
        expiresAt: Date.now() - 1000,
        refreshToken: undefined,
      }));
      
      // Expired with refresh token (should keep)
      store.saveTokens(createTokens({
        serverId: 'expired-with-refresh',
        expiresAt: Date.now() - 1000,
        refreshToken: 'refresh-token',
      }));
      
      // Valid token
      store.saveTokens(createTokens({
        serverId: 'valid',
        expiresAt: Date.now() + 3600000,
      }));
      
      const cleaned = store.cleanupExpired();
      
      expect(cleaned).toBe(1);
      expect(store.getTokens('expired-no-refresh')).toBeNull();
      expect(store.getTokens('expired-with-refresh')).not.toBeNull();
      expect(store.getTokens('valid')).not.toBeNull();
    });
  });
  
  describe('getStats', () => {
    it('returns correct statistics', () => {
      const now = Date.now();
      
      // Valid token
      store.saveTokens(createTokens({
        serverId: 'valid-1',
        provider: 'google',
        expiresAt: now + 60 * 60 * 1000,
      }));
      
      // Another valid token
      store.saveTokens(createTokens({
        serverId: 'valid-2',
        provider: 'github',
        expiresAt: now + 60 * 60 * 1000,
      }));
      
      // Expiring token
      store.saveTokens(createTokens({
        serverId: 'expiring',
        provider: 'google',
        expiresAt: now + 3 * 60 * 1000, // 3 minutes
      }));
      
      // Expired token
      store.saveTokens(createTokens({
        serverId: 'expired',
        provider: 'google',
        expiresAt: now - 1000,
      }));
      
      // No expiry token
      store.saveTokens(createTokens({
        serverId: 'no-expiry',
        provider: 'slack',
        expiresAt: undefined,
      }));
      
      const stats = store.getStats();
      
      expect(stats.total).toBe(5);
      expect(stats.valid).toBe(3); // valid-1, valid-2, no-expiry
      expect(stats.expiring).toBe(1);
      expect(stats.expired).toBe(1);
      expect(stats.byProvider).toEqual({
        google: 3,
        github: 1,
        slack: 1,
      });
    });
  });
});

