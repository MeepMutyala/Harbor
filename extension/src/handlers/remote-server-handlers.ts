/**
 * Remote Server Handlers
 * 
 * Handlers for remote MCP server testing and connection.
 */

import { registerHandler, errorResponse } from './types';
import { addServer, validateAndStartServer, removeServer } from '../mcp/host';

export function registerRemoteServerHandlers(): void {
  // Test remote server connection
  registerHandler('sidebar_test_remote_server', (message, _sender, sendResponse) => {
    const { url, transport, authHeader } = message as {
      url?: string;
      transport?: 'sse' | 'websocket';
      authHeader?: string;
    };
    if (!url) {
      sendResponse({ ok: false, error: 'Missing URL' });
      return true;
    }
    (async () => {
      const { createRemoteTransport } = await import('../mcp/remote-transport');
      const remoteTransport = createRemoteTransport({
        url,
        transport: transport || 'sse',
        authHeader,
        timeout: 10000,
        autoReconnect: false,
      });

      try {
        await remoteTransport.connect();

        const requestId = crypto.randomUUID();
        const response = await remoteTransport.send({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/list',
        });

        remoteTransport.disconnect();

        if (response.error) {
          sendResponse({ ok: false, error: response.error.message });
          return;
        }

        const tools = (response.result as { tools?: Array<{ name: string }> })?.tools || [];
        sendResponse({
          ok: true,
          toolCount: tools.length,
          tools: tools.map((t) => t.name),
        });
      } catch (error) {
        remoteTransport.disconnect();
        sendResponse(errorResponse(error));
      }
    })();
    return true;
  });

  // Add remote server
  registerHandler('sidebar_add_remote_server', (message, _sender, sendResponse) => {
    const { url, name, transport, authHeader } = message as {
      url?: string;
      name?: string;
      transport?: 'sse' | 'websocket';
      authHeader?: string;
    };
    if (!url || !name) {
      sendResponse({ ok: false, error: 'Missing URL or name' });
      return true;
    }
    (async () => {
      try {
        const serverId = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const manifest = {
          id: serverId,
          name,
          version: '1.0.0',
          runtime: 'remote' as const,
          remoteUrl: url,
          remoteTransport: transport || 'sse',
          remoteAuthHeader: authHeader,
          permissions: [],
          tools: [] as Array<{ name: string; description?: string }>,
        };

        await addServer(manifest);

        const result = await validateAndStartServer(serverId);
        if (!result.ok) {
          await removeServer(serverId);
          sendResponse({ ok: false, error: result.error || 'Failed to connect to server' });
          return;
        }

        sendResponse({ ok: true, serverId });
      } catch (error) {
        sendResponse(errorResponse(error));
      }
    })();
    return true;
  });
}
