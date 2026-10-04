import { describe, expect, it } from '@jest/globals';

import {
  extractJson,
  formatLine,
  locate,
  meetingStatus,
  mergeLiveOutline,
  needsSplit,
  parseMindMap,
  parseOutline,
  piecesToSegments,
  plainText,
  recoverSegments,
  segmentsWaiting,
  shouldStartNextSegment,
  splitLines,
  transcriptLines,
  type MeetingSegment,
} from '../meeting';

function seg(over: Partial<MeetingSegment>): MeetingSegment {
  return { id: 's', uri: 'file:///s.m4a', startMs: 0, durationMs: 30_000, status: 'done', text: null, error: null, ...over };
}

describe('cutting the recording into pieces', () => {
  it('waits for a quiet moment between 25 and 40 seconds', () => {
    expect(shouldStartNextSegment(10_000, -60)).toBe(false);
    expect(shouldStartNextSegment(30_000, -20)).toBe(false);
    expect(shouldStartNextSegment(30_000, -55)).toBe(true);
    expect(shouldStartNextSegment(30_000, undefined)).toBe(false);
    expect(shouldStartNextSegment(40_000, -10)).toBe(true);
  });
});

describe('pieces that grew long while the screen was locked', () => {
  it('are cut when longer than 45 seconds, and keep their place in the meeting', () => {
    expect(needsSplit({ durationMs: 40_000 })).toBe(false);
    expect(needsSplit({ durationMs: 67_030 })).toBe(true);
    let n = 0;
    const segs = piecesToSegments(
      25_000,
      [
        { uri: 'file:///a-1.m4a', startMs: 0, durationMs: 30_000 },
        { uri: 'file:///a-2.m4a', startMs: 30_000, durationMs: 30_000 },
        { uri: 'file:///a-3.m4a', startMs: 60_000, durationMs: 7_030 },
      ],
      () => `p${++n}`,
    );
    expect(segs.map((s) => [s.id, s.startMs, s.durationMs, s.status])).toEqual([
      ['p1', 25_000, 30_000, 'pending'],
      ['p2', 55_000, 30_000, 'pending'],
      ['p3', 85_000, 7_030, 'pending'],
    ]);
  });
});

describe('transcript', () => {
  const segments = [
    seg({ id: 'b', startMs: 31_000, text: 'Em đề xuất gọi lại 6 khách.' }),
    seg({ id: 'a', startMs: 0, text: 'Tháng này chốt 14 hợp đồng.' }),
    seg({ id: 'c', startMs: 62_000, status: 'pending', text: null }),
    seg({ id: 'd', startMs: 93_000, text: '   ' }),
  ];

  it('numbers the transcribed pieces in order, skipping empty and waiting ones', () => {
    const lines = transcriptLines(segments);
    expect(lines.map(formatLine)).toEqual(['[1] (0:00) Tháng này chốt 14 hợp đồng.', '[2] (0:31) Em đề xuất gọi lại 6 khách.']);
    expect(plainText(segments)).toBe('Tháng này chốt 14 hợp đồng. Em đề xuất gọi lại 6 khách.');
  });

  it('splits long transcripts without cutting a paragraph', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ ref: i + 1, startMs: i * 30_000, text: 'x'.repeat(40) }));
    const parts = splitLines(lines, 200);
    expect(parts.flat()).toEqual(lines);
    expect(parts.every((p) => p.map(formatLine).join('\n').length <= 200)).toBe(true);
  });
});

describe('meeting state', () => {
  it('is pending while a piece waits, failed when one could not be transcribed, else done', () => {
    expect(meetingStatus([seg({}), seg({ status: 'pending' })])).toBe('pending');
    expect(meetingStatus([seg({}), seg({ status: 'failed' })])).toBe('failed');
    expect(meetingStatus([seg({}), seg({})])).toBe('done');
  });

  it('keeps the piece being recorded when the app was killed', () => {
    expect(recoverSegments([seg({ status: 'recording' })])[0].status).toBe('pending');
    expect(segmentsWaiting([seg({ id: 'x', startMs: 9, status: 'pending' }), seg({ id: 'y', startMs: 1, status: 'pending' })]).map((s) => s.id)).toEqual(['y', 'x']);
  });

  it('finds which piece a moment is in', () => {
    const s = [seg({ startMs: 0, durationMs: 30_000 }), seg({ startMs: 30_000, durationMs: 28_000 })];
    expect(locate(s, 45_000)).toEqual({ index: 1, offsetMs: 15_000 });
    expect(locate(s, 10_000)).toEqual({ index: 0, offsetMs: 10_000 });
    expect(locate([], 1)).toBeNull();
  });
});

describe('reading AI answers', () => {
  it('finds the JSON even inside a code fence', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(extractJson('no json')).toBeNull();
  });

  const lines = [
    { ref: 1, startMs: 0, text: 'a' },
    { ref: 2, startMs: 31_000, text: 'b' },
  ];

  it('maps topic and action refs to times and drops what it cannot trust', () => {
    const outline = parseOutline(
      {
        title: 'Weekly sales',
        summary: 'Fourteen contracts.',
        topics: [{ title: 'Monthly results', start: 1 }, { title: 'Trial customers', start: 2 }, { start: 2 }],
        actions: [{ text: 'Send the list', owner: 'Lan', due: 'Monday', ref: 2 }, { text: 'Plan', ref: 99 }, { owner: 'x' }],
      },
      lines,
    );
    expect(outline).toEqual({
      title: 'Weekly sales',
      summary: 'Fourteen contracts.',
      topics: [
        { title: 'Monthly results', startMs: 0 },
        { title: 'Trial customers', startMs: 31_000 },
      ],
      actions: [{ text: 'Send the list', owner: 'Lan', due: 'Monday', atMs: 31_000 }, { text: 'Plan' }],
    });
  });

  it('reads a mind map, two levels deep at most', () => {
    const map = parseMindMap({
      title: 'Sales',
      topics: [{ label: 'Results', points: [{ label: '14 contracts', points: [{ label: 'deep', points: [{ label: 'too deep' }] }] }] }],
      actions: [{ label: 'Send list', owner: 'Lan', due: 'Monday' }],
      branchLabels: { decisions: 'Quyết định' },
    });
    expect(map?.topics[0].points?.[0].points?.[0]).toEqual({ label: 'deep' });
    expect(map?.actions[0]).toEqual({ label: 'Send list', note: 'Lan · Monday' });
    expect(map?.branchLabels).toEqual({ decisions: 'Quyết định', actions: 'Action items', questions: 'Open questions' });
    expect(parseMindMap({ title: 'x', topics: [] })).toBeNull();
  });

  it('adds live topics and new action items, skipping a topic that just continues', () => {
    const notes = { topics: [{ title: 'Results', startMs: 0 }], actions: [{ text: 'Send the list' }] };
    const merged = mergeLiveOutline(
      notes,
      { topics: [{ title: 'Results again', startMs: 31_000 }, { title: 'Budget', startMs: 62_000 }], actions: [{ text: 'send the list' }, { text: 'Call Minh' }] },
      3,
      true,
    );
    expect(merged.topics?.map((t) => t.title)).toEqual(['Results', 'Budget']);
    expect(merged.actions?.map((a) => a.text)).toEqual(['Send the list', 'Call Minh']);
    expect(merged.liveRefs).toBe(3);
  });
});
