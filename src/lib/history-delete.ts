// Deleting with the history shared through Wispra Cloud (the owner's choice, W-0194): a dictation
// deleted on one device is deleted on every device signed in to the same account. The phone tells
// Wispra Cloud what it deleted, and deletes what other devices deleted. Before anything is deleted
// the user sees exactly what will happen. Pure functions only.

import { cloudId, type Entry } from './entries';

// What the phone still has to tell Wispra Cloud, kept on the phone so a deletion made offline
// (or before Wispra Cloud has the delete route) is sent later and never lost
export interface PendingDeletes {
  // Cloud ids to delete
  ids: string[];
  // The user deleted everything
  all: boolean;
  // The server time of the last list of deletions read from Wispra Cloud
  since: string | null;
}

export const NO_PENDING_DELETES: PendingDeletes = { ids: [], all: false, since: null };

// The entries "delete all" removes: everything but a recording in progress
export function deletableEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.status !== 'recording');
}

// Whether an entry can be in Wispra Cloud: dictations only. Meetings stay on the phone.
export function isInCloud(entry: Entry): boolean {
  return entry.kind === 'dictation';
}

// The id Wispra Cloud knows the entry by
export function cloudIdOf(entry: Entry): string {
  return entry.source === 'computer' ? entry.id : cloudId(entry.id);
}

// Ids are kept even while a delete-all waits: one made during the delete-all request is not lost
export function queueDelete(pending: PendingDeletes, entries: Entry[]): PendingDeletes {
  const ids = new Set(pending.ids);
  for (const e of entries) if (isInCloud(e)) ids.add(cloudIdOf(e));
  return { ...pending, ids: [...ids] };
}

// Deleting everything replaces any single deletions still waiting
export function queueDeleteAll(pending: PendingDeletes): PendingDeletes {
  return { ...pending, ids: [], all: true };
}

export function hasPendingDeletes(pending: PendingDeletes): boolean {
  return pending.all || pending.ids.length > 0;
}

export function pendingDeleteCount(pending: PendingDeletes): number {
  return (pending.all ? 1 : 0) + pending.ids.length;
}

// After Wispra Cloud confirmed the deletions that were sent
export function clearSent(pending: PendingDeletes, sent: PendingDeletes): PendingDeletes {
  const done = new Set(sent.ids);
  return { ...pending, all: pending.all && !sent.all, ids: pending.ids.filter((id) => !done.has(id)) };
}

// The entries other devices deleted, matched by their cloud id
export function applyRemoteDeletes(local: Entry[], deletedIds: readonly string[]): { keep: Entry[]; removed: Entry[] } {
  if (deletedIds.length === 0) return { keep: local, removed: [] };
  const gone = new Set(deletedIds);
  const keep: Entry[] = [];
  const removed: Entry[] = [];
  for (const e of local) (isInCloud(e) && gone.has(cloudIdOf(e)) ? removed : keep).push(e);
  return { keep, removed };
}

export interface DeleteWarning {
  title: string;
  message: string;
  // Says exactly what the button does
  confirm: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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
        'Your whole dictation history in Wispra Cloud will be deleted too, on every device signed in to your Wispra account, your computer included, even entries this phone does not show. This cannot be undone.',
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
