import { describe, expect, it } from '@jest/globals';

import { readableText, transcriptLines } from '../meeting';
import { cleanTranscript, isReliableSegment, looksLikeGibberishToken, stripGibberish } from '../transcript-filter';

// The garbled stretch of the owner's meeting "Bảo mật web và AI" (build 4, T-0164)
const OWNERS_MEETING =
  'thì đó đều có sự quy ki ch g l n ch c kh th n c nh c l r l c b v r l kh b m Th ti m th quay l c ch nh tr gi s m k th c b n m hay l web c b c g DevTool l ha b n c c ph Network n m ph to to t m k th c t m nh l hoang bác quật là 2456 đi rồi đó thì các bạn thấy';

describe('bare consonants Whisper writes for unclear speech (T-0164)', () => {
  it('flags a word with no vowel once its marks are stripped, but not acronyms or real words', () => {
    for (const w of ['ch', 'g', 'kh', 'th', 'nh', 'ph']) expect(looksLikeGibberishToken(w)).toBe(true);
    for (const w of ['CEO', 'ALT', 'được', 'người', 'web', 'quy', 'hay', 'Network']) expect(looksLikeGibberishToken(w)).toBe(false);
  });

  it('cuts the garbled run out of the owner’s meeting and keeps the real words on both sides', () => {
    const cleaned = stripGibberish(OWNERS_MEETING);
    expect(cleaned.startsWith('thì đó đều có sự quy')).toBe(true);
    expect(cleaned).toContain('hoang bác quật là 2456 đi rồi đó thì các bạn thấy');
    expect(cleaned).not.toMatch(/\bch c kh th\b/);
    expect(cleaned).not.toMatch(/\bl r l c b v r\b/);
  });

  it('leaves normal Vietnamese and English untouched', () => {
    const fine = 'Hôm nay chúng ta họp với CEO về API của trang web, lúc 2 giờ.';
    expect(stripGibberish(fine)).toBe(fine);
    // Three vowel-less words close together are not enough to cut anything
    expect(stripGibberish('Mở tab F12 rồi bấm g ở đây')).toBe('Mở tab F12 rồi bấm g ở đây');
  });

  it('drops a sentence that is nothing but bare consonants', () => {
    expect(stripGibberish('C n m l nh v th t th c')).toBe('');
  });

  it('cleans what was saved before the filter, as it is read for the transcript and the notes', () => {
    expect(readableText(OWNERS_MEETING)).not.toMatch(/\bch c kh th\b/);
    const lines = transcriptLines([
      { id: 'a', uri: null, startMs: 0, durationMs: 30_000, status: 'done', text: OWNERS_MEETING, error: null },
      { id: 'b', uri: null, startMs: 30_000, durationMs: 30_000, status: 'done', text: 'ch c kh th n c nh', error: null },
      { id: 'c', uri: null, startMs: 60_000, durationMs: 30_000, status: 'done', text: 'Kết luận buổi họp.', error: null },
    ]);
    expect(lines.map((l) => [l.ref, l.startMs])).toEqual([
      [1, 0],
      [2, 60_000],
    ]);
  });
});

describe('which segments Whisper sends back are kept (as on the computer)', () => {
  it('keeps real but unsure speech, which the old rule dropped', () => {
    expect(isReliableSegment({ text: 'nói nhanh', no_speech_prob: 0.1, avg_logprob: -1.4 })).toBe(true);
  });

  it('drops silence filled with invented text, and loops', () => {
    expect(isReliableSegment({ text: 'x', no_speech_prob: 0.9, avg_logprob: -1.4 })).toBe(false);
    expect(isReliableSegment({ text: 'x', no_speech_prob: 0.9 })).toBe(false);
    expect(isReliableSegment({ text: 'a a a a', no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 3.1 })).toBe(false);
  });

  it('cleans a whole answer', () => {
    expect(
      cleanTranscript({
        segments: [
          { text: ' Chào cả nhà.', no_speech_prob: 0.02, avg_logprob: -0.3 },
          { text: ' ki ch g l n ch c kh th n c.', no_speech_prob: 0.1, avg_logprob: -0.8 },
          { text: ' Bắt đầu nhé.', no_speech_prob: 0.05, avg_logprob: -0.4 },
        ],
      }),
    ).toBe('Chào cả nhà. Bắt đầu nhé.');
  });
});
