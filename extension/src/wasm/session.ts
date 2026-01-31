import { init, WASI } from '@wasmer/wasi';
import { Buffer } from 'buffer';
import type { StdioEndpoint } from '../mcp/stdio-transport';
import type { WasmServerManifest } from './types';

export type WasmSession = {
  endpoint: StdioEndpoint;
  close: () => void;
};

function createStdioEndpoint(): {
  endpoint: StdioEndpoint;
  pushStdout: (data: Uint8Array) => void;
  drainStdin: () => Uint8Array;
  close: () => void;
} {
  let handler: ((data: Uint8Array) => void) | null = null;
  const stdinQueue: Uint8Array[] = [];

  const endpoint: StdioEndpoint = {
    write(data: Uint8Array) {
      stdinQueue.push(data);
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };

  const pushStdout = (data: Uint8Array) => {
    handler?.(data);
  };

  const drainStdin = (): Uint8Array => {
    if (stdinQueue.length === 0) {
      return new Uint8Array(0);
    }
    const total = stdinQueue.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    stdinQueue.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });
    stdinQueue.length = 0;
    return merged;
  };

  return {
    endpoint,
    pushStdout,
    drainStdin,
    close: () => {
      stdinQueue.length = 0;
      handler = null;
    },
  };
}

export async function createWasmSession(
  manifest: WasmServerManifest,
): Promise<WasmSession> {
  if (!('Buffer' in globalThis)) {
    (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer;
  }
  if (!manifest.moduleUrl && !manifest.moduleBytesBase64) {
    const { createStubEndpoint } = await import('./stdio-endpoint');
    return {
      endpoint: createStubEndpoint(),
      close: () => {
        console.log('[Harbor] Closing WASM session (stub)', manifest.id);
      },
    };
  }

  await init();

  // Resolve the WASM URL - use runtime.getURL if available (background context)
  let wasmUrl = manifest.moduleUrl as string;
  if (wasmUrl && !wasmUrl.startsWith('http') && !wasmUrl.startsWith('safari-web-extension:') && !wasmUrl.startsWith('moz-extension:') && !wasmUrl.startsWith('chrome-extension:')) {
    // Relative URL - try to resolve to absolute
    try {
      // In background context, browser.runtime.getURL should work
      const browser = (globalThis as unknown as { browser?: typeof chrome }).browser;
      const chrome = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
      const runtime = browser?.runtime || chrome?.runtime;
      if (runtime?.getURL) {
        wasmUrl = runtime.getURL(wasmUrl);
        console.log('[Harbor] Resolved WASM URL:', wasmUrl);
      }
    } catch (e) {
      console.warn('[Harbor] Could not resolve WASM URL:', e);
    }
  }
  
  const wasmBytes = manifest.moduleBytesBase64
    ? Uint8Array.from(atob(manifest.moduleBytesBase64), (char) => char.charCodeAt(0)).buffer
    : await fetch(wasmUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch WASM module: ${response.status} from ${wasmUrl}`);
        }
        return response.arrayBuffer();
      });

  const wasmModule = await WebAssembly.compile(wasmBytes);
  const { endpoint, pushStdout, drainStdin, close } = createStdioEndpoint();

  const runOnce = async () => {
    const wasi = new WASI({
      args: [],
      env: {},
    });
    const instance = await wasi.instantiate(wasmModule, {});
    const stdinBuffer = drainStdin();
    if (stdinBuffer.length > 0) {
      wasi.setStdinBuffer(stdinBuffer);
    }
    wasi.start(instance);
    const stdout = wasi.getStdoutBuffer();
    if (stdout.length > 0) {
      pushStdout(stdout);
    }
    const stderr = wasi.getStderrBuffer();
    if (stderr.length > 0) {
      pushStdout(stderr);
    }
  };

  const originalWrite = endpoint.write.bind(endpoint);
  endpoint.write = (data: Uint8Array) => {
    originalWrite(data);
    runOnce().catch((error) => {
      console.error('[Harbor] WASM run failed', error);
    });
  };

  return {
    endpoint,
    close: () => {
      close();
      console.log('[Harbor] Closing WASM session', manifest.id);
    },
  };
}
