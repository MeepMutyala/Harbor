/**
 * Web Agent API - Content Script
 *
 * Bridges messages between:
 * - Injected script (web page context)
 * - Background script (extension context)
 */

import type {
  TransportRequest,
  TransportResponse,
  TransportStreamEvent,
} from './types';

const CHANNEL = 'harbor_web_agent';

type RuntimePort = chrome.runtime.Port;

let backgroundPort: RuntimePort | null = null;

// Track pending requests and active streams
const pendingRequests = new Map<string, {
  sendResponse: (response: TransportResponse) => void;
}>();

const activeStreams = new Map<string, {
  sendEvent: (event: TransportStreamEvent) => void;
}>();

/**
 * Get or create connection to background script.
 */
function getBackgroundPort(): RuntimePort {
  if (!backgroundPort || !backgroundPort.name) {
    backgroundPort = chrome.runtime.connect({ name: 'web-agent-transport' });

    // Handle messages from background
    backgroundPort.onMessage.addListener((message: TransportResponse | TransportStreamEvent) => {
      if ('ok' in message) {
        // Regular response
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          pending.sendResponse(message);
        }
      } else if ('event' in message) {
        // Stream event
        const stream = activeStreams.get(message.id);
        if (stream) {
          stream.sendEvent(message);
          if (message.done) {
            activeStreams.delete(message.id);
          }
        }
      }
    });

    backgroundPort.onDisconnect.addListener(() => {
      backgroundPort = null;
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.sendResponse({
          id,
          ok: false,
          error: { code: 'ERR_INTERNAL', message: 'Background connection lost' },
        });
      }
      pendingRequests.clear();
      
      // End all active streams
      for (const [id, stream] of activeStreams) {
        stream.sendEvent({
          id,
          event: { type: 'error', error: { code: 'ERR_INTERNAL', message: 'Background connection lost' } },
          done: true,
        });
      }
      activeStreams.clear();
    });
  }

  return backgroundPort;
}

/**
 * Inject the Web Agent API script into the page.
 */
function injectAgentsAPI(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/agents/injected.js');
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

/**
 * Listen for messages from the page.
 */
window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window) return;

  const data = event.data as {
    channel?: string;
    request?: TransportRequest;
    abort?: { id: string };
  };

  if (data?.channel !== CHANNEL) return;

  // Handle abort signal
  if (data.abort) {
    const port = getBackgroundPort();
    port.postMessage({ type: 'abort', id: data.abort.id });
    activeStreams.delete(data.abort.id);
    return;
  }

  if (!data.request) return;

  const request = data.request;
  const isStreamingRequest = request.type === 'agent.run' || request.type === 'session.promptStreaming';

  const port = getBackgroundPort();

  if (isStreamingRequest) {
    // Set up stream forwarding
    activeStreams.set(request.id, {
      sendEvent: (streamEvent) => {
        window.postMessage({ channel: CHANNEL, streamEvent }, '*');
      },
    });
  } else {
    // Set up response forwarding
    pendingRequests.set(request.id, {
      sendResponse: (response) => {
        window.postMessage({ channel: CHANNEL, response }, '*');
      },
    });
  }

  // Forward to background with origin
  port.postMessage({
    ...request,
    origin: window.location.origin,
  });
});

// Initialize
injectAgentsAPI();
