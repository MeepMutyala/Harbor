const BRIDGE_URL = 'http://localhost:9137/rpc';
const BRIDGE_STREAM_URL = 'http://localhost:9137/rpc/stream';
const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

type RpcRequest = {
  id: string;
  method: string;
  params?: unknown;
};

type RpcResponse = {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
};

type StreamEvent = {
  id: string;
  type: 'token' | 'done' | 'error';
  token?: string;
  finish_reason?: string;
  model?: string;
  error?: { code: number; message: string };
};

export type BridgeConnectionState = {
  connected: boolean;
  lastCheck: number;
  error: string | null;
};

let connectionState: BridgeConnectionState = {
  connected: false,
  lastCheck: 0,
  error: null,
};

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export function getBridgeConnectionState(): BridgeConnectionState {
  return { ...connectionState };
}

export async function checkBridgeHealth(): Promise<boolean> {
  try {
    const result = await bridgeRequest<{ status: string }>('system.health');
    connectionState = {
      connected: result.status === 'ok',
      lastCheck: Date.now(),
      error: null,
    };
    return connectionState.connected;
  } catch (err) {
    connectionState = {
      connected: false,
      lastCheck: Date.now(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
    return false;
  }
}

export function initializeBridgeClient(): void {
  console.log('[Harbor] Bridge client initialized', BRIDGE_URL);

  // Initial health check
  checkBridgeHealth().then((connected) => {
    console.log('[Harbor] Bridge connection:', connected ? 'connected' : 'disconnected');
  });

  // Set up periodic health checks
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  healthCheckInterval = setInterval(() => {
    checkBridgeHealth();
  }, HEALTH_CHECK_INTERVAL);
}

export async function bridgeRequest<T>(method: string, params?: unknown, retries = 3): Promise<T> {
  const payload: RpcRequest = {
    id: crypto.randomUUID(),
    method,
    params,
  };

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = (await response.json()) as RpcResponse;
      if (json.error) {
        throw new Error(json.error.message);
      }
      
      // Update connection state on success
      connectionState = {
        connected: true,
        lastCheck: Date.now(),
        error: null,
      };
      
      return json.result as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(`[Harbor] Bridge request attempt ${attempt + 1}/${retries} failed:`, lastError.message);
      
      // Wait before retry (exponential backoff)
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  
  // All retries failed
  connectionState = {
    connected: false,
    lastCheck: Date.now(),
    error: lastError?.message || 'Unknown error',
  };
  
  throw lastError || new Error('Bridge request failed');
}

/**
 * Make a streaming request to the bridge using SSE.
 * Returns an async generator that yields stream events.
 */
export async function* bridgeStreamRequest(
  method: string,
  params?: unknown,
): AsyncGenerator<StreamEvent> {
  const payload: RpcRequest = {
    id: crypto.randomUUID(),
    method,
    params,
  };

  const response = await fetch(BRIDGE_STREAM_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data) {
            try {
              const event = JSON.parse(data) as StreamEvent;
              yield event;

              // Stop on done or error
              if (event.type === 'done' || event.type === 'error') {
                return;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
