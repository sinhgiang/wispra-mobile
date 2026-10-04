// Deleting with the history shared through Wispra Cloud (the owner's choice, W-0194): a dictation
// deleted on one device is deleted on every device signed in to the same account. The phone tells
// Wispra Cloud what it deleted, and deletes what other devices deleted (wispra-web
// docs/HISTORY_API.md, "Deleting"). Before anything is deleted the user sees exactly what will
// happen. Pure functions only; the order of the steps is in delete-sync.ts.

import { cloudId, type Entry } from './entries';

/**
 * The phone's deletion state for ONE Wispra account. Every account has its own (see DeletionBook):
 * a deletion made while signed in as A is only ever sent as A, waits while another account is
 * signed in, and is sent when A signs in again.
 */
export interface PendingDeletes {
  // The account this belongs to (null: nobody is signed in; such a state is never saved)
  userId: string | null;
  // Cloud ids deleted on this phone that Wispra Cloud has not confirmed yet (one at a time; a
  // delete-all is never queued: it needs a connection)
  ids: string[];
  // The server time of the last answer read from Wispra Cloud (sent back as `since`)
  since: string | null;
  // The last "delete everything" (clearedAt, server clock) already applied on this phone
  clearedHandled: string | null;
}

export function emptyPendingDeletes(userId: string | null): PendingDeletes {
  return { userId, ids: [], since: null, clearedHandled: null };
}

export const NO_PENDING_DELETES: PendingDeletes = emptyPendingDeletes(null);

/**
 * pending-deletes.json: the state of every account that used this phone, by user id. It is read as
 * it is when Wispra starts, before anyone is known to be signed in, and nothing is dropped then:
 * which account's state is used is decided at each use, from the account signed in at that moment.
 */
export type DeletionBook = Readonly<Record<string, PendingDeletes>>;

export const EMPTY_BOOK: DeletionBook = {};

// The state of the account signed in now (empty when it has none yet, or nobody is signed in)
export function stateOf(book: DeletionBook, userId: string | null): PendingDeletes {
  return (userId !== null && book[userId]) || emptyPendingDeletes(userId);
}

// Stores one account's state; a state of nobody is not stored
export function withState(book: DeletionBook, next: PendingDeletes): DeletionBook {
  if (next.userId === null) return book;
  return { ...book, [next.userId]: next };
}

function readState(userId: string, raw: unknown): PendingDeletes | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PendingDeletes>;
  return {
    userId,
    ids: Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === 'string') : [],
    since: typeof r.since === 'string' ? r.since : null,
    clearedHandled: typeof r.clearedHandled === 'string' ? r.clearedHandled : null,
  };
}

export function parseDeletionBook(text: string | null): DeletionBook {
  if (!text) return EMPTY_BOOK;
  try {
    const raw = JSON.parse(text) as { accounts?: unknown; userId?: unknown };
    const book: Record<string, PendingDeletes> = {};
    if (raw.accounts && typeof raw.accounts === 'object') {
      for (const [userId, state] of Object.entries(raw.accounts as Record<string, unknown>)) {
        const s = readState(userId, state);
        if (s) book[userId] = s;
      }
    } else if (typeof raw.userId === 'string') {
      // The earlier one-account file: kept for that account
      const s = readState(raw.userId, raw);
      if (s) book[raw.userId] = s;
    }
    // A file from before deletions were tied to an account has no owner: nothing can be sent
    return book;
  } catch {
    return EMPTY_BOOK;
  }
}

export function serializeDeletionBook(book: DeletionBook): string {
  const accounts: Record<string, Omit<PendingDeletes, 'userId'>> = {};
  for (const [userId, s] of Object.entries(book)) accounts[userId] = { ids: s.ids, since: s.since, clearedHandled: s.clearedHandled };
  return JSON.stringify({ accounts });
}

// The entries "delete all" can remove: everything but a recording in progress
export function deletableEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.status !== 'recording');
}

// Whether an entry is in Wispra Cloud: a computer dictation, or a phone dictation already shared.
// Meetings stay on the phone, and a dictation never shared has nothing to delete there.
export function isInCloud(entry: Entry): boolean {
  return entry.kind === 'dictation' && (entry.source === 'computer' || !!entry.syncedAt);
}

// The id Wispra Cloud knows the entry by
export function cloudIdOf(entry: Entry): string {
  return entry.source === 'computer' ? entry.id : cloudId(entry.id);
}

export function queueDelete(pending: PendingDeletes, entries: Entry[]): PendingDeletes {
  const ids = new Set(pending.ids);
  for (const e of entries) if (isInCloud(e)) ids.add(cloudIdOf(e));
  return { ...pending, ids: [...ids] };
}

// Ids Wispra Cloud confirmed, or that it can never take, leave the queue
export function dropIds(pending: PendingDeletes, ids: readonly string[]): PendingDeletes {
  const done = new Set(ids);
  return { ...pending, ids: pending.ids.filter((id) => !done.has(id)) };
}

// The entries other devices deleted, matched by their cloud id. Meetings are never in the cloud.
export function applyRemoteDeletes(local: Entry[], deletedIds: readonly string[]): { keep: Entry[]; removed: Entry[] } {
  if (deletedIds.length === 0) return { keep: local, removed: [] };
  const gone = new Set(deletedIds);
  const keep: Entry[] = [];
  const removed: Entry[] = [];
  for (const e of local) (e.kind === 'dictation' && gone.has(cloudIdOf(e)) ? removed : keep).push(e);
  return { keep, removed };
}

/**
 * After another device deleted everything (a `clearedAt` not handled yet): the phone's own
 * dictations that never reached Wispra Cloud and were made before the clear. The clear time comes
 * from the server's clock, so it is moved to the phone's clock first, using the `serverTime` of the
 * same answer: localClear = arrivedAt - (serverTime - clearedAt). Entries that were in the cloud
 * come in `deleted` by id; meetings are never in the shared history and stay.
 */
export function clearedBefore(local: Entry[], clearedAt: string, serverTime: string, arrivedAt: Date): Entry[] {
  const cleared = Date.parse(clearedAt);
  const server = Date.parse(serverTime);
  if (Number.isNaN(cleared) || Number.isNaN(server)) return [];
  const localClear = arrivedAt.getTime() - (server - cleared);
  return local.filter(
    (e) =>
      e.kind === 'dictation' &&
      e.source !== 'computer' &&
      !e.syncedAt &&
      e.status !== 'recording' &&
      Date.parse(e.createdAt) < localClear,
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// What the phone says once everything shown was deleted
export function deletedAllMessage(count: number, everywhere: boolean): string {
  const what = `${plural(count, 'recording')} deleted from this phone.`;
  return everywhere ? `${what} Your dictation history was also deleted from Wispra Cloud, for every device of your account.` : what;
}

// Deleting everything on every device is done at once, never queued (the owner's decision)
export const DELETE_ALL_NEEDS_CONNECTION =
  'Deleting everything on every device needs an internet connection. Nothing was deleted. Try again when you are online.';

export interface DeleteWarning {
  title: string;
  message: string;
  // Says exactly what the button does
  confirm: string;
}

// The warning shown before one entry is deleted
export function deleteOneWarning(entry: Entry, signedIn: boolean): DeleteWarning {
  if (entry.kind === 'meeting') {
    return {
      title: 'Delete this meeting?',
      message:
        'The recording, its text and its notes will be deleted from this phone. Meetings are kept only on this phone, so nothing changes on your other devices. This cannot be undone.',
      confirm: 'Delete meeting',
    };
  }
  const shared = entry.source === 'computer' || !!entry.syncedAt;
  if (signedIn && !shared) {
    return {
      title: 'Delete this dictation?',
      message:
        'It has not been shared with your other devices yet, so it is deleted from this phone only and will not reach them. This cannot be undone.',
      confirm: 'Delete dictation',
    };
  }
  if (signedIn) {
    return {
      title: 'Delete this dictation everywhere?',
      message:
        'It will be deleted from this phone, from Wispra Cloud and from every device signed in to your Wispra account, your computer included. This cannot be undone.',
      confirm: 'Delete everywhere',
    };
  }
  return {
    title: 'Delete this dictation from this phone?',
    message:
      'You are not signed in, so it is deleted from this phone only. A copy already shared with your computer stays there. This cannot be undone.',
    confirm: 'Delete from this phone',
  };
}

// The warning shown before everything is deleted; it says how many entries go
export function deleteAllWarning(entries: Entry[], signedIn: boolean): DeleteWarning {
  const total = entries.length;
  const meetings = entries.filter((e) => e.kind === 'meeting').length;
  const dictations = total - meetings;
  const parts = `${plural(dictations, 'dictation')} and ${plural(meetings, 'meeting')}`;
  if (signedIn) {
    return {
      title: `Delete all ${plural(total, 'recording')} everywhere?`,
      message:
        `All ${plural(total, 'recording')} on this phone (${parts}) will be deleted. ` +
        'Your whole dictation history in Wispra Cloud will be deleted too, on every device signed in to your Wispra account, your computer included, even entries this phone does not show. This needs an internet connection and cannot be undone.',
      confirm: `Delete all ${total} everywhere`,
    };
  }
  return {
    title: `Delete all ${plural(total, 'recording')} from this phone?`,
    message:
      `All ${plural(total, 'recording')} on this phone (${parts}) will be deleted. ` +
      'You are not signed in, so your computer and Wispra Cloud are not changed. This cannot be undone.',
    confirm: `Delete all ${total} from this phone`,
  };
}
