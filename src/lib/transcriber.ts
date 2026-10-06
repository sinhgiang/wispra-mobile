import { File, UploadType, type UploadOptions, type UploadResult } from 'expo-file-system';

import { currentSession, validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import type { Entry } from './entries';
import { applyReplacements, buildSttPrompt, selectTerms, STT_PROMPT_MAX_TERMS } from './lexicon';
import { promptAutoTerms } from './learned/learned';
import { loadLearned, loadLearning, loadLexicon, loadTranscribeLanguage, loadVocabulary } from './storage';
import { dropTermListEcho, spellVocabulary } from './vocabulary';
import { noteKeyboardLog } from '@/modules/wispra-keyboard-bridge';
import { emptyAudio, NO_AUDIO, NO_SPEECH } from './transcribe-queue';
import { withChosenLanguage } from './transcribe-language';
import { readAnswer, type ReadAnswer, type VerboseTranscript } from './transcript-filter';

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

// What a piece of audio is told to Whisper: the language chosen in Account, as on the computer, left
// out for "auto" (Whisper guesses). With none, a resend of an answer that lost real speech asks for
// Vietnamese (see needsResend); with one already sent, there is nothing more to ask.
export interface TranscribeOptions {
  language?: string;
  // The terms Whisper is told to listen for: the Custom vocabulary and learned words (see lexicon.buildSttPrompt)
  prompt?: string;
}

// Wispra Cloud's answer, as a result for the card, with what the filters did to it. Pure, so it is
// tested.
export interface Analysed {
  result: TranscribeResult;
  answer: ReadAnswer | null;
}

export function analyseResponse(status: number, body: string): Analysed {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
  const detail = typeof error === 'string' ? error : '';
  if (status < 200 || status >= 300) {
    if (status === 401) return { result: { ok: false, error: 'Your Wispra Cloud sign-in has expired. Sign in again in Account.' }, answer: null };
    if (status === 402) return { result: { ok: false, error: detail || 'This month’s free Wispra Cloud minutes are used up.' }, answer: null };
    if (status === 413) return { result: { ok: false, error: 'This recording is too large for Wispra Cloud in one piece.' }, answer: null };
    return {
      result: {
        ok: false,
        error: detail ? `Wispra Cloud: ${detail}` : `Transcription failed (HTTP ${status}).`,
        transient: status === 429 || status >= 500,
      },
      answer: null,
    };
  }
  if (!json || typeof json !== 'object') {
    return { result: { ok: false, error: 'Wispra Cloud sent an answer that could not be read. It is tried again by itself.', transient: true }, answer: null };
  }
  const answer = readAnswer(json as VerboseTranscript);
  if (!answer.text) {
    // Whisper wrote words and bare consonants cut out left nothing (every accent lost, say): speech
    // was there and is lost; the audio is kept. Words dropped as an outro ("Cảm ơn các bạn đã theo
    // dõi") are silence Whisper filled: that is "no speech", never this card (T-0164 review 2, point 1)
    if (answer.gibberishWords >= 2 && answer.wordsLeft === 0) return { result: { ok: false, error: SPEECH_NOT_MADE_OUT }, answer };
    return { result: { ok: false, error: NO_SPEECH }, answer };
  }
  return { result: { ok: true, text: answer.text }, answer };
}

export const SPEECH_NOT_MADE_OUT = 'Speech was heard but Whisper could not make out the words. The audio is kept; try again.';

export function resultFromResponse(status: number, body: string): TranscribeResult {
  return analyseResponse(status, body).result;
}

// The computer sends a part again when real speech was lost in it. Here, with no sound analysis, the
// answer's own timestamps say it: at least 3 seconds of segments whose words did not survive, which
// is at least half of what Whisper wrote for. (spetotext transcribe.ts: uncoveredSeconds against
// voiced seconds, then the part is cut in half at a pause; the phone cannot cut m4a on iPhone, so it
// sends the same audio again asking for Vietnamese, the language bare consonants without accents
// point to.)
export const RESEND_MIN_UNCOVERED_SECONDS = 3;

export function needsResend(answer: ReadAnswer | null): boolean {
  if (!answer || !answer.gibberish) return false;
  if (answer.speechSeconds <= 0) return answer.words >= 4 && answer.wordsLeft * 2 < answer.words;
  return answer.uncoveredSeconds >= RESEND_MIN_UNCOVERED_SECONDS && answer.uncoveredSeconds * 2 >= answer.speechSeconds;
}

// The better of two answers: the one that kept more words
export function betterOf(first: Analysed, second: Analysed): Analysed {
  const a = first.answer?.wordsLeft ?? 0;
  const b = second.answer?.wordsLeft ?? 0;
  return b > a ? second : first;
}

// What transcribing needs from an audio file (the real one is expo-file-system's File)
export type AudioFile = {
  readonly exists: boolean;
  readonly size: number | null;
  upload(url: string, options?: UploadOptions): Promise<UploadResult>;
};

export async function transcribe(entry: Entry, options: TranscribeOptions = {}): Promise<TranscribeResult> {
  return transcribeAudio(entry.audioUri, entry.durationMs, options);
}

// One audio file: a dictation, a meeting recorded before part 3, or one piece of a meeting
// The language is the one chosen in Account (Vietnamese until chosen; "auto" sends none), unless the
// caller says one (an explicit `language` key, even undefined).
export async function transcribeAudio(uri: string | null, durationMs: number, options: TranscribeOptions = {}): Promise<TranscribeResult> {
  if (!uri) return { ok: false, error: 'The audio file is not on this phone.' };
  const chosen = withChosenLanguage(options, loadTranscribeLanguage());
  const prompt = 'prompt' in options ? options.prompt : learnedPrompt();
  const started = Date.now();
  const result = await transcribeFile(new File(uri), durationMs, validToken, prompt ? { ...chosen, prompt } : chosen);
  // For the keyboard log: whether the terms were sent and how Whisper's answer came back, never the words. This
  // is how the effect of the prompt on the real service is read from the phone.
  note(`transcribe: ${prompt ? `prompt of ${prompt.split(', ').length} terms sent` : 'no prompt'}, ${result.ok ? 'text came back' : 'no text'} in ${Date.now() - started} ms`);
  return withLearnedWords(result);
}

function note(text: string): void {
  try {
    noteKeyboardLog(text);
  } catch {
    // The log is only for finding out what went wrong
  }
}

// What Whisper is told to listen for: the Custom vocabulary, then the words learned from fixes. With
// learning off only the vocabulary list. Never fails the transcription.
export function learnedPrompt(): string | undefined {
  try {
    const vocabulary = loadVocabulary();
    const learning = loadLearning();
    // With learning on: the vocabulary, the words learned from fixes, and (when "Learn my vocabulary from
    // History" is on) the words picked up from History, which only fill the room that is left
    const terms = learning.learning
      ? selectTerms(vocabulary, loadLexicon(), STT_PROMPT_MAX_TERMS, learning.autoLearn ? promptAutoTerms(loadLearned()) : [])
      : vocabulary.slice(0, STT_PROMPT_MAX_TERMS);
    return buildSttPrompt(terms);
  } catch {
    return undefined;
  }
}

// The words the person fixed in History (twice: see lexicon.ts) are written the way they fixed them,
// after the transcription and before anything else uses the text (T-0179)
export function withLearnedWords(result: TranscribeResult): TranscribeResult {
  if (!result.ok) return result;
  // The words are the person's own; if they cannot be read, the transcription is still theirs to keep.
  // The order is the computer's: the words learned from fixes first (only while learning is on), then the
  // Custom vocabulary's spelling.
  try {
    const learned = loadLearning().learning ? applyReplacements(result.text, loadLexicon()) : result.text;
    return { ...result, text: spellVocabulary(learned, loadVocabulary()) };
  } catch {
    return result;
  }
}

// The file is sent by the phone's own uploader (URLSession on iPhone, OkHttp on Android), straight
// from the disk. It used to go through fetch with a FormData part { uri, name, type }: Expo SDK 57
// replaces fetch with expo/fetch, which does not take such a part and throws before anything is
// sent ("Unsupported FormDataPart implementation", expo/src/winter/fetch/convertFormData.ts), so no
// recording ever reached Wispra Cloud and every card said there was no connection (T-0154).
export async function transcribeFile(
  audio: AudioFile,
  durationMs: number,
  token: () => Promise<string | null>,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!audio.exists) return { ok: false, error: 'The audio file is not on this phone.' };
  // Nothing was recorded in it: nothing worth sending
  if (emptyAudio(audio.size)) return { ok: false, error: NO_AUDIO };
  if ((audio.size ?? 0) > CLOUD_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: 'This recording is longer than Wispra Cloud takes in one piece (about 17 minutes). The audio is kept; meetings recorded from now on are sent in pieces.',
    };
  }
  const bearer = await token();
  if (!bearer) return { ok: false, error: 'Sign in to Wispra Cloud in Account to transcribe. The audio is kept on this phone.', transient: true };

  const first = await sendOnce(audio, durationMs, bearer, options.language, true, options.prompt);
  if ('error' in first) return first.error;
  // Real speech lost to the filters: once more, asking for Vietnamese; the answer with more words wins
  if (!options.language && needsResend(first.analysed.answer)) {
    // Not counted toward the monthly minutes a second time: no duration header
    const again = await sendOnce(audio, durationMs, bearer, 'vi', false, options.prompt);
    if (!('error' in again)) return withoutEcho(betterOf(first.analysed, again.analysed).result, options.prompt);
  }
  return withoutEcho(first.analysed.result, options.prompt);
}

// With a prompt of terms, near-silence can come back as the terms themselves: that is no speech
function withoutEcho(result: TranscribeResult, prompt: string | undefined): TranscribeResult {
  if (!result.ok || !prompt) return result;
  const text = dropTermListEcho(result.text, prompt);
  if (text !== result.text) note('transcribe: part of the answer was only the prompt echoed back: dropped');
  return text ? { ...result, text } : { ok: false, error: NO_SPEECH };
}

// One upload and the answer read; or why it did not get there
async function sendOnce(
  audio: AudioFile,
  durationMs: number,
  bearer: string,
  language: string | undefined,
  countMinutes = true,
  prompt?: string,
): Promise<{ analysed: Analysed } | { error: TranscribeResult }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: UploadResult;
  try {
    response = await audio.upload(`${cloud.apiBase}/api/transcribe`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/mp4',
      parameters: { model: MODEL, response_format: 'verbose_json', ...(language ? { language } : {}), ...(prompt ? { prompt } : {}) },
      headers: {
        Authorization: `Bearer ${bearer}`,
        // The server counts this toward the monthly minutes
        ...(countMinutes && durationMs > 0 ? { 'X-Audio-Duration-Seconds': String(Math.ceil(durationMs / 1000)) } : {}),
      },
      // Sent now, while the app is open; a background session may wait for a better moment
      sessionType: 'foreground',
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    const why = err instanceof Error && err.message ? ` (${err.message})` : '';
    return {
      error: {
        ok: false,
        error: timedOut
          ? 'Transcription timed out. Check your connection; it is tried again by itself.'
          : `Could not reach Wispra Cloud${why}. The audio is kept; it is tried again by itself.`,
        transient: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
  return { analysed: analyseResponse(response.status, response.body) };
}
