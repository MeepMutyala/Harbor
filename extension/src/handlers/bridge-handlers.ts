/**
 * Bridge Handlers
 * 
 * Handlers for native bridge status and communication.
 */

import { registerHandler, registerAsyncHandler, errorResponse } from './types';
import { getBridgeConnectionState, checkBridgeHealth, bridgeRequest } from '../llm/bridge-client';
import { getConnectionState as getNativeConnectionState } from '../llm/native-bridge';

export function registerBridgeHandlers(): void {
  // Get bridge status
  registerHandler('bridge_get_status', (_message, _sender, sendResponse) => {
    const state = getBridgeConnectionState();
    sendResponse({ ok: true, ...state });
    return true;
  });

  // Check bridge health
  registerHandler('bridge_check_health', (_message, _sender, sendResponse) => {
    checkBridgeHealth()
      .then(() => {
        const state = getBridgeConnectionState();
        sendResponse({ ok: true, ...state });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  });

  // Get native bridge status
  registerHandler('native_bridge_status', (_message, _sender, sendResponse) => {
    const state = getNativeConnectionState();
    sendResponse({ ok: true, ...state });
    return true;
  });

  // Generic bridge RPC passthrough
  registerHandler('bridge_rpc', (message, _sender, sendResponse) => {
    const { method, params } = message as { method?: string; params?: unknown };
    if (!method) {
      sendResponse({ ok: false, error: 'Missing method' });
      return true;
    }
    console.log('[Harbor] bridge_rpc:', method);
    bridgeRequest(method, params)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        console.error('[Harbor] bridge_rpc error:', error);
        sendResponse(errorResponse(error));
      });
    return true;
  });
}
