// Dots, commas and capitals for the words typed by the Wispra keyboard (T-0178, point 4). A piece of a
// dictation comes back from Whisper as "...ngoài kia Không có sự lắng nghe Cho nên..." (no stops, capitals
// in the middle of a sentence), and it is typed as it comes. Each piece goes through one more step, the
// same kind as the computer's "transcription editor" (spetotext/src/main/postprocess.ts): put the dots and
// commas in, split the sentences, capitalize the start of each, and change nothing else.
//
// "Keep the words": what the model sends back is used only if it holds exactly the words that went in,
// in the same order (sameWords); otherwise the piece is typed as it came, never a changed sentence.
// Pure, so it is tested; the call to Wispra Cloud is given in. Written so Android's keyboard can use the
// same text and checks later (the ticket keeps Android aside for now).

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

// The words of a text, without punctuation or capitals: what must not change
export function wordKeys(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(WORD_BREAK)
    .filter(Boolean);
}

export function sameWords(original: string, edited: string): boolean {
  const a = wordKeys(original);
  const b = wordKeys(edited);
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

// A sentence ended: the next word starts a new one
export function endsSentence(text: string | null | undefined): boolean {
  return !!text && /[.!?…]["')\]]*\s*$/.test(text.trim());
}

// The last words of what was typed before, for the next piece to follow on from
export function tailOf(text: string, words = 12): string {
  const parts = text.trim().split(/\s+/);
  return parts.slice(-words).join(' ');
}

// A piece that is worth a second look: words enough to hold a sentence, and no stops, or a capital in
// the middle of a sentence (after a word with no stop before it)
export function needsPunctuation(text: string): boolean {
  const words = wordKeys(text).length;
  if (words < 3) return false;
  const marks = (text.match(/[.,!?…]/g) ?? []).length;
  if (marks === 0) return true;
  // About one mark every 12 words is a punctuated text
  if (marks * 12 < words) return true;
  return /\p{Ll}\s+\p{Lu}\p{Ll}/u.test(text);
}

// The first letter in capital when the piece starts a sentence (the first piece, or after a stop). Used
// when the model could not be asked or was not to be trusted: never touches the other letters.
export function capitalizeStart(text: string, previous: string): string {
  const starts = !previous.trim() || endsSentence(previous);
  if (!starts) return text;
  // The first letter or digit: a piece that starts with a number is left as it is
  const i = text.search(/[\p{L}\p{N}]/u);
  if (i < 0 || !/\p{L}/u.test(text[i])) return text;
  return text.slice(0, i) + text[i].toLocaleUpperCase() + text.slice(i + 1);
}

export const PUNCTUATION_PROMPT = `You are a transcription editor. The text is dictated speech with its punctuation and capitals missing or wrong. Fix ONLY the punctuation and the capital letters:
- Add periods at the end of sentences, commas between clauses and after introductory phrases, question marks for questions.
- Capitalize the first word of every sentence and the names of people, places and organizations. Make a capital letter in the middle of a sentence small again unless it is a name.
- If PREVIOUS ends a sentence (with . ? ! or …), or is empty, the text starts a new sentence: begin it with a capital letter. Otherwise it goes on from PREVIOUS: begin it in lower case unless the first word is a name.
- End the text with a period, question mark or exclamation mark when it is a finished sentence.
CRITICAL RULES:
- Keep every word exactly as written, in the same order. NEVER add, remove, replace, translate or reorder a word. NEVER correct spelling, grammar or diacritics. NEVER summarize or merge sentences.
- Write in the same language as the text.
Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:
{"text": "..."}`;

export function punctuationRequest(text: string, previous: string): string {
  return `PREVIOUS: ${previous.trim() || '(nothing: this starts the dictation)'}\n\nTEXT: ${text}`;
}

// 'timeout': the model did not answer in PUNCTUATION_WAIT_MS and the piece was typed as it came
export type PunctuationSource = 'model' | 'rules' | 'original' | 'timeout';

// The keyboard waits for words only so long (45 s on the phone, WordsWait), and a piece waits for the one
// before it: this step may take a few seconds, never the 90 s the chat call itself allows (T-0178 review)
export const PUNCTUATION_WAIT_MS = 4000;

// The answer of `work`, or `fallback()` when it is not there after `ms`. The work is left to finish unseen.
export function withDeadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback());
      },
    );
  });
}

export interface Punctuated {
  text: string;
  source: PunctuationSource;
}

// What the call to the model is: the system text, the user text, a token limit, and the answer as JSON
export type PunctuationCall = (system: string, user: string, maxTokens: number, temperature: number) => Promise<unknown>;

// The piece with its punctuation, or as it came when it needs none, when the model cannot be asked, or
// when it did not keep the words
export async function punctuate(call: PunctuationCall, text: string, previous: string): Promise<Punctuated> {
  const original = text.trim();
  if (!original) return { text, source: 'original' };
  const fallback = capitalizeStart(original, previous);
  if (!needsPunctuation(original)) return { text: fallback, source: fallback === original ? 'original' : 'rules' };
  try {
    const answer = (await call(PUNCTUATION_PROMPT, punctuationRequest(original, previous), 1500, 0)) as { text?: unknown };
    const edited = typeof answer?.text === 'string' ? answer.text.trim() : '';
    // Only the same words are accepted: a model that rewrote, shortened or added something is ignored
    if (edited && sameWords(original, edited)) return { text: edited, source: 'model' };
  } catch {
    // Not signed in, offline, allowance used: the piece is typed without
  }
  return { text: fallback, source: fallback === original ? 'original' : 'rules' };
}
