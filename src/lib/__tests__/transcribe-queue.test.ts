import { describe, expect, it } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import type { MeetingSegment } from '../meeting';
import { emptyAudio, freeName, jobKey, nextJob, runQueue, TRANSCRIBE_CONCURRENCY, type Job, type JobOutcome, type QueueRules } from '../transcribe-queue';
import { jest } from '@jest/globals';

const rules: QueueRules = {
  readyToFinish: (e) => !!e.segments && e.status === 'pending' && !e.segments.some((s) => s.status === 'pending' || s.status === 'recording'),
  wantsNotes: () => false,
  needsSplit: (p) => p.durationMs > 45_000,
};

function piece(id: string, startMs: number, over: Partial<MeetingSegment> = {}): MeetingSegment {
  return { id, uri: `file:///audio/${id}.m4a`, startMs, durationMs: 1000, status: 'pending', text: null, error: null, ...over };
}

// What the owner's iPhone held: two meetings from 06:30 waiting, then a dictation from 10:43
const oldMeeting: Entry = { ...createEntry('meeting', new Date('2026-10-05T06:30:00Z'), 'mobile-m1'), status: 'pending', segments: [piece('p1', 0), piece('p2', 1000)] };
const olderMeeting: Entry = { ...createEntry('meeting', new Date('2026-10-05T06:29:00Z'), 'mobile-m0'), status: 'pending', segments: [piece('q1', 0)] };
const dictation: Entry = { ...createEntry('dictation', new Date('2026-10-05T10:43:00Z'), 'mobile-d1'), status: 'pending', audioUri: 'file:///audio/d1.m4a', durationMs: 34_000 };
const phone = [dictation, oldMeeting, olderMeeting];

describe('the transcription queue', () => {
  it('starts with the oldest entry', () => {
    const job = nextJob(phone, new Set(), rules);
    expect(job?.kind).toBe('transcribe-piece');
    expect(job && jobKey(job)).toBe('mobile-m0#q1');
  });

  it('goes on with the others when one fails for a passing reason (it used to stop everything)', () => {
    // Every meeting piece failed to upload in this run: the dictation is still tried
    const skip = new Set(['mobile-m0#q1', 'mobile-m1#p1', 'mobile-m1#p2']);
    const job = nextJob(phone, skip, rules);
    expect(job?.kind).toBe('transcribe-entry');
    expect(job?.entry.id).toBe('mobile-d1');
  });

  it('tries the next piece of the same meeting when one piece is skipped', () => {
    const job = nextJob([oldMeeting], new Set(['mobile-m1#p1']), rules);
    expect(job && jobKey(job)).toBe('mobile-m1#p2');
  });

  it('has nothing left once everything waiting was skipped', () => {
    const skip = new Set(['mobile-m0#q1', 'mobile-m1#p1', 'mobile-m1#p2', 'mobile-d1:transcribe-entry']);
    expect(nextJob(phone, skip, rules)).toBeNull();
  });

  it('cuts a long piece before sending it, and finishes a meeting whose pieces are done', () => {
    const long: Entry = { ...oldMeeting, segments: [piece('long', 0, { durationMs: 60_000 })] };
    expect(nextJob([long], new Set(), rules)?.kind).toBe('split-piece');
    const done: Entry = { ...oldMeeting, segments: [piece('p1', 0, { status: 'done', text: 'Hi' })] };
    expect(nextJob([done], new Set(), rules)?.kind).toBe('finish-meeting');
  });
});

// The loop the app runs (runQueue), with the real nextJob and the owner's list: what each job does
// is played by a small fake store that changes the list as the app would
describe('the queue loop the app runs', () => {
  function store(list: Entry[], answer: (job: Job) => JobOutcome | 'no-change') {
    let entries = list;
    let allowed = true;
    const run = async (job: Job): Promise<JobOutcome> => {
      const outcome = answer(job);
      if (outcome !== 'done') return outcome === 'later' ? 'later' : 'done';
      entries = entries.map((e) => {
        if (e.id !== job.entry.id) return e;
        if (job.kind === 'transcribe-piece') return { ...e, segments: e.segments!.map((s) => (s.id === job.piece.id ? { ...s, status: 'done' as const, text: 'x' } : s)) };
        if (job.kind === 'finish-meeting') return { ...e, status: 'done' as const };
        return { ...e, status: 'done' as const, text: 'x' };
      });
      return 'done';
    };
    return {
      opts: { allowed: () => allowed, pick: (skip: ReadonlySet<string>) => nextJob(entries, skip, rules), run },
      stop: () => (allowed = false),
      entries: () => entries,
    };
  }

  it('does everything waiting, oldest first, then stops', async () => {
    const s = store(phone, () => 'done');
    expect(await runQueue(s.opts)).toEqual([
      'mobile-m0#q1',
      'mobile-m0:finish-meeting',
      'mobile-m1#p1',
      'mobile-m1#p2',
      'mobile-m1:finish-meeting',
      'mobile-d1:transcribe-entry',
    ]);
    expect(s.entries().every((e) => e.status === 'done')).toBe(true);
  });

  it('skips what failed for a passing reason and still reaches the dictation (the owner’s case)', async () => {
    const s = store(phone, (job) => (job.kind === 'transcribe-piece' ? 'later' : 'done'));
    const ran = await runQueue(s.opts);
    expect(ran).toEqual(['mobile-m0#q1', 'mobile-m1#p1', 'mobile-m1#p2', 'mobile-d1:transcribe-entry']);
    expect(s.entries().find((e) => e.id === 'mobile-d1')?.status).toBe('done');
  });

  it('ends even when a job changes nothing (a meeting that cannot be finished, a piece that cannot be cut)', async () => {
    const stuck: Entry = { ...oldMeeting, segments: [piece('long', 0, { durationMs: 60_000 })] };
    const s = store([stuck, dictation], (job) => (job.kind === 'split-piece' ? 'no-change' : 'done'));
    expect(await runQueue(s.opts)).toEqual(['mobile-m1#long', 'mobile-d1:transcribe-entry']);
  });

  it('checks before every job that Wispra Cloud may still be used', async () => {
    const s = store(phone, () => 'done');
    const run = s.opts.run;
    const ran = await runQueue({ ...s.opts, run: async (job) => (s.stop(), run(job)) });
    expect(ran).toEqual(['mobile-m0#q1']);
  });
});

describe('audio files', () => {
  it('sees a file with nothing recorded as empty, instead of sending it', () => {
    expect(emptyAudio(0)).toBe(true);
    expect(emptyAudio(600)).toBe(true);
    expect(emptyAudio(null)).toBe(true);
    expect(emptyAudio(80_000)).toBe(false);
  });

  it('never writes a recording over another with the same name', () => {
    const taken = new Set(['recording-A.m4a', 'recording-A-1.m4a']);
    let n = 0;
    expect(freeName('recording-B.m4a', (c) => taken.has(c), () => String(++n))).toBe('recording-B.m4a');
    expect(freeName('recording-A.m4a', (c) => taken.has(c), () => String(++n))).toBe('recording-A-2.m4a');
  });
});

describe('several transcriptions at once (T-0164: the words came slowly)', () => {
  // The owner's meeting of 11:33: 24 pieces waiting at once
  const pieces = Array.from({ length: 24 }, (_, i) => piece(`p${i}`, i * 30_000));
  const meeting: Entry = { ...createEntry('meeting', new Date('2026-10-05T04:33:00Z'), 'mobile-m'), status: 'pending', segments: pieces };

  function store(latencyMs: number) {
    let entries: Entry[] = [meeting];
    let running = 0;
    let most = 0;
    const finishedWhileRunning: number[] = [];
    const run = async (job: Job): Promise<JobOutcome> => {
      running++;
      most = Math.max(most, running);
      if (job.kind === 'finish-meeting') finishedWhileRunning.push(running);
      await new Promise((resolve) => setTimeout(resolve, job.kind === 'transcribe-piece' ? latencyMs : 1));
      running--;
      entries = entries.map((e) => {
        if (job.kind === 'transcribe-piece') return { ...e, segments: e.segments!.map((s) => (s.id === job.piece.id ? { ...s, status: 'done' as const, text: 'x' } : s)) };
        return { ...e, status: 'done' as const };
      });
      return 'done';
    };
    return { opts: { allowed: () => true, pick: (skip: ReadonlySet<string>) => nextJob(entries, skip, rules), run }, most: () => most, finishedWhileRunning };
  }

  it('sends up to three pieces at once, and finishes the meeting alone once they are all back', async () => {
    const s = store(15);
    const ran = await runQueue({ ...s.opts, concurrency: TRANSCRIBE_CONCURRENCY });
    expect(TRANSCRIBE_CONCURRENCY).toBe(3);
    expect(s.most()).toBe(3);
    expect(ran).toHaveLength(25);
    expect(ran[ran.length - 1]).toBe('mobile-m:finish-meeting');
    expect(s.finishedWhileRunning).toEqual([1]);
  });

  // On a fake clock, so the figures do not depend on how busy the machine is. The time a piece takes
  // here is a stand-in, not a measure of Wispra Cloud: the real time per piece on the phone is not
  // measured yet (T-0164 review, point 5).
  it('with each piece taking the same time: three at a time take a third of one by one', async () => {
    jest.useFakeTimers();
    try {
      const elapsed = async (concurrency: number) => {
        const s = store(40);
        const t0 = Date.now();
        const done = runQueue({ ...s.opts, concurrency });
        await jest.runAllTimersAsync();
        await done;
        return Date.now() - t0;
      };
      const sequential = await elapsed(1);
      const parallel = await elapsed(3);
      // 24 pieces × 40 ms, then the meeting is finished (1 ms)
      expect(sequential).toBe(24 * 40 + 1);
      expect(parallel).toBe(8 * 40 + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips the pieces that failed for a passing reason while the others go on, three at a time', async () => {
    // Wispra Cloud answered "too many requests" for some pieces (the phone treats 429 as "later"):
    // they are not asked again in this run, the others finish, and the loop ends
    let entries: Entry[] = [meeting];
    let running = 0;
    let most = 0;
    const asked: string[] = [];
    const run = async (job: Job): Promise<JobOutcome> => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
      if (job.kind === 'transcribe-piece') {
        asked.push(job.piece.id);
        const limited = Number(job.piece.id.slice(1)) % 4 === 0;
        if (limited) return 'later';
        entries = entries.map((e) => ({ ...e, segments: e.segments!.map((s) => (s.id === job.piece.id ? { ...s, status: 'done' as const, text: 'x' } : s)) }));
        return 'done';
      }
      entries = entries.map((e) => ({ ...e, status: 'done' as const }));
      return 'done';
    };
    const ran = await runQueue({ allowed: () => true, pick: (skip) => nextJob(entries, skip, rules), run, concurrency: 3 });
    expect(most).toBeLessThanOrEqual(3);
    // 6 of the 24 pieces were limited: each asked once, never again
    expect(asked.filter((id) => Number(id.slice(1)) % 4 === 0)).toHaveLength(6);
    expect(new Set(asked).size).toBe(24);
    expect(entries[0].segments!.filter((s) => s.status === 'done')).toHaveLength(18);
    expect(ran.filter((k) => k.endsWith('finish-meeting'))).toHaveLength(0);
  });
});
