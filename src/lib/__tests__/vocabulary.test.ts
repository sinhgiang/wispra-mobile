import { describe, expect, it } from '@jest/globals';

import { buildSttPrompt, selectTerms, type LexiconEntry } from '../lexicon';
import { addTerms, dropTermListEcho, parseVocabulary, removeTerm, spellingKey, spellVocabulary } from '../vocabulary';

// The owner's Custom vocabulary on the computer (T-0182): what Whisper writes for these is put right
const OWNER = ['Github', 'Capcut', 'Timio', 'Wispra', 'TikTok', 'Facebook', 'MCP', 'claude', 'push', 'Helme', 'commit', 'Lenvid', 'Agent', 'Dictate'];

describe('spelling the vocabulary back (the computer’s spellVocabulary)', () => {
  it('joins a term Whisper split, and respells one it wrote its own way', () => {
    expect(spellVocabulary('mở git hub lên rồi cap cut', OWNER)).toBe('mở Github lên rồi Capcut');
    expect(spellVocabulary('Tik Tok và Face book', OWNER)).toBe('TikTok và Facebook');
    expect(spellVocabulary('dùng git-hub nhé', OWNER)).toBe('dùng Github nhé');
    expect(spellVocabulary('Nguyen Van A đến', ['Nguyễn Văn A'])).toBe('Nguyễn Văn A đến');
  });

  it('puts a lowercase letter right: GITHUB, github', () => {
    expect(spellVocabulary('github và GITHUB', OWNER)).toBe('Github và Github');
  });

  it('fixes a name one letter off, when written like a name inside a sentence', () => {
    expect(spellVocabulary('Chúng tôi dùng Timeo mỗi ngày', OWNER)).toBe('Chúng tôi dùng Timio mỗi ngày');
    expect(spellVocabulary('gửi cho Lenvit nhé', OWNER)).toBe('gửi cho Lenvid nhé');
  });

  it('leaves alone what only looks like a term: the start of a sentence, a plural, small letters', () => {
    expect(spellVocabulary('Timeo là ai', OWNER)).toBe('Timeo là ai');
    expect(spellVocabulary('các Agents mới', OWNER)).toBe('các Agents mới');
    expect(spellVocabulary('timid people', OWNER)).toBe('timid people');
  });

  it('a term written in lowercase does not change the case of a word that differs only by case', () => {
    expect(spellVocabulary('Push it. push it', OWNER)).toBe('Push it. push it');
    expect(spellVocabulary('Claude là tốt', OWNER)).toBe('Claude là tốt');
  });

  it('leaves web addresses, e-mails and file names alone', () => {
    expect(spellVocabulary('vào github.com/x và gửi a@github.org, mở capcut.exe', OWNER)).toBe('vào github.com/x và gửi a@github.org, mở capcut.exe');
  });

  it('never adds a word, and never touches a text with no term', () => {
    const text = 'hôm nay tôi họp lúc hai giờ';
    expect(spellVocabulary(text, OWNER)).toBe(text);
    expect(spellVocabulary('', OWNER)).toBe('');
    expect(spellVocabulary(text, [])).toBe(text);
    // Only words that were said: a term not in the text is not added
    expect(spellVocabulary('xin chào', ['GitHub'])).toBe('xin chào');
  });

  it('keys ignore accents, case, spaces and hyphens', () => {
    expect(spellingKey('Nguyễn Văn-A')).toBe('nguyenvana');
  });
});

describe('the list', () => {
  it('adds one term, or a pasted list, and never the same twice', () => {
    expect(addTerms([], 'Github')).toEqual(['Github']);
    expect(addTerms(['Github'], 'Github')).toEqual(['Github']);
    expect(addTerms(['Github'], 'Capcut, Timio; Wispra\nTikTok ,, ')).toEqual(['Github', 'Capcut', 'Timio', 'Wispra', 'TikTok']);
    expect(addTerms(['a'], '   ')).toEqual(['a']);
    // The same letters in another case, spacing or accents are the same term (T-0182 review)
    expect(addTerms(['Github'], 'github, Git Hub, Capcut')).toEqual(['Github', 'Capcut']);
    expect(addTerms(['Nguyễn Văn A'], 'Nguyen Van A')).toEqual(['Nguyễn Văn A']);
    expect(removeTerm(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('reads the saved file, skipping what is not a term', () => {
    expect(parseVocabulary(JSON.stringify(['a', 5, ' ', 'b']))).toEqual(['a', 'b']);
    expect(parseVocabulary('nope')).toEqual([]);
    expect(parseVocabulary(null)).toEqual([]);
  });
});

describe('what Whisper is told to listen for', () => {
  const entry = (term: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
    id: term,
    term,
    heardAs: ['x'],
    count: 1,
    enabled: true,
    pinned: false,
    source: 'correction',
    createdAt: '2026-10-06T00:00:00.000Z',
    lastSeen: '2026-10-06T00:00:00.000Z',
    ...over,
  });

  it('is only the terms, with a stop at the end, at most 20', () => {
    expect(buildSttPrompt(['Github', 'Capcut'])).toBe('Github, Capcut.');
    expect(buildSttPrompt([])).toBeUndefined();
    const many = Array.from({ length: 30 }, (_, i) => `T${i}`);
    expect(buildSttPrompt(many)?.split(', ')).toHaveLength(20);
  });

  it('puts pinned words first, then the list, then the other confirmed words, without twice', () => {
    const entries = [entry('Claude Code', { count: 3 }), entry('Zalo', { pinned: true }), entry('thường nhật', { count: 1 }), entry('Off', { enabled: false, count: 5 })];
    expect(selectTerms(['Github', 'zalo'], entries, 20)).toEqual(['Zalo', 'Github', 'Claude Code']);
    expect(selectTerms(['a', 'b', 'c'], [], 2)).toEqual(['a', 'b']);
  });
});

describe('a prompt echoed back (the computer’s term-list echo guard)', () => {
  it('drops a sentence made only of the prompt’s words, and keeps real speech', () => {
    const prompt = 'Github, Capcut, Timio.';
    expect(dropTermListEcho('Github, Capcut, Timio.', prompt)).toBe('');
    expect(dropTermListEcho('Github Capcut. Hôm nay tôi dùng Capcut để cắt video.', prompt)).toBe('Hôm nay tôi dùng Capcut để cắt video.');
    expect(dropTermListEcho('Capcut', prompt)).toBe('Capcut');
    expect(dropTermListEcho('Hello', undefined)).toBe('Hello');
  });
});
