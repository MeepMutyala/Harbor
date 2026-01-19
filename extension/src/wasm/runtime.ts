import type { WasmServerHandle, WasmServerManifest } from './types';
import type { McpResponse, ToolCallParams } from '../mcp/protocol';
import type { McpTransport } from '../mcp/transport';
import { McpStdioTransport } from '../mcp/stdio-transport';
import { createWasmSession } from './session';

type ToolEntry = {
  serverId: string;
  name: string;
};

const runningServers = new Map<string, WasmServerHandle>();
const toolIndex = new Map<string, ToolEntry>();
const activeSessions = new Map<string, { transport: McpTransport; close: () => void }>();

export function initializeWasmRuntime(): void {
  // TODO: Wire WASI + wasmtime runtime integration.
  console.log('[Harbor] WASM runtime placeholder');
}

export function registerWasmServer(manifest: WasmServerManifest): WasmServerHandle {
  const existing = runningServers.get(manifest.id);
  if (existing) {
    (existing.manifest.tools || []).forEach((tool) => {
      toolIndex.delete(`${manifest.id}:${tool.name}`);
    });
  }
  const handle: WasmServerHandle = { id: manifest.id, manifest };
  runningServers.set(handle.id, handle);
  (manifest.tools || []).forEach((tool) => {
    const key = `${manifest.id}:${tool.name}`;
    toolIndex.set(key, { serverId: manifest.id, name: tool.name });
  });
  return handle;
}

export function listWasmServers(): WasmServerHandle[] {
  return Array.from(runningServers.values());
}

export function getWasmServer(serverId: string): WasmServerHandle | undefined {
  return runningServers.get(serverId);
}

export function listRunningServerIds(): string[] {
  return Array.from(activeSessions.keys());
}

export function unregisterWasmServer(serverId: string): void {
  const existing = runningServers.get(serverId);
  if (existing) {
    (existing.manifest.tools || []).forEach((tool) => {
      toolIndex.delete(`${serverId}:${tool.name}`);
    });
  }
  runningServers.delete(serverId);
  const session = activeSessions.get(serverId);
  session?.close();
  activeSessions.delete(serverId);
}

export async function startWasmServer(serverId: string): Promise<boolean> {
  const handle = runningServers.get(serverId);
  if (!handle) {
    return false;
  }
  if (activeSessions.has(serverId)) {
    return true;
  }
  // TODO: Initialize WASI instance and bind MCP stdio.
  try {
    const session = await createWasmSession(handle.manifest);
    activeSessions.set(serverId, {
      transport: new McpStdioTransport(session.endpoint),
      close: session.close,
    });
    console.log('[Harbor] Starting WASM server (stub)', serverId);
    return true;
  } catch (error) {
    console.error('[Harbor] Failed to start WASM server', error);
    return false;
  }
}

export function stopWasmServer(serverId: string): boolean {
  if (!runningServers.has(serverId)) {
    return false;
  }
  // TODO: Tear down WASI instance and cleanup.
  const session = activeSessions.get(serverId);
  session?.close();
  activeSessions.delete(serverId);
  console.log('[Harbor] Stopping WASM server (stub)', serverId);
  return true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('MCP request timed out'));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function callMcpMethod(
  serverId: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<McpResponse> {
  const handle = runningServers.get(serverId);
  if (!handle) {
    return {
      jsonrpc: '2.0',
      id: 'missing',
      error: { code: -32000, message: 'Server not found' },
    };
  }
  const session = activeSessions.get(serverId);
  if (!session) {
    return {
      jsonrpc: '2.0',
      id: 'missing',
      error: { code: -32000, message: 'Server not started' },
    };
  }
  const requestId = crypto.randomUUID();
  const request = {
    jsonrpc: '2.0' as const,
    id: requestId,
    method,
    params,
  };
  try {
    return await withTimeout(session.transport.send(request), 10_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32001, message },
    };
  }
}

export async function callWasmTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const handle = runningServers.get(serverId);
  if (!handle) {
    return { ok: false, error: 'Server not found' };
  }
  const key = `${serverId}:${toolName}`;
  if (!toolIndex.has(key)) {
    return { ok: false, error: `Tool not found: ${toolName}` };
  }
  const session = activeSessions.get(serverId);
  if (!session) {
    return { ok: false, error: 'Server not started' };
  }

  const requestId = crypto.randomUUID();
  const params: ToolCallParams = { name: toolName, arguments: args };
  const request = {
    jsonrpc: '2.0' as const,
    id: requestId,
    method: 'tools/call',
    params,
  };

  try {
    const response = await withTimeout(
      session.transport.send(request),
      10_000,
    );
    if (response.error) {
      return { ok: false, error: response.error.message };
    }
    return {
      ok: true,
      result: response.result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
