// The order of deleting with Wispra Cloud, kept apart from React so it can be tested with a fake
// store and a fake server (src/lib/__tests__/delete-sync.test.ts):
//   1. send this phone's deletions, one id at a time
//   2. read the history with `since`
//   3. delete on the phone what other devices deleted (ids, and a new "delete everything")
//   4. remember `since` and the handled clear, only after the answer was handled
// Everything is for the account signed in when the sync starts; if it changes on the way, the sync
// stops without sending or writing anything more. Each account keeps its own state (DeletionBook):
// another account's deletions wait until that account signs in again.

import type { Entry } from './entries';
import { AccountChanged, CloudUnavailable, type DeleteOutcome, type HistoryPage } from './cloud-history';
import { applyRemoteDeletes, clearedBefore, dropIds, queueDelete, type PendingDeletes } from './history-delete';

export interface DeleteSyncStore {
  // The account signed in now, or null
  userId(): string | null;
  // The latest state of the account signed in now (read again after every await)
  pending(): PendingDeletes;
  // Saves the state of next.userId (pending-deletes.json in the app); other accounts keep theirs
  setPending(next: PendingDeletes): void;
  // The latest entries on the phone
  entries(): Entry[];
  // Deletes these entries from the phone, with their audio
  removeLocal(gone: Entry[]): void;
}

export interface DeleteSyncCloud {
  deleteOne(id: string, asUser: string): Promise<DeleteOutcome>;
  deleteAll(asUser: string): Promise<string | null>;
  read(since: string | null, asUser: string): Promise<HistoryPage>;
}

function sameAccount(store: DeleteSyncStore, user: string): void {
  if (store.userId() !== user) throw new AccountChanged();
}

// One entry deleted on the phone: queued for Wispra Cloud when signed in and it is there
export function queueDeletion(store: DeleteSyncStore, entry: Entry): void {
  if (!store.userId()) return;
  store.setPending(queueDelete(store.pending(), [entry]));
}

export interface DeleteSyncResult {
  // The history read, for sharing new dictations both ways
  page: HistoryPage;
  // Deletions still waiting (route not live yet, or server errors)
  waiting: number;
  // Entries removed from the phone because other devices deleted them
  removed: number;
}

export async function syncDeletes(store: DeleteSyncStore, cloud: DeleteSyncCloud, now: () => Date): Promise<DeleteSyncResult | null> {
  const user = store.userId();
  if (!user) return null;

  // 1. This phone's deletions first, so the history read next cannot bring them back
  for (const id of [...store.pending().ids]) {
    let outcome: DeleteOutcome;
    try {
      outcome = await cloud.deleteOne(id, user);
    } catch (err) {
      // No delete route yet: every id waits; reading the history is still fine, since the
      // deleted ids are kept out of what is brought in (see entries-store)
      if (err instanceof CloudUnavailable) break;
      throw err;
    }
    sameAccount(store, user);
    if (outcome !== 'retry') store.setPending(dropIds(store.pending(), [id]));
  }

  // 2. The history, and what was deleted since the last answer
  const page = await cloud.read(store.pending().since, user);
  const arrivedAt = now();
  sameAccount(store, user);

  // 3. What other devices deleted leaves the phone
  let { keep, removed } = applyRemoteDeletes(store.entries(), page.deleted);
  const handled = store.pending().clearedHandled;
  const newClear = page.clearedAt && page.clearedAt !== handled ? page.clearedAt : null;
  // A clear from before this phone first read this account's history cannot be about entries made
  // on the phone (for instance ones just merged in from another account): it is only noted
  const firstRead = store.pending().since === null;
  if (newClear && page.serverTime && !firstRead) {
    const old = new Set(clearedBefore(keep, newClear, page.serverTime, arrivedAt).map((e) => e.id));
    removed = [...removed, ...keep.filter((e) => old.has(e.id))];
    keep = keep.filter((e) => !old.has(e.id));
  }
  if (removed.length > 0) store.removeLocal(removed);

  // 4. Only now does `since` move on
  const latest = store.pending();
  store.setPending({
    ...latest,
    since: page.serverTime ?? latest.since,
    clearedHandled: newClear ?? latest.clearedHandled,
  });
  return { page, waiting: store.pending().ids.length, removed: removed.length };
}

/**
 * "Delete all": deletes exactly the entries the user saw in the warning. Signed in, Wispra Cloud
 * deletes the whole history first; only when it answers are the entries deleted on the phone. With
 * no connection nothing is deleted and the error is thrown (the owner's decision: a delete-all is
 * never queued). Returns how many entries left the phone.
 */
export async function deleteEverything(
  store: DeleteSyncStore,
  cloud: DeleteSyncCloud,
  shown: readonly string[],
  // The account the warning spoke of (null: it said "this phone only")
  asUser: string | null,
): Promise<number> {
  const user = store.userId();
  if (user !== asUser) throw new AccountChanged();
  const ids = new Set(shown);
  if (user) {
    const clearedAt = await cloud.deleteAll(user);
    sameAccount(store, user);
    // Wispra Cloud no longer has anything to delete for the queued ids; this clear is not applied
    // again when it comes back in the history
    store.setPending({ ...store.pending(), ids: [], clearedHandled: clearedAt ?? store.pending().clearedHandled });
  }
  const gone = store.entries().filter((e) => ids.has(e.id) && e.status !== 'recording');
  store.removeLocal(gone);
  return gone.length;
}
