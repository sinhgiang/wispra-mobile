import { describe, expect, it } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import {
  applyRemoteDeletes,
  clearedBefore,
  clearSent,
  deletableEntries,
  deleteAllWarning,
  deletedAllMessage,
  deleteOneWarning,
  hasPendingDeletes,
  NO_PENDING_DELETES,
  pendingDeleteCount,
  queueDelete,
  queueDeleteAll,
} from '../history-delete';
import { planSync, type HistoryEntry } from '../history-sync';

const at = new Date('2026-10-05T08:00:00.000Z');

function dictation(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', at, 'mobile-a'), status: 'done', text: 'Hello', ...over };
}

function meeting(over: Partial<Entry>): Entry {
  return { ...createEntry('meeting', at, 'mobile-m'), status: 'done', text: 'We met', ...over };
}

const shared = dictation({ id: 'mobile-a', syncedAt: '2026-10-05T08:01:00.000Z' });
const fromPc = dictation({ id: 'pc-1', source: 'computer', title: 'Gmail' });

describe('the warning before deleting one entry', () => {
  it('says a shared dictation is deleted on every device, and the button says so', () => {
    const w = deleteOneWarning(shared, true);
    expect(w.title).toBe('Delete this dictation everywhere?');
    expect(w.message).toContain('every device signed in to your Wispra account');
    expect(w.message).toContain('cannot be undone');
    expect(w.confirm).toBe('Delete everywhere');
    expect(deleteOneWarning(fromPc, true).confirm).toBe('Delete everywhere');
  });

  it('says only this phone when signed out', () => {
    const w = deleteOneWarning(shared, false);
    expect(w.message).toContain('deleted from this phone only');
    expect(w.message).not.toContain('every device');
    expect(w.confirm).toBe('Delete from this phone');
  });

  it('does not claim other devices for a dictation that was never shared', () => {
    const w = deleteOneWarning(dictation({ syncedAt: undefined }), true);
    expect(w.message).toContain('this phone only');
    expect(w.message).not.toContain('every device');
    expect(w.confirm).toBe('Delete dictation');
  });

  it('says a meeting is only on this phone', () => {
    const w = deleteOneWarning(meeting({}), true);
    expect(w.message).toContain('Meetings are kept only on this phone');
    expect(w.confirm).toBe('Delete meeting');
  });
});

describe('the warning before deleting everything', () => {
  const all = [shared, fromPc, meeting({})];

  it('gives the number of entries, split by kind, and the button repeats it', () => {
    const w = deleteAllWarning(all, true);
    expect(w.title).toBe('Delete all 3 recordings everywhere?');
    expect(w.message).toContain('All 3 recordings on this phone (2 dictations and 1 meeting)');
    expect(w.message).toContain('every device signed in to your Wispra account');
    expect(w.message).toContain('even entries this phone does not show');
    expect(w.confirm).toBe('Delete all 3 everywhere');
  });

  it('says the computer and Wispra Cloud are not changed when signed out', () => {
    const w = deleteAllWarning(all, false);
    expect(w.title).toBe('Delete all 3 recordings from this phone?');
    expect(w.message).toContain('your computer and Wispra Cloud are not changed');
    expect(w.confirm).toBe('Delete all 3 from this phone');
  });

  it('uses the singular for one entry', () => {
    expect(deleteAllWarning([shared], true).title).toBe('Delete all 1 recording everywhere?');
  });

  it('leaves a recording in progress alone', () => {
    expect(deletableEntries([shared, dictation({ id: 'mobile-r', status: 'recording' })])).toEqual([shared]);
  });
});

describe('deletions waiting for Wispra Cloud', () => {
  it('queues the cloud id of dictations, never of meetings', () => {
    const p = queueDelete(NO_PENDING_DELETES, [dictation({ id: 'old-id' }), fromPc, meeting({})]);
    expect(p.ids).toEqual(['mobile-old-id', 'pc-1']);
    expect(pendingDeleteCount(p)).toBe(2);
    expect(hasPendingDeletes(NO_PENDING_DELETES)).toBe(false);
  });

  it('does not queue the same id twice', () => {
    const p = queueDelete(queueDelete(NO_PENDING_DELETES, [shared]), [shared]);
    expect(p.ids).toEqual(['mobile-a']);
  });

  it('replaces single deletions by a delete-all, and keeps one made after it', () => {
    const all = queueDeleteAll(queueDelete(NO_PENDING_DELETES, [shared]));
    expect(all).toEqual({ ...NO_PENDING_DELETES, ids: [], all: true });
    const later = queueDelete(all, [fromPc]);
    expect(later).toEqual({ ...NO_PENDING_DELETES, ids: ['pc-1'], all: true });
  });

  it('clears only what Wispra Cloud confirmed', () => {
    const sent = { ...NO_PENDING_DELETES, ids: ['mobile-a'], all: true };
    const now = { ...NO_PENDING_DELETES, ids: ['mobile-a', 'pc-1'], all: true, since: '2026-10-05T09:00:00.000Z' };
    expect(clearSent(now, sent)).toEqual({ ...NO_PENDING_DELETES, ids: ['pc-1'], all: false, since: '2026-10-05T09:00:00.000Z' });
  });
});

describe('deletions made on other devices', () => {
  it('removes the entries whose cloud id was deleted, phone and computer ones alike', () => {
    const local = [shared, fromPc, dictation({ id: 'mobile-b' })];
    const { keep, removed } = applyRemoteDeletes(local, ['mobile-a', 'pc-1']);
    expect(removed.map((e) => e.id)).toEqual(['mobile-a', 'pc-1']);
    expect(keep.map((e) => e.id)).toEqual(['mobile-b']);
  });

  it('matches a phone entry saved without the mobile- prefix', () => {
    const { removed } = applyRemoteDeletes([dictation({ id: 'old-id' })], ['mobile-old-id']);
    expect(removed).toHaveLength(1);
  });

  it('never removes a meeting, which is not in Wispra Cloud', () => {
    const m = meeting({ id: 'pc-1' });
    expect(applyRemoteDeletes([m], ['pc-1']).keep).toEqual([m]);
  });

  it('does not bring a deleted computer dictation back with the history', () => {
    const cloud: HistoryEntry[] = [{ id: 'pc-2', text: 'Deleted on the computer', createdAt: '2026-10-05T07:00:00.000Z' }];
    expect(planSync([], cloud, new Set(['pc-2']), true).upserts).toEqual([]);
  });
});

describe('another device deleted everything', () => {
  // The server says it cleared at 12:30 and answered at 12:40 (its clock). The answer reached the
  // phone at 12:38 phone time, so the phone's clock is 2 minutes behind: the clear was 12:28 here.
  const clearedAt = '2026-10-05T12:30:00.000Z';
  const serverTime = '2026-10-05T12:40:00.000Z';
  const arrivedAt = new Date('2026-10-05T12:38:00.000Z');

  it('deletes unshared phone dictations made before the clear, in the phone clock', () => {
    const before = dictation({ id: 'mobile-old', createdAt: '2026-10-05T12:27:00.000Z' });
    const after = dictation({ id: 'mobile-new', createdAt: '2026-10-05T12:29:00.000Z' });
    expect(clearedBefore([before, after], clearedAt, serverTime, arrivedAt).map((e) => e.id)).toEqual(['mobile-old']);
  });

  it('leaves meetings, computer entries, shared dictations and a recording in progress', () => {
    const old = '2026-10-05T10:00:00.000Z';
    const local = [
      meeting({ createdAt: old }),
      dictation({ id: 'pc-9', source: 'computer', createdAt: old }),
      dictation({ id: 'mobile-s', syncedAt: old, createdAt: old }),
      dictation({ id: 'mobile-r', status: 'recording', createdAt: old }),
    ];
    expect(clearedBefore(local, clearedAt, serverTime, arrivedAt)).toEqual([]);
  });

  it('does nothing with a time it cannot read', () => {
    expect(clearedBefore([dictation({})], 'not a date', serverTime, arrivedAt)).toEqual([]);
  });
});

describe('after deleting everything', () => {
  it('says how many were deleted, and that other devices follow when signed in', () => {
    expect(deletedAllMessage(42, true)).toBe(
      '42 recordings deleted from this phone. Your history is being deleted on your other devices too; this happens as soon as the phone is online.',
    );
    expect(deletedAllMessage(1, false)).toBe('1 recording deleted from this phone.');
  });
});
