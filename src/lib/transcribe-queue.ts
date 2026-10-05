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

// Transcriptions are sent several at a time (T-0164: the words came slowly, one piece after the
// other); the computer sends every piece as soon as it is cut. Finishing a meeting, writing notes and
// cutting a piece change the list the others are picked from, so they run alone.
export const TRANSCRIBE_CONCURRENCY = 3;

function runsInParallel(job: Job): boolean {
  return job.kind === 'transcribe-piece' || job.kind === 'transcribe-entry';
}

// The queue's loop, as the app runs it. Before each job it checks that Wispra Cloud may still be
// used (another account may have signed in meanwhile). Up to `concurrency` transcriptions run at
// once; any other job waits for them and runs alone. A job that failed for a passing reason is
// skipped for the rest of the run, and so is a job picked again after it was done (it changed
// nothing, as a meeting that cannot be finished or a piece that cannot be cut), so the loop always
// ends. Returns the jobs it ran, in the order they finished.
export async function runQueue(opts: {
  allowed: () => boolean;
  pick: (skip: ReadonlySet<string>) => Job | null;
  run: (job: Job) => Promise<JobOutcome>;
  concurrency?: number;
}): Promise<string[]> {
  const limit = Math.max(1, opts.concurrency ?? 1);
  const skip = new Set<string>();
  const done = new Set<string>();
  const ran: string[] = [];
  const inFlight = new Map<string, Promise<void>>();
  let alone = false;

  for (;;) {
    while (!alone && inFlight.size < limit && opts.allowed()) {
      const job = opts.pick(new Set([...skip, ...inFlight.keys()]));
      if (!job) break;
      const key = jobKey(job);
      if (done.has(key)) {
        skip.add(key);
        continue;
      }
      // Not a transcription: it waits until the running ones are back, then runs on its own
      if (!runsInParallel(job) && inFlight.size > 0) break;
      alone = !runsInParallel(job);
      const task = opts
        .run(job)
        .then((outcome) => {
          ran.push(key);
          if (outcome === 'later') skip.add(key);
          else done.add(key);
        })
        .finally(() => {
          inFlight.delete(key);
          if (!runsInParallel(job)) alone = false;
        });
      inFlight.set(key, task);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }
  return ran;
}

// What a piece with nothing in it says (transcriber.ts). Not a failure: a meeting piece becomes
// empty, a keyboard piece is "not heard"; neither is tried again, and neither makes a meeting "failed"
// (T-0164 review 2: silence Whisper filled with an outro is this, never "speech heard").
export const NO_SPEECH = 'No speech was heard in this recording.';
export const NO_AUDIO = 'No audio was recorded in this file.';

export function isSilenceError(error: string): boolean {
  return error === NO_SPEECH || error === NO_AUDIO;
}

// What a piece of a meeting becomes once Wispra Cloud answered: the one decision the store makes,
// kept pure so it is tested where it is made (T-0164 review 2).
// - words: done, with the words
// - nothing said or recorded (an outro Whisper wrote over silence, say): done and empty, never failed
// - a passing failure (no connection, busy): later, the reason kept on the card
// - anything else, as speech lost to the filters or a refused file: failed, the audio kept
export type PieceUpdate =
  | { kind: 'done'; text: string }
  | { kind: 'later'; error: string }
  | { kind: 'failed'; error: string };

export function pieceUpdate(result: { ok: true; text: string } | { ok: false; error: string; transient?: boolean }): PieceUpdate {
  if (result.ok) return { kind: 'done', text: result.text };
  if (result.transient) return { kind: 'later', error: result.error };
  if (isSilenceError(result.error)) return { kind: 'done', text: '' };
  return { kind: 'failed', error: result.error };
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
