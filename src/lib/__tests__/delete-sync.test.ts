import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FakeCloud, fakeAuth } from '../__fixtures__/fake-cloud';
import { createEntry, type Entry } from '../entries';
import { NO_PENDING_DELETES, parsePendingDeletes, pendingFor, serializePendingDeletes, type PendingDeletes } from '../history-delete';

jest.mock('../cloud-auth', () => require('../__fixtures__/fake-cloud').fakeAuth);
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://cloud.test' } }));

// eslint-disable-next-line import/first
import { AccountChanged, CloudUnavailable, deleteAllHistory, deleteHistoryEntry, readHistory } from '../cloud-history';
// eslint-disable-next-line import/first
import { deleteEverything, queueDeletion, syncDeletes, type DeleteSyncCloud, type DeleteSyncStore } from '../delete-sync';

const at = new Date('2026-10-05T11:00:00.000Z');
function dictation(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', at, 'mobile-a'), status: 'done', text: 'Hello', ...over };
}

// The app's store without React: entries in memory, pending-deletes.json as text
class FakeStore implements DeleteSyncStore {
  list: Entry[] = [];
  file: string | null = null;
  private state: PendingDeletes = NO_PENDING_DELETES;

  userId(): string | null {
    return fakeAuth.user;
  }
  pending(): PendingDeletes {
    return this.state;
  }
  setPending(next: PendingDeletes): void {
    this.state = next;
    this.file = serializePendingDeletes(next);
  }
  entries(): Entry[] {
    return this.list;
  }
  removeLocal(gone: Entry[]): void {
    const ids = new Set(gone.map((e) => e.id));
    this.list = this.list.filter((e) => !ids.has(e.id));
  }
  // What entries-store does when Wispra starts: read the file, keep it only for this account
  restart(): void {
    this.state = pendingFor(parsePendingDeletes(this.file), fakeAuth.user);
  }
}

const realCloud: DeleteSyncCloud = { deleteOne: deleteHistoryEntry, deleteAll: deleteAllHistory, read: (since, asUser) => readHistory(since, asUser) };

let server: FakeCloud;
let store: FakeStore;
const realFetch = global.fetch;
const phoneClock = () => new Date(server.now);

beforeEach(() => {
  server = new FakeCloud();
  store = new FakeStore();
  fakeAuth.user = 'user-a';
  global.fetch = server.fetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  fakeAuth.user = null;
});

function deletesBy(user: string) {
  return server.requests.filter((r) => r.method === 'DELETE' && r.user === user);
}

describe('the requests the phone sends', () => {
  it('deletes one entry with DELETE /api/history/{id}, no body, id encoded, as the right account', async () => {
    store.list = [dictation({ id: 'desk 1/2', source: 'computer' })];
    queueDeletion(store, store.list[0]);
    await syncDeletes(store, realCloud, phoneClock);
    expect(server.requests[0]).toEqual({ method: 'DELETE', path: '/api/history/desk%201%2F2', body: null, user: 'user-a' });
  });

  it('reads the history after the deletions, then sends since = the last serverTime', async () => {
    store.setPending({ ...pendingFor(NO_PENDING_DELETES, 'user-a'), ids: ['pc-1'] });
    await syncDeletes(store, realCloud, phoneClock);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['DELETE /api/history/pc-1', 'GET /api/history?limit=500']);
    expect(store.pending()).toMatchObject({ ids: [], since: '2026-10-05T12:00:00.000Z' });

    server.tick(1);
    await syncDeletes(store, realCloud, phoneClock);
    expect(server.requests[2].path).toBe('/api/history?limit=500&since=2026-10-05T12%3A00%3A00.000Z');
  });

  it('does not move since when the read fails', async () => {
    store.setPending({ ...pendingFor(NO_PENDING_DELETES, 'user-a'), since: '2026-10-05T11:00:00.000Z' });
    server.offline = true;
    await expect(syncDeletes(store, realCloud, phoneClock)).rejects.toThrow('Network request failed');
    expect(store.pending().since).toBe('2026-10-05T11:00:00.000Z');
  });
});

describe('one id that fails does not hold the others', () => {
  it('drops ids refused for good (400, 404), keeps a server error to retry, and still sends the rest', async () => {
    server.failFor.set('bad-400', 400).set('gone-404', 404).set('busy-500', 500);
    store.setPending({ ...pendingFor(NO_PENDING_DELETES, 'user-a'), ids: ['bad-400', 'gone-404', 'busy-500', 'pc-ok'] });
    const result = await syncDeletes(store, realCloud, phoneClock);
    expect(deletesBy('user-a').map((r) => r.path)).toEqual([
      '/api/history/bad-400',
      '/api/history/gone-404',
      '/api/history/busy-500',
      '/api/history/pc-ok',
    ]);
    expect(store.pending().ids).toEqual(['busy-500']);
    expect(result?.waiting).toBe(1);
    expect(server.account('user-a').marks.map((m) => m.id)).toEqual(['pc-ok']);

    server.failFor.delete('busy-500');
    await syncDeletes(store, realCloud, phoneClock);
    expect(store.pending().ids).toEqual([]);
  });

  it('keeps every id while Wispra Cloud has no delete routes, and still reads the history', async () => {
    server.hasDeleteRoutes = false;
    store.setPending({ ...pendingFor(NO_PENDING_DELETES, 'user-a'), ids: ['pc-1', 'pc-2'] });
    const result = await syncDeletes(store, realCloud, phoneClock);
    expect(deletesBy('user-a')).toHaveLength(1);
    expect(store.pending().ids).toEqual(['pc-1', 'pc-2']);
    expect(result?.page.serverTime).toBe('2026-10-05T12:00:00.000Z');
  });

  it('does not queue a dictation that never reached Wispra Cloud', () => {
    queueDeletion(store, dictation({ id: 'mobile-new' }));
    queueDeletion(store, dictation({ kind: 'meeting', id: 'mobile-m', source: 'computer' }));
    expect(store.pending().ids).toEqual([]);
  });
});

describe('another account never gets the previous account’s deletions', () => {
  it('drops A’s queue, since and handled clear when B is signed in, and sends nothing of A with B’s sign-in', async () => {
    store.setPending({ userId: 'user-a', ids: ['a-dictation'], since: '2026-10-05T11:59:00.000Z', clearedHandled: '2026-10-05T11:30:00.000Z' });
    fakeAuth.user = 'user-b';
    server.account('user-b').marks.push({ id: 'b-old', deletedAt: '2026-10-05T10:00:00.000Z' });
    store.list = [dictation({ id: 'b-old', source: 'computer' })];

    await syncDeletes(store, realCloud, phoneClock);
    expect(deletesBy('user-b')).toEqual([]);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/api/history?limit=500', user: 'user-b' });
    // B's own older deletions are read from the start, not from A's since
    expect(store.list).toEqual([]);
    expect(store.pending()).toEqual({ userId: 'user-b', ids: [], since: '2026-10-05T12:00:00.000Z', clearedHandled: null });
  });

  it('drops them when Wispra restarts signed in as another account, or signed out', () => {
    store.setPending({ userId: 'user-a', ids: ['a-dictation'], since: null, clearedHandled: null });
    fakeAuth.user = 'user-b';
    store.restart();
    expect(store.pending()).toEqual({ userId: 'user-b', ids: [], since: null, clearedHandled: null });
    fakeAuth.user = null;
    store.restart();
    expect(store.pending().ids).toEqual([]);
  });

  it('keeps them across a restart of the same account', () => {
    store.setPending({ userId: 'user-a', ids: ['pc-1'], since: '2026-10-05T11:00:00.000Z', clearedHandled: null });
    store.restart();
    expect(store.pending()).toEqual({ userId: 'user-a', ids: ['pc-1'], since: '2026-10-05T11:00:00.000Z', clearedHandled: null });
  });

  it('stops before the next request when the account changes during a sync', async () => {
    store.setPending({ ...pendingFor(NO_PENDING_DELETES, 'user-a'), ids: ['a-1', 'a-2'] });
    const switching: DeleteSyncCloud = {
      ...realCloud,
      deleteOne: async (id, asUser) => {
        const outcome = await deleteHistoryEntry(id, asUser);
        fakeAuth.user = 'user-b'; // the user signs into B while the first request is on its way
        return outcome;
      },
    };
    await expect(syncDeletes(store, switching, phoneClock)).rejects.toBeInstanceOf(AccountChanged);
    expect(deletesBy('user-b')).toEqual([]);
    expect(server.requests.filter((r) => r.user === 'user-b')).toEqual([]);
  });

  it('refuses to send a request made for A once B is signed in', async () => {
    fakeAuth.user = 'user-b';
    await expect(deleteHistoryEntry('a-1', 'user-a')).rejects.toBeInstanceOf(AccountChanged);
    await expect(deleteAllHistory('user-a')).rejects.toBeInstanceOf(AccountChanged);
    expect(server.requests).toEqual([]);
  });
});

describe('a deletion on another device reaches the phone', () => {
  it('removes what the computer deleted, through the whole sync', async () => {
    store.list = [dictation({ id: 'desk-1', source: 'computer' }), dictation({ id: 'mobile-a', syncedAt: at.toISOString() })];
    server.deleteOne('user-a', 'desk-1'); // on the computer
    const result = await syncDeletes(store, realCloud, phoneClock);
    expect(result?.removed).toBe(1);
    expect(store.list.map((e) => e.id)).toEqual(['mobile-a']);
  });

  it('after "delete everything" elsewhere, removes shared entries by id and unshared ones made before it, once', async () => {
    server.account('user-a').entries = [{ id: 'mobile-s', text: 'shared', createdAt: at.toISOString() }];
    server.deleteAll('user-a'); // 12:00 server time, on the computer
    server.tick(10); // the phone reads at 12:10 server time…
    const slowPhone = () => new Date('2026-10-05T12:07:00.000Z'); // …its clock says 12:07: the clear was 11:57 here
    store.list = [
      dictation({ id: 'mobile-s', syncedAt: at.toISOString() }),
      dictation({ id: 'mobile-before', createdAt: '2026-10-05T11:56:00.000Z' }),
      dictation({ id: 'mobile-after', createdAt: '2026-10-05T11:58:00.000Z' }),
      dictation({ kind: 'meeting', id: 'mobile-meeting', createdAt: '2026-10-05T10:00:00.000Z' }),
    ];
    await syncDeletes(store, realCloud, slowPhone);
    expect(store.list.map((e) => e.id)).toEqual(['mobile-after', 'mobile-meeting']);
    expect(store.pending().clearedHandled).toBe('2026-10-05T12:00:00.000Z');

    // The same clear comes back in every answer until the next one: it is not applied again
    store.list.push(dictation({ id: 'mobile-later', createdAt: '2026-10-05T11:00:00.000Z' }));
    await syncDeletes(store, realCloud, slowPhone);
    expect(store.list.map((e) => e.id)).toContain('mobile-later');
  });
});

describe('Delete all', () => {
  it('deletes exactly the entries shown in the warning, after Wispra Cloud answered', async () => {
    store.list = [dictation({ id: 'pc-1', source: 'computer' }), dictation({ id: 'mobile-a', syncedAt: at.toISOString() })];
    server.account('user-a').entries = [{ id: 'pc-1', text: 'x', createdAt: at.toISOString() }];
    const shown = store.list.map((e) => e.id);
    store.list.push(dictation({ id: 'mobile-arrived-after' })); // came in while the warning was open
    const count = await deleteEverything(store, realCloud, shown, 'user-a');
    expect(count).toBe(2);
    expect(store.list.map((e) => e.id)).toEqual(['mobile-arrived-after']);
    expect(server.requests[0]).toMatchObject({ method: 'DELETE', path: '/api/history', body: '{"all":true}', user: 'user-a' });
    expect(store.pending().clearedHandled).toBe('2026-10-05T12:00:00.000Z');

    // This phone's own clear does not delete what came in after it
    await syncDeletes(store, realCloud, phoneClock);
    expect(store.list.map((e) => e.id)).toEqual(['mobile-arrived-after']);
  });

  it('needs a connection: offline, or before the route is live, nothing is deleted or queued', async () => {
    store.list = [dictation({ id: 'pc-1', source: 'computer' })];
    server.offline = true;
    await expect(deleteEverything(store, realCloud, ['pc-1'], 'user-a')).rejects.toThrow('Network request failed');
    server.offline = false;
    server.hasDeleteRoutes = false;
    await expect(deleteEverything(store, realCloud, ['pc-1'], 'user-a')).rejects.toBeInstanceOf(CloudUnavailable);
    expect(store.list).toHaveLength(1);
    expect(store.pending().ids).toEqual([]);
  });

  it('deletes nothing when the account is not the one the warning spoke of', async () => {
    store.list = [dictation({ id: 'pc-1', source: 'computer' })];
    fakeAuth.user = 'user-b';
    await expect(deleteEverything(store, realCloud, ['pc-1'], null)).rejects.toBeInstanceOf(AccountChanged);
    await expect(deleteEverything(store, realCloud, ['pc-1'], 'user-a')).rejects.toBeInstanceOf(AccountChanged);
    expect(store.list).toHaveLength(1);
    expect(server.requests).toEqual([]);
  });

  it('signed out, deletes the shown entries on this phone only', async () => {
    fakeAuth.user = null;
    store.list = [dictation({ id: 'pc-1', source: 'computer' }), dictation({ id: 'mobile-a' })];
    expect(await deleteEverything(store, realCloud, ['pc-1', 'mobile-a'], null)).toBe(2);
    expect(store.list).toEqual([]);
    expect(server.requests).toEqual([]);
  });
});
