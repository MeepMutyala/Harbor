/**
 * Curated MCP Servers
 * 
 * A static list of recommended MCP servers that are known to work well.
 * These are displayed prominently in the sidebar for easy installation.
 */

import { CuratedServer } from '../types.js';
import { McpManifest } from '../installer/manifest.js';

/**
 * Extended curated server with installation details.
 * This is used internally by handlers.ts for the full install flow.
 */
export interface CuratedServerFull extends CuratedServer {
  homepage?: string;
  repository?: string;
  install: 
    | { type: 'npm'; package: string }
    | { type: 'pypi'; package: string }
    | { type: 'binary'; github: string; binaryName: string }
    | { type: 'docker'; image: string };
  dockerAlternative?: {
    image: string;
    command?: string;
  };
  // If true, this server must NOT run in Docker (needs host filesystem access)
  // This is a technical constraint for servers that access local resources
  noDocker?: boolean;
  // Embedded manifest for servers that don't have one in their repo yet.
  // This lets Harbor handle OAuth and other advanced features without
  // requiring a PR to the upstream repository.
  manifest?: McpManifest;
}

/**
 * Full curated server definitions with installation details.
 */
export const CURATED_SERVERS_FULL: CuratedServerFull[] = [
  {
    id: 'curated-filesystem',
    name: 'Filesystem',
    description: 'Read, write, and manage files on your local system.',
    icon: '📁',
    packageType: 'npm',
    packageId: '@modelcontextprotocol/server-filesystem',
    tags: ['files', 'local', 'essential'],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    repository: 'https://github.com/modelcontextprotocol/servers',
    // Filesystem server must NOT run in Docker - it needs host filesystem access
    noDocker: true,
    install: {
      type: 'npm',
      package: '@modelcontextprotocol/server-filesystem',
    },
  },
  {
    id: 'curated-github',
    name: 'GitHub (Local)',
    description: 'Access repositories, issues, pull requests via npm package. Requires GITHUB_PERSONAL_ACCESS_TOKEN env var.',
    icon: '🐙',
    packageType: 'npm',
    packageId: '@modelcontextprotocol/server-github',
    tags: ['development', 'git', 'collaboration'],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    repository: 'https://github.com/modelcontextprotocol/servers',
    install: {
      type: 'npm',
      package: '@modelcontextprotocol/server-github',
    },
  },
  {
    id: 'curated-github-docker',
    name: 'GitHub (Docker)',
    description: 'Official GitHub MCP server via Docker. Requires GITHUB_PERSONAL_ACCESS_TOKEN env var.',
    icon: '🐙',
    packageType: 'oci',
    packageId: 'ghcr.io/github/github-mcp-server',
    tags: ['development', 'git', 'collaboration', 'docker'],
    homepageUrl: 'https://github.com/github/github-mcp-server',
    homepage: 'https://github.com/github/github-mcp-server',
    repository: 'https://github.com/github/github-mcp-server',
    install: {
      type: 'docker',
      image: 'ghcr.io/github/github-mcp-server',
    },
  },
  {
    id: 'curated-time',
    name: 'Time',
    description: 'Get current time, convert timezones, and work with dates.',
    icon: '🕐',
    packageType: 'pypi',
    packageId: 'mcp-server-time',
    tags: ['utility', 'datetime'],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    repository: 'https://github.com/modelcontextprotocol/servers',
    install: {
      type: 'pypi',
      package: 'mcp-server-time',
    },
  },
  {
    id: 'curated-memory',
    name: 'Memory',
    description: 'A simple in-memory key-value store for temporary data.',
    icon: '🧠',
    packageType: 'npm',
    packageId: '@modelcontextprotocol/server-memory',
    tags: ['utility', 'data', 'local'],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    repository: 'https://github.com/modelcontextprotocol/servers',
    install: {
      type: 'npm',
      package: '@modelcontextprotocol/server-memory',
    },
  },
  {
    id: 'curated-fetch',
    name: 'Fetch',
    description: 'Make HTTP requests to fetch web content and APIs.',
    icon: '🌐',
    packageType: 'npm',
    packageId: '@modelcontextprotocol/server-fetch',
    tags: ['web', 'http', 'api'],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    repository: 'https://github.com/modelcontextprotocol/servers',
    install: {
      type: 'npm',
      package: '@modelcontextprotocol/server-fetch',
    },
  },
  {
    id: 'curated-gmail',
    name: 'Gmail',
    description: 'Read, search, send emails, manage labels and filters via Gmail API.',
    icon: '📧',
    packageType: 'npm',
    packageId: '@gongrzhe/server-gmail-autoauth-mcp',
    tags: ['email', 'google', 'productivity'],
    homepageUrl: 'https://github.com/r/Gmail-MCP-Server',
    homepage: 'https://github.com/r/Gmail-MCP-Server',
    repository: 'https://github.com/r/Gmail-MCP-Server',
    install: {
      type: 'npm',
      package: '@gongrzhe/server-gmail-autoauth-mcp',
    },
    // Manifest will be fetched from the repo (has mcp-manifest.json)
  },
];

/**
 * Simple curated servers for the extension UI (without internal install details).
 */
export const CURATED_SERVERS: CuratedServer[] = CURATED_SERVERS_FULL.map(s => ({
  id: s.id,
  name: s.name,
  description: s.description,
  icon: s.icon,
  packageType: s.packageType,
  packageId: s.packageId,
  tags: s.tags,
  homepageUrl: s.homepageUrl,
}));

/**
 * Get a curated server by ID (full version with install details).
 */
export function getCuratedServer(id: string): CuratedServerFull | undefined {
  return CURATED_SERVERS_FULL.find(s => s.id === id);
}

/**
 * Re-export the CuratedServer type.
 */
export type { CuratedServer } from '../types.js';
