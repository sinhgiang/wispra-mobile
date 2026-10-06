// What Wispra learns from the words a person corrects in History (T-0179). It is the logic of the
// computer's Wispra (spetotext src/main/lexiconLogic.ts and lexicon.ts), kept the same: the same
// word diff, the same guards, the same thresholds, so a correction teaches the phone what it teaches
// the computer. Pure (no storage, no clock of its own), so it is tested and can be ported to Kotlin.
//
// Fix "Cloud Code" to "Claude Code" once and it is remembered (a hint). Fix it again and it is
// replaced by itself after every transcription (the computer also passes a hint to its AI cleanup,
// which the phone's dictation does not have).

export interface LexiconEntry {
  id: string;
  // The right form
  term: string;
  // The wrong forms Whisper wrote for it
  heardAs: string[];
  // How many times a correction confirmed it
  count: number;
  enabled: boolean;
  pinned: boolean;
  source: 'manual' | 'correction';
  createdAt: string;
  lastSeen: string;
}

export interface WordPair {
  heardAs: string;
  term: string;
}

// The same limits as the computer (spetotext src/shared/constants.ts)
export const LEXICON_REPLACE_MIN_COUNT = 2;
export const MAX_LEXICON_ENTRIES = 500;
const MAX_HUNKS = 8;
const MAX_CHANGED_RATIO = 0.4;
const MAX_PHRASE_WORDS = 5;
const MAX_PHRASE_CHARS = 60;
const MAX_DIFF_CELLS = 4_000_000;

const EDGE_PUNCT = /^[.,!?;:…"'“”‘’()[\]{}«»–—-]+|[.,!?;:…"'“”‘’()[\]{}«»–—-]+$/gu;

export function trimEdgePunct(chunk: string): string {
  return chunk.replace(EDGE_PUNCT, '');
}

// Words only: punctuation at the edges is dropped, and a chunk with no letter or digit is no word
export function words(text: string): string[] {
  return text
    .normalize('NFC')
    .split(/\s+/)
    .map(trimEdgePunct)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

export function normKey(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface Hunk {
  del: string[];
  ins: string[];
}

// Words aligned by their longest common run, case ignored; what is left is grouped in changed
// regions. A word that differs only by its case is returned apart (recased).
function diffWords(a: string[], b: string[]): { hunks: Hunk[]; recased: Hunk[] } {
  const ka = a.map(normKey);
  const kb = b.map(normKey);
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ka[i] === kb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  const recased: Hunk[] = [];
  let cur: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) {
      if (cur) {
        hunks.push(cur);
        cur = null;
      }
      if (a[i] !== b[j]) recased.push({ del: [a[i]], ins: [b[j]] });
      i++;
      j++;
      continue;
    }
    if (!cur) cur = { del: [], ins: [] };
    if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) cur.del.push(a[i++]);
    else cur.ins.push(b[j++]);
  }
  if (cur) hunks.push(cur);
  return { hunks, recased };
}

// "hôm" to "Hôm" is a capital at the start of a sentence, not a spelling; "github" to "GitHub" is
function isPlainCapitalization(heardAs: string, term: string): boolean {
  return normKey(heardAs) === normKey(term) && !/\p{Lu}/u.test(term.slice(1));
}

// What was misheard, from the text before a fix and after it. Only words that were replaced count:
// an added or removed word is style, not a mishearing; a text rewritten broadly teaches nothing.
export function extractCorrections(before: string, after: string): WordPair[] {
  const a = words(before);
  const b = words(after);
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_DIFF_CELLS) return [];
  const { hunks, recased } = diffWords(a, b);
  if (hunks.length > 1) {
    const changed = hunks.reduce((sum, h) => sum + Math.max(h.del.length, h.ins.length), 0);
    if (hunks.length > MAX_HUNKS || changed / Math.max(a.length, b.length) > MAX_CHANGED_RATIO) return [];
  }
  const pairs: WordPair[] = [];
  const seen = new Set<string>();
  for (const h of [...hunks, ...recased]) {
    if (h.del.length === 0 || h.ins.length === 0) continue;
    if (h.del.length > MAX_PHRASE_WORDS || h.ins.length > MAX_PHRASE_WORDS) continue;
    const heardAs = h.del.join(' ');
    const term = h.ins.join(' ');
    if (heardAs.length > MAX_PHRASE_CHARS || term.length > MAX_PHRASE_CHARS) continue;
    if (isPlainCapitalization(heardAs, term)) continue;
    const id = `${normKey(heardAs)}\u0000${normKey(term)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    pairs.push({ heardAs, term });
  }
  return pairs;
}

// How an entry is used: replaced in the text by itself, or only remembered (a hint) until a
// second correction confirms it. A manual or pinned one is replaced at once.
export function lexiconMode(e: LexiconEntry): 'off' | 'spelling' | 'replace' | 'hint' {
  if (!e.enabled) return 'off';
  if (e.heardAs.length === 0) return 'spelling';
  return e.source === 'manual' || e.pinned || e.count >= LEXICON_REPLACE_MIN_COUNT ? 'replace' : 'hint';
}

function clone(list: LexiconEntry[]): LexiconEntry[] {
  return list.map((e) => ({ ...e, heardAs: [...e.heardAs] }));
}

// Over the limit, the least confirmed and oldest unpinned entries go first
function cap(list: LexiconEntry[]): LexiconEntry[] {
  if (list.length <= MAX_LEXICON_ENTRIES) return list;
  const dropOrder = list
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => !e.pinned && e.source !== 'manual')
    .sort((x, y) => x.e.count - y.e.count || x.e.lastSeen.localeCompare(y.e.lastSeen));
  const drop = new Set(dropOrder.slice(0, list.length - MAX_LEXICON_ENTRIES).map((d) => d.index));
  return list.filter((_, index) => !drop.has(index));
}

// A wrong form belongs to one entry: the newest claim wins
function releaseHeardAs(list: LexiconEntry[], heardAs: string, keep: LexiconEntry | null): LexiconEntry[] {
  const key = normKey(heardAs);
  return list
    .map((e) => {
      if (e === keep || !e.heardAs.some((h) => normKey(h) === key)) return e;
      e.heardAs = e.heardAs.filter((h) => normKey(h) !== key);
      return e;
    })
    .filter((e) => e === keep || e.heardAs.length > 0 || e.source === 'manual' || e.pinned);
}

export interface LearnResult {
  entries: LexiconEntry[];
  // The entry that learned the pair; null when the pair undid one of Wispra's own replacements
  entry: LexiconEntry | null;
}

export function learnPair(current: LexiconEntry[], pair: WordPair, now: string, makeId: () => string): LearnResult {
  const heardKey = normKey(pair.heardAs);
  const termKey = normKey(pair.term);
  let list = clone(current);
  // The person put back what Wispra had replaced: forget that wrong form, never learn the reverse
  const misfired = list.find((e) => normKey(e.term) === heardKey && e.heardAs.some((h) => normKey(h) === termKey));
  if (misfired) {
    misfired.heardAs = misfired.heardAs.filter((h) => normKey(h) !== termKey);
    misfired.lastSeen = now;
    list = list.filter((e) => e !== misfired || e.heardAs.length > 0 || e.source === 'manual' || e.pinned);
    return { entries: list, entry: null };
  }
  const existing = list.find((e) => normKey(e.term) === termKey) ?? null;
  list = releaseHeardAs(list, pair.heardAs, existing);
  if (existing) {
    if (!existing.heardAs.some((h) => normKey(h) === heardKey)) existing.heardAs.push(pair.heardAs);
    existing.term = pair.term;
    existing.count += 1;
    existing.lastSeen = now;
    return { entries: list, entry: existing };
  }
  const entry: LexiconEntry = {
    id: makeId(),
    term: pair.term,
    heardAs: [pair.heardAs],
    count: 1,
    enabled: true,
    pinned: false,
    source: 'correction',
    createdAt: now,
    lastSeen: now,
  };
  list.push(entry);
  return { entries: cap(list), entry };
}

export interface FixLearning {
  entries: LexiconEntry[];
  // The pairs learned, for the note under the text
  learned: WordPair[];
}

// Everything a fixed text teaches, in order
export function learnFromFix(current: LexiconEntry[], before: string, after: string, now: string, makeId: () => string): FixLearning {
  let list = current;
  const learned: WordPair[] = [];
  for (const pair of extractCorrections(before, after)) {
    const res = learnPair(list, pair, now, makeId);
    list = res.entries;
    if (res.entry) learned.push(pair);
  }
  return { entries: list, learned };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces, in a transcription, the wrong forms of the entries that are confirmed: whole words,
// case ignored, longest phrase first, in one pass. A term written in lower case keeps a capital that
// the heard word started with.
export function applyReplacements(text: string, entries: LexiconEntry[]): string {
  const map = new Map<string, string>();
  for (const e of entries) {
    if (lexiconMode(e) !== 'replace') continue;
    for (const h of e.heardAs) {
      const key = normKey(h);
      if (key && key !== normKey(e.term)) map.set(key, e.term);
    }
  }
  if (map.size === 0 || !text) return text;
  const forms = [...map.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${forms.map((f) => escapeRegExp(f).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(pattern, (match) => {
    const term = map.get(normKey(match));
    if (!term) return match;
    const startedWithCapital = /^\p{Lu}/u.test(match);
    return startedWithCapital && term === term.toLowerCase() ? term.charAt(0).toUpperCase() + term.slice(1) : term;
  });
}

// What History says under an edited text, as the computer words it
export function learnNote(learned: WordPair[]): string {
  if (learned.length === 0) return 'Saved. No word corrections detected.';
  const shown = learned
    .slice(0, 3)
    .map((p) => `“${p.heardAs}” → “${p.term}”`)
    .join(', ');
  const more = learned.length > 3 ? ` and ${learned.length - 3} more` : '';
  return `Learned: ${shown}${more}. Fix it once more and it is replaced by itself.`;
}

// The saved file: unknown or broken rows are skipped, like the history file
export function parseLexicon(json: string): LexiconEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const rows = Array.isArray(data) ? data : [];
  const out: LexiconEntry[] = [];
  for (const row of rows) {
    const e = row as Partial<LexiconEntry> | null;
    if (!e || typeof e.id !== 'string' || typeof e.term !== 'string' || !e.term.trim() || !Array.isArray(e.heardAs)) continue;
    out.push({
      id: e.id,
      term: e.term,
      heardAs: e.heardAs.filter((h): h is string => typeof h === 'string' && h.trim() !== ''),
      count: typeof e.count === 'number' && e.count > 0 ? Math.floor(e.count) : 1,
      enabled: e.enabled !== false,
      pinned: e.pinned === true,
      source: e.source === 'manual' ? 'manual' : 'correction',
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date(0).toISOString(),
      lastSeen: typeof e.lastSeen === 'string' ? e.lastSeen : new Date(0).toISOString(),
    });
  }
  return out;
}

export function serializeLexicon(entries: LexiconEntry[]): string {
  return JSON.stringify(entries);
}
