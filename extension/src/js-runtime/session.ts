/**
 * JS MCP Server session management.
 *
 * Creates and manages sandboxed iframe sessions for JS MCP servers.
 * Uses manifest sandbox feature to allow eval/Function in the iframe.
 */

import type { StdioEndpoint } from '../mcp/stdio-transport';
import type { McpServerManifest } from '../wasm/types';
import { wrapServerCode } from './sandbox';
import { isHostAllowed } from './fetch-proxy';

export type JsSession = {
  endpoint: StdioEndpoint;
  close: () => void;
};

/**
 * Loads the server code from the manifest.
 * Supports loading from URL or inline base64.
 */
async function loadServerCode(manifest: McpServerManifest): Promise<string> {
  if (manifest.scriptBase64) {
    return atob(manifest.scriptBase64);
  }

  if (manifest.scriptUrl) {
    const response = await fetch(manifest.scriptUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JS server: ${response.status}`);
    }
    return response.text();
  }

  throw new Error('JS server manifest must have scriptUrl or scriptBase64');
}

/**
 * Creates a stdio endpoint for communication with an iframe.
 */
function createIframeStdioEndpoint(): {
  endpoint: StdioEndpoint;
  attachIframe: (iframe: HTMLIFrameElement) => void;
  close: () => void;
} {
  let handler: ((data: Uint8Array) => void) | null = null;
  let iframe: HTMLIFrameElement | null = null;
  const encoder = new TextEncoder();

  const endpoint: StdioEndpoint = {
    write(data: Uint8Array) {
      // Convert Uint8Array to string and send to iframe
      const decoder = new TextDecoder();
      const jsonString = decoder.decode(data);
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'stdin', data: jsonString }, '*');
      }
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };

  const messageHandler = (event: MessageEvent) => {
    // Only accept messages from our iframe
    if (!iframe || event.source !== iframe.contentWindow) return;
    
    const data = event.data;
    if (!data) return;

    if (data.type === 'stdout') {
      // Convert string to Uint8Array and send to handler
      const encoded = encoder.encode(data.data + '\n');
      handler?.(encoded);
    } else if (data.type === 'console') {
      // Forward console messages
      const level = data.level as 'log' | 'warn' | 'error' | 'info' | 'debug';
      const args = data.args || [];
      console[level]?.('[JS MCP]', ...args);
    }
  };

  const attachIframe = (f: HTMLIFrameElement) => {
    iframe = f;
    window.addEventListener('message', messageHandler);
  };

  return {
    endpoint,
    attachIframe,
    close: () => {
      window.removeEventListener('message', messageHandler);
      handler = null;
      iframe = null;
    },
  };
}

/**
 * Sets up fetch proxy for an iframe sandbox.
 */
function setupFetchProxyForIframe(
  iframe: HTMLIFrameElement,
  allowedHosts: string[],
  onFetchAttempt?: (url: string, allowed: boolean) => void,
): void {
  const handler = async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    
    const data = event.data;
    if (data?.type !== 'fetch-request') return;

    const { id, url, options } = data;
    
    // Check if host is allowed
    const allowed = isHostAllowed(url, allowedHosts);
    onFetchAttempt?.(url, allowed);

    if (!allowed) {
      iframe.contentWindow?.postMessage({
        type: 'fetch-response',
        id,
        error: `Network access denied: ${new URL(url).hostname} is not in allowed hosts`,
      }, '*');
      return;
    }

    try {
      // Reconstruct the request
      const fetchOptions: RequestInit = {
        method: options?.method || 'GET',
        headers: options?.headers,
      };

      if (options?.body) {
        if (typeof options.body === 'string') {
          fetchOptions.body = options.body;
        } else if (options.body.type === 'arraybuffer' || options.body.type === 'uint8array') {
          fetchOptions.body = new Uint8Array(options.body.data);
        }
      }

      const response = await fetch(url, fetchOptions);
      const body = await response.text();

      iframe.contentWindow?.postMessage({
        type: 'fetch-response',
        id,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      }, '*');
    } catch (error) {
      iframe.contentWindow?.postMessage({
        type: 'fetch-response',
        id,
        error: error instanceof Error ? error.message : String(error),
      }, '*');
    }
  };

  window.addEventListener('message', handler);
}

/**
 * Creates a JS MCP server session in a sandboxed Web Worker.
 *
 * @param manifest - The server manifest with JS-specific fields
 * @returns A session with stdio endpoint and close function
 */
export async function createJsSession(
  manifest: McpServerManifest,
): Promise<JsSession> {
  // Validate that this is a JS server
  if (manifest.runtime !== 'js') {
    throw new Error(`Expected JS server, got runtime: ${manifest.runtime}`);
  }

  // Load and wrap server code with sandbox preamble
  const serverCode = await loadServerCode(manifest);
  const wrappedCode = wrapServerCode(serverCode);

  // Create sandboxed iframe for JS execution
  // The sandbox page allows eval/Function via manifest sandbox config
  const sandboxUrl = chrome.runtime.getURL('dist/js-runtime/sandbox.html');
  const iframe = document.createElement('iframe');
  iframe.src = sandboxUrl;
  iframe.style.display = 'none';
  iframe.setAttribute('sandbox', 'allow-scripts');
  document.body.appendChild(iframe);

  // Create stdio endpoint for iframe communication
  const { endpoint, attachIframe, close: closeEndpoint } =
    createIframeStdioEndpoint();

  // Wait for iframe to load and sandbox to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('JS server failed to initialize within timeout'));
    }, 5000);

    let sandboxReady = false;
    let codeReady = false;

    const handler = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (event.source !== iframe.contentWindow) return;
      
      const data = event.data;
      if (!data?.type) return;

      if (data.type === 'sandbox-ready' && !sandboxReady) {
        sandboxReady = true;
        // Send the code to execute
        iframe.contentWindow?.postMessage({ type: 'load-code', code: wrappedCode }, '*');
      } else if (data.type === 'ready' && !codeReady) {
        codeReady = true;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        attachIframe(iframe);
        resolve();
      } else if (data.type === 'error') {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        reject(new Error(data.message || 'Sandbox error'));
      }
    };

    window.addEventListener('message', handler);
  });

  // Set up fetch proxy with capability enforcement
  const allowedHosts = manifest.capabilities?.network?.hosts || [];
  setupFetchProxyForIframe(iframe, allowedHosts, (url, allowed) => {
    if (!allowed) {
      console.warn(
        `[Harbor] JS MCP server "${manifest.id}" attempted blocked fetch:`,
        url,
      );
    }
  });

  // Inject secrets as environment variables
  if (manifest.secrets && Object.keys(manifest.secrets).length > 0) {
    iframe.contentWindow?.postMessage({ type: 'init-env', env: manifest.secrets }, '*');
  }

  console.log('[Harbor] JS MCP server session started:', manifest.id);

  return {
    endpoint,
    close: () => {
      // Request clean shutdown
      iframe.contentWindow?.postMessage({ type: 'terminate' }, '*');

      // Remove iframe after a short delay
      setTimeout(() => {
        iframe.remove();
      }, 100);

      closeEndpoint();
      console.log('[Harbor] JS MCP server session closed:', manifest.id);
    },
  };
}

/**
 * Creates a stub session for testing without actual server code.
 * Returns an endpoint that echoes tools/list with empty tools.
 */
export function createJsStubSession(manifest: McpServerManifest): JsSession {
  let handler: ((data: Uint8Array) => void) | null = null;
  const encoder = new TextEncoder();

  const endpoint: StdioEndpoint = {
    write(data: Uint8Array) {
      const decoder = new TextDecoder();
      const json = decoder.decode(data);
      try {
        const request = JSON.parse(json.trim());
        let response;

        if (request.method === 'tools/list') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: manifest.tools || [] },
          };
        } else if (request.method === 'tools/call') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                { type: 'text', text: 'Stub response from JS MCP server' },
              ],
            },
          };
        } else {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Method not found' },
          };
        }

        // Send response back
        const responseData = encoder.encode(JSON.stringify(response) + '\n');
        setTimeout(() => handler?.(responseData), 0);
      } catch (e) {
        console.error('[Harbor] Stub session parse error:', e);
      }
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };

  return {
    endpoint,
    close: () => {
      handler = null;
      console.log('[Harbor] Closing JS stub session:', manifest.id);
    },
  };
}
