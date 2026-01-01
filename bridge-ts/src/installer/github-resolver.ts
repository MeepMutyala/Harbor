/**
 * GitHub Package Resolver
 * 
 * Fetches package.json from GitHub repos to determine npm package info.
 */

import { log } from '../native-messaging.js';

export interface ResolvedPackage {
  name: string;
  version?: string;
  bin?: Record<string, string> | string;
  main?: string;
  type?: 'npm' | 'python';
  installCommand?: string;
  runCommand?: string;
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Parse a GitHub URL to extract owner and repo.
 */
export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  // Handle various GitHub URL formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo/tree/branch
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  
  let match = url.match(/github\.com[/:]([^/]+)\/([^/\s.#?]+)/i);
  if (!match) {
    return null;
  }
  
  const owner = match[1];
  let repo = match[2].replace(/\.git$/, '');
  
  // Check for branch in URL
  let branch: string | undefined;
  const branchMatch = url.match(/\/tree\/([^/]+)/);
  if (branchMatch) {
    branch = branchMatch[1];
  }
  
  return { owner, repo, branch };
}

/**
 * Fetch package.json from a GitHub repository.
 */
export async function fetchPackageJson(
  repoInfo: GitHubRepoInfo
): Promise<ResolvedPackage | null> {
  const { owner, repo, branch } = repoInfo;
  
  // Try main, master, then the specified branch
  const branches = branch ? [branch] : ['main', 'master'];
  
  for (const b of branches) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/package.json`;
    
    try {
      log(`[GitHubResolver] Fetching: ${rawUrl}`);
      const response = await fetch(rawUrl);
      
      if (!response.ok) {
        continue; // Try next branch
      }
      
      const packageJson = await response.json() as {
        name?: string;
        version?: string;
        bin?: Record<string, string> | string;
        main?: string;
      };
      
      return {
        name: packageJson.name || '',
        version: packageJson.version,
        bin: packageJson.bin,
        main: packageJson.main,
        type: 'npm',
      };
    } catch (e) {
      log(`[GitHubResolver] Failed to fetch ${rawUrl}: ${e}`);
      continue;
    }
  }
  
  return null;
}

/**
 * Check if a repo has a pyproject.toml (Python package).
 */
export async function fetchPyprojectToml(
  repoInfo: GitHubRepoInfo
): Promise<ResolvedPackage | null> {
  const { owner, repo, branch } = repoInfo;
  const branches = branch ? [branch] : ['main', 'master'];
  
  for (const b of branches) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/pyproject.toml`;
    
    try {
      const response = await fetch(rawUrl);
      if (!response.ok) continue;
      
      const toml = await response.text();
      
      // Simple TOML parsing for name
      const nameMatch = toml.match(/name\s*=\s*["']([^"']+)["']/);
      const name = nameMatch ? nameMatch[1] : repo;
      
      return {
        name,
        type: 'python',
      };
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

/**
 * Resolve package info from a GitHub URL.
 * Tries package.json first, then pyproject.toml.
 */
export async function resolveGitHubPackage(
  githubUrl: string
): Promise<ResolvedPackage | null> {
  const repoInfo = parseGitHubUrl(githubUrl);
  if (!repoInfo) {
    log(`[GitHubResolver] Could not parse GitHub URL: ${githubUrl}`);
    return null;
  }
  
  // Try npm first
  const npmPackage = await fetchPackageJson(repoInfo);
  if (npmPackage) {
    // Generate install and run commands
    npmPackage.installCommand = `npm install -g ${npmPackage.name}`;
    
    // Determine run command
    if (npmPackage.bin) {
      // If bin is a string, use the package name as command
      // If bin is an object, use the first key
      if (typeof npmPackage.bin === 'string') {
        npmPackage.runCommand = npmPackage.name;
      } else {
        npmPackage.runCommand = Object.keys(npmPackage.bin)[0];
      }
    } else if (npmPackage.main) {
      npmPackage.runCommand = `node node_modules/${npmPackage.name}/${npmPackage.main}`;
    }
    
    return npmPackage;
  }
  
  // Try Python
  const pyPackage = await fetchPyprojectToml(repoInfo);
  if (pyPackage) {
    pyPackage.installCommand = `pip install ${pyPackage.name}`;
    pyPackage.runCommand = pyPackage.name;
    return pyPackage;
  }
  
  // Fallback: suggest cloning the repo
  return {
    name: repoInfo.repo,
    type: 'npm',
    installCommand: `git clone https://github.com/${repoInfo.owner}/${repoInfo.repo}.git && cd ${repoInfo.repo} && npm install`,
    runCommand: `cd ${repoInfo.repo} && npm start`,
  };
}

/**
 * Get installation commands for a GitHub repo.
 */
export async function getInstallCommands(
  githubUrl: string
): Promise<{ install: string; run: string } | null> {
  const resolved = await resolveGitHubPackage(githubUrl);
  if (!resolved) {
    return null;
  }
  
  return {
    install: resolved.installCommand || `npm install ${resolved.name}`,
    run: resolved.runCommand || resolved.name,
  };
}

