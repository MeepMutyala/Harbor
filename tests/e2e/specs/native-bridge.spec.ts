/**
 * Tests for native bridge installation and connectivity.
 */

import { test, expect } from '../fixtures/index.js';

test.describe('Native Bridge', () => {
  test('native bridge binary and manifest are installed', async ({ bridgeInstalled }) => {
    expect(bridgeInstalled).toBe(true);
  });

  test('native bridge process can be spawned', async ({ nativeBridge }) => {
    expect(nativeBridge).toBeTruthy();
    expect(nativeBridge.pid).toBeGreaterThan(0);
    expect(nativeBridge.killed).toBe(false);
  });

  test.skip('extension connects to native bridge (requires web-ext)', async ({ extensionContext, sidebarPage }) => {
    // This test requires the extension to be fully loaded via web-ext
    // Firefox will spawn the bridge via native messaging automatically
    await sidebarPage.waitForLoadState('domcontentloaded');
    await sidebarPage.waitForTimeout(2000);
    
    const pageLoaded = await sidebarPage.locator('body').isVisible();
    expect(pageLoaded).toBe(true);
  });
});
