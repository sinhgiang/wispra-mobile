// The listening session behind the Wispra keyboard's mic on iPhone (T-0145): what the app does with
// each piece the session cuts out of what was said. Pure, so it is tested; the screen and the
// bridge in the app wire it to the native session and to Wispra Cloud.

import { isSilenceError } from './transcribe-queue';
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
  return !result.ok && !isSilenceError(result.error);
}

// How speaking works, in the words the guide and the session screen both use (T-0145 review): in
// the app being typed in, the purple mic starts listening and turns red; the red mic ends it and the
// words appear at the cursor. One text, so the two screens never describe different flows.
export const SPEAK_FLOW =
  'tap the purple mic on the Wispra keyboard and speak. Tap the red mic when you are done: the words appear where the cursor is.';

// What iOS does not allow, said to the owner (T-0178): a keyboard cannot start the microphone, only the
// app can, and only while it is open. While a session runs the keyboard's mic works at once; when none
// runs, Wispra has to open once. One text, for the guide and for Account.
export const SESSION_LIMITS_NOTE =
  "While Wispra's listening session runs, the keyboard's mic works at once. Apple lets only the app start the microphone, never a keyboard, so Wispra opens by itself when none runs: the first time, after you end the session, after it runs out, after the iPhone restarts, or when iOS closes Wispra. Wispra starts a session when you open it, if you used the keyboard in the last day.";

// How long a session lasts, in minutes (T-0163, T-0178): chosen once in Account, never each time the
// mic opens Wispra. Each use of the keyboard's mic starts the count again, so a session in use goes on.
// Longer than before (the owner wanted to tap the mic and speak without Wispra opening): iOS only lets
// the app start the microphone, so every end of a session is one more time Wispra has to open.
export const SESSION_CHOICES = [60, 240, 720] as const;
export const DEFAULT_SESSION_MINUTES = 240;

// Wispra starts a session by itself when it is opened, if the keyboard was used within this long
export const AUTO_START_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AutoStartInput {
  // Wispra Cloud may be used (signed in, and no account question waiting)
  allowed: boolean;
  // A session is running
  active: boolean;
  // When the Wispra keyboard was last on screen (ms since 1970); null: never
  keyboardSeenAt: number | null;
  now: number;
  // The user ended the session on its screen: it stays off until the keyboard's mic asks for one
  endedByUser: boolean;
}

// "Keep the session": when Wispra is opened (for any reason) and the keyboard is in use, the session
// starts by itself, so the keyboard's mic works at once and Wispra need not open for it (T-0178)
export function shouldAutoStartSession(input: AutoStartInput): boolean {
  if (!input.allowed || input.active || input.endedByUser || input.keyboardSeenAt === null) return false;
  return input.now - input.keyboardSeenAt < AUTO_START_WINDOW_MS;
}

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
