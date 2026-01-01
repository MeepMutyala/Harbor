/**
 * Catalog module exports.
 * 
 * Architecture Overview:
 * 
 * 1. DISCOVERY LAYER (providers)
 *    - CatalogProvider: Base interface for all data sources
 *    - OfficialRegistryProvider: Fetches from MCP registry API
 *    - GitHubAwesomeProvider: Scrapes awesome-mcp-servers README
 *    - ProviderRegistry: Manages and orchestrates all providers
 * 
 * 2. ENRICHMENT LAYER
 *    - EnrichmentManager: Adds popularity data (GitHub stars, npm downloads)
 *    - Can be disabled or replaced with cloud service
 * 
 * 3. STORAGE LAYER
 *    - CatalogDatabase: SQLite with Drizzle ORM
 *    - Handles persistence, search, and caching
 * 
 * 4. ORCHESTRATION
 *    - CatalogManager: Coordinates discovery, enrichment, and storage
 * 
 * To add a new provider:
 *   const registry = getProviderRegistry();
 *   registry.register(new MyCustomProvider());
 * 
 * To disable enrichment:
 *   const enrichment = getEnrichmentManager();
 *   enrichment.removeEnricher('github_stars');
 */

// Base types and interfaces
export { CatalogProvider, ProviderResult, generateServerId } from './base.js';

// Storage layer
export { CatalogDatabase, getCatalogDb, ServerChange } from './database.js';
export * as schema from './schema.js';

// Discovery layer - providers
export { OfficialRegistryProvider } from './official-registry.js';
export { GitHubAwesomeProvider } from './github-awesome.js';
export { ProviderRegistry, getProviderRegistry, resetProviderRegistry } from './provider-registry.js';

// Enrichment layer
export { 
  EnrichmentManager, 
  getEnrichmentManager, 
  resetEnrichmentManager,
  Enricher,
  GitHubStarsEnricher,
  NpmDownloadsEnricher,
} from './enrichment.js';

// Orchestration layer
export { CatalogManager, getCatalogManager } from './manager.js';

// Worker architecture (separate process)
export { CatalogClient, getCatalogClient, resetCatalogClient, WorkerStatus } from './client.js';
// Note: worker.ts is not exported - it runs as a separate process

