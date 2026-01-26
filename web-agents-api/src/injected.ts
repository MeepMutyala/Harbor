/**
 * Web Agents API - Injected Script (v1)
 *
 * This script is injected into web pages to expose:
 * - window.ai - Text generation API (Chrome Prompt API compatible)
 * - window.agent - Basic tool calling (permissions, tools.list, tools.call)
 *
 * v1 API - Simplified version without browser interaction or autonomous agents.
 */

// Make this a module to avoid global scope conflicts
export {};

// =============================================================================
// Types
// =============================================================================

type PermissionScope =
  | 'model:prompt'
  | 'model:list'
  | 'mcp:tools.list'
  | 'mcp:tools.call';

type PermissionGrant = 'granted-once' | 'granted-always' | 'denied' | 'not-granted';

interface PermissionGrantResult {
  granted: boolean;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

interface PermissionStatus {
  origin: string;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

interface TextSessionOptions {
  model?: string;
  provider?: string;
  temperature?: number;
  systemPrompt?: string;
}

interface StreamToken {
  type: 'token' | 'done' | 'error';
  token?: string;
  error?: { code: string; message: string };
}

interface LLMProviderInfo {
  id: string;
  type: string;
  name: string;
  available: boolean;
  models?: string[];
  isDefault: boolean;
}

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId?: string;
}

// Session types
interface SessionCapabilities {
  llm: { allowed: boolean; provider?: string; model?: string };
  tools: { allowed: boolean; allowedTools: string[] };
  browser: { readActiveTab: boolean; interact: boolean; screenshot: boolean };
  limits?: { maxToolCalls?: number; expiresAt?: number };
}

interface SessionUsage {
  promptCount: number;
  toolCallCount: number;
}

interface SessionSummary {
  sessionId: string;
  type: 'implicit' | 'explicit';
  origin: string;
  status: 'active' | 'suspended' | 'terminated';
  name?: string;
  createdAt: number;
  lastActiveAt: number;
  capabilities: {
    hasLLM: boolean;
    toolCount: number;
    hasBrowserAccess: boolean;
  };
  usage: SessionUsage;
}

interface CreateSessionOptions {
  name?: string;
  reason?: string;
  capabilities: {
    llm?: { provider?: string; model?: string };
    tools?: string[];
    browser?: ('read' | 'interact' | 'screenshot')[];
  };
  limits?: {
    maxToolCalls?: number;
    ttlMinutes?: number;
  };
  options?: {
    systemPrompt?: string;
    temperature?: number;
  };
}

interface CreateSessionResult {
  success: boolean;
  sessionId?: string;
  capabilities?: SessionCapabilities;
  error?: { code: string; message: string };
}

// =============================================================================
// Transport Layer
// =============================================================================

const CHANNEL = 'web_agents_api';

interface TransportResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface TransportStreamEvent {
  id: string;
  event: StreamToken;
  done?: boolean;
}

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

const streamListeners = new Map<string, (event: StreamToken, done: boolean) => void>();

// Initialize transport
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;

  const data = event.data as {
    channel?: string;
    response?: TransportResponse;
    streamEvent?: TransportStreamEvent;
  };

  if (data?.channel !== CHANNEL) return;

  // Handle regular response
  if (data.response) {
    const pending = pendingRequests.get(data.response.id);
    if (pending) {
      pendingRequests.delete(data.response.id);
      if (data.response.ok) {
        pending.resolve(data.response.result);
      } else {
        const err = new Error(data.response.error?.message || 'Request failed');
        (err as Error & { code?: string }).code = data.response.error?.code;
        pending.reject(err);
      }
    }
  }

  // Handle stream event
  if (data.streamEvent) {
    const listener = streamListeners.get(data.streamEvent.id);
    if (listener) {
      listener(data.streamEvent.event, data.streamEvent.done || false);
      if (data.streamEvent.done) {
        streamListeners.delete(data.streamEvent.id);
      }
    }
  }
});

function sendRequest<T>(type: string, payload?: unknown): Promise<T> {
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    window.postMessage({ channel: CHANNEL, request: { id, type, payload } }, '*');

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        const err = new Error('Request timeout');
        (err as Error & { code?: string }).code = 'ERR_TIMEOUT';
        reject(err);
      }
    }, 30000);
  });
}

function createStreamIterable<T extends StreamToken>(
  type: string,
  payload?: unknown,
): AsyncIterable<T> {
  const id = crypto.randomUUID();

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const queue: T[] = [];
      let resolveNext: ((result: IteratorResult<T>) => void) | null = null;
      let done = false;
      let error: Error | null = null;

      // Register stream listener before sending request
      streamListeners.set(id, (event, isDone) => {
        if (isDone) {
          done = true;
          streamListeners.delete(id);
        }

        // Check for error event
        if ('type' in event && event.type === 'error') {
          error = new Error(event.error?.message || 'Stream error');
          (error as Error & { code?: string }).code = event.error?.code || 'ERR_INTERNAL';
          done = true;
        }

        if (resolveNext && !error) {
          resolveNext({ done: false, value: event as T });
          resolveNext = null;
        } else if (!error) {
          queue.push(event as T);
        }
      });

      // Send the request
      window.postMessage({ channel: CHANNEL, request: { id, type, payload } }, '*');

      return {
        async next(): Promise<IteratorResult<T>> {
          if (error) {
            throw error;
          }

          if (queue.length > 0) {
            return { done: false, value: queue.shift()! };
          }

          if (done) {
            return { done: true, value: undefined };
          }

          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },

        async return(): Promise<IteratorResult<T>> {
          done = true;
          streamListeners.delete(id);
          // Send abort signal
          window.postMessage({ channel: CHANNEL, abort: { id } }, '*');
          return { done: true, value: undefined };
        },
      };
    },
  };
}

// =============================================================================
// TextSession Implementation
// =============================================================================

interface TextSession {
  readonly sessionId: string;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<string>;
  destroy(): void;
}

function createTextSessionObject(sessionId: string): TextSession {
  return Object.freeze({
    sessionId,

    async prompt(input: string): Promise<string> {
      return sendRequest<string>('session.prompt', { sessionId, input });
    },

    promptStreaming(input: string): AsyncIterable<string> {
      const tokenIterable = createStreamIterable<StreamToken>('session.promptStreaming', { sessionId, input });
      
      // Transform to yield just the token strings
      return {
        [Symbol.asyncIterator]() {
          const tokenIterator = tokenIterable[Symbol.asyncIterator]();
          
          return {
            async next(): Promise<IteratorResult<string>> {
              const result = await tokenIterator.next();
              if (result.done) {
                return { done: true, value: undefined };
              }
              if (result.value.type === 'token' && result.value.token) {
                return { done: false, value: result.value.token };
              }
              if (result.value.type === 'done') {
                return { done: true, value: undefined };
              }
              if (result.value.type === 'error') {
                throw new Error(result.value.error?.message || 'Stream error');
              }
              // Continue to next token
              return this.next();
            },
            
            async return(): Promise<IteratorResult<string>> {
              await tokenIterator.return?.();
              return { done: true, value: undefined };
            },
          };
        },
      };
    },

    destroy(): void {
      sendRequest('session.destroy', { sessionId }).catch(() => {});
    },
  });
}

// =============================================================================
// window.ai Implementation
// =============================================================================

const aiApi = Object.freeze({
  async canCreateTextSession(): Promise<'readily' | 'after-download' | 'no'> {
    return sendRequest<'readily' | 'after-download' | 'no'>('ai.canCreateTextSession');
  },

  async createTextSession(options: TextSessionOptions = {}): Promise<TextSession> {
    const sessionId = await sendRequest<string>('ai.createTextSession', options);
    return createTextSessionObject(sessionId);
  },

  languageModel: Object.freeze({
    async capabilities(): Promise<{
      available: 'readily' | 'after-download' | 'no';
      defaultTopK?: number;
      maxTopK?: number;
      defaultTemperature?: number;
    }> {
      return sendRequest('ai.languageModel.capabilities');
    },

    async create(options: {
      systemPrompt?: string;
      temperature?: number;
      topK?: number;
    } = {}): Promise<TextSession> {
      const sessionOptions: TextSessionOptions = {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
      };
      const sessionId = await sendRequest<string>('ai.languageModel.create', {
        ...sessionOptions,
        topK: options.topK,
      });
      return createTextSessionObject(sessionId);
    },
  }),

  providers: Object.freeze({
    async list(): Promise<LLMProviderInfo[]> {
      return sendRequest<LLMProviderInfo[]>('ai.providers.list');
    },

    async getActive(): Promise<{ provider: string | null; model: string | null }> {
      return sendRequest('ai.providers.getActive');
    },
  }),
});

// =============================================================================
// AgentSession Implementation
// =============================================================================

interface AgentSession {
  readonly sessionId: string;
  readonly capabilities: SessionCapabilities;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<string>;
  callTool(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  listAllowedTools(): string[];
  terminate(): Promise<void>;
}

function createAgentSessionObject(
  sessionId: string,
  capabilities: SessionCapabilities,
): AgentSession {
  return Object.freeze({
    sessionId,
    capabilities,

    async prompt(input: string): Promise<string> {
      if (!capabilities.llm.allowed) {
        throw new Error('Session does not have LLM access');
      }
      return sendRequest<string>('session.prompt', { sessionId, input });
    },

    promptStreaming(input: string): AsyncIterable<string> {
      if (!capabilities.llm.allowed) {
        throw new Error('Session does not have LLM access');
      }
      const tokenIterable = createStreamIterable<StreamToken>('session.promptStreaming', { sessionId, input });
      
      return {
        [Symbol.asyncIterator]() {
          const tokenIterator = tokenIterable[Symbol.asyncIterator]();
          
          return {
            async next(): Promise<IteratorResult<string>> {
              const result = await tokenIterator.next();
              if (result.done) {
                return { done: true, value: undefined };
              }
              if (result.value.type === 'token' && result.value.token) {
                return { done: false, value: result.value.token };
              }
              if (result.value.type === 'done') {
                return { done: true, value: undefined };
              }
              if (result.value.type === 'error') {
                throw new Error(result.value.error?.message || 'Stream error');
              }
              return this.next();
            },
            
            async return(): Promise<IteratorResult<string>> {
              await tokenIterator.return?.();
              return { done: true, value: undefined };
            },
          };
        },
      };
    },

    async callTool(tool: string, args?: Record<string, unknown>): Promise<unknown> {
      if (!capabilities.tools.allowed) {
        throw new Error('Session does not have tool access');
      }
      if (!capabilities.tools.allowedTools.includes(tool)) {
        throw new Error(`Tool ${tool} not allowed in this session`);
      }
      return sendRequest('agent.tools.call', { tool, args, sessionId });
    },

    listAllowedTools(): string[] {
      return capabilities.tools.allowedTools;
    },

    async terminate(): Promise<void> {
      await sendRequest('agent.sessions.terminate', { sessionId });
    },
  });
}

// =============================================================================
// window.agent Implementation (v1 - simplified)
// =============================================================================

const agentApi = Object.freeze({
  async requestPermissions(options: {
    scopes: PermissionScope[];
    reason?: string;
    tools?: string[];
  }): Promise<PermissionGrantResult> {
    return sendRequest<PermissionGrantResult>('agent.requestPermissions', options);
  },

  permissions: Object.freeze({
    async list(): Promise<PermissionStatus> {
      return sendRequest<PermissionStatus>('agent.permissions.list');
    },
  }),

  tools: Object.freeze({
    async list(): Promise<ToolDescriptor[]> {
      return sendRequest<ToolDescriptor[]>('agent.tools.list');
    },

    async call(options: { tool: string; args?: Record<string, unknown> }): Promise<unknown> {
      return sendRequest('agent.tools.call', options);
    },
  }),

  /**
   * Run an autonomous agent that can use tools to complete a task.
   * 
   * @example
   * for await (const event of window.agent.run({
   *   task: 'What is the current time?',
   *   maxToolCalls: 3
   * })) {
   *   if (event.type === 'tool_call') {
   *     console.log('Using tool:', event.tool);
   *   }
   *   if (event.type === 'final') {
   *     console.log('Response:', event.output);
   *   }
   * }
   */
  run(options: {
    task: string;
    maxToolCalls?: number;
    systemPrompt?: string;
  }): AsyncIterable<
    | { type: 'thinking'; content: string }
    | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
    | { type: 'tool_result'; tool: string; result: unknown }
    | { type: 'final'; output: string }
    | { type: 'error'; error: string }
  > {
    type AgentEvent =
      | { type: 'thinking'; content: string }
      | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
      | { type: 'tool_result'; tool: string; result: unknown }
      | { type: 'final'; output: string }
      | { type: 'error'; error: string };

    const tokenStream = createStreamIterable<StreamToken>('agent.run', options);

    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        const tokenIterator = tokenStream[Symbol.asyncIterator]();

        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            while (true) {
              const result = await tokenIterator.next();
              
              if (result.done) {
                return { done: true, value: undefined };
              }

              const token = result.value;
              
              if (token.type === 'done') {
                return { done: true, value: undefined };
              }

              if (token.type === 'error') {
                return {
                  done: false,
                  value: { type: 'error', error: token.error?.message || 'Unknown error' },
                };
              }

              if (token.type === 'token' && token.token) {
                try {
                  // Parse the JSON event from the token
                  const event = JSON.parse(token.token) as AgentEvent;
                  return { done: false, value: event };
                } catch {
                  // If it's not JSON, skip this token
                  continue;
                }
              }
            }
          },

          async return(): Promise<IteratorResult<AgentEvent>> {
            await tokenIterator.return?.();
            return { done: true, value: undefined };
          },
        };
      },
    };
  },

  // Session management API (explicit sessions)
  sessions: Object.freeze({
    /**
     * Create an explicit session with specified capabilities.
     * 
     * @example
     * const session = await agent.sessions.create({
     *   name: 'Recipe Assistant',
     *   capabilities: {
     *     llm: { provider: 'ollama' },
     *     tools: ['time-wasm/time.now'],
     *   },
     *   limits: { maxToolCalls: 10 },
     * });
     * 
     * const response = await session.prompt('What time is it?');
     */
    async create(options: CreateSessionOptions): Promise<AgentSession> {
      const result = await sendRequest<CreateSessionResult>('agent.sessions.create', options);
      
      if (!result.success || !result.sessionId || !result.capabilities) {
        const errorMsg = result.error?.message || 'Session creation failed';
        throw new Error(errorMsg);
      }
      
      return createAgentSessionObject(result.sessionId, result.capabilities);
    },

    /**
     * Get a session by ID.
     */
    async get(sessionId: string): Promise<SessionSummary | null> {
      return sendRequest<SessionSummary | null>('agent.sessions.get', { sessionId });
    },

    /**
     * List active sessions for this origin.
     */
    async list(): Promise<SessionSummary[]> {
      return sendRequest<SessionSummary[]>('agent.sessions.list');
    },

    /**
     * Terminate a session.
     */
    async terminate(sessionId: string): Promise<boolean> {
      const result = await sendRequest<{ terminated: boolean }>('agent.sessions.terminate', { sessionId });
      return result.terminated;
    },
  }),
});

// =============================================================================
// Register Global APIs
// =============================================================================

/**
 * Safely define a property on window.
 */
function safeDefineProperty(
  name: string,
  value: unknown,
): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) {
      console.debug(`[Web Agents API] Skipping ${name} - already defined`);
      return false;
    }

    Object.defineProperty(window, name, {
      value,
      writable: false,
      configurable: true,
      enumerable: true,
    });
    return true;
  } catch (error) {
    console.debug(`[Web Agents API] Could not define window.${name}:`, error);
    return false;
  }
}

try {
  // Check if Chrome AI is already present
  const existingAi = (window as { ai?: unknown }).ai;
  const chromeAiDetected = existingAi !== undefined && existingAi !== null;

  // Register window.ai (skip if Chrome AI is present)
  if (!chromeAiDetected) {
    safeDefineProperty('ai', aiApi);
  } else {
    console.debug('[Web Agents API] Chrome AI detected, window.ai not overridden.');
  }

  // Register window.agent
  const existingAgent = (window as { agent?: unknown }).agent;
  if (existingAgent === undefined) {
    safeDefineProperty('agent', agentApi);
  }

  // Dispatch ready event
  window.dispatchEvent(
    new CustomEvent('agent-ready', {
      detail: {
        version: '1.0.0',
        chromeAiDetected,
      },
    }),
  );
} catch (error) {
  console.warn('[Web Agents API] Failed to register API', error);
}
