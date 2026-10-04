// What comes back from Whisper is cleaned the same way as in Wispra on the computer
// (spetotext/src/main/transcribe.ts), so the phone never types words nobody said.

export interface Segment {
  text: string;
  no_speech_prob: number;
  avg_logprob?: number;
}

export interface VerboseTranscript {
  text?: string;
  language?: string;
  segments?: Segment[];
}

// Whisper is more than 50% sure there is no speech
const NO_SPEECH_THRESHOLD = 0.5;
// Whisper was guessing at the words (OpenAI's own reference threshold)
const LOW_CONFIDENCE_LOGPROB = -1.0;

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
  return s.no_speech_prob < NO_SPEECH_THRESHOLD && (s.avg_logprob === undefined || s.avg_logprob >= LOW_CONFIDENCE_LOGPROB);
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
  for (const sentence of splitSentences(text)) {
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
