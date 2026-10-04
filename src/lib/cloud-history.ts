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
  // Ids deleted on any device since `since` (every deletion when it is not given)
  deleted: string[];
  // When the whole history was last deleted (server clock), or null
  clearedAt: string | null;
  // The server's time of this answer: the next `since`
  serverTime: string | null;
}

// The newest entries of the signed-in user's cloud history, and what was deleted since the last read
export async function readHistory(since: string | null, limit = 500): Promise<HistoryPage> {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
  const response = await call(`/api/history?limit=${limit}${sinceParam}`);
  if (!response.ok) throw new Error(`Reading the shared history failed (HTTP ${response.status}).`);
  const body = (await response.json()) as {
    entries?: HistoryEntry[];
    nextBefore?: string | null;
    deleted?: unknown;
    clearedAt?: unknown;
    serverTime?: unknown;
  };
  const deleted = Array.isArray(body.deleted) ? body.deleted : [];
  return {
    entries: Array.isArray(body.entries) ? body.entries : [],
    complete: !body.nextBefore,
    deleted: deleted
      .map((d: unknown) => (d && typeof d === 'object' ? (d as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string'),
    clearedAt: typeof body.clearedAt === 'string' ? body.clearedAt : null,
    serverTime: typeof body.serverTime === 'string' ? body.serverTime : null,
  };
}

// Adds or updates entries by id; never deletes anything in the cloud
export async function mergeHistory(entries: HistoryEntry[]): Promise<void> {
  const response = await call('/api/history/merge', { method: 'POST', body: JSON.stringify({ entries }) });
  if (!response.ok) throw new Error(await errorFrom(response, 'Sharing the history failed'));
}

// Before Wispra Cloud has the delete routes: /api/history/{id} does not exist (404) and
// /api/history takes no DELETE (405). The deletion then waits on the phone.
async function deleteCall(path: string, init: RequestInit): Promise<Response> {
  const response = await call(path, { ...init, method: 'DELETE' });
  if (response.status === 405) throw new CloudUnavailable('Wispra Cloud cannot delete yet. Deletions wait on this phone.');
  if (!response.ok) throw new Error(await errorFrom(response, 'Deleting from the shared history failed'));
  return response;
}

// Deletes one entry, phone or computer, on every device of the account
export async function deleteHistoryEntry(id: string): Promise<void> {
  await deleteCall(`/api/history/${encodeURIComponent(id)}`, {});
}

// Deletes the whole history on every device of the account; returns the server's clearedAt
export async function deleteAllHistory(): Promise<string | null> {
  const response = await deleteCall('/api/history', { body: JSON.stringify({ all: true }) });
  try {
    const body = (await response.json()) as { clearedAt?: unknown };
    return typeof body.clearedAt === 'string' ? body.clearedAt : null;
  } catch {
    return null;
  }
}

async function errorFrom(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // No JSON body
  }
  return `${fallback} (HTTP ${response.status}).`;
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
