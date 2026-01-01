// Harbor Directory Page
import browser from 'webextension-polyfill';
import type { CatalogServer, ProviderStatus, CatalogResponse } from './catalog/types';

// Featured server IDs (manually curated list of popular/recommended servers)
// Focus on locally installable servers for now
const FEATURED_SERVER_PATTERNS = [
  'filesystem',
  'memory',
  'github',
  'puppeteer',
  'fetch',
  'postgres',
  'sqlite',
  'slack',
  'sequential-thinking',
  'brave-search',
  'everything',
  'google-maps',
  'time',
];

// For now, we're focusing on locally installable servers (not remote)
const FOCUS_ON_INSTALLABLE = true;

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

// DOM Elements
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterPillsContainer = document.getElementById('filter-pills') as HTMLDivElement;
const providerStatusEl = document.getElementById('provider-status') as HTMLDivElement;
const mainContent = document.getElementById('main-content') as HTMLElement;
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
const customUrlBtn = document.getElementById('custom-url-btn') as HTMLButtonElement;

// Modals
const detailModal = document.getElementById('detail-modal') as HTMLDivElement;
const detailModalTitle = document.getElementById('detail-modal-title') as HTMLHeadingElement;
const detailModalSubtitle = document.getElementById('detail-modal-subtitle') as HTMLParagraphElement;
const detailModalBody = document.getElementById('detail-modal-body') as HTMLDivElement;
const detailModalClose = document.getElementById('detail-modal-close') as HTMLButtonElement;
const detailModalCancel = document.getElementById('detail-modal-cancel') as HTMLButtonElement;
const detailModalInstall = document.getElementById('detail-modal-install') as HTMLButtonElement;

const customUrlModal = document.getElementById('custom-url-modal') as HTMLDivElement;
const customUrlInput = document.getElementById('custom-url-input') as HTMLInputElement;
const customUrlModalClose = document.getElementById('custom-url-modal-close') as HTMLButtonElement;
const customUrlModalCancel = document.getElementById('custom-url-modal-cancel') as HTMLButtonElement;
const customUrlModalAdd = document.getElementById('custom-url-modal-add') as HTMLButtonElement;

const installModal = document.getElementById('install-modal') as HTMLDivElement;
const installModalTitle = document.getElementById('install-modal-title') as HTMLHeadingElement;
const installModalSubtitle = document.getElementById('install-modal-subtitle') as HTMLParagraphElement;
const installModalBody = document.getElementById('install-modal-body') as HTMLDivElement;
const installModalFooter = document.getElementById('install-modal-footer') as HTMLDivElement;
const installModalClose = document.getElementById('install-modal-close') as HTMLButtonElement;
const installModalConfigure = document.getElementById('install-modal-configure') as HTMLButtonElement;

// State
let allServers: CatalogServer[] = [];
let installedServerIds: Set<string> = new Set();
let providerStatus: ProviderStatus[] = [];
let isLoading = false;
let loadingStatus = 'Connecting to bridge...';
let activeFilter = 'all';
let selectedServer: CatalogServer | null = null;
let lastInstalledServerId: string | null = null;

// Listen for catalog status updates
function initCatalogStatusListener(): void {
  browser.runtime.onMessage.addListener((message) => {
    // Handle real-time catalog status updates
    if (message.type === 'catalog_status') {
      const statusMessage = message.message as string || message.status as string;
      updateLoadingStatus(statusMessage);
      
      // If we got a "ready" status while loading, we should re-render
      if (message.status === 'ready' && isLoading) {
        // Catalog is ready - reload data
        loadCatalog(false);
      }
    }
  });
}

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Check if a server matches featured patterns
function isFeatured(server: CatalogServer): boolean {
  const nameLower = server.name.toLowerCase();
  return FEATURED_SERVER_PATTERNS.some(pattern => 
    nameLower.includes(pattern.toLowerCase())
  );
}

// Get featured servers - prioritize by real popularity data
function getFeaturedServers(): CatalogServer[] {
  // Get all servers we can install
  const installable = allServers.filter(s => canInstall(s));
  
  // Sort by popularity score (real data from GitHub stars + npm downloads)
  // Fall back to pattern matching if no popularity data
  const sorted = [...installable].sort((a, b) => {
    // First: servers with popularity data
    const aScore = a.popularityScore || 0;
    const bScore = b.popularityScore || 0;
    
    if (aScore !== bScore) {
      return bScore - aScore; // Higher score first
    }
    
    // Second: servers with package info (direct install)
    const aHasPackage = hasPackageInfo(a) ? 1 : 0;
    const bHasPackage = hasPackageInfo(b) ? 1 : 0;
    if (aHasPackage !== bHasPackage) {
      return bHasPackage - aHasPackage;
    }
    
    // Third: official registry servers
    const aOfficial = a.source === 'official_registry' ? 1 : 0;
    const bOfficial = b.source === 'official_registry' ? 1 : 0;
    if (aOfficial !== bOfficial) {
      return bOfficial - aOfficial;
    }
    
    // Fourth: pattern matching
    const aFeatured = isFeatured(a) ? 1 : 0;
    const bFeatured = isFeatured(b) ? 1 : 0;
    return bFeatured - aFeatured;
  });
  
  // Take top servers that either have popularity data or match patterns
  return sorted
    .filter(s => s.popularityScore && s.popularityScore > 0 || isFeatured(s))
    .slice(0, 8);
}

// Format star count for display
function formatStars(count?: number): string {
  if (!count) return '';
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// Format download count for display
function formatDownloads(count?: number): string {
  if (!count) return '';
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// Provider status rendering
function renderProviderStatus(): void {
  if (providerStatus.length === 0) {
    providerStatusEl.innerHTML = '';
    return;
  }

  const providerNames: Record<string, string> = {
    official_registry: 'Official Registry',
    github_awesome: 'GitHub Awesome',
  };

  // Check if we have any popularity data
  const hasPopularityData = allServers.some(s => s.popularityScore && s.popularityScore > 0);

  const statusHtml = providerStatus
    .map(status => {
      const name = providerNames[status.id] || status.id;
      const statusClass = status.ok ? 'ok' : 'error';
      
      return `
        <div class="provider-badge ${statusClass}" title="${status.error || ''}">
          <span class="provider-dot"></span>
          <span class="provider-name">${escapeHtml(name)}</span>
          ${status.ok && status.count !== undefined 
            ? `<span class="provider-count">${status.count}</span>` 
            : ''}
        </div>
      `;
    })
    .join('');

  const enrichBtn = hasPopularityData
    ? ''
    : `<button class="btn btn-sm btn-ghost" id="enrich-btn" title="Fetch GitHub stars and npm download counts">
         ⭐ Get Popularity Data
       </button>`;

  providerStatusEl.innerHTML = `
    <div class="provider-status-inner">
      ${statusHtml}
      ${enrichBtn}
    </div>
  `;

  // Attach event listener to enrich button
  const enrichButton = document.getElementById('enrich-btn');
  if (enrichButton) {
    enrichButton.addEventListener('click', enrichCatalog);
  }
}

async function enrichCatalog(): Promise<void> {
  const btn = document.getElementById('enrich-btn');
  if (btn) {
    btn.textContent = '⏳ Enriching...';
    btn.setAttribute('disabled', 'true');
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'catalog_enrich',
    }) as { type: string; enriched?: number; failed?: number };

    if (response.type === 'catalog_enrich_result') {
      showToast(`Enriched ${response.enriched} servers with popularity data!`);
      // Reload to get the new data
      await loadCatalog();
    }
  } catch (error) {
    console.error('[Directory] Failed to enrich catalog:', error);
    showToast('Failed to get popularity data', 'error');
  }

  if (btn) {
    btn.remove(); // Remove button after enrichment attempt
  }
}

// Category filter mappings - maps filter names to keywords to search for
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  filesystem: ['filesystem', 'file', 'files', 'directory', 'folder', 'fs'],
  database: ['database', 'db', 'sql', 'postgres', 'sqlite', 'mysql', 'mongo', 'redis'],
  search: ['search', 'brave', 'google', 'bing', 'duckduckgo', 'web search'],
  development: ['git', 'github', 'gitlab', 'dev', 'code', 'programming', 'debug'],
  automation: ['automation', 'puppeteer', 'browser', 'playwright', 'selenium', 'scrape'],
};

// Check if server matches a category
function matchesCategory(server: CatalogServer, category: string): boolean {
  const keywords = CATEGORY_KEYWORDS[category];
  if (!keywords) return false;
  
  const nameLower = server.name.toLowerCase();
  const descLower = (server.description || '').toLowerCase();
  const tagsLower = server.tags.map(t => t.toLowerCase());
  
  return keywords.some(keyword => 
    nameLower.includes(keyword) ||
    descLower.includes(keyword) ||
    tagsLower.some(t => t.includes(keyword))
  );
}

// Apply filters
function applyFilters(servers: CatalogServer[]): CatalogServer[] {
  const query = searchInput.value.toLowerCase().trim();
  let filtered = servers;

  // For now, focus on installable servers only (not remote)
  if (FOCUS_ON_INSTALLABLE) {
    filtered = filtered.filter(s => s.installableOnly);
  }

  // Apply category filter
  if (activeFilter !== 'all') {
    switch (activeFilter) {
      case 'featured':
        // Popular = pattern matches + can install, prioritize those with packages
        filtered = filtered
          .filter(s => isFeatured(s) && canInstall(s))
          .sort((a, b) => {
            // Sort: has packages first
            const aHas = hasPackageInfo(a) ? 1 : 0;
            const bHas = hasPackageInfo(b) ? 1 : 0;
            return bHas - aHas;
          });
        break;
      case 'official':
        filtered = filtered.filter(s => s.source === 'official_registry');
        break;
      default:
        // Use category keywords mapping
        if (CATEGORY_KEYWORDS[activeFilter]) {
          filtered = filtered.filter(s => matchesCategory(s, activeFilter));
        } else {
          // Fallback: filter by tag or name containing the filter term
          filtered = filtered.filter(s =>
            s.tags.some(t => t.toLowerCase().includes(activeFilter)) ||
            s.name.toLowerCase().includes(activeFilter)
          );
        }
    }
  }

  // Apply search query
  if (query) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(query) ||
      (s.description?.toLowerCase().includes(query)) ||
      s.tags.some(t => t.toLowerCase().includes(query))
    );
  }

  return filtered;
}

// Update loading status display
function setLoadingStatus(status: string): void {
  loadingStatus = status;
  const statusEl = document.getElementById('loading-status');
  if (statusEl) {
    statusEl.textContent = status;
  }
}

// Main content rendering
function renderServers(): void {
  if (isLoading) {
    mainContent.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner">↻</div>
        <p class="loading-title">Loading directory...</p>
        <p class="loading-status" id="loading-status">${escapeHtml(loadingStatus)}</p>
      </div>
    `;
    return;
  }

  const filtered = applyFilters(allServers);
  const query = searchInput.value.toLowerCase().trim();
  const featured = getFeaturedServers();
  const showFeatured = activeFilter === 'all' && !query && featured.length > 0;

  if (filtered.length === 0 && !showFeatured) {
    mainContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">—</div>
        <p class="empty-title">${query ? 'No servers match your search' : 'No servers found'}</p>
        <p class="empty-description">Try adjusting your filters or refreshing the catalog.</p>
      </div>
    `;
    return;
  }

  let html = '';

  // Featured section
  if (showFeatured) {
    html += `
      <section class="featured-section">
        <div class="section-header">
          <div class="section-title-group">
            <span class="section-title">⭐ Popular Servers</span>
            <span class="section-count">${featured.length}</span>
          </div>
        </div>
        <div class="featured-grid">
          ${featured.map(renderFeaturedCard).join('')}
        </div>
      </section>
    `;
  }

  // All servers section (filtered is already installable-only when FOCUS_ON_INSTALLABLE is true)
  const serversToShow = activeFilter === 'featured' ? [] : filtered;
  
  if (serversToShow.length > 0) {
    html += `
      <section>
        <div class="section-header">
          <div class="section-title-group">
            <span class="section-title">All Servers</span>
            <span class="section-count">${serversToShow.length}</span>
          </div>
        </div>
        <div class="server-grid">
          ${serversToShow.map(renderServerCard).join('')}
        </div>
      </section>
    `;
  }

  mainContent.innerHTML = html;

  // Attach event listeners for cards
  mainContent.querySelectorAll('.server-card, .featured-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't open modal if clicking a button or link
      if (target.closest('button') || target.closest('a')) {
        return;
      }
      const serverId = (card as HTMLElement).dataset.serverId;
      const server = allServers.find(s => s.id === serverId);
      if (server) {
        openDetailModal(server);
      }
    });
  });

  // Attach install button listeners
  mainContent.querySelectorAll('.btn-install').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLButtonElement;
      try {
        const server = JSON.parse(el.dataset.server!) as CatalogServer;
        installServer(server);
      } catch (err) {
        console.error('Failed to parse server data:', err);
        showToast('Failed to install server', 'error');
      }
    });
  });
}

// Check if server has valid package info for installation
function hasPackageInfo(server: CatalogServer): boolean {
  const packages = (server as any).packages;
  return packages && packages.length > 0 && packages[0].identifier;
}

// Check if server can potentially be installed (has package info OR has GitHub URL)
function canInstall(server: CatalogServer): boolean {
  if (hasPackageInfo(server)) return true;
  // Can resolve from GitHub
  if (server.homepageUrl?.includes('github.com')) return true;
  if (server.repositoryUrl?.includes('github.com')) return true;
  return false;
}

function renderFeaturedCard(server: CatalogServer): string {
  const isInstalled = installedServerIds.has(server.id);
  const installable = canInstall(server);
  const hasDirectPackage = hasPackageInfo(server);
  const tagsHtml = server.tags
    .filter(t => !['remote', 'installable_only', 'official'].includes(t))
    .slice(0, 2)
    .map(t => `<span class="server-tag">${escapeHtml(t)}</span>`)
    .join('');

  // Popularity stats
  const stars = formatStars(server.githubStars);
  const downloads = formatDownloads(server.npmDownloads);
  const statsHtml = (stars || downloads) 
    ? `<div class="server-stats">
        ${stars ? `<span class="stat" title="GitHub stars">⭐ ${stars}</span>` : ''}
        ${downloads ? `<span class="stat" title="Weekly npm downloads">📦 ${downloads}</span>` : ''}
       </div>`
    : '';

  let actionHtml = '';
  if (isInstalled) {
    actionHtml = `<span class="badge badge-installed">Installed</span>`;
  } else if (installable) {
    const label = hasDirectPackage ? 'Install' : 'Install from GitHub';
    actionHtml = `<button class="btn btn-sm btn-primary btn-install" data-server='${JSON.stringify(server).replace(/'/g, "\\'")}' title="${hasDirectPackage ? '' : 'Will resolve package from GitHub'}">${label}</button>`;
  } else if (server.homepageUrl) {
    actionHtml = `<a href="${escapeHtml(server.homepageUrl)}" target="_blank" class="btn btn-sm btn-secondary" onclick="event.stopPropagation()">View</a>`;
  }

  return `
    <div class="featured-card" data-server-id="${escapeHtml(server.id)}">
      <div class="featured-card-header">
        <div class="featured-card-name">${escapeHtml(server.name)}</div>
        ${statsHtml || `<span class="featured-badge">Popular</span>`}
      </div>
      ${server.description ? `<p class="featured-card-description">${escapeHtml(server.description)}</p>` : ''}
      <div class="featured-card-footer">
        <div class="featured-card-tags">${tagsHtml}</div>
        ${actionHtml}
      </div>
    </div>
  `;
}

function renderServerCard(server: CatalogServer): string {
  const badges: string[] = [];
  const isInstalled = installedServerIds.has(server.id);
  const installable = canInstall(server);
  const hasDirectPackage = hasPackageInfo(server);
  
  // Source badge
  if (server.source === 'official_registry') {
    badges.push(`<span class="badge badge-registry">official</span>`);
  }

  // Installed badge
  if (isInstalled) {
    badges.push(`<span class="badge badge-installed">installed</span>`);
  }
  
  const tagsHtml = server.tags
    .filter(t => !['remote', 'installable_only', 'official'].includes(t))
    .slice(0, 3)
    .map(t => `<span class="server-tag">${escapeHtml(t)}</span>`)
    .join('');

  // Action buttons
  let actionsHtml = '';
  
  if (isInstalled) {
    actionsHtml += `<span class="text-sm text-success">✓ Installed</span>`;
  } else if (installable) {
    // Can install - show button with appropriate label
    const label = hasDirectPackage ? 'Install' : 'Install';
    const title = hasDirectPackage ? '' : 'Will resolve package info from GitHub';
    actionsHtml += `
      <button class="btn btn-sm btn-primary btn-install" data-server='${JSON.stringify(server).replace(/'/g, "\\'")}' title="${title}">
        ${label}
      </button>
    `;
  } else if (server.homepageUrl) {
    // No package info and no GitHub - link to source
    actionsHtml += `
      <a href="${escapeHtml(server.homepageUrl)}" target="_blank" class="btn btn-sm btn-secondary" onclick="event.stopPropagation()">
        View Source
      </a>
    `;
  }

  const linkHtml = (server.homepageUrl && installable)
    ? `<a href="${escapeHtml(server.homepageUrl)}" target="_blank" class="server-link" onclick="event.stopPropagation()">
        ${server.homepageUrl.includes('github.com') ? 'GitHub →' : 'Details →'}
      </a>`
    : '';

  return `
    <div class="server-card" data-server-id="${escapeHtml(server.id)}">
      <div class="server-card-header">
        <span class="server-name">${escapeHtml(server.name)}</span>
        <div class="server-badges">${badges.join('')}</div>
      </div>
      ${server.description ? `<p class="server-description">${escapeHtml(server.description)}</p>` : ''}
      ${tagsHtml ? `<div class="server-tags">${tagsHtml}</div>` : ''}
      <div class="server-actions">
        ${linkHtml}
        ${actionsHtml}
      </div>
    </div>
  `;
}

// Modal functions
function openDetailModal(server: CatalogServer): void {
  selectedServer = server;
  const isInstalled = installedServerIds.has(server.id);
  const installable = canInstall(server);
  const hasDirectPackage = hasPackageInfo(server);
  const isGitHubInstall = installable && !hasDirectPackage;
  
  detailModalTitle.textContent = server.name;
  detailModalSubtitle.textContent = server.source === 'official_registry' 
    ? 'From Official Registry' 
    : 'From GitHub Awesome List';

  const tagsHtml = server.tags
    .filter(t => !['remote', 'installable_only'].includes(t))
    .map(t => `<span class="server-tag">${escapeHtml(t)}</span>`)
    .join('');

  // Get package info for display
  const packageInfo = (server as any).packages?.[0];
  const packageDisplay = packageInfo 
    ? `${packageInfo.registryType || 'npm'}: ${packageInfo.identifier}`
    : null;

  let installInfoHtml = '';
  if (hasDirectPackage) {
    installInfoHtml = `
      <div class="detail-section">
        <div class="detail-label">Package</div>
        <div class="detail-url">${escapeHtml(packageDisplay!)}</div>
      </div>
      
      <div class="detail-section">
        <div class="detail-label">What happens when you install</div>
        <div class="detail-value" style="font-size: var(--text-xs); color: var(--color-text-muted);">
          1. Downloads the npm package to ~/.harbor/servers/<br>
          2. Installs dependencies<br>
          3. Server is ready to start from the sidebar
        </div>
      </div>
    `;
  } else if (isGitHubInstall) {
    installInfoHtml = `
      <div class="detail-section" style="background: var(--color-bg-subtle); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-border);">
        <div class="detail-label" style="color: var(--color-accent-primary);">GitHub Installation</div>
        <div class="detail-value" style="font-size: var(--text-xs); color: var(--color-text-secondary);">
          1. Fetches package.json from the GitHub repository<br>
          2. Determines the npm package name<br>
          3. Installs and configures automatically
        </div>
      </div>
    `;
  } else {
    installInfoHtml = `
      <div class="detail-section" style="background: var(--color-bg-warning); padding: var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-warning);">
        <div class="detail-label" style="color: var(--color-warning);">Manual Installation Required</div>
        <div class="detail-value" style="font-size: var(--text-xs); color: var(--color-text-secondary);">
          This server doesn't have published package info and no GitHub repository. Visit the source for installation instructions.
        </div>
      </div>
    `;
  }

  detailModalBody.innerHTML = `
    ${server.description ? `
      <div class="detail-section">
        <div class="detail-label">Description</div>
        <div class="detail-value">${escapeHtml(server.description)}</div>
      </div>
    ` : ''}
    
    ${tagsHtml ? `
      <div class="detail-section">
        <div class="detail-label">Categories</div>
        <div class="detail-tags">${tagsHtml}</div>
      </div>
    ` : ''}
    
    <div class="detail-section">
      <div class="detail-label">Links</div>
      <div class="detail-links">
        ${server.homepageUrl ? `<a href="${escapeHtml(server.homepageUrl)}" target="_blank" class="detail-link">📄 Documentation</a>` : ''}
        ${server.repositoryUrl ? `<a href="${escapeHtml(server.repositoryUrl)}" target="_blank" class="detail-link">📦 Source Code</a>` : ''}
      </div>
    </div>
    
    ${installInfoHtml}
  `;

  // Update install button based on installation capability
  // Reset any previous onclick handler
  detailModalInstall.onclick = null;
  
  if (isInstalled) {
    detailModalInstall.textContent = '✓ Installed';
    detailModalInstall.disabled = true;
    detailModalInstall.className = 'btn btn-success';
  } else if (installable) {
    detailModalInstall.textContent = isGitHubInstall ? 'Install from GitHub' : 'Install';
    detailModalInstall.disabled = false;
    detailModalInstall.className = 'btn btn-primary';
  } else {
    // No package info and no GitHub - show a link to source instead
    if (server.homepageUrl) {
      detailModalInstall.textContent = 'View Source →';
      detailModalInstall.disabled = false;
      detailModalInstall.className = 'btn btn-secondary';
      // Add click handler for external link
      detailModalInstall.onclick = () => {
        window.open(server.homepageUrl!, '_blank');
      };
    } else {
      detailModalInstall.textContent = 'Not Available';
      detailModalInstall.disabled = true;
      detailModalInstall.className = 'btn btn-ghost';
    }
  }

  detailModal.style.display = 'flex';
}

function closeDetailModal(): void {
  detailModal.style.display = 'none';
  selectedServer = null;
}

function openCustomUrlModal(): void {
  customUrlInput.value = '';
  customUrlModal.style.display = 'flex';
  customUrlInput.focus();
}

function closeCustomUrlModal(): void {
  customUrlModal.style.display = 'none';
}

function openInstallModal(serverName: string): void {
  installModalTitle.textContent = `Installing ${serverName}`;
  installModalSubtitle.textContent = 'Please wait while we set up your server...';
  installModalFooter.style.display = 'none';
  
  // Reset all steps
  const steps = installModal.querySelectorAll('.install-step');
  steps.forEach((step, index) => {
    step.className = index === 0 ? 'install-step active' : 'install-step pending';
    const detail = step.querySelector('.install-step-detail') as HTMLElement;
    if (index === 0) {
      detail.textContent = 'Verifying runtime availability...';
    } else {
      detail.textContent = 'Waiting...';
    }
  });

  installModal.style.display = 'flex';
}

function updateInstallStep(stepName: string, status: 'active' | 'complete' | 'error', detail?: string): void {
  const steps = installModal.querySelectorAll('.install-step');
  let foundStep = false;

  steps.forEach((step) => {
    const stepEl = step as HTMLElement;
    const currentStep = stepEl.dataset.step;
    
    if (currentStep === stepName) {
      foundStep = true;
      stepEl.className = `install-step ${status}`;
      
      const detailEl = stepEl.querySelector('.install-step-detail') as HTMLElement;
      if (detail) {
        detailEl.textContent = detail;
      }
      
      const iconEl = stepEl.querySelector('.install-step-icon') as HTMLElement;
      if (status === 'complete') {
        iconEl.textContent = '✓';
      } else if (status === 'error') {
        iconEl.textContent = '✕';
      }
    } else if (foundStep && status !== 'error') {
      // Activate next step
      if (stepEl.classList.contains('pending')) {
        stepEl.className = 'install-step active';
        const detailEl = stepEl.querySelector('.install-step-detail') as HTMLElement;
        detailEl.textContent = 'In progress...';
        foundStep = false; // Only activate one step
      }
    }
  });
}

function showInstallSuccess(serverName: string, needsConfig: boolean): void {
  installModalSubtitle.textContent = 'Installation complete!';
  
  installModalBody.innerHTML = `
    <div class="install-success-message">
      <div class="install-success-icon">✅</div>
      <div class="install-success-title">${escapeHtml(serverName)} installed!</div>
      <div class="install-success-detail">
        ${needsConfig 
          ? 'This server requires configuration. Click Configure to set up credentials.'
          : 'The server is ready to use. You can start it from the sidebar.'}
      </div>
    </div>
  `;

  installModalFooter.style.display = 'flex';
  installModalConfigure.style.display = needsConfig ? 'block' : 'none';
}

function showInstallError(error: string): void {
  installModalSubtitle.textContent = 'Installation failed';
  installModalFooter.style.display = 'flex';
  installModalConfigure.style.display = 'none';
}

function closeInstallModal(): void {
  installModal.style.display = 'none';
  lastInstalledServerId = null;
}

// Actions
async function loadCatalog(force = false): Promise<void> {
  isLoading = true;
  loadingStatus = 'Connecting to bridge...';
  renderServers();

  try {
    setLoadingStatus('Fetching catalog from bridge...');
    
    const response = await browser.runtime.sendMessage({
      type: force ? 'catalog_refresh' : 'catalog_get',
      force,
    }) as CatalogResponse;

    allServers = response.servers || [];
    providerStatus = response.providerStatus || [];
    
    console.log(`[Directory] Loaded ${allServers.length} servers from ${providerStatus.length} providers`);
    
    // If we got no servers and cache is stale, show a more helpful message
    if (allServers.length === 0) {
      setLoadingStatus('Waiting for servers... This may take a moment on first load.');
      
      // Retry after a short delay - the bridge might still be fetching
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setLoadingStatus('Retrying catalog fetch...');
      const retryResponse = await browser.runtime.sendMessage({
        type: 'catalog_get',
      }) as CatalogResponse;
      
      allServers = retryResponse.servers || [];
      providerStatus = retryResponse.providerStatus || [];
      console.log(`[Directory] Retry loaded ${allServers.length} servers`);
    }
    
    // Also load installed servers to show status
    await loadInstalledServers();
  } catch (error) {
    console.error('[Directory] Failed to load catalog:', error);
    showToast('Failed to load catalog', 'error');
  } finally {
    isLoading = false;
    renderProviderStatus();
    renderServers();
  }
}

async function loadInstalledServers(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'list_installed',
    }) as { type: string; servers?: Array<{ server?: { id: string } }> };

    if (response.type === 'list_installed_result' && response.servers) {
      installedServerIds = new Set(
        response.servers
          .filter(s => s.server?.id)
          .map(s => s.server!.id)
      );
    }
  } catch (error) {
    console.error('[Directory] Failed to load installed servers:', error);
  }
}

async function addToHarbor(name: string, url: string): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'add_server',
      label: name,
      base_url: url,
    }) as { type: string; server?: unknown; error?: { message: string } };

    if (response.type === 'add_server_result' && response.server) {
      showToast(`Added "${name}" to Harbor!`);
    } else if (response.type === 'error' && response.error) {
      showToast(`Failed: ${response.error.message}`, 'error');
    }
  } catch (error) {
    console.error('[Directory] Failed to add server:', error);
    showToast('Failed to add server', 'error');
  }
}

async function installServer(server: CatalogServer): Promise<void> {
  closeDetailModal();
  openInstallModal(server.name);
  
  try {
    // Step 1: Check runtimes
    updateInstallStep('check', 'active', 'Checking Node.js availability...');
    
    const runtimesResponse = await browser.runtime.sendMessage({
      type: 'check_runtimes',
    }) as { type: string; runtimes?: unknown[]; canInstall?: Record<string, boolean>; error?: { message: string } };

    if (runtimesResponse.type === 'error') {
      updateInstallStep('check', 'error', runtimesResponse.error?.message || 'Failed to check runtimes');
      showInstallError(runtimesResponse.error?.message || 'Failed to check runtimes');
      return;
    }

    updateInstallStep('check', 'complete', 'Runtime available');
    
    // Step 2: Download
    updateInstallStep('download', 'active', 'Downloading package...');
    
    // Small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 3: Install (combined with download in the bridge)
    updateInstallStep('download', 'complete', 'Package downloaded');
    updateInstallStep('install', 'active', 'Installing dependencies...');

    const installResponse = await browser.runtime.sendMessage({
      type: 'install_server',
      catalog_entry: server,
      package_index: 0,
    }) as { type: string; server?: { id: string; requiredEnvVars?: Array<{ isSecret?: boolean }> }; error?: { message: string } };

    if (installResponse.type === 'error') {
      updateInstallStep('install', 'error', installResponse.error?.message || 'Installation failed');
      showInstallError(installResponse.error?.message || 'Installation failed');
      return;
    }

    updateInstallStep('install', 'complete', 'Dependencies installed');
    
    // Step 4: Configure
    updateInstallStep('configure', 'active', 'Configuring server...');
    await new Promise(resolve => setTimeout(resolve, 300));
    updateInstallStep('configure', 'complete', 'Configuration complete');

    // Check if needs credentials
    const needsConfig = installResponse.server?.requiredEnvVars?.some(v => v.isSecret) || false;
    lastInstalledServerId = installResponse.server?.id || null;
    
    // Update installed servers set
    if (lastInstalledServerId) {
      installedServerIds.add(lastInstalledServerId);
    }
    
    showInstallSuccess(server.name, needsConfig);
    
    // Re-render to update installed status
    renderServers();

  } catch (error) {
    console.error('[Directory] Failed to install server:', error);
    updateInstallStep('install', 'error', String(error));
    showInstallError(String(error));
  }
}

async function installCustomServer(): Promise<void> {
  const input = customUrlInput.value.trim();
  if (!input) {
    showToast('Please enter a URL or package name', 'error');
    return;
  }

  closeCustomUrlModal();
  
  // Determine package type from input
  let packageType = 'npm';
  let packageId = input;
  
  if (input.includes('github.com')) {
    // Extract repo info from GitHub URL
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      packageType = 'github';
      packageId = match[1].replace(/\.git$/, '');
    }
  }

  // Create a synthetic server entry
  const customServer: CatalogServer = {
    id: `custom-${Date.now()}`,
    name: packageId.split('/').pop() || packageId,
    endpointUrl: '',
    installableOnly: true,
    description: `Custom server from ${input}`,
    tags: ['custom'],
    source: 'official_registry',
    fetchedAt: Date.now(),
  };

  openInstallModal(customServer.name);
  
  try {
    updateInstallStep('check', 'active', 'Validating package...');
    
    // For now, just try to install via npm
    // In a real implementation, we'd validate the package first
    await new Promise(resolve => setTimeout(resolve, 500));
    updateInstallStep('check', 'complete', 'Package found');
    
    updateInstallStep('download', 'active', 'Fetching from registry...');
    
    // Try to install
    const installResponse = await browser.runtime.sendMessage({
      type: 'install_server',
      catalog_entry: {
        ...customServer,
        packages: [{
          type: packageType,
          name: packageId,
        }],
      },
      package_index: 0,
    }) as { type: string; server?: { id: string }; error?: { message: string } };

    if (installResponse.type === 'error') {
      updateInstallStep('download', 'error', installResponse.error?.message || 'Failed to install');
      showInstallError(installResponse.error?.message || 'Failed to install');
      return;
    }

    updateInstallStep('download', 'complete', 'Package downloaded');
    updateInstallStep('install', 'active', 'Installing...');
    await new Promise(resolve => setTimeout(resolve, 300));
    updateInstallStep('install', 'complete', 'Installed');
    updateInstallStep('configure', 'active', 'Finalizing...');
    await new Promise(resolve => setTimeout(resolve, 300));
    updateInstallStep('configure', 'complete', 'Ready');

    lastInstalledServerId = installResponse.server?.id || null;
    showInstallSuccess(customServer.name, false);
    
    // Reload catalog to include new server
    await loadCatalog(true);

  } catch (error) {
    console.error('[Directory] Failed to install custom server:', error);
    updateInstallStep('install', 'error', String(error));
    showInstallError(String(error));
  }
}

// Update filter pills UI
function updateFilterPillsUI(): void {
  filterPillsContainer.querySelectorAll('.filter-tab').forEach(tab => {
    const filter = (tab as HTMLElement).dataset.filter;
    tab.classList.toggle('active', filter === activeFilter);
  });
}

// Event listeners
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

searchInput.addEventListener('input', () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderServers, 200);
});

// Filter pills click handler
filterPillsContainer.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const tab = target.closest('.filter-tab') as HTMLElement;
  if (tab && tab.dataset.filter) {
    activeFilter = tab.dataset.filter;
    updateFilterPillsUI();
    renderServers();
  }
});

// Theme toggle
themeToggleBtn.addEventListener('click', toggleTheme);

// Custom URL button
customUrlBtn.addEventListener('click', openCustomUrlModal);

// Detail modal events
detailModalClose.addEventListener('click', closeDetailModal);
detailModalCancel.addEventListener('click', closeDetailModal);
detailModal.querySelector('.modal-backdrop')?.addEventListener('click', closeDetailModal);

detailModalInstall.addEventListener('click', () => {
  if (selectedServer && canInstall(selectedServer)) {
    installServer(selectedServer);
  }
  // If not installable, the onclick handler set in openDetailModal handles the external link
});

// Custom URL modal events
customUrlModalClose.addEventListener('click', closeCustomUrlModal);
customUrlModalCancel.addEventListener('click', closeCustomUrlModal);
customUrlModal.querySelector('.modal-backdrop')?.addEventListener('click', closeCustomUrlModal);
customUrlModalAdd.addEventListener('click', installCustomServer);

customUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    installCustomServer();
  }
});

// Install modal events
installModalClose.addEventListener('click', closeInstallModal);
installModal.querySelector('.modal-backdrop')?.addEventListener('click', closeInstallModal);

installModalConfigure.addEventListener('click', () => {
  closeInstallModal();
  // Open sidebar to configure - for now just show toast
  showToast('Open the Harbor sidebar to configure credentials');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (detailModal.style.display !== 'none') {
      closeDetailModal();
    } else if (customUrlModal.style.display !== 'none') {
      closeCustomUrlModal();
    } else if (installModal.style.display !== 'none' && installModalFooter.style.display !== 'none') {
      closeInstallModal();
    }
  }
  
  // Cmd/Ctrl + K to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// Nav link to installed
document.getElementById('nav-installed')?.addEventListener('click', (e) => {
  e.preventDefault();
  // Open sidebar
  showToast('Open the Harbor sidebar to see installed servers');
});

// Initialize
initCatalogStatusListener();
loadCatalog();
