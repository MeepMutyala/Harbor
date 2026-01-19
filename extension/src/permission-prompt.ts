/**
 * Permission Prompt Handler
 *
 * Runs in the permission prompt popup window.
 */

import { SCOPE_DESCRIPTIONS } from './policy/permissions';
import type { PermissionScope } from './agents/types';

// Parse URL params
const params = new URLSearchParams(window.location.search);
const origin = params.get('origin') || 'Unknown';
const scopesParam = params.get('scopes') || '';
const reason = params.get('reason') || '';
const toolsParam = params.get('tools') || '';

const scopes = scopesParam.split(',').filter(Boolean) as PermissionScope[];
const tools = toolsParam.split(',').filter(Boolean);

// Render origin
const originEl = document.getElementById('origin');
if (originEl) {
  originEl.textContent = origin;
}

// Render reason
if (reason) {
  const reasonContainer = document.getElementById('reason-container');
  const reasonEl = document.getElementById('reason');
  if (reasonContainer && reasonEl) {
    reasonContainer.style.display = 'block';
    reasonEl.textContent = reason;
  }
}

// Render scopes
const scopesList = document.getElementById('scopes-list');
if (scopesList) {
  for (const scope of scopes) {
    const info = SCOPE_DESCRIPTIONS[scope];
    if (!info) continue;

    const item = document.createElement('div');
    item.className = 'scope-item';
    item.innerHTML = `
      <div class="scope-header">
        <span class="scope-title">${info.title}</span>
        <span class="risk-badge risk-${info.risk}">${info.risk}</span>
      </div>
      <div class="scope-description">${info.description}</div>
    `;
    scopesList.appendChild(item);
  }
}

// Render tools
if (tools.length > 0) {
  const toolsSection = document.getElementById('tools-section');
  const toolsList = document.getElementById('tools-list');
  if (toolsSection && toolsList) {
    toolsSection.style.display = 'block';

    for (const tool of tools) {
      const item = document.createElement('div');
      item.className = 'tool-item';
      item.innerHTML = `
        <input type="checkbox" id="tool-${tool}" data-tool="${tool}" checked>
        <label for="tool-${tool}" class="tool-name">${tool}</label>
      `;
      toolsList.appendChild(item);
    }
  }
}

// Handle deny button
const btnDeny = document.getElementById('btn-deny');
btnDeny?.addEventListener('click', () => {
  sendResponse({ granted: false });
});

// Handle allow button
const btnAllow = document.getElementById('btn-grant');
btnAllow?.addEventListener('click', () => {
  const grantOnce = (document.getElementById('grant-once') as HTMLInputElement)?.checked;
  const grantType = grantOnce ? 'granted-once' : 'granted-always';

  // Collect selected tools
  const selectedTools: string[] = [];
  const toolCheckboxes = document.querySelectorAll<HTMLInputElement>('#tools-list input[type="checkbox"]');
  for (const checkbox of toolCheckboxes) {
    if (checkbox.checked) {
      const toolName = checkbox.dataset.tool;
      if (toolName) selectedTools.push(toolName);
    }
  }

  sendResponse({
    granted: true,
    grantType,
    allowedTools: selectedTools.length > 0 ? selectedTools : undefined,
  });
});

// Send response to background script
function sendResponse(response: {
  granted: boolean;
  grantType?: 'granted-once' | 'granted-always';
  allowedTools?: string[];
}): void {
  chrome.runtime.sendMessage({
    type: 'permission_prompt_response',
    response,
  });
}

// Handle window close (user dismissed)
window.addEventListener('beforeunload', () => {
  // This may not always fire, but the background script handles window close events
});
