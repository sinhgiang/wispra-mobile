import { describe, expect, it } from '@jest/globals';

import { createEntry, type Entry } from '../entries';
import { batches, fromHistoryEntry, isShareable, planSync, PHONE_APP_NAME, toHistoryEntry, type HistoryEntry } from '../history-sync';

function dictation(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', new Date('2026-10-05T08:00:00.000Z'), 'mobile-a'), status: 'done', text: 'Hello', ...over };
}

function cloud(over: Partial<HistoryEntry>): HistoryEntry {
  return { id: 'pc-1', text: 'From the computer', createdAt: '2026-10-05T07:00:00.000Z', app: 'Gmail', durationSeconds: 4.5, ...over };
}

describe('what the phone shares', () => {
  it('shares only transcribed dictations made on the phone', () => {
    expect(isShareable(dictation({}))).toBe(true);
    expect(isShareable(dictation({ status: 'pending', text: null }))).toBe(false);
    expect(isShareable(dictation({ text: '   ' }))).toBe(false);
    expect(isShareable(dictation({ kind: 'meeting' }))).toBe(false);
    expect(isShareable(dictation({ source: 'computer' }))).toBe(false);
  });

  it('sends the id with the mobile- prefix, the app it was made in and the length', () => {
    expect(toHistoryEntry(dictation({ id: 'old-id', title: 'Zalo', durationMs: 4250, text: ' Xin chào ' }))).toEqual({
      id: 'mobile-old-id',
      text: 'Xin chào',
      rawText: null,
      createdAt: '2026-10-05T08:00:00.000Z',
      app: 'Zalo',
      durationSeconds: 4.3,
    });
    expect(toHistoryEntry(dictation({ title: 'Dictation', durationMs: 0 }))).toMatchObject({ id: 'mobile-a', app: PHONE_APP_NAME, durationSeconds: null });
  });
});

describe('dictations from the computer', () => {
  it('become done entries marked as from the computer', () => {
    expect(fromHistoryEntry(cloud({}))).toMatchObject({
      id: 'pc-1',
      kind: 'dictation',
      title: 'Gmail',
      status: 'done',
      text: 'From the computer',
      durationMs: 4500,
      audioUri: null,
      source: 'computer',
    });
    expect(fromHistoryEntry(cloud({ app: null, durationSeconds: null }))).toMatchObject({ title: 'Computer', durationMs: 0 });
  });
});

describe('planning a sync', () => {
  it('adds new computer entries once, and never the phone’s own entries back', () => {
    const local = [dictation({ id: 'mobile-a', syncedAt: 'x' }), fromHistoryEntry(cloud({ id: 'pc-old' }))];
    const plan = planSync(local, [cloud({ id: 'pc-new' }), cloud({ id: 'pc-old' }), cloud({ id: 'mobile-a', text: 'Hello' })], new Set(), true);
    expect(plan.upserts.map((e) => e.id)).toEqual(['pc-new']);
  });

  it('updates a computer entry whose text changed, and keeps away hidden ones', () => {
    const local = [fromHistoryEntry(cloud({ id: 'pc-1', text: 'old' }))];
    const plan = planSync(local, [cloud({ id: 'pc-1', text: 'new' }), cloud({ id: 'pc-2' })], new Set(['pc-2']), true);
    expect(plan.upserts.map((e) => [e.id, e.text])).toEqual([['pc-1', 'new']]);
  });

  it('does not put a computer dictation the person fixed on the phone back to the cloud text (T-0179)', () => {
    const fixed = { ...fromHistoryEntry(cloud({ id: 'pc-1', text: 'Cloud Code' })), text: 'Claude Code', originalText: 'Cloud Code' };
    expect(planSync([fixed], [cloud({ id: 'pc-1', text: 'Cloud Code' })], new Set(), true).upserts).toEqual([]);
    // Never an edit of the phone's own: those are not read back from the cloud at all
    expect(planSync([dictation({ id: 'mobile-a', text: 'Claude', originalText: 'Cloud' })], [cloud({ id: 'mobile-a', text: 'Cloud' })], new Set(), true).upserts).toEqual([]);
  });

  it('pushes never-pushed dictations, and pushed ones the cloud has lost', () => {
    const fresh = dictation({ id: 'mobile-fresh' });
    const kept = dictation({ id: 'mobile-kept', syncedAt: 's' });
    const lost = dictation({ id: 'mobile-lost', syncedAt: 's' });
    const waiting = dictation({ id: 'mobile-wait', status: 'pending', text: null });
    const plan = planSync([fresh, kept, lost, waiting], [cloud({ id: 'mobile-kept' })], new Set(), true);
    expect(plan.push.map((e) => e.id)).toEqual(['mobile-fresh', 'mobile-lost']);
  });

  it('does not re-push old dictations that are simply beyond the page read', () => {
    const old = dictation({ id: 'mobile-old', syncedAt: 's', createdAt: '2026-09-01T00:00:00.000Z' });
    const plan = planSync([old], [cloud({ id: 'pc-1', createdAt: '2026-10-05T07:00:00.000Z' })], new Set(), false);
    expect(plan.push).toEqual([]);
  });
});

describe('batches', () => {
  it('splits into groups of at most 500', () => {
    expect(batches(Array.from({ length: 1001 }, (_, i) => i)).map((b) => b.length)).toEqual([500, 500, 1]);
    expect(batches([])).toEqual([]);
  });
});
