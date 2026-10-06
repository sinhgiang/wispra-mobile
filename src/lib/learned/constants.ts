// The limits of the Learned section, the same as the computer's (spetotext src/shared/constants.ts), so a word
// is picked up, suggested or turned into a habit under the same conditions on both.

// ── Suggestions mined from History (suggestLogic.ts)
export const SUGGEST_MIN_VARIANT_COUNT = 2;
export const SUGGEST_MIN_TERM_COUNT = 3;
export const SUGGEST_MIN_TERM_SOURCES = 2;
export const SUGGEST_MAX_ITEMS = 12;
export const SUGGEST_MAX_DISMISSED = 500;

// ── Vocabulary learned automatically from History (autoVocabLogic.ts)
export const AUTO_MIN_FIX_COUNT = 2;
export const AUTO_MIN_FIX_SOURCES = 2;
export const AUTO_MAX_TERMS = 40;
export const AUTO_AMBIGUITY_RATIO = 2;
// The computer waits this long after History changes before it recomputes, so it never competes with a
// dictation being typed. On the phone the lists are computed when the Learned screen opens.
export const AUTO_REFRESH_DELAY_MS = 2_000;

// ── Writing style (styleLogic.ts)
export const STYLE_MAX_EXEMPLARS = 4;
export const STYLE_EXEMPLAR_MAX_CHARS = 400;
export const STYLE_EXEMPLARS_TOTAL_CHARS = 1600;
export const STYLE_MAX_FIXES_SCANNED = 40;
export const STYLE_HABIT_MIN_FIXES = 4;
export const STYLE_HABIT_MIN_RATE = 0.75;
export const STYLE_DROP_MIN_FIXES = 3;
export const STYLE_MAX_HABITS = 6;
export const STYLE_NOTES_MAX_CHARS = 300;

// ── Is learning helping? (evalLogic.ts)
export const EVAL_WEEKS_SHOWN = 8;
export const EVAL_MIN_WORDS = 200;
export const EVAL_MAX_RECORDS = 1500;
