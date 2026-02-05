import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Serial execution for extension tests
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: false, // Extensions require headed mode
  },

  projects: [
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: {
            // Allow unsigned extensions
            'xpinstall.signatures.required': false,
            // Don't disable extensions on startup
            'extensions.autoDisableScopes': 0,
            // Enable browser toolbox for debugging
            'devtools.chrome.enabled': true,
            'devtools.debugger.remote-enabled': true,
          },
        },
      },
    },
  ],

  // Global setup/teardown
  globalSetup: path.join(import.meta.dirname, 'fixtures/global-setup.ts'),
  globalTeardown: path.join(import.meta.dirname, 'fixtures/global-teardown.ts'),
});
