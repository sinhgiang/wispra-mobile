// Notes (T-0979, step 1): an idea said aloud, kept on the phone first, then shared with Wispra Cloud
// like the history. Pure functions only, so they are tested without native modules.
//
// A note is an Entry of kind 'note'. `text` holds the words as they were said and is never
// replaced: the expert version, the article and the mind map are written beside it.
//
// In Wispra Cloud a note is one row of the shared history (wispra-web docs/HISTORY_API.md), so no
// new table or route is needed: the row's id starts with "mobile-" like every phone entry, `app` is
// NOTE_APP, `text` is the words said, `topic` is the field and `rawText` carries the rest as JSON.
// The server only ever reads and writes the rows of the account whose token it is given.

import { cloudId, formatDate, formatTime, type Entry } from './entries';
import { parseMindMap, type MindMap, type MindMapItem } from './meeting';
import type { HistoryEntry } from './history-sync';

export type NoteStatus = 'new' | 'keep' | 'develop' | 'project' | 'remind';

export interface NoteData {
  status: NoteStatus;
  // When the status was last chosen. Nothing reads it yet: the reminders are a later step.
  statusAt?: string;
  // The field the note belongs to ("Travel"), and the expert the AI writes as
  domain?: string;
  role?: string;
  roleEdited?: boolean;
  // Expert version: the outline, and the articles written from it (newest last, at most MAX_ARTICLES)
  outline?: string;
  articles?: string[];
  mindMap?: MindMap;
  // Shown when the map the AI wrote stayed invalid after the repairs
  mapText?: string;
  // The last AI work that failed, shown where it was asked for
  error?: string;
  // Tokens Wispra Cloud billed for the last AI work of each kind (the allowance it used)
  usage?: Partial<Record<NoteWork, { tokens: number; at: string }>>;
  // Last change made on this phone (or read from another one); a note changed after it was shared
  // is shared again
  updatedAt?: string;
}

export type NoteWork = 'basics' | 'outline' | 'article' | 'map';

export const MAX_ARTICLES = 3;

// The expert the AI writes as when it has not named one (the prompts are in English)
export const DEFAULT_ROLE = 'an expert in the field of this note';

export const NOTE_STATUSES: { value: NoteStatus; label: string; short: string; hint: string }[] = [
  { value: 'new', label: 'New', short: 'New', hint: 'Not decided yet' },
  { value: 'keep', label: 'Keep', short: 'Keep', hint: 'Only saved' },
  { value: 'develop', label: 'Develop into a product', short: 'Develop', hint: 'Marked to develop' },
  { value: 'project', label: 'Use for a project', short: 'For a project', hint: 'Marked for a project' },
  { value: 'remind', label: 'Remind me in 3 days', short: 'Remind in 3 days', hint: 'Only marked: no reminder is sent yet' },
];

export function statusOf(entry: Entry): NoteStatus {
  return entry.note?.status ?? 'new';
}

export function statusLabel(status: NoteStatus, short = false): string {
  const row = NOTE_STATUSES.find((s) => s.value === status) ?? NOTE_STATUSES[0];
  return short ? row.short : row.label;
}

// All the words of the Notes tab in one place (English, like the other tabs; what the person said and
// what the AI writes from it stay in the language of the person)
export const NOTE_TEXT = {
  tab: 'Notes',
  title: 'Notes',
  listEmptyTitle: 'No notes yet',
  listEmptyNote: 'Say an idea. Wispra keeps it on this phone, then writes it out, names it and shares it with your account.',
  record: 'Record a note',
  stop: 'Stop and save',
  cancel: 'Cancel',
  listening: 'Listening',
  saved: 'Saved on this phone.',
  savedWaiting: 'Saved on this phone. Waiting to be transcribed.',
  transcribing: 'Saved on this phone. Transcribing…',
  needSignIn: 'Saved on this phone. Sign in to Wispra Cloud in Account to transcribe and sync it.',
  verbatim: 'Original',
  expert: 'Expert',
  map: 'Mind map',
  outline: 'Outline',
  article: 'Post',
  copy: 'Copy',
  copied: 'Copied',
  rewrite: 'Rewrite',
  writing: 'Writing…',
  redraw: 'Redraw',
  drawing: 'Drawing…',
  draw: 'Draw the mind map',
  download: 'Download',
  changeRole: 'Change role',
  roleLabel: 'Writing as:',
  roleSave: 'Save and rewrite',
  roleCancel: 'Cancel',
  share: 'Share',
  delete: 'Delete note',
  remove: 'Delete',
  missing: 'This note is no longer here.',
  back: 'Back',
  tryAgain: 'Try again',
  trying: 'Trying…',
  holdToDelete: 'Touch and hold to delete',
  statusLabel: 'Status',
  noText: 'The note has no words yet. They appear once Wispra Cloud has transcribed it.',
  writeFirst: 'The outline has not been written yet.',
  writeOutline: 'Write the outline',
  writeArticle: 'Write the post',
  articleAbout: 'A short post developing this idea, written as the expert. Check it before you use it.',
  mapAbout: 'A mind map of this idea: its main branches and points.',
  mapFailed: 'Wispra could not draw a valid mind map. Here is its content as text.',
  version: 'Version',
  aiNote: 'Rewrites are written by Wispra Cloud’s AI. Your original words are always kept.',
  aiNeedsSignIn: 'Sign in to Wispra Cloud in Account to use the AI rewrite.',
  aiNeedsAccountChoice: 'Choose how to use the account you signed in with first, then try again.',
  mapKeptOld: 'Could not redraw a valid mind map. The earlier one is kept.',
  downloadFailed: 'Could not download the mind map',
  tokens: (n: number) => `This used about ${n.toLocaleString('en-US')} AI tokens of your allowance.`,
};

// ── Which notes the lists show ───────────────────────────────────────────────────────────────────

export function isNote(entry: Entry): boolean {
  return entry.kind === 'note';
}

// The moment the note last changed
export function noteStamp(entry: Entry): string {
  return entry.note?.updatedAt ?? entry.createdAt;
}

// "25 Oct 2026 · 14:32": the day and the moment it was said
export function formatNoteDate(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

// A line of the list: the field and the status, as in the design
export function noteChips(entry: Entry): string[] {
  const chips: string[] = [];
  if (entry.note?.domain) chips.push(entry.note.domain);
  chips.push(statusLabel(statusOf(entry), true));
  return chips;
}

// ── What the Copy button puts on the clipboard, and what a share sends ───────────────────────────

export type NoteView = 'verbatim' | 'expert' | 'map';
export type ExpertView = 'outline' | 'article';

export function mapAsText(map: MindMap): string {
  const lines: string[] = [map.title];
  const walk = (items: MindMapItem[], depth: number) => {
    for (const item of items) {
      lines.push(`${'  '.repeat(depth)}- ${item.label}${item.note ? `: ${item.note}` : ''}`);
      if (item.points) walk(item.points, depth + 1);
    }
  };
  if (map.note) lines.push(map.note);
  walk(map.topics, 0);
  for (const [items, label] of [
    [map.decisions, map.branchLabels.decisions],
    [map.actions, map.branchLabels.actions],
    [map.questions, map.branchLabels.questions],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(label);
    walk(items, 1);
  }
  return lines.join('\n');
}

// The article currently shown (versions are numbered from 0); null when none is written
export function shownArticle(note: NoteData | undefined, version: number): string | null {
  const list = note?.articles ?? [];
  if (list.length === 0) return null;
  return list[Math.min(Math.max(version, 0), list.length - 1)] ?? null;
}

// What Copy copies in each view: the words as said, the outline or the article on show
export function copyText(entry: Entry, view: NoteView, expert: ExpertView, version: number): string {
  if (view === 'verbatim') return entry.text?.trim() ?? '';
  if (view === 'expert') return (expert === 'outline' ? entry.note?.outline : shownArticle(entry.note, version))?.trim() ?? '';
  return entry.note?.mindMap ? mapAsText(entry.note.mindMap) : (entry.note?.mapText ?? '');
}

// ── The AI's answers, checked before they are kept ──────────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export interface NoteBasics {
  title: string;
  domain: string;
  role: string;
}

export function parseBasics(value: unknown): NoteBasics | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const title = str(v.title);
  const domain = str(v.domain);
  const role = str(v.role);
  if (!title || !domain || !role) return null;
  return { title: title.slice(0, 120), domain: domain.slice(0, 60), role: role.slice(0, 160) };
}

// The model sometimes writes "\n" as two characters inside the JSON strings
function normalize(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim();
}

export function parseExpertText(value: unknown, key: 'outline' | 'article'): string | null {
  if (!value || typeof value !== 'object') return null;
  const text = str((value as Record<string, unknown>)[key]);
  return text ? normalize(text) : null;
}

// Why a map the AI wrote cannot be drawn, or null when it can (the repair asks the AI to fix exactly this)
export function mapProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'the answer is not a JSON object';
  const v = value as Record<string, unknown>;
  if (!str(v.title)) return 'the "title" is missing';
  if (!Array.isArray(v.topics) || v.topics.length === 0) return '"topics" is missing or empty';
  return parseMindMap(value) ? null : '"topics" has no item with a "label"';
}

// Every label found in an answer that could not be drawn, as an indented list
export function mapFallbackText(value: unknown, fallback: string): string {
  const lines: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth);
      return;
    }
    const o = node as Record<string, unknown>;
    const label = str(o.label) ?? str(o.title);
    if (label) lines.push(`${'  '.repeat(Math.max(0, depth - 1))}- ${label}${str(o.note) ? `: ${str(o.note)}` : ''}`);
    for (const key of ['topics', 'points', 'decisions', 'actions', 'questions']) walk(o[key], label ? depth + 1 : depth);
  };
  walk(value, 1);
  return lines.length > 0 ? lines.join('\n') : fallback;
}

// ── Sharing with Wispra Cloud ────────────────────────────────────────────────────────────────────

// Where a note says it was made. The history of the computer shows it as a dictation into this "app".
export const NOTE_APP = 'Wispra Notes';
const NOTE_PAYLOAD_VERSION = 1;
// The history route takes 100,000 characters in "text" and in "rawText"
const FIELD_MAX = 100_000;
const PAYLOAD_BUDGET = 90_000;

interface Payload {
  wispraNote: number;
  title: string;
  status: NoteStatus;
  statusAt?: string;
  domain?: string;
  role?: string;
  roleEdited?: boolean;
  outline?: string;
  articles?: string[];
  mindMap?: MindMap;
  mapText?: string;
  updatedAt: string;
}

// A note that Wispra Cloud should have: its words are written
export function isNoteShareable(entry: Entry): boolean {
  return entry.kind === 'note' && entry.status === 'done' && !!entry.text?.trim();
}

export function toNoteHistoryEntry(entry: Entry): HistoryEntry {
  const note = entry.note;
  const payload: Payload = {
    wispraNote: NOTE_PAYLOAD_VERSION,
    title: entry.title,
    status: note?.status ?? 'new',
    statusAt: note?.statusAt,
    domain: note?.domain,
    role: note?.role,
    roleEdited: note?.roleEdited,
    outline: note?.outline,
    articles: note?.articles,
    mindMap: note?.mindMap,
    mapText: note?.mapText,
    updatedAt: noteStamp(entry),
  };
  // Too long for one row: the parts that can be written again go first, never the words
  for (const drop of ['mindMap', 'mapText', 'articles', 'outline'] as const) {
    if (JSON.stringify(payload).length <= PAYLOAD_BUDGET) break;
    delete payload[drop];
  }
  return {
    id: cloudId(entry.id),
    text: entry.text!.trim().slice(0, FIELD_MAX),
    rawText: JSON.stringify(payload),
    createdAt: entry.createdAt,
    app: NOTE_APP,
    topic: note?.domain ? note.domain.slice(0, 200) : null,
    language: null,
    durationSeconds: entry.durationMs > 0 ? Math.round(entry.durationMs / 100) / 10 : null,
  };
}

function isStatus(v: unknown): v is NoteStatus {
  return NOTE_STATUSES.some((s) => s.value === v);
}

function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_ARTICLES);
  return list.length > 0 ? list : undefined;
}

// A row of the shared history that is a note, as a note of the phone; null for any other row
export function noteFromHistoryEntry(h: HistoryEntry, syncedAt: string): Entry | null {
  if (h.app !== NOTE_APP || !h.id.startsWith('mobile-') || !h.text?.trim() || !h.rawText) return null;
  let payload: Partial<Payload> | null;
  try {
    payload = JSON.parse(h.rawText) as Partial<Payload>;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || payload.wispraNote !== NOTE_PAYLOAD_VERSION) return null;
  const note: NoteData = {
    status: isStatus(payload.status) ? payload.status : 'new',
    statusAt: str(payload.statusAt),
    domain: str(payload.domain) ?? str(h.topic),
    role: str(payload.role),
    roleEdited: payload.roleEdited === true ? true : undefined,
    outline: str(payload.outline),
    articles: stringList(payload.articles),
    mindMap: payload.mindMap ? (parseMindMap(payload.mindMap) ?? undefined) : undefined,
    mapText: str(payload.mapText),
    updatedAt: str(payload.updatedAt) ?? h.createdAt,
  };
  return {
    id: h.id,
    kind: 'note',
    title: str(payload.title) ?? NOTE_TEXT.title,
    createdAt: h.createdAt,
    durationMs: typeof h.durationSeconds === 'number' && h.durationSeconds > 0 ? Math.round(h.durationSeconds * 1000) : 0,
    status: 'done',
    audioUri: null,
    text: h.text,
    error: null,
    bookmarks: [],
    source: 'phone',
    syncedAt,
    note,
  };
}

export function isNoteRow(h: HistoryEntry): boolean {
  return h.app === NOTE_APP && h.id.startsWith('mobile-');
}

export interface NoteSyncPlan {
  // Notes made on another device of the account, or changed there after this phone last shared
  upserts: Entry[];
  // This phone's notes the cloud should have
  push: Entry[];
}

// A note changed on the phone after it was last shared. "Shared" is the moment the sync read the note
// to send it, so a change in that same millisecond counts as after it: sending it twice does no harm,
// while missing a change would.
export function changedSinceShared(entry: Entry): boolean {
  return !!entry.syncedAt && noteStamp(entry) >= entry.syncedAt;
}

/**
 * What to do with the notes after reading the newest page of the cloud history.
 * - A note in the cloud that the phone does not have is added, unless it was deleted here
 *   (`skip`: deleted ids). One the phone has is replaced only when the cloud's copy is newer and
 *   the phone's copy has no change of its own waiting.
 * - A note is pushed when never shared, when changed since, or when the cloud should have it
 *   (created within the page that was read) but does not.
 */
export function planNoteSync(local: Entry[], cloud: HistoryEntry[], skip: ReadonlySet<string>, pageIsComplete: boolean, syncedAt: string): NoteSyncPlan {
  const byId = new Map(local.map((e) => [e.id, e]));
  const upserts: Entry[] = [];
  for (const h of cloud) {
    if (!isNoteRow(h) || skip.has(h.id)) continue;
    const incoming = noteFromHistoryEntry(h, syncedAt);
    if (!incoming) continue;
    const mine = byId.get(h.id);
    if (!mine) upserts.push(incoming);
    else if (mine.kind === 'note' && !!mine.syncedAt && !changedSinceShared(mine) && noteStamp(incoming) > noteStamp(mine)) {
      upserts.push({ ...incoming, audioUri: mine.audioUri, durationMs: mine.durationMs || incoming.durationMs });
    }
  }
  const inCloud = new Set(cloud.map((h) => h.id));
  const oldest = pageIsComplete ? '' : cloud.reduce((min, h) => (h.createdAt < min ? h.createdAt : min), '￿');
  const push = local.filter((e) => {
    if (!isNoteShareable(e)) return false;
    if (!e.syncedAt || changedSinceShared(e)) return true;
    return !inCloud.has(cloudId(e.id)) && e.createdAt >= oldest;
  });
  return { upserts, push };
}
