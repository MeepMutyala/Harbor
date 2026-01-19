export type Capability =
  | 'network'
  | 'env'
  | 'filesystem'
  | 'llm';

type CapabilityGrant = {
  serverId: string;
  capabilities: Capability[];
};

const STORAGE_KEY = 'harbor_capability_grants';

export async function initializePolicyStore(): Promise<void> {
  await chrome.storage.local.get(STORAGE_KEY);
  console.log('[Harbor] Policy store ready (stub)');
}

export async function getCapabilityGrants(): Promise<CapabilityGrant[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as CapabilityGrant[]) || [];
}

export async function setCapabilityGrants(grants: CapabilityGrant[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: grants });
}
