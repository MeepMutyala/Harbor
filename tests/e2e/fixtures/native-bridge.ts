/**
 * Fixture for native bridge verification during tests.
 * 
 * The native bridge (harbor-bridge) is spawned by Firefox via native messaging
 * when the extension needs it. This fixture verifies the bridge is built and
 * the manifest is installed, but does NOT spawn an extra process.
 * 
 * Native messaging uses stdin/stdout, so multiple Firefox instances can each
 * have their own bridge process without port conflicts.
 */

import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRIDGE_PATH = path.resolve(__dirname, '../../../bridge-rs/target/release/harbor-bridge');

export type NativeBridgeFixtures = {
  /** Spawns a test bridge process (only use if you need to test the bridge directly) */
  nativeBridge: ChildProcess;
  /** Verifies the bridge binary exists and manifest is installed */
  bridgeInstalled: boolean;
};

/**
 * Check if the native bridge binary exists
 */
async function bridgeExists(): Promise<boolean> {
  try {
    await fs.access(BRIDGE_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if native messaging manifest is installed for Firefox
 */
async function isManifestInstalled(): Promise<boolean> {
  const manifestPath = path.join(
    os.homedir(),
    'Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge.json'
  );
  
  try {
    await fs.access(manifestPath);
    return true;
  } catch {
    return false;
  }
}

export const test = base.extend<NativeBridgeFixtures>({
  /**
   * Spawn a native bridge process for direct testing.
   * 
   * Note: For most E2E tests, you don't need this - Firefox will spawn
   * its own bridge via native messaging when the extension needs it.
   * Use this only for tests that need to interact with the bridge directly.
   */
  nativeBridge: async ({}, use) => {
    if (!(await bridgeExists())) {
      throw new Error(
        `Native bridge not found at ${BRIDGE_PATH}. ` +
        `Run: cd bridge-rs && cargo build --release`
      );
    }

    // Spawn the bridge in native messaging mode
    const bridge = spawn(BRIDGE_PATH, ['--native-messaging'], {
      env: {
        ...process.env,
        HARBOR_TEST_MODE: '1',
        RUST_LOG: process.env.DEBUG ? 'debug' : 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Log output for debugging
    if (process.env.DEBUG) {
      bridge.stderr?.on('data', (data) => {
        console.log(`[bridge] ${data.toString().trim()}`);
      });
    }

    // Give it a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    await use(bridge);

    // Cleanup
    bridge.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bridge.kill('SIGKILL');
        resolve();
      }, 2000);
      bridge.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  },

  /**
   * Verify that the native bridge is properly installed.
   * This doesn't spawn a process - it just checks the binary and manifest exist.
   */
  bridgeInstalled: async ({}, use) => {
    const binaryExists = await bridgeExists();
    const manifestExists = await isManifestInstalled();
    
    if (!binaryExists) {
      console.warn('Native bridge binary not found. Run: cd bridge-rs && cargo build --release');
    }
    if (!manifestExists) {
      console.warn('Native messaging manifest not installed. Run: cd bridge-rs && ./install.sh --firefox-only');
    }
    
    await use(binaryExists && manifestExists);
  },
});

export { expect } from '@playwright/test';
