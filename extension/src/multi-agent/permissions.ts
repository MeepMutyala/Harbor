/**
 * Multi-Agent Permission Inheritance
 * 
 * Implements permission inheritance for Extension 3.
 * 
 * Key principle: An invoked agent's effective permissions cannot exceed
 * those of the invoker. This prevents privilege escalation.
 * 
 * Permission calculation:
 * effectivePermissions = intersection(invokerPermissions, targetRequestedPermissions)
 */

import type { PermissionScope, PermissionGrant } from '../agents/types';
import type { EffectivePermissions, PermissionCheckResult } from './types';
import { getPermissionStatus, checkPermissions } from '../policy/permissions';
import { getAgent } from './registry';

/**
 * Calculate effective permissions for an invoked agent.
 * 
 * The invoked agent's permissions are bounded by the invoker's permissions.
 */
export async function calculateEffectivePermissions(
  invokerOrigin: string,
  invokerTabId: number | undefined,
  targetOrigin: string,
  targetTabId: number | undefined,
): Promise<EffectivePermissions> {
  // Get invoker's permissions
  const invokerStatus = await getPermissionStatus(invokerOrigin, invokerTabId);
  
  // Get target's permissions
  const targetStatus = await getPermissionStatus(targetOrigin, targetTabId);

  // Calculate intersection
  const effectiveScopes: Record<PermissionScope, PermissionGrant> = {} as Record<PermissionScope, PermissionGrant>;
  
  for (const scope of Object.keys(invokerStatus.scopes) as PermissionScope[]) {
    const invokerGrant = invokerStatus.scopes[scope];
    const targetGrant = targetStatus.scopes[scope];

    // Effective permission is the more restrictive of the two
    effectiveScopes[scope] = getMostRestrictive(invokerGrant, targetGrant);
  }

  // Allowed tools is intersection of both allowlists
  const invokerTools = new Set(invokerStatus.allowedTools || []);
  const targetTools = new Set(targetStatus.allowedTools || []);
  const effectiveTools = Array.from(invokerTools).filter(t => targetTools.has(t));

  return {
    scopes: effectiveScopes,
    allowedTools: effectiveTools,
  };
}

/**
 * Get the most restrictive permission grant.
 * Order (least to most permissive): denied < not-granted < granted-once < granted-always
 */
function getMostRestrictive(a: PermissionGrant, b: PermissionGrant): PermissionGrant {
  const order: Record<PermissionGrant, number> = {
    'denied': 0,
    'not-granted': 1,
    'granted-once': 2,
    'granted-always': 3,
  };

  return order[a] <= order[b] ? a : b;
}

/**
 * Check if an invocation is allowed based on permission inheritance.
 * 
 * The invoker must have the permissions it's trying to delegate to the target.
 */
export async function checkInvocationPermission(
  invokerAgentId: string,
  invokerOrigin: string,
  invokerTabId: number | undefined,
  targetAgentId: string,
  requiredScopes: PermissionScope[],
): Promise<PermissionCheckResult> {
  // Check that invoker has the required permissions
  const invokerCheck = await checkPermissions(invokerOrigin, requiredScopes, invokerTabId);
  
  if (!invokerCheck.granted) {
    return {
      granted: false,
      reason: `Invoker does not have required permissions: ${invokerCheck.missingScopes.join(', ')}`,
    };
  }

  // Get target agent
  const target = getAgent(targetAgentId);
  if (!target) {
    return {
      granted: false,
      reason: 'Target agent not found',
    };
  }

  // Check cross-origin if needed
  if (target.origin !== invokerOrigin) {
    const crossOriginCheck = await checkPermissions(invokerOrigin, ['agents:crossOrigin'], invokerTabId);
    if (!crossOriginCheck.granted) {
      return {
        granted: false,
        reason: 'Cross-origin invocation requires agents:crossOrigin permission',
      };
    }
  }

  // Calculate effective permissions
  const effective = await calculateEffectivePermissions(
    invokerOrigin,
    invokerTabId,
    target.origin,
    target.tabId,
  );

  return {
    granted: true,
    effective,
  };
}

/**
 * Create a permission context for an invoked agent.
 * This context should be passed to any operations the invoked agent performs.
 */
export interface InvocationContext {
  invokerAgentId: string;
  invokerOrigin: string;
  invokerTabId?: number;
  targetAgentId: string;
  effectivePermissions: EffectivePermissions;
  createdAt: number;
  expiresAt?: number;
}

/**
 * Create an invocation context for bounded permission execution.
 */
export async function createInvocationContext(
  invokerAgentId: string,
  invokerOrigin: string,
  invokerTabId: number | undefined,
  targetAgentId: string,
  ttlMs?: number,
): Promise<InvocationContext | null> {
  const target = getAgent(targetAgentId);
  if (!target) {
    return null;
  }

  const effective = await calculateEffectivePermissions(
    invokerOrigin,
    invokerTabId,
    target.origin,
    target.tabId,
  );

  const now = Date.now();

  return {
    invokerAgentId,
    invokerOrigin,
    invokerTabId,
    targetAgentId,
    effectivePermissions: effective,
    createdAt: now,
    expiresAt: ttlMs ? now + ttlMs : undefined,
  };
}

/**
 * Check if a permission is granted within an invocation context.
 */
export function checkContextPermission(
  context: InvocationContext,
  scope: PermissionScope,
): boolean {
  // Check if context has expired
  if (context.expiresAt && Date.now() > context.expiresAt) {
    return false;
  }

  const grant = context.effectivePermissions.scopes[scope];
  return grant === 'granted-once' || grant === 'granted-always';
}

/**
 * Check if a tool is allowed within an invocation context.
 */
export function checkContextToolAccess(
  context: InvocationContext,
  toolName: string,
): boolean {
  // Check if context has expired
  if (context.expiresAt && Date.now() > context.expiresAt) {
    return false;
  }

  return context.effectivePermissions.allowedTools.includes(toolName);
}
