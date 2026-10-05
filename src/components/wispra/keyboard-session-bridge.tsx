import { File } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useEntries } from '@/lib/entries-store';
import { actionFor, pieceFailed, wordsFrom } from '@/lib/keyboard-session';
import { transcribeAudio } from '@/lib/transcriber';
import { deliverText, onSessionChunk, type SessionChunk } from '@/modules/wispra-keyboard-bridge';

// iPhone: turns each piece of a listening session into words for the Wispra keyboard (T-0145).
// The pieces come from the native session while the keyboard's mic is red; this runs while Wispra
// is in the background too, since the session keeps it running.
export function KeyboardSessionBridge() {
  const { cloudAllowed } = useEntries();
  // Read at each piece, so a sign-in change during a session is seen at once
  const allowed = useRef(cloudAllowed);
  allowed.current = cloudAllowed;

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = onSessionChunk((chunk) => void handle(chunk, () => allowed.current()));
    return () => sub?.remove();
  }, []);

  return null;
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
  await deliverText(chunk.utterance, chunk.index, words, chunk.last, failed);
  // The audio of a piece is not kept: the words are in the field the user typed into
  try {
    const file = new File(chunk.path);
    if (file.exists) file.delete();
  } catch {
    // A temporary file; iOS clears it eventually
  }
}
