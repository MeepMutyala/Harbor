import browser from 'webextension-polyfill';

interface MCPServer {
  server_id: string;
  label: string;
  base_url: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error_message?: string | null;
}

interface BridgeResponse {
  type: string;
  request_id: string;
  [key: string]: unknown;
}

interface ConnectionState {
  connected: boolean;
  lastMessage: BridgeResponse | null;
  error: string | null;
}

// Installed server types
interface InstalledServer {
  id: string;
  name: string;
  packageType: string;
  packageId: string;
  description?: string;
  requiredEnvVars: Array<{
    name: string;
    description?: string;
    isSecret?: boolean;
  }>;
}

interface InstalledServerStatus {
  installed: boolean;
  server?: InstalledServer;
  process?: {
    state: string;
    pid?: number;
  };
  missingSecrets?: string[];
  canStart?: boolean;
}

interface CredentialInfo {
  key: string;
  type: string;
  setAt: number;
  hasUsername?: boolean;
  isExpired?: boolean;
}

// LLM types
interface LLMModel {
  id: string;
  name: string;
  size: number;
  sizeHuman: string;
  description: string;
  supportsTools: boolean;
  recommended?: boolean;
}

interface OllamaInfo {
  version: string | null;
  supportsTools: boolean;
  minimumToolVersion: string;
  recommendedVersion: string;
  warning?: string;
}

interface LLMSetupStatus {
  available: boolean;
  runningProvider: 'llamafile' | 'ollama' | 'external' | null;
  runningUrl: string | null;
  downloadedModels: string[];
  activeModel: string | null;
  availableModels: LLMModel[];
  ollamaInfo?: OllamaInfo;
}

// Theme handling
function initTheme(): void {
  const savedTheme = localStorage.getItem('harbor-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function toggleTheme(): void {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('harbor-theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme: string): void {
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.textContent = theme === 'dark' ? '○' : '●';
  }
}

// Initialize theme immediately
initTheme();

// Catalog status types
interface CatalogStatus {
  serverCount: number;
  lastUpdated: number | null;
  isLoading: boolean;
  error: string | null;
  providerStatus: Array<{
    id: string;
    ok: boolean;
    count?: number;
  }>;
}

// Catalog state
let catalogStatus: CatalogStatus = {
  serverCount: 0,
  lastUpdated: null,
  isLoading: false,
  error: null,
  providerStatus: [],
};
let catalogActivity: Array<{ time: number; msg: string }> = [];
let autoSyncEnabled = true;

// DOM Elements
const statusIndicator = document.getElementById('status-indicator') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const errorContainer = document.getElementById('error-container') as HTMLDivElement;
const sendHelloBtn = document.getElementById('send-hello') as HTMLButtonElement;
const reconnectBtn = document.getElementById('reconnect') as HTMLButtonElement;
const serverLabelInput = document.getElementById('server-label') as HTMLInputElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const addServerBtn = document.getElementById('add-server') as HTMLButtonElement;
const serverListEl = document.getElementById('server-list') as HTMLDivElement;
const toolsCard = document.getElementById('tools-card') as HTMLDivElement;
const toolsResponse = document.getElementById('tools-response') as HTMLPreElement;
const openDirectoryBtn = document.getElementById('open-directory') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;

// Installed servers elements
const installedServerListEl = document.getElementById('installed-server-list') as HTMLDivElement;
const credentialModal = document.getElementById('credential-modal') as HTMLDivElement;
const credentialModalTitle = document.getElementById('credential-modal-title') as HTMLHeadingElement;
const credentialModalBody = document.getElementById('credential-modal-body') as HTMLDivElement;
const credentialModalClose = document.getElementById('credential-modal-close') as HTMLButtonElement;
const credentialModalCancel = document.getElementById('credential-modal-cancel') as HTMLButtonElement;
const credentialModalSave = document.getElementById('credential-modal-save') as HTMLButtonElement;

// LLM elements
const llmStatusIndicator = document.getElementById('llm-status-indicator') as HTMLDivElement;
const llmStatusText = document.getElementById('llm-status-text') as HTMLSpanElement;
const llmDetails = document.getElementById('llm-details') as HTMLDivElement;
const llmDownloadSection = document.getElementById('llm-download-section') as HTMLDivElement;
const llmModelDropdown = document.getElementById('llm-model-dropdown') as HTMLSelectElement;
const llmDownloadBtn = document.getElementById('llm-download-btn') as HTMLButtonElement;
const llmProgressSection = document.getElementById('llm-progress-section') as HTMLDivElement;
const llmDownloadModelName = document.getElementById('llm-download-model-name') as HTMLSpanElement;
const llmProgressBar = document.getElementById('llm-progress-bar') as HTMLDivElement;
const llmProgressText = document.getElementById('llm-progress-text') as HTMLDivElement;
const llmControlSection = document.getElementById('llm-control-section') as HTMLDivElement;
const llmStartBtn = document.getElementById('llm-start-btn') as HTMLButtonElement;
const llmStopBtn = document.getElementById('llm-stop-btn') as HTMLButtonElement;

// Catalog elements
const catalogStatusText = document.getElementById('catalog-status-text') as HTMLSpanElement;
const catalogServerCount = document.getElementById('catalog-server-count') as HTMLSpanElement;
const catalogLastUpdated = document.getElementById('catalog-last-updated') as HTMLSpanElement;
const catalogActivityEl = document.getElementById('catalog-activity') as HTMLDivElement;
const refreshCatalogBtn = document.getElementById('refresh-catalog-btn') as HTMLButtonElement;
const autoSyncToggle = document.getElementById('auto-sync-toggle') as HTMLInputElement;

let servers: MCPServer[] = [];
let selectedServerId: string | null = null;
let installedServers: InstalledServerStatus[] = [];
let currentCredentialServerId: string | null = null;

function formatJson(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  return json
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]+)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="json-value">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="json-value">$1</span>');
}

function updateConnectionUI(state: ConnectionState): void {
  if (state.connected) {
    statusIndicator.className = 'status-indicator connected';
    statusText.className = 'status-text connected';
    statusText.textContent = 'Connected';
  } else {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.className = 'status-text disconnected';
    statusText.textContent = 'Disconnected';
  }

  if (state.error) {
    errorContainer.style.display = 'block';
    errorContainer.textContent = state.error;
  } else {
    errorContainer.style.display = 'none';
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    default:
      return 'disconnected';
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderServerList(): void {
  if (servers.length === 0) {
    serverListEl.innerHTML = '<div class="empty-state">No servers configured</div>';
    return;
  }

  serverListEl.innerHTML = servers
    .map(
      (server) => `
    <div class="server-item" data-server-id="${server.server_id}">
      <div class="server-header">
        <span class="server-label">${escapeHtml(server.label)}</span>
        <div class="server-status">
          <div class="status-indicator ${getStatusClass(server.status)}"></div>
          <span class="status-text ${getStatusClass(server.status)}">${getStatusText(server.status)}</span>
        </div>
      </div>
      <div class="server-url">${escapeHtml(server.base_url)}</div>
      ${server.error_message ? `<div class="error-message">${escapeHtml(server.error_message)}</div>` : ''}
      <div class="server-actions">
        ${
          server.status === 'connected'
            ? `
          <button class="btn btn-sm btn-danger disconnect-btn" data-server-id="${server.server_id}">Disconnect</button>
          <button class="btn btn-sm btn-secondary list-tools-btn" data-server-id="${server.server_id}">Tools</button>
        `
            : `
          <button class="btn btn-sm btn-success connect-btn" data-server-id="${server.server_id}" ${server.status === 'connecting' ? 'disabled' : ''}>
            ${server.status === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        `
        }
        <button class="btn btn-sm btn-danger remove-btn" data-server-id="${server.server_id}">Remove</button>
      </div>
    </div>
  `
    )
    .join('');

  // Add event listeners
  serverListEl.querySelectorAll('.connect-btn').forEach((btn) => {
    btn.addEventListener('click', () => connectServer((btn as HTMLElement).dataset.serverId!));
  });

  serverListEl.querySelectorAll('.disconnect-btn').forEach((btn) => {
    btn.addEventListener('click', () => disconnectServer((btn as HTMLElement).dataset.serverId!));
  });

  serverListEl.querySelectorAll('.list-tools-btn').forEach((btn) => {
    btn.addEventListener('click', () => listTools((btn as HTMLElement).dataset.serverId!));
  });

  serverListEl.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removeServer((btn as HTMLElement).dataset.serverId!));
  });
}

async function loadServers(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'list_servers',
    })) as { type: string; servers?: MCPServer[] };

    if (response.type === 'list_servers_result' && response.servers) {
      servers = response.servers;
      renderServerList();
    }
  } catch (err) {
    console.error('Failed to load servers:', err);
  }
}

async function addServer(): Promise<void> {
  const label = serverLabelInput.value.trim();
  const baseUrl = serverUrlInput.value.trim();

  if (!label || !baseUrl) {
    alert('Please enter both label and URL');
    return;
  }

  try {
    addServerBtn.disabled = true;
    const response = (await browser.runtime.sendMessage({
      type: 'add_server',
      label,
      base_url: baseUrl,
    })) as { type: string; server?: MCPServer };

    if (response.type === 'add_server_result' && response.server) {
      serverLabelInput.value = '';
      serverUrlInput.value = '';
      await loadServers();
    } else if (response.type === 'error') {
      const error = response as unknown as { error: { message: string } };
      alert(`Failed to add server: ${error.error.message}`);
    }
  } catch (err) {
    console.error('Failed to add server:', err);
    alert('Failed to add server');
  } finally {
    addServerBtn.disabled = false;
  }
}

async function removeServer(serverId: string): Promise<void> {
  if (!confirm('Remove this server?')) {
    return;
  }

  try {
    await browser.runtime.sendMessage({
      type: 'remove_server',
      server_id: serverId,
    });
    await loadServers();
  } catch (err) {
    console.error('Failed to remove server:', err);
  }
}

async function connectServer(serverId: string): Promise<void> {
  try {
    // Optimistically update UI
    const server = servers.find((s) => s.server_id === serverId);
    if (server) {
      server.status = 'connecting';
      renderServerList();
    }

    const response = (await browser.runtime.sendMessage({
      type: 'connect_server',
      server_id: serverId,
    })) as { type: string };

    await loadServers();

    if (response.type === 'error') {
      const error = response as unknown as { error: { message: string } };
      alert(`Connection failed: ${error.error.message}`);
    }
  } catch (err) {
    console.error('Failed to connect:', err);
    await loadServers();
  }
}

async function disconnectServer(serverId: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'disconnect_server',
      server_id: serverId,
    });
    await loadServers();
  } catch (err) {
    console.error('Failed to disconnect:', err);
  }
}

async function listTools(serverId: string): Promise<void> {
  try {
    selectedServerId = serverId;
    const response = await browser.runtime.sendMessage({
      type: 'list_tools',
      server_id: serverId,
    });

    toolsCard.style.display = 'block';
    toolsResponse.innerHTML = formatJson(response);
  } catch (err) {
    console.error('Failed to list tools:', err);
    toolsCard.style.display = 'block';
    toolsResponse.textContent = `Error: ${err}`;
  }
}

// =============================================================================
// Installed Servers Management
// =============================================================================

async function loadInstalledServers(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'list_installed',
    }) as { type: string; servers?: InstalledServerStatus[] };

    if (response.type === 'list_installed_result' && response.servers) {
      installedServers = response.servers;
      renderInstalledServers();
    }
  } catch (err) {
    console.error('Failed to load installed servers:', err);
  }
}

function getServerStatusInfo(status: InstalledServerStatus): { text: string; class: string } {
  if (!status.installed) {
    return { text: 'Not Installed', class: 'error' };
  }

  const processState = status.process?.state;
  
  if (processState === 'running') {
    return { text: 'Running', class: 'running' };
  }
  
  if (status.missingSecrets && status.missingSecrets.length > 0) {
    return { text: 'Needs Auth', class: 'needs-auth' };
  }
  
  if (processState === 'crashed' || processState === 'error') {
    return { text: 'Error', class: 'error' };
  }
  
  return { text: 'Stopped', class: 'stopped' };
}

function renderInstalledServers(): void {
  if (installedServers.length === 0) {
    installedServerListEl.innerHTML = `
      <div class="empty-state">
        No servers installed. 
        <a href="#" id="go-to-directory" style="color: var(--color-accent-primary);">Browse the directory</a> to find servers.
      </div>
    `;
    const goToDir = document.getElementById('go-to-directory');
    if (goToDir) {
      goToDir.addEventListener('click', (e) => {
        e.preventDefault();
        openDirectoryBtn.click();
      });
    }
    return;
  }

  console.log('[Sidebar] Rendering installed servers:', installedServers.length);
  
  // Count running servers
  const runningCount = installedServers.filter(s => s.process?.state === 'running').length;
  
  // Build running summary if any servers are running
  let summaryHtml = '';
  if (runningCount > 0) {
    summaryHtml = `
      <div class="running-servers-summary">
        <span class="dot"></span>
        <span>${runningCount} server${runningCount > 1 ? 's' : ''} running</span>
      </div>
    `;
  }
  
  // Sort: running first, then needs-auth, then stopped
  const sortedServers = [...installedServers]
    .filter(status => status.installed && status.server)
    .sort((a, b) => {
      const aRunning = a.process?.state === 'running' ? 0 : 1;
      const bRunning = b.process?.state === 'running' ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      
      const aNeedsAuth = (a.missingSecrets?.length || 0) > 0 ? 0 : 1;
      const bNeedsAuth = (b.missingSecrets?.length || 0) > 0 ? 0 : 1;
      return aNeedsAuth - bNeedsAuth;
    });
  
  const serversHtml = sortedServers
    .map(status => {
      const server = status.server!;
      const statusInfo = getServerStatusInfo(status);
      const isRunning = status.process?.state === 'running';
      const needsAuth = status.missingSecrets && status.missingSecrets.length > 0;
      
      // Determine the card class for left border
      let cardClass = 'installed-server-item';
      if (isRunning) cardClass += ' running';
      else if (needsAuth) cardClass += ' needs-auth';
      else if (status.process?.state === 'error' || status.process?.state === 'crashed') cardClass += ' error';
      
      console.log('[Sidebar] Server:', server.id, 'isRunning:', isRunning, 'needsAuth:', needsAuth, 'process:', status.process);

      return `
        <div class="${cardClass}" data-server-id="${escapeHtml(server.id)}">
          <div class="server-header">
            <span class="server-label">${escapeHtml(server.name)}</span>
            <span class="server-status-badge ${statusInfo.class}">${statusInfo.text}</span>
          </div>
          ${server.description ? `<div class="text-xs text-muted mt-1">${escapeHtml(server.description)}</div>` : ''}
          <div class="server-package-info">${escapeHtml(server.packageType)}:${escapeHtml(server.packageId)}</div>
          ${needsAuth ? `
            <div class="error-message mb-2">
              Missing: ${status.missingSecrets!.join(', ')}
            </div>
          ` : ''}
          <div class="server-actions">
            ${needsAuth ? `
              <button class="btn btn-sm btn-primary configure-btn" data-server-id="${escapeHtml(server.id)}">Configure</button>
            ` : ''}
            ${!needsAuth && !isRunning ? `
              <button class="btn btn-sm btn-success start-btn" data-server-id="${escapeHtml(server.id)}">Start</button>
            ` : ''}
            ${isRunning ? `
              <button class="btn btn-sm btn-danger stop-btn" data-server-id="${escapeHtml(server.id)}">Stop</button>
              <button class="btn btn-sm btn-secondary mcp-tools-btn" data-server-id="${escapeHtml(server.id)}">Tools</button>
            ` : ''}
            <button class="btn btn-sm btn-ghost configure-btn" data-server-id="${escapeHtml(server.id)}" ${needsAuth ? 'style="display:none;"' : ''}>⚙</button>
            <button class="btn btn-sm btn-danger uninstall-btn" data-server-id="${escapeHtml(server.id)}">✕</button>
          </div>
        </div>
      `;
    })
    .join('');
  
  installedServerListEl.innerHTML = summaryHtml + serversHtml;

  // Add event listeners
  installedServerListEl.querySelectorAll('.configure-btn').forEach(btn => {
    btn.addEventListener('click', () => openCredentialModal((btn as HTMLElement).dataset.serverId!));
  });

  installedServerListEl.querySelectorAll('.start-btn').forEach(btn => {
    console.log('[Sidebar] Adding click listener to start button for:', (btn as HTMLElement).dataset.serverId);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const serverId = (btn as HTMLElement).dataset.serverId!;
      console.log('[Sidebar] Start button clicked for:', serverId);
      startInstalledServer(serverId);
    });
  });

  installedServerListEl.querySelectorAll('.stop-btn').forEach(btn => {
    btn.addEventListener('click', () => stopInstalledServer((btn as HTMLElement).dataset.serverId!));
  });

  installedServerListEl.querySelectorAll('.mcp-tools-btn').forEach(btn => {
    btn.addEventListener('click', () => listMcpTools((btn as HTMLElement).dataset.serverId!));
  });

  installedServerListEl.querySelectorAll('.uninstall-btn').forEach(btn => {
    btn.addEventListener('click', () => uninstallServer((btn as HTMLElement).dataset.serverId!));
  });
}

async function openCredentialModal(serverId: string): Promise<void> {
  currentCredentialServerId = serverId;
  
  // Find the server
  const serverStatus = installedServers.find(s => s.server?.id === serverId);
  if (!serverStatus?.server) {
    console.error('Server not found:', serverId);
    return;
  }
  
  const server = serverStatus.server;
  credentialModalTitle.textContent = `Configure ${server.name}`;

  // Get current credential status
  let credentialList: CredentialInfo[] = [];
  try {
    const response = await browser.runtime.sendMessage({
      type: 'list_credentials',
      server_id: serverId,
    }) as { type: string; credentials?: CredentialInfo[] };
    
    if (response.type === 'list_credentials_result' && response.credentials) {
      credentialList = response.credentials;
    }
  } catch (err) {
    console.error('Failed to get credentials:', err);
  }

  // Get required env vars
  const requiredVars = server.requiredEnvVars || [];
  const secretVars = requiredVars.filter(v => v.isSecret);

  if (secretVars.length === 0) {
    credentialModalBody.innerHTML = `
      <div class="empty-state">
        This server doesn't require any credentials.
      </div>
    `;
  } else {
    credentialModalBody.innerHTML = secretVars.map(envVar => {
      const isSet = credentialList.some(c => c.key === envVar.name);
      
      return `
        <div class="credential-field">
          <div class="credential-label">
            <span class="credential-label-text">${escapeHtml(envVar.name)}</span>
            <span class="credential-required">*</span>
          </div>
          ${envVar.description ? `<div class="credential-description">${escapeHtml(envVar.description)}</div>` : ''}
          <div class="password-input-wrapper">
            <input 
              type="password" 
              class="credential-input ${isSet ? 'is-set' : ''}" 
              data-key="${escapeHtml(envVar.name)}"
              placeholder="${isSet ? '••••••••' : 'Enter value...'}"
            >
            <button class="password-toggle" type="button" data-showing="false">◉</button>
          </div>
          <div class="credential-status ${isSet ? 'set' : 'missing'}">
            ${isSet ? '✓ Set' : '! Missing'}
          </div>
        </div>
      `;
    }).join('');

    // Add password toggle functionality
    credentialModalBody.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrapper = btn.parentElement!;
        const input = wrapper.querySelector('input') as HTMLInputElement;
        const showing = btn.getAttribute('data-showing') === 'true';
        
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? '◉' : '○';
        btn.setAttribute('data-showing', (!showing).toString());
      });
    });
  }

  credentialModal.style.display = 'flex';
}

function closeCredentialModal(): void {
  credentialModal.style.display = 'none';
  currentCredentialServerId = null;
}

async function saveCredentials(): Promise<void> {
  if (!currentCredentialServerId) return;

  const inputs = credentialModalBody.querySelectorAll('.credential-input') as NodeListOf<HTMLInputElement>;
  let hasErrors = false;

  for (const input of inputs) {
    const key = input.dataset.key!;
    const value = input.value.trim();
    
    // Only save if a value was entered (don't overwrite with empty)
    if (value) {
      try {
        await browser.runtime.sendMessage({
          type: 'set_credential',
          server_id: currentCredentialServerId,
          key,
          value,
          credential_type: 'api_key',
        });
      } catch (err) {
        console.error('Failed to save credential:', err);
        hasErrors = true;
      }
    }
  }

  if (!hasErrors) {
    closeCredentialModal();
    await loadInstalledServers();
  }
}

async function startInstalledServer(serverId: string): Promise<void> {
  console.log('[Sidebar] Starting server:', serverId);
  
  try {
    // Use mcp_connect to start and connect via stdio
    const response = await browser.runtime.sendMessage({
      type: 'mcp_connect',
      server_id: serverId,
    }) as { type: string; connected?: boolean; error?: { message: string } };

    console.log('[Sidebar] Start response:', response);

    if (response.type === 'mcp_connect_result' && response.connected) {
      console.log('[Sidebar] Server started and connected:', serverId);
    } else if (response.type === 'error') {
      const error = response as unknown as { error: { message: string } };
      console.error('[Sidebar] Start error:', error);
      alert(`Failed to start: ${error.error.message}`);
    } else {
      console.warn('[Sidebar] Unexpected response:', response);
    }
    
    await loadInstalledServers();
  } catch (err) {
    console.error('[Sidebar] Failed to start server:', err);
    alert(`Failed to start server: ${err}`);
  }
}

async function stopInstalledServer(serverId: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'mcp_disconnect',
      server_id: serverId,
    });
    
    await loadInstalledServers();
  } catch (err) {
    console.error('Failed to stop server:', err);
  }
}

async function listMcpTools(serverId: string): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'mcp_list_tools',
      server_id: serverId,
    });

    toolsCard.style.display = 'block';
    toolsResponse.innerHTML = formatJson(response);
  } catch (err) {
    console.error('Failed to list MCP tools:', err);
    toolsCard.style.display = 'block';
    toolsResponse.textContent = `Error: ${err}`;
  }
}

async function uninstallServer(serverId: string): Promise<void> {
  if (!confirm('Uninstall this server? This will also remove its credentials.')) {
    return;
  }

  try {
    // Stop if running
    await browser.runtime.sendMessage({
      type: 'mcp_disconnect',
      server_id: serverId,
    });

    // Uninstall
    await browser.runtime.sendMessage({
      type: 'uninstall_server',
      server_id: serverId,
    });

    await loadInstalledServers();
  } catch (err) {
    console.error('Failed to uninstall server:', err);
  }
}

// =============================================================================
// LLM Setup Management
// =============================================================================

let llmStatus: LLMSetupStatus | null = null;
let isDownloading = false;

async function checkLLMStatus(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'llm_setup_status',
    }) as { type: string; status?: LLMSetupStatus };

    if (response.type === 'llm_setup_status_result' && response.status) {
      llmStatus = response.status;
      renderLLMStatus();
    }
  } catch (err) {
    console.error('Failed to check LLM status:', err);
    llmStatusText.textContent = 'Error checking LLM';
  }
}

function renderLLMStatus(): void {
  if (!llmStatus) return;

  if (llmStatus.available) {
    // LLM is running
    llmStatusIndicator.className = 'status-indicator connected';
    llmStatusText.className = 'status-text connected';
    llmStatusText.textContent = 'Available';
    
    const provider = llmStatus.runningProvider || 'Unknown';
    const providerName = provider === 'llamafile' ? 'Llamafile' : 
                         provider === 'ollama' ? 'Ollama' : 'External';
    
    // Build details HTML
    let detailsHtml = `<strong>${providerName}</strong>`;
    
    // Add Ollama-specific version info
    if (provider === 'ollama' && llmStatus.ollamaInfo) {
      const ollama = llmStatus.ollamaInfo;
      if (ollama.version) {
        detailsHtml += ` <span class="text-muted">v${ollama.version}</span>`;
      }
      
      // Tool support badge
      if (ollama.supportsTools) {
        detailsHtml += ` <span class="badge badge-success">Tools ✓</span>`;
      } else {
        detailsHtml += ` <span class="badge badge-warning">No Tools</span>`;
      }
    }
    
    detailsHtml += `<br><span class="text-xs text-muted mono">${llmStatus.runningUrl}</span>`;
    
    if (llmStatus.activeModel) {
      detailsHtml += `<br><span class="text-xs">Model: ${llmStatus.activeModel}</span>`;
    }
    
    // Add Ollama warning if present
    if (llmStatus.ollamaInfo?.warning) {
      detailsHtml += `<div class="error-message mt-2" style="background: var(--color-warning-subtle); color: var(--color-warning);">
        ${llmStatus.ollamaInfo.warning}
      </div>`;
    }
    
    llmDetails.innerHTML = detailsHtml;
    
    // Hide download section, show controls if we started it
    llmDownloadSection.style.display = 'none';
    llmProgressSection.style.display = 'none';
    
    if (llmStatus.activeModel) {
      // We started this LLM, show stop button
      llmControlSection.style.display = 'block';
      llmStartBtn.style.display = 'none';
      llmStopBtn.style.display = 'flex';
    } else {
      llmControlSection.style.display = 'none';
    }
    
  } else {
    // No LLM running
    llmStatusIndicator.className = 'status-indicator disconnected';
    llmStatusText.className = 'status-text disconnected';
    llmStatusText.textContent = 'Not Available';
    llmDetails.textContent = '';
    
    // Check if we have downloaded models
    if (llmStatus.downloadedModels.length > 0) {
      llmDownloadSection.style.display = 'none';
      llmControlSection.style.display = 'block';
      llmStartBtn.style.display = 'flex';
      llmStopBtn.style.display = 'none';
      llmDetails.textContent = `Downloaded: ${llmStatus.downloadedModels.join(', ')}`;
    } else {
      // Show download section
      llmDownloadSection.style.display = 'block';
      llmControlSection.style.display = 'none';
    }
  }
}

async function downloadLLMModel(): Promise<void> {
  if (isDownloading) return;
  
  const modelId = llmModelDropdown.value;
  const modelOption = llmModelDropdown.options[llmModelDropdown.selectedIndex];
  
  isDownloading = true;
  llmDownloadBtn.disabled = true;
  llmDownloadSection.style.display = 'none';
  llmProgressSection.style.display = 'block';
  llmDownloadModelName.textContent = modelOption.textContent || modelId;
  llmProgressBar.style.width = '0%';
  llmProgressText.textContent = 'Starting download...';
  
  try {
    // This is a long-running request - the bridge will stream progress
    // For now, we just wait for completion
    const response = await browser.runtime.sendMessage({
      type: 'llm_download_model',
      model_id: modelId,
    }) as { type: string; success?: boolean; status?: LLMSetupStatus };
    
    if (response.type === 'llm_download_model_result' && response.success) {
      llmProgressBar.style.width = '100%';
      llmProgressText.textContent = 'Download complete!';
      
      if (response.status) {
        llmStatus = response.status;
      }
      
      // Wait a moment then refresh
      setTimeout(() => {
        llmProgressSection.style.display = 'none';
        renderLLMStatus();
      }, 1500);
      
    } else if (response.type === 'error') {
      const error = response as unknown as { error: { message: string } };
      llmProgressText.textContent = `Error: ${error.error.message}`;
      llmProgressBar.style.background = 'var(--accent-danger)';
      
      setTimeout(() => {
        llmProgressSection.style.display = 'none';
        llmDownloadSection.style.display = 'block';
      }, 3000);
    }
    
  } catch (err) {
    console.error('Download failed:', err);
    llmProgressText.textContent = `Error: ${err}`;
    
    setTimeout(() => {
      llmProgressSection.style.display = 'none';
      llmDownloadSection.style.display = 'block';
    }, 3000);
    
  } finally {
    isDownloading = false;
    llmDownloadBtn.disabled = false;
  }
}

async function startLocalLLM(): Promise<void> {
  if (!llmStatus?.downloadedModels.length) return;
  
  const modelId = llmStatus.downloadedModels[0]; // Use first downloaded
  llmStartBtn.disabled = true;
  llmStartBtn.textContent = 'Starting...';
  
  try {
    const response = await browser.runtime.sendMessage({
      type: 'llm_start_local',
      model_id: modelId,
    }) as { type: string; success?: boolean; url?: string };
    
    if (response.type === 'llm_start_local_result' && response.success) {
      // Also trigger LLM detection so the LLM manager knows about it
      await browser.runtime.sendMessage({ type: 'llm_detect' });
      await checkLLMStatus();
    } else if (response.type === 'error') {
      const error = response as unknown as { error: { message: string } };
      alert(`Failed to start LLM: ${error.error.message}`);
    }
    
  } catch (err) {
    console.error('Failed to start LLM:', err);
    alert(`Failed to start LLM: ${err}`);
  } finally {
    llmStartBtn.disabled = false;
    llmStartBtn.textContent = '▶️ Start';
  }
}

async function stopLocalLLM(): Promise<void> {
  llmStopBtn.disabled = true;
  llmStopBtn.textContent = 'Stopping...';
  
  try {
    await browser.runtime.sendMessage({
      type: 'llm_stop_local',
    });
    
    await checkLLMStatus();
    
  } catch (err) {
    console.error('Failed to stop LLM:', err);
  } finally {
    llmStopBtn.disabled = false;
    llmStopBtn.textContent = '⏹️ Stop';
  }
}

// Listen for state updates from background
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; state?: ConnectionState; response?: BridgeResponse };

  if (msg.type === 'state_update' && msg.state) {
    updateConnectionUI(msg.state);
  }
});

// Initialize
// =============================================================================
// Catalog Status Functions
// =============================================================================

function addCatalogActivity(msg: string, highlight = true): void {
  catalogActivity.push({ time: Date.now(), msg });
  if (catalogActivity.length > 10) {
    catalogActivity.shift(); // Remove oldest from beginning
  }
  renderCatalogActivity(highlight);
  
  // Flash the live indicator
  const liveDot = document.querySelector('.live-dot') as HTMLElement;
  if (liveDot) {
    liveDot.style.background = 'var(--color-accent-primary)';
    setTimeout(() => {
      liveDot.style.background = 'var(--color-success)';
    }, 200);
  }
}

function formatTimeWithMs(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  const secs = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${mins}:${secs}.${ms}`;
}

function renderCatalogActivity(highlightLast = false): void {
  if (!catalogActivityEl) return;
  
  if (catalogActivity.length === 0) {
    catalogActivityEl.innerHTML = '<div class="catalog-activity-item" style="color: var(--color-text-muted);">No recent activity</div>';
    return;
  }
  
  // Show newest at bottom (don't reverse)
  const items = catalogActivity.slice(-10);
  const lastIndex = items.length - 1;
  
  catalogActivityEl.innerHTML = items.map((item, index) => {
    const time = formatTimeWithMs(item.time);
    const isNew = highlightLast && index === lastIndex;
    return `
      <div class="catalog-activity-item${isNew ? ' new' : ''}">
        <span class="catalog-activity-time">${time}</span>
        <span class="catalog-activity-msg">${escapeHtml(item.msg)}</span>
      </div>
    `;
  }).join('');
  
  // Auto-scroll to bottom
  catalogActivityEl.scrollTop = catalogActivityEl.scrollHeight;
  
  // Remove "new" class after animation
  if (highlightLast) {
    setTimeout(() => {
      const newItem = catalogActivityEl.querySelector('.catalog-activity-item.new');
      newItem?.classList.remove('new');
    }, 1000);
  }
}

function updateCatalogStatusUI(): void {
  if (!catalogStatusText || !catalogServerCount || !catalogLastUpdated) return;
  
  // Status
  if (catalogStatus.isLoading) {
    catalogStatusText.textContent = 'Syncing...';
    catalogStatusText.className = 'catalog-status-value loading';
  } else if (catalogStatus.error) {
    catalogStatusText.textContent = 'Error';
    catalogStatusText.className = 'catalog-status-value error';
  } else if (catalogStatus.serverCount > 0) {
    catalogStatusText.textContent = 'Ready';
    catalogStatusText.className = 'catalog-status-value success';
  } else {
    catalogStatusText.textContent = 'No data';
    catalogStatusText.className = 'catalog-status-value';
  }
  
  // Server count
  catalogServerCount.textContent = catalogStatus.serverCount > 0 
    ? String(catalogStatus.serverCount) 
    : '—';
  
  // Last updated
  if (catalogStatus.lastUpdated) {
    const ago = Math.floor((Date.now() - catalogStatus.lastUpdated) / 1000 / 60);
    if (ago < 1) {
      catalogLastUpdated.textContent = 'Just now';
    } else if (ago < 60) {
      catalogLastUpdated.textContent = `${ago}m ago`;
    } else {
      const hours = Math.floor(ago / 60);
      catalogLastUpdated.textContent = `${hours}h ago`;
    }
  } else {
    catalogLastUpdated.textContent = '—';
  }
}

async function loadCatalogStatus(): Promise<void> {
  catalogStatus.isLoading = true;
  updateCatalogStatusUI();
  // Don't add activity here - let the bridge status updates show progress
  
  try {
    const response = await browser.runtime.sendMessage({
      type: 'catalog_get',
    }) as { servers?: unknown[]; providerStatus?: unknown[]; fetchedAt?: number };
    
    if (response?.servers) {
      catalogStatus.serverCount = response.servers.length;
      catalogStatus.lastUpdated = response.fetchedAt || Date.now();
      catalogStatus.error = null;
      // Only show "Loaded" if we didn't get intermediate updates
      if (catalogActivity.length === 0 || !catalogActivity[0]?.msg.includes('servers')) {
        addCatalogActivity(`Loaded ${response.servers.length} servers`);
      }
    }
    
    if (response?.providerStatus) {
      catalogStatus.providerStatus = response.providerStatus as CatalogStatus['providerStatus'];
    }
  } catch (err) {
    console.error('[Sidebar] Failed to load catalog:', err);
    catalogStatus.error = String(err);
    addCatalogActivity(`Error: ${String(err).substring(0, 50)}`);
  } finally {
    catalogStatus.isLoading = false;
    updateCatalogStatusUI();
  }
}

async function refreshCatalog(): Promise<void> {
  if (catalogStatus.isLoading) return;
  
  catalogStatus.isLoading = true;
  updateCatalogStatusUI();
  addCatalogActivity('Requesting refresh...');
  
  try {
    const response = await browser.runtime.sendMessage({
      type: 'catalog_refresh',
    }) as { servers?: unknown[]; fetchedAt?: number };
    
    if (response?.servers) {
      catalogStatus.serverCount = response.servers.length;
      catalogStatus.lastUpdated = response.fetchedAt || Date.now();
      catalogStatus.error = null;
      // Bridge should have sent intermediate status updates
      // Only add this if we didn't see any updates
      if (!catalogActivity.some(a => a.msg.includes('servers') && Date.now() - a.time < 5000)) {
        addCatalogActivity(`Done: ${response.servers.length} servers`);
      }
    }
  } catch (err) {
    console.error('[Sidebar] Failed to refresh catalog:', err);
    catalogStatus.error = String(err);
    addCatalogActivity(`Refresh failed: ${String(err).substring(0, 40)}`);
  } finally {
    catalogStatus.isLoading = false;
    updateCatalogStatusUI();
  }
}

function initAutoSync(): void {
  // Load saved preference
  const saved = localStorage.getItem('harbor-auto-sync');
  autoSyncEnabled = saved !== 'false'; // Default true
  
  if (autoSyncToggle) {
    autoSyncToggle.checked = autoSyncEnabled;
    autoSyncToggle.addEventListener('change', () => {
      autoSyncEnabled = autoSyncToggle.checked;
      localStorage.setItem('harbor-auto-sync', String(autoSyncEnabled));
      addCatalogActivity(autoSyncEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled');
    });
  }
  
  // Update "last updated" timestamp every minute
  setInterval(() => {
    updateCatalogStatusUI();
  }, 60 * 1000);
  
  // Set up periodic refresh (every hour if auto-sync enabled)
  setInterval(() => {
    if (autoSyncEnabled && !catalogStatus.isLoading) {
      const hourAgo = Date.now() - (60 * 60 * 1000);
      if (!catalogStatus.lastUpdated || catalogStatus.lastUpdated < hourAgo) {
        addCatalogActivity('Auto-refreshing catalog...');
        refreshCatalog();
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

// =============================================================================
// Bridge Activity Panel
// =============================================================================

interface BridgeLogEntry {
  id: number;
  timestamp: number;
  direction: 'send' | 'recv';
  type: string;
  summary: string;
  data: unknown;
}

let bridgeLog: BridgeLogEntry[] = [];
let bridgeTab: 'activity' | 'json' = 'activity';
let selectedBridgeEntry: BridgeLogEntry | null = null;

const bridgeActivityPanel = document.getElementById('bridge-activity-panel') as HTMLDivElement;
const bridgeActivityHeader = document.getElementById('bridge-activity-header') as HTMLDivElement;
const bridgeActivityContent = document.getElementById('bridge-activity-content') as HTMLDivElement;
const bridgeActivityLog = document.getElementById('bridge-activity-log') as HTMLDivElement;
const bridgeJsonView = document.getElementById('bridge-json-view') as HTMLDivElement;
const bridgeJsonContent = document.getElementById('bridge-json-content') as HTMLPreElement;
const bridgeIndicator = document.getElementById('bridge-indicator') as HTMLSpanElement;
const bridgeCollapseIcon = document.getElementById('bridge-activity-collapse-icon') as HTMLSpanElement;
const copyBridgeJsonBtn = document.getElementById('copy-bridge-json-btn') as HTMLButtonElement;

function initBridgeActivityPanel(): void {
  // Toggle collapsed state
  bridgeActivityHeader?.addEventListener('click', () => {
    bridgeActivityContent.classList.toggle('collapsed');
    bridgeCollapseIcon.textContent = bridgeActivityContent.classList.contains('collapsed') ? '▶' : '▼';
  });
  
  // Tab switching
  document.querySelectorAll('.bridge-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabName = (tab as HTMLElement).dataset.tab as 'activity' | 'json';
      bridgeTab = tabName;
      
      document.querySelectorAll('.bridge-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tabName === 'activity') {
        bridgeActivityLog.style.display = 'block';
        bridgeJsonView.style.display = 'none';
      } else {
        bridgeActivityLog.style.display = 'none';
        bridgeJsonView.style.display = 'block';
      }
    });
  });
  
  // Copy JSON button
  copyBridgeJsonBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const content = bridgeJsonContent.textContent || '';
    if (content && content !== 'Select a message to view') {
      try {
        await navigator.clipboard.writeText(content);
        const originalText = copyBridgeJsonBtn.textContent;
        copyBridgeJsonBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBridgeJsonBtn.textContent = originalText;
        }, 1500);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  });
  
  // Load existing log
  loadBridgeLog();
}

async function loadBridgeLog(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'get_message_log' }) as { log: BridgeLogEntry[] };
    if (response?.log) {
      bridgeLog = response.log;
      renderBridgeLog();
    }
  } catch (e) {
    console.error('[Bridge Activity] Failed to load log:', e);
  }
}

function addBridgeEntry(entry: BridgeLogEntry): void {
  bridgeLog.push(entry);
  if (bridgeLog.length > 100) {
    bridgeLog.shift();
  }
  
  // Update indicator
  if (bridgeIndicator) {
    bridgeIndicator.classList.remove('idle', 'error');
    if (entry.type === 'error') {
      bridgeIndicator.classList.add('error');
    }
  }
  
  renderBridgeLog();
}

function renderBridgeLog(): void {
  if (!bridgeActivityLog) return;
  
  if (bridgeLog.length === 0) {
    bridgeActivityLog.innerHTML = '<div style="color: var(--color-text-muted); padding: var(--space-2);">No messages yet...</div>';
    return;
  }
  
  // Show newest at bottom (slice last 50)
  const entries = bridgeLog.slice(-50);
  
  bridgeActivityLog.innerHTML = entries.map(entry => {
    const time = formatTimeWithMs(entry.timestamp);
    const dirClass = entry.direction === 'send' ? 'send' : 'recv';
    const arrow = entry.direction === 'send' ? '→' : '←';
    
    return `
      <div class="bridge-entry" data-id="${entry.id}">
        <span class="bridge-time">${time}</span>
        <span class="bridge-dir ${dirClass}">${arrow}</span>
        <span class="bridge-type">${escapeHtml(entry.type)}</span>
        <span class="bridge-summary">${escapeHtml(entry.summary)}</span>
      </div>
    `;
  }).join('');
  
  // Auto-scroll to bottom
  bridgeActivityLog.scrollTop = bridgeActivityLog.scrollHeight;
  
  // Make entries clickable to show JSON
  bridgeActivityLog.querySelectorAll('.bridge-entry').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt((el as HTMLElement).dataset.id || '0');
      const entry = bridgeLog.find(e => e.id === id);
      if (entry) {
        selectedBridgeEntry = entry;
        try {
          bridgeJsonContent.textContent = JSON.stringify(entry.data, null, 2);
        } catch {
          bridgeJsonContent.textContent = 'Unable to display message data';
        }
        // Switch to JSON tab
        bridgeTab = 'json';
        document.querySelectorAll('.bridge-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.bridge-tab[data-tab="json"]')?.classList.add('active');
        bridgeActivityLog.style.display = 'none';
        bridgeJsonView.style.display = 'block';
      }
    });
  });
}

// Listen for bridge activity updates
browser.runtime.onMessage.addListener((message) => {
  // Handle log entries for bridge activity panel
  if (message.type === 'log_entry') {
    addBridgeEntry(message.entry);
  }
  
  // Handle real-time catalog status updates from bridge
  if (message.type === 'catalog_status') {
    const category = message.category as string || 'catalog';
    const status = message.status as string;
    const statusMessage = message.message as string || status;
    
    // Log ALL status updates so we can see what's coming through
    console.log('[Sidebar] Status update:', category, status, statusMessage);
    
    // Handle diagnostic pings
    if (category === 'diagnostic') {
      addCatalogActivity(`🔔 ${statusMessage}`);
      return;
    }
    
    // Update catalog loading state based on status
    switch (status) {
      case 'fetching':
      case 'enriching':
      case 'initializing':
      case 'provider_fetch':
      case 'saving':
      case 'enriching_progress':
        catalogStatus.isLoading = true;
        break;
      case 'ready':
      case 'fetched':
      case 'enrichment_done':
        catalogStatus.isLoading = false;
        if (message.serverCount) {
          catalogStatus.serverCount = message.serverCount as number;
          catalogStatus.lastUpdated = Date.now();
        }
        break;
      case 'provider_error':
      case 'enrichment_error':
        catalogStatus.error = statusMessage;
        break;
      case 'provider_done':
        // Provider completed - update count if provided
        if (message.count) {
          // Don't set final count yet, just show progress
        }
        break;
    }
    
    // Add to activity log
    addCatalogActivity(statusMessage);
    updateCatalogStatusUI();
    return;
  }
  
  if (message.type === 'log_entry') {
    const entry = message.entry;
    // Update catalog activity for catalog-related messages
    if (entry.type.startsWith('catalog_')) {
      addCatalogActivity(entry.summary.replace(/^[←→]\s*/, ''));
    }
  }
});

async function init(): Promise<void> {
  try {
    const state = (await browser.runtime.sendMessage({
      type: 'get_state',
    })) as ConnectionState;
    if (state) {
      updateConnectionUI(state);
    }
  } catch (err) {
    console.error('Failed to get initial state:', err);
  }

  await loadServers();
  await loadInstalledServers();
  await checkLLMStatus();
  
  // Initialize catalog
  initAutoSync();
  await loadCatalogStatus();
  
  // Initialize bridge activity panel
  initBridgeActivityPanel();
}

// Button handlers
sendHelloBtn.addEventListener('click', async () => {
  try {
    await browser.runtime.sendMessage({ type: 'send_hello' });
  } catch (err) {
    console.error('Failed to send hello:', err);
  }
});

// Catalog refresh button
refreshCatalogBtn?.addEventListener('click', () => {
  refreshCatalog();
});

// Ping bridge button - test full pipeline including push status updates
const pingBridgeBtn = document.getElementById('ping-bridge-btn');
pingBridgeBtn?.addEventListener('click', async () => {
  addCatalogActivity('Sending ping...');
  try {
    const response = await browser.runtime.sendMessage({
      type: 'send_ping',
      echo: `test-${Date.now()}`,
    }) as { echo?: string; timestamp?: number };
    
    if (response?.echo) {
      addCatalogActivity(`Pong: ${response.echo}`);
    } else {
      addCatalogActivity('Ping response received (no echo)');
    }
  } catch (err) {
    addCatalogActivity(`Ping failed: ${String(err).substring(0, 40)}`);
  }
});

reconnectBtn.addEventListener('click', async () => {
  try {
    await browser.runtime.sendMessage({ type: 'reconnect' });
  } catch (err) {
    console.error('Failed to reconnect:', err);
  }
});

addServerBtn.addEventListener('click', addServer);

// Allow Enter key to submit
serverUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addServer();
  }
});

// Open Directory button
openDirectoryBtn.addEventListener('click', () => {
  const directoryUrl = browser.runtime.getURL('directory.html');
  browser.tabs.create({ url: directoryUrl });
});

// Compare mode toggle in sidebar
const compareModeToggle = document.getElementById('compare-mode-toggle') as HTMLInputElement;

// Load saved compare mode state
browser.storage.local.get('compareMode').then((result) => {
  if (compareModeToggle && result.compareMode) {
    compareModeToggle.checked = true;
  }
});

// Save compare mode state when toggled
compareModeToggle?.addEventListener('change', () => {
  browser.storage.local.set({ compareMode: compareModeToggle.checked });
  // Broadcast to any open chat pages
  browser.runtime.sendMessage({
    type: 'compare_mode_changed',
    enabled: compareModeToggle.checked,
  }).catch(() => {});
});

// Tool Router toggle in sidebar
const toolRouterToggle = document.getElementById('tool-router-toggle') as HTMLInputElement;

// Load saved tool router state (default: true)
browser.storage.local.get('useToolRouter').then((result) => {
  if (toolRouterToggle) {
    // Default to true if not set
    toolRouterToggle.checked = result.useToolRouter !== false;
  }
});

// Save tool router state when toggled
toolRouterToggle?.addEventListener('change', () => {
  browser.storage.local.set({ useToolRouter: toolRouterToggle.checked });
  // Broadcast to any open chat pages
  browser.runtime.sendMessage({
    type: 'tool_router_changed',
    enabled: toolRouterToggle.checked,
  }).catch(() => {});
});

// Open Chat button
const openChatBtn = document.getElementById('open-chat') as HTMLButtonElement;
openChatBtn?.addEventListener('click', () => {
  const chatUrl = browser.runtime.getURL('chat.html');
  browser.tabs.create({ url: chatUrl });
});

// Theme toggle
themeToggleBtn.addEventListener('click', toggleTheme);

// Refresh installed servers button
const refreshInstalledBtn = document.getElementById('refresh-installed') as HTMLButtonElement;
refreshInstalledBtn?.addEventListener('click', async () => {
  refreshInstalledBtn.classList.add('loading');
  refreshInstalledBtn.disabled = true;
  await loadInstalledServers();
  refreshInstalledBtn.classList.remove('loading');
  refreshInstalledBtn.disabled = false;
});

// Go to directory link (in empty state)
document.getElementById('go-to-directory-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  openDirectoryBtn.click();
});

// Credential modal event listeners
credentialModalClose.addEventListener('click', closeCredentialModal);
credentialModalCancel.addEventListener('click', closeCredentialModal);
credentialModalSave.addEventListener('click', saveCredentials);

// Close modal on backdrop click
credentialModal.querySelector('.modal-backdrop')?.addEventListener('click', closeCredentialModal);

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && credentialModal.style.display !== 'none') {
    closeCredentialModal();
  }
});

// LLM event listeners
llmDownloadBtn.addEventListener('click', downloadLLMModel);
llmStartBtn.addEventListener('click', startLocalLLM);
llmStopBtn.addEventListener('click', stopLocalLLM);

init();
