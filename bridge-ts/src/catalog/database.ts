/**
 * SQLite database for persistent catalog storage.
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { CatalogServer } from '../types.js';
import { log } from '../native-messaging.js';

const DB_DIR = join(homedir(), '.harbor');
const DB_PATH = join(DB_DIR, 'catalog.db');

// Priority scoring weights
const SCORE_REMOTE_ENDPOINT = 1000;
const SCORE_REMOTE_CAPABLE = 400;
const SCORE_FEATURED = 500;
const SCORE_OFFICIAL_TAG = 300;
const SCORE_OFFICIAL_SOURCE = 200;
const SCORE_HAS_DESCRIPTION = 50;
const SCORE_HAS_REPO = 25;
const SCORE_RECENT_UPDATE = 100;

// Staleness thresholds
const STALE_THRESHOLD_HOURS = 1;

export interface ServerChange {
  serverId: string;
  changeType: 'added' | 'updated' | 'removed' | 'restored';
  fieldChanges?: Record<string, unknown>;
}

function computePriorityScore(
  endpointUrl: string,
  source: string,
  isFeatured: boolean,
  description: string,
  repositoryUrl: string,
  tags: string[],
  popularityScore: number = 0,
  lastUpdatedAt?: number
): number {
  let score = 0;

  // Remote endpoint is most important
  if (endpointUrl) {
    score += SCORE_REMOTE_ENDPOINT;
  } else if (tags.includes('remote_capable')) {
    score += SCORE_REMOTE_CAPABLE;
  }

  // Featured servers
  if (isFeatured || tags.includes('featured')) {
    score += SCORE_FEATURED;
  }

  // Official tag
  if (tags.includes('official')) {
    score += SCORE_OFFICIAL_TAG;
  }

  // Official registry gets priority
  if (source === 'official_registry') {
    score += SCORE_OFFICIAL_SOURCE;
  }

  // Has useful metadata
  if (description) {
    score += SCORE_HAS_DESCRIPTION;
  }
  if (repositoryUrl) {
    score += SCORE_HAS_REPO;
  }

  // Popularity (cap at 500)
  score += Math.min(popularityScore, 500);

  // Recent updates
  if (lastUpdatedAt) {
    const daysAgo = (Date.now() - lastUpdatedAt) / 86400000;
    if (daysAgo < 7) {
      score += SCORE_RECENT_UPDATE;
    }
  }

  return score;
}

export class CatalogDatabase {
  private db: Database.Database;

  constructor() {
    mkdirSync(DB_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.initDatabase();
    log('[CatalogDatabase] Initialized');
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        endpoint_url TEXT DEFAULT '',
        installable_only INTEGER DEFAULT 1,
        description TEXT DEFAULT '',
        homepage_url TEXT DEFAULT '',
        repository_url TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        packages TEXT DEFAULT '[]',
        
        first_seen_at REAL NOT NULL,
        last_seen_at REAL NOT NULL,
        last_updated_at REAL,
        
        is_removed INTEGER DEFAULT 0,
        removed_at REAL,
        
        is_featured INTEGER DEFAULT 0,
        popularity_score INTEGER DEFAULT 0,
        priority_score INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_servers_source ON servers(source);
      CREATE INDEX IF NOT EXISTS idx_servers_priority ON servers(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_servers_removed ON servers(is_removed);
      CREATE INDEX IF NOT EXISTS idx_servers_endpoint ON servers(endpoint_url);

      CREATE TABLE IF NOT EXISTS provider_status (
        provider_id TEXT PRIMARY KEY,
        provider_name TEXT NOT NULL,
        last_fetch_at REAL,
        last_success_at REAL,
        last_error TEXT,
        server_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  getAllServers(options: {
    includeRemoved?: boolean;
    remoteOnly?: boolean;
    source?: string;
    limit?: number;
  } = {}): CatalogServer[] {
    let query = 'SELECT * FROM servers WHERE 1=1';
    const params: unknown[] = [];

    if (!options.includeRemoved) {
      query += ' AND is_removed = 0';
    }

    if (options.remoteOnly) {
      query += " AND endpoint_url != ''";
    }

    if (options.source) {
      query += ' AND source = ?';
      params.push(options.source);
    }

    query += ' ORDER BY priority_score DESC, name ASC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map(row => this.rowToServer(row));
  }

  searchServers(query: string, limit: number = 100): CatalogServer[] {
    const searchTerm = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM servers 
      WHERE is_removed = 0 
        AND (name LIKE ? OR description LIKE ?)
      ORDER BY priority_score DESC
      LIMIT ?
    `);

    const rows = stmt.all(searchTerm, searchTerm, limit) as Record<string, unknown>[];
    return rows.map(row => this.rowToServer(row));
  }

  upsertServers(servers: CatalogServer[], source: string): ServerChange[] {
    const changes: ServerChange[] = [];
    const now = Date.now();

    const selectStmt = this.db.prepare('SELECT * FROM servers WHERE id = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO servers (
        id, name, source, endpoint_url, installable_only,
        description, homepage_url, repository_url, tags, packages,
        first_seen_at, last_seen_at, last_updated_at,
        is_featured, popularity_score, priority_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = this.db.prepare(`
      UPDATE servers SET
        name = ?,
        endpoint_url = ?,
        installable_only = ?,
        description = ?,
        homepage_url = ?,
        repository_url = ?,
        tags = ?,
        packages = ?,
        last_seen_at = ?,
        last_updated_at = ?,
        is_removed = 0,
        removed_at = NULL,
        is_featured = ?,
        popularity_score = ?,
        priority_score = ?
      WHERE id = ?
    `);

    for (const server of servers) {
      const existing = selectStmt.get(server.id) as Record<string, unknown> | undefined;
      
      const tags = server.tags;
      const tagsJson = JSON.stringify(tags);
      const packagesJson = JSON.stringify(server.packages);
      
      const priority = computePriorityScore(
        server.endpointUrl,
        source,
        server.isFeatured || false,
        server.description,
        server.repositoryUrl,
        tags,
        0,
        now
      );

      if (!existing) {
        // New server
        insertStmt.run(
          server.id,
          server.name,
          source,
          server.endpointUrl,
          server.installableOnly ? 1 : 0,
          server.description,
          server.homepageUrl,
          server.repositoryUrl,
          tagsJson,
          packagesJson,
          now, now, now,
          server.isFeatured ? 1 : 0,
          0,
          priority
        );
        changes.push({ serverId: server.id, changeType: 'added' });
      } else {
        // Existing server - check for changes
        const wasRemoved = existing.is_removed as number;
        const fieldChanges: Record<string, unknown> = {};

        if (existing.name !== server.name) {
          fieldChanges.name = server.name;
        }
        if (existing.endpoint_url !== server.endpointUrl) {
          fieldChanges.endpointUrl = server.endpointUrl;
        }
        if (existing.description !== server.description) {
          fieldChanges.description = server.description;
        }

        const hasChanges = Object.keys(fieldChanges).length > 0;

        updateStmt.run(
          server.name,
          server.endpointUrl,
          server.installableOnly ? 1 : 0,
          server.description,
          server.homepageUrl,
          server.repositoryUrl,
          tagsJson,
          packagesJson,
          now,
          hasChanges ? now : existing.last_updated_at,
          server.isFeatured ? 1 : 0,
          0,
          priority,
          server.id
        );

        if (wasRemoved) {
          changes.push({ serverId: server.id, changeType: 'restored' });
        } else if (hasChanges) {
          changes.push({ serverId: server.id, changeType: 'updated', fieldChanges });
        }
      }
    }

    return changes;
  }

  markRemoved(source: string, seenIds: Set<string>): ServerChange[] {
    const changes: ServerChange[] = [];
    const now = Date.now();

    // Find servers from this source that weren't seen
    const placeholders = seenIds.size > 0 
      ? Array(seenIds.size).fill('?').join(',')
      : "''";
    
    const selectStmt = this.db.prepare(`
      SELECT id FROM servers 
      WHERE source = ? AND is_removed = 0 AND id NOT IN (${placeholders})
    `);

    const updateStmt = this.db.prepare(`
      UPDATE servers SET is_removed = 1, removed_at = ?
      WHERE id = ?
    `);

    const rows = selectStmt.all(source, ...seenIds) as Array<{ id: string }>;

    for (const row of rows) {
      updateStmt.run(now, row.id);
      changes.push({ serverId: row.id, changeType: 'removed' });
    }

    return changes;
  }

  updateProviderStatus(
    providerId: string,
    providerName: string,
    success: boolean,
    serverCount: number = 0,
    error: string | null = null
  ): void {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO provider_status (provider_id, provider_name, last_fetch_at, last_success_at, last_error, server_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        last_fetch_at = ?,
        last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
        last_error = ?,
        server_count = CASE WHEN ? THEN ? ELSE server_count END
    `);

    stmt.run(
      providerId, providerName, now,
      success ? now : null,
      error, serverCount,
      now,
      success ? 1 : 0, now,
      error,
      success ? 1 : 0, serverCount
    );
  }

  getProviderStatus(): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM provider_status');
    return stmt.all() as Array<Record<string, unknown>>;
  }

  isCacheStale(): boolean {
    const threshold = Date.now() - (STALE_THRESHOLD_HOURS * 3600 * 1000);

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM provider_status
      WHERE last_success_at IS NULL OR last_success_at < ?
    `);

    const row = stmt.get(threshold) as { cnt: number } | undefined;
    return row ? row.cnt > 0 : true;
  }

  getStats(): { total: number; remote: number; removed: number; featured: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN endpoint_url != '' THEN 1 ELSE 0 END) as remote,
        SUM(CASE WHEN is_removed = 1 THEN 1 ELSE 0 END) as removed,
        SUM(CASE WHEN is_featured = 1 THEN 1 ELSE 0 END) as featured
      FROM servers
    `);
    
    const row = stmt.get() as Record<string, number> | undefined;
    return {
      total: row?.total || 0,
      remote: row?.remote || 0,
      removed: row?.removed || 0,
      featured: row?.featured || 0,
    };
  }

  private rowToServer(row: Record<string, unknown>): CatalogServer {
    let packages: CatalogServer['packages'] = [];
    try {
      const packagesStr = row.packages as string;
      if (packagesStr) {
        packages = JSON.parse(packagesStr);
      }
    } catch {
      // Ignore parse errors
    }

    let tags: string[] = [];
    try {
      const tagsStr = row.tags as string;
      if (tagsStr) {
        tags = JSON.parse(tagsStr);
      }
    } catch {
      // Ignore parse errors
    }

    return {
      id: row.id as string,
      name: row.name as string,
      source: row.source as string,
      endpointUrl: row.endpoint_url as string,
      installableOnly: Boolean(row.installable_only),
      packages,
      description: row.description as string,
      homepageUrl: row.homepage_url as string,
      repositoryUrl: row.repository_url as string,
      tags,
      fetchedAt: (row.last_seen_at as number) || Date.now(),
      isRemoved: Boolean(row.is_removed),
      isFeatured: Boolean(row.is_featured),
      priorityScore: row.priority_score as number || 0,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
let _db: CatalogDatabase | null = null;

export function getCatalogDb(): CatalogDatabase {
  if (!_db) {
    _db = new CatalogDatabase();
  }
  return _db;
}

