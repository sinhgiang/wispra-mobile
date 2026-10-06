// The shapes the computer's Learned logic works on (spetotext src/shared/types.ts), kept the same.

// A dictation as the computer's History holds it. On the phone it is made from an Entry (see history-docs.ts).
export interface TranscriptEntry {
  id: string;
  // What the user ended up with: the typed text, or their own version after a History fix
  text: string;
  createdAt: string;
  language?: string;
  durationSeconds?: number;
  topic?: string;
  // Speech-to-text output before any learned replacement. The phone keeps the text it typed (the answer
  // after its replacements), so this is absent there and the logic falls back as the computer does.
  rawText?: string;
  app?: string;
  // What Wispra originally typed. Set only once the user has fixed the entry
  originalText?: string;
  mode?: string;
  // Whether "Learn my words" was on when this was dictated
  learning?: boolean;
}

export type SuggestionKind = 'variant' | 'term';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  term: string;
  heardAs?: string;
  count: number;
  sources: number;
  example: string;
}

export interface AutoTerm {
  id: string;
  term: string;
  count: number;
  sources: number;
  via: 'seen' | 'fixed';
  heardAs?: string;
}

export interface StyleHabit {
  id: string;
  text: string;
  evidence: string;
  enabled: boolean;
}

export interface StyleProfile {
  notes: string;
  habits: StyleHabit[];
  exampleCount: number;
}

export interface EvalTotals {
  dictations: number;
  words: number;
  edited: number;
  edits: number;
  rate: number | null;
}

export interface EvalWeek extends EvalTotals {
  start: string;
}

export interface EvalReport {
  weeks: EvalWeek[];
  on: EvalTotals;
  off: EvalTotals;
  all: EvalTotals;
}
