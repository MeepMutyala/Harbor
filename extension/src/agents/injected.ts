/**
 * Web Agent API - Injected Script
 *
 * This script is injected into web pages to expose:
 * - window.ai - Text generation API (Chrome Prompt API compatible)
 * - window.agent - Tools, browser access, and autonomous agent capabilities
 * - window.harbor - Guaranteed namespace with direct access to Harbor APIs
 */

// =============================================================================
// Types (subset needed for injected context)
// =============================================================================

type PermissionScope =
  | 'model:prompt'
  | 'model:tools'
  | 'model:list'
  | 'mcp:tools.list'
  | 'mcp:tools.call'
  | 'mcp:servers.register'
  | 'browser:activeTab.read'
  | 'chat:open'
  | 'web:fetch';

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
  top_p?: number;
  systemPrompt?: string;
}

interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{ role: string; content: string }>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

interface StreamToken {
  type: 'token' | 'done' | 'error';
  token?: string;
  error?: { code: string; message: string };
}

interface LLMProviderInfo {
  id: string;
  name: string;
  available: boolean;
  baseUrl?: string;
  models?: string[];
  isDefault: boolean;
  supportsTools?: boolean;
}

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId?: string;
}

interface ActiveTabReadability {
  url: string;
  title: string;
  text: string;
}

type RunEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; result?: unknown; error?: { code: string; message: string } }
  | { type: 'token'; token: string }
  | { type: 'final'; output: string; citations?: Array<{ source: string; ref: string; excerpt: string }> }
  | { type: 'error'; error: { code: string; message: string } };

interface DeclaredMCPServer {
  url: string;
  title: string;
  description?: string;
  tools?: string[];
  transport?: 'sse' | 'websocket';
}

// =============================================================================
// Transport Layer
// =============================================================================

const CHANNEL = 'harbor_web_agent';

type MessageType = string;

interface TransportResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface TransportStreamEvent {
  id: string;
  event: RunEvent | StreamToken;
  done?: boolean;
}

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

const streamListeners = new Map<string, (event: RunEvent | StreamToken, done: boolean) => void>();

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

function sendRequest<T>(type: MessageType, payload?: unknown): Promise<T> {
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

function createStreamIterable<T extends RunEvent | StreamToken>(
  type: MessageType,
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
          error = new Error((event as { error?: { message: string } }).error?.message || 'Stream error');
          (error as Error & { code?: string }).code =
            (event as { error?: { code: string } }).error?.code || 'ERR_INTERNAL';
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

function createTextSessionObject(sessionId: string, options: TextSessionOptions) {
  return Object.freeze({
    sessionId,

    async prompt(input: string): Promise<string> {
      return sendRequest<string>('session.prompt', { sessionId, input });
    },

    promptStreaming(input: string): AsyncIterable<StreamToken> {
      return createStreamIterable<StreamToken>('session.promptStreaming', { sessionId, input });
    },

    async destroy(): Promise<void> {
      await sendRequest('session.destroy', { sessionId });
    },

    async clone(): Promise<typeof this> {
      const newSessionId = await sendRequest<string>('session.clone', { sessionId });
      return createTextSessionObject(newSessionId, options);
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

  async createTextSession(options: TextSessionOptions = {}) {
    const sessionId = await sendRequest<string>('ai.createTextSession', options);
    return createTextSessionObject(sessionId, options);
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

    async create(options: AILanguageModelCreateOptions = {}) {
      const sessionOptions: TextSessionOptions = {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
      };
      const sessionId = await sendRequest<string>('ai.languageModel.create', {
        ...sessionOptions,
        initialPrompts: options.initialPrompts,
        topK: options.topK,
      });
      return createTextSessionObject(sessionId, sessionOptions);
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

  runtime: Object.freeze({
    get harbor() {
      return aiApi;
    },

    get chrome() {
      // Return Chrome's built-in AI if available
      return (window as { ai?: unknown }).ai !== aiApi ? (window as { ai?: unknown }).ai : null;
    },

    async getBest(): Promise<'harbor' | 'chrome' | null> {
      const harborAvailable = await aiApi.canCreateTextSession();
      if (harborAvailable === 'readily') return 'harbor';

      const chromeAi = this.chrome;
      if (chromeAi && typeof chromeAi === 'object' && 'canCreateTextSession' in chromeAi) {
        try {
          const chromeAvailable = await (chromeAi as { canCreateTextSession: () => Promise<string> }).canCreateTextSession();
          if (chromeAvailable === 'readily') return 'chrome';
        } catch {
          // Chrome AI not available
        }
      }

      return harborAvailable !== 'no' ? 'harbor' : null;
    },
  }),
});

// =============================================================================
// window.agent Implementation
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

    async call(options: { tool: string; args: Record<string, unknown> }): Promise<unknown> {
      return sendRequest('agent.tools.call', options);
    },
  }),

  browser: Object.freeze({
    activeTab: Object.freeze({
      async readability(): Promise<ActiveTabReadability> {
        return sendRequest<ActiveTabReadability>('agent.browser.activeTab.readability');
      },
    }),
  }),

  run(options: {
    task: string;
    tools?: string[];
    provider?: string;
    useAllTools?: boolean;
    requireCitations?: boolean;
    maxToolCalls?: number;
    signal?: AbortSignal;
  }): AsyncIterable<RunEvent> {
    // Handle AbortSignal
    const { signal, ...rest } = options;
    const iterable = createStreamIterable<RunEvent>('agent.run', rest);

    if (signal) {
      // Wrap the iterable to handle abort
      return {
        [Symbol.asyncIterator]() {
          const iterator = iterable[Symbol.asyncIterator]();

          signal.addEventListener('abort', () => {
            iterator.return?.();
          });

          return {
            next: () => {
              if (signal.aborted) {
                return Promise.resolve({ done: true, value: undefined } as IteratorResult<RunEvent>);
              }
              return iterator.next();
            },
            return: () => iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
          };
        },
      };
    }

    return iterable;
  },

  // BYOC (Bring Your Own Chatbot) APIs
  mcp: Object.freeze({
    async discover(): Promise<DeclaredMCPServer[]> {
      // Discover <link rel="mcp-server"> elements in the current page
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel="mcp-server"]');
      const servers: DeclaredMCPServer[] = [];

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.getAttribute('title');
        if (href && title) {
          servers.push({
            url: new URL(href, window.location.href).toString(),
            title,
            description: link.dataset.description,
            tools: link.dataset.tools?.split(',').map((t) => t.trim()),
            transport: (link.dataset.transport as 'sse' | 'websocket') || 'sse',
          });
        }
      }

      return servers;
    },

    async register(options: {
      url: string;
      name: string;
      description?: string;
      tools?: string[];
      transport?: 'sse' | 'websocket';
    }): Promise<{ success: boolean; serverId?: string; error?: { code: string; message: string } }> {
      return sendRequest('agent.mcp.register', options);
    },

    async unregister(serverId: string): Promise<{ success: boolean }> {
      return sendRequest('agent.mcp.unregister', { serverId });
    },
  }),

  chat: Object.freeze({
    async canOpen(): Promise<'readily' | 'no'> {
      return sendRequest<'readily' | 'no'>('agent.chat.canOpen');
    },

    async open(options?: {
      initialMessage?: string;
      systemPrompt?: string;
      tools?: string[];
      sessionId?: string;
      style?: {
        theme?: 'light' | 'dark' | 'auto';
        accentColor?: string;
        position?: 'right' | 'left' | 'center';
      };
    }): Promise<{ success: boolean; chatId?: string; error?: { code: string; message: string } }> {
      return sendRequest('agent.chat.open', options);
    },

    async close(chatId?: string): Promise<{ success: boolean }> {
      return sendRequest('agent.chat.close', { chatId });
    },
  }),

  // Address Bar API
  addressBar: createAddressBarAPI(),
  
  // Command Bar is an alias for Address Bar
  get commandBar() {
    return this.addressBar;
  },
});

// =============================================================================
// Address Bar API Implementation
// =============================================================================

interface AddressBarTrigger {
  type: 'prefix' | 'keyword' | 'regex' | 'always';
  value: string;
  hint?: string;
}

interface AddressBarSuggestion {
  id: string;
  type: 'url' | 'search' | 'tool' | 'action' | 'answer';
  title: string;
  description?: string;
  icon?: string;
  url?: string;
  searchQuery?: string;
  searchEngine?: string;
  tool?: { name: string; args: Record<string, unknown> };
  action?: unknown;
  answer?: { text: string; source?: string; copyable?: boolean };
  confidence?: number;
  provider: string;
}

interface AddressBarQueryContext {
  query: string;
  trigger: AddressBarTrigger;
  currentTab?: { url: string; title: string; domain: string };
  recentHistory?: { url: string; title: string; visitCount: number; lastVisit: number }[];
  isTyping: boolean;
  timeSinceLastKeystroke: number;
}

interface AddressBarProviderOptions {
  id: string;
  name: string;
  description: string;
  triggers: AddressBarTrigger[];
  onQuery: (context: AddressBarQueryContext) => Promise<AddressBarSuggestion[]>;
  onSelect?: (suggestion: AddressBarSuggestion) => Promise<unknown>;
}

interface ToolShortcut {
  trigger: string;
  tool: string;
  description: string;
  examples?: string[];
  argParser?: (query: string) => Record<string, unknown>;
  useLLMParser?: boolean;
  llmParserPrompt?: string;
}

interface ToolShortcutsOptions {
  shortcuts: ToolShortcut[];
  resultHandler: 'inline' | 'popup' | 'navigate' | 'clipboard';
}

interface SiteProviderOptions {
  origin: string;
  name: string;
  description: string;
  patterns: string[];
  icon?: string;
  endpoint?: string;
  onQuery?: (query: string) => Promise<AddressBarSuggestion[]>;
}

// Store registered callbacks for AI providers
const providerCallbacks = new Map<string, {
  onQuery: (context: AddressBarQueryContext) => Promise<AddressBarSuggestion[]>;
  onSelect?: (suggestion: AddressBarSuggestion) => Promise<unknown>;
}>();

function createAddressBarAPI() {
  // Listen for query requests from background
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window) return;
    
    const data = event.data as {
      channel?: string;
      addressBarQuery?: {
        id: string;
        providerId: string;
        context: AddressBarQueryContext;
      };
    };
    
    if (data?.channel !== 'harbor_web_agent' || !data.addressBarQuery) return;
    
    const { id, providerId, context } = data.addressBarQuery;
    const callbacks = providerCallbacks.get(providerId);
    
    if (callbacks) {
      try {
        const suggestions = await callbacks.onQuery(context);
        window.postMessage({
          channel: 'harbor_web_agent',
          addressBarResponse: { id, suggestions },
        }, '*');
      } catch (error) {
        window.postMessage({
          channel: 'harbor_web_agent',
          addressBarResponse: {
            id,
            error: error instanceof Error ? error.message : 'Query failed',
          },
        }, '*');
      }
    }
  });

  return Object.freeze({
    async canProvide(): Promise<'readily' | 'no'> {
      return sendRequest<'readily' | 'no'>('agent.addressBar.canProvide');
    },

    async registerProvider(options: AddressBarProviderOptions): Promise<{ providerId: string }> {
      // Store callbacks locally
      providerCallbacks.set(options.id, {
        onQuery: options.onQuery,
        onSelect: options.onSelect,
      });

      // Register with background (without the function callbacks)
      return sendRequest<{ providerId: string }>('agent.addressBar.registerProvider', {
        id: options.id,
        name: options.name,
        description: options.description,
        triggers: options.triggers,
      });
    },

    async registerToolShortcuts(options: ToolShortcutsOptions): Promise<{ registered: string[] }> {
      // Convert argParser functions to string identifiers for serialization
      const serializedShortcuts = options.shortcuts.map((s) => ({
        trigger: s.trigger,
        tool: s.tool,
        description: s.description,
        examples: s.examples,
        // Store the parser type, not the function
        argParser: s.argParser ? 'custom' : undefined,
        useLLMParser: s.useLLMParser,
        llmParserPrompt: s.llmParserPrompt,
      }));

      // Store custom parsers locally if needed
      for (const shortcut of options.shortcuts) {
        if (shortcut.argParser) {
          const key = `argParser-${shortcut.trigger}`;
          (window as unknown as Record<string, unknown>)[key] = shortcut.argParser;
        }
      }

      return sendRequest<{ registered: string[] }>('agent.addressBar.registerToolShortcuts', {
        shortcuts: serializedShortcuts,
        resultHandler: options.resultHandler,
      });
    },

    async registerSiteProvider(options: SiteProviderOptions): Promise<{ providerId: string }> {
      // Verify origin matches
      if (options.origin !== window.location.origin) {
        throw new Error('Origin must match current page origin');
      }

      // Store onQuery callback if provided
      if (options.onQuery) {
        const providerId = `site-${new URL(options.origin).hostname}`;
        providerCallbacks.set(providerId, {
          onQuery: async (ctx) => options.onQuery!(ctx.query),
        });
      }

      return sendRequest<{ providerId: string }>('agent.addressBar.registerSiteProvider', {
        origin: options.origin,
        name: options.name,
        description: options.description,
        patterns: options.patterns,
        icon: options.icon,
        endpoint: options.endpoint,
      });
    },

    async discover(): Promise<Array<{
      origin: string;
      name: string;
      description?: string;
      endpoint: string;
      patterns: string[];
      icon?: string;
    }>> {
      // Discover <link rel="addressbar-provider"> elements
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel="addressbar-provider"]');
      const providers: Array<{
        origin: string;
        name: string;
        description?: string;
        endpoint: string;
        patterns: string[];
        icon?: string;
      }> = [];

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.getAttribute('title');
        if (href && title) {
          providers.push({
            origin: window.location.origin,
            name: title,
            description: link.dataset.description,
            endpoint: new URL(href, window.location.href).toString(),
            patterns: link.dataset.patterns?.split(',').map((p) => p.trim()) || [],
            icon: link.dataset.icon,
          });
        }
      }

      return providers;
    },

    async listProviders(): Promise<Array<{
      id: string;
      name: string;
      description: string;
      triggers: AddressBarTrigger[];
      isDefault: boolean;
      origin?: string;
      type: 'ai' | 'tool' | 'site';
    }>> {
      return sendRequest('agent.addressBar.listProviders');
    },

    async unregisterProvider(providerId: string): Promise<void> {
      providerCallbacks.delete(providerId);
      return sendRequest('agent.addressBar.unregisterProvider', { providerId });
    },

    async setDefaultProvider(providerId: string): Promise<void> {
      return sendRequest('agent.addressBar.setDefaultProvider', { providerId });
    },

    async getDefaultProvider(): Promise<string | null> {
      return sendRequest<string | null>('agent.addressBar.getDefaultProvider');
    },
  });
}

// =============================================================================
// window.harbor Implementation (Guaranteed namespace)
// =============================================================================

const harborApi = Object.freeze({
  ai: aiApi,
  agent: agentApi,
  version: '1.0.0',
  chromeAiDetected: false, // Will be set after detection
});

// =============================================================================
// Register Global APIs
// =============================================================================

try {
  // Check if Chrome AI is already present
  const existingAi = (window as { ai?: unknown }).ai;
  const chromeAiDetected = existingAi !== undefined && existingAi !== null;

  // Update harbor with detection result
  Object.defineProperty(harborApi, 'chromeAiDetected', {
    value: chromeAiDetected,
    writable: false,
  });

  // Register window.ai (may override Chrome AI for unified experience)
  Object.defineProperty(window, 'ai', {
    value: aiApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Register window.agent
  Object.defineProperty(window, 'agent', {
    value: agentApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Register window.harbor (guaranteed namespace)
  Object.defineProperty(window, 'harbor', {
    value: harborApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  // Dispatch ready event
  window.dispatchEvent(
    new CustomEvent('harbor-provider-ready', {
      detail: {
        providers: {
          harbor: true,
          chrome: chromeAiDetected,
        },
      },
    }),
  );

  // Also dispatch agent-ready for spec compliance
  window.dispatchEvent(
    new CustomEvent('agent-ready', {
      detail: {
        providers: {
          harbor: true,
          chrome: chromeAiDetected,
        },
      },
    }),
  );
} catch (error) {
  console.warn('[Harbor] Failed to register Web Agent API', error);
}
