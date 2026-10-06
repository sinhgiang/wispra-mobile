// Custom Vocabulary and Learned words, kept the same on the phone and the computer through Wispra Cloud
// (T-0193, step 3 of docs/LEXICON_API.md in wispra-web). The server only stores two lists per account and
// each side merges before it writes, so this file is the merge and the sync run. Pure: the network and the
// phone's files are given in, so it is tested against a stand-in server.
//
// The rules (the same as the computer's, which merges by normKey and lets the newest entry win):
// - A word is the same word when its normKey is the same (case, spaces and accents of the way it is written
//   do not make a second one).
// - Nothing the person has is lost: a word on either side is kept.
// - The newest entry wins when both sides have the word: its spelling, on/off and pinned. The count is the
//   larger of the two (never added: the same fix is not counted twice), the wrong forms are joined.
// - A word the person deleted on one side is deleted on the other too: each phone remembers what it last
//   synced (the snapshot), so "in the snapshot but gone here" means deleted here. A word that was used or
//   changed on the other side after the snapshot stays (the newest wins over a delete).
//   The computer, until it keeps a snapshot of its own, only adds, and so can bring back what the phone
//   deleted; that is the computer's side (T-0192).
// - A list is written only when the merge differs from what the cloud holds.

import { cap, normKey, type LexiconEntry } from './lexicon';

// ── What the cloud sends and takes (wispra-web docs/LEXICON_API.md) ──

export interface CloudEntry {
  id: string;
  term: string;
  heardAs?: unknown;
  count?: number | null;
  enabled?: boolean | null;
  pinned?: boolean | null;
  source?: string | null;
  createdAt?: string | null;
  lastSeen?: string | null;
  syncedAt?: string;
}

export interface CloudLists {
  vocabulary: string[];
  lexicon: LexiconEntry[];
}

const EPOCH = new Date(0).toISOString();

export function entryFromCloud(e: CloudEntry): LexiconEntry | null {
  if (!e || typeof e.id !== 'string' || typeof e.term !== 'string' || !e.term.trim()) return null;
  const createdAt = typeof e.createdAt === 'string' ? e.createdAt : EPOCH;
  return {
    id: e.id,
    term: e.term,
    heardAs: Array.isArray(e.heardAs) ? e.heardAs.filter((h): h is string => typeof h === 'string' && h.trim() !== '') : [],
    count: typeof e.count === 'number' && Number.isFinite(e.count) && e.count > 0 ? Math.floor(e.count) : 1,
    enabled: e.enabled !== false,
    pinned: e.pinned === true,
    source: e.source === 'manual' ? 'manual' : 'correction',
    createdAt,
    lastSeen: typeof e.lastSeen === 'string' ? e.lastSeen : createdAt,
  };
}

// The answer of GET /api/lexicon, or null when it is not in the documented shape
export function parseCloudLists(body: unknown): CloudLists | null {
  const v = body as { vocabulary?: { terms?: unknown }; lexicon?: unknown } | null;
  if (!v || typeof v !== 'object' || !Array.isArray(v.lexicon) || !Array.isArray(v.vocabulary?.terms)) return null;
  const terms = (v.vocabulary?.terms as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  const lexicon = (v.lexicon as CloudEntry[]).map(entryFromCloud).filter((e): e is LexiconEntry => e !== null);
  return { vocabulary: terms, lexicon };
}

// ── Merging ──

interface Keyed<T> {
  key: string;
  item: T;
}

const byKey = <T>(list: readonly T[], key: (t: T) => string): Map<string, T> => {
  const map = new Map<string, T>();
  for (const item of list) if (!map.has(key(item))) map.set(key(item), item);
  return map;
};

// Three sides: here, the cloud, and what was there at the last sync (null: never synced). Returns, in the order
// the cloud has them and then what is only here, the keys that stay, with each side's item.
function threeWay<T>(
  local: readonly T[],
  cloud: readonly T[],
  snapshot: readonly T[] | null,
  key: (t: T) => string,
  changed: (side: T, was: T) => boolean = () => false,
): Keyed<{ local?: T; cloud?: T; was?: T }>[] {
  const l = byKey(local, key);
  const c = byKey(cloud, key);
  const s = snapshot ? byKey(snapshot, key) : null;
  const order = [...c.keys(), ...[...l.keys()].filter((k) => !c.has(k))];
  const out: Keyed<{ local?: T; cloud?: T; was?: T }>[] = [];
  for (const k of order) {
    const here = l.get(k);
    const there = c.get(k);
    const was = s?.get(k);
    // Gone here since the last sync: deleted here, unless the cloud's has changed since (the newest wins)
    const deletedHere = !!s && !!was && !here && !!there && !changed(there, was);
    // Gone from the cloud since the last sync: deleted there, unless it was changed here since
    const deletedThere = !!s && !!was && !there && !!here && !changed(here, was);
    if (deletedHere || deletedThere) continue;
    out.push({ key: k, item: { local: here, cloud: there, was } });
  }
  return out;
}

// ── Custom Vocabulary ──

export function mergeVocabulary(local: readonly string[], cloud: readonly string[], snapshot: readonly string[] | null): string[] {
  return threeWay(local, cloud, snapshot, normKey).map(({ item }) => {
    // Both have it: the cloud's spelling, unless it was re-spelt here since the last sync
    if (item.local !== undefined && item.cloud !== undefined) {
      return item.was !== undefined && item.local !== item.was ? item.local : item.cloud;
    }
    return (item.local ?? item.cloud) as string;
  });
}

// ── Learned words ──

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// One word seen twice (two devices, or a duplicate on one side): the newest entry wins
function joinEntries(a: LexiconEntry, b: LexiconEntry, forms: string[]): LexiconEntry {
  const newer = time(b.lastSeen) > time(a.lastSeen) ? b : a;
  const first = time(a.createdAt) < time(b.createdAt) || (time(a.createdAt) === time(b.createdAt) && a.id <= b.id) ? a : b;
  return {
    // The same id on every device, so a PUT replaces rather than adds: the oldest entry's
    id: first.id,
    term: newer.term,
    heardAs: forms,
    count: Math.max(a.count, b.count),
    enabled: newer.enabled,
    pinned: newer.pinned,
    source: a.source === 'manual' || b.source === 'manual' ? 'manual' : 'correction',
    // The earliest date there is (an entry with none counts as the oldest possible and is passed over)
    createdAt: [a.createdAt, b.createdAt].filter((c) => time(c) > 0).sort()[0] ?? first.createdAt,
    lastSeen: newer.lastSeen,
  };
}

// Duplicates on one side (the same normKey under two ids) are one word before anything is compared
function collapse(list: readonly LexiconEntry[]): LexiconEntry[] {
  const out = new Map<string, LexiconEntry>();
  for (const e of list) {
    const k = normKey(e.term);
    const have = out.get(k);
    out.set(k, have ? joinEntries(have, e, unionForms(have.heardAs, e.heardAs)) : { ...e, heardAs: [...e.heardAs] });
  }
  return [...out.values()];
}

function unionForms(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [...a, ...b]) {
    if (!seen.has(normKey(f))) {
      seen.add(normKey(f));
      out.push(f);
    }
  }
  return out;
}

export function mergeLexicon(local: readonly LexiconEntry[], cloud: readonly LexiconEntry[], snapshot: readonly LexiconEntry[] | null): LexiconEntry[] {
  const key = (e: LexiconEntry) => normKey(e.term);
  const merged = threeWay(collapse(local), collapse(cloud), snapshot ? collapse(snapshot) : null, key, (side, was) => time(side.lastSeen) > time(was.lastSeen)).map(
    ({ item }): LexiconEntry => {
      const { local: here, cloud: there, was } = item;
      if (here && there) {
        // The wrong forms are joined, less those taken off on one side since the last sync
        const forms = threeWay(here.heardAs, there.heardAs, was?.heardAs ?? null, normKey).map(({ item: f }) => (f.local ?? f.cloud) as string);
        return joinEntries(there, here, forms);
      }
      return { ...((here ?? there) as LexiconEntry) };
    },
  );
  return cap(merged);
}

// ── Whether two lists are the same (a list is written only when it changed) ──

const canon = (e: LexiconEntry): string =>
  JSON.stringify([e.id, e.term, [...e.heardAs].sort(), e.count, e.enabled, e.pinned, e.source, e.createdAt, e.lastSeen]);

export function sameLexicon(a: readonly LexiconEntry[], b: readonly LexiconEntry[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.map(canon).sort();
  const y = b.map(canon).sort();
  return x.every((v, i) => v === y[i]);
}

export function sameVocabulary(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// ── The run ──

// What was synced last (the merged lists), and for which account
export interface SyncSnapshot {
  userId: string;
  at: string;
  vocabulary: string[];
  lexicon: LexiconEntry[];
}

export interface CloudIo {
  get(): Promise<CloudLists>;
  // Each list is written alone, so one that the server cannot take yet (503) does not stop the other
  putVocabulary(terms: string[]): Promise<void>;
  putLexicon(entries: LexiconEntry[]): Promise<void>;
}

export interface SyncInput {
  userId: string;
  local: CloudLists;
  snapshot: SyncSnapshot | null;
  now: string;
  io: CloudIo;
}

export interface SyncOutcome {
  vocabulary: string[];
  lexicon: LexiconEntry[];
  snapshot: SyncSnapshot;
  // What was written to the cloud
  wrote: { vocabulary: boolean; lexicon: boolean };
  // What changed here
  changedHere: { vocabulary: boolean; lexicon: boolean };
  // A list the cloud could not take; the other was still synced
  skipped?: string;
}

// Reads the cloud, merges, writes what changed there, and says what the phone should now hold. The snapshot of
// another account is never used: a first sync with an account is a plain union.
export async function syncLists(input: SyncInput): Promise<SyncOutcome> {
  const snapshot = input.snapshot && input.snapshot.userId === input.userId ? input.snapshot : null;
  const cloud = await input.io.get();
  const vocabulary = mergeVocabulary(input.local.vocabulary, cloud.vocabulary, snapshot?.vocabulary ?? null);
  const lexicon = mergeLexicon(input.local.lexicon, cloud.lexicon, snapshot?.lexicon ?? null);

  const wrote = { vocabulary: false, lexicon: false };
  let skipped: string | undefined;
  let storedVocabulary = cloud.vocabulary;
  let storedLexicon = cloud.lexicon;
  if (!sameVocabulary(vocabulary, cloud.vocabulary)) {
    try {
      await input.io.putVocabulary(vocabulary);
      wrote.vocabulary = true;
      storedVocabulary = vocabulary;
    } catch (err) {
      // The server has no table for the vocabulary yet (503): the learned words still go
      if (err instanceof Error && (err as { status?: number }).status === 503) skipped = 'vocabulary';
      else throw err;
    }
  }
  if (!sameLexicon(lexicon, cloud.lexicon)) {
    await input.io.putLexicon(lexicon);
    wrote.lexicon = true;
    storedLexicon = lexicon;
  }
  return {
    vocabulary,
    lexicon,
    snapshot: { userId: input.userId, at: input.now, vocabulary: storedVocabulary, lexicon: storedLexicon },
    wrote,
    changedHere: { vocabulary: !sameVocabulary(vocabulary, input.local.vocabulary), lexicon: !sameLexicon(lexicon, input.local.lexicon) },
    ...(skipped ? { skipped } : {}),
  };
}

export function parseSnapshot(json: string | null | undefined): SyncSnapshot | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<SyncSnapshot> | null;
    if (!v || typeof v.userId !== 'string' || typeof v.at !== 'string' || !Array.isArray(v.vocabulary) || !Array.isArray(v.lexicon)) return null;
    return {
      userId: v.userId,
      at: v.at,
      vocabulary: v.vocabulary.filter((t): t is string => typeof t === 'string'),
      lexicon: (v.lexicon as CloudEntry[]).map(entryFromCloud).filter((e): e is LexiconEntry => e !== null),
    };
  } catch {
    return null;
  }
}
