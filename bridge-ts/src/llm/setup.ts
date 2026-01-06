/**
 * LLM Setup - Downloads and manages local LLM (llamafile).
 * 
 * Currently supports llamafile only, but designed for future expansion.
 * 
 * Flow:
 * 1. Check status (is llamafile downloaded? running?)
 * 2. If not downloaded, user clicks "Download"
 * 3. Download progress is streamed back
 * 4. Once downloaded, can start/stop the server
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { spawn, execSync, ChildProcess } from 'node:child_process';
import { log } from '../native-messaging.js';

// =============================================================================
// Types
// =============================================================================

export interface LLMModel {
  /** Unique identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Size in bytes */
  size: number;
  
  /** Human-readable size */
  sizeHuman: string;
  
  /** Download URL */
  url: string;
  
  /** Description */
  description: string;
  
  /** Whether this model supports tool calling */
  supportsTools: boolean;
  
  /** Recommended for most users */
  recommended?: boolean;
}

export interface LLMSetupStatus {
  /** Is any LLM currently running and accessible? */
  available: boolean;
  
  /** What's running (if anything) */
  runningProvider: 'llamafile' | 'ollama' | 'external' | null;
  
  /** URL of running LLM */
  runningUrl: string | null;
  
  /** Downloaded model IDs */
  downloadedModels: string[];
  
  /** Currently running model (if we started it) */
  activeModel: string | null;
  
  /** Available models to download */
  availableModels: LLMModel[];
  
  /** Ollama-specific info (when Ollama is the provider) */
  ollamaInfo?: {
    version: string | null;
    supportsTools: boolean;
    minimumToolVersion: string;
    recommendedVersion: string;
    warning?: string;
  };
}

export interface DownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  status: 'downloading' | 'complete' | 'error';
  error?: string;
}

// =============================================================================
// Available Models
// =============================================================================

/**
 * Available llamafile models.
 * 
 * These are hosted on HuggingFace by Mozilla.
 * We pick models that work well for tool calling.
 */
const AVAILABLE_MODELS: LLMModel[] = [
  {
    id: 'mistral-7b-instruct',
    name: 'Mistral 7B Instruct',
    size: 4_070_000_000, // ~4.1 GB
    sizeHuman: '4.1 GB',
    url: 'https://huggingface.co/Mozilla/Mistral-7B-Instruct-v0.2-llamafile/resolve/main/mistral-7b-instruct-v0.2.Q4_0.llamafile',
    description: 'Best for tool calling. Good balance of speed and capability.',
    supportsTools: true,
    recommended: true,
  },
  {
    id: 'phi-2',
    name: 'Phi-2 (2.7B)',
    size: 1_700_000_000, // ~1.7 GB
    sizeHuman: '1.7 GB',
    url: 'https://huggingface.co/Mozilla/phi-2-llamafile/resolve/main/phi-2.Q4_K_M.llamafile',
    description: 'Smaller and faster. Good for testing.',
    supportsTools: true,
  },
  {
    id: 'tinyllama-1.1b',
    name: 'TinyLlama 1.1B',
    size: 670_000_000, // ~670 MB
    sizeHuman: '670 MB',
    url: 'https://huggingface.co/Mozilla/TinyLlama-1.1B-Chat-v1.0-llamafile/resolve/main/TinyLlama-1.1B-Chat-v1.0.Q5_K_M.llamafile',
    description: 'Fastest download. Limited capability but good for testing.',
    supportsTools: false,
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    size: 2_000_000_000, // ~2 GB
    sizeHuman: '2.0 GB',
    url: 'https://huggingface.co/Mozilla/Llama-3.2-3B-Instruct-llamafile/resolve/main/Llama-3.2-3B-Instruct.Q6_K.llamafile',
    description: 'Latest Llama model. Great instruction following.',
    supportsTools: true,
  },
];

// =============================================================================
// Paths
// =============================================================================

function getLLMDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(homeDir, '.harbor', 'llm');
}

function getModelPath(modelId: string): string {
  return path.join(getLLMDir(), `${modelId}.llamafile`);
}

function getPidFilePath(): string {
  return path.join(getLLMDir(), 'running.json');
}

function ensureLLMDir(): void {
  const dir = getLLMDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface RunningProcessInfo {
  pid: number;
  modelId: string;
  port: number;
  startedAt: string;
}

/**
 * Save running process info to disk so we can recover after bridge restart.
 */
function saveRunningProcess(info: RunningProcessInfo): void {
  try {
    ensureLLMDir();
    fs.writeFileSync(getPidFilePath(), JSON.stringify(info, null, 2));
    log(`[LLMSetup] Saved PID file: ${info.pid} for ${info.modelId}`);
  } catch (err) {
    log(`[LLMSetup] Failed to save PID file: ${err}`);
  }
}

/**
 * Load running process info from disk.
 */
function loadRunningProcess(): RunningProcessInfo | null {
  try {
    const pidFile = getPidFilePath();
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const content = fs.readFileSync(pidFile, 'utf-8');
    return JSON.parse(content) as RunningProcessInfo;
  } catch (err) {
    log(`[LLMSetup] Failed to load PID file: ${err}`);
    return null;
  }
}

/**
 * Clear the running process info file.
 */
function clearRunningProcess(): void {
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      log('[LLMSetup] Cleared PID file');
    }
  } catch (err) {
    log(`[LLMSetup] Failed to clear PID file: ${err}`);
  }
}

/**
 * Check if a process with the given PID is still running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that a tracked process is actually a llamafile we started.
 * This guards against PID reuse - if our llamafile died and the PID
 * was reused by another process, we shouldn't think it's still our llamafile.
 */
function verifyTrackedProcess(info: RunningProcessInfo): boolean {
  // First check if process exists at all
  if (!isProcessRunning(info.pid)) {
    log(`[LLMSetup] PID ${info.pid} is not running`);
    return false;
  }
  
  // Check if the process is actually a llamafile
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // Get the command line of the process
      const cmd = execSync(`ps -p ${info.pid} -o command= 2>/dev/null || true`, { 
        encoding: 'utf-8' 
      }).trim();
      
      if (!cmd) {
        log(`[LLMSetup] Could not get command for PID ${info.pid}`);
        return false;
      }
      
      // Check if it looks like a llamafile
      const isLlamafile = cmd.includes('llamafile') || 
                          cmd.includes('.llamafile') ||
                          cmd.includes('--server') && cmd.includes('--host');
      
      if (!isLlamafile) {
        log(`[LLMSetup] PID ${info.pid} is not a llamafile (cmd: ${cmd.substring(0, 100)})`);
        return false;
      }
      
      log(`[LLMSetup] Verified PID ${info.pid} is a llamafile`);
      return true;
      
    } else if (process.platform === 'win32') {
      // Windows: use wmic to get process info
      const cmd = execSync(`wmic process where ProcessId=${info.pid} get CommandLine 2>nul`, {
        encoding: 'utf-8'
      }).trim();
      
      const isLlamafile = cmd.includes('llamafile') || cmd.includes('.llamafile');
      if (!isLlamafile) {
        log(`[LLMSetup] PID ${info.pid} is not a llamafile on Windows`);
        return false;
      }
      
      return true;
    }
    
    // Unknown platform - just trust the PID check
    return true;
    
  } catch (err) {
    log(`[LLMSetup] Error verifying process ${info.pid}: ${err}`);
    // If we can't verify, assume it's not valid to be safe
    return false;
  }
}

/**
 * Clean up stale PID file if the tracked process is no longer valid.
 * Call this on startup to handle cases where the process died unexpectedly.
 */
function cleanupStalePidFile(): void {
  const info = loadRunningProcess();
  if (!info) return;
  
  if (!verifyTrackedProcess(info)) {
    log(`[LLMSetup] Cleaning up stale PID file for ${info.modelId} (PID ${info.pid})`);
    clearRunningProcess();
  }
}

// =============================================================================
// LLM Setup Manager
// =============================================================================

export class LLMSetupManager {
  private runningProcess: ChildProcess | null = null;
  private activeModelId: string | null = null;
  private downloadAbortController: AbortController | null = null;
  
  /**
   * Get current setup status.
   */
  async getStatus(): Promise<LLMSetupStatus> {
    // Clean up any stale PID files on status check
    cleanupStalePidFile();
    
    // Check what's downloaded
    const downloadedModels = this.getDownloadedModels();
    
    // Check if something is running
    const runningCheck = await this.checkRunning();
    
    const status: LLMSetupStatus = {
      available: runningCheck.available,
      runningProvider: runningCheck.provider,
      runningUrl: runningCheck.url,
      downloadedModels,
      activeModel: this.activeModelId,
      availableModels: AVAILABLE_MODELS,
    };
    
    // Include Ollama-specific info if Ollama is running
    if (runningCheck.ollamaInfo) {
      status.ollamaInfo = runningCheck.ollamaInfo;
    }
    
    return status;
  }
  
  /**
   * Get list of downloaded model IDs.
   */
  getDownloadedModels(): string[] {
    const dir = getLLMDir();
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = fs.readdirSync(dir);
    return files
      .filter(f => f.endsWith('.llamafile'))
      .map(f => f.replace('.llamafile', ''));
  }
  
  /**
   * Check if an LLM is running.
   */
  private async checkRunning(): Promise<{
    available: boolean;
    provider: 'llamafile' | 'ollama' | 'external' | null;
    url: string | null;
    ollamaInfo?: {
      version: string | null;
      supportsTools: boolean;
      minimumToolVersion: string;
      recommendedVersion: string;
      warning?: string;
    };
  }> {
    // Check if we have a tracked llamafile process (from PID file)
    const savedProcess = loadRunningProcess();
    if (savedProcess) {
      // Verify the process is actually running AND is a llamafile
      if (verifyTrackedProcess(savedProcess)) {
        const llamafileUrl = `http://localhost:${savedProcess.port}`;
        // Also verify the server is responding on HTTP
        if (await this.isServerRunning(llamafileUrl)) {
          // Restore our tracking if we just restarted
          if (!this.activeModelId) {
            this.activeModelId = savedProcess.modelId;
            log(`[LLMSetup] Recovered tracked process: PID ${savedProcess.pid}, model ${savedProcess.modelId}`);
          }
          return {
            available: true,
            provider: 'llamafile',
            url: llamafileUrl,
          };
        } else {
          // Process exists but server not responding - might be starting up or crashed
          log(`[LLMSetup] Tracked process ${savedProcess.pid} exists but server not responding`);
        }
      } else {
        // PID file exists but process is dead or not a llamafile - clean up
        log(`[LLMSetup] Tracked process ${savedProcess.pid} is invalid or dead, cleaning up`);
        clearRunningProcess();
      }
    }
    
    // Check llamafile default port (8080) for untracked processes
    const llamafileUrl = 'http://localhost:8080';
    if (await this.isServerRunning(llamafileUrl)) {
      return {
        available: true,
        provider: 'external',  // Can't manage it - we didn't start it
        url: llamafileUrl,
      };
    }
    
    // Check Ollama
    const ollamaUrl = 'http://localhost:11434';
    if (await this.isOllamaRunning(ollamaUrl)) {
      const ollamaInfo = await this.getOllamaInfo(ollamaUrl);
      return {
        available: true,
        provider: 'ollama',
        url: ollamaUrl,
        ollamaInfo,
      };
    }
    
    return {
      available: false,
      provider: null,
      url: null,
    };
  }
  
  /**
   * Check if Ollama is running (uses /api/tags endpoint).
   */
  private async isOllamaRunning(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  /**
   * Get Ollama version and tool support info.
   */
  private async getOllamaInfo(baseUrl: string): Promise<{
    version: string | null;
    supportsTools: boolean;
    minimumToolVersion: string;
    recommendedVersion: string;
    warning?: string;
  }> {
    const MINIMUM_TOOL_VERSION = '0.3.0';
    const RECOMMENDED_VERSION = '0.5.0';
    
    let version: string | null = null;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${baseUrl}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json() as { version?: string };
        version = data.version || null;
      }
    } catch {
      // Version check failed
    }
    
    // Compare versions
    const supportsTools = version ? this.compareVersions(version, MINIMUM_TOOL_VERSION) >= 0 : true;
    const meetsRecommended = version ? this.compareVersions(version, RECOMMENDED_VERSION) >= 0 : true;
    
    let warning: string | undefined;
    if (!supportsTools) {
      warning = `Version ${version} does not support tool calling. Upgrade to ${MINIMUM_TOOL_VERSION} or later.`;
    } else if (!meetsRecommended) {
      warning = `Version ${version} supports tools but ${RECOMMENDED_VERSION}+ is recommended for reliability.`;
    }
    
    return {
      version,
      supportsTools,
      minimumToolVersion: MINIMUM_TOOL_VERSION,
      recommendedVersion: RECOMMENDED_VERSION,
      warning,
    };
  }
  
  /**
   * Compare two semantic version strings.
   * Returns: negative if a < b, 0 if a == b, positive if a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const partsB = b.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    
    const maxLen = Math.max(partsA.length, partsB.length);
    
    for (let i = 0; i < maxLen; i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      
      if (numA !== numB) {
        return numA - numB;
      }
    }
    
    return 0;
  }
  
  /**
   * Check if a server is responding.
   */
  private async isServerRunning(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  /**
   * Download a model.
   */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    
    ensureLLMDir();
    const targetPath = getModelPath(modelId);
    const tempPath = `${targetPath}.download`;
    
    // Check if already downloaded
    if (fs.existsSync(targetPath)) {
      log(`[LLMSetup] Model ${modelId} already downloaded`);
      onProgress?.({
        modelId,
        bytesDownloaded: model.size,
        totalBytes: model.size,
        percent: 100,
        status: 'complete',
      });
      return;
    }
    
    log(`[LLMSetup] Starting download of ${modelId} from ${model.url}`);
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tempPath);
      let downloadedBytes = 0;
      
      const request = https.get(model.url, {
        headers: {
          'User-Agent': 'Harbor-Bridge/1.0',
        },
      }, (response) => {
        // Handle redirects (301, 302, 307, 308)
        if (response.statusCode === 301 || response.statusCode === 302 || 
            response.statusCode === 307 || response.statusCode === 308) {
          let redirectUrl = response.headers.location;
          if (redirectUrl) {
            try {
              // Handle relative redirects by resolving against original URL
              if (redirectUrl.startsWith('/')) {
                const originalUrl = new URL(model.url);
                redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
              }
              
              // Validate the redirect URL
              new URL(redirectUrl); // Will throw if invalid
              
              log(`[LLMSetup] Following redirect to ${redirectUrl}`);
              file.close();
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
              
            // Recursively follow redirect
            https.get(redirectUrl, {
              headers: { 'User-Agent': 'Harbor-Bridge/1.0' },
            }, (redirectResponse) => {
              this.handleDownloadResponse(
                redirectResponse,
                tempPath,
                targetPath,
                modelId,
                model.size,
                onProgress,
                resolve,
                reject,
                redirectUrl,
                1
              );
            }).on('error', (err) => {
                log(`[LLMSetup] Redirect request failed: ${err.message}`);
                if (fs.existsSync(tempPath)) {
                  fs.unlinkSync(tempPath);
                }
                onProgress?.({
                  modelId,
                  bytesDownloaded: 0,
                  totalBytes: model.size,
                  percent: 0,
                  status: 'error',
                  error: `Redirect failed: ${err.message}`,
                });
                reject(new Error(`Redirect failed: ${err.message}`));
              });
              return;
            } catch (urlError) {
              // Invalid redirect URL - fail gracefully
              log(`[LLMSetup] Invalid redirect URL: ${redirectUrl} - ${urlError}`);
              file.close();
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
              onProgress?.({
                modelId,
                bytesDownloaded: 0,
                totalBytes: model.size,
                percent: 0,
                status: 'error',
                error: `Invalid redirect URL from server`,
              });
              reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
              return;
            }
          }
        }
        
        // Handle non-success status codes
        if (response.statusCode && response.statusCode >= 400) {
          log(`[LLMSetup] HTTP error: ${response.statusCode}`);
          file.close();
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          onProgress?.({
            modelId,
            bytesDownloaded: 0,
            totalBytes: model.size,
            percent: 0,
            status: 'error',
            error: `HTTP error ${response.statusCode}`,
          });
          reject(new Error(`HTTP error ${response.statusCode}`));
          return;
        }
        
        this.handleDownloadResponse(
          response,
          tempPath,
          targetPath,
          modelId,
          model.size,
          onProgress,
          resolve,
          reject,
          model.url,
          0
        );
      });
      
      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        onProgress?.({
          modelId,
          bytesDownloaded: 0,
          totalBytes: model.size,
          percent: 0,
          status: 'error',
          error: err.message,
        });
        reject(err);
      });
    });
  }
  
  private handleDownloadResponse(
    response: any,
    tempPath: string,
    targetPath: string,
    modelId: string,
    expectedSize: number,
    onProgress: ((progress: DownloadProgress) => void) | undefined,
    resolve: () => void,
    reject: (err: Error) => void,
    currentUrl?: string,
    redirectCount = 0
  ): void {
    // Limit redirects to prevent infinite loops
    const MAX_REDIRECTS = 10;
    if (redirectCount > MAX_REDIRECTS) {
      log(`[LLMSetup] Too many redirects (${redirectCount})`);
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: expectedSize,
        percent: 0,
        status: 'error',
        error: 'Too many redirects',
      });
      reject(new Error('Too many redirects'));
      return;
    }
    
    // Check for redirects in this response too
    if (response.statusCode === 301 || response.statusCode === 302 || 
        response.statusCode === 307 || response.statusCode === 308) {
      let redirectUrl = response.headers.location;
      if (redirectUrl) {
        try {
          // Handle relative redirects
          if (redirectUrl.startsWith('/') && currentUrl) {
            const originalUrl = new URL(currentUrl);
            redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
          }
          
          // Validate URL
          new URL(redirectUrl);
          
          log(`[LLMSetup] Following redirect #${redirectCount + 1} to ${redirectUrl}`);
          
          https.get(redirectUrl, {
            headers: { 'User-Agent': 'Harbor-Bridge/1.0' },
          }, (redirectResponse) => {
            this.handleDownloadResponse(
              redirectResponse,
              tempPath,
              targetPath,
              modelId,
              expectedSize,
              onProgress,
              resolve,
              reject,
              redirectUrl,
              redirectCount + 1
            );
          }).on('error', (err) => {
            log(`[LLMSetup] Redirect request failed: ${err.message}`);
            onProgress?.({
              modelId,
              bytesDownloaded: 0,
              totalBytes: expectedSize,
              percent: 0,
              status: 'error',
              error: `Redirect failed: ${err.message}`,
            });
            reject(new Error(`Redirect failed: ${err.message}`));
          });
          return;
        } catch (urlError) {
          log(`[LLMSetup] Invalid redirect URL: ${redirectUrl}`);
          onProgress?.({
            modelId,
            bytesDownloaded: 0,
            totalBytes: expectedSize,
            percent: 0,
            status: 'error',
            error: 'Invalid redirect URL',
          });
          reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
          return;
        }
      }
    }
    
    // Handle error status codes
    if (response.statusCode && response.statusCode >= 400) {
      log(`[LLMSetup] HTTP error in response: ${response.statusCode}`);
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: expectedSize,
        percent: 0,
        status: 'error',
        error: `HTTP error ${response.statusCode}`,
      });
      reject(new Error(`HTTP error ${response.statusCode}`));
      return;
    }
    
    // Now we have the actual file response
    const totalBytes = parseInt(response.headers['content-length'] || String(expectedSize), 10);
    let downloadedBytes = 0;
    let lastReportedPercent = -1;
    
    log(`[LLMSetup] Starting actual download, size: ${Math.round(totalBytes / 1_000_000)} MB`);
    
    const file = fs.createWriteStream(tempPath);
    
    response.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      const percent = Math.round((downloadedBytes / totalBytes) * 100);
      
      // Only report every 1% to reduce noise
      if (percent !== lastReportedPercent) {
        lastReportedPercent = percent;
        onProgress?.({
          modelId,
          bytesDownloaded: downloadedBytes,
          totalBytes,
          percent,
          status: 'downloading',
        });
      }
    });
    
    response.pipe(file);
    
    file.on('finish', () => {
      file.close();
      
      // Verify file size is reasonable (at least 100MB for LLM files)
      const stats = fs.statSync(tempPath);
      if (stats.size < 100_000_000) {
        log(`[LLMSetup] Downloaded file too small: ${stats.size} bytes`);
        fs.unlinkSync(tempPath);
        onProgress?.({
          modelId,
          bytesDownloaded: 0,
          totalBytes: expectedSize,
          percent: 0,
          status: 'error',
          error: `Downloaded file too small (${Math.round(stats.size / 1000)} KB). Server may have returned an error page.`,
        });
        reject(new Error('Downloaded file too small - likely an error page'));
        return;
      }
      
      // Rename temp to final
      fs.renameSync(tempPath, targetPath);
      
      // Make executable
      fs.chmodSync(targetPath, 0o755);
      
      // Remove macOS quarantine attribute to prevent Gatekeeper prompts
      if (process.platform === 'darwin') {
        try {
          execSync(`xattr -d com.apple.quarantine "${targetPath}"`, { stdio: 'ignore' });
          log(`[LLMSetup] Removed quarantine attribute from ${targetPath}`);
        } catch {
          // Attribute may not exist, that's fine
          log(`[LLMSetup] No quarantine attribute to remove (or already removed)`);
        }
      }
      
      log(`[LLMSetup] Download complete: ${targetPath} (${Math.round(stats.size / 1_000_000)} MB)`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: totalBytes,
        totalBytes,
        percent: 100,
        status: 'complete',
      });
      
      resolve();
    });
    
    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      onProgress?.({
        modelId,
        bytesDownloaded: downloadedBytes,
        totalBytes,
        percent: 0,
        status: 'error',
        error: err.message,
      });
      reject(err);
    });
  }
  
  /**
   * Cancel an in-progress download.
   */
  cancelDownload(): void {
    if (this.downloadAbortController) {
      this.downloadAbortController.abort();
      this.downloadAbortController = null;
    }
  }
  
  /**
   * Delete a downloaded model.
   */
  deleteModel(modelId: string): boolean {
    const modelPath = getModelPath(modelId);
    if (fs.existsSync(modelPath)) {
      // Stop if running
      if (this.activeModelId === modelId) {
        this.stopLocalLLM();
      }
      
      fs.unlinkSync(modelPath);
      log(`[LLMSetup] Deleted model: ${modelId}`);
      return true;
    }
    return false;
  }
  
  /**
   * Start a downloaded llamafile.
   */
  async startLocalLLM(modelId: string, port: number = 8080): Promise<{
    success: boolean;
    error?: string;
    url?: string;
  }> {
    const modelPath = getModelPath(modelId);
    
    if (!fs.existsSync(modelPath)) {
      return {
        success: false,
        error: `Model not downloaded: ${modelId}`,
      };
    }
    
    // Ensure the file is executable (in case it was downloaded before chmod fix)
    try {
      fs.chmodSync(modelPath, 0o755);
    } catch (chmodErr) {
      log(`[LLMSetup] Warning: Could not set execute permissions: ${chmodErr}`);
    }
    
    // On macOS, remove ALL extended attributes that can block execution of downloaded files
    // This includes com.apple.quarantine, com.apple.provenance, etc.
    if (process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${modelPath}"`, { stdio: 'ignore' });
        log(`[LLMSetup] Cleared extended attributes from ${modelPath}`);
      } catch (xattrErr) {
        log(`[LLMSetup] Warning: Could not clear extended attributes: ${xattrErr}`);
      }
      
      // Also clear quarantine from llamafile's cache directory where it extracts .dylib files
      // llamafile extracts ggml-metal.dylib and other libs here
      const homeDir = process.env.HOME || '';
      const llamafileCacheDirs = [
        path.join(homeDir, '.cache', 'llamafile'),
        path.join(homeDir, '.llamafile'),
        '/tmp/llamafile',
      ];
      
      for (const cacheDir of llamafileCacheDirs) {
        if (fs.existsSync(cacheDir)) {
          try {
            execSync(`xattr -cr "${cacheDir}"`, { stdio: 'ignore' });
            log(`[LLMSetup] Cleared extended attributes from cache: ${cacheDir}`);
          } catch {
            // Ignore errors - directory may not have quarantined files
          }
        }
      }
    }
    
    // Stop any existing process
    if (this.runningProcess) {
      await this.stopLocalLLM();
    }
    
    log(`[LLMSetup] Starting llamafile: ${modelPath}`);
    
    try {
      // Start the llamafile server
      // Use shell: true because llamafiles are polyglot executables that may need shell interpretation
      this.runningProcess = spawn(modelPath, [
        '--server',
        '--host', '127.0.0.1',
        '--port', String(port),
        '--ctx-size', '4096',
        '--parallel', '1',
      ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
      
      this.activeModelId = modelId;
      
      // Save PID file for recovery after bridge restart
      if (this.runningProcess.pid) {
        saveRunningProcess({
          pid: this.runningProcess.pid,
          modelId,
          port,
          startedAt: new Date().toISOString(),
        });
      }
      
      // Log stderr
      this.runningProcess.stderr?.on('data', (data) => {
        log(`[llamafile] ${data.toString().trim()}`);
      });
      
      this.runningProcess.on('error', (err) => {
        log(`[LLMSetup] Process error: ${err.message}`);
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
      });
      
      this.runningProcess.on('exit', (code) => {
        log(`[LLMSetup] Process exited with code ${code}`);
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
      });
      
      // Wait for server to be ready
      const url = `http://127.0.0.1:${port}`;
      const ready = await this.waitForServer(url, 30000);
      
      if (!ready) {
        this.stopLocalLLM();
        return {
          success: false,
          error: 'Server failed to start within 30 seconds',
        };
      }
      
      log(`[LLMSetup] Server ready at ${url}`);
      
      return {
        success: true,
        url,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Failed to start: ${message}`);
      
      return {
        success: false,
        error: message,
      };
    }
  }
  
  /**
   * Wait for the server to be ready.
   */
  private async waitForServer(url: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.isServerRunning(url)) {
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    return false;
  }
  
  /**
   * Stop the running llamafile.
   * Uses PID file for reliable process tracking across bridge restarts.
   */
  async stopLocalLLM(): Promise<boolean> {
    log('[LLMSetup] Stopping llamafile...');
    
    // Method 1: If we have a direct reference to the process, use it
    if (this.runningProcess) {
      try {
        this.runningProcess.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await new Promise(r => setTimeout(r, 1000));
        
        // Force kill if still running
        if (this.runningProcess && !this.runningProcess.killed) {
          this.runningProcess.kill('SIGKILL');
        }
        
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
        
        log('[LLMSetup] Stopped (direct reference)');
        return true;
        
      } catch (error) {
        log(`[LLMSetup] Error stopping via direct reference: ${error}`);
        this.runningProcess = null;
        this.activeModelId = null;
      }
    }
    
    // Method 2: Use PID file to find and kill the process we started
    const savedProcess = loadRunningProcess();
    if (savedProcess) {
      log(`[LLMSetup] Found tracked process: PID ${savedProcess.pid}`);
      
      if (isProcessRunning(savedProcess.pid)) {
        try {
          // Try graceful shutdown first
          process.kill(savedProcess.pid, 'SIGTERM');
          await new Promise(r => setTimeout(r, 1000));
          
          // Force kill if still running
          if (isProcessRunning(savedProcess.pid)) {
            process.kill(savedProcess.pid, 'SIGKILL');
          }
          
          this.activeModelId = null;
          clearRunningProcess();
          
          log(`[LLMSetup] Stopped tracked process: PID ${savedProcess.pid}`);
          return true;
          
        } catch (error) {
          log(`[LLMSetup] Error stopping tracked process: ${error}`);
          // Process might already be gone
          clearRunningProcess();
        }
      } else {
        // Process is already dead, just clean up
        log(`[LLMSetup] Tracked process ${savedProcess.pid} already dead, cleaning up`);
        clearRunningProcess();
      }
      
      this.activeModelId = null;
      return true;
    }
    
    log('[LLMSetup] No tracked llamafile process found to stop');
    return false;
  }
  
  /**
   * Get the PID of the running process.
   */
  getPid(): number | null {
    return this.runningProcess?.pid || null;
  }
}

// Singleton
let _setupManager: LLMSetupManager | null = null;

export function getLLMSetupManager(): LLMSetupManager {
  if (!_setupManager) {
    _setupManager = new LLMSetupManager();
  }
  return _setupManager;
}


