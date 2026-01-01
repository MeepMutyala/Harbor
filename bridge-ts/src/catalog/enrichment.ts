/**
 * Catalog Enrichment - Adds popularity and metadata to discovered servers.
 * 
 * This module is responsible for enriching catalog entries with additional
 * metadata that isn't available from the primary discovery sources.
 * 
 * CURRENT ENRICHMENTS:
 * - GitHub stars (from repository URL)
 * - npm download counts (from package identifier)
 * - Last commit date (for freshness scoring)
 * 
 * DESIGN NOTES:
 * - This is intentionally a separate layer from discovery
 * - Can be run asynchronously after initial catalog load
 * - Can be disabled without affecting core functionality
 * - Easy to replace with a cloud-hosted enrichment service
 * 
 * FUTURE CONSIDERATIONS:
 * - Could cache enrichment data separately with longer TTL
 * - Could add user ratings/reviews
 * - Could add compatibility testing results
 * - Could integrate with a central Harbor API
 */

import { CatalogServer } from '../types.js';
import { log, pushStatus } from '../native-messaging.js';

export interface EnrichmentResult {
  serverId: string;
  githubStars?: number;
  npmDownloads?: number;
  lastCommitAt?: number;
  error?: string;
}

export interface EnrichmentStats {
  total: number;
  enriched: number;
  failed: number;
  duration: number;
}

/**
 * Abstract enricher interface.
 * 
 * Implement this to add new enrichment sources.
 */
export interface Enricher {
  id: string;
  name: string;
  
  /**
   * Enrich a single server with additional metadata.
   * Should be fast and handle errors gracefully.
   */
  enrich(server: CatalogServer): Promise<Partial<EnrichmentResult>>;
}

/**
 * GitHub Stars enricher.
 * 
 * Fetches star counts from GitHub API for servers with GitHub repos.
 * 
 * NOTE: GitHub API has rate limits (60 req/hr unauthenticated).
 * Consider adding a GitHub token for higher limits.
 */
export class GitHubStarsEnricher implements Enricher {
  id = 'github_stars';
  name = 'GitHub Stars';

  private cache = new Map<string, { stars: number; fetchedAt: number }>();
  private CACHE_TTL = 3600 * 1000; // 1 hour

  async enrich(server: CatalogServer): Promise<Partial<EnrichmentResult>> {
    const repoUrl = server.repositoryUrl || server.homepageUrl || '';
    
    // Extract owner/repo from GitHub URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return {};
    }

    const [, owner, repo] = match;
    const repoKey = `${owner}/${repo.replace(/\.git$/, '')}`;

    // Check cache
    const cached = this.cache.get(repoKey);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      return { githubStars: cached.stars };
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${repoKey}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Harbor-MCP-Catalog',
        },
      });

      if (!response.ok) {
        if (response.status === 403) {
          log(`[GitHubStarsEnricher] Rate limited for ${repoKey}`);
        }
        return {};
      }

      const data = await response.json() as { stargazers_count?: number; pushed_at?: string };
      const stars = data.stargazers_count || 0;
      const lastCommitAt = data.pushed_at ? new Date(data.pushed_at).getTime() : undefined;

      // Update cache
      this.cache.set(repoKey, { stars, fetchedAt: Date.now() });

      return {
        githubStars: stars,
        lastCommitAt,
      };
    } catch (error) {
      log(`[GitHubStarsEnricher] Failed for ${repoKey}: ${error}`);
      return { error: String(error) };
    }
  }
}

/**
 * npm Downloads enricher.
 * 
 * Fetches weekly download counts from npm registry.
 */
export class NpmDownloadsEnricher implements Enricher {
  id = 'npm_downloads';
  name = 'npm Downloads';

  private cache = new Map<string, { downloads: number; fetchedAt: number }>();
  private CACHE_TTL = 3600 * 1000; // 1 hour

  async enrich(server: CatalogServer): Promise<Partial<EnrichmentResult>> {
    // Find npm package identifier
    const npmPackage = server.packages?.find(p => p.registryType === 'npm');
    if (!npmPackage?.identifier) {
      return {};
    }

    const packageName = npmPackage.identifier;

    // Check cache
    const cached = this.cache.get(packageName);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      return { npmDownloads: cached.downloads };
    }

    try {
      const response = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`
      );

      if (!response.ok) {
        return {};
      }

      const data = await response.json() as { downloads?: number };
      const downloads = data.downloads || 0;

      // Update cache
      this.cache.set(packageName, { downloads, fetchedAt: Date.now() });

      return { npmDownloads: downloads };
    } catch (error) {
      log(`[NpmDownloadsEnricher] Failed for ${packageName}: ${error}`);
      return { error: String(error) };
    }
  }
}

/**
 * Enrichment Manager - orchestrates all enrichers.
 * 
 * This is the main entry point for enriching catalog data.
 * Can run enrichment in batches to avoid rate limits.
 */
export class EnrichmentManager {
  private enrichers: Enricher[] = [];
  private results = new Map<string, EnrichmentResult>();

  constructor() {
    // Register default enrichers
    // Can be disabled or replaced by calling removeEnricher()
    this.addEnricher(new GitHubStarsEnricher());
    this.addEnricher(new NpmDownloadsEnricher());
  }

  addEnricher(enricher: Enricher): void {
    this.enrichers.push(enricher);
    log(`[EnrichmentManager] Added enricher: ${enricher.id}`);
  }

  removeEnricher(enricherId: string): void {
    this.enrichers = this.enrichers.filter(e => e.id !== enricherId);
    log(`[EnrichmentManager] Removed enricher: ${enricherId}`);
  }

  getEnrichers(): Enricher[] {
    return [...this.enrichers];
  }

  /**
   * Enrich a batch of servers.
   * 
   * @param servers - Servers to enrich
   * @param options - Enrichment options
   * @returns Stats about the enrichment run
   */
  async enrichBatch(
    servers: CatalogServer[],
    options: {
      /** Maximum concurrent enrichments */
      concurrency?: number;
      /** Delay between batches (ms) to avoid rate limits */
      batchDelay?: number;
      /** Only enrich servers missing enrichment data */
      onlyMissing?: boolean;
      /** Send progress updates */
      reportProgress?: boolean;
    } = {}
  ): Promise<EnrichmentStats> {
    const { concurrency = 5, batchDelay = 100, onlyMissing = false, reportProgress = true } = options;
    const startTime = Date.now();
    let enrichedCount = 0;
    let failedCount = 0;

    // Filter servers if needed
    const toEnrich = onlyMissing
      ? servers.filter(s => !this.results.has(s.id))
      : servers;

    log(`[EnrichmentManager] Enriching ${toEnrich.length} servers with ${this.enrichers.length} enrichers`);

    // Process in batches
    for (let i = 0; i < toEnrich.length; i += concurrency) {
      const batch = toEnrich.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      const totalBatches = Math.ceil(toEnrich.length / concurrency);
      
      // Report progress every batch
      if (reportProgress) {
        const progress = Math.round((i / toEnrich.length) * 100);
        pushStatus('catalog', 'enriching_progress', {
          message: `Enriching: ${i}/${toEnrich.length} (${progress}%)`,
          current: i,
          total: toEnrich.length,
          batch: batchNum,
          totalBatches,
        });
      }
      
      const batchResults = await Promise.allSettled(
        batch.map(server => this.enrichServer(server))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled' && result.value) {
          if (!result.value.error) {
            enrichedCount++;
          } else {
            failedCount++;
          }
        } else {
          failedCount++;
        }
      }

      // Rate limit delay between batches
      if (i + concurrency < toEnrich.length && batchDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    const stats = {
      total: toEnrich.length,
      enriched: enrichedCount,
      failed: failedCount,
      duration: Date.now() - startTime,
    };

    log(`[EnrichmentManager] Done: ${enrichedCount}/${toEnrich.length} enriched in ${stats.duration}ms`);
    return stats;
  }

  /**
   * Enrich a single server with all enrichers.
   */
  async enrichServer(server: CatalogServer): Promise<EnrichmentResult> {
    const result: EnrichmentResult = { serverId: server.id };

    for (const enricher of this.enrichers) {
      try {
        const partial = await enricher.enrich(server);
        Object.assign(result, partial);
      } catch (error) {
        log(`[EnrichmentManager] ${enricher.id} failed for ${server.id}: ${error}`);
      }
    }

    this.results.set(server.id, result);
    return result;
  }

  /**
   * Get enrichment result for a server.
   */
  getResult(serverId: string): EnrichmentResult | undefined {
    return this.results.get(serverId);
  }

  /**
   * Compute a popularity score from enrichment data.
   * 
   * This can be customized to weight different factors.
   */
  computePopularityScore(result: EnrichmentResult): number {
    let score = 0;

    // GitHub stars: logarithmic scale (1000 stars = ~300 points)
    if (result.githubStars) {
      score += Math.floor(Math.log10(result.githubStars + 1) * 100);
    }

    // npm downloads: logarithmic scale (10k downloads/week = ~400 points)
    if (result.npmDownloads) {
      score += Math.floor(Math.log10(result.npmDownloads + 1) * 100);
    }

    // Freshness bonus: recent commits get up to 50 points
    if (result.lastCommitAt) {
      const daysAgo = (Date.now() - result.lastCommitAt) / (1000 * 60 * 60 * 24);
      if (daysAgo < 7) score += 50;
      else if (daysAgo < 30) score += 25;
      else if (daysAgo < 90) score += 10;
    }

    return score;
  }

  /**
   * Clear all cached results.
   */
  clearCache(): void {
    this.results.clear();
    log('[EnrichmentManager] Cache cleared');
  }
}

// Singleton instance
let _manager: EnrichmentManager | null = null;

export function getEnrichmentManager(): EnrichmentManager {
  if (!_manager) {
    _manager = new EnrichmentManager();
  }
  return _manager;
}

/**
 * Reset the enrichment manager (useful for testing).
 */
export function resetEnrichmentManager(): void {
  _manager = null;
}

