import { describe, expect, it, jest } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import {
  applyRemoteDeletes,
  clearedBefore,
  deletableEntries,
  deleteAllWarning,
  deletedAllMessage,
  deleteOneWarning,
  dropIds,
  emptyPendingDeletes,
  EMPTY_BOOK,
  NO_PENDING_DELETES,
  parseDeletionBook,
  queueDelete,
  serializeDeletionBook,
  stateOf,
  withState,
} from '../history-delete';
import { planSync, type HistoryEntry } from '../history-sync';

jest.mock('../cloud-auth', () => ({ currentSession: () => null, validToken: async () => null }));
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://cloud.test' } }));

// eslint-disable-next-line import/first
import { isNetworkError } from '../cloud-history';

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
    expect(w.message).toContain('needs an internet connection');
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

  it('says afterwards how many were deleted, and where', () => {
    expect(deletedAllMessage(42, true)).toBe(
      '42 recordings deleted from this phone. Your dictation history was also deleted from Wispra Cloud, for every device of your account.',
    );
    expect(deletedAllMessage(1, false)).toBe('1 recording deleted from this phone.');
  });
});

describe('the deletion queue', () => {
  const mine = emptyPendingDeletes('user-a');

  it('queues only what is in Wispra Cloud: computer dictations and shared phone dictations', () => {
    const p = queueDelete(mine, [dictation({ id: 'old-id', syncedAt: at.toISOString() }), fromPc, meeting({}), dictation({ id: 'mobile-new' })]);
    expect(p.ids).toEqual(['mobile-old-id', 'pc-1']);
  });

  it('does not queue the same id twice, and drops ids', () => {
    const p = queueDelete(queueDelete(mine, [shared]), [shared, fromPc]);
    expect(p.ids).toEqual(['mobile-a', 'pc-1']);
    expect(dropIds(p, ['mobile-a']).ids).toEqual(['pc-1']);
  });

  it('keeps one state per account: another account, or nobody, sees an empty one', () => {
    const a = { ...queueDelete(mine, [shared]), since: '2026-10-05T09:00:00.000Z', clearedHandled: '2026-10-05T08:30:00.000Z' };
    const book = withState(EMPTY_BOOK, a);
    expect(stateOf(book, 'user-a')).toBe(a);
    expect(stateOf(book, 'user-b')).toEqual(emptyPendingDeletes('user-b'));
    expect(stateOf(book, null)).toEqual(NO_PENDING_DELETES);
    const both = withState(book, { ...emptyPendingDeletes('user-b'), ids: ['pc-9'] });
    expect(stateOf(both, 'user-a')).toBe(a);
    expect(stateOf(both, 'user-b').ids).toEqual(['pc-9']);
  });

  it('never stores a state of nobody', () => {
    expect(withState(EMPTY_BOOK, { ...NO_PENDING_DELETES, ids: ['pc-1'] })).toBe(EMPTY_BOOK);
  });

  it('is saved and read back with every account (pending-deletes.json)', () => {
    const book = withState(
      withState(EMPTY_BOOK, { userId: 'user-a', ids: ['pc-1'], since: '2026-10-05T09:00:00.000Z', clearedHandled: '2026-10-05T08:30:00.000Z' }),
      { userId: 'user-b', ids: [], since: null, clearedHandled: null },
    );
    expect(parseDeletionBook(serializeDeletionBook(book))).toEqual(book);
  });

  it('reads the earlier one-account file for its account, and drops one without an owner or a broken file', () => {
    const one = parseDeletionBook(JSON.stringify({ userId: 'user-a', ids: ['pc-1'], since: null, clearedHandled: null }));
    expect(stateOf(one, 'user-a').ids).toEqual(['pc-1']);
    expect(parseDeletionBook(JSON.stringify({ ids: ['pc-1'], all: true, since: null }))).toEqual(EMPTY_BOOK);
    expect(parseDeletionBook('{nope')).toEqual(EMPTY_BOOK);
    expect(parseDeletionBook(null)).toEqual(EMPTY_BOOK);
  });
});

describe('telling a lost connection from other errors', () => {
  it('takes only a failed request for a network problem', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isNetworkError(new Error('Network request failed'))).toBe(false);
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
