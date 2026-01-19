/**
 * Native Messaging Bridge Client
 * 
 * Connects to the harbor-bridge native application via the browser's native messaging API.
 * This ensures the bridge is started automatically when the extension loads.
 */

const NATIVE_APP_ID = 'harbor_bridge';

type NativeMessage = {
  type: string;
  payload?: unknown;
};

type NativeStatusMessage = {
  type: 'status';
  payload: {
    status: 'ready' | 'pong' | 'error';
    message: string;
    port: number;
  };
};

let nativePort: browser.runtime.Port | null = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

type ConnectionState = {
  connected: boolean;
  bridgeReady: boolean;
  error: string | null;
};

let connectionState: ConnectionState = {
  connected: false,
  bridgeReady: false,
  error: null,
};

const connectionListeners: Array<(state: ConnectionState) => void> = [];

export function getNativeConnectionState(): ConnectionState {
  return { ...connectionState };
}

export function onConnectionStateChange(listener: (state: ConnectionState) => void): () => void {
  connectionListeners.push(listener);
  // Immediately call with current state
  listener(connectionState);
  return () => {
    const idx = connectionListeners.indexOf(listener);
    if (idx >= 0) connectionListeners.splice(idx, 1);
  };
}

function notifyListeners(): void {
  for (const listener of connectionListeners) {
    listener(connectionState);
  }
}

function updateState(update: Partial<ConnectionState>): void {
  connectionState = { ...connectionState, ...update };
  notifyListeners();
}

/**
 * Connect to the native bridge application.
 */
export function connectNativeBridge(): void {
  if (nativePort) {
    console.log('[Harbor] Native bridge already connected');
    return;
  }

  console.log('[Harbor] Connecting to native bridge...');
  connectionAttempts++;

  try {
    // Use browser.runtime for Firefox compatibility
    const runtime = (typeof browser !== 'undefined' ? browser : chrome).runtime;
    nativePort = runtime.connectNative(NATIVE_APP_ID);

    nativePort.onMessage.addListener((message: NativeMessage) => {
      console.log('[Harbor] Native message received:', message);

      if (message.type === 'status') {
        const statusMsg = message as NativeStatusMessage;
        if (statusMsg.payload.status === 'ready' || statusMsg.payload.status === 'pong') {
          updateState({
            connected: true,
            bridgeReady: true,
            error: null,
          });
          connectionAttempts = 0; // Reset on successful connection
        } else if (statusMsg.payload.status === 'error') {
          updateState({
            connected: true,
            bridgeReady: false,
            error: statusMsg.payload.message,
          });
        }
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const error = (typeof browser !== 'undefined' ? browser : chrome).runtime.lastError;
      const errorMessage = error?.message || 'Native bridge disconnected';
      
      console.log('[Harbor] Native bridge disconnected:', errorMessage);
      
      nativePort = null;
      updateState({
        connected: false,
        bridgeReady: false,
        error: errorMessage,
      });

      // Attempt to reconnect if we haven't exceeded attempts
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log(`[Harbor] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})...`);
        setTimeout(connectNativeBridge, RECONNECT_DELAY);
      } else {
        console.log('[Harbor] Max reconnection attempts reached. Bridge may not be installed.');
        updateState({
          error: 'Native bridge not installed. Run: cd bridge-rs && ./install.sh',
        });
      }
    });

    // Send initial ping to verify connection
    sendNativeMessage({ type: 'ping' });
    
    updateState({
      connected: true,
      error: null,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to connect to native bridge';
    console.error('[Harbor] Failed to connect to native bridge:', errorMessage);
    
    updateState({
      connected: false,
      bridgeReady: false,
      error: errorMessage,
    });
  }
}

/**
 * Send a message to the native bridge.
 */
export function sendNativeMessage(message: NativeMessage): void {
  if (!nativePort) {
    console.warn('[Harbor] Cannot send native message: not connected');
    return;
  }

  try {
    nativePort.postMessage(message);
  } catch (err) {
    console.error('[Harbor] Failed to send native message:', err);
  }
}

/**
 * Disconnect from the native bridge.
 */
export function disconnectNativeBridge(): void {
  if (nativePort) {
    nativePort.disconnect();
    nativePort = null;
  }
  updateState({
    connected: false,
    bridgeReady: false,
    error: null,
  });
}

/**
 * Check if the native bridge is ready (connected and HTTP server is running).
 */
export function isNativeBridgeReady(): boolean {
  return connectionState.connected && connectionState.bridgeReady;
}
