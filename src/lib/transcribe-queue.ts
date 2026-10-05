// How the transcription queue picks and runs its jobs (T-0154). Pure, so it is tested.
//
// The owner's iPhone showed every recording "not transcribed yet" with no request ever reaching
// Wispra Cloud. Two causes: every upload failed on the phone itself (see transcriber.ts), and the
// queue always started from the oldest entry, where a passing failure ended the whole run, so
// nothing after it was ever tried. Now a job that fails for a passing reason is skipped for the
// rest of the run, and the others go on.

import type { Entry } from './entries';
import { segmentsWaiting, type MeetingSegment } from './meeting';

export type Job =
  | { kind: 'finish-meeting'; entry: Entry }
  | { kind: 'split-piece'; entry: Entry; piece: MeetingSegment }
  | { kind: 'transcribe-piece'; entry: Entry; piece: MeetingSegment }
  | { kind: 'transcribe-entry'; entry: Entry }
  | { kind: 'notes'; entry: Entry };

export interface QueueRules {
  // A meeting whose pieces are all done or failed, and that is no longer recording
  readyToFinish(e: Entry): boolean;
  // A finished meeting without notes yet
  wantsNotes(e: Entry): boolean;
  // A piece too long to send in one go, which this phone can cut
  needsSplit(piece: MeetingSegment): boolean;
}

// The key a job is skipped by for the rest of a run
export function jobKey(job: Job): string {
  switch (job.kind) {
    case 'transcribe-piece':
    case 'split-piece':
      return `${job.entry.id}#${job.piece.id}`;
    default:
      return `${job.entry.id}:${job.kind}`;
  }
}

// The next job, oldest entry first, leaving out the ones skipped in this run
export function nextJob(entries: Entry[], skip: ReadonlySet<string>, rules: QueueRules): Job | null {
  const list = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of list) {
    const candidates: Job[] = [];
    if (rules.readyToFinish(e)) candidates.push({ kind: 'finish-meeting', entry: e });
    if (e.status === 'pending' || e.status === 'recording') {
      for (const piece of segmentsWaiting(e.segments)) {
        candidates.push(rules.needsSplit(piece) ? { kind: 'split-piece', entry: e, piece } : { kind: 'transcribe-piece', entry: e, piece });
      }
    }
    if (!e.segments && e.status === 'pending') candidates.push({ kind: 'transcribe-entry', entry: e });
    if (rules.wantsNotes(e)) candidates.push({ kind: 'notes', entry: e });
    const job = candidates.find((j) => !skip.has(jobKey(j)));
    if (job) return job;
  }
  return null;
}

// What running one job came to: 'later' when it failed for a passing reason (no connection,
// server busy), so it is left alone for the rest of this run
export type JobOutcome = 'done' | 'later';

// The queue's loop, as the app runs it. Before each job it checks that Wispra Cloud may still be
// used (another account may have signed in meanwhile). A job that failed for a passing reason is
// skipped for the rest of the run, and so is a job that comes back right after it ran (it changed
// nothing, as a meeting that cannot be finished or a piece that cannot be cut), so the loop always
// ends. Returns the jobs it ran, in order.
export async function runQueue(opts: {
  allowed: () => boolean;
  pick: (skip: ReadonlySet<string>) => Job | null;
  run: (job: Job) => Promise<JobOutcome>;
}): Promise<string[]> {
  const skip = new Set<string>();
  const ran: string[] = [];
  let last: string | null = null;
  while (opts.allowed()) {
    const job = opts.pick(skip);
    if (!job) break;
    const key = jobKey(job);
    if (key === last) {
      skip.add(key);
      last = null;
      continue;
    }
    const outcome = await opts.run(job);
    ran.push(key);
    if (outcome === 'later') skip.add(key);
    last = key;
  }
  return ran;
}

// Less than this, the file holds no audio worth sending (an AAC file with nothing recorded is a
// few hundred bytes of headers); sending it fails on the phone itself
export const MIN_AUDIO_BYTES = 1024;

export function emptyAudio(sizeBytes: number | null | undefined): boolean {
  return (sizeBytes ?? 0) < MIN_AUDIO_BYTES;
}

// A file name not taken yet in a folder: recordings are never written over each other
export function freeName(name: string, taken: (candidate: string) => boolean, makeId: () => string): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (;;) {
    const candidate = `${stem}-${makeId()}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}
