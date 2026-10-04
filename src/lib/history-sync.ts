// Two-way sharing of dictation history with Wispra on the computer, through Wispra Cloud
// (wispra-web docs/HISTORY_API.md): the phone merges its own dictations into the cloud history and
// shows the computer's there too. The phone's own entries always stay on the phone: the cloud is
// never the only copy (the computer's /api/sync can replace the cloud list). Pure functions only.

import { cloudId, MOBILE_ID_PREFIX, type Entry } from './entries';

// The shape the history routes take and give
export interface HistoryEntry {
  id: string;
  text: string;
  rawText?: string | null;
  createdAt: string;
  app?: string | null;
  topic?: string | null;
  language?: string | null;
  durationSeconds?: number | null;
}

// Where a dictation typed in the Wispra app itself says it was made
export const PHONE_APP_NAME = 'Wispra (phone)';

// The phone's dictations that the cloud should have: transcribed, with text, made on the phone
export function isShareable(entry: Entry): boolean {
  return entry.kind === 'dictation' && entry.source !== 'computer' && entry.status === 'done' && !!entry.text?.trim();
}

export function toHistoryEntry(entry: Entry): HistoryEntry {
  return {
    id: cloudId(entry.id),
    text: entry.text!.trim(),
    rawText: null,
    createdAt: entry.createdAt,
    app: entry.title && entry.title !== 'Dictation' ? entry.title.slice(0, 200) : PHONE_APP_NAME,
    durationSeconds: entry.durationMs > 0 ? Math.round(entry.durationMs / 100) / 10 : null,
  };
}

// A dictation made on the computer, as an entry in the phone's History
export function fromHistoryEntry(h: HistoryEntry): Entry {
  return {
    id: h.id,
    kind: 'dictation',
    title: h.app?.trim() || 'Computer',
    createdAt: h.createdAt,
    durationMs: typeof h.durationSeconds === 'number' && h.durationSeconds > 0 ? Math.round(h.durationSeconds * 1000) : 0,
    status: 'done',
    audioUri: null,
    text: h.text,
    error: null,
    bookmarks: [],
    source: 'computer',
  };
}

export function isPhoneId(id: string): boolean {
  return id.startsWith(MOBILE_ID_PREFIX);
}

export interface SyncPlan {
  // Computer dictations to add to the phone, or whose text changed on the computer
  upserts: Entry[];
  // The phone's dictations to merge into the cloud
  push: Entry[];
}

/**
 * What to do after reading the newest page of the cloud history.
 * - Computer entries (ids without "mobile-") are added, or updated when their text changed;
 *   ones the user removed on the phone (hidden) stay away.
 * - The phone's shareable entries are pushed when never pushed, or when the cloud should have
 *   them (created within the page that was read) but does not: the computer's sync replaced the
 *   cloud list since.
 */
export function planSync(local: Entry[], cloud: HistoryEntry[], hidden: ReadonlySet<string>, pageIsComplete: boolean): SyncPlan {
  const byId = new Map(local.map((e) => [e.id, e]));
  const upserts: Entry[] = [];
  for (const h of cloud) {
    if (isPhoneId(h.id) || hidden.has(h.id) || !h.text?.trim()) continue;
    const mine = byId.get(h.id);
    if (!mine) upserts.push(fromHistoryEntry(h));
    else if (mine.source === 'computer' && mine.text !== h.text) upserts.push({ ...mine, text: h.text, title: h.app?.trim() || mine.title });
  }

  const inCloud = new Set(cloud.map((h) => h.id));
  // The oldest moment the page covers; everything newer than it should be in the page
  const oldest = pageIsComplete ? '' : cloud.reduce((min, h) => (h.createdAt < min ? h.createdAt : min), '￿');
  const push = local.filter((e) => {
    if (!isShareable(e)) return false;
    if (!e.syncedAt) return true;
    return !inCloud.has(cloudId(e.id)) && e.createdAt >= oldest;
  });
  return { upserts, push };
}

// Merge requests take at most 500 entries
export function batches<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
