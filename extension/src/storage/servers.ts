import type { WasmServerManifest } from '../wasm/types';

const STORAGE_KEY = 'harbor_wasm_servers';

export async function loadInstalledServers(): Promise<WasmServerManifest[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const servers = (result[STORAGE_KEY] as WasmServerManifest[]) || [];
  console.log('[Harbor] Loaded servers:', servers.length);
  return servers;
}

export async function saveInstalledServers(servers: WasmServerManifest[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: servers });
}

export async function addInstalledServer(server: WasmServerManifest): Promise<void> {
  const existing = await loadInstalledServers();
  const next = existing.filter((item) => item.id !== server.id);
  next.push(server);
  await saveInstalledServers(next);
}

export async function updateInstalledServer(server: WasmServerManifest): Promise<void> {
  await addInstalledServer(server);
}

export async function removeInstalledServer(serverId: string): Promise<void> {
  const existing = await loadInstalledServers();
  const next = existing.filter((item) => item.id !== serverId);
  await saveInstalledServers(next);
}

export async function ensureBuiltinServers(): Promise<WasmServerManifest[]> {
  const existing = await loadInstalledServers();
  const hasTime = existing.some((server) => server.id === 'time-wasm');
  if (hasTime) {
    return existing;
  }
  const manifest: WasmServerManifest = {
    id: 'time-wasm',
    name: 'Time Server',
    version: '0.1.0',
    entrypoint: 'mcp-time.wasm',
    moduleUrl: chrome.runtime.getURL('assets/mcp-time.wasm'),
    permissions: [],
    tools: [
      {
        name: 'time.now',
        description: 'Get current time from host',
        inputSchema: {
          type: 'object',
          properties: {
            now: { type: 'string' },
          },
          required: ['now'],
        },
      },
    ],
  };
  const next = [...existing, manifest];
  await saveInstalledServers(next);
  return next;
}
