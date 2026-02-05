#!/usr/bin/env node
/**
 * E2E Browser Test Runner
 * 
 * This script:
 * 1. Starts a local server to serve test pages
 * 2. Uses Playwright to launch Chromium with extensions loaded
 * 3. Opens the test runner page
 * 4. Captures results via HTTP endpoint
 * 5. Exits with appropriate code
 * 
 * Usage:
 *   node run-browser-tests.mjs [--timeout=60000] [--keep-open] [--browser=chromium|firefox]
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
};

// Configuration
const config = {
  harborExtPath: path.resolve(__dirname, '../../extension/dist-chrome'),
  webAgentsExtPath: path.resolve(__dirname, '../../web-agents-api/dist-chrome'),
  testServerPort: 3457,
  timeout: parseInt(getArg('timeout', '60000')),
  keepOpen: args.includes('--keep-open'),
};

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

// Simple static file server with results endpoint
function createTestServer() {
  return new Promise((resolve, reject) => {
    let testResultsResolver = null;
    const testResultsPromise = new Promise(r => { testResultsResolver = r; });
    
    const server = http.createServer((req, res) => {
      // Handle results POST from test runner
      if (req.method === 'POST' && req.url === '/__test_results__') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const results = JSON.parse(body);
            console.log(`\n[results] Received from browser:`);
            console.log(`  Passed: ${results.passed}/${results.total}`);
            console.log(`  Failed: ${results.failed}`);
            if (results.failures && results.failures.length > 0) {
              console.log(`  Failures:`);
              for (const f of results.failures) {
                console.log(`    - ${f.suite}: ${f.name}`);
                console.log(`      ${f.error}`);
              }
            }
            testResultsResolver(results);
          } catch (e) {
            console.error('[results] Failed to parse:', e);
          }
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
          res.end('ok');
        });
        return;
      }
      
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }
      
      // Parse URL and remove query string
      const urlPath = req.url.split('?')[0];
      let filePath = urlPath === '/' ? '/test-runner.html' : urlPath;
      
      // Try browser-tests directory first
      let fullPath = path.join(__dirname, 'browser-tests', filePath);
      
      // Then try demo directory
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(__dirname, '../../demo', filePath);
      }
      
      // Then try extension demo
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(__dirname, '../../extension/demo', filePath);
      }
      
      // Then try extension dist (for demo-bootstrap.js etc)
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(__dirname, '../../extension/dist', filePath);
      }
      
      if (!fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end(`Not found: ${filePath}`);
        return;
      }
      
      const ext = path.extname(fullPath);
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      fs.readFile(fullPath, (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(content);
      });
    });
    
    server.listen(config.testServerPort, () => {
      console.log(`[server] Test server on http://localhost:${config.testServerPort}`);
      resolve({ server, testResultsPromise });
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[server] Port ${config.testServerPort} in use, trying next...`);
        config.testServerPort++;
        server.listen(config.testServerPort);
      } else {
        reject(err);
      }
    });
  });
}

// Check if extensions are built
function checkBuilds() {
  const harborManifest = path.join(config.harborExtPath, 'manifest.json');
  const webAgentsManifest = path.join(config.webAgentsExtPath, 'manifest.json');
  
  if (!fs.existsSync(harborManifest)) {
    console.error(`[error] Harbor extension not built at ${config.harborExtPath}`);
    console.error(`        Run: cd extension && npm run build:chrome`);
    process.exit(1);
  }
  
  if (!fs.existsSync(webAgentsManifest)) {
    console.error(`[error] Web Agents API extension not built at ${config.webAgentsExtPath}`);
    console.error(`        Run: cd web-agents-api && npm run build:chrome`);
    process.exit(1);
  }
  
  console.log('[build] ✓ Harbor extension ready (Chromium)');
  console.log('[build] ✓ Web Agents API extension ready (Chromium)');
}

// Launch Chromium with extensions using Playwright
async function launchBrowser(testUrl, testResultsPromise) {
  console.log(`[chromium] Launching with extensions...`);
  
  // Playwright Chromium supports loading extensions via --load-extension
  // We need to use launchPersistentContext for extensions to work
  const userDataDir = path.join(__dirname, '.playwright-profile');
  
  // Clean up old profile
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  
  // Launch with extensions
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Extensions require headed mode
    args: [
      `--disable-extensions-except=${config.harborExtPath},${config.webAgentsExtPath}`,
      `--load-extension=${config.harborExtPath},${config.webAgentsExtPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
  
  console.log('[chromium] ✓ Browser launched with extensions');
  
  // Get the first page or create one
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  
  // Navigate to the test page
  await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
  console.log(`[chromium] ✓ Navigated to: ${testUrl}`);
  
  // Wait for test results or timeout
  let results;
  try {
    results = await Promise.race([
      testResultsPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timed out')), config.timeout)
      )
    ]);
  } catch (err) {
    console.log(`\n[timeout] Test timed out after ${config.timeout/1000}s`);
    if (!config.keepOpen) {
      await context.close();
    }
    throw err;
  }
  
  if (!config.keepOpen) {
    await context.close();
    // Clean up profile
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  } else {
    console.log('\n[keep-open] Tests complete. Browser stays open for manual inspection.');
    console.log('[keep-open] Press Ctrl+C to exit.\n');
  }
  
  return results;
}

// Main
async function main() {
  console.log('🚢 Harbor E2E Browser Tests (Chromium)\n');
  
  // Check builds
  checkBuilds();
  
  // Start test server
  const { server, testResultsPromise } = await createTestServer();
  
  const testUrl = `http://localhost:${config.testServerPort}/test-runner.html`;
  
  try {
    console.log(`\n[test] Opening: ${testUrl}`);
    if (config.keepOpen) {
      console.log('[test] Keep-open mode: Browser will stay open for manual testing\n');
    }
    
    const results = await launchBrowser(testUrl, testResultsPromise);
    
    server.close();
    
    if (results.failed === 0) {
      console.log('\n✅ All browser tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some browser tests failed');
      process.exit(1);
    }
  } catch (err) {
    server.close();
    console.error('\n❌ Test error:', err.message);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n[interrupted] Cleaning up...');
  process.exit(130);
});

main();
