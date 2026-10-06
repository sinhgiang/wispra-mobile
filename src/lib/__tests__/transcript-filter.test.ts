import { describe, expect, it } from '@jest/globals';

import { readableText, transcriptLines } from '../meeting';
import { cleanTranscript, collapseLoops, isReliableSegment, looksLikeGibberishToken, readAnswer, stripGibberish } from '../transcript-filter';

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
    // One or a few vowel-less words are not enough to cut anything: a run needs at least four
    expect(stripGibberish('Mở tab F12 rồi bấm g ở đây')).toBe('Mở tab F12 rồi bấm g ở đây');
    expect(stripGibberish('Hết 5 kg rồi cm này')).toBe('Hết 5 kg rồi cm này');
    // Known limit, the computer's too: four of them close together ("5 kg, 3 km, 2 cm, 1 mm" in
    // lower case) look like a garbled run and are cut
    expect(stripGibberish('thêm 5 kg 3 km 2 cm 1 mm nữa')).not.toContain('km');
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

describe('which segments Whisper sends back are kept (as on the computer, T-0164 review)', () => {
  it('keeps real but unsure speech, which the old rule dropped', () => {
    expect(isReliableSegment({ text: 'nói nhanh', no_speech_prob: 0.1, avg_logprob: -1.4 })).toBe(true);
  });

  it('drops silence filled with invented text', () => {
    expect(isReliableSegment({ text: 'x', no_speech_prob: 0.9, avg_logprob: -1.4 })).toBe(false);
    expect(isReliableSegment({ text: 'x', no_speech_prob: 0.9 })).toBe(false);
  });

  it('never drops a looping segment whole: the loop is collapsed and the real words around it stay', () => {
    // Why: dropping the segment could lose real speech (spetotext transcribe.ts)
    expect(isReliableSegment({ text: 'a', no_speech_prob: 0.1, avg_logprob: -0.2, compression_ratio: 3.1 })).toBe(true);
    const answer = cleanTranscript({
      segments: [
        {
          text: ' Mình họp lúc hai giờ vâng vâng vâng vâng vâng vâng rồi gửi báo cáo.',
          no_speech_prob: 0.05,
          avg_logprob: -0.3,
          compression_ratio: 3.4,
        },
      ],
    });
    expect(answer).toBe('Mình họp lúc hai giờ vâng vâng rồi gửi báo cáo.');
  });

  it('collapses a loop to two, and leaves numbers, lists and phrases said twice alone', () => {
    expect(collapseLoops('vâng vâng vâng vâng')).toBe('vâng vâng');
    expect(collapseLoops('ý là ý là ý là ý là')).toBe('ý là ý là');
    expect(collapseLoops('không không không không')).toBe('không không không không');
    expect(collapseLoops('0 9 0 0 0 5')).toBe('0 9 0 0 0 5');
    expect(collapseLoops('đi chợ đi chợ rồi về')).toBe('đi chợ đi chợ rồi về');
    expect(collapseLoops('mua cam bưởi xoài ổi')).toBe('mua cam bưởi xoài ổi');
  });

  it('cleans a whole answer, segment by segment', () => {
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

describe('filtering segment by segment, not the joined text (T-0164 review, point 2)', () => {
  // The computer's real incident: 30 s of Vietnamese without a full stop, then an outro. Joined,
  // they are ONE sentence and the sentence filter drops all of it.
  const speech = ' hôm nay mình kiểm tra trang web xem cái API của SuperPay có lộ email username password không rồi dùng AI quét lỗi bảo mật cho khách hàng';
  const outro = ' Cảm ơn các bạn đã theo dõi.';

  it('drops only the outro segment, and keeps the real speech written without a full stop', () => {
    const answer = cleanTranscript({
      segments: [
        { text: speech, no_speech_prob: 0.02, avg_logprob: -0.3 },
        { text: outro, no_speech_prob: 0.3, avg_logprob: -0.5 },
      ],
    });
    expect(answer).toBe(speech.trim());
    // Joined, the old way, everything would go
    expect(cleanTranscript({ text: speech + outro })).toBe('');
  });

  it('counts a sentence repeated three times across segments, with one shared count', () => {
    const segment = { text: ' Xin cảm ơn quý vị.', no_speech_prob: 0.1, avg_logprob: -0.2 };
    expect(cleanTranscript({ segments: [segment, segment, segment, segment] })).toBe('Xin cảm ơn quý vị. Xin cảm ơn quý vị.');
  });
});

describe('short real speech is never lost (T-0164 review)', () => {
  it('keeps one-word answers and short phrases, with an ordinary or a low confidence', () => {
    for (const [text, logprob] of [
      [' Dạ.', -0.4],
      [' Vâng ạ.', -1.3],
      [' Ừ.', -1.6],
      [' Không.', -0.9],
      [' Ok rồi.', -1.2],
      [' Rồi, tiếp đi.', -1.5],
    ] as const) {
      expect(cleanTranscript({ segments: [{ text, no_speech_prob: 0.1, avg_logprob: logprob }] })).toBe(text.trim());
    }
  });

  it('keeps short answers around a garbled run, and reports nothing uncovered for them', () => {
    const read = readAnswer({
      segments: [
        { text: ' Dạ.', no_speech_prob: 0.05, avg_logprob: -0.4, start: 0, end: 1 },
        { text: ' Vâng ạ.', no_speech_prob: 0.05, avg_logprob: -0.5, start: 1, end: 2.5 },
      ],
    });
    expect(read.text).toBe('Dạ. Vâng ạ.');
    expect(read.uncoveredSeconds).toBe(0);
    expect(read.gibberish).toBe(false);
  });

  it('still removes the invented words of a confident, noisy segment (the other side of the rule)', () => {
    // no_speech_prob 0.4 is under 0.6, so the segment stays whatever its avg_logprob; a known outro in
    // it is still removed by the sentence filter, and a bare-consonant run by the gibberish filter
    expect(
      cleanTranscript({ segments: [{ text: ' Hẹn gặp lại các bạn trong video sau.', no_speech_prob: 0.4, avg_logprob: -1.8 }] }),
    ).toBe('');
    // A low-confidence segment of ordinary-looking words passes: Whisper's confidence alone is not
    // a reason to drop real speech (the computer lost stretches of real dictations that way)
    expect(cleanTranscript({ segments: [{ text: ' tuần sau mình gặp nhau', no_speech_prob: 0.4, avg_logprob: -1.8 }] })).toBe('tuần sau mình gặp nhau');
  });
});

describe('speech lost to the filters counts as uncovered, so it can be sent again (T-0164 review, point 2)', () => {
  // The computer's own example: every accent lost, confident (avg_logprob -0.07)
  const accentsLost = { text: ' B ph tr s vi c tr l m c n g ch th nh t', no_speech_prob: 0.01, avg_logprob: -0.07, start: 0, end: 12 };

  it('removes the garbled segment and says its 12 seconds are not covered', () => {
    const read = readAnswer({ segments: [accentsLost, { text: ' Rồi nhé.', no_speech_prob: 0.05, avg_logprob: -0.3, start: 12, end: 14 }] });
    expect(read.text).toBe('Rồi nhé.');
    expect(read.speechSeconds).toBe(14);
    expect(read.uncoveredSeconds).toBe(12);
    expect(read.gibberish).toBe(true);
  });

  it('a segment that keeps most of its words covers its time', () => {
    const read = readAnswer({
      segments: [{ text: ' hôm nay mình họp với anh Nam ch c kh th n c nh', no_speech_prob: 0.05, avg_logprob: -0.4, start: 0, end: 10 }],
    });
    expect(read.uncoveredSeconds).toBe(0);
  });
});
