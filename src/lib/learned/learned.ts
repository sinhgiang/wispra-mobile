// What the computer's Learned tab does around its logic (spetotext suggestions.ts, autoVocab.ts, style.ts,
// evalLog.ts), on the phone (T-0182): the same lists computed from the phone's History, the same switches, the
// same places where an ignored or removed word is remembered. Pure: the saved state is given in and returned,
// so it is tested; src/lib/storage.ts keeps it in learned.json.

import { meetingLines, type Entry } from '../entries';
import { addManualEntry, type LexiconEntry } from '../lexicon';
import { computeAutoTerms } from './autoVocabLogic';
import { SUGGEST_MAX_DISMISSED } from './constants';
import { addDictation, addFix, buildReport, dayOf, fixDelta, sanitizeRecords, type EvalRecord, type FixFacts } from './evalLogic';
import { cleanNotes, detectHabits, fixedPairs, renderStyleBlock, usableAsExample } from './styleLogic';
import { computeSuggestions, type SuggestDoc } from './suggestLogic';
import type { AutoTerm, EvalReport, StyleProfile, Suggestion, TranscriptEntry } from './types';

// Habit switches remembered at most (the list only ever holds ids the user turned off)
const MAX_OFF = 200;

export interface LearnedState {
  // Ids of suggestions and picked-up words the user waved away or removed, oldest first
  dismissed: string[];
  styleNotes: string;
  // Habit ids the user switched off
  styleOff: string[];
  // The words picked up from History, worked out when History changes; they go to Whisper's prompt
  autoTerms: string[];
  // Statistics: counts only, never text
  evalSince: string;
  evalRecords: EvalRecord[];
}

export const EMPTY_STATE: LearnedState = { dismissed: [], styleNotes: '', styleOff: [], autoTerms: [], evalSince: '', evalRecords: [] };

export function parseLearnedState(json: string | null | undefined): LearnedState {
  if (!json) return EMPTY_STATE;
  try {
    const v = JSON.parse(json) as Partial<Record<keyof LearnedState, unknown>> | null;
    const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    return {
      dismissed: strings(v?.dismissed).slice(-SUGGEST_MAX_DISMISSED),
      styleNotes: typeof v?.styleNotes === 'string' ? cleanNotes(v.styleNotes) : '',
      styleOff: strings(v?.styleOff).slice(-MAX_OFF),
      autoTerms: strings(v?.autoTerms),
      evalSince: typeof v?.evalSince === 'string' ? v.evalSince : '',
      evalRecords: sanitizeRecords(v?.evalRecords),
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function serializeLearnedState(state: LearnedState): string {
  return JSON.stringify(state);
}

// ── The phone's History, as the computer's logic reads it ──

// The dictations that have words, newest first
export function historyEntries(entries: readonly Entry[]): TranscriptEntry[] {
  return entries
    .filter((e) => e.kind === 'dictation' && e.status === 'done' && !!e.text?.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => ({
      id: e.id,
      text: e.text ?? '',
      createdAt: e.createdAt,
      originalText: e.originalText,
      learning: e.learning,
    }));
}

// Dictations and finished meetings, as the computer reads them: "asr" is where mishearings show (on the phone,
// what was first typed), "final" where the right spellings are
export function suggestDocs(entries: readonly Entry[]): SuggestDoc[] {
  const docs: SuggestDoc[] = historyEntries(entries).map((e) => ({ id: `h:${e.id}`, asr: [e.originalText ?? e.text], final: [e.text] }));
  for (const m of entries) {
    if (m.kind !== 'meeting' || m.status !== 'done') continue;
    const texts = (m.segments ? m.segments.filter((s) => s.status === 'done' && s.text?.trim()).map((s) => s.text ?? '') : []).concat(
      m.segments ? [] : meetingLines(m).map((l) => l.text),
    );
    if (texts.length > 0) docs.push({ id: `m:${m.id}`, asr: texts, final: texts });
  }
  return docs;
}

// ── Picked up from your History, and Suggestions ──

export interface Inputs {
  entries: readonly Entry[];
  vocabulary: string[];
  lexicon: LexiconEntry[];
  state: LearnedState;
  learning: boolean;
  autoLearn: boolean;
}

// Empty while learning, or "Learn my vocabulary from History", is off
export function autoTermList(i: Inputs): AutoTerm[] {
  if (!i.learning || !i.autoLearn) return [];
  return computeAutoTerms({ docs: suggestDocs(i.entries), vocabulary: i.vocabulary, entries: i.lexicon, dismissed: new Set(i.state.dismissed) });
}

// A word already picked up counts as known: it is not offered as a new term
export function suggestionList(i: Inputs): Suggestion[] {
  if (!i.learning) return [];
  const auto = autoTermList(i).map((t) => t.term);
  return computeSuggestions({
    docs: suggestDocs(i.entries),
    vocabulary: [...i.vocabulary, ...auto],
    entries: i.lexicon,
    dismissed: new Set(i.state.dismissed),
  });
}

function remember(state: LearnedState, id: string): LearnedState {
  if (!id || state.dismissed.includes(id)) return state;
  return { ...state, dismissed: [...state.dismissed, id].slice(-SUGGEST_MAX_DISMISSED) };
}

// Adds a suggestion to the lexicon and hides it (a variant becomes a word that replaces; a term, a spelling)
export function acceptSuggestion(i: Inputs, id: string, now: string, makeId: () => string): { lexicon: LexiconEntry[]; state: LearnedState } {
  const found = suggestionList(i).find((s) => s.id === id);
  if (!found) return { lexicon: i.lexicon, state: i.state };
  const added = addManualEntry(i.lexicon, found.term, found.heardAs ? [found.heardAs] : [], now, makeId);
  return { lexicon: added.entries, state: remember(i.state, id) };
}

export function dismissSuggestion(state: LearnedState, id: string): LearnedState {
  return remember(state, id);
}

// Keep: the picked-up word becomes one of the user's own words (a spelling only)
export function keepAutoTerm(i: Inputs, id: string, now: string, makeId: () => string): LexiconEntry[] {
  const found = autoTermList(i).find((t) => t.id === id);
  return found ? addManualEntry(i.lexicon, found.term, [], now, makeId).entries : i.lexicon;
}

// Remove: never learned again
export function removeAutoTerm(state: LearnedState, id: string): LearnedState {
  return remember(state, id);
}

// What the next transcription is told to listen for besides the lists: the words picked up from History
export function refreshAutoTerms(i: Inputs): LearnedState {
  const terms = autoTermList(i).map((t) => t.term);
  const same = terms.length === i.state.autoTerms.length && terms.every((t, n) => t === i.state.autoTerms[n]);
  return same ? i.state : { ...i.state, autoTerms: terms };
}

// "Clear all": starts over, which also un-hides what was waved away
export function resetLearned(state: LearnedState): LearnedState {
  return { ...state, dismissed: [], autoTerms: [] };
}

// ── Your writing style ──

export function styleProfile(entries: readonly Entry[], state: LearnedState): StyleProfile {
  const pairs = fixedPairs(historyEntries(entries));
  return {
    notes: state.styleNotes,
    habits: detectHabits(pairs).map((h) => ({ ...h, enabled: !state.styleOff.includes(h.id) })),
    exampleCount: pairs.filter(usableAsExample).length,
  };
}

export function setStyleNotes(state: LearnedState, notes: string): LearnedState {
  return { ...state, styleNotes: cleanNotes(notes) };
}

export function setHabitEnabled(state: LearnedState, id: string, enabled: boolean): LearnedState {
  if (!id) return state;
  const rest = state.styleOff.filter((x) => x !== id);
  return { ...state, styleOff: (enabled ? rest : [...rest, id]).slice(-MAX_OFF) };
}

// Clears the notes and switches every habit back on. The examples live in History and are not touched.
export function resetStyle(state: LearnedState): LearnedState {
  return { ...state, styleNotes: '', styleOff: [] };
}

// The style as the AI step is told, for the punctuation of the keyboard's words: the notes and the habits that
// are on. The computer also shows the AI past fixes as examples; here they are left out, since the step may
// change nothing but dots, commas and capitals (the words must stay the same).
export function styleBlock(entries: readonly Entry[], state: LearnedState, learning: boolean): string {
  if (!learning) return '';
  const habits = detectHabits(fixedPairs(historyEntries(entries))).filter((h) => !state.styleOff.includes(h.id));
  return renderStyleBlock({ notes: state.styleNotes, habits, exemplars: [] });
}

// ── Is learning helping? ──

// A dictation was typed (call when its words arrive)
export function recordDictation(state: LearnedState, words: number, learning: boolean, when: Date = new Date()): LearnedState {
  const day = dayOf(when);
  if (!day) return state;
  const next = addDictation(state.evalRecords, day, learning, words);
  return next === state.evalRecords ? state : { ...state, evalRecords: next };
}

// The user fixed a History entry
export function recordFix(state: LearnedState, fix: FixFacts): LearnedState {
  if (fix.createdAt < state.evalSince) return state;
  const day = dayOf(fix.createdAt);
  const delta = fixDelta(fix);
  if (!day || !delta || fix.learning === undefined) return state;
  const next = addFix(state.evalRecords, day, fix.learning, delta);
  return next === state.evalRecords ? state : { ...state, evalRecords: next };
}

export function evalReport(state: LearnedState, now: Date = new Date()): EvalReport {
  return buildReport(state.evalRecords, dayOf(now));
}

export function resetEval(state: LearnedState, now: Date = new Date()): LearnedState {
  return { ...state, evalSince: now.toISOString(), evalRecords: [] };
}
