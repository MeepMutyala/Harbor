/**
 * Harbor Discovery Script
 * 
 * This minimal content script is injected into all pages to allow
 * other extensions to detect that Harbor is installed.
 * 
 * It sets a read-only window.__harbor object with version and extensionId.
 * This does NOT expose any callable API to web pages.
 */

import { browserAPI } from './browser-compat';

// Inject discovery info into the page context
function injectDiscoveryInfo(): void {
  // First inject the extension ID as a data attribute so the injected script can read it
  document.documentElement.setAttribute('data-harbor-extension-id', browserAPI.runtime.id);
  
  // Load external script to avoid CSP issues with inline scripts
  const script = document.createElement('script');
  script.src = browserAPI.runtime.getURL('discovery-injected.js');
  script.async = false;
  script.onload = () => script.remove();
  script.onerror = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Run immediately at document_start
injectDiscoveryInfo();
