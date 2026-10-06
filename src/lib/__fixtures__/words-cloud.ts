// A stand-in for wispra-web's GET/PUT /api/lexicon (docs/LEXICON_API.md) and a phone or computer that syncs
// against it, for the tests of the word sync (T-0193).
import type { LexiconEntry } from '../lexicon';
import { parseSnapshot, type SyncSnapshot } from '../lexicon-sync';
import { runWordsSync, type WordsDeps } from '../words-sync';

// ── The stand-in server ──
export class FakeCloud {
  vocabulary: string[] = [];
  lexicon: Record<string, Record<string, unknown>> = {};
  puts = 0;
  requests: { method: string; token: string | null; body?: unknown }[] = [];
  down = false;
  vocabularyTable = true;
  failWith: number | null = null;
  validToken = 'good';

  async request(method: 'GET' | 'PUT', token: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    this.requests.push({ method, token, body });
    if (this.down) throw new Error('network down');
    if (this.failWith) return { status: this.failWith, json: { error: 'The database refused' } };
    if (token !== this.validToken) return { status: 401, json: { error: 'Invalid or expired token' } };
    if (method === 'GET') {
      return {
        status: 200,
        json: {
          vocabulary: { terms: this.vocabulary, updatedAt: this.vocabulary.length ? '2026-10-07T01:00:00.000Z' : null },
          lexicon: Object.values(this.lexicon).sort((a, b) => String(a.id).localeCompare(String(b.id))),
        },
      };
    }
    const b = body as { vocabulary?: unknown; lexicon?: unknown } | undefined;
    if (!b || (b.vocabulary === undefined && b.lexicon === undefined)) return { status: 400, json: { error: 'Send "vocabulary", "lexicon" or both' } };
    if (b.vocabulary !== undefined) {
      if (!Array.isArray(b.vocabulary) || b.vocabulary.some((t) => typeof t !== 'string' || t.length > 200)) return { status: 400, json: { error: 'bad vocabulary' } };
      if (!this.vocabularyTable) return { status: 503, json: { error: 'migration 009 is not applied' } };
    }
    if (b.lexicon !== undefined) {
      if (!Array.isArray(b.lexicon) || b.lexicon.length > 2000) return { status: 400, json: { error: 'bad lexicon' } };
      for (const [i, e] of (b.lexicon as Record<string, unknown>[]).entries()) {
        if (typeof e?.id !== 'string' || !e.id.trim() || typeof e.term !== 'string' || !e.term.trim() || e.term.length > 200) return { status: 400, json: { error: `lexicon[${i}]: bad entry` } };
        if (typeof e.count !== 'number' || typeof e.enabled !== 'boolean' || typeof e.pinned !== 'boolean') return { status: 400, json: { error: `lexicon[${i}]: bad flags` } };
        if (Number.isNaN(Date.parse(String(e.createdAt))) || Number.isNaN(Date.parse(String(e.lastSeen)))) return { status: 400, json: { error: `lexicon[${i}]: bad date` } };
      }
    }
    this.puts++;
    if (b.vocabulary !== undefined) this.vocabulary = [...new Set((b.vocabulary as string[]).map((t) => t.trim()).filter(Boolean))];
    if (b.lexicon !== undefined) {
      this.lexicon = {};
      for (const e of b.lexicon as Record<string, unknown>[]) this.lexicon[String(e.id)] = { ...e, syncedAt: '2026-10-07T01:00:00.000Z' };
    }
    return { status: 200, json: { ok: true } };
  }
}

// ── A phone (or the computer) in memory ──
export const entry = (id: string, term: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  id,
  term,
  heardAs: [],
  count: 1,
  enabled: true,
  pinned: false,
  source: 'correction',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastSeen: '2026-10-01T00:00:00.000Z',
  ...over,
});

export class Device {
  vocabulary: string[] = [];
  lexicon: LexiconEntry[] = [];
  snapshot: SyncSnapshot | null = null;
  notes: string[] = [];
  userId = 'u1';
  allowed = true;
  token: string | null = 'good';
  clock = '2026-10-07T02:00:00.000Z';
  // Runs while the sync waits for the network
  duringSync: (() => void) | null = null;

  constructor(private cloud: FakeCloud) {}

  deps(): WordsDeps {
    return {
      account: () => (this.allowed ? { userId: this.userId } : null),
      token: async () => this.token,
      request: async (method, token, body) => {
        const answer = await this.cloud.request(method, token, body);
        const hook = this.duringSync;
        this.duringSync = null;
        hook?.();
        return answer;
      },
      loadLocal: () => ({ vocabulary: [...this.vocabulary], lexicon: this.lexicon.map((e) => ({ ...e, heardAs: [...e.heardAs] })) }),
      saveVocabulary: (terms) => {
        this.vocabulary = terms;
      },
      saveLexicon: (entries) => {
        this.lexicon = entries;
      },
      loadSnapshot: () => this.snapshot,
      saveSnapshot: (s) => {
        this.snapshot = parseSnapshot(JSON.stringify(s));
      },
      now: () => this.clock,
      note: (text) => this.notes.push(text),
    };
  }

  sync() {
    return runWordsSync(this.deps());
  }
}

