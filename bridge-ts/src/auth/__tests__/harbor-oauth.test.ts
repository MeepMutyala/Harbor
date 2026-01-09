/**
 * Tests for Harbor OAuth Broker
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HarborOAuthBroker,
  initHarborOAuthBroker,
  resetHarborOAuthBroker,
  HarborOAuthConfig,
  StoredServerTokens,
} from '../harbor-oauth.js';
import { ManifestOAuth } from '../../installer/manifest.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const FULL_CONFIG: HarborOAuthConfig = {
  google: {
    clientId: 'test-google-client-id',
    clientSecret: 'test-google-client-secret',
  },
  github: {
    clientId: 'test-github-client-id',
    clientSecret: 'test-github-client-secret',
  },
};

const GOOGLE_ONLY_CONFIG: HarborOAuthConfig = {
  google: {
    clientId: 'test-google-client-id',
    clientSecret: 'test-google-client-secret',
  },
};

const EMPTY_CONFIG: HarborOAuthConfig = {};

const GMAIL_OAUTH: ManifestOAuth = {
  provider: 'google',
  supportedSources: ['host', 'user'],
  preferredSource: 'host',
  scopes: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.settings.basic',
  ],
  apis: [
    {
      name: 'gmail.googleapis.com',
      displayName: 'Gmail API',
    },
  ],
  hostMode: {
    tokenEnvVar: 'GMAIL_ACCESS_TOKEN',
    refreshTokenEnvVar: 'GMAIL_REFRESH_TOKEN',
    clientIdEnvVar: 'GMAIL_CLIENT_ID',
    clientSecretEnvVar: 'GMAIL_CLIENT_SECRET',
  },
  userMode: {
    clientCredentialsPath: '~/.gmail-mcp/credentials.json',
  },
};

const GITHUB_OAUTH: ManifestOAuth = {
  provider: 'github',
  supportedSources: ['host'],
  scopes: ['repo', 'read:user'],
  hostMode: {
    tokenEnvVar: 'GITHUB_TOKEN',
  },
};

const UNSUPPORTED_SCOPE_OAUTH: ManifestOAuth = {
  provider: 'google',
  supportedSources: ['host', 'user'],
  scopes: ['https://www.googleapis.com/auth/admin.directory.user'],
  apis: [{ name: 'admin.googleapis.com', displayName: 'Admin SDK' }],
};

const USER_ONLY_OAUTH: ManifestOAuth = {
  provider: 'google',
  supportedSources: ['user'],
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

// =============================================================================
// Tests
// =============================================================================

describe('HarborOAuthBroker', () => {
  let broker: HarborOAuthBroker;
  
  beforeEach(() => {
    resetHarborOAuthBroker();
  });
  
  afterEach(() => {
    resetHarborOAuthBroker();
  });
  
  describe('getCapabilities', () => {
    it('returns capabilities for configured providers', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      const caps = broker.getCapabilities();
      
      expect(caps.providers.google).toBeDefined();
      expect(caps.providers.google.configured).toBe(true);
      expect(caps.providers.google.availableScopes).toContain('https://www.googleapis.com/auth/gmail.modify');
      expect(caps.providers.google.enabledApis).toContain('gmail.googleapis.com');
      
      expect(caps.providers.github).toBeDefined();
      expect(caps.providers.github.configured).toBe(true);
      expect(caps.providers.github.availableScopes).toContain('repo');
    });
    
    it('returns empty providers when not configured', () => {
      broker = new HarborOAuthBroker(EMPTY_CONFIG);
      const caps = broker.getCapabilities();
      
      expect(caps.providers.google).toBeUndefined();
      expect(caps.providers.github).toBeUndefined();
    });
    
    it('only returns configured providers', () => {
      broker = new HarborOAuthBroker(GOOGLE_ONLY_CONFIG);
      const caps = broker.getCapabilities();
      
      expect(caps.providers.google).toBeDefined();
      expect(caps.providers.github).toBeUndefined();
    });
  });
  
  describe('canHandle', () => {
    it('returns true when Harbor can handle OAuth', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.canHandle(GMAIL_OAUTH)).toBe(true);
    });
    
    it('returns false when provider not configured', () => {
      broker = new HarborOAuthBroker(EMPTY_CONFIG);
      expect(broker.canHandle(GMAIL_OAUTH)).toBe(false);
    });
    
    it('returns false when scopes not available', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.canHandle(UNSUPPORTED_SCOPE_OAUTH)).toBe(false);
    });
    
    it('returns false when host mode not in supportedSources', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.canHandle(USER_ONLY_OAUTH)).toBe(false);
    });
  });
  
  describe('determineOAuthMode', () => {
    it('returns host when Harbor can handle and host is preferred', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.determineOAuthMode(GMAIL_OAUTH)).toBe('host');
    });
    
    it('returns user when Harbor cannot handle', () => {
      broker = new HarborOAuthBroker(EMPTY_CONFIG);
      expect(broker.determineOAuthMode(GMAIL_OAUTH)).toBe('user');
    });
    
    it('returns user when scopes missing', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.determineOAuthMode(UNSUPPORTED_SCOPE_OAUTH)).toBe('user');
    });
    
    it('returns user when only user mode supported', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.determineOAuthMode(USER_ONLY_OAUTH)).toBe('user');
    });
  });
  
  describe('checkCapabilities', () => {
    it('returns detailed capability check', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      const check = broker.checkCapabilities(GMAIL_OAUTH);
      
      expect(check.canHandle).toBe(true);
      expect(check.recommendedSource).toBe('host');
      expect(check.hostModeAvailable).toBe(true);
      expect(check.userModeAvailable).toBe(true);
      expect(check.missingScopes).toBeUndefined();
      expect(check.missingApis).toBeUndefined();
    });
    
    it('shows missing scopes when not available', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      const check = broker.checkCapabilities(UNSUPPORTED_SCOPE_OAUTH);
      
      expect(check.hostModeAvailable).toBe(false);
      expect(check.missingScopes).toContain('https://www.googleapis.com/auth/admin.directory.user');
    });
  });
  
  describe('token management', () => {
    const TEST_TOKENS: StoredServerTokens = {
      serverId: 'test-server',
      provider: 'google',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000, // 1 hour from now
      scopes: ['scope1', 'scope2'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    it('stores and retrieves tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([TEST_TOKENS]);
      
      const tokens = broker.getTokens('test-server');
      expect(tokens).toEqual(TEST_TOKENS);
    });
    
    it('returns null for missing tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.getTokens('nonexistent')).toBeNull();
    });
    
    it('hasValidTokens returns true for non-expired tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([TEST_TOKENS]);
      
      expect(broker.hasValidTokens('test-server')).toBe(true);
    });
    
    it('hasValidTokens returns false for expired tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([{
        ...TEST_TOKENS,
        expiresAt: Date.now() - 1000, // Expired
      }]);
      
      expect(broker.hasValidTokens('test-server')).toBe(false);
    });
    
    it('hasValidTokens returns false for missing tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      expect(broker.hasValidTokens('nonexistent')).toBe(false);
    });
    
    it('removes tokens correctly', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([TEST_TOKENS]);
      
      expect(broker.getTokens('test-server')).not.toBeNull();
      broker.removeTokens('test-server');
      expect(broker.getTokens('test-server')).toBeNull();
    });
    
    it('getAllTokens returns all stored tokens', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      
      const tokens2: StoredServerTokens = {
        ...TEST_TOKENS,
        serverId: 'test-server-2',
      };
      
      broker.loadTokens([TEST_TOKENS, tokens2]);
      
      const all = broker.getAllTokens();
      expect(all).toHaveLength(2);
      expect(all.map(t => t.serverId)).toContain('test-server');
      expect(all.map(t => t.serverId)).toContain('test-server-2');
    });
  });
  
  describe('getEnvVarsForServer', () => {
    it('returns env vars for host mode', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([{
        serverId: 'gmail-server',
        provider: 'google',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: Date.now() + 3600000,
        scopes: GMAIL_OAUTH.scopes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      
      const env = broker.getEnvVarsForServer('gmail-server', GMAIL_OAUTH);
      
      expect(env).toEqual({
        GMAIL_ACCESS_TOKEN: 'access-123',
        GMAIL_REFRESH_TOKEN: 'refresh-456',
        GMAIL_CLIENT_ID: 'test-google-client-id',
        GMAIL_CLIENT_SECRET: 'test-google-client-secret',
      });
    });
    
    it('returns null when no tokens exist', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      const env = broker.getEnvVarsForServer('nonexistent', GMAIL_OAUTH);
      expect(env).toBeNull();
    });
    
    it('returns empty object when hostMode not defined', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([{
        serverId: 'test-server',
        provider: 'google',
        accessToken: 'access-123',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      
      const oauthWithoutHostMode: ManifestOAuth = {
        provider: 'google',
        supportedSources: ['host'],
        scopes: [],
        // No hostMode defined
      };
      
      const env = broker.getEnvVarsForServer('test-server', oauthWithoutHostMode);
      expect(env).toEqual({});
    });
    
    it('omits refresh token env var when no refresh token', () => {
      broker = new HarborOAuthBroker(FULL_CONFIG);
      broker.loadTokens([{
        serverId: 'gmail-server',
        provider: 'google',
        accessToken: 'access-123',
        // No refreshToken
        scopes: GMAIL_OAUTH.scopes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }]);
      
      const env = broker.getEnvVarsForServer('gmail-server', GMAIL_OAUTH);
      
      expect(env).toEqual({
        GMAIL_ACCESS_TOKEN: 'access-123',
        GMAIL_CLIENT_ID: 'test-google-client-id',
        GMAIL_CLIENT_SECRET: 'test-google-client-secret',
      });
      expect(env!.GMAIL_REFRESH_TOKEN).toBeUndefined();
    });
  });
  
  describe('initHarborOAuthBroker', () => {
    it('creates broker with config', () => {
      const broker1 = initHarborOAuthBroker(FULL_CONFIG);
      expect(broker1.canHandle(GMAIL_OAUTH)).toBe(true);
    });
    
    it('replaces existing broker', () => {
      const broker1 = initHarborOAuthBroker(FULL_CONFIG);
      expect(broker1.canHandle(GMAIL_OAUTH)).toBe(true);
      
      // Should replace with new config
      const broker2 = initHarborOAuthBroker(EMPTY_CONFIG);
      expect(broker2.canHandle(GMAIL_OAUTH)).toBe(false);
    });
  });
});

