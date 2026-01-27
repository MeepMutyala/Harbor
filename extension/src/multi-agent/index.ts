/**
 * Multi-Agent Module
 * 
 * Extension 3: Multi-Agent Support
 * 
 * This module provides:
 * - Ephemeral agent registration
 * - Agent discovery (local + cross-origin)
 * - Inter-agent messaging
 * - Task invocation
 * - Permission inheritance
 * - Resource tracking
 * - Orchestration patterns (pipeline, parallel, router)
 */

// Types
export * from './types';

// Registry
export {
  registerAgent,
  unregisterAgent,
  getAgent,
  getAgentsByOrigin,
  updateAgentStatus,
  touchAgent,
  cleanupTabAgents,
  cleanupOriginAgents,
  discoverAgents,
  listAllAgents,
  getAgentUsage,
  recordPrompt,
  recordToolCall,
  recordMessageSent,
  recordInvocationMade,
  recordInvocationReceived,
  initializeAgentRegistry,
} from './registry';

// Messaging
export {
  registerMessageHandler,
  unregisterMessageHandler,
  registerInvocationHandler,
  unregisterInvocationHandler,
  subscribeToEvent,
  unsubscribeFromEvent,
  unsubscribeFromAllEvents,
  sendMessage,
  invokeAgent,
  broadcastEvent,
  cleanupAgentHandlers,
} from './messaging';

// Permissions
export {
  calculateEffectivePermissions,
  checkInvocationPermission,
  createInvocationContext,
  checkContextPermission,
  checkContextToolAccess,
  type InvocationContext,
} from './permissions';

// Orchestration
export {
  executePipeline,
  executeParallel,
  executeRouter,
  executeSupervisor,
  createSimplePipeline,
  createBroadcastExecution,
  createSupervisor,
  type PipelineStepResult,
  type PipelineResult,
  type ParallelTaskResult,
  type ParallelResult,
  type RouterResult,
} from './orchestration';

// Remote A2A
export {
  connectRemoteAgent,
  disconnectRemoteAgent,
  getRemoteAgent,
  listRemoteAgents,
  pingRemoteAgent,
  invokeRemoteAgent,
  sendRemoteMessage,
  getRemoteAgentSummaries,
  discoverRemoteAgents,
} from './remote';

/**
 * Initialize the multi-agent system.
 */
export function initializeMultiAgentSystem(): void {
  const { initializeAgentRegistry } = require('./registry');
  initializeAgentRegistry();
  console.log('[MultiAgent] System initialized');
}
