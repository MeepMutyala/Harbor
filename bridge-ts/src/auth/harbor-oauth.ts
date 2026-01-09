/**
 * Harbor OAuth Broker
 * 
 * Manages OAuth authentication on behalf of MCP servers using Harbor's
 * own OAuth client credentials. This enables "host mode" OAuth where
 * users don't need to create their own OAuth applications.
 * 
 * The broker:
 * - Uses Harbor's configured OAuth client IDs/secrets
 * - Performs OAuth flows on behalf of servers
 * - Stores and refreshes tokens per-server
 * - Injects tokens into server environment variables
 */

import { log } from '../native-messaging.js';
import { OAuthTokens } from './types.js';
import { OAuthProvider } from './oauth-provider.js';
import { getOAuthServer } from './oauth-server.js';
import { 
  ManifestOAuth, 
  HostOAuthCapabilities, 
  checkOAuthCapabilities,
  OAuthSource 
} from '../installer/manifest.js';
import { GOOGLE_OAUTH_CONFIG } from './providers/google.js';
import { GITHUB_OAUTH_CONFIG } from './providers/github.js';
import { TokenStore, getTokenStore } from './token-store.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Stored OAuth tokens for a server.
 */
export interface StoredServerTokens {
  serverId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Result of an OAuth authentication attempt.
 */
export interface OAuthAuthResult {
  success: boolean;
  tokens?: StoredServerTokens;
  error?: string;
}

/**
 * Configuration for Harbor's OAuth capabilities.
 */
export interface HarborOAuthConfig {
  google?: {
    clientId: string;
    clientSecret: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
  };
  microsoft?: {
    clientId: string;
    clientSecret: string;
  };
  slack?: {
    clientId: string;
    clientSecret: string;
  };
}

// =============================================================================
// Harbor OAuth Broker
// =============================================================================

/**
 * Harbor OAuth Broker - manages OAuth for MCP servers in "host mode".
 */
export class HarborOAuthBroker {
  private tokens: Map<string, StoredServerTokens> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: HarborOAuthConfig;
  private tokenStore: TokenStore;
  
  // APIs that Harbor has enabled (configured at startup or dynamically)
  private enabledApis: Map<string, Set<string>> = new Map();
  
  constructor(config: HarborOAuthConfig) {
    this.config = config;
    this.tokenStore = getTokenStore();
    
    // Load persisted tokens
    const storedTokens = this.tokenStore.getAllTokens();
    for (const token of storedTokens) {
      this.tokens.set(token.serverId, token);
    }
    if (storedTokens.length > 0) {
      log(`[HarborOAuth] Loaded ${storedTokens.length} persisted tokens`);
    }
    
    // Initialize with Google APIs we've enabled
    this.enabledApis.set('google', new Set([
      'gmail.googleapis.com',
      'drive.googleapis.com',
      'calendar-json.googleapis.com',
      'sheets.googleapis.com',
      'docs.googleapis.com',
    ]));
  }
  
  /**
   * Get Harbor's OAuth capabilities for manifest checking.
   */
  getCapabilities(): HostOAuthCapabilities {
    const providers: HostOAuthCapabilities['providers'] = {};
    
    // Google
    if (this.config.google?.clientId) {
      providers.google = {
        configured: true,
        // All scopes Harbor's app is authorized for
        availableScopes: [
          // Gmail
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.settings.basic',
          // Drive
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
          // Calendar
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          // Sheets
          'https://www.googleapis.com/auth/spreadsheets.readonly',
          'https://www.googleapis.com/auth/spreadsheets',
          // Basic profile
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'openid',
        ],
        enabledApis: Array.from(this.enabledApis.get('google') || []),
      };
    }
    
    // GitHub
    if (this.config.github?.clientId) {
      providers.github = {
        configured: true,
        availableScopes: ['repo', 'read:user', 'user:email', 'gist'],
        enabledApis: [], // GitHub doesn't have separate API enablement
      };
    }
    
    // Microsoft
    if (this.config.microsoft?.clientId) {
      providers.microsoft = {
        configured: true,
        availableScopes: [
          'User.Read',
          'Mail.Read',
          'Mail.Send',
          'Calendars.Read',
          'Calendars.ReadWrite',
          'Files.Read',
          'Files.ReadWrite',
        ],
        enabledApis: [],
      };
    }
    
    // Slack
    if (this.config.slack?.clientId) {
      providers.slack = {
        configured: true,
        availableScopes: [
          'channels:read',
          'channels:history',
          'chat:write',
          'users:read',
        ],
        enabledApis: [],
      };
    }
    
    return { providers };
  }
  
  /**
   * Check if Harbor can handle OAuth for a manifest.
   */
  canHandle(oauth: ManifestOAuth): boolean {
    const capabilities = this.getCapabilities();
    const check = checkOAuthCapabilities(oauth, capabilities);
    return check.hostModeAvailable;
  }
  
  /**
   * Determine the best OAuth mode for a manifest.
   */
  determineOAuthMode(oauth: ManifestOAuth): OAuthSource {
    const capabilities = this.getCapabilities();
    const check = checkOAuthCapabilities(oauth, capabilities);
    return check.recommendedSource;
  }
  
  /**
   * Get detailed capability check for a manifest.
   */
  checkCapabilities(oauth: ManifestOAuth) {
    return checkOAuthCapabilities(oauth, this.getCapabilities());
  }
  
  /**
   * Start OAuth authentication for a server.
   * Opens browser for user to authenticate.
   */
  async authenticate(
    serverId: string,
    oauth: ManifestOAuth
  ): Promise<OAuthAuthResult> {
    log(`[HarborOAuth] Starting authentication for server ${serverId}`);
    
    // Check if we can handle this
    if (!this.canHandle(oauth)) {
      return {
        success: false,
        error: `Harbor cannot handle OAuth for provider ${oauth.provider}. ` +
               `Missing scopes or APIs.`,
      };
    }
    
    // Get provider credentials
    const credentials = this.getProviderCredentials(oauth.provider);
    if (!credentials) {
      return {
        success: false,
        error: `No OAuth credentials configured for ${oauth.provider}`,
      };
    }
    
    try {
      // Create provider with Harbor's credentials and requested scopes
      const provider = this.createProvider(oauth.provider, credentials, oauth.scopes);
      
      // Start the flow
      const { authUrl, flow } = await provider.startAuthFlow(serverId, `${serverId}:oauth`);
      
      // Register with callback server and wait for code
      const server = getOAuthServer();
      const codePromise = server.registerFlow(flow);
      
      log(`[HarborOAuth] Auth URL ready for ${serverId}: ${authUrl}`);
      
      // Return auth URL - caller should open this in browser
      // Then call completeAuthentication when code is received
      
      // Wait for the code
      const code = await codePromise;
      
      // Exchange for tokens
      const tokens = await provider.exchangeCode(code, flow);
      
      // Store tokens
      const storedTokens: StoredServerTokens = {
        serverId,
        provider: oauth.provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: oauth.scopes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      this.tokens.set(serverId, storedTokens);
      this.tokenStore.saveTokens(storedTokens);  // Persist to disk
      
      // Schedule refresh if we have expiry
      if (tokens.expiresAt && tokens.refreshToken) {
        this.scheduleRefresh(serverId, oauth, storedTokens);
      }
      
      log(`[HarborOAuth] Authentication successful for ${serverId}`);
      
      return {
        success: true,
        tokens: storedTokens,
      };
      
    } catch (err) {
      log(`[HarborOAuth] Authentication failed for ${serverId}: ${err}`);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  
  /**
   * Start OAuth flow and return auth URL.
   * Use this when you want to handle the callback separately.
   */
  async startAuthFlow(
    serverId: string,
    oauth: ManifestOAuth
  ): Promise<{ authUrl: string; state: string } | { error: string }> {
    if (!this.canHandle(oauth)) {
      return {
        error: `Harbor cannot handle OAuth for provider ${oauth.provider}`,
      };
    }
    
    const credentials = this.getProviderCredentials(oauth.provider);
    if (!credentials) {
      return { error: `No OAuth credentials configured for ${oauth.provider}` };
    }
    
    const provider = this.createProvider(oauth.provider, credentials, oauth.scopes);
    const { authUrl, flow } = await provider.startAuthFlow(serverId, `${serverId}:oauth`);
    
    // Store the flow for later completion
    const server = getOAuthServer();
    
    // Set up async handler for callback
    const codePromise = server.registerFlow(flow);
    this.handleAuthCallback(serverId, oauth, provider, flow, codePromise);
    
    return { authUrl, state: flow.state };
  }
  
  /**
   * Handle auth callback asynchronously.
   */
  private async handleAuthCallback(
    serverId: string,
    oauth: ManifestOAuth,
    provider: OAuthProvider,
    flow: { state: string; codeVerifier?: string; providerId: string; serverId: string; credentialKey: string; startedAt: number },
    codePromise: Promise<string>
  ): Promise<void> {
    try {
      const code = await codePromise;
      const tokens = await provider.exchangeCode(code, flow);
      
      const storedTokens: StoredServerTokens = {
        serverId,
        provider: oauth.provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: oauth.scopes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      this.tokens.set(serverId, storedTokens);
      this.tokenStore.saveTokens(storedTokens);  // Persist to disk
      
      if (tokens.expiresAt && tokens.refreshToken) {
        this.scheduleRefresh(serverId, oauth, storedTokens);
      }
      
      log(`[HarborOAuth] Auth callback completed for ${serverId}`);
      
    } catch (err) {
      log(`[HarborOAuth] Auth callback failed for ${serverId}: ${err}`);
    }
  }
  
  /**
   * Get tokens for a server.
   */
  getTokens(serverId: string): StoredServerTokens | null {
    return this.tokens.get(serverId) || null;
  }
  
  /**
   * Check if we have valid (non-expired) tokens for a server.
   */
  hasValidTokens(serverId: string): boolean {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return false;
    
    if (tokens.expiresAt) {
      // Consider expired if less than 1 minute remaining
      return tokens.expiresAt > Date.now() + 60000;
    }
    
    return true;
  }
  
  /**
   * Refresh tokens for a server if needed.
   */
  async refreshIfNeeded(serverId: string, oauth: ManifestOAuth): Promise<StoredServerTokens | null> {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return null;
    
    // Check if refresh is needed (less than 5 minutes remaining)
    const needsRefresh = tokens.expiresAt && tokens.expiresAt < Date.now() + 5 * 60 * 1000;
    
    if (!needsRefresh) {
      return tokens;
    }
    
    if (!tokens.refreshToken) {
      log(`[HarborOAuth] Cannot refresh tokens for ${serverId}: no refresh token`);
      return null;
    }
    
    try {
      const credentials = this.getProviderCredentials(oauth.provider);
      if (!credentials) {
        log(`[HarborOAuth] Cannot refresh: no credentials for ${oauth.provider}`);
        return null;
      }
      
      const provider = this.createProvider(oauth.provider, credentials, oauth.scopes);
      const newTokens = await provider.refreshToken(tokens.refreshToken);
      
      const updatedTokens: StoredServerTokens = {
        ...tokens,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || tokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        updatedAt: Date.now(),
      };
      
      this.tokens.set(serverId, updatedTokens);
      this.tokenStore.saveTokens(updatedTokens);  // Persist to disk
      
      log(`[HarborOAuth] Tokens refreshed for ${serverId}`);
      
      return updatedTokens;
      
    } catch (err) {
      log(`[HarborOAuth] Token refresh failed for ${serverId}: ${err}`);
      return null;
    }
  }
  
  /**
   * Remove tokens for a server.
   */
  removeTokens(serverId: string): void {
    this.tokens.delete(serverId);
    
    const timer = this.refreshTimers.get(serverId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(serverId);
    }
    
    log(`[HarborOAuth] Removed tokens for ${serverId}`);
  }
  
  /**
   * Get environment variables to inject for host mode OAuth.
   */
  getEnvVarsForServer(serverId: string, oauth: ManifestOAuth): Record<string, string> | null {
    const tokens = this.tokens.get(serverId);
    if (!tokens) return null;
    
    const env: Record<string, string> = {};
    const hostMode = oauth.hostMode;
    
    if (!hostMode) return env;
    
    if (hostMode.tokenEnvVar) {
      env[hostMode.tokenEnvVar] = tokens.accessToken;
    }
    
    if (hostMode.refreshTokenEnvVar && tokens.refreshToken) {
      env[hostMode.refreshTokenEnvVar] = tokens.refreshToken;
    }
    
    // Include client credentials if server needs them for refresh
    const credentials = this.getProviderCredentials(oauth.provider);
    if (credentials) {
      if (hostMode.clientIdEnvVar) {
        env[hostMode.clientIdEnvVar] = credentials.clientId;
      }
      if (hostMode.clientSecretEnvVar) {
        env[hostMode.clientSecretEnvVar] = credentials.clientSecret;
      }
    }
    
    return env;
  }
  
  /**
   * Get provider credentials from config.
   */
  private getProviderCredentials(provider: string): { clientId: string; clientSecret: string } | null {
    switch (provider) {
      case 'google':
        if (this.config.google?.clientId && this.config.google?.clientSecret) {
          return this.config.google;
        }
        break;
      case 'github':
        if (this.config.github?.clientId && this.config.github?.clientSecret) {
          return this.config.github;
        }
        break;
      case 'microsoft':
        if (this.config.microsoft?.clientId && this.config.microsoft?.clientSecret) {
          return this.config.microsoft;
        }
        break;
      case 'slack':
        if (this.config.slack?.clientId && this.config.slack?.clientSecret) {
          return this.config.slack;
        }
        break;
    }
    return null;
  }
  
  /**
   * Create an OAuth provider with specific credentials and scopes.
   */
  private createProvider(
    providerName: string,
    credentials: { clientId: string; clientSecret: string },
    scopes: string[]
  ): OAuthProvider {
    let baseConfig;
    
    switch (providerName) {
      case 'google':
        baseConfig = GOOGLE_OAUTH_CONFIG;
        break;
      case 'github':
        baseConfig = GITHUB_OAUTH_CONFIG;
        break;
      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }
    
    return new OAuthProvider({
      ...baseConfig,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      scopes,
    });
  }
  
  /**
   * Schedule token refresh before expiry.
   */
  private scheduleRefresh(
    serverId: string,
    oauth: ManifestOAuth,
    tokens: StoredServerTokens
  ): void {
    if (!tokens.expiresAt || !tokens.refreshToken) return;
    
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(serverId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Refresh 5 minutes before expiry
    const refreshAt = tokens.expiresAt - 5 * 60 * 1000;
    const delay = refreshAt - Date.now();
    
    if (delay <= 0) {
      // Needs refresh now
      this.refreshIfNeeded(serverId, oauth);
      return;
    }
    
    log(`[HarborOAuth] Scheduling refresh for ${serverId} in ${Math.round(delay / 1000)}s`);
    
    const timer = setTimeout(() => {
      this.refreshIfNeeded(serverId, oauth);
    }, delay);
    
    this.refreshTimers.set(serverId, timer);
  }
  
  /**
   * Load tokens from persistent storage.
   */
  loadTokens(tokens: StoredServerTokens[]): void {
    for (const token of tokens) {
      this.tokens.set(token.serverId, token);
    }
    log(`[HarborOAuth] Loaded ${tokens.length} stored tokens`);
  }
  
  /**
   * Get all tokens for persistence.
   */
  getAllTokens(): StoredServerTokens[] {
    return Array.from(this.tokens.values());
  }
  
  /**
   * Cleanup - cancel all refresh timers.
   */
  cleanup(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let _broker: HarborOAuthBroker | null = null;

/**
 * Get the Harbor OAuth broker singleton.
 * Initializes with environment variables on first call.
 */
export function getHarborOAuthBroker(): HarborOAuthBroker {
  if (!_broker) {
    _broker = new HarborOAuthBroker({
      google: process.env.HARBOR_GOOGLE_CLIENT_ID && process.env.HARBOR_GOOGLE_CLIENT_SECRET ? {
        clientId: process.env.HARBOR_GOOGLE_CLIENT_ID,
        clientSecret: process.env.HARBOR_GOOGLE_CLIENT_SECRET,
      } : undefined,
      github: process.env.HARBOR_GITHUB_CLIENT_ID && process.env.HARBOR_GITHUB_CLIENT_SECRET ? {
        clientId: process.env.HARBOR_GITHUB_CLIENT_ID,
        clientSecret: process.env.HARBOR_GITHUB_CLIENT_SECRET,
      } : undefined,
      microsoft: process.env.HARBOR_MICROSOFT_CLIENT_ID && process.env.HARBOR_MICROSOFT_CLIENT_SECRET ? {
        clientId: process.env.HARBOR_MICROSOFT_CLIENT_ID,
        clientSecret: process.env.HARBOR_MICROSOFT_CLIENT_SECRET,
      } : undefined,
      slack: process.env.HARBOR_SLACK_CLIENT_ID && process.env.HARBOR_SLACK_CLIENT_SECRET ? {
        clientId: process.env.HARBOR_SLACK_CLIENT_ID,
        clientSecret: process.env.HARBOR_SLACK_CLIENT_SECRET,
      } : undefined,
    });
  }
  return _broker;
}

/**
 * Initialize the broker with explicit config (for testing).
 */
export function initHarborOAuthBroker(config: HarborOAuthConfig): HarborOAuthBroker {
  _broker = new HarborOAuthBroker(config);
  return _broker;
}

/**
 * Reset the broker (for testing).
 */
export function resetHarborOAuthBroker(): void {
  if (_broker) {
    _broker.cleanup();
    _broker = null;
  }
}

