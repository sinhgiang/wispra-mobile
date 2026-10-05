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

// Whether a piece failed to be transcribed (no connection, server busy, sign-in…), as opposed to
// having nothing said in it: the keyboard then says the words could not be written, not "not heard"
// (T-0163 review)
export function pieceFailed(result: TranscribeResult): boolean {
  return !result.ok && !result.error.startsWith('No speech') && !result.error.startsWith('No audio');
}

// How long a session lasts, in minutes (T-0163): chosen once in Account, never each time the mic
// opens Wispra. Each use of the keyboard's mic starts the count again, so a session in use goes on.
export const SESSION_CHOICES = [15, 60, 240] as const;
export const DEFAULT_SESSION_MINUTES = 60;

export function sessionLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} min`;
}

// The saved length, read back: one of the choices, or the default
export function parseSessionMinutes(text: string | null): number {
  const n = Number(text?.trim());
  return (SESSION_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_SESSION_MINUTES;
}

export function minutesLeft(until: number, now: number): number {
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
}
