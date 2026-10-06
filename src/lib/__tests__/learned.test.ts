// The computer's Learned logic on the phone's History (T-0182): picked up from History, suggestions, the writing
// style and the statistics, with the glue that remembers what was waved away. The logic itself is the
// computer's code; these tests check what the phone feeds it and what it answers.
import { describe, expect, it } from '@jest/globals';

import type { Entry } from '../entries';
import { addManualEntry, lexiconMode, type LexiconEntry } from '../lexicon';
import {
  acceptSuggestion,
  autoTermList,
  dismissSuggestion,
  EMPTY_STATE,
  evalReport,
  historyEntries,
  keepAutoTerm,
  parseLearnedState,
  recordDictation,
  recordFix,
  refreshAutoTerms,
  removeAutoTerm,
  resetEval,
  resetLearned,
  resetStyle,
  serializeLearnedState,
  setHabitEnabled,
  setStyleNotes,
  styleBlock,
  styleProfile,
  suggestDocs,
  suggestionList,
  type Inputs,
} from '../learned/learned';

let n = 0;
const makeId = () => `id-${++n}`;
const NOW = '2026-10-06T08:00:00.000Z';

function dictation(text: string, over: Partial<Entry> = {}): Entry {
  n++;
  return {
    id: `mobile-${n}`,
    kind: 'dictation',
    title: 'Dictation',
    createdAt: `2026-10-0${1 + (n % 5)}T0${n % 10}:00:00.000Z`,
    durationMs: 5000,
    status: 'done',
    audioUri: null,
    text,
    error: null,
    bookmarks: [],
    ...over,
  };
}

const inputs = (entries: Entry[], over: Partial<Inputs> = {}): Inputs => ({
  entries,
  vocabulary: [],
  lexicon: [],
  state: EMPTY_STATE,
  learning: true,
  autoLearn: true,
  ...over,
});

// A name that keeps coming up in what the owner dictates
const SEEN = [
  dictation('Hôm nay mình họp với Lumora về kế hoạch quý này'),
  dictation('Gửi báo cáo cho Lumora trước giờ trưa nhé'),
  dictation('Anh nhớ hỏi Lumora về hợp đồng mới'),
];

describe('what the phone gives the computer’s logic', () => {
  it('reads the dictations that have words, newest first, and the original text of a fixed one', () => {
    const fixed = dictation('Dùng Claude Code', { originalText: 'Dùng Cloud Code', createdAt: '2026-10-09T00:00:00.000Z' });
    const pending = dictation('', { status: 'pending', text: null });
    const meeting = dictation('x', { kind: 'meeting' });
    const list = historyEntries([dictation('a', { createdAt: '2026-10-01T00:00:00.000Z' }), fixed, pending, meeting]);
    expect(list.map((e) => e.text)).toEqual(['Dùng Claude Code', 'a']);
    expect(list[0].originalText).toBe('Dùng Cloud Code');
  });

  it('makes a doc of each dictation (what was first typed, and the final) and of each finished meeting', () => {
    const meeting = dictation('Cuộc họp', { kind: 'meeting', segments: [{ id: 's', uri: '', durationMs: 1, status: 'done', text: 'xin chào Lumora', error: null }] as never });
    const docs = suggestDocs([dictation('Dùng Claude Code', { originalText: 'Dùng Cloud Code' }), meeting]);
    expect(docs[0]).toMatchObject({ asr: ['Dùng Cloud Code'], final: ['Dùng Claude Code'] });
    expect(docs[1]).toMatchObject({ id: expect.stringMatching(/^m:/), asr: ['xin chào Lumora'] });
  });
});

describe('Picked up from your History', () => {
  it('picks up a name used again and again in separate dictations', () => {
    const terms = autoTermList(inputs(SEEN));
    expect(terms.map((t) => [t.term, t.via, t.count, t.sources])).toEqual([['Lumora', 'seen', 3, 3]]);
  });

  it('is empty while learning, or Learn my vocabulary from History, is off', () => {
    expect(autoTermList(inputs(SEEN, { learning: false }))).toEqual([]);
    expect(autoTermList(inputs(SEEN, { autoLearn: false }))).toEqual([]);
  });

  it('does not pick up a word the person already keeps, nor one used once or twice', () => {
    expect(autoTermList(inputs(SEEN, { vocabulary: ['Lumora'] }))).toEqual([]);
    expect(autoTermList(inputs(SEEN.slice(0, 2)))).toEqual([]);
  });

  it('Keep makes it one of the person’s own words; Remove means it is never picked up again', () => {
    const i = inputs(SEEN);
    const id = autoTermList(i)[0].id;
    const kept = keepAutoTerm(i, id, NOW, makeId);
    expect(kept).toHaveLength(1);
    expect(lexiconMode(kept[0])).toBe('spelling');
    const removed = removeAutoTerm(EMPTY_STATE, id);
    expect(autoTermList(inputs(SEEN, { state: removed }))).toEqual([]);
  });

  it('is kept for the speech recogniser only when it changed, and starts over with Clear all', () => {
    const first = refreshAutoTerms(inputs(SEEN));
    expect(first.autoTerms).toEqual(['Lumora']);
    expect(refreshAutoTerms(inputs(SEEN, { state: first }))).toBe(first);
    expect(resetLearned({ ...first, dismissed: ['term:x'] })).toMatchObject({ dismissed: [], autoTerms: [] });
  });
});

describe('Suggestions', () => {
  // The person keeps "Claude Code"; Whisper keeps writing "Cloud Code"
  const heard = [dictation('Hôm nay mình dùng Cloud Code để viết'), dictation('Mình thích Cloud Code lắm')];

  it('offers a spelling that recurs and sounds like a word the person keeps, with their own text as the example', () => {
    const list = suggestionList(inputs(heard, { vocabulary: ['Claude Code'] }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'variant', term: 'Claude Code', count: 2 });
    expect(list[0].example.toLowerCase()).toContain('cloud code');
  });

  it('Yes, replace it adds a word that replaces the form, and hides the suggestion', () => {
    const i = inputs(heard, { vocabulary: ['Claude Code'] });
    const id = suggestionList(i)[0].id;
    const result = acceptSuggestion(i, id, NOW, makeId);
    expect(result.lexicon[0]).toMatchObject({ term: 'Claude Code', source: 'manual' });
    expect(lexiconMode(result.lexicon[0])).toBe('replace');
    expect(suggestionList({ ...i, lexicon: result.lexicon, state: result.state })).toEqual([]);
  });

  it('No hides it for good', () => {
    const i = inputs(heard, { vocabulary: ['Claude Code'] });
    const id = suggestionList(i)[0].id;
    expect(suggestionList({ ...i, state: dismissSuggestion(EMPTY_STATE, id) })).toEqual([]);
  });

  it('offers nothing while learning is off, and an id that is gone adds nothing', () => {
    expect(suggestionList(inputs(heard, { vocabulary: ['Claude Code'], learning: false }))).toEqual([]);
    const i = inputs(heard);
    expect(acceptSuggestion(i, 'variant:nope', NOW, makeId)).toEqual({ lexicon: [], state: EMPTY_STATE });
  });
});

describe('Your writing style', () => {
  // Four fixes, each dropping the final full stop: a habit
  const fixes = Array.from({ length: 5 }, (_, i) => dictation(`Mình sẽ gửi báo cáo ngày ${i + 1}`, { originalText: `Mình sẽ gửi báo cáo ngày ${i + 1}.` }));

  it('notices a change kept up in most fixes, with the evidence, and can switch it off', () => {
    const profile = styleProfile(fixes, EMPTY_STATE);
    expect(profile.habits.map((h) => h.id)).toContain('no-final-stop');
    const habit = profile.habits.find((h) => h.id === 'no-final-stop');
    expect(habit?.text).toBe('Do not end the text with a full stop.');
    expect(habit?.evidence).toMatch(/You did this in \d of \d fixes/);
    const off = setHabitEnabled(EMPTY_STATE, 'no-final-stop', false);
    expect(styleProfile(fixes, off).habits.find((h) => h.id === 'no-final-stop')?.enabled).toBe(false);
    expect(setHabitEnabled(off, 'no-final-stop', true).styleOff).toEqual([]);
  });

  it('says nothing from dictations that were never fixed', () => {
    expect(styleProfile([dictation('a b c.'), dictation('d e f.')], EMPTY_STATE).habits).toEqual([]);
  });

  it('keeps the notes on one line, at most 300 characters, and Reset style clears them and the switches', () => {
    const state = setStyleNotes(EMPTY_STATE, `  short   sentences\nnever !  ${'x'.repeat(400)}`);
    expect(state.styleNotes.startsWith('short sentences never !')).toBe(true);
    expect(state.styleNotes.length).toBeLessThanOrEqual(300);
    expect(resetStyle(setHabitEnabled(state, 'h', false))).toMatchObject({ styleNotes: '', styleOff: [] });
  });

  it('gives the AI step the notes and the habits that are on, and nothing while learning is off', () => {
    const state = setStyleNotes(EMPTY_STATE, 'short sentences');
    const block = styleBlock(fixes, state, true);
    expect(block).toContain('The user has personal writing conventions — follow them:');
    expect(block).toContain('- In their own words: short sentences');
    expect(block).toContain('- Do not end the text with a full stop.');
    expect(block).not.toContain('Earlier dictations');
    expect(styleBlock(fixes, state, false)).toBe('');
    expect(styleBlock(fixes, setHabitEnabled(state, 'no-final-stop', false), true)).not.toContain('full stop');
  });
});

describe('Is learning helping?', () => {
  it('counts dictations and words, then the words a fix changed, per 100 words', () => {
    let state = recordDictation(EMPTY_STATE, 100, true, new Date('2026-10-06T08:00:00'));
    state = recordFix(state, { original: 'a b c d', before: 'a b c d', after: 'a b x d', createdAt: '2026-10-06T08:00:00', learning: true });
    const report = evalReport(state, new Date('2026-10-07T08:00:00'));
    expect(report.all).toMatchObject({ dictations: 1, words: 100, edited: 1, edits: 1, rate: 1 });
    expect(report.on.dictations).toBe(1);
    expect(report.off.dictations).toBe(0);
    expect(report.weeks).toHaveLength(8);
  });

  it('does not count punctuation-only fixes or a dictation from before learning was tracked', () => {
    let state = recordDictation(EMPTY_STATE, 50, false, new Date('2026-10-06T08:00:00'));
    state = recordFix(state, { original: 'a b', before: 'a b', after: 'A b.', createdAt: '2026-10-06T08:00:00', learning: false });
    state = recordFix(state, { original: 'a b', before: 'a b', after: 'a x', createdAt: '2026-10-06T08:00:00', learning: undefined });
    expect(evalReport(state, new Date('2026-10-07T08:00:00')).all).toMatchObject({ edited: 0, edits: 0 });
  });

  it('Reset statistics forgets the counts, and fixes to older dictations are not counted afterwards', () => {
    let state = recordDictation(EMPTY_STATE, 50, true, new Date('2026-10-06T08:00:00'));
    state = resetEval(state, new Date('2026-10-07T09:00:00'));
    expect(state.evalRecords).toEqual([]);
    const after = recordFix(state, { original: 'a b', before: 'a b', after: 'a x', createdAt: '2026-10-06T08:00:00', learning: true });
    expect(after).toBe(state);
  });
});

describe('the saved state', () => {
  it('reads back what it wrote, and an unreadable or empty file as nothing waved away', () => {
    const state = { ...EMPTY_STATE, dismissed: ['a'], styleNotes: 'short', styleOff: ['h'], autoTerms: ['Lumora'] };
    expect(parseLearnedState(serializeLearnedState(state))).toEqual(state);
    expect(parseLearnedState('nope')).toEqual(EMPTY_STATE);
    expect(parseLearnedState(null)).toEqual(EMPTY_STATE);
  });

  it('the words added by hand are the same entries the computer makes', () => {
    const added = addManualEntry([], 'Lumora', [], NOW, makeId).entries as LexiconEntry[];
    expect(added[0]).toMatchObject({ source: 'manual', heardAs: [] });
  });
});
