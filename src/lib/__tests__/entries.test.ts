import { describe, expect, it } from '@jest/globals';

import {
  createEntry,
  dayLabel,
  defaultMeetingTitle,
  filterEntries,
  formatDuration,
  groupByDay,
  matchesQuery,
  parseEntries,
  previewText,
  recoverInterrupted,
  serializeEntries,
  type Entry,
} from '../entries';

function entry(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', new Date(2026, 9, 4, 9, 0), 'x'), status: 'done', ...over };
}

describe('search', () => {
  it('ignores accents and case', () => {
    const e = entry({ text: 'Tháng này mình chốt được 14 hợp đồng' });
    expect(matchesQuery(e, 'HOP DONG')).toBe(true);
    expect(matchesQuery(e, 'chot 14')).toBe(true);
    expect(matchesQuery(e, 'hợp đồng mới')).toBe(false);
  });

  it('searches the title too, and an empty query matches everything', () => {
    const e = entry({ title: 'Weekly sales meeting', text: null });
    expect(matchesQuery(e, 'sales')).toBe(true);
    expect(matchesQuery(e, '   ')).toBe(true);
  });

  it('filters by kind and sorts newest first', () => {
    const list = [
      entry({ id: 'a', kind: 'dictation', createdAt: '2026-10-04T01:00:00.000Z' }),
      entry({ id: 'b', kind: 'meeting', createdAt: '2026-10-04T03:00:00.000Z' }),
      entry({ id: 'c', kind: 'dictation', createdAt: '2026-10-04T02:00:00.000Z' }),
    ];
    expect(filterEntries(list, '', 'all').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(filterEntries(list, '', 'dictation').map((e) => e.id)).toEqual(['c', 'a']);
    expect(filterEntries(list, '', 'meeting').map((e) => e.id)).toEqual(['b']);
  });
});

describe('days', () => {
  const now = new Date(2026, 9, 4, 18, 0);

  it('labels today, yesterday and older days', () => {
    expect(dayLabel(new Date(2026, 9, 4, 0, 5), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 3, 23, 59), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 8, 28), now)).toBe('28 Sep');
    expect(dayLabel(new Date(2025, 11, 31), now)).toBe('31 Dec 2025');
  });

  it('groups sorted entries by day', () => {
    const list = [
      entry({ id: 'a', createdAt: new Date(2026, 9, 4, 9).toISOString() }),
      entry({ id: 'b', createdAt: new Date(2026, 9, 4, 8).toISOString() }),
      entry({ id: 'c', createdAt: new Date(2026, 9, 3, 8).toISOString() }),
    ];
    expect(groupByDay(list, now).map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
    ]);
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75_000)).toBe('1:15');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('names a new meeting after its start time', () => {
    expect(defaultMeetingTitle(new Date(2026, 9, 4, 8, 5))).toBe('Meeting 08:05');
  });

  it('previews an untranscribed meeting by its length and bookmarks', () => {
    const m = { ...createEntry('meeting', new Date(), 'm'), durationMs: 125_000, bookmarks: [1000] };
    expect(previewText(m)).toBe('2:05 · 1 bookmark');
    expect(previewText({ ...m, text: 'hello   world' })).toBe('hello world');
  });
});

describe('never losing a recording', () => {
  it('turns a recording cut off by the app being killed into one waiting for transcription', () => {
    const list = [entry({ id: 'old', status: 'recording' }), entry({ id: 'live', status: 'recording' })];
    const fixed = recoverInterrupted(list, 'live');
    expect(fixed[0].status).toBe('pending');
    expect(fixed[0].error).toMatch(/interrupted/);
    expect(fixed[1].status).toBe('recording');
  });

  it('round-trips through the saved file', () => {
    const list = [entry({ id: 'a', audioUri: 'file:///a.m4a', bookmarks: [5] })];
    expect(parseEntries(serializeEntries(list))).toEqual(list);
  });

  it('keeps the good rows of a damaged file', () => {
    const json = JSON.stringify({ entries: [{ id: 'a', kind: 'meeting', createdAt: '2026-10-04T00:00:00Z', status: 'pending' }, { nope: 1 }] });
    const parsed = parseEntries(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'a', title: 'Meeting', bookmarks: [], audioUri: null });
    expect(parseEntries('not json')).toEqual([]);
  });
});
