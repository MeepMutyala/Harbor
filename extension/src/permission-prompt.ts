/**
 * Harbor JS AI Provider - Permission Prompt
 * 
 * Handles the permission dialog UI and communicates decisions back to the background script.
 */

import browser from 'webextension-polyfill';
import type { PermissionScope } from './provider/types';

// Scope icons and descriptions
const SCOPE_INFO: Record<PermissionScope, { icon: string; iconClass: string; description: string }> = {
  'model:prompt': {
    icon: 'AI',
    iconClass: 'model',
    description: 'Generate text using AI models',
  },
  'model:tools': {
    icon: '⚡',
    iconClass: 'model',
    description: 'Use AI with tool calling capabilities',
  },
  'mcp:tools.list': {
    icon: '📋',
    iconClass: 'tools',
    description: 'List available MCP tools',
  },
  'mcp:tools.call': {
    icon: '🔧',
    iconClass: 'tools',
    description: 'Execute MCP tools on your behalf',
  },
  'browser:activeTab.read': {
    icon: '👁',
    iconClass: 'browser',
    description: 'Read content from the currently active browser tab',
  },
  'web:fetch': {
    icon: '🌐',
    iconClass: 'browser',
    description: 'Make web requests on your behalf (not implemented)',
  },
};

// =============================================================================
// Parse URL Parameters
// =============================================================================

function parseParams(): { promptId: string; origin: string; scopes: PermissionScope[]; reason: string } {
  const params = new URLSearchParams(window.location.search);
  
  const promptId = params.get('promptId') || '';
  const origin = params.get('origin') || 'Unknown origin';
  const reason = params.get('reason') || '';
  
  let scopes: PermissionScope[] = [];
  try {
    scopes = JSON.parse(params.get('scopes') || '[]');
  } catch {
    console.error('Failed to parse scopes');
  }
  
  return { promptId, origin, scopes, reason };
}

// =============================================================================
// Render UI
// =============================================================================

function renderUI(): void {
  const { origin, scopes, reason } = parseParams();
  
  // Set origin
  const originEl = document.getElementById('origin');
  if (originEl) {
    originEl.textContent = origin;
  }
  
  // Set reason if provided
  const reasonContainer = document.getElementById('reason-container');
  const reasonEl = document.getElementById('reason');
  if (reason && reasonContainer && reasonEl) {
    reasonEl.textContent = reason;
    reasonContainer.style.display = 'block';
  }
  
  // Render scopes
  const scopeList = document.getElementById('scope-list');
  if (scopeList) {
    scopeList.innerHTML = scopes.map(scope => {
      const info = SCOPE_INFO[scope] || {
        icon: '?',
        iconClass: 'model',
        description: scope,
      };
      
      return `
        <div class="scope-item">
          <div class="scope-icon ${info.iconClass}">${info.icon}</div>
          <div class="scope-info">
            <div class="scope-name">${escapeHtml(scope)}</div>
            <div class="scope-description">${escapeHtml(info.description)}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// Decision Handling
// =============================================================================

async function sendDecision(decision: 'allow-once' | 'allow-always' | 'deny'): Promise<void> {
  const { promptId } = parseParams();
  
  try {
    // Send decision to background script
    await browser.runtime.sendMessage({
      type: 'provider_permission_response',
      promptId,
      decision,
    });
    
    // Close this popup window
    window.close();
  } catch (err) {
    console.error('Failed to send permission decision:', err);
    // Show error to user
    alert('Failed to save permission decision. Please close this window and try again.');
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupListeners(): void {
  document.getElementById('allow-always')?.addEventListener('click', () => {
    sendDecision('allow-always');
  });
  
  document.getElementById('allow-once')?.addEventListener('click', () => {
    sendDecision('allow-once');
  });
  
  document.getElementById('deny')?.addEventListener('click', () => {
    sendDecision('deny');
  });
  
  // Handle window close (treat as deny)
  window.addEventListener('beforeunload', () => {
    // Note: We can't reliably send async messages here, so the background
    // script should have a timeout to handle cases where the user just closes the window
  });
}

// =============================================================================
// Theme
// =============================================================================

function initTheme(): void {
  // Check localStorage first
  const savedTheme = localStorage.getItem('harbor-theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    return;
  }
  
  // Fall back to system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
}

// =============================================================================
// Initialize
// =============================================================================

function init(): void {
  initTheme();
  renderUI();
  setupListeners();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

