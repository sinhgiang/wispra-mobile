// Custom vocabulary (T-0182): names and terms to spell exactly ("Github", "Capcut", "TikTok", "Nguyễn Văn A").
// The same as on the computer (spetotext src/main/vocabularySpelling.ts and Vocabulary.tsx), kept the same so
// a word listed there is spelled the same here. Pure, so it is tested and can be ported to Kotlin.
//
// Whisper hears them but writes them its own way ("git hub", "Cap Cut", "Tik Tok", "Nguyen Van A"). After the
// transcription the user's spelling is put back, on the words that are already in the text:
//   • a run of 1–4 words that is the term once spaces, hyphens, case and accents are set aside
//     ("git hub" → "Github", "Nguyen Van A" → "Nguyễn Văn A");
//   • one word one letter away from a name-like term of 5+ letters ("Timeo" → "Timio") — only when it is
//     written like a name (a capital, not at the start of a sentence) and is not a plural or other form of it.
// It only ever replaces words that were heard: it never adds a word. A term written all in lowercase
// ("claude", "push") does not change the case of a word that only differs by case.

interface Token {
  text: string;
  start: number;
  end: number;
}

interface Term {
  spelling: string;
  key: string;
  words: number;
  // Has a capital letter or a digit: a name, brand or code, safe to match with one letter off
  nameLike: boolean;
  lowercase: boolean;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
// Between two words of one term: spaces or a hyphen — never a comma, a dot or a sentence end
const JOIN = /^(?:[ \t]{1,2}|[ \t]?[-–][ \t]?)$/u;
const ENDINGS = ['s', 'es', 'ed', 'ing', "'s", '’s'];
const MAX_WORDS = 4;

// Part of a web address, an e-mail, a path or a file name ("github.com/x", "capcut.exe"): left alone
function insideAddress(source: string, start: number, end: number): boolean {
  const before = source[start - 1] ?? '';
  const after = source[end] ?? '';
  if (/[/@\\_:.]/u.test(before) && /[\p{L}\p{N}]/u.test(source[start - 2] ?? '')) return true;
  if (/[/@\\_:]/u.test(after)) return true;
  return /[.]/u.test(after) && /[\p{L}\p{N}]/u.test(source[end + 1] ?? '');
}

// Lowercase, no accents, letters and digits only: "Nguyễn Văn-A" → "nguyenvana"
export function spellingKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function distanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function prepare(vocabulary: string[]): Term[] {
  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const raw of vocabulary) {
    const spelling = raw.normalize('NFC').trim();
    const key = spellingKey(spelling);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    terms.push({
      spelling,
      key,
      words: Math.min(MAX_WORDS, spelling.split(/\s+/).length),
      nameLike: /[\p{Lu}\p{N}]/u.test(spelling),
      lowercase: spelling === spelling.toLocaleLowerCase(),
    });
  }
  return terms;
}

// The user's spelling for `heard`, or null to leave it
function respell(heard: string, term: Term): string | null {
  if (heard === term.spelling) return null;
  // "Push" for "push": only the case differs and the user wrote it in lowercase — keep the sentence's capital
  if (term.lowercase && heard.toLocaleLowerCase() === term.spelling) return null;
  return term.spelling;
}

// Written like a name: starts with a capital, and is not the first word of a sentence
function looksLikeName(source: string, token: Token): boolean {
  if (!/^\p{Lu}/u.test(token.text)) return false;
  const before = source.slice(0, token.start).trimEnd();
  return before.length > 0 && !/[.!?…:]$/u.test(before);
}

// Puts the user's spelling of their vocabulary back into `text`. Never adds a word.
export function spellVocabulary(text: string, vocabulary: string[]): string {
  const terms = prepare(vocabulary);
  if (terms.length === 0 || !text) return text;
  const source = text.normalize('NFC');
  const tokens: Token[] = [...source.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const byKey = new Map(terms.map((t) => [t.key, t]));
  const fuzzy = terms.filter((t) => t.nameLike && t.words === 1 && t.key.length >= 5);
  const maxWords = Math.max(...terms.map((t) => t.words + 1));

  let out = '';
  let cursor = 0;
  for (let i = 0; i < tokens.length; ) {
    let done = false;
    // Longest run first: "tik tok" before "tik"
    for (let n = Math.min(maxWords, tokens.length - i); n >= 1 && !done; n--) {
      const run = tokens.slice(i, i + n);
      if (run.some((t, k) => k > 0 && !JOIN.test(source.slice(run[k - 1].end, t.start)))) continue;
      if (insideAddress(source, run[0].start, run[n - 1].end)) continue;
      const heard = source.slice(run[0].start, run[n - 1].end);
      const key = spellingKey(heard);
      let term = byKey.get(key);
      if (!term && n === 1 && key.length >= 5 && looksLikeName(source, run[0])) {
        term = fuzzy.find((t) => t.key[0] === key[0] && !ENDINGS.some((e) => key === t.key + e) && distanceAtMostOne(t.key, key));
      }
      if (!term) continue;
      const spelling = respell(heard, term);
      if (spelling !== null) {
        out += source.slice(cursor, run[0].start) + spelling;
        cursor = run[n - 1].end;
      }
      i += n;
      done = true;
    }
    if (!done) i++;
  }
  return out + source.slice(cursor);
}

// What is typed in the "Add a word or phrase…" field becomes terms. The computer adds one term per Add; a
// pasted list ("Github, Capcut, Timio") or lines becomes several (the owner pastes lists). A term already in
// the list (same letters) is not added twice.
export function addTerms(list: string[], input: string): string[] {
  const parts = input
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [...list];
  // The same letters once spaces, hyphens, case and accents are set aside ("github", "Git Hub") count as the same term
  const keys = new Set(out.map(spellingKey));
  for (const part of parts) {
    const key = spellingKey(part);
    if (key && !keys.has(key)) {
      keys.add(key);
      out.push(part);
    }
  }
  return out;
}

export function removeTerm(list: string[], term: string): string[] {
  return list.filter((t) => t !== term);
}

export function parseVocabulary(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as unknown;
    return Array.isArray(data) ? data.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
  } catch {
    return [];
  }
}

// Lowercased letter/digit tokens
function wordTokens(text: string): string[] {
  return text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Given a list of terms as Whisper's prompt, near-silent audio sometimes comes back as that list itself
// ("Github, Capcut, Timio."). A sentence made only of the prompt's own words (two or more) is such an echo
// and is dropped, as on the computer (transcribe.ts isTermListEcho).
export function dropTermListEcho(text: string, prompt: string | undefined): string {
  if (!prompt) return text;
  const promptTokens = new Set(wordTokens(prompt));
  if (promptTokens.size === 0) return text;
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter((s) => {
    const words = wordTokens(s);
    return !(words.length >= 2 && words.every((w) => promptTokens.has(w)));
  });
  return kept.join(' ').trim();
}
