/**
 * Fixture for serving demo files during E2E tests.
 * 
 * Starts a local HTTP server to serve the demo/ directory,
 * allowing tests to navigate to demo pages.
 */

import { test as base } from '@playwright/test';
import { createServer, type Server } from 'http';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEMO_PATH = path.resolve(__dirname, '../../../demo');
const DEFAULT_PORT = 3456;

export type DemoServerFixtures = {
  demoServer: { url: string; port: number };
};

/**
 * Simple static file server
 */
function createStaticServer(rootDir: string): Server {
  return createServer(async (req, res) => {
    try {
      let filePath = path.join(rootDir, req.url || '/');
      
      // Handle directory requests
      let stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
      }
      
      if (!stat) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      
      // Determine content type
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
      };
      
      const contentType = contentTypes[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
    } catch (err) {
      console.error('Static server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });
}

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('net');
  
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      // Port in use, try next
      resolve(findAvailablePort(startPort + 1));
    });
    server.listen(startPort, () => {
      const address = server.address();
      const port = typeof address === 'object' ? address?.port : startPort;
      server.close(() => resolve(port || startPort));
    });
  });
}

export const test = base.extend<DemoServerFixtures>({
  /**
   * Start a demo server for the test
   */
  demoServer: async ({}, use) => {
    const port = await findAvailablePort(DEFAULT_PORT);
    const server = createStaticServer(DEMO_PATH);
    
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, () => {
        console.log(`Demo server listening on http://localhost:${port}`);
        resolve();
      });
    });

    await use({
      url: `http://localhost:${port}`,
      port,
    });

    // Cleanup
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  },
});

export { expect } from '@playwright/test';
