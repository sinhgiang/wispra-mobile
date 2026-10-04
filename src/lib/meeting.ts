// Meetings are recorded in pieces of about half a minute, so each piece can be transcribed while
// the meeting goes on (the live transcript) and long meetings stay under Wispra Cloud's 4 MB limit.
// Pure functions only, so they can be tested without native modules.

export type SegmentStatus = 'recording' | 'pending' | 'failed' | 'done';

export interface MeetingSegment {
  id: string;
  uri: string | null;
  // Position in the meeting (pauses not counted), in milliseconds
  startMs: number;
  durationMs: number;
  status: SegmentStatus;
  text: string | null;
  error: string | null;
  // Cutting this piece into shorter ones was tried (and is not tried again)
  splitTried?: boolean;
}

export interface TopicItem {
  title: string;
  startMs: number;
}

export interface ActionItem {
  text: string;
  owner?: string;
  due?: string;
  atMs?: number;
  done?: boolean;
}

export interface MindMapItem {
  label: string;
  note?: string;
  points?: MindMapItem[];
}

export interface MindMap {
  title: string;
  note?: string;
  topics: MindMapItem[];
  decisions: MindMapItem[];
  actions: MindMapItem[];
  questions: MindMapItem[];
  branchLabels: { decisions: string; actions: string; questions: string };
}

export interface QaTurn {
  question: string;
  answer: string;
  askedAt: string;
}

export interface MeetingNotes {
  summary?: string;
  topics?: TopicItem[];
  actions?: ActionItem[];
  // Made while recording, replaced by the full outline after Stop
  live?: boolean;
  // How many transcript paragraphs the live outline has seen
  liveRefs?: number;
  mindMap?: MindMap;
  post?: string;
  qa?: QaTurn[];
  error?: string;
}

// ── Cutting the recording into pieces ────────────────────────────────────────────────────────

export const SEGMENT_MIN_MS = 25_000;
export const SEGMENT_MAX_MS = 40_000;
// Below this level (dBFS from the recorder's metering) the room counts as quiet
export const QUIET_DB = -40;

// Start the next piece at a quiet moment once the piece is long enough, or anyway at the maximum,
// so a word is rarely cut in two.
export function shouldStartNextSegment(segmentMs: number, meteringDb: number | undefined): boolean {
  if (segmentMs >= SEGMENT_MAX_MS) return true;
  if (segmentMs < SEGMENT_MIN_MS) return false;
  return meteringDb !== undefined && meteringDb < QUIET_DB;
}

// A piece longer than this was not cut on time (Android stops the app's timers while the screen
// is locked); it is cut into SPLIT_PIECE_MS pieces before it is transcribed
export const SPLIT_OVER_MS = 45_000;
export const SPLIT_PIECE_MS = 30_000;

export function needsSplit(segment: Pick<MeetingSegment, 'durationMs' | 'splitTried'>): boolean {
  return segment.durationMs > SPLIT_OVER_MS && !segment.splitTried;
}

// The pieces a long recording was cut into, placed where the original started in the meeting
export function piecesToSegments(
  startMs: number,
  pieces: { uri: string; startMs: number; durationMs: number }[],
  makeId: () => string,
): MeetingSegment[] {
  return pieces.map((p) => ({
    id: makeId(),
    uri: p.uri,
    startMs: startMs + p.startMs,
    durationMs: p.durationMs,
    status: 'pending',
    text: null,
    error: null,
  }));
}

// ── The transcript as the AI sees it ─────────────────────────────────────────────────────────

export interface TranscriptLine {
  ref: number;
  startMs: number;
  text: string;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// One paragraph per transcribed piece, numbered from 1
export function transcriptLines(segments: MeetingSegment[]): TranscriptLine[] {
  return [...segments]
    .sort((a, b) => a.startMs - b.startMs)
    .filter((s) => s.status === 'done' && s.text && s.text.trim())
    .map((s, i) => ({ ref: i + 1, startMs: s.startMs, text: (s.text ?? '').trim() }));
}

export function formatLine(line: TranscriptLine): string {
  return `[${line.ref}] (${formatClock(line.startMs)}) ${line.text}`;
}

export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map(formatLine).join('\n');
}

export function plainText(segments: MeetingSegment[]): string {
  return transcriptLines(segments)
    .map((l) => l.text)
    .join(' ');
}

// Parts of at most maxChars each, never cutting a paragraph
export function splitLines(lines: TranscriptLine[], maxChars: number): TranscriptLine[][] {
  const parts: TranscriptLine[][] = [];
  let part: TranscriptLine[] = [];
  let size = 0;
  for (const line of lines) {
    const length = formatLine(line).length + 1;
    if (part.length > 0 && size + length > maxChars) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(line);
    size += length;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

// ── State of a meeting made of pieces ────────────────────────────────────────────────────────

export function segmentsWaiting(segments: MeetingSegment[] | undefined): MeetingSegment[] {
  return (segments ?? []).filter((s) => s.status === 'pending').sort((a, b) => a.startMs - b.startMs);
}

// done once every piece is transcribed; failed when one could not be; pending otherwise
export function meetingStatus(segments: MeetingSegment[]): 'pending' | 'failed' | 'done' {
  if (segments.some((s) => s.status === 'pending' || s.status === 'recording')) return 'pending';
  if (segments.some((s) => s.status === 'failed')) return 'failed';
  return 'done';
}

// A meeting cut off by the app being killed: its unfinished piece waits like the others
export function recoverSegments(segments: MeetingSegment[]): MeetingSegment[] {
  return segments.map((s) => (s.status === 'recording' ? { ...s, status: 'pending' } : s));
}

// Where a moment of the meeting is: which piece, and how far into it
export function locate(segments: MeetingSegment[], ms: number): { index: number; offsetMs: number } | null {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (ms >= sorted[i].startMs) return { index: i, offsetMs: Math.min(ms - sorted[i].startMs, sorted[i].durationMs) };
  }
  return { index: 0, offsetMs: 0 };
}

// ── Reading what the AI answers ──────────────────────────────────────────────────────────────

// The JSON object in an answer, even when the model wrapped it in a code fence or a sentence
export function extractJson(answer: string): unknown {
  const fenced = answer.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface Outline {
  title?: string;
  summary?: string;
  topics: TopicItem[];
  actions: ActionItem[];
}

// refs in the answer point at transcript paragraphs; unknown refs are dropped, not guessed
export function parseOutline(value: unknown, lines: TranscriptLine[]): Outline | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const at = new Map(lines.map((l) => [l.ref, l.startMs]));
  const topics = list(v.topics)
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const title = str(o.title);
      const start = num(o.start);
      return title ? { title, startMs: (start !== undefined ? at.get(start) : undefined) ?? lines[0]?.startMs ?? 0 } : null;
    })
    .filter((t): t is TopicItem => t !== null);
  const actions = list(v.actions)
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      const text = str(o.text);
      if (!text) return null;
      const ref = num(o.ref);
      const item: ActionItem = { text };
      const owner = str(o.owner);
      const due = str(o.due);
      if (owner) item.owner = owner;
      if (due) item.due = due;
      if (ref !== undefined && at.has(ref)) item.atMs = at.get(ref);
      return item;
    })
    .filter((a): a is ActionItem => a !== null);
  return { title: str(v.title), summary: str(v.summary), topics, actions };
}

function mindMapItems(v: unknown, depth: number): MindMapItem[] {
  return list(v)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const label = str(o.label);
      if (!label) return null;
      const item: MindMapItem = { label };
      const note = str(o.note);
      if (note) item.note = note;
      const extra = [str(o.owner), str(o.due)].filter(Boolean).join(' · ');
      if (extra) item.note = item.note ? `${item.note} (${extra})` : extra;
      if (depth < 2) {
        const points = mindMapItems(o.points, depth + 1);
        if (points.length > 0) item.points = points;
      }
      return item;
    })
    .filter((x): x is MindMapItem => x !== null);
}

export function parseMindMap(value: unknown): MindMap | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const title = str(v.title);
  const topics = mindMapItems(v.topics, 0);
  if (!title || topics.length === 0) return null;
  const labels = (v.branchLabels ?? {}) as Record<string, unknown>;
  return {
    title,
    note: str(v.note),
    topics,
    decisions: mindMapItems(v.decisions, 1),
    actions: mindMapItems(v.actions, 1),
    questions: mindMapItems(v.questions, 1),
    branchLabels: {
      decisions: str(labels.decisions) ?? 'Decisions',
      actions: str(labels.actions) ?? 'Action items',
      questions: str(labels.questions) ?? 'Open questions',
    },
  };
}

// Topics and action items found while recording are added to what is already there
export function mergeLiveOutline(notes: MeetingNotes, found: Outline, seenRefs: number, continues: boolean): MeetingNotes {
  const topics = [...(notes.topics ?? [])];
  for (const [i, t] of found.topics.entries()) {
    if (i === 0 && continues && topics.length > 0) continue;
    topics.push(t);
  }
  const known = new Set((notes.actions ?? []).map((a) => a.text.toLowerCase()));
  const actions = [...(notes.actions ?? []), ...found.actions.filter((a) => !known.has(a.text.toLowerCase()))];
  return { ...notes, topics, actions, live: true, liveRefs: seenRefs };
}
