/**
 * Message handlers for the native messaging bridge.
 */

import { log } from './native-messaging.js';
import { getServerStore, ServerStore } from './server-store.js';
import { getMcpClient, McpClient } from './mcp-client.js';
import { getCatalogManager, CatalogManager } from './catalog/index.js';
import { getInstalledServerManager, InstalledServerManager } from './installer/index.js';
import { 
  Message, 
  ErrorResponse, 
  ResultResponse, 
  ServerStatus,
  CatalogServer 
} from './types.js';

const VERSION = '0.1.0';

type MessageHandler = (
  message: Message,
  store: ServerStore,
  client: McpClient,
  catalog: CatalogManager,
  installer: InstalledServerManager
) => Promise<ResultResponse | ErrorResponse>;

function makeError(
  requestId: string,
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
  return {
    type: 'error',
    request_id: requestId,
    error: { code, message, details },
  };
}

function makeResult(
  type: string,
  requestId: string,
  data: object
): ResultResponse {
  return {
    type: `${type}_result`,
    request_id: requestId,
    ...data,
  } as ResultResponse;
}

// =============================================================================
// Core Handlers
// =============================================================================

const handleHello: MessageHandler = async (message) => {
  return {
    type: 'pong',
    request_id: message.request_id || '',
    bridge_version: VERSION,
  };
};

const handleAddServer: MessageHandler = async (message, store) => {
  const requestId = message.request_id || '';
  const label = message.label as string;
  const baseUrl = message.base_url as string;

  if (!label || typeof label !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'label' parameter");
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'base_url' parameter");
  }

  try {
    const server = await store.addServer(label, baseUrl);
    return makeResult('add_server', requestId, { server });
  } catch (e) {
    log(`Failed to add server: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to add server: ${e}`);
  }
};

const handleRemoveServer: MessageHandler = async (message, store) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  try {
    const removed = await store.removeServer(serverId);
    if (!removed) {
      return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
    }
    return makeResult('remove_server', requestId, { removed: true });
  } catch (e) {
    log(`Failed to remove server: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to remove server: ${e}`);
  }
};

const handleListServers: MessageHandler = async (message, store) => {
  const requestId = message.request_id || '';

  try {
    const servers = await store.listServers();
    return makeResult('list_servers', requestId, { servers });
  } catch (e) {
    log(`Failed to list servers: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to list servers: ${e}`);
  }
};

const handleConnectServer: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  await store.updateStatus(serverId, ServerStatus.CONNECTING);

  try {
    const result = await client.connect(server.baseUrl);

    if (result.success) {
      await store.updateStatus(serverId, ServerStatus.CONNECTED);
      const updatedServer = await store.getServer(serverId);
      return makeResult('connect_server', requestId, {
        server: updatedServer,
        connection_info: result.serverInfo,
      });
    } else {
      await store.updateStatus(serverId, ServerStatus.ERROR, result.message);
      return makeError(requestId, 'connection_failed', result.message);
    }
  } catch (e) {
    log(`Failed to connect to server: ${e}`);
    await store.updateStatus(serverId, ServerStatus.ERROR, String(e));
    return makeError(requestId, 'connection_error', `Connection error: ${e}`);
  }
};

const handleDisconnectServer: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  try {
    await client.disconnect(server.baseUrl);
    await store.updateStatus(serverId, ServerStatus.DISCONNECTED);
    const updatedServer = await store.getServer(serverId);
    return makeResult('disconnect_server', requestId, { server: updatedServer });
  } catch (e) {
    log(`Failed to disconnect from server: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to disconnect: ${e}`);
  }
};

const handleListTools: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  if (server.status !== ServerStatus.CONNECTED) {
    return makeError(requestId, 'not_connected', `Server is not connected (status: ${server.status})`);
  }

  try {
    const tools = await client.listTools(server.baseUrl);
    return makeResult('list_tools', requestId, { tools });
  } catch (e) {
    log(`Failed to list tools: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to list tools: ${e}`);
  }
};

const handleListResources: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  if (server.status !== ServerStatus.CONNECTED) {
    return makeError(requestId, 'not_connected', `Server is not connected (status: ${server.status})`);
  }

  try {
    const resources = await client.listResources(server.baseUrl);
    return makeResult('list_resources', requestId, { resources });
  } catch (e) {
    log(`Failed to list resources: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to list resources: ${e}`);
  }
};

const handleListPrompts: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  if (server.status !== ServerStatus.CONNECTED) {
    return makeError(requestId, 'not_connected', `Server is not connected (status: ${server.status})`);
  }

  try {
    const prompts = await client.listPrompts(server.baseUrl);
    return makeResult('list_prompts', requestId, { prompts });
  } catch (e) {
    log(`Failed to list prompts: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to list prompts: ${e}`);
  }
};

const handleCallTool: MessageHandler = async (message, store, client) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string;
  const toolName = message.tool_name as string;
  const args = (message.arguments || {}) as Record<string, unknown>;

  if (!serverId || typeof serverId !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'server_id' parameter");
  }
  if (!toolName || typeof toolName !== 'string') {
    return makeError(requestId, 'invalid_params', "Missing or invalid 'tool_name' parameter");
  }

  const server = await store.getServer(serverId);
  if (!server) {
    return makeError(requestId, 'not_found', `Server not found: ${serverId}`);
  }

  if (server.status !== ServerStatus.CONNECTED) {
    return makeError(requestId, 'not_connected', `Server is not connected (status: ${server.status})`);
  }

  try {
    const result = await client.callTool(server.baseUrl, toolName, args);
    if (result.success) {
      return makeResult('call_tool', requestId, { content: result.content });
    } else {
      return makeError(requestId, 'tool_error', result.error || 'Tool invocation failed');
    }
  } catch (e) {
    log(`Failed to call tool: ${e}`);
    return makeError(requestId, 'internal_error', `Failed to call tool: ${e}`);
  }
};

// =============================================================================
// Catalog Handlers
// =============================================================================

const handleCatalogGet: MessageHandler = async (message, _store, _client, catalog) => {
  const requestId = message.request_id || '';
  const force = message.force as boolean || false;
  const query = message.query as string | undefined;

  try {
    const result = await catalog.fetchAll({ forceRefresh: force, query });
    return makeResult('catalog_get', requestId, result);
  } catch (e) {
    log(`Failed to fetch catalog: ${e}`);
    return makeError(requestId, 'catalog_error', `Failed to fetch catalog: ${e}`);
  }
};

const handleCatalogRefresh: MessageHandler = async (message, _store, _client, catalog) => {
  const requestId = message.request_id || '';
  const query = message.query as string | undefined;

  try {
    const result = await catalog.fetchAll({ forceRefresh: true, query });
    return makeResult('catalog_refresh', requestId, result);
  } catch (e) {
    log(`Failed to refresh catalog: ${e}`);
    return makeError(requestId, 'catalog_error', `Failed to refresh catalog: ${e}`);
  }
};

const handleCatalogSearch: MessageHandler = async (message, _store, _client, catalog) => {
  const requestId = message.request_id || '';
  const query = message.query as string || '';

  if (!query) {
    return makeError(requestId, 'invalid_request', "Missing 'query' field for catalog search");
  }

  try {
    const result = await catalog.search(query);
    return makeResult('catalog_search', requestId, result);
  } catch (e) {
    log(`Failed to search catalog: ${e}`);
    return makeError(requestId, 'catalog_error', `Failed to search catalog: ${e}`);
  }
};

// =============================================================================
// Installer Handlers
// =============================================================================

const handleCheckRuntimes: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';

  try {
    const result = await installer.checkRuntimes();
    return makeResult('check_runtimes', requestId, result);
  } catch (e) {
    log(`Failed to check runtimes: ${e}`);
    return makeError(requestId, 'runtime_error', String(e));
  }
};

const handleInstallServer: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const catalogEntry = message.catalog_entry as CatalogServer | undefined;
  const packageIndex = (message.package_index as number) || 0;

  if (!catalogEntry) {
    return makeError(requestId, 'invalid_request', 'Missing catalog_entry');
  }

  try {
    const server = await installer.install(catalogEntry, packageIndex);
    return makeResult('install_server', requestId, { server });
  } catch (e) {
    log(`Failed to install server: ${e}`);
    return makeError(requestId, 'install_error', String(e));
  }
};

const handleUninstallServer: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string || '';

  if (!serverId) {
    return makeError(requestId, 'invalid_request', 'Missing server_id');
  }

  try {
    const success = installer.uninstall(serverId);
    return makeResult('uninstall_server', requestId, { success });
  } catch (e) {
    log(`Failed to uninstall server: ${e}`);
    return makeError(requestId, 'uninstall_error', String(e));
  }
};

const handleListInstalled: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';

  try {
    const statuses = installer.getAllStatus();
    return makeResult('list_installed', requestId, { servers: statuses });
  } catch (e) {
    log(`Failed to list installed servers: ${e}`);
    return makeError(requestId, 'list_error', String(e));
  }
};

const handleStartInstalled: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string || '';

  if (!serverId) {
    return makeError(requestId, 'invalid_request', 'Missing server_id');
  }

  try {
    const proc = await installer.start(serverId);
    return makeResult('start_installed', requestId, { process: proc });
  } catch (e) {
    log(`Failed to start server: ${e}`);
    return makeError(requestId, 'start_error', String(e));
  }
};

const handleStopInstalled: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string || '';

  if (!serverId) {
    return makeError(requestId, 'invalid_request', 'Missing server_id');
  }

  try {
    const success = await installer.stop(serverId);
    return makeResult('stop_installed', requestId, { success });
  } catch (e) {
    log(`Failed to stop server: ${e}`);
    return makeError(requestId, 'stop_error', String(e));
  }
};

const handleSetServerSecrets: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string || '';
  const secrets = (message.secrets || {}) as Record<string, string>;

  if (!serverId) {
    return makeError(requestId, 'invalid_request', 'Missing server_id');
  }

  try {
    installer.setSecrets(serverId, secrets);
    const status = installer.getStatus(serverId);
    return makeResult('set_server_secrets', requestId, { status });
  } catch (e) {
    log(`Failed to set secrets: ${e}`);
    return makeError(requestId, 'secrets_error', String(e));
  }
};

const handleGetServerStatus: MessageHandler = async (message, _store, _client, _catalog, installer) => {
  const requestId = message.request_id || '';
  const serverId = message.server_id as string || '';

  if (!serverId) {
    return makeError(requestId, 'invalid_request', 'Missing server_id');
  }

  try {
    const status = installer.getStatus(serverId);
    return makeResult('get_server_status', requestId, status);
  } catch (e) {
    log(`Failed to get server status: ${e}`);
    return makeError(requestId, 'status_error', String(e));
  }
};

// =============================================================================
// Handler Registry
// =============================================================================

const HANDLERS: Record<string, MessageHandler> = {
  hello: handleHello,
  add_server: handleAddServer,
  remove_server: handleRemoveServer,
  list_servers: handleListServers,
  connect_server: handleConnectServer,
  disconnect_server: handleDisconnectServer,
  list_tools: handleListTools,
  list_resources: handleListResources,
  list_prompts: handleListPrompts,
  call_tool: handleCallTool,
  // Catalog handlers
  catalog_get: handleCatalogGet,
  catalog_refresh: handleCatalogRefresh,
  catalog_search: handleCatalogSearch,
  // Installer handlers
  check_runtimes: handleCheckRuntimes,
  install_server: handleInstallServer,
  uninstall_server: handleUninstallServer,
  list_installed: handleListInstalled,
  start_installed: handleStartInstalled,
  stop_installed: handleStopInstalled,
  set_server_secrets: handleSetServerSecrets,
  get_server_status: handleGetServerStatus,
};

export async function dispatchMessage(
  message: Message
): Promise<ResultResponse | ErrorResponse> {
  const messageType = message.type;
  const requestId = message.request_id || '';

  if (!messageType) {
    return makeError(requestId, 'invalid_message', "Missing 'type' field in message");
  }

  const handler = HANDLERS[messageType];
  if (!handler) {
    return makeError(
      requestId,
      'unknown_message_type',
      `Unknown message type: ${messageType}`,
      { received_type: messageType }
    );
  }

  const store = getServerStore();
  const client = getMcpClient();
  const catalog = getCatalogManager();
  const installer = getInstalledServerManager();

  return handler(message, store, client, catalog, installer);
}

