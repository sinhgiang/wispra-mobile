// What comes back from Whisper is cleaned the same way as in Wispra on the computer
// (spetotext/src/main/transcribe.ts), so the phone never types words nobody said.

export interface Segment {
  text: string;
  no_speech_prob: number;
  avg_logprob?: number;
  compression_ratio?: number;
  // Seconds into the audio sent
  start?: number;
  end?: number;
}

export interface VerboseTranscript {
  text?: string;
  language?: string;
  segments?: Segment[];
}

// A segment is dropped as silence only when Whisper thinks there is no speech (above this) AND was
// unsure of its words (below LOW_CONFIDENCE_LOGPROB): OpenAI's reference rule, as on the computer.
const NO_SPEECH_THRESHOLD = 0.6;
// Whisper's confidence in a segment's words. On its own it does NOT drop a segment: real Vietnamese
// speech that is fast, quiet or long often scores below it (the computer lost whole stretches of
// real dictations that way). Bare consonants are removed word by word by stripGibberish instead.
const LOW_CONFIDENCE_LOGPROB = -1.0;
// Above this a segment's text repeats itself (OpenAI's reference Whisper decodes it again; Groq does
// not). As on the computer, the repetition is collapsed (collapseLoops) and the segment is KEPT:
// dropping it whole could lose real speech (T-0164 review, point 1).
const COMPRESSION_RATIO_THRESHOLD = 2.4;
// A word or short phrase (up to this many words) said more than twice in a row is a loop
const LOOP_MAX_PHRASE_WORDS = 4;

// Digits and number words repeat for real (a phone number "0 9 0 0 0 5", "không không không", an
// amount read twice): never collapsed, since losing one digit loses the number
const NUMBER_WORDS = new Set([
  'không', 'một', 'mốt', 'hai', 'ba', 'bốn', 'tư', 'năm', 'lăm', 'sáu', 'bảy', 'bẩy', 'tám', 'chín', 'mười', 'mươi',
  'linh', 'lẻ', 'trăm', 'nghìn', 'ngàn', 'triệu', 'tỷ', 'tỉ', 'chấm', 'phẩy',
  'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred', 'thousand',
  'million', 'billion', 'double', 'triple', 'point',
]);

function isNumberWord(word: string): boolean {
  return /\p{N}/u.test(word) || NUMBER_WORDS.has(word);
}

// Whisper stuck in a loop ("vâng vâng vâng vâng…"): a word or phrase of up to 4 words repeated three
// times or more in a row is kept twice. A list read out with different items, or a phrase said
// twice, is left as it is. (spetotext/src/main/transcribe.ts, collapseLoops)
export function collapseLoops(text: string): string {
  const tokens = text.split(/(\s+)/).filter((t) => t !== '');
  const words = tokens.filter((t) => !/^\s+$/.test(t));
  const key = (w: string) => w.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let collapsed = false;
    for (let n = 1; n <= LOOP_MAX_PHRASE_WORDS && !collapsed; n++) {
      const unit = words.slice(i, i + n).map(key);
      if (unit.length < n || unit.some((u) => !u)) break;
      if (unit.some(isNumberWord)) break;
      let repeats = 1;
      while (
        words
          .slice(i + repeats * n, i + (repeats + 1) * n)
          .map(key)
          .join(' ') === unit.join(' ')
      )
        repeats++;
      if (repeats >= 3) {
        out.push(...words.slice(i, i + 2 * n));
        i += repeats * n;
        collapsed = true;
      }
    }
    if (!collapsed) out.push(words[i++]);
  }
  return (text.match(/^\s*/)?.[0] ?? '') + out.join(' ');
}

// Phrases Whisper invents from its training data (mostly YouTube outros) on silence or noise.
// Matched inside each sentence.
const HALLUCINATION_PHRASES = [
  'like and subscribe',
  'like, share and subscribe',
  'like, comment and subscribe',
  'please like and subscribe',
  'please subscribe',
  "don't forget to subscribe",
  'subscribe to my channel',
  'thank you for watching',
  'thanks for watching',
  'see you in the next video',
  'see you next time',
  'cảm ơn các bạn đã theo dõi',
  'cảm ơn các bạn đã xem',
  'cảm ơn mọi người đã xem',
  'cảm ơn quý vị đã theo dõi',
  'cảm ơn bạn đã theo dõi',
  'hẹn gặp lại các bạn',
  'hẹn gặp lại trong video',
  'hẹn gặp lại ở video',
  'hãy subscribe',
  'nhớ subscribe',
  'nhớ like',
  'đăng ký kênh',
  'like và subscribe',
  'đừng quên đăng ký',
  'không bỏ lỡ những video',
  'không bỏ lỡ video',
  'video hấp dẫn',
  'ghiền mì gõ',
];

// Dropped only when they are the whole sentence; they could start a real one
const HALLUCINATION_SENTENCES = new Set(['kết thúc video']);

// Silence Whisper filled with invented text. A looping segment is NOT dropped here (collapseLoops).
export function isReliableSegment(s: Segment): boolean {
  if (s.no_speech_prob <= NO_SPEECH_THRESHOLD) return true;
  return s.avg_logprob !== undefined && s.avg_logprob >= LOW_CONFIDENCE_LOGPROB;
}

// ── Bare consonants (T-0164) ─────────────────────────────────────────────────────────────────
// The owner's meeting read "... ki ch g l n ch c kh th n c nh c l r l c b v r ...": where speech
// is too unclear to make out, Whisper writes only the first consonant of each syllable and drops
// the vowel and the tone. Each fragment can still score an average confidence, so the segment
// filter above lets it through. As on the computer (spetotext/src/main/transcribe.ts): a word with
// no vowel once its marks are stripped is flagged (every Vietnamese syllable has a vowel; vowel-less
// English words are acronyms, kept), runs of flagged words are grown across up to 2 normal ones,
// and a run of at least 4 is cut out, never touching the real words around it.
const GIBBERISH_BRIDGE_GAP = 2;
const GIBBERISH_MIN_RUN = 4;

function wordTokens(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function looksLikeGibberishToken(token: string): boolean {
  if (!/^[\p{L}]+$/u.test(token)) return false;
  // An acronym, e.g. "ALT", "CEO"
  if (token.length >= 2 && token === token.toUpperCase()) return false;
  const base = token.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return !/[aeiouy]/i.test(base);
}

function findGibberishZones(flags: boolean[]): boolean[] {
  const inZone = new Array<boolean>(flags.length).fill(false);
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let end = i;
    let count = 1;
    let j = i + 1;
    while (j < flags.length) {
      if (flags[j]) {
        end = j;
        count++;
        j++;
        continue;
      }
      let k = j;
      while (k < flags.length && !flags[k] && k - end <= GIBBERISH_BRIDGE_GAP) k++;
      if (k < flags.length && flags[k]) {
        end = k;
        count++;
        j = k + 1;
      } else {
        break;
      }
    }
    if (count >= GIBBERISH_MIN_RUN) for (let q = i; q <= end; q++) inZone[q] = true;
    i = end + 1;
  }
  return inZone;
}

// The sentence without its garbled runs, or '' when too little real content is left
export function stripGibberish(sentence: string): string {
  const tokens = sentence
    .normalize('NFC')
    .split(/\s+/)
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const stripped = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      return { raw, flagged: stripped.length > 0 && !/^\d+$/.test(stripped) && looksLikeGibberishToken(stripped) };
    });
  const zones = findGibberishZones(tokens.map((t) => t.flagged));
  if (!zones.some(Boolean)) return sentence;
  const cleaned = tokens
    .filter((_, i) => !zones[i])
    .map((t) => t.raw)
    .join(' ')
    .trim();
  return wordTokens(cleaned).length >= 2 ? cleaned : '';
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// `seen` is shared by the segments of one answer, so a sentence repeated 3+ times is still caught
// across segments
export function filterKnownHallucinations(text: string, seen: Map<string, number> = new Map()): string {
  const kept: string[] = [];
  for (const rawSentence of splitSentences(text)) {
    const sentence = stripGibberish(rawSentence);
    if (!sentence) continue;
    const normalized = sentence.normalize('NFC').toLowerCase().replace(/[.,!?。，！？]+/g, '').trim();
    if (!normalized) continue;
    if (HALLUCINATION_SENTENCES.has(normalized)) continue;
    if (HALLUCINATION_PHRASES.some((p) => normalized.includes(p))) continue;
    // A sentence repeated over and over is Whisper looping, not the speaker
    const count = (seen.get(normalized) ?? 0) + 1;
    seen.set(normalized, count);
    if (count > 2) continue;
    kept.push(sentence);
  }
  return kept.join(' ').trim();
}

// What one answer of Whisper gave (T-0164 review, points 1 and 2), read as the computer reads it
// (spetotext/src/main/transcribe.ts, readVerbose):
// - looping segments are collapsed, not dropped;
// - the known-hallucination and bare-consonant filters run SEGMENT BY SEGMENT, never on the joined
//   text: Whisper often writes Vietnamese without a full stop, so the sentence filter would see 30 s
//   of real speech plus one outro as ONE sentence and drop all of it (the owner's real run on the
//   computer: 90 words lost from one part);
// - a segment "covers" its time only when most of its words survived: real speech with every
//   accent lost ("B ph tr s vi c tr l m…", confident, avg_logprob -0.07) is removed, and that
//   speech counts as missing, so the piece can be sent again instead of silently losing the words.
export interface ReadAnswer {
  text: string;
  // Words Whisper wrote in the segments it kept, and words left after the filters
  words: number;
  wordsLeft: number;
  // Seconds of the segments Whisper wrote for, and the part of them whose words did not survive
  speechSeconds: number;
  uncoveredSeconds: number;
  // Words cut out as bare consonants (not the same as words dropped as an outro: those are silence
  // Whisper filled, and nothing was lost). Only these can mean real speech was lost.
  gibberishWords: number;
  gibberish: boolean;
}

function words(text: string): number {
  return wordTokens(text).length;
}

// How many words of the text are bare-consonant runs (the filter cuts them sentence by sentence)
function gibberishWordsIn(text: string): number {
  return splitSentences(text).reduce((sum, sentence) => sum + Math.max(0, words(sentence) - words(stripGibberish(sentence))), 0);
}

export function readAnswer(data: VerboseTranscript): ReadAnswer {
  const segments = data.segments ?? [];
  if (segments.length === 0) {
    const original = (data.text ?? '').trim();
    const text = filterKnownHallucinations(original);
    const cut = gibberishWordsIn(original);
    return { text, words: words(original), wordsLeft: words(text), speechSeconds: 0, uncoveredSeconds: 0, gibberishWords: cut, gibberish: cut > 0 };
  }
  const seen = new Map<string, number>();
  let cut = 0;
  let total = 0;
  let left = 0;
  let speech = 0;
  let uncovered = 0;
  const pieces = segments.filter(isReliableSegment).map((s) => {
    const raw = s.compression_ratio !== undefined && s.compression_ratio > COMPRESSION_RATIO_THRESHOLD ? collapseLoops(s.text) : s.text;
    const original = raw.trim();
    cut += gibberishWordsIn(original);
    const kept = filterKnownHallucinations(original, seen);
    // Whisper's own spacing between segments is kept
    const space = kept && /^\s/.test(raw) ? ' ' : '';
    const had = words(original);
    const remaining = words(kept);
    const seconds = typeof s.start === 'number' && typeof s.end === 'number' ? Math.max(0, s.end - s.start) : 0;
    total += had;
    left += remaining;
    speech += seconds;
    if (!(remaining > 0 && remaining * 2 >= had)) uncovered += seconds;
    return space + kept;
  });
  return { text: pieces.join('').trim(), words: total, wordsLeft: left, speechSeconds: speech, uncoveredSeconds: uncovered, gibberishWords: cut, gibberish: cut > 0 };
}

export function cleanTranscript(data: VerboseTranscript): string {
  return readAnswer(data).text;
}
