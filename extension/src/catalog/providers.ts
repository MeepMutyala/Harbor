// Catalog providers for Harbor Directory

import { 
  CatalogServer, 
  CatalogSourceId, 
  ProviderStatus,
  CacheEntry,
  CACHE_KEYS,
  CACHE_TTL_MS,
  generateServerId,
  findKnownRemoteEndpoint,
  dedupeServers,
} from './types';
import browser from 'webextension-polyfill';

// Base provider interface
export interface CatalogProvider {
  id: CatalogSourceId;
  name: string;
  fetch(): Promise<CatalogServer[]>;
}

// Registry API types
interface RegistryServerEntry {
  server: {
    name: string;
    description?: string;
    repository?: string;
    homepage?: string;
    packages?: Array<{
      transport?: string | string[];
      registry_config?: {
        url?: string;
      };
    }>;
    [key: string]: unknown;
  };
  _meta?: unknown;
}

interface RegistryResponse {
  servers: RegistryServerEntry[];
  cursor?: string;
}

/**
 * Official MCP Registry Provider
 * Source of truth for MCP servers
 */
export class OfficialRegistryProvider implements CatalogProvider {
  id: CatalogSourceId = 'official_registry';
  name = 'Official MCP Registry';
  
  private baseUrl = 'https://registry.modelcontextprotocol.io';

  async fetch(): Promise<CatalogServer[]> {
    const servers: CatalogServer[] = [];
    let cursor: string | undefined;
    const limit = 100;
    const maxEntries = 500;
    const now = Date.now();

    try {
      do {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) {
          params.set('cursor', cursor);
        }

        const url = `${this.baseUrl}/v0/servers?${params}`;
        console.log(`[${this.name}] Fetching: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: RegistryResponse = await response.json();
        
        for (const entry of data.servers || []) {
          const server = this.parseEntry(entry, now);
          if (server) {
            servers.push(server);
          }
        }

        cursor = data.cursor;
      } while (cursor && servers.length < maxEntries);

      console.log(`[${this.name}] Fetched ${servers.length} servers`);
    } catch (error) {
      console.error(`[${this.name}] Fetch error:`, error);
      throw error;
    }

    return servers;
  }

  private parseEntry(entry: RegistryServerEntry, fetchedAt: number): CatalogServer | null {
    const { server } = entry;
    if (!server?.name) return null;

    let endpointUrl = '';
    const tags: string[] = [];

    // Try to find a remote endpoint URL from packages
    if (server.packages && Array.isArray(server.packages)) {
      for (const pkg of server.packages) {
        const transports = Array.isArray(pkg.transport) 
          ? pkg.transport 
          : (typeof pkg.transport === 'string' ? [pkg.transport] : []);
        
        const hasRemoteTransport = transports.some(
          (t: string) => t === 'sse' || t === 'http' || t === 'streamable-http'
        );
        
        if (hasRemoteTransport && pkg.registry_config?.url) {
          endpointUrl = pkg.registry_config.url;
          break;
        }
      }
    }

    // Check known remote endpoints
    if (!endpointUrl) {
      const known = findKnownRemoteEndpoint(server.name);
      if (known) {
        endpointUrl = known.url;
        if (known.tags) tags.push(...known.tags);
      }
    }

    const installableOnly = !endpointUrl;
    if (installableOnly) {
      tags.push('installable_only');
    } else {
      tags.push('remote');
    }

    return {
      id: generateServerId(this.id, endpointUrl, server.repository || server.homepage || '', server.name),
      name: server.name,
      endpointUrl,
      installableOnly,
      description: server.description,
      homepageUrl: server.repository || server.homepage,
      tags,
      source: this.id,
      fetchedAt,
    };
  }
}

/**
 * GitHub Awesome MCP Servers Provider
 * Best-effort parsing of community-curated list
 */
export class GitHubAwesomeProvider implements CatalogProvider {
  id: CatalogSourceId = 'github_awesome';
  name = 'GitHub Awesome MCP';
  
  private rawUrl = 'https://raw.githubusercontent.com/wong2/awesome-mcp-servers/main/README.md';

  async fetch(): Promise<CatalogServer[]> {
    const now = Date.now();

    try {
      console.log(`[${this.name}] Fetching: ${this.rawUrl}`);
      const response = await fetch(this.rawUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const markdown = await response.text();
      const servers = this.parseMarkdown(markdown, now);
      console.log(`[${this.name}] Parsed ${servers.length} servers`);
      return servers;
    } catch (error) {
      console.error(`[${this.name}] Fetch error:`, error);
      throw error;
    }
  }

  private parseMarkdown(markdown: string, fetchedAt: number): CatalogServer[] {
    const servers: CatalogServer[] = [];
    const lines = markdown.split('\n');
    
    let inRelevantSection = false;
    let currentSection = '';

    // Match markdown links: [text](url) or **[text](url)** - description
    const linkPattern = /^\s*[-*]\s*\*{0,2}\[([^\]]+)\]\(([^)]+)\)\*{0,2}\s*[-–—:]?\s*(.*)/;
    
    for (const line of lines) {
      // Track section headers
      if (line.startsWith('#')) {
        const headerMatch = line.match(/^#+\s+(.+)/);
        if (headerMatch) {
          currentSection = headerMatch[1].toLowerCase();
          inRelevantSection = 
            currentSection.includes('server') ||
            currentSection.includes('official') ||
            currentSection.includes('tool') ||
            currentSection.includes('resource');
        }
        continue;
      }

      if (!inRelevantSection) continue;

      const match = line.match(linkPattern);
      if (match) {
        const [, name, href, rest] = match;
        
        // Clean up description
        let description = rest
          .replace(/!\[.*?\]\([^)]*\)/g, '') // Remove image badges
          .replace(/\[.*?\]\([^)]*\)/g, '') // Remove additional links
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/\s+/g, ' ')
          .trim();

        // Skip navigation items
        if (name.toLowerCase().includes('table of contents')) continue;
        if (name.toLowerCase().includes('contributing')) continue;
        if (!href.startsWith('http')) continue;

        // Check known remote endpoints
        const known = findKnownRemoteEndpoint(name);
        const endpointUrl = known?.url || '';
        const tags: string[] = known?.tags || [];
        
        if (!endpointUrl) {
          tags.push('installable_only');
        } else {
          tags.push('remote');
        }

        servers.push({
          id: generateServerId(this.id, endpointUrl, href, name.trim()),
          name: name.trim(),
          endpointUrl,
          installableOnly: !endpointUrl,
          description,
          homepageUrl: href,
          tags,
          source: this.id,
          fetchedAt,
        });
      }
    }

    return servers;
  }
}

/**
 * Featured/Curated Provider
 * Curated list of popular servers from mcpservers.org and mcp.so
 * These are servers known to have remote endpoints or be particularly popular
 */
export class FeaturedCuratedProvider implements CatalogProvider {
  id: CatalogSourceId = 'featured_curated';
  name = 'Featured & Popular';

  // Curated list from mcpservers.org featured section and mcp.so
  private readonly featuredServers: Array<{
    name: string;
    description: string;
    endpointUrl?: string;
    homepageUrl: string;
    tags: string[];
  }> = [
    // Remote servers with known endpoints
    {
      name: '1mcpserver',
      description: 'MCP of MCPs - Automatic discovery and configure MCP servers. Fully remote.',
      endpointUrl: 'https://mcp.1mcpserver.com/mcp/',
      homepageUrl: 'https://github.com/particlefuture/1mcpserver',
      tags: ['featured', 'remote', 'meta', 'discovery'],
    },
    {
      name: 'Alpha Vantage',
      description: 'Financial market data: realtime & historical stock, ETF, options, forex, crypto, commodities, fundamentals, technical indicators.',
      endpointUrl: 'https://mcp.alphavantage.co/',
      homepageUrl: 'https://mcp.alphavantage.co/',
      tags: ['featured', 'remote', 'finance', 'stocks', 'crypto'],
    },
    {
      name: 'Audioscrape',
      description: 'Search 1M+ hours of podcasts, interviews, talks with speaker identification and timestamps.',
      endpointUrl: 'https://mcp.audioscrape.com',
      homepageUrl: 'https://www.audioscrape.com/docs/mcp',
      tags: ['featured', 'remote', 'audio', 'podcasts', 'search'],
    },
    {
      name: 'Mercado Libre',
      description: 'Official Mercado Libre MCP server - interact with the marketplace, search products.',
      endpointUrl: 'https://mcp.mercadolibre.com/',
      homepageUrl: 'https://mcp.mercadolibre.com/',
      tags: ['featured', 'remote', 'ecommerce', 'marketplace'],
    },
    {
      name: 'Mercado Pago',
      description: 'Official Mercado Pago MCP server - payments API integration.',
      endpointUrl: 'https://mcp.mercadopago.com/',
      homepageUrl: 'https://mcp.mercadopago.com/',
      tags: ['featured', 'remote', 'payments', 'fintech'],
    },
    {
      name: 'Pearl',
      description: 'Connect your AI Agents with 12,000+ certified experts instantly.',
      endpointUrl: 'https://mcp.pearl.com',
      homepageUrl: 'https://mcp.pearl.com',
      tags: ['featured', 'remote', 'experts', 'consulting'],
    },
    {
      name: 'DeepWiki by Devin',
      description: 'Remote, no-auth MCP server providing AI-powered codebase context and answers.',
      endpointUrl: 'https://mcp.deepwiki.com',
      homepageUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
      tags: ['featured', 'remote', 'docs', 'code', 'ai'],
    },
    {
      name: 'Context7',
      description: 'Up-to-date documentation for any Cursor prompt.',
      endpointUrl: 'https://mcp.context7.com',
      homepageUrl: 'https://context7.com',
      tags: ['featured', 'remote', 'docs', 'cursor'],
    },
    // Popular servers from mcpservers.org (may not have remote endpoints)
    {
      name: 'Bright Data',
      description: 'Discover, extract, and interact with the web - one interface powering automated access across the public internet.',
      homepageUrl: 'https://github.com/brightdata/brightdata-mcp',
      tags: ['featured', 'sponsor', 'web', 'scraping', 'data'],
    },
    {
      name: 'Browserbase',
      description: 'Automate browser interactions in the cloud (web navigation, data extraction, form filling).',
      homepageUrl: 'https://github.com/browserbase/mcp-server-browserbase',
      tags: ['featured', 'official', 'browser', 'automation', 'cloud'],
    },
    {
      name: 'Cloudflare',
      description: 'Deploy, configure & interrogate your resources on the Cloudflare developer platform (Workers/KV/R2/D1).',
      homepageUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
      tags: ['featured', 'official', 'cloud', 'serverless', 'workers'],
    },
    {
      name: 'E2B',
      description: 'Run code in secure sandboxes hosted by E2B.',
      homepageUrl: 'https://github.com/e2b-dev/mcp-server',
      tags: ['featured', 'official', 'code', 'sandbox', 'execution'],
    },
    {
      name: 'Exa',
      description: 'Search Engine made for AIs by Exa.',
      homepageUrl: 'https://github.com/exa-labs/exa-mcp-server',
      tags: ['featured', 'official', 'search', 'ai'],
    },
    {
      name: 'Firecrawl',
      description: 'Powerful web scraping and search capabilities for LLM clients like Cursor and Claude.',
      homepageUrl: 'https://github.com/mendableai/firecrawl-mcp-server',
      tags: ['featured', 'official', 'scraping', 'search', 'web'],
    },
    {
      name: 'Playwright',
      description: 'Playwright MCP server for browser automation and testing.',
      homepageUrl: 'https://github.com/executeautomation/mcp-playwright',
      tags: ['featured', 'official', 'browser', 'testing', 'automation'],
    },
    {
      name: 'Supabase',
      description: 'Connect to Supabase platform for database, auth, edge functions and more.',
      homepageUrl: 'https://github.com/supabase/mcp-server-supabase',
      tags: ['featured', 'official', 'database', 'auth', 'backend'],
    },
    {
      name: 'Google MCP Servers',
      description: 'Collection of Google\'s official MCP servers.',
      homepageUrl: 'https://github.com/GoogleCloudPlatform/mcp-servers',
      tags: ['featured', 'official', 'google', 'cloud'],
    },
    {
      name: 'Kaggle MCP',
      description: 'Access Kaggle\'s datasets, models, competitions, notebooks and benchmarks.',
      homepageUrl: 'https://github.com/Kaggle/kaggle-mcp',
      tags: ['featured', 'official', 'data', 'ml', 'datasets'],
    },
    {
      name: 'Chrome DevTools MCP',
      description: 'Let your coding agent control and inspect a live Chrome browser.',
      homepageUrl: 'https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-chrome-devtools',
      tags: ['featured', 'official', 'browser', 'devtools', 'debugging'],
    },
  ];

  async fetch(): Promise<CatalogServer[]> {
    const now = Date.now();
    console.log(`[${this.name}] Returning ${this.featuredServers.length} curated servers`);
    
    return this.featuredServers.map(server => ({
      id: generateServerId(this.id, server.endpointUrl || '', server.homepageUrl, server.name),
      name: server.name,
      endpointUrl: server.endpointUrl || '',
      installableOnly: !server.endpointUrl,
      description: server.description,
      homepageUrl: server.homepageUrl,
      tags: server.tags,
      source: this.id,
      fetchedAt: now,
    }));
  }
}

/**
 * Catalog Manager - coordinates all providers
 */
export class CatalogManager {
  private providers: CatalogProvider[];

  constructor() {
    this.providers = [
      new OfficialRegistryProvider(),
      new GitHubAwesomeProvider(),
      new FeaturedCuratedProvider(),
    ];
  }

  /**
   * Get cached data for a provider, or null if expired/missing
   */
  private async getCached(providerId: CatalogSourceId): Promise<CacheEntry | null> {
    try {
      const key = CACHE_KEYS[providerId];
      const result = await browser.storage.local.get(key);
      const entry = result[key] as CacheEntry | undefined;
      
      if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
        return entry;
      }
    } catch (e) {
      console.warn(`Cache read error for ${providerId}:`, e);
    }
    return null;
  }

  /**
   * Save cache for a provider
   */
  private async setCache(providerId: CatalogSourceId, servers: CatalogServer[]): Promise<void> {
    try {
      const key = CACHE_KEYS[providerId];
      const entry: CacheEntry = {
        servers,
        fetchedAt: Date.now(),
      };
      await browser.storage.local.set({ [key]: entry });
    } catch (e) {
      console.warn(`Cache write error for ${providerId}:`, e);
    }
  }

  /**
   * Fetch from a single provider (with caching)
   */
  private async fetchProvider(
    provider: CatalogProvider, 
    force: boolean
  ): Promise<{ servers: CatalogServer[]; status: ProviderStatus }> {
    // Check cache first (unless forced)
    if (!force) {
      const cached = await this.getCached(provider.id);
      if (cached) {
        return {
          servers: cached.servers,
          status: {
            id: provider.id,
            ok: true,
            fetchedAt: cached.fetchedAt,
            count: cached.servers.length,
          },
        };
      }
    }

    // Fetch fresh data
    try {
      const servers = await provider.fetch();
      await this.setCache(provider.id, servers);
      
      return {
        servers,
        status: {
          id: provider.id,
          ok: true,
          fetchedAt: Date.now(),
          count: servers.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      
      return {
        servers: [],
        status: {
          id: provider.id,
          ok: false,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Get all catalog servers (aggregated from all providers)
   */
  async getAll(force = false): Promise<{
    servers: CatalogServer[];
    providerStatus: ProviderStatus[];
    fetchedAt: number;
  }> {
    const results = await Promise.all(
      this.providers.map(p => this.fetchProvider(p, force))
    );

    const allServers: CatalogServer[] = [];
    const providerStatus: ProviderStatus[] = [];

    for (const result of results) {
      allServers.push(...result.servers);
      providerStatus.push(result.status);
    }

    // Dedupe and sort
    const deduped = dedupeServers(allServers);
    
    // Sort: remote first, then by name
    deduped.sort((a, b) => {
      if (!a.installableOnly && b.installableOnly) return -1;
      if (a.installableOnly && !b.installableOnly) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      servers: deduped,
      providerStatus,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Search servers by query
   */
  async search(query: string, force = false): Promise<{
    servers: CatalogServer[];
    providerStatus: ProviderStatus[];
    fetchedAt: number;
  }> {
    const result = await this.getAll(force);
    
    if (!query.trim()) {
      return result;
    }

    const q = query.toLowerCase().trim();
    const filtered = result.servers.filter(s => 
      s.name.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q)) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );

    return {
      ...result,
      servers: filtered,
    };
  }

  /**
   * Clear all caches
   */
  async clearCaches(): Promise<void> {
    const keys = Object.values(CACHE_KEYS);
    await browser.storage.local.remove(keys);
  }
}

// Singleton instance
export const catalogManager = new CatalogManager();

