/**
 * Authentication Module
 * 
 * Provides OAuth 2.0 and credential management for MCP servers.
 */

// Types
export type {
  OAuthConfig,
  OAuthTokens,
  OAuthFlowState,
  OAuthResult,
  AuthRequirement,
  CredentialInfo,
} from './types.js';

// OAuth Server
export {
  OAuthCallbackServer,
  getOAuthServer,
} from './oauth-server.js';

// OAuth Provider
export {
  OAuthProvider,
} from './oauth-provider.js';

// Auth Manager
export {
  getOAuthProvider,
  startOAuthFlow,
  cancelOAuthFlow,
  revokeOAuthAccess,
  isOAuthExpired,
  getOAuthStatus,
  isProviderConfigured,
  getConfiguredProviders,
} from './auth-manager.js';

// Built-in Providers
export {
  GITHUB_OAUTH_CONFIG,
  GITHUB_SCOPES,
  createGitHubOAuthConfig,
} from './providers/github.js';

export {
  GOOGLE_OAUTH_CONFIG,
  GOOGLE_SCOPES,
  createGoogleOAuthConfig,
} from './providers/google.js';

// Harbor OAuth Broker
export {
  HarborOAuthBroker,
  getHarborOAuthBroker,
  initHarborOAuthBroker,
  resetHarborOAuthBroker,
  type StoredServerTokens,
  type OAuthAuthResult,
  type HarborOAuthConfig,
} from './harbor-oauth.js';

// Token Store
export {
  TokenStore,
  getTokenStore,
  resetTokenStore,
} from './token-store.js';


