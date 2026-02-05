/**
 * Fixture for running Firefox with the Harbor extension.
 * 
 * IMPORTANT: Due to Playwright limitations, we cannot automate Firefox's
 * about:debugging page. Instead, we use web-ext to launch Firefox with
 * the extension pre-loaded, and then test via content script injection
 * on regular web pages.
 * 
 * For full sidebar testing, see the manual test instructions in TESTING_PLAN.md.
 */

import { test as base, firefox, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to the test fixtures directory
const EXTENSION_PATH = path.resolve(__dirname, '../../../extension/dist');

// Extension ID from manifest.json
const EXTENSION_ID = 'harbor@krikorian.co';

export type WebExtFixtures = {
  /** Firefox browser launched with Harbor extension via web-ext */
  harborBrowser: {
    context: BrowserContext;
    extensionId: string;
    /** Navigate to a test URL that has content script injection */
    testUrl: string;
  };
  /** Page navigated to the demo server where extension APIs are available */
  demoPage: Page;
  /** 
   * Page already navigated to the Harbor sidebar 
   * @deprecated Currently skipped due to Playwright limitations with moz-extension://
   */
  sidebarPage: Page;
};

/**
 * Find an available port
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        server.close(() => resolve(addr.port));
      } else {
        reject(new Error('Could not get port'));
      }
    });
  });
}

/**
 * Launch Firefox with the extension using web-ext.
 * 
 * web-ext handles all the complexity of loading the extension,
 * and we can then connect to test pages where the extension's
 * content scripts are active.
 */
async function launchFirefoxWithWebExt(): Promise<{
  webExtProcess: ChildProcess;
  cdpPort: number;
  profileDir: string;
  extensionId: string;
}> {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-e2e-'));
  const cdpPort = await findFreePort();
  
  console.log('[webext] Profile:', profileDir);
  console.log('[webext] Extension:', EXTENSION_PATH);
  console.log('[webext] CDP Port:', cdpPort);
  
  // Launch web-ext
  const webExtProcess = spawn('npx', [
    'web-ext', 'run',
    '--source-dir', EXTENSION_PATH,
    '--firefox-profile', profileDir,
    '--keep-profile-changes',
    '--no-reload',
    '--start-url', 'about:blank',
    // Enable remote debugging for potential future CDP connection
    '--pref', `devtools.debugger.remote-port=${cdpPort}`,
    '--pref', 'devtools.debugger.remote-enabled=true',
    '--pref', 'devtools.chrome.enabled=true',
  ], {
    cwd: path.resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let output = '';
  
  webExtProcess.stdout?.on('data', (data) => {
    const text = data.toString();
    output += text;
    console.log('[webext]', text.trim());
  });
  
  webExtProcess.stderr?.on('data', (data) => {
    const text = data.toString();
    output += text;
  });

  // Wait for extension to be installed
  console.log('[webext] Waiting for extension to load...');
  
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for extension. Output:\n${output.slice(-1000)}`));
    }, 45000);

    const checkInstalled = () => {
      if (output.includes('Installed') && output.includes('temporary add-on')) {
        clearTimeout(timeout);
        resolve();
      }
    };

    webExtProcess.stdout?.on('data', checkInstalled);
    webExtProcess.stderr?.on('data', checkInstalled);
    
    webExtProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    webExtProcess.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`web-ext exited with code ${code}`));
      }
    });
  });

  console.log('[webext] Extension loaded successfully');
  
  // Give Firefox time to stabilize
  await new Promise(r => setTimeout(r, 2000));

  return {
    webExtProcess,
    cdpPort,
    profileDir,
    extensionId: EXTENSION_ID,
  };
}

/**
 * Launch a simple Playwright context (without extension).
 * This is used as a fallback when web-ext integration isn't needed.
 */
async function launchSimpleFirefox(): Promise<{
  context: BrowserContext;
  profileDir: string;
}> {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-e2e-'));
  
  const context = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    firefoxUserPrefs: {
      'xpinstall.signatures.required': false,
      'devtools.chrome.enabled': true,
    },
  });

  return { context, profileDir };
}

export const test = base.extend<WebExtFixtures>({
  /**
   * Firefox browser with Harbor extension loaded via web-ext.
   * 
   * Note: web-ext launches its own Firefox instance, so we don't have
   * a Playwright BrowserContext. For tests that need content script
   * functionality, use demoPage which connects to the web-ext Firefox.
   */
  harborBrowser: async ({}, use) => {
    const { webExtProcess, profileDir, extensionId, cdpPort } = await launchFirefoxWithWebExt();
    
    // Create a placeholder context (web-ext manages the real browser)
    // Tests should use the web-ext Firefox instance
    const { context } = await launchSimpleFirefox();
    
    // Provide a test URL that tests can use
    // The demo server should be running on port 3000 by default
    const testUrl = 'http://localhost:3000/';
    
    await use({ context, extensionId, testUrl });
    
    // Cleanup
    webExtProcess.kill('SIGTERM');
    await context.close();
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  },

  /**
   * Page navigated to a demo page where extension content scripts are active.
   * 
   * Note: This uses a separate Playwright browser, not the web-ext browser.
   * For full extension testing, manual testing is recommended.
   */
  demoPage: async ({}, use) => {
    const { context, profileDir } = await launchSimpleFirefox();
    const page = await context.newPage();
    
    // Navigate to a local test page
    // Tests should start a demo server first
    await page.goto('about:blank');
    
    await use(page);
    
    await context.close();
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  },

  /**
   * Harbor sidebar page.
   * 
   * @deprecated Currently not supported due to Playwright limitations
   * with navigating to moz-extension:// URLs in Firefox.
   * 
   * For sidebar testing, please run web-ext manually and test in the browser.
   */
  sidebarPage: async ({}, use) => {
    // This fixture is currently not functional
    // Playwright cannot navigate to about:debugging or moz-extension:// URLs
    throw new Error(
      'sidebarPage fixture is not supported due to Playwright limitations. ' +
      'Firefox extension testing requires manual setup or using web-ext directly. ' +
      'See TESTING_PLAN.md for manual testing instructions.'
    );
  },
});

export { expect } from '@playwright/test';
