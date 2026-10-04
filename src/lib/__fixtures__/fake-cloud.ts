// A fake Wispra Cloud for tests, following wispra-web docs/HISTORY_API.md (PR #12, "Deleting"):
// a mark per deleted id with its time, "delete everything" marking every id and recording
// clearedAt, GET /api/history?since= listing the marks at or after `since`. Each account (token)
// has its own history. Before the delete routes are live it answers like production did: Next.js's
// HTML 404 page for /api/history/{id}, 405 for DELETE /api/history.

import type { HistoryEntry } from '../history-sync';

// The signed-in account, as cloud-auth would give it (tests mock cloud-auth with this)
export const fakeAuth = {
  user: null as string | null,
  currentSession(): { userId: string } | null {
    return fakeAuth.user ? { userId: fakeAuth.user } : null;
  },
  async validToken(): Promise<string | null> {
    return fakeAuth.user ? `token-of-${fakeAuth.user}` : null;
  },
};

interface Account {
  entries: HistoryEntry[];
  marks: { id: string; deletedAt: string }[];
  clearedAt: string | null;
}

export interface FakeRequest {
  method: string;
  path: string;
  body: string | null;
  user: string | null;
}

export class FakeCloud {
  now = Date.parse('2026-10-05T12:00:00.000Z');
  hasDeleteRoutes = true;
  // Answers for one id of DELETE /api/history/{id}, e.g. 400, 404 (JSON) or 500
  failFor = new Map<string, number>();
  // The connection is down: every request fails like fetch does
  offline = false;
  requests: FakeRequest[] = [];
  private accounts = new Map<string, Account>();

  account(user: string): Account {
    let a = this.accounts.get(user);
    if (!a) {
      a = { entries: [], marks: [], clearedAt: null };
      this.accounts.set(user, a);
    }
    return a;
  }

  tick(minutes: number): void {
    this.now += minutes * 60_000;
  }

  iso(): string {
    return new Date(this.now).toISOString();
  }

  deleteOne(user: string, id: string): number {
    const a = this.account(user);
    const before = a.entries.length;
    a.entries = a.entries.filter((e) => e.id !== id);
    a.marks.push({ id, deletedAt: this.iso() });
    return before - a.entries.length;
  }

  deleteAll(user: string): number {
    const a = this.account(user);
    const n = a.entries.length;
    for (const e of a.entries) a.marks.push({ id: e.id, deletedAt: this.iso() });
    a.entries = [];
    a.clearedAt = this.iso();
    return n;
  }

  fetch = async (input: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<Response> => {
    if (this.offline) throw new TypeError('Network request failed');
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    const token = (init?.headers?.Authorization ?? '').replace(/^Bearer token-of-/, '');
    const user = token || null;
    this.requests.push({ method, path: url.pathname + url.search, body, user });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const html404 = () => new Response('<!DOCTYPE html><title>404</title>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    if (!user) return json(401, { error: 'Not signed in' });
    const a = this.account(user);

    if (url.pathname === '/api/history' && method === 'GET') {
      const since = url.searchParams.get('since');
      const deleted = a.marks.filter((m) => !since || m.deletedAt >= since);
      return json(200, { entries: a.entries, nextBefore: null, deleted, clearedAt: a.clearedAt, serverTime: this.iso() });
    }
    if (url.pathname === '/api/history/merge' && method === 'POST') {
      const entries = (JSON.parse(body ?? '{}') as { entries?: HistoryEntry[] }).entries ?? [];
      const bad = entries.findIndex((e) => !e.id.startsWith('mobile-'));
      if (bad >= 0) return json(400, { error: `entries[${bad}]: "id" must start with "mobile-"` });
      for (const e of entries) a.entries = [...a.entries.filter((x) => x.id !== e.id), e];
      return json(200, { ok: true, merged: entries.length });
    }
    if (url.pathname === '/api/history' && method === 'DELETE') {
      if (!this.hasDeleteRoutes) return json(405, {});
      if (body !== JSON.stringify({ all: true })) return json(400, { error: 'The body must be exactly { "all": true }' });
      const deleted = this.deleteAll(user);
      return json(200, { ok: true, deleted, clearedAt: a.clearedAt });
    }
    const one = /^\/api\/history\/(.+)$/.exec(url.pathname);
    if (one && method === 'DELETE') {
      if (!this.hasDeleteRoutes) return html404();
      const id = decodeURIComponent(one[1]);
      const fail = this.failFor.get(id);
      if (fail) return json(fail, { error: `Refused ${id}` });
      if (body) return json(400, { error: 'No body' });
      return json(200, { ok: true, deleted: this.deleteOne(user, id) });
    }
    return html404();
  };
}
