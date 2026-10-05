import { describe, expect, it } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import type { MeetingSegment } from '../meeting';
import { emptyAudio, freeName, jobKey, nextJob, type QueueRules } from '../transcribe-queue';

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
