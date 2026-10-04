import type { Entry } from './entries';

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

// Transcription goes through Wispra Cloud, which needs the Wispra account sign-in. Until that is in
// the app, recordings wait as "not transcribed yet" and a retry says why.
export function transcriptionAvailable(): boolean {
  return false;
}

export async function transcribe(_entry: Entry): Promise<TranscribeResult> {
  return { ok: false, error: 'Transcription needs a Wispra Cloud sign-in, which is not in this version yet. The audio is kept on this phone.' };
}
