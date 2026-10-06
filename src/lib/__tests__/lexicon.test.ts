import { describe, expect, it } from '@jest/globals';

import { fixText, type Entry } from '../entries';
import {
  applyReplacements,
  extractCorrections,
  learnFromFix,
  learnNote,
  learnPair,
  lexiconMode,
  MAX_LEXICON_ENTRIES,
  normKey,
  parseLexicon,
  serializeLexicon,
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
