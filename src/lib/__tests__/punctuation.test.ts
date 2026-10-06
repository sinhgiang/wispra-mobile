import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  capitalizeStart,
  endsSentence,
  needsPunctuation,
  PUNCTUATION_PROMPT,
  punctuate,
  PUNCTUATION_WAIT_MS,
  sameWords,
  tailOf,
  withDeadline,
  wordKeys,
} from '../punctuation';

// The owner's example (T-0178): no stops or commas, capitals in the middle of a sentence
const OWNERS_TEXT = 'ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ rằng chúng ta cần thay đổi cách làm';
const OWNERS_TEXT_FIXED = 'Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ rằng chúng ta cần thay đổi cách làm.';

describe('keeping the words (T-0178, point 4)', () => {
  it('compares the words only, not the stops or the capitals', () => {
    expect(wordKeys('Ngoài kia, không có sự lắng nghe.')).toEqual(['ngoài', 'kia', 'không', 'có', 'sự', 'lắng', 'nghe']);
    expect(sameWords(OWNERS_TEXT, OWNERS_TEXT_FIXED)).toBe(true);
    expect(sameWords('Hai anh em', 'hai, anh em!')).toBe(true);
  });

  it('refuses a changed, shortened, added or reordered sentence', () => {
    for (const bad of ['Ngoài kia không có sự lắng nghe.', OWNERS_TEXT + ' nhé', 'Kia ngoài không có sự lắng nghe cho nên tôi', OWNERS_TEXT.replace('lắng nghe', 'nghe thấy')]) {
      expect(sameWords(OWNERS_TEXT, bad)).toBe(false);
    }
    // Diacritics are words: a missing one is a change
    expect(sameWords('không có sự', 'khong có sự')).toBe(false);
  });
});

describe('which pieces are looked at', () => {
  it('the owner’s text needs it: no stops, and capitals in the middle of a sentence', () => {
    expect(needsPunctuation(OWNERS_TEXT)).toBe(true);
    expect(needsPunctuation('Ngoài kia Không có sự lắng nghe, Cho nên tôi nghĩ.')).toBe(true);
  });

  it('a short piece, or a text that is already punctuated, is left alone', () => {
    expect(needsPunctuation('Dạ')).toBe(false);
    expect(needsPunctuation('vâng ạ')).toBe(false);
    expect(needsPunctuation('Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ như vậy.')).toBe(false);
  });
});

describe('capital at the start of a sentence', () => {
  it('starts with a capital for the first piece and after a stop, and goes on in small letters after a comma', () => {
    expect(capitalizeStart('xin chào cả nhà', '')).toBe('Xin chào cả nhà');
    expect(capitalizeStart('cho nên tôi nghĩ', 'Không có sự lắng nghe.')).toBe('Cho nên tôi nghĩ');
    expect(capitalizeStart('cho nên tôi nghĩ', 'Không có sự lắng nghe,')).toBe('cho nên tôi nghĩ');
    expect(capitalizeStart('"đúng vậy"', '')).toBe('"Đúng vậy"');
    expect(capitalizeStart('123 người', '')).toBe('123 người');
  });

  it('knows where a sentence ended, and keeps the last words of what was typed', () => {
    expect(endsSentence('Xong rồi.')).toBe(true);
    expect(endsSentence('Xong rồi?"')).toBe(true);
    expect(endsSentence('Xong rồi,')).toBe(false);
    expect(endsSentence('')).toBe(false);
    expect(tailOf('một hai ba bốn năm', 3)).toBe('ba bốn năm');
  });
});

describe('punctuating a piece', () => {
  const answering = (text: unknown) => async () => ({ text });

  it('puts in the stops, the commas and the capitals the model gives, when the words are the same', async () => {
    const asked: string[] = [];
    const result = await punctuate(
      async (system, user, _max, temperature) => {
        asked.push(system, user, String(temperature));
        return { text: OWNERS_TEXT_FIXED };
      },
      OWNERS_TEXT,
      '',
    );
    expect(result).toEqual({ text: OWNERS_TEXT_FIXED, source: 'model' });
    expect(asked[0]).toBe(PUNCTUATION_PROMPT);
    expect(asked[1]).toContain(`TEXT: ${OWNERS_TEXT}`);
    expect(asked[1]).toContain('PREVIOUS: (nothing: this starts the dictation)');
    expect(asked[2]).toBe('0');
  });

  it('tells the model what was typed before, so the piece goes on from it', async () => {
    let user = '';
    await punctuate(async (_s, u) => ((user = u), { text: 'Cho nên, tôi nghĩ rằng chúng ta cần đổi.' }), 'cho nên tôi nghĩ rằng chúng ta cần đổi', 'Không có sự lắng nghe.');
    expect(user).toContain('PREVIOUS: Không có sự lắng nghe.');
  });

  it('types the piece as it came when the model changed a word, never the changed sentence', async () => {
    const result = await punctuate(answering('Ngoài kia, không có sự lắng nghe. Vì vậy, tôi nghĩ rằng chúng ta cần thay đổi cách làm.'), OWNERS_TEXT, '');
    expect(result.source).toBe('rules');
    // Only the first letter changed, by rule: the stops and commas of the model are not used
    expect(result.text).toBe('Ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ rằng chúng ta cần thay đổi cách làm');
  });

  it('types the piece as it came when the model cannot be asked, or answers badly', async () => {
    const down = await punctuate(() => Promise.reject(new Error('offline')), OWNERS_TEXT, 'Xong rồi.');
    expect(down).toEqual({ text: 'Ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ rằng chúng ta cần thay đổi cách làm', source: 'rules' });
    for (const bad of [undefined, null, 5, '', { nope: 1 }]) {
      const result = await punctuate(async () => bad, OWNERS_TEXT, 'Xong rồi.');
      expect(result.source).not.toBe('model');
      expect(sameWords(result.text, OWNERS_TEXT)).toBe(true);
    }
  });

  it('does not ask for a piece that needs nothing, and keeps empty pieces empty', async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return { text: 'x' };
    };
    expect(await punctuate(counting, 'Vâng ạ', '')).toEqual({ text: 'Vâng ạ', source: 'original' });
    expect(await punctuate(counting, 'đã chuẩn rồi, thưa anh. Em đi nhé.', 'Xong rồi.')).toEqual({ text: 'Đã chuẩn rồi, thưa anh. Em đi nhé.', source: 'rules' });
    expect(await punctuate(counting, '', '')).toEqual({ text: '', source: 'original' });
    expect(calls).toBe(0);
  });
});

describe('the wait for the model (T-0178 review)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a few seconds, well under the 45 s the keyboard waits for words and the 90 s of the chat call', () => {
    expect(PUNCTUATION_WAIT_MS).toBeGreaterThanOrEqual(2000);
    expect(PUNCTUATION_WAIT_MS).toBeLessThanOrEqual(5000);
  });

  it('gives the answer when it comes in time', async () => {
    jest.useFakeTimers();
    const result = withDeadline(Promise.resolve('answer'), 4000, () => 'late');
    await expect(result).resolves.toBe('answer');
  });

  it('gives the fallback when the work does not answer, at the deadline and not before', async () => {
    jest.useFakeTimers();
    let done = false;
    const result = withDeadline(new Promise<string>(() => undefined), 4000, () => 'as heard').then((v) => {
      done = true;
      return v;
    });
    await jest.advanceTimersByTimeAsync(3999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    await expect(result).resolves.toBe('as heard');
  });

  it('gives the fallback when the work fails, and ignores an answer that comes after the deadline', async () => {
    jest.useFakeTimers();
    await expect(withDeadline(Promise.reject(new Error('offline')), 4000, () => 'as heard')).resolves.toBe('as heard');
    let finish: (v: string) => void = () => undefined;
    const slow = withDeadline(new Promise<string>((resolve) => (finish = resolve)), 100, () => 'as heard');
    await jest.advanceTimersByTimeAsync(101);
    finish('too late');
    await expect(slow).resolves.toBe('as heard');
  });
});
