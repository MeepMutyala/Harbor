/**
 * Session Management Module
 *
 * Provides centralized session tracking for all agent sessions.
 * Sessions are the unit of permission enforcement - each session has
 * specific capabilities that are bounded by the origin's permissions.
 */

export { SessionRegistry } from './registry';

export type {
  AgentSession,
  SessionCapabilities,
  SessionSummary,
  CreateSessionOptions,
  CreateSessionResult,
} from './registry';

export type {
  LLMCapabilities,
  ToolCapabilities,
  BrowserCapabilities,
  SessionLimits,
  SessionStatus,
  SessionType,
  SessionOptions,
  SessionUsage,
  SessionEvent,
  SessionEventListener,
  ListSessionsOptions,
} from './types';

export {
  CAPABILITY_TO_SCOPES,
  getDefaultImplicitCapabilities,
  buildCapabilitiesFromRequest,
} from './types';
