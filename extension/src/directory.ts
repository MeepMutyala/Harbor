type WasmServerManifest = {
  id: string;
  name: string;
  version: string;
  entrypoint: string;
  moduleUrl?: string;
  permissions: string[];
  tools?: Array<{
    name: string;
    description?: string;
  }>;
};

const STORAGE_KEY = 'harbor_wasm_servers';

const list = document.getElementById('list') as HTMLDivElement;
const refresh = document.getElementById('refresh') as HTMLButtonElement;

function renderServer(server: WasmServerManifest): HTMLElement {
  const container = document.createElement('div');
  container.className = 'curated-server-item';

  const header = document.createElement('div');
  header.className = 'curated-server-header';

  const name = document.createElement('div');
  name.className = 'curated-server-name';
  name.textContent = server.name;

  const version = document.createElement('div');
  version.className = 'badge badge-default';
  version.textContent = server.version;

  header.appendChild(name);
  header.appendChild(version);

  const desc = document.createElement('div');
  desc.className = 'curated-server-desc';
  desc.textContent = server.entrypoint;

  const tools = document.createElement('div');
  tools.className = 'curated-server-hint';
  const toolNames = (server.tools || []).map((tool) => tool.name).join(', ');
  tools.textContent = toolNames.length > 0 ? `Tools: ${toolNames}` : 'No tools registered';

  container.appendChild(header);
  container.appendChild(desc);
  container.appendChild(tools);
  return container;
}

async function loadServers(): Promise<WasmServerManifest[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as WasmServerManifest[]) || [];
}

async function refreshList(): Promise<void> {
  list.innerHTML = '';
  const servers = await loadServers();
  if (servers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No servers installed yet.';
    list.appendChild(empty);
    return;
  }
  servers.forEach((server) => list.appendChild(renderServer(server)));
}

refresh.addEventListener('click', () => {
  refreshList().catch((error) => {
    console.error('Failed to refresh directory', error);
  });
});

refreshList().catch((error) => {
  console.error('Failed to load directory', error);
});
