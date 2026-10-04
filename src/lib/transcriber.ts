import { File } from 'expo-file-system';

import { currentSession, validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import type { Entry } from './entries';
import { cleanTranscript, type VerboseTranscript } from './transcript-filter';

// transient: nothing is wrong with the recording (offline, signed out, server busy), so it can
// simply wait and be tried again later without the user doing anything
export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string; transient?: boolean };

// Same model and limits as Wispra on the computer
const MODEL = 'whisper-large-v3';
// Wispra Cloud accepts at most this much in one request (about 17 minutes of the app's audio)
export const CLOUD_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

// Transcription goes through Wispra Cloud, so it needs the Wispra account sign-in
export function transcriptionAvailable(): boolean {
  return currentSession() !== null;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}

export async function transcribe(entry: Entry): Promise<TranscribeResult> {
  if (!entry.audioUri) return { ok: false, error: 'The audio file is not on this phone.' };
  const audio = new File(entry.audioUri);
  if (!audio.exists) return { ok: false, error: 'The audio file is not on this phone.' };
  if ((audio.size ?? 0) > CLOUD_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: 'This recording is longer than Wispra Cloud takes in one piece (about 17 minutes). Transcribing long meetings in parts comes in the next update. The audio is kept.',
    };
  }
  const token = await validToken();
  if (!token) return { ok: false, error: 'Sign in to Wispra Cloud in Account to transcribe. The audio is kept on this phone.', transient: true };

  const form = new FormData();
  // React Native uploads a local file from its uri
  form.append('file', { uri: audio.uri, name: 'audio.m4a', type: 'audio/mp4' } as unknown as Blob);
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cloud.apiBase}/api/transcribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // The server counts this toward the monthly minutes
        ...(entry.durationMs > 0 ? { 'X-Audio-Duration-Seconds': String(Math.ceil(entry.durationMs / 1000)) } : {}),
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? 'Transcription timed out. Check your connection and try again.' : 'No connection to Wispra Cloud. The audio is kept; try again later.',
      transient: true,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await errorDetail(response);
    if (response.status === 401) return { ok: false, error: 'Your Wispra Cloud sign-in has expired. Sign in again in Account.' };
    if (response.status === 402) return { ok: false, error: detail || 'This month’s free Wispra Cloud minutes are used up.' };
    if (response.status === 413) return { ok: false, error: 'This recording is too large for Wispra Cloud in one piece.' };
    return {
      ok: false,
      error: detail ? `Wispra Cloud: ${detail}` : `Transcription failed (HTTP ${response.status}).`,
      transient: response.status === 429 || response.status >= 500,
    };
  }

  const text = cleanTranscript((await response.json()) as VerboseTranscript);
  if (!text) return { ok: false, error: 'No speech was heard in this recording.' };
  return { ok: true, text };
}
