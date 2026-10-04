import { currentSession, validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import type { HistoryEntry } from './history-sync';

// The history routes of Wispra Cloud (wispra-web docs/HISTORY_API.md) and the account's usage

export class CloudUnavailable extends Error {}

// The signed-in account is no longer the one a request was made for: nothing is sent
export class AccountChanged extends Error {
  constructor() {
    super('The Wispra account changed. Nothing was sent for the previous account.');
  }
}

// `asUser`: the request belongs to that account. If another account is signed in by the time the
// token is read, the request is not sent, so one account's deletion never goes out with another's
// sign-in.
async function call(path: string, init?: RequestInit, asUser?: string): Promise<Response> {
  const token = await validToken();
  if (!token) throw new CloudUnavailable('Not signed in to Wispra Cloud');
  if (asUser !== undefined && currentSession()?.userId !== asUser) throw new AccountChanged();
  return fetch(`${cloud.apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

// The phone could not reach Wispra Cloud at all. React Native's fetch rejects with this TypeError
// when there is no connection; any other error (a bug included) is not taken for a network problem.
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /network request failed|failed to fetch|network error|internet connection/i.test(err.message);
}

// A Wispra Cloud without these routes yet answers 404: nothing to do until it has them
function unlessMissing(response: Response): Response {
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
export async function readHistory(since: string | null, asUser?: string, limit = 500): Promise<HistoryPage> {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
  const response = unlessMissing(await call(`/api/history?limit=${limit}${sinceParam}`, undefined, asUser));
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
export async function mergeHistory(entries: HistoryEntry[], asUser?: string): Promise<void> {
  const response = unlessMissing(await call('/api/history/merge', { method: 'POST', body: JSON.stringify({ entries }) }, asUser));
  if (!response.ok) throw new Error(await errorFrom(response, 'Sharing the history failed'));
}

const NO_DELETE_ROUTES = 'Wispra Cloud cannot delete yet. Deletions wait on this phone.';

// What became of one deletion:
// - deleted: Wispra Cloud has it (also when the entry was not there: the mark is recorded anyway)
// - skip: Wispra Cloud refuses this id for good (400, or a 404 about the id): it leaves the queue
// - retry: a server error; the id stays for the next sync, and the next ids are still sent
export type DeleteOutcome = 'deleted' | 'skip' | 'retry';

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('application/json');
}

// Deletes one entry, phone or computer, on every device of the account. Throws CloudUnavailable
// while the delete routes are not live: a missing route answers Next.js's 404 page (HTML), unlike
// an answer of the route about one id (JSON).
export async function deleteHistoryEntry(id: string, asUser: string): Promise<DeleteOutcome> {
  const response = await call(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }, asUser);
  if (response.ok) return 'deleted';
  if (response.status === 405 || (response.status === 404 && !isJson(response))) throw new CloudUnavailable(NO_DELETE_ROUTES);
  if (response.status === 400 || response.status === 404) return 'skip';
  if (response.status >= 500) return 'retry';
  throw new Error(await errorFrom(response, 'Deleting from the shared history failed'));
}

// Deletes the whole history on every device of the account; returns the server's clearedAt
export async function deleteAllHistory(asUser: string): Promise<string | null> {
  const response = await call('/api/history', { method: 'DELETE', body: JSON.stringify({ all: true }) }, asUser);
  if (response.status === 405 || response.status === 404) throw new CloudUnavailable('Wispra Cloud cannot delete everything yet. Nothing was deleted.');
  if (!response.ok) throw new Error(await errorFrom(response, 'Deleting the shared history failed'));
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
  const response = unlessMissing(await call('/api/usage'));
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
