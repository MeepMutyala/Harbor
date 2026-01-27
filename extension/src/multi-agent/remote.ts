/**
 * Remote A2A Protocol Client
 * 
 * Enables connection to agents running on external servers.
 * 
 * Protocol: Simple JSON-RPC over HTTP/HTTPS
 * 
 * Endpoints:
 * - GET  /agent-info     - Get agent metadata
 * - POST /invoke         - Invoke the agent with a task
 * - POST /message        - Send a message to the agent
 * - GET  /health         - Check if agent is reachable
 */

import type {
  AgentId,
  RemoteAgentEndpoint,
  RemoteAgentInfo,
  AgentInvocationRequest,
  AgentInvocationResponse,
  AgentSummary,
} from './types';

// Connected remote agents
const remoteAgents = new Map<AgentId, RemoteAgentInfo>();

// Remote agent ID counter
let remoteIdCounter = 0;

function generateRemoteId(): AgentId {
  return `remote-${Date.now()}-${++remoteIdCounter}`;
}

/**
 * Connect to a remote agent endpoint.
 */
export async function connectRemoteAgent(
  endpoint: RemoteAgentEndpoint,
  headers?: Record<string, string>,
): Promise<RemoteAgentInfo | null> {
  try {
    // Fetch agent info
    const infoUrl = new URL('/agent-info', endpoint.url).toString();
    const response = await fetch(infoUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...getAuthHeaders(endpoint),
        ...headers,
      },
    });

    if (!response.ok) {
      console.warn('[RemoteA2A] Failed to connect to', endpoint.url, response.status);
      return null;
    }

    const info = await response.json() as {
      name: string;
      description?: string;
      capabilities?: string[];
    };

    const id = generateRemoteId();
    const remoteAgent: RemoteAgentInfo = {
      id,
      name: info.name,
      description: info.description,
      capabilities: info.capabilities || [],
      endpoint,
      reachable: true,
      lastPing: Date.now(),
    };

    remoteAgents.set(id, remoteAgent);
    console.log('[RemoteA2A] Connected to remote agent:', id, info.name);

    return remoteAgent;
  } catch (error) {
    console.warn('[RemoteA2A] Connection failed:', error);
    return null;
  }
}

/**
 * Disconnect from a remote agent.
 */
export function disconnectRemoteAgent(agentId: AgentId): boolean {
  return remoteAgents.delete(agentId);
}

/**
 * Get a connected remote agent.
 */
export function getRemoteAgent(agentId: AgentId): RemoteAgentInfo | undefined {
  return remoteAgents.get(agentId);
}

/**
 * List all connected remote agents.
 */
export function listRemoteAgents(): RemoteAgentInfo[] {
  return Array.from(remoteAgents.values());
}

/**
 * Check if a remote agent is reachable.
 */
export async function pingRemoteAgent(agentId: AgentId): Promise<boolean> {
  const agent = remoteAgents.get(agentId);
  if (!agent) return false;

  try {
    const healthUrl = new URL('/health', agent.endpoint.url).toString();
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: getAuthHeaders(agent.endpoint),
    });

    agent.reachable = response.ok;
    agent.lastPing = Date.now();

    return response.ok;
  } catch {
    agent.reachable = false;
    return false;
  }
}

/**
 * Invoke a remote agent.
 */
export async function invokeRemoteAgent(
  agentId: AgentId,
  request: AgentInvocationRequest,
): Promise<AgentInvocationResponse> {
  const startTime = Date.now();
  const agent = remoteAgents.get(agentId);

  if (!agent) {
    return {
      success: false,
      error: { code: 'ERR_AGENT_NOT_FOUND', message: 'Remote agent not connected' },
      executionTime: Date.now() - startTime,
    };
  }

  try {
    const invokeUrl = new URL('/invoke', agent.endpoint.url).toString();
    const response = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...getAuthHeaders(agent.endpoint),
      },
      body: JSON.stringify({
        task: request.task,
        input: request.input,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: 'ERR_REMOTE_FAILED',
          message: `Remote agent returned ${response.status}: ${response.statusText}`,
        },
        executionTime: Date.now() - startTime,
      };
    }

    const result = await response.json() as {
      success: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    };

    agent.lastPing = Date.now();
    agent.reachable = true;

    return {
      success: result.success,
      result: result.result,
      error: result.error,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    agent.reachable = false;
    return {
      success: false,
      error: {
        code: 'ERR_NETWORK',
        message: error instanceof Error ? error.message : 'Network error',
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * Send a message to a remote agent.
 */
export async function sendRemoteMessage(
  agentId: AgentId,
  payload: unknown,
): Promise<{ delivered: boolean; error?: string }> {
  const agent = remoteAgents.get(agentId);

  if (!agent) {
    return { delivered: false, error: 'Remote agent not connected' };
  }

  try {
    const messageUrl = new URL('/message', agent.endpoint.url).toString();
    const response = await fetch(messageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...getAuthHeaders(agent.endpoint),
      },
      body: JSON.stringify({ payload }),
    });

    agent.lastPing = Date.now();
    agent.reachable = response.ok;

    if (!response.ok) {
      return {
        delivered: false,
        error: `Remote agent returned ${response.status}`,
      };
    }

    return { delivered: true };
  } catch (error) {
    agent.reachable = false;
    return {
      delivered: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
 * Convert remote agents to AgentSummary format for discovery.
 */
export function getRemoteAgentSummaries(): AgentSummary[] {
  return Array.from(remoteAgents.values())
    .filter(a => a.reachable)
    .map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      origin: new URL(a.endpoint.url).origin,
      capabilities: a.capabilities,
      tags: ['remote'],
      acceptsInvocations: true,
      acceptsMessages: true,
      sameOrigin: false,
      isRemote: true,
    }));
}

/**
 * Get auth headers for a remote endpoint.
 */
function getAuthHeaders(endpoint: RemoteAgentEndpoint): Record<string, string> {
  // Auth headers would be configured per-endpoint
  // For now, return empty - in production, this would look up stored credentials
  return {};
}

/**
 * Discover remote agents from a well-known URL.
 * 
 * Some servers may publish a list of available agents at /.well-known/agents
 */
export async function discoverRemoteAgents(
  baseUrl: string,
): Promise<Array<{ name: string; url: string; description?: string }>> {
  try {
    const discoveryUrl = new URL('/.well-known/agents', baseUrl).toString();
    const response = await fetch(discoveryUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      agents?: Array<{ name: string; url: string; description?: string }>;
    };

    return data.agents || [];
  } catch {
    return [];
  }
}
