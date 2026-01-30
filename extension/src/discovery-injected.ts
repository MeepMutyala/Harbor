/**
 * Harbor Discovery - Injected Script
 * 
 * This runs in the page context to expose window.__harbor.
 * Loaded as an external script to avoid CSP inline script violations.
 */

(function() {
  // Only set if not already defined
  if (typeof (window as { __harbor?: unknown }).__harbor !== 'undefined') return;
  
  // Read extension ID from data attribute set by content script
  const extensionId = document.documentElement.getAttribute('data-harbor-extension-id') || 'unknown';
  
  Object.defineProperty(window, '__harbor', {
    value: Object.freeze({
      version: '0.1.0',
      extensionId,
      installed: true
    }),
    writable: false,
    configurable: false,
    enumerable: true
  });
  
  // Dispatch event for extensions waiting for Harbor
  window.dispatchEvent(new CustomEvent('harbor-discovered', {
    detail: { version: '0.1.0', extensionId }
  }));
})();
