import { validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import type { HistoryEntry } from './history-sync';

// The history routes of Wispra Cloud (wispra-web docs/HISTORY_API.md) and the account's usage

export class CloudUnavailable extends Error {}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const token = await validToken();
  if (!token) throw new CloudUnavailable('Not signed in to Wispra Cloud');
  const response = await fetch(`${cloud.apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  // A Wispra Cloud without these routes yet answers 404: nothing to do until it has them
  if (response.status === 404) throw new CloudUnavailable('Wispra Cloud has no shared history yet');
  return response;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  // The page holds the whole history
  complete: boolean;
}

// The newest entries of the signed-in user's cloud history
export async function readHistory(limit = 500): Promise<HistoryPage> {
  const response = await call(`/api/history?limit=${limit}`);
  if (!response.ok) throw new Error(`Reading the shared history failed (HTTP ${response.status}).`);
  const body = (await response.json()) as { entries?: HistoryEntry[]; nextBefore?: string | null };
  return { entries: Array.isArray(body.entries) ? body.entries : [], complete: !body.nextBefore };
}

// Adds or updates entries by id; never deletes anything in the cloud
export async function mergeHistory(entries: HistoryEntry[]): Promise<void> {
  const response = await call('/api/history/merge', { method: 'POST', body: JSON.stringify({ entries }) });
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // No JSON body
    }
    throw new Error(detail || `Sharing the history failed (HTTP ${response.status}).`);
  }
}

export interface Usage {
  plan: string;
  unlimited: boolean;
  usageSeconds: number;
  limitSeconds: number | null;
  aiTokensUsed: number | null;
  aiTokensLimit: number | null;
}

export async function readUsage(): Promise<Usage> {
  const response = await call('/api/usage');
  if (!response.ok) throw new Error(`Reading the usage failed (HTTP ${response.status}).`);
  const b = (await response.json()) as Partial<Usage>;
  return {
    plan: typeof b.plan === 'string' ? b.plan : 'free',
    unlimited: b.unlimited === true,
    usageSeconds: typeof b.usageSeconds === 'number' ? b.usageSeconds : 0,
    limitSeconds: typeof b.limitSeconds === 'number' ? b.limitSeconds : null,
    aiTokensUsed: typeof b.aiTokensUsed === 'number' ? b.aiTokensUsed : null,
    aiTokensLimit: typeof b.aiTokensLimit === 'number' ? b.aiTokensLimit : null,
  };
}
