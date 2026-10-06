import { File } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { chatJson } from '@/lib/ai';
import { useEntries } from '@/lib/entries-store';
import { actionFor, pieceFailed, shouldAutoStartSession, wordsFrom } from '@/lib/keyboard-session';
import { capitalizeStart, punctuate, PUNCTUATION_WAIT_MS, tailOf, withDeadline } from '@/lib/punctuation';
import { transcribeAudio } from '@/lib/transcriber';
import { loadSessionMinutes, sessionEndedByUser } from '@/lib/storage';
import { useSession } from '@/lib/use-session';
import { deliverText, keyboardStatus, noteKeyboardLog, onSessionChunk, sessionState, startSession, type SessionChunk } from '@/modules/wispra-keyboard-bridge';

// iPhone: turns each piece of a listening session into words for the Wispra keyboard (T-0145).
// The pieces come from the native session while the keyboard's mic is red; this runs while Wispra
// is in the background too, since the session keeps it running.
export function KeyboardSessionBridge() {
  const { cloudAllowed } = useEntries();
  // Read at each piece, so a sign-in change during a session is seen at once
  const allowed = useRef(cloudAllowed);
  allowed.current = cloudAllowed;
  // Re-read when the sign-in or the data on the phone finishes loading: a cold start opens with neither
  // ready, and AppState sends no "active" for the state the app starts in
  useSession();
  const mayUseCloud = cloudAllowed();

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = onSessionChunk((chunk) => void handle(chunk, () => allowed.current()));
    // Brought back to the front with the keyboard in use: the session starts by itself (T-0178)
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') void autoStartSession(() => allowed.current());
    });
    return () => {
      sub?.remove();
      state.remove();
    };
  }, []);

  // Opened, and as soon as Wispra Cloud may be used (on a cold start that is a moment after the screen)
  useEffect(() => {
    if (Platform.OS === 'ios' && mayUseCloud) void autoStartSession(() => allowed.current());
  }, [mayUseCloud]);

  return null;
}

// The session the keyboard's mic needs, started without the keyboard asking: only when Wispra Cloud may
// be used, the keyboard was on screen within a day, none runs, and the user did not end it on purpose
async function autoStartSession(allowed: () => boolean): Promise<void> {
  try {
    const [keyboard, session] = await Promise.all([keyboardStatus(), sessionState()]);
    const start = shouldAutoStartSession({
      allowed: allowed(),
      active: session.active,
      keyboardSeenAt: keyboard?.lastSeenAt ?? null,
      now: Date.now(),
      endedByUser: sessionEndedByUser(),
    });
    if (start) await startSession(loadSessionMinutes());
  } catch {
    // Not possible now (no microphone permission yet, say): the keyboard's mic opens Wispra as before
  }
}

// What each dictation has typed so far, by the end of its last piece: the next piece goes on from it
// (a capital after a stop, small letters after a comma). Pieces are transcribed side by side but
// punctuated one after the other, in the order they were said.
const tails = new Map<string, Promise<string>>();

const wordCountOf = (text: string) => text.trim().split(/\s+/).length;

const refuse = () => Promise.reject(new Error('Wispra Cloud may not be used now'));

// The words of one piece with their dots, commas and capitals (T-0178, point 4)
async function withPunctuation(chunk: SessionChunk, words: string, canAsk: boolean): Promise<string> {
  const before = tails.get(chunk.utterance) ?? Promise.resolve('');
  let typed = words;
  const mine = before.then(async (previous) => {
    if (!words) return previous;
    try {
      const started = Date.now();
      // Never more than a few seconds: past that the piece is typed as it came, with its first capital
      const result = await withDeadline(punctuate(canAsk ? chatJson : refuse, words, previous), PUNCTUATION_WAIT_MS, () => ({
        text: capitalizeStart(words.trim(), previous),
        source: 'timeout' as const,
      }));
      typed = result.text;
      // For the keyboard log: how it went, never the words
      noteKeyboardLog(`punctuation: ${result.source} in ${Date.now() - started} ms, ${wordCountOf(words)} words`);
      return tailOf(`${previous} ${result.text}`);
    } catch {
      // The chain must go on for the pieces after this one
      return previous;
    }
  });
  tails.set(chunk.utterance, mine);
  await mine;
  if (chunk.last) tails.delete(chunk.utterance);
  return typed;
}

async function handle(chunk: SessionChunk, cloudAllowed: () => boolean): Promise<void> {
  const action = actionFor(chunk, cloudAllowed());
  let words = '';
  let failed = false;
  try {
    if (action.kind === 'transcribe') {
      const result = await transcribeAudio(chunk.path, chunk.durationMs);
      words = wordsFrom(result);
      failed = pieceFailed(result);
    }
  } catch {
    words = '';
    failed = true;
  }
  // Never held up by this step: without it the piece is typed as it came
  try {
    words = await withPunctuation(chunk, words, cloudAllowed());
  } catch {
    tails.delete(chunk.utterance);
  }
  await deliverText(chunk.utterance, chunk.index, words, chunk.last, failed);
  // The audio of a piece is not kept: the words are in the field the user typed into
  try {
    const file = new File(chunk.path);
    if (file.exists) file.delete();
  } catch {
    // A temporary file; iOS clears it eventually
  }
}
