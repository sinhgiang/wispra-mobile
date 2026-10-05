// What comes back from Whisper is cleaned the same way as in Wispra on the computer
// (spetotext/src/main/transcribe.ts), so the phone never types words nobody said.

export interface Segment {
  text: string;
  no_speech_prob: number;
  avg_logprob?: number;
  compression_ratio?: number;
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
// Above this the segment is a loop of repeated text
const COMPRESSION_RATIO_THRESHOLD = 2.4;

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

export function isReliableSegment(s: Segment): boolean {
  if (s.compression_ratio !== undefined && s.compression_ratio > COMPRESSION_RATIO_THRESHOLD) return false;
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

export function filterKnownHallucinations(text: string): string {
  const seen = new Map<string, number>();
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

export function cleanTranscript(data: VerboseTranscript): string {
  const text =
    data.segments && data.segments.length > 0
      ? data.segments.filter(isReliableSegment).map((s) => s.text).join('').trim()
      : (data.text ?? '').trim();
  return filterKnownHallucinations(text);
}
