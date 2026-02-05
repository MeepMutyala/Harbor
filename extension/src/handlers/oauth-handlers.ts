/**
 * OAuth Handlers
 * 
 * Handlers for OAuth flow management.
 */

import { registerHandler, errorResponse } from './types';
import { browserAPI } from '../browser-compat';
import { bridgeRequest } from '../llm/bridge-client';

export function registerOAuthHandlers(): void {
  // Start OAuth flow
  registerHandler('oauth_start_flow', (message, _sender, sendResponse) => {
    const { provider, server_id, scopes } = message as {
      provider?: string;
      server_id?: string;
      scopes?: string[];
    };
    if (!provider || !server_id || !scopes?.length) {
      sendResponse({ ok: false, error: 'Missing provider, server_id, or scopes' });
      return true;
    }
    bridgeRequest<{ auth_url: string; state: string }>('oauth.start_flow', {
      provider, server_id, scopes,
    })
      .then((result) => {
        browserAPI.tabs.create({ url: result.auth_url });
        sendResponse({ ok: true, state: result.state });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Get OAuth status
  registerHandler('oauth_status', (message, _sender, sendResponse) => {
    const { server_id } = message as { server_id?: string };
    if (!server_id) {
      sendResponse({ ok: false, error: 'Missing server_id' });
      return true;
    }
    bridgeRequest<{
      authenticated: boolean;
      provider?: string;
      scopes?: string[];
      is_expired?: boolean;
      expires_at?: number;
      has_refresh_token?: boolean;
    }>('oauth.status', { server_id })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Get OAuth tokens
  registerHandler('oauth_get_tokens', (message, _sender, sendResponse) => {
    const { server_id } = message as { server_id?: string };
    if (!server_id) {
      sendResponse({ ok: false, error: 'Missing server_id' });
      return true;
    }
    bridgeRequest<{
      has_tokens: boolean;
      access_token?: string;
      expires_at?: number;
      provider?: string;
      scopes?: string[];
    }>('oauth.get_tokens', { server_id })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Revoke OAuth tokens
  registerHandler('oauth_revoke', (message, _sender, sendResponse) => {
    const { server_id } = message as { server_id?: string };
    if (!server_id) {
      sendResponse({ ok: false, error: 'Missing server_id' });
      return true;
    }
    bridgeRequest<{ success: boolean }>('oauth.revoke', { server_id })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // List OAuth providers
  registerHandler('oauth_list_providers', (_message, _sender, sendResponse) => {
    bridgeRequest<{
      providers: Array<{
        id: string;
        name: string;
        configured: boolean;
        scopes?: Record<string, string>;
      }>;
    }>('oauth.list_providers')
      .then((result) => sendResponse({ ok: true, providers: result.providers }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Get credentials status
  registerHandler('oauth_get_credentials_status', (_message, _sender, sendResponse) => {
    bridgeRequest<{
      providers: Record<string, {
        configured: boolean;
        client_id_preview?: string;
      }>;
    }>('oauth.get_credentials_status')
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Set credentials
  registerHandler('oauth_set_credentials', (message, _sender, sendResponse) => {
    const { provider, client_id, client_secret } = message as {
      provider?: string;
      client_id?: string;
      client_secret?: string;
    };
    if (!provider || !client_id || !client_secret) {
      sendResponse({ ok: false, error: 'Missing required fields' });
      return true;
    }
    bridgeRequest<{ success: boolean; provider: string }>('oauth.set_credentials', {
      provider, client_id, client_secret,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Remove credentials
  registerHandler('oauth_remove_credentials', (message, _sender, sendResponse) => {
    const { provider } = message as { provider?: string };
    if (!provider) {
      sendResponse({ ok: false, error: 'Missing provider' });
      return true;
    }
    bridgeRequest<{ success: boolean; provider: string }>('oauth.remove_credentials', { provider })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });
}
