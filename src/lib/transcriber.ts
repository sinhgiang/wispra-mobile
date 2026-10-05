import { File, UploadType, type UploadOptions, type UploadResult } from 'expo-file-system';

import { currentSession, validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import type { Entry } from './entries';
import { emptyAudio } from './transcribe-queue';
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

// Wispra Cloud's answer, as a result for the card. Pure, so it is tested.
export function resultFromResponse(status: number, body: string): TranscribeResult {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
  const detail = typeof error === 'string' ? error : '';
  if (status < 200 || status >= 300) {
    if (status === 401) return { ok: false, error: 'Your Wispra Cloud sign-in has expired. Sign in again in Account.' };
    if (status === 402) return { ok: false, error: detail || 'This month’s free Wispra Cloud minutes are used up.' };
    if (status === 413) return { ok: false, error: 'This recording is too large for Wispra Cloud in one piece.' };
    return {
      ok: false,
      error: detail ? `Wispra Cloud: ${detail}` : `Transcription failed (HTTP ${status}).`,
      transient: status === 429 || status >= 500,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, error: 'Wispra Cloud sent an answer that could not be read. It is tried again by itself.', transient: true };
  }
  const text = cleanTranscript(json as VerboseTranscript);
  if (!text) return { ok: false, error: 'No speech was heard in this recording.' };
  return { ok: true, text };
}

// What transcribing needs from an audio file (the real one is expo-file-system's File)
export type AudioFile = {
  readonly exists: boolean;
  readonly size: number | null;
  upload(url: string, options?: UploadOptions): Promise<UploadResult>;
};

export async function transcribe(entry: Entry): Promise<TranscribeResult> {
  return transcribeAudio(entry.audioUri, entry.durationMs);
}

// One audio file: a dictation, a meeting recorded before part 3, or one piece of a meeting
export async function transcribeAudio(uri: string | null, durationMs: number): Promise<TranscribeResult> {
  if (!uri) return { ok: false, error: 'The audio file is not on this phone.' };
  return transcribeFile(new File(uri), durationMs, validToken);
}

// The file is sent by the phone's own uploader (URLSession on iPhone, OkHttp on Android), straight
// from the disk. It used to go through fetch with a FormData part { uri, name, type }: Expo SDK 57
// replaces fetch with expo/fetch, which does not take such a part and throws before anything is
// sent ("Unsupported FormDataPart implementation", expo/src/winter/fetch/convertFormData.ts), so no
// recording ever reached Wispra Cloud and every card said there was no connection (T-0154).
export async function transcribeFile(audio: AudioFile, durationMs: number, token: () => Promise<string | null>): Promise<TranscribeResult> {
  if (!audio.exists) return { ok: false, error: 'The audio file is not on this phone.' };
  // Nothing was recorded in it: nothing worth sending
  if (emptyAudio(audio.size)) return { ok: false, error: 'No audio was recorded in this file.' };
  if ((audio.size ?? 0) > CLOUD_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: 'This recording is longer than Wispra Cloud takes in one piece (about 17 minutes). The audio is kept; meetings recorded from now on are sent in pieces.',
    };
  }
  const bearer = await token();
  if (!bearer) return { ok: false, error: 'Sign in to Wispra Cloud in Account to transcribe. The audio is kept on this phone.', transient: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: UploadResult;
  try {
    response = await audio.upload(`${cloud.apiBase}/api/transcribe`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/mp4',
      parameters: { model: MODEL, response_format: 'verbose_json' },
      headers: {
        Authorization: `Bearer ${bearer}`,
        // The server counts this toward the monthly minutes
        ...(durationMs > 0 ? { 'X-Audio-Duration-Seconds': String(Math.ceil(durationMs / 1000)) } : {}),
      },
      // Sent now, while the app is open; a background session may wait for a better moment
      sessionType: 'foreground',
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    const why = err instanceof Error && err.message ? ` (${err.message})` : '';
    return {
      ok: false,
      error: timedOut
        ? 'Transcription timed out. Check your connection; it is tried again by itself.'
        : `Could not reach Wispra Cloud${why}. The audio is kept; it is tried again by itself.`,
      transient: true,
    };
  } finally {
    clearTimeout(timer);
  }
  return resultFromResponse(response.status, response.body);
}
