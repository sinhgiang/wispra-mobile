import { describe, expect, it } from '@jest/globals';

import { fixText, type Entry } from '../entries';
import {
  addManualEntry,
  applyReplacements,
  extractCorrections,
  learnFromFix,
  learnNote,
  learnPair,
  lexiconMode,
  MAX_LEXICON_ENTRIES,
  MODE_LABEL,
  MODE_TITLE,
  normKey,
  parseLexicon,
  removeEntry,
  serializeLexicon,
  updateEntry,
  words,
  type LexiconEntry,
} from '../lexicon';

// What a fix teaches, as the computer's Wispra teaches it (T-0179): the same cases as its code comments
let counter = 0;
const makeId = () => `id-${++counter}`;
const NOW = '2026-10-06T08:00:00.000Z';

function learn(list: LexiconEntry[], before: string, after: string) {
  return learnFromFix(list, before, after, NOW, makeId);
}

describe('words and the diff', () => {
  it('drops punctuation at the edges and chunks with no letter or digit', () => {
    expect(words('Xin chào, “Cloud Code” — hôm nay!')).toEqual(['Xin', 'chào', 'Cloud', 'Code', 'hôm', 'nay']);
  });

  it('reads a mishearing: Cloud Code to Claude Code', () => {
    expect(extractCorrections('Tôi dùng Cloud Code mỗi ngày', 'Tôi dùng Claude Code mỗi ngày')).toEqual([{ heardAs: 'Cloud', term: 'Claude' }]);
  });

  it('reads a phrase for a phrase', () => {
    expect(extractCorrections('mở git hub lên', 'mở GitHub lên')).toEqual([{ heardAs: 'git hub', term: 'GitHub' }]);
  });

  it('learns a capital inside a word (github to GitHub) but not a capital at the start (hôm to Hôm)', () => {
    expect(extractCorrections('mở github lên', 'mở GitHub lên')).toEqual([{ heardAs: 'github', term: 'GitHub' }]);
    expect(extractCorrections('hôm nay trời đẹp', 'Hôm nay trời đẹp')).toEqual([]);
  });

  it('learns nothing from punctuation, from words added or removed, or from the same text', () => {
    expect(extractCorrections('xin chào các bạn', 'Xin chào, các bạn.')).toEqual([]);
    expect(extractCorrections('xin chào các bạn', 'xin chào các bạn nhé')).toEqual([]);
    expect(extractCorrections('à xin chào các bạn', 'xin chào các bạn')).toEqual([]);
    expect(extractCorrections('xin chào', 'xin chào')).toEqual([]);
  });

  it('learns nothing from a text rewritten broadly (more than one region, over 40% of the words)', () => {
    expect(extractCorrections('một hai ba bốn năm sáu bảy tám', 'một x ba y năm z bảy t')).toEqual([]);
    // One region is never judged by its share
    expect(extractCorrections('a b c', 'x y z')).toEqual([{ heardAs: 'a b c', term: 'x y z' }]);
  });

  it('gives up on phrases over five words and on nothing to compare', () => {
    expect(extractCorrections('một hai ba bốn năm sáu bảy', 'x')).toEqual([]);
    expect(extractCorrections('', 'x')).toEqual([]);
  });
});

describe('learning', () => {
  it('the first correction is a hint, the second makes it a replacement', () => {
    const once = learn([], 'dùng Cloud Code', 'dùng Claude Code');
    expect(once.learned).toEqual([{ heardAs: 'Cloud', term: 'Claude' }]);
    expect(once.entries).toHaveLength(1);
    expect(lexiconMode(once.entries[0])).toBe('hint');
    expect(applyReplacements('dùng Cloud Code', once.entries)).toBe('dùng Cloud Code');

    const twice = learn(once.entries, 'viết bằng Cloud Code', 'viết bằng Claude Code');
    expect(twice.entries).toHaveLength(1);
    expect(twice.entries[0]).toMatchObject({ term: 'Claude', heardAs: ['Cloud'], count: 2 });
    expect(lexiconMode(twice.entries[0])).toBe('replace');
    expect(applyReplacements('viết bằng Cloud Code', twice.entries)).toBe('viết bằng Claude Code');
  });

  it('does not change the list it was given', () => {
    const list = learn([], 'dùng Cloud Code', 'dùng Claude Code').entries;
    const copy = JSON.parse(JSON.stringify(list));
    learn(list, 'viết Cloud Code', 'viết Claude Code');
    expect(list).toEqual(copy);
  });

  it('a wrong form put back is forgotten, not learned the other way round', () => {
    const replaced = learn(learn([], 'a Cloud b', 'a Claude b').entries, 'c Cloud d', 'c Claude d').entries;
    const undone = learn(replaced, 'e Claude f', 'e Cloud f');
    expect(undone.learned).toEqual([]);
    expect(undone.entries).toEqual([]);
  });

  it('a wrong form belongs to one entry: the newest claim wins', () => {
    const first = learn([], 'say Cloud now', 'say Claude now').entries;
    const second = learn(first, 'say Cloud now', 'say Clod now');
    const claimed = second.entries.filter((e) => e.heardAs.includes('Cloud'));
    expect(claimed.map((e) => e.term)).toEqual(['Clod']);
  });

  it('keeps at most the limit, dropping the least confirmed first', () => {
    let list: LexiconEntry[] = [];
    for (let i = 0; i < MAX_LEXICON_ENTRIES + 3; i++) list = learnPair(list, { heardAs: `sai${i}`, term: `Đúng${i}` }, NOW, makeId).entries;
    expect(list).toHaveLength(MAX_LEXICON_ENTRIES);
  });

  it('fixText keeps the first text for good and refuses an empty or unchanged text', () => {
    const entry = { text: 'dùng Cloud Code' } as Entry;
    const first = fixText(entry, ' dùng Claude Code ');
    expect(first?.entry).toMatchObject({ text: 'dùng Claude Code', originalText: 'dùng Cloud Code' });
    expect(first?.before).toBe('dùng Cloud Code');
    const again = fixText(first!.entry, 'dùng Claude Code Pro');
    expect(again?.entry.originalText).toBe('dùng Cloud Code');
    expect(fixText(entry, '   ')).toBeNull();
    expect(fixText(entry, 'dùng Cloud Code')).toBeNull();
  });
});

describe('replacing in the next transcription', () => {
  const entry = (term: string, heardAs: string[], over: Partial<LexiconEntry> = {}): LexiconEntry => ({
    id: term,
    term,
    heardAs,
    count: 2,
    enabled: true,
    pinned: false,
    source: 'correction',
    createdAt: NOW,
    lastSeen: NOW,
    ...over,
  });

  it('replaces whole words, case ignored, and not parts of other words', () => {
    const list = [entry('Claude', ['cloud'])];
    expect(applyReplacements('Cloud và cloud, nhưng không phải clouds hay cloudy', list)).toBe('Claude và Claude, nhưng không phải clouds hay cloudy');
  });

  it('works with Vietnamese letters on both sides of a word', () => {
    const list = [entry('Hoàng', ['hoàn'])];
    // hoàng is another word and stays; hoàn is replaced wherever it stands alone
    expect(applyReplacements('anh hoàn đến, hoàng hôn, hoàn thành', list)).toBe('anh Hoàng đến, hoàng hôn, Hoàng thành');
  });

  it('takes the longest wrong form first and replaces phrases', () => {
    const list = [entry('Gít', ['git']), entry('GitHub', ['git hub'])];
    expect(applyReplacements('mở git hub, rồi git', list)).toBe('mở GitHub, rồi Gít');
  });

  it('keeps a capital the heard word started with, on a term written in lower case', () => {
    const list = [entry('anh', ['ảnh'])];
    expect(applyReplacements('Ảnh đến. ảnh đi', list)).toBe('Anh đến. anh đi');
  });

  it('leaves alone an entry that is only a hint, switched off, or has nothing heard', () => {
    expect(applyReplacements('cloud', [entry('Claude', ['cloud'], { count: 1 })])).toBe('cloud');
    expect(applyReplacements('cloud', [entry('Claude', ['cloud'], { enabled: false })])).toBe('cloud');
    expect(applyReplacements('cloud', [entry('Claude', [])])).toBe('cloud');
    expect(applyReplacements('cloud', [entry('Claude', ['cloud'], { count: 1, pinned: true })])).toBe('Claude');
  });

  it('is safe with special characters in a wrong form', () => {
    const list = [entry('C++', ['c plus plus (cộng)'])];
    expect(applyReplacements('dùng c plus plus (cộng) nhé', list)).toBe('dùng C++ nhé');
    expect(applyReplacements('', list)).toBe('');
  });
});

describe('the note and the saved file', () => {
  it('tells what was learned, three at most', () => {
    expect(learnNote([])).toBe('Saved. No word corrections detected.');
    expect(learnNote([{ heardAs: 'a', term: 'b' }])).toMatch(/^Learned: “a” → “b”\./);
    const many = [1, 2, 3, 4, 5].map((n) => ({ heardAs: `h${n}`, term: `t${n}` }));
    expect(learnNote(many)).toMatch(/“h3” → “t3” and 2 more\./);
  });

  it('reads the file back, skipping broken rows', () => {
    const list = learn([], 'dùng Cloud Code', 'dùng Claude Code').entries;
    expect(parseLexicon(serializeLexicon(list))).toEqual(list);
    expect(parseLexicon('nope')).toEqual([]);
    expect(parseLexicon(JSON.stringify([{ id: 1 }, null, { id: 'x', term: '  ', heardAs: [] }, { id: 'y', term: 'Ok', heardAs: ['o', 5, ' '] }]))).toEqual([
      expect.objectContaining({ id: 'y', term: 'Ok', heardAs: ['o'], count: 1, enabled: true, source: 'correction' }),
    ]);
    expect(normKey('  Việt   NAM ')).toBe('việt nam');
  });
});

describe('the Learned section’s list (T-0182, as on the computer)', () => {
  const add = (list: LexiconEntry[], term: string, forms: string[]) => addManualEntry(list, term, forms, NOW, makeId);

  it('adds a typed term that replaces its wrong forms at once', () => {
    const { entries, entry } = add([], '  Claude   Code ', ['Cloud Code', ' Clod Code', 'claude code', 'Cloud Code']);
    expect(entry).toMatchObject({ term: 'Claude Code', heardAs: ['Cloud Code', 'Clod Code'], source: 'manual', count: 1, enabled: true, pinned: false });
    expect(lexiconMode(entry!)).toBe('replace');
    expect(applyReplacements('dùng Cloud Code và clod code', entries)).toBe('dùng Claude Code và Claude Code');
  });

  it('a term with no wrong form is a spelling', () => {
    expect(lexiconMode(add([], 'TikTok', []).entry!)).toBe('spelling');
  });

  it('refuses an empty term and one over 80 characters, and cuts the forms at 10 and 80 characters', () => {
    expect(add([], '   ', ['x']).entry).toBeNull();
    expect(add([], 'x'.repeat(81), []).entry).toBeNull();
    const forms = Array.from({ length: 15 }, (_, i) => `sai ${i}`);
    expect(add([], 'Đúng', forms).entry?.heardAs).toHaveLength(10);
    expect(add([], 'Đúng', ['y'.repeat(81)]).entry?.heardAs).toEqual([]);
  });

  it('adding the same term again keeps one entry, gives it the new forms, and counts one more', () => {
    const first = add([], 'Claude', ['Cloud']).entries;
    const second = add(first, 'claude', ['Clod']);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]).toMatchObject({ term: 'claude', heardAs: ['Cloud', 'Clod'], count: 2, source: 'manual' });
  });

  it('a wrong form belongs to one entry: the newest claim wins', () => {
    const first = add([], 'Claude', ['Cloud']).entries;
    const second = add(first, 'Clod', ['Cloud']).entries;
    // The one typed in by hand stays, now only a spelling; one learned from a fix would be dropped
    expect(second.find((e) => e.term === 'Claude')?.heardAs).toEqual([]);
    expect(second.find((e) => e.term === 'Clod')?.heardAs).toEqual(['Cloud']);
  });

  it('Pin, Turn off and removing a heard-as form change only that entry, and a form can only be removed', () => {
    const list = add([], 'Claude', ['Cloud', 'Clod']).entries;
    const id = list[0].id;
    expect(updateEntry(list, id, { pinned: true })[0].pinned).toBe(true);
    expect(lexiconMode(updateEntry(list, id, { enabled: false })[0])).toBe('off');
    expect(updateEntry(list, id, { heardAs: ['Clod'] })[0].heardAs).toEqual(['Clod']);
    // Cannot add a form through an update
    expect(updateEntry(list, id, { heardAs: ['Cloud', 'Clod', 'New'] })[0].heardAs).toEqual(['Cloud', 'Clod']);
    expect(updateEntry(list, 'nope', { pinned: true })).toBe(list);
    expect(list[0].pinned).toBe(false);
  });

  it('Delete removes the entry', () => {
    const list = add(add([], 'A', ['x']).entries, 'B', ['y']).entries;
    expect(removeEntry(list, list[0].id).map((e) => e.term)).toEqual(['B']);
  });

  it('the modes have the computer’s words', () => {
    expect(MODE_LABEL).toEqual({ replace: 'Always replace', hint: 'Hint only', spelling: 'Spelling', off: 'Off' });
    expect(MODE_TITLE.replace).toBe('Wispra swaps the wrong forms for this term automatically.');
  });
});
