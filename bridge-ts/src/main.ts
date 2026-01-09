#!/usr/bin/env node
/**
 * Harbor Bridge - Native messaging bridge for Harbor Firefox extension.
 * 
 * This is the main entry point that runs the bridge loop,
 * reading messages from stdin and writing responses to stdout.
 * 
 * Architecture:
 * - Main bridge handles: Native messaging, MCP connections, LLM, Chat
 * - Catalog worker (separate process): Scraping, enrichment, database writes
 * - MCP runners (separate processes): Isolated MCP server connections
 * 
 * Special Modes (for pkg binary compatibility):
 * - --catalog-worker: Run as catalog worker process (forked by main bridge)
 * - --mcp-runner <serverId>: Run as isolated MCP server runner (forked by main bridge)
 * 
 * Enable worker architecture with: HARBOR_CATALOG_WORKER=1
 */

import { readMessages, writeMessage, log, NativeMessagingError, MessageTooLargeError, InvalidMessageError } from './native-messaging.js';
import { dispatchMessage, setCatalogClient } from './handlers.js';
import { Message } from './types.js';
import { warmExecutableCache } from './utils/resolve-executable.js';
import { getCatalogClient } from './catalog/client.js';

const VERSION = '0.1.0';
const USE_WORKER = process.env.HARBOR_CATALOG_WORKER === '1';

// Check for special worker modes (pkg binary compatibility)
const args = process.argv.slice(2);
const isCatalogWorker = args.includes('--catalog-worker');
const mcpRunnerIndex = args.indexOf('--mcp-runner');
const isMcpRunner = mcpRunnerIndex !== -1;
const mcpServerId = isMcpRunner ? args[mcpRunnerIndex + 1] : null;

async function runBridge(): Promise<void> {
  log(`Harbor Bridge v${VERSION} starting...`);
  
  // Warm up executable cache (find npx, node, etc.)
  warmExecutableCache();
  
  // Optionally start the catalog worker process
  if (USE_WORKER) {
    log('Starting catalog worker process...');
    const client = getCatalogClient({
      autoStart: true,
      onStatus: (status, data) => {
        log(`[CatalogWorker] ${status}: ${JSON.stringify(data)}`);
      },
    });
    setCatalogClient(client);
  }

  try {
    for await (const message of readMessages()) {
      try {
        log(`Received: type=${message.type}, request_id=${message.request_id}`);

        const response = await dispatchMessage(message as Message);
        writeMessage(response as Record<string, unknown>);

        log(`Sent: type=${response.type}`);
      } catch (error) {
        log(`Error processing message: ${error}`);
        
        if (error instanceof MessageTooLargeError) {
          writeMessage({
            type: 'error',
            request_id: '',
            error: {
              code: 'message_too_large',
              message: error.message,
            },
          });
        } else if (error instanceof InvalidMessageError) {
          writeMessage({
            type: 'error',
            request_id: '',
            error: {
              code: 'invalid_message',
              message: error.message,
            },
          });
        } else if (error instanceof NativeMessagingError) {
          // Connection error, break the loop
          break;
        } else {
          writeMessage({
            type: 'error',
            request_id: (message as Message).request_id || '',
            error: {
              code: 'internal_error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }
  } catch (error) {
    log(`Fatal error: ${error}`);
    if (error instanceof Error && error.message.includes('EOF')) {
      log('EOF received, shutting down');
    } else {
      throw error;
    }
  }

  log('Harbor Bridge shutting down');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('Interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Terminated');
  process.exit(0);
});

// ===========================================================================
// Entry Point - Handle different modes
// ===========================================================================

async function main(): Promise<void> {
  // Mode 1: Catalog Worker (forked by main bridge for pkg compatibility)
  if (isCatalogWorker) {
    log('[Main] Running in catalog worker mode');
    // Dynamically import and run the catalog worker
    const { runCatalogWorker } = await import('./catalog/worker.js');
    await runCatalogWorker();
    return;
  }

  // Mode 2: MCP Runner (forked by main bridge for process isolation)
  if (isMcpRunner && mcpServerId) {
    log(`[Main] Running in MCP runner mode for server: ${mcpServerId}`);
    // Dynamically import and run the MCP runner
    const { runMcpRunner } = await import('./mcp/runner.js');
    await runMcpRunner(mcpServerId);
    return;
  }

  // Mode 3: Main Bridge (default)
  await runBridge();
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
});

