/**
 * MCP Server Handlers
 * 
 * Handlers for MCP server management (sidebar UI).
 */

import { registerAsyncHandler, registerHandler, errorResponse } from './types';
import {
  addServer,
  startServer,
  stopServer,
  validateAndStartServer,
  removeServer,
  listServersWithStatus,
  callTool,
} from '../mcp/host';

export function registerServerHandlers(): void {
  // List all servers with status
  registerAsyncHandler('sidebar_get_servers', async () => {
    const servers = await listServersWithStatus();
    return { ok: true, servers };
  });

  // Start a server
  registerHandler('sidebar_start_server', (message, _sender, sendResponse) => {
    const serverId = message.serverId as string | undefined;
    if (!serverId) {
      sendResponse({ ok: false, error: 'Missing serverId' });
      return true;
    }
    startServer(serverId)
      .then((started) => sendResponse({ ok: started }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Stop a server
  registerHandler('sidebar_stop_server', (message, _sender, sendResponse) => {
    const serverId = message.serverId as string | undefined;
    if (!serverId) {
      sendResponse({ ok: false, error: 'Missing serverId' });
      return true;
    }
    stopServer(serverId)
      .then((stopped) => sendResponse({ ok: stopped }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Install a server
  registerHandler('sidebar_install_server', (message, _sender, sendResponse) => {
    const manifest = message.manifest as { id?: string };
    if (!manifest?.id) {
      sendResponse({ ok: false, error: 'Missing manifest id' });
      return true;
    }
    addServer(message.manifest as Parameters<typeof addServer>[0])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Validate and start a server
  registerHandler('sidebar_validate_server', (message, _sender, sendResponse) => {
    const serverId = message.serverId as string | undefined;
    if (!serverId) {
      sendResponse({ ok: false, error: 'Missing serverId' });
      return true;
    }
    validateAndStartServer(serverId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Remove a server
  registerHandler('sidebar_remove_server', (message, _sender, sendResponse) => {
    const serverId = message.serverId as string | undefined;
    if (!serverId) {
      sendResponse({ ok: false, error: 'Missing serverId' });
      return true;
    }
    removeServer(serverId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  });

  // Call a tool
  registerHandler('sidebar_call_tool', (message, _sender, sendResponse) => {
    const { serverId, toolName, args } = message as {
      serverId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
    };
    console.log('[Harbor] sidebar_call_tool:', serverId, toolName, args);
    if (!serverId || !toolName) {
      sendResponse({ ok: false, error: 'Missing serverId or toolName' });
      return true;
    }
    callTool(serverId, toolName, args || {})
      .then((result) => {
        console.log('[Harbor] Tool result:', result);
        sendResponse(result as { ok: boolean });
      })
      .catch((error) => {
        console.error('[Harbor] Tool error:', error);
        sendResponse(errorResponse(error));
      });
    return true;
  });

  // Call MCP method directly
  registerHandler('mcp_call_method', (message, _sender, sendResponse) => {
    const { serverId, method, params } = message as {
      serverId?: string;
      method?: string;
      params?: Record<string, unknown>;
    };
    console.log('[Harbor] mcp_call_method:', serverId, method, params);
    if (!serverId || !method) {
      sendResponse({ ok: false, error: 'Missing serverId or method' });
      return true;
    }
    (async () => {
      const { callMcpMethod } = await import('../wasm/runtime');
      const result = await callMcpMethod(serverId, method, params);
      console.log('[Harbor] MCP method result:', result);
      if (result.error) {
        sendResponse({ ok: false, error: result.error.message });
      } else {
        sendResponse({ ok: true, result: result.result });
      }
    })().catch((error) => sendResponse(errorResponse(error)));
    return true;
  });
}
