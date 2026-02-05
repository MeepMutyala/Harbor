/**
 * Combined test fixtures for Harbor E2E tests.
 * 
 * We have two fixture approaches:
 * 
 * 1. Basic fixtures (this file) - For tests that don't need extensions
 *    - browserContext: Basic Firefox browser
 *    - bridgeInstalled: Verifies native bridge is installed
 *    - demoServer: Local server for demo files
 * 
 * 2. WebExt fixtures (webext-firefox.ts) - For tests that need Harbor extension
 *    - harborBrowser: Firefox with Harbor extension loaded via about:debugging
 *    - sidebarPage: Harbor sidebar page ready to use
 * 
 * Usage:
 *   // For basic tests:
 *   import { test, expect } from '../fixtures/index.js';
 * 
 *   // For extension tests:
 *   import { test, expect } from '../fixtures/webext-firefox.js';
 */

import { mergeTests } from '@playwright/test';
import { test as extensionTest } from './extension.js';
import { test as nativeBridgeTest } from './native-bridge.js';
import { test as demoServerTest } from './demo-server.js';

// Merge basic fixtures (no extension loading)
export const test = mergeTests(extensionTest, nativeBridgeTest, demoServerTest);

export { expect } from '@playwright/test';

// Re-export types
export type { ExtensionFixtures } from './extension.js';
export type { NativeBridgeFixtures } from './native-bridge.js';
export type { DemoServerFixtures } from './demo-server.js';

// Re-export webext fixtures for convenience
export { test as harborTest, expect as harborExpect, type WebExtFixtures } from './webext-firefox.js';
