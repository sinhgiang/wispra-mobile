// The listening session behind the Wispra keyboard's mic on iPhone (T-0145): what the app does with
// each piece the session cuts out of what was said. Pure, so it is tested; the screen and the
// bridge in the app wire it to the native session and to Wispra Cloud.

import type { TranscribeResult } from './transcriber';

export interface PieceInfo {
  voiced: boolean;
  last: boolean;
}

export type PieceAction =
  // Transcribe the audio, then hand the words to the keyboard
  | { kind: 'transcribe' }
  // Nothing to transcribe; still tell the keyboard (empty words), so it keeps the order and knows
  // when the utterance ended
  | { kind: 'deliver-empty'; reason: 'silence' | 'not-allowed' };

// What to do with a piece. Not allowed: signed out, or another account waits for the user's choice
// (T-0142): then no audio goes to Wispra Cloud.
export function actionFor(piece: PieceInfo, cloudAllowed: boolean): PieceAction {
  if (!piece.voiced) return { kind: 'deliver-empty', reason: 'silence' };
  if (!cloudAllowed) return { kind: 'deliver-empty', reason: 'not-allowed' };
  return { kind: 'transcribe' };
}

// The words for the keyboard from a transcription: nothing when it failed (the keyboard skips the
// piece and goes on with the next)
export function wordsFrom(result: TranscribeResult): string {
  return result.ok ? result.text.trim() : '';
}

// The durations a session can last, in minutes
export const SESSION_CHOICES = [5, 15, 60] as const;
export const DEFAULT_SESSION_MINUTES = 15;

export function minutesLeft(until: number, now: number): number {
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
}
