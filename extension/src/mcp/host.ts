import {
  callMcpMethod,
  callWasmTool,
  getWasmServer,
  initializeWasmRuntime,
  listWasmServers,
  listRunningServerIds,
  registerWasmServer,
  startWasmServer,
  stopWasmServer,
  unregisterWasmServer,
} from '../wasm/runtime';
import {
  addInstalledServer,
  ensureBuiltinServers,
  removeInstalledServer,
  updateInstalledServer,
} from '../storage/servers';
import type { WasmServerManifest } from '../wasm/types';

export function initializeMcpHost(): void {
  console.log('[Harbor] MCP host starting...');
  initializeWasmRuntime();
  ensureBuiltinServers().then((servers) => {
    servers.forEach((server) => registerWasmServer(server));
    console.log('[Harbor] MCP host ready (stub).');
  });
}

export async function listRegisteredServers(): Promise<WasmServerManifest[]> {
  return listWasmServers().map((handle) => handle.manifest);
}

export async function listServersWithStatus(): Promise<Array<WasmServerManifest & { running: boolean }>> {
  const running = new Set(listRunningServerIds());
  return listWasmServers().map((handle) => ({
    ...handle.manifest,
    running: running.has(handle.id),
  }));
}

export async function addServer(manifest: WasmServerManifest): Promise<void> {
  registerWasmServer(manifest);
  await addInstalledServer(manifest);
}

export function startServer(serverId: string): Promise<boolean> {
  return startWasmServer(serverId);
}

export async function validateAndStartServer(serverId: string): Promise<{ ok: boolean; tools?: WasmServerManifest['tools']; error?: string }> {
  const started = await startWasmServer(serverId);
  if (!started) {
    return { ok: false, error: 'Failed to start server' };
  }
  const response = await callMcpMethod(serverId, 'tools/list');
  if (response.error) {
    return { ok: false, error: response.error.message };
  }
  const tools = (response.result as { tools?: WasmServerManifest['tools'] })?.tools || [];
  const handle = getWasmServer(serverId);
  if (handle) {
    const updated: WasmServerManifest = {
      ...handle.manifest,
      tools,
    };
    registerWasmServer(updated);
    await updateInstalledServer(updated);
  }
  return { ok: true, tools };
}

export function stopServer(serverId: string): boolean {
  return stopWasmServer(serverId);
}

export async function removeServer(serverId: string): Promise<void> {
  unregisterWasmServer(serverId);
  await removeInstalledServer(serverId);
}

export async function listTools(serverId: string): Promise<WasmServerManifest['tools']> {
  const handle = getWasmServer(serverId);
  return handle?.manifest.tools || [];
}

export function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const finalArgs = { ...args };
  if (serverId === 'time-wasm' && toolName === 'time.now' && !finalArgs.now) {
    finalArgs.now = new Date().toISOString();
  }
  return callWasmTool(serverId, toolName, finalArgs);
}
