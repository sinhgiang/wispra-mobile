// Dictations and meetings kept on the phone. Pure functions only, so they can be tested without
// native modules.

export type EntryKind = 'dictation' | 'meeting';

// recording: the microphone is (or was, if the app was killed) still writing the audio file
// pending:   audio saved, not transcribed yet
// failed:    transcription was tried and failed; the audio is still kept
// done:      transcribed
export type EntryStatus = 'recording' | 'pending' | 'failed' | 'done';

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  createdAt: string;
  durationMs: number;
  status: EntryStatus;
  audioUri: string | null;
  text: string | null;
  error: string | null;
  // Positions in the recording, in milliseconds, that the user marked during a meeting
  bookmarks: number[];
}

export type KindFilter = 'all' | EntryKind;

// Ids of entries made on the phone start with "mobile-", so they never collide with the
// computer's in the shared Wispra Cloud history (wispra-web docs/HISTORY_API.md).
export const MOBILE_ID_PREFIX = 'mobile-';

function randomBytes(count: number): number[] {
  const bytes = new Uint8Array(count);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < count; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes);
}

// mobile-<UUID v4>
export function newId(bytes: number[] = randomBytes(16)): string {
  const b = [...bytes];
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${MOBILE_ID_PREFIX}${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Entries saved by earlier test builds have ids without the prefix; they get it when shared
export function cloudId(id: string): string {
  return id.startsWith(MOBILE_ID_PREFIX) ? id : `${MOBILE_ID_PREFIX}${id}`;
}

export function createEntry(kind: EntryKind, now: Date = new Date(), id: string = newId()): Entry {
  return {
    id,
    kind,
    title: kind === 'meeting' ? defaultMeetingTitle(now) : 'Dictation',
    createdAt: now.toISOString(),
    durationMs: 0,
    status: 'recording',
    audioUri: null,
    text: null,
    error: null,
    bookmarks: [],
  };
}

export function defaultMeetingTitle(date: Date): string {
  return `Meeting ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Newest first
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// Every word of the query must appear in the title or the text. Accents and case are ignored,
// so "hop dong" finds "hợp đồng".
export function matchesQuery(entry: Entry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(`${entry.title}\n${entry.text ?? ''}`);
  return words.every((w) => haystack.includes(w));
}

export function filterEntries(entries: Entry[], query: string, kind: KindFilter): Entry[] {
  return sortEntries(entries).filter((e) => (kind === 'all' || e.kind === kind) && matchesQuery(e, query));
}

export interface DayGroup {
  label: string;
  entries: Entry[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(date: Date, now: Date = new Date()): string {
  if (dayKey(date) === dayKey(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

// Entries must already be sorted newest first
export function groupByDay(entries: Entry[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const label = dayLabel(new Date(entry.createdAt), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// 75000 -> "1:15", 3725000 -> "1:02:05"
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// After the app was killed while recording, the entry still says "recording". The audio written so
// far is kept and waits for transcription like any other recording.
export function recoverInterrupted(entries: Entry[], activeId: string | null = null): Entry[] {
  return entries.map((e) =>
    e.status === 'recording' && e.id !== activeId
      ? { ...e, status: 'pending', error: 'The recording was interrupted. The audio saved until then is kept.' }
      : e,
  );
}

export function needsTranscription(entry: Entry): boolean {
  return entry.status === 'pending' || entry.status === 'failed';
}

// One line shown under the title in lists
export function previewText(entry: Entry): string {
  if (entry.text) return entry.text.replace(/\s+/g, ' ').trim();
  const length = formatDuration(entry.durationMs);
  if (entry.kind === 'meeting') {
    const marks = entry.bookmarks.length;
    return marks > 0 ? `${length} · ${marks} bookmark${marks === 1 ? '' : 's'}` : length;
  }
  return length;
}

export function isEntry(value: unknown): value is Entry {
  const v = value as Partial<Entry> | null;
  return (
    !!v &&
    typeof v.id === 'string' &&
    (v.kind === 'dictation' || v.kind === 'meeting') &&
    typeof v.createdAt === 'string' &&
    typeof v.status === 'string'
  );
}

// Reads the saved file. Unknown or broken rows are skipped instead of losing every entry.
export function parseEntries(json: string): Entry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const rows = Array.isArray((data as { entries?: unknown })?.entries) ? (data as { entries: unknown[] }).entries : [];
  return rows.filter(isEntry).map((e) => ({
    ...e,
    title: e.title ?? (e.kind === 'meeting' ? 'Meeting' : 'Dictation'),
    durationMs: e.durationMs ?? 0,
    audioUri: e.audioUri ?? null,
    text: e.text ?? null,
    error: e.error ?? null,
    bookmarks: Array.isArray(e.bookmarks) ? e.bookmarks : [],
  }));
}

// A dictation made with the mic button over another app. The Android service leaves it in
// wispra/inbox as JSON (see InboxEntry.kt) because the app's JavaScript may not be running then.
export interface InboxRecord {
  id: string;
  createdAt: string;
  durationMs: number;
  audioFileName: string;
  sourceApp: string | null;
  text: string | null;
}

export function parseInboxRecord(json: string): InboxRecord | null {
  let v: Partial<InboxRecord> & { kind?: unknown };
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v.id !== 'string' || typeof v.createdAt !== 'string' || typeof v.audioFileName !== 'string') return null;
  return {
    id: v.id,
    createdAt: v.createdAt,
    durationMs: typeof v.durationMs === 'number' ? v.durationMs : 0,
    audioFileName: v.audioFileName,
    sourceApp: typeof v.sourceApp === 'string' ? v.sourceApp : null,
    text: typeof v.text === 'string' && v.text.trim() ? v.text : null,
  };
}

export function entryFromInbox(record: InboxRecord, audioUri: string | null): Entry {
  return {
    id: record.id,
    kind: 'dictation',
    title: record.sourceApp ?? 'Dictation',
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    status: record.text ? 'done' : 'pending',
    audioUri,
    text: record.text,
    error: null,
    bookmarks: [],
  };
}

export function serializeEntries(entries: Entry[]): string {
  return JSON.stringify({ version: 1, entries }, null, 1);
}
