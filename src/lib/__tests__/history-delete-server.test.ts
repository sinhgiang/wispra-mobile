import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import { applyRemoteDeletes, clearedBefore, cloudIdOf } from '../history-delete';
import type { HistoryEntry } from '../history-sync';

jest.mock('../cloud-auth', () => ({ validToken: async () => 'token-of-the-user' }));
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://cloud.test' } }));

// eslint-disable-next-line import/first
import { CloudUnavailable, deleteAllHistory, deleteHistoryEntry, readHistory } from '../cloud-history';

/**
 * A fake Wispra Cloud that follows wispra-web docs/HISTORY_API.md (PR #12, "Deleting"): deletions
 * leave a mark per id with its time, "delete everything" marks every id and records clearedAt,
 * GET /api/history?since= lists the marks at or after `since`.
 */
class FakeCloud {
  now = Date.parse('2026-10-05T12:00:00.000Z');
  entries: HistoryEntry[] = [];
  marks: { id: string; deletedAt: string }[] = [];
  clearedAt: string | null = null;
  // Before PR #12 is live: no delete routes
  hasDeleteRoutes = true;
  requests: { method: string; path: string; body: string | null; auth: string | null }[] = [];

  tick(minutes: number): void {
    this.now += minutes * 60_000;
  }

  private iso(): string {
    return new Date(this.now).toISOString();
  }

  deleteOne(id: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    this.marks.push({ id, deletedAt: this.iso() });
    return before - this.entries.length;
  }

  deleteAll(): number {
    const n = this.entries.length;
    for (const e of this.entries) this.marks.push({ id: e.id, deletedAt: this.iso() });
    this.entries = [];
    this.clearedAt = this.iso();
    return n;
  }

  fetch = async (input: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    this.requests.push({ method, path: url.pathname + url.search, body, auth: init?.headers?.Authorization ?? null });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.pathname === '/api/history' && method === 'GET') {
      const since = url.searchParams.get('since');
      const deleted = this.marks.filter((m) => !since || m.deletedAt >= since);
      return json(200, { entries: this.entries, nextBefore: null, deleted, clearedAt: this.clearedAt, serverTime: this.iso() });
    }
    if (!this.hasDeleteRoutes) return url.pathname === '/api/history' ? json(405, {}) : json(404, {});
    if (url.pathname === '/api/history' && method === 'DELETE') {
      if (body !== JSON.stringify({ all: true })) return json(400, { error: 'The body must be exactly { "all": true }' });
      return json(200, { ok: true, deleted: this.deleteAll(), clearedAt: this.clearedAt });
    }
    const one = /^\/api\/history\/(.+)$/.exec(url.pathname);
    if (one && method === 'DELETE') {
      if (body) return json(400, { error: 'No body' });
      return json(200, { ok: true, deleted: this.deleteOne(decodeURIComponent(one[1])) });
    }
    return json(404, {});
  };
}

const at = new Date('2026-10-05T11:00:00.000Z');
function dictation(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', at, 'mobile-a'), status: 'done', text: 'Hello', ...over };
}

let server: FakeCloud;
const realFetch = global.fetch;

beforeEach(() => {
  server = new FakeCloud();
  global.fetch = server.fetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('the delete routes, against a fake Wispra Cloud', () => {
  it('deletes one entry with DELETE /api/history/{id}, no body, signed in, id encoded', async () => {
    server.entries = [{ id: 'desk 1/2', text: 'From the computer', createdAt: at.toISOString() }];
    await deleteHistoryEntry('desk 1/2');
    expect(server.requests).toEqual([
      { method: 'DELETE', path: '/api/history/desk%201%2F2', body: null, auth: 'Bearer token-of-the-user' },
    ]);
    expect(server.entries).toEqual([]);
  });

  it('deletes everything with exactly { "all": true } and returns clearedAt', async () => {
    server.entries = [
      { id: 'desk-1', text: 'a', createdAt: at.toISOString() },
      { id: 'mobile-a', text: 'b', createdAt: at.toISOString() },
    ];
    expect(await deleteAllHistory()).toBe('2026-10-05T12:00:00.000Z');
    expect(server.requests[0]).toMatchObject({ method: 'DELETE', path: '/api/history', body: '{"all":true}' });
    expect(server.marks.map((m) => m.id)).toEqual(['desk-1', 'mobile-a']);
  });

  it('keeps deletions waiting while Wispra Cloud has no delete routes (404 and 405)', async () => {
    server.hasDeleteRoutes = false;
    await expect(deleteHistoryEntry('desk-1')).rejects.toBeInstanceOf(CloudUnavailable);
    await expect(deleteAllHistory()).rejects.toBeInstanceOf(CloudUnavailable);
  });

  it('reads deleted ids, clearedAt and serverTime, and sends since the next time', async () => {
    server.deleteOne('desk-1');
    const first = await readHistory(null);
    expect(first.deleted).toEqual(['desk-1']);
    expect(first.serverTime).toBe('2026-10-05T12:00:00.000Z');
    expect(server.requests[0].path).toBe('/api/history?limit=500');

    server.tick(1);
    server.deleteOne('desk-2');
    const next = await readHistory('2026-10-05T12:00:30.000Z');
    expect(server.requests[1].path).toBe('/api/history?limit=500&since=2026-10-05T12%3A00%3A30.000Z');
    expect(next.deleted).toEqual(['desk-2']);
  });
});

describe('a deletion on another device reaches the phone', () => {
  it('removes the entry deleted on the computer, and keeps the rest', async () => {
    const pc = dictation({ id: 'desk-1', source: 'computer' });
    const mine = dictation({ id: 'mobile-a', syncedAt: at.toISOString() });
    server.entries = [{ id: 'desk-1', text: 'Hello', createdAt: at.toISOString() }];

    server.deleteOne('desk-1'); // on the computer
    const page = await readHistory(null);
    const { keep, removed } = applyRemoteDeletes([pc, mine], page.deleted);
    expect(removed.map((e) => e.id)).toEqual(['desk-1']);
    expect(keep.map((e) => e.id)).toEqual(['mobile-a']);
  });

  it('removes a phone entry another phone deleted, by its cloud id', async () => {
    const mine = dictation({ id: 'old-id', syncedAt: at.toISOString() });
    server.deleteOne(cloudIdOf(mine));
    const { removed } = applyRemoteDeletes([mine], (await readHistory(null)).deleted);
    expect(removed).toEqual([mine]);
  });

  it('after "delete everything" elsewhere, also removes unshared dictations made before it, in the phone clock', async () => {
    server.entries = [{ id: 'mobile-s', text: 'shared', createdAt: at.toISOString() }];
    server.deleteAll(); // 12:00 server time, on the computer
    server.tick(10); // the phone reads at 12:10 server time…
    const page = await readHistory(null);
    // …while its own clock says 12:07: it is 3 minutes behind, so the clear was 11:57 here
    const arrivedAt = new Date('2026-10-05T12:07:00.000Z');
    const local = [
      dictation({ id: 'mobile-s', syncedAt: at.toISOString() }),
      dictation({ id: 'mobile-before', createdAt: '2026-10-05T11:56:00.000Z' }),
      dictation({ id: 'mobile-after', createdAt: '2026-10-05T11:58:00.000Z' }),
    ];
    const { keep } = applyRemoteDeletes(local, page.deleted);
    expect(keep.map((e) => e.id)).toEqual(['mobile-before', 'mobile-after']);
    const old = clearedBefore(keep, page.clearedAt!, page.serverTime!, arrivedAt).map((e) => e.id);
    expect(old).toEqual(['mobile-before']);
  });
});
