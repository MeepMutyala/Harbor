/**
 * Tests for demo pages.
 * 
 * These tests verify that demo pages load correctly.
 * Tests that require the extension to be loaded are marked as such.
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Chat PoC Demo', () => {
  test('demo page loads', async ({ browserContext, demoServer }) => {
    const page = await browserContext.newPage();
    await page.goto(`${demoServer.url}/web-agents/chat-poc/`);
    await page.waitForLoadState('domcontentloaded');
    
    // Verify the page loaded
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // At minimum, the page should have loaded without errors
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test.skip('demo has access to window.ai API (requires extension)', async ({ extensionContext, demoServer }) => {
    // This test requires the extension to be loaded to inject window.ai
    const page = await extensionContext.newPage();
    await page.goto(`${demoServer.url}/web-agents/chat-poc/`);
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for the Web Agents API to inject window.ai
    await page.waitForTimeout(2000);
    
    const hasAI = await page.evaluate(() => {
      return typeof (window as any).ai !== 'undefined';
    });
    
    expect(hasAI).toBe(true);
  });
});

test.describe('Getting Started Demo', () => {
  test('demo page loads', async ({ browserContext, demoServer }) => {
    const page = await browserContext.newPage();
    await page.goto(`${demoServer.url}/web-agents/getting-started/`);
    await page.waitForLoadState('domcontentloaded');
    
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Summarizer Demo', () => {
  test('demo page loads', async ({ browserContext, demoServer }) => {
    const page = await browserContext.newPage();
    await page.goto(`${demoServer.url}/web-agents/summarizer/`);
    await page.waitForLoadState('domcontentloaded');
    
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Time Agent Demo', () => {
  test('demo page loads', async ({ browserContext, demoServer }) => {
    const page = await browserContext.newPage();
    await page.goto(`${demoServer.url}/web-agents/time-agent/`);
    await page.waitForLoadState('domcontentloaded');
    
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
