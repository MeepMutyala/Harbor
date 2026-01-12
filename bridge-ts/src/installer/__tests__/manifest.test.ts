/**
 * Tests for MCP Server Manifest
 */
import { describe, it, expect } from 'vitest';
import {
  McpManifest,
  ManifestOAuth,
  HostOAuthCapabilities,
  validateManifest,
  parseManifest,
  checkOAuthCapabilities,
  getDockerRecommendation,
  requiresUserOAuthSetup,
  getMissingConfig,
  getOAuthEnvVars,
  toLegacyEnvVars,
} from '../manifest.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const MINIMAL_MANIFEST: McpManifest = {
  manifestVersion: '1.0.0',
  name: 'Test Server',
  package: {
    type: 'npm',
    name: 'test-server',
  },
};

const GMAIL_MANIFEST: McpManifest = {
  manifestVersion: '1.0.0',
  name: 'Gmail AutoAuth MCP Server',
  description: 'Read, search, send emails, manage labels and filters via Gmail API',
  repository: 'https://github.com/gongrzhe/server-gmail-autoauth-mcp',
  package: {
    type: 'npm',
    name: '@gongrzhe/server-gmail-autoauth-mcp',
  },
  runtime: {
    hasNativeCode: false,
  },
  execution: {
    transport: 'stdio',
  },
  oauth: {
    provider: 'google',
    supportedSources: ['host', 'user'],
    preferredSource: 'host',
    description: 'Access to read, send, and manage Gmail messages',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.settings.basic',
    ],
    apis: [
      {
        name: 'gmail.googleapis.com',
        displayName: 'Gmail API',
        enableUrl: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
      },
    ],
    hostMode: {
      tokenEnvVar: 'GMAIL_ACCESS_TOKEN',
      refreshTokenEnvVar: 'GMAIL_REFRESH_TOKEN',
      clientIdEnvVar: 'GMAIL_CLIENT_ID',
      clientSecretEnvVar: 'GMAIL_CLIENT_SECRET',
    },
    userMode: {
      clientCredentialsPath: '~/.gmail-mcp/gcp-oauth.keys.json',
      clientCredentialsEnvVar: 'GMAIL_OAUTH_PATH',
      tokenStoragePath: '~/.gmail-mcp/credentials.json',
      tokenStorageEnvVar: 'GMAIL_CREDENTIALS_PATH',
    },
  },
};

const FULL_HARBOR_CAPABILITIES: HostOAuthCapabilities = {
  providers: {
    google: {
      configured: true,
      availableScopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.settings.basic',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/calendar',
      ],
      enabledApis: [
        'gmail.googleapis.com',
        'drive.googleapis.com',
        'calendar-json.googleapis.com',
      ],
    },
    github: {
      configured: true,
      availableScopes: ['repo', 'read:user'],
      enabledApis: [],
    },
  },
};

const MINIMAL_HARBOR_CAPABILITIES: HostOAuthCapabilities = {
  providers: {
    google: {
      configured: true,
      availableScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      enabledApis: [],
    },
  },
};

const NO_OAUTH_CAPABILITIES: HostOAuthCapabilities = {
  providers: {},
};

// =============================================================================
// Validation Tests
// =============================================================================

describe('validateManifest', () => {
  it('validates a minimal manifest', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual(MINIMAL_MANIFEST);
    expect(result.errors).toBeUndefined();
  });

  it('validates the Gmail manifest', () => {
    const result = validateManifest(GMAIL_MANIFEST);
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual(GMAIL_MANIFEST);
  });

  it('rejects null', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Manifest must be an object');
  });

  it('rejects non-object', () => {
    const result = validateManifest('string');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Manifest must be an object');
  });

  it('requires manifestVersion', () => {
    const result = validateManifest({
      name: 'Test',
      package: { type: 'npm', name: 'test' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid manifestVersion');
  });

  it('requires name', () => {
    const result = validateManifest({
      manifestVersion: '1.0.0',
      package: { type: 'npm', name: 'test' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid name');
  });

  it('requires package', () => {
    const result = validateManifest({
      manifestVersion: '1.0.0',
      name: 'Test',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid package');
  });

  it('validates package.type', () => {
    const result = validateManifest({
      manifestVersion: '1.0.0',
      name: 'Test',
      package: { type: 'invalid', name: 'test' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('package.type must be one of: npm, pypi, docker, binary, git');
  });

  it('validates oauth.supportedSources', () => {
    const result = validateManifest({
      manifestVersion: '1.0.0',
      name: 'Test',
      package: { type: 'npm', name: 'test' },
      oauth: {
        provider: 'google',
        supportedSources: ['invalid'],
        scopes: ['scope'],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('oauth.supportedSources contains invalid value: invalid');
  });

  it('rejects empty oauth.supportedSources', () => {
    const result = validateManifest({
      manifestVersion: '1.0.0',
      name: 'Test',
      package: { type: 'npm', name: 'test' },
      oauth: {
        provider: 'google',
        supportedSources: [],
        scopes: ['scope'],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('oauth.supportedSources must not be empty');
  });
});

describe('parseManifest', () => {
  it('parses valid JSON', () => {
    const json = JSON.stringify(MINIMAL_MANIFEST);
    const result = parseManifest(json);
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual(MINIMAL_MANIFEST);
  });

  it('handles invalid JSON', () => {
    const result = parseManifest('not json');
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Failed to parse JSON');
  });
});

// =============================================================================
// OAuth Capability Tests
// =============================================================================

describe('checkOAuthCapabilities', () => {
  it('recommends host mode when host has all capabilities', () => {
    const result = checkOAuthCapabilities(GMAIL_MANIFEST.oauth!, FULL_HARBOR_CAPABILITIES);
    
    expect(result.canHandle).toBe(true);
    expect(result.recommendedSource).toBe('host');
    expect(result.hostModeAvailable).toBe(true);
    expect(result.userModeAvailable).toBe(true);
    expect(result.missingScopes).toBeUndefined();
    expect(result.missingApis).toBeUndefined();
    expect(result.reason).toBe('Host will handle OAuth authentication');
  });

  it('falls back to user mode when scopes are missing', () => {
    const result = checkOAuthCapabilities(GMAIL_MANIFEST.oauth!, MINIMAL_HARBOR_CAPABILITIES);
    
    expect(result.canHandle).toBe(true);
    expect(result.recommendedSource).toBe('user');
    expect(result.hostModeAvailable).toBe(false);
    expect(result.userModeAvailable).toBe(true);
    expect(result.missingScopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(result.reason).toContain('Falling back to user mode');
  });

  it('falls back to user mode when APIs are missing', () => {
    const capsWithScopesButNoApis: HostOAuthCapabilities = {
      providers: {
        google: {
          configured: true,
          availableScopes: [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.settings.basic',
          ],
          enabledApis: [], // No APIs enabled
        },
      },
    };
    
    const result = checkOAuthCapabilities(GMAIL_MANIFEST.oauth!, capsWithScopesButNoApis);
    
    expect(result.recommendedSource).toBe('user');
    expect(result.hostModeAvailable).toBe(false);
    expect(result.missingApis).toContain('gmail.googleapis.com');
  });

  it('falls back to user mode when provider not configured', () => {
    const result = checkOAuthCapabilities(GMAIL_MANIFEST.oauth!, NO_OAUTH_CAPABILITIES);
    
    expect(result.canHandle).toBe(true);
    expect(result.recommendedSource).toBe('user');
    expect(result.hostModeAvailable).toBe(false);
    expect(result.userModeAvailable).toBe(true);
  });

  it('handles server-only OAuth', () => {
    const serverOnlyOAuth: ManifestOAuth = {
      provider: 'google',
      supportedSources: ['server'],
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    };
    
    const result = checkOAuthCapabilities(serverOnlyOAuth, NO_OAUTH_CAPABILITIES);
    
    expect(result.canHandle).toBe(true);
    expect(result.recommendedSource).toBe('server');
    expect(result.hostModeAvailable).toBe(false);
    expect(result.userModeAvailable).toBe(false);
    expect(result.reason).toBe('Server handles OAuth internally');
  });

  it('respects preferredSource when possible', () => {
    const userPreferredOAuth: ManifestOAuth = {
      provider: 'google',
      supportedSources: ['host', 'user'],
      preferredSource: 'user', // Prefer user even though host is available
      scopes: GMAIL_MANIFEST.oauth!.scopes,
      apis: GMAIL_MANIFEST.oauth!.apis,
    };
    
    const result = checkOAuthCapabilities(userPreferredOAuth, FULL_HARBOR_CAPABILITIES);
    
    expect(result.recommendedSource).toBe('user');
    expect(result.reason).toBe('User will create their own OAuth application');
  });

  it('returns canHandle: false when no sources work', () => {
    const hostOnlyOAuth: ManifestOAuth = {
      provider: 'google',
      supportedSources: ['host'],
      scopes: ['https://www.googleapis.com/auth/admin'],
    };
    
    const result = checkOAuthCapabilities(hostOnlyOAuth, NO_OAUTH_CAPABILITIES);
    
    expect(result.canHandle).toBe(false);
    expect(result.reason).toBe('No supported OAuth source is available');
  });
});

// =============================================================================
// Docker Recommendation Tests
// =============================================================================

describe('getDockerRecommendation', () => {
  it('returns shouldUseDocker: false when no native code', () => {
    const result = getDockerRecommendation(GMAIL_MANIFEST);
    
    expect(result.shouldUseDocker).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns shouldUseDocker: true for hasNativeCode', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      runtime: { hasNativeCode: true },
    };
    
    const result = getDockerRecommendation(manifest);
    
    expect(result.shouldUseDocker).toBe(true);
    expect(result.reason).toContain('native code');
  });

  it('returns correct reason message for native code', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      runtime: { hasNativeCode: true },
    };
    
    const result = getDockerRecommendation(manifest);
    
    expect(result.shouldUseDocker).toBe(true);
    expect(result.reason).toBe('Has native code - Docker ensures compatibility');
  });

  it('defaults to native when no runtime specified', () => {
    const result = getDockerRecommendation(MINIMAL_MANIFEST);
    
    expect(result.shouldUseDocker).toBe(false);
  });
});

// =============================================================================
// requiresUserOAuthSetup Tests
// =============================================================================

describe('requiresUserOAuthSetup', () => {
  it('returns false when no OAuth needed', () => {
    expect(requiresUserOAuthSetup(MINIMAL_MANIFEST)).toBe(false);
  });

  it('returns false when only user mode supported (no host capabilities)', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      oauth: {
        provider: 'google',
        supportedSources: ['user'],
        scopes: ['scope'],
      },
    };
    
    expect(requiresUserOAuthSetup(manifest)).toBe(true);
  });

  it('returns true when host cannot satisfy requirements', () => {
    expect(requiresUserOAuthSetup(GMAIL_MANIFEST, MINIMAL_HARBOR_CAPABILITIES)).toBe(true);
  });

  it('returns false when host can satisfy requirements', () => {
    expect(requiresUserOAuthSetup(GMAIL_MANIFEST, FULL_HARBOR_CAPABILITIES)).toBe(false);
  });
});

// =============================================================================
// getMissingConfig Tests
// =============================================================================

describe('getMissingConfig', () => {
  it('returns canStart: true for minimal manifest', () => {
    const result = getMissingConfig(
      MINIMAL_MANIFEST,
      {},
      {},
      { hasCredentials: false, hasTokens: false }
    );
    
    expect(result.canStart).toBe(true);
    expect(result.missingEnv).toHaveLength(0);
    expect(result.missingSecrets).toHaveLength(0);
    expect(result.needsOAuth).toBe(false);
  });

  it('detects missing required environment variables', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      environment: [
        { name: 'API_URL', description: 'API URL', required: true },
        { name: 'LOG_LEVEL', description: 'Log level', required: false },
      ],
    };
    
    const result = getMissingConfig(
      manifest,
      { LOG_LEVEL: 'debug' },
      {},
      { hasCredentials: false, hasTokens: false }
    );
    
    expect(result.canStart).toBe(false);
    expect(result.missingEnv).toHaveLength(1);
    expect(result.missingEnv[0].name).toBe('API_URL');
  });

  it('detects missing required secrets', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      secrets: [
        { name: 'API_KEY', description: 'API Key', required: true },
        { name: 'OPTIONAL_KEY', description: 'Optional', required: false },
      ],
    };
    
    const result = getMissingConfig(
      manifest,
      {},
      { OPTIONAL_KEY: 'value' },
      { hasCredentials: false, hasTokens: false }
    );
    
    expect(result.canStart).toBe(false);
    expect(result.missingSecrets).toHaveLength(1);
    expect(result.missingSecrets[0].name).toBe('API_KEY');
  });

  it('detects OAuth needed for host mode', () => {
    const result = getMissingConfig(
      GMAIL_MANIFEST,
      {},
      {},
      { hasCredentials: false, hasTokens: false, mode: 'host' }
    );
    
    expect(result.canStart).toBe(false);
    expect(result.needsOAuth).toBe(true);
    expect(result.oauthMode).toBe('host');
  });

  it('returns canStart: true when OAuth tokens available for host mode', () => {
    const result = getMissingConfig(
      GMAIL_MANIFEST,
      {},
      {},
      { hasCredentials: false, hasTokens: true, mode: 'host' }
    );
    
    expect(result.canStart).toBe(true);
    expect(result.needsOAuth).toBe(false);
  });

  it('detects OAuth needed for user mode', () => {
    const result = getMissingConfig(
      GMAIL_MANIFEST,
      {},
      {},
      { hasCredentials: false, hasTokens: false, mode: 'user' }
    );
    
    expect(result.canStart).toBe(false);
    expect(result.needsOAuth).toBe(true);
    expect(result.oauthMode).toBe('user');
  });
});

// =============================================================================
// getOAuthEnvVars Tests
// =============================================================================

describe('getOAuthEnvVars', () => {
  it('returns host mode env vars', () => {
    const oauth = GMAIL_MANIFEST.oauth!;
    const tokens = {
      accessToken: 'access123',
      refreshToken: 'refresh456',
    };
    const clientCredentials = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };
    
    const env = getOAuthEnvVars(oauth, 'host', tokens, clientCredentials);
    
    expect(env).toEqual({
      GMAIL_ACCESS_TOKEN: 'access123',
      GMAIL_REFRESH_TOKEN: 'refresh456',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
    });
  });

  it('handles missing optional env vars in host mode', () => {
    const oauth: ManifestOAuth = {
      provider: 'google',
      supportedSources: ['host'],
      scopes: ['scope'],
      hostMode: {
        tokenEnvVar: 'TOKEN',
        // No refresh token env var
      },
    };
    
    const tokens = { accessToken: 'access123' };
    const env = getOAuthEnvVars(oauth, 'host', tokens);
    
    expect(env).toEqual({
      TOKEN: 'access123',
    });
  });

  it('returns user mode env vars', () => {
    const oauth = GMAIL_MANIFEST.oauth!;
    const env = getOAuthEnvVars(oauth, 'user');
    
    expect(env).toEqual({
      GMAIL_OAUTH_PATH: '~/.gmail-mcp/gcp-oauth.keys.json',
      GMAIL_CREDENTIALS_PATH: '~/.gmail-mcp/credentials.json',
    });
  });

  it('returns empty object for server mode', () => {
    const oauth = GMAIL_MANIFEST.oauth!;
    const env = getOAuthEnvVars(oauth, 'server');
    
    expect(env).toEqual({});
  });
});

// =============================================================================
// toLegacyEnvVars Tests
// =============================================================================

describe('toLegacyEnvVars', () => {
  it('converts environment and secrets', () => {
    const manifest: McpManifest = {
      ...MINIMAL_MANIFEST,
      environment: [
        { name: 'LOG_LEVEL', description: 'Log level' },
      ],
      secrets: [
        { name: 'API_KEY', description: 'API Key' },
      ],
    };
    
    const result = toLegacyEnvVars(manifest);
    
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'LOG_LEVEL',
      description: 'Log level',
      isSecret: false,
    });
    expect(result[1]).toEqual({
      name: 'API_KEY',
      description: 'API Key',
      isSecret: true,
    });
  });

  it('handles empty arrays', () => {
    const result = toLegacyEnvVars(MINIMAL_MANIFEST);
    expect(result).toHaveLength(0);
  });
});

