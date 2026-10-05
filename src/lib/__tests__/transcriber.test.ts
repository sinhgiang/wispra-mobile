import { describe, expect, it, jest } from '@jest/globals';
import { UploadType, type UploadOptions, type UploadResult } from 'expo-file-system';

import { pieceFailed } from '../keyboard-session';
import { needsResend, resultFromResponse, SPEECH_NOT_MADE_OUT, transcribeFile, type AudioFile } from '../transcriber';

jest.mock('../cloud-auth', () => ({ currentSession: () => null, validToken: async () => null }));

const answer = JSON.stringify({ text: 'Xin chào', segments: [{ text: 'Xin chào', no_speech_prob: 0.01, avg_logprob: -0.2 }] });

function audio(over: Partial<AudioFile> & { reply?: () => Promise<UploadResult> } = {}) {
  const calls: { url: string; options?: UploadOptions }[] = [];
  const file: AudioFile = {
    exists: true,
    size: 120_000,
    upload: async (url, options) => {
      calls.push({ url, options });
      return over.reply ? over.reply() : { status: 200, body: answer, headers: {} };
    },
    ...over,
  };
  return { file, calls };
}

const token = async () => 'tok';

describe('sending a recording to Wispra Cloud (T-0154)', () => {
  it('uploads the file itself, as multipart, with the fields the server reads', async () => {
    const { file, calls } = audio();
    expect(await transcribeFile(file, 8_000, token)).toEqual({ ok: true, text: 'Xin chào' });
    expect(calls).toHaveLength(1);
    const { url, options } = calls[0];
    expect(url).toMatch(/\/api\/transcribe$/);
    expect(options).toMatchObject({
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/mp4',
      parameters: { model: 'whisper-large-v3', response_format: 'verbose_json' },
      headers: { Authorization: 'Bearer tok', 'X-Audio-Duration-Seconds': '8' },
      sessionType: 'foreground',
    });
  });

  it('says why when the phone could not send it, and tries again by itself', async () => {
    const { file } = audio({ reply: async () => Promise.reject(new Error('The Internet connection appears to be offline.')) });
    const result = await transcribeFile(file, 8_000, token);
    expect(result).toMatchObject({ ok: false, transient: true });
    expect(!result.ok && result.error).toContain('(The Internet connection appears to be offline.)');
  });

  it('sends nothing for a missing, empty or signed-out recording', async () => {
    const missing = audio({ exists: false });
    expect(await transcribeFile(missing.file, 1, token)).toMatchObject({ ok: false, error: 'The audio file is not on this phone.' });
    const empty = audio({ size: 300 });
    expect(await transcribeFile(empty.file, 1, token)).toMatchObject({ ok: false, error: 'No audio was recorded in this file.' });
    const signedOut = audio();
    expect(await transcribeFile(signedOut.file, 1, async () => null)).toMatchObject({ ok: false, transient: true });
    expect([...missing.calls, ...empty.calls, ...signedOut.calls]).toHaveLength(0);
  });
});

describe("reading Wispra Cloud's answer", () => {
  it('turns each status into what the card says', () => {
    expect(resultFromResponse(200, answer)).toEqual({ ok: true, text: 'Xin chào' });
    expect(resultFromResponse(401, '')).toMatchObject({ ok: false, error: expect.stringContaining('expired') });
    expect(resultFromResponse(402, JSON.stringify({ error: 'Hết phút' }))).toEqual({ ok: false, error: 'Hết phút' });
    expect(resultFromResponse(413, '')).toMatchObject({ ok: false });
    expect(resultFromResponse(503, '<html>')).toEqual({ ok: false, error: 'Transcription failed (HTTP 503).', transient: true });
    expect(resultFromResponse(400, JSON.stringify({ error: 'bad file' }))).toEqual({ ok: false, error: 'Wispra Cloud: bad file', transient: false });
    expect(resultFromResponse(200, 'not json')).toMatchObject({ ok: false, transient: true });
    expect(resultFromResponse(200, JSON.stringify({ text: '', segments: [] }))).toEqual({ ok: false, error: 'No speech was heard in this recording.' });
  });
});

// T-0164 review, points 2 to 4: what the pieces of a meeting, a dictation and a keyboard session all
// go through
describe('real speech lost to the filters is sent again, once (T-0164 review)', () => {
  const garbled = JSON.stringify({
    text: '',
    segments: [{ text: ' B ph tr s vi c tr l m c n g ch th nh t', no_speech_prob: 0.01, avg_logprob: -0.07, start: 0, end: 12 }],
  });
  const clean = JSON.stringify({
    text: '',
    segments: [{ text: ' Bạn phụ trách sẽ viết câu trả lời mẫu cho các câu hỏi', no_speech_prob: 0.01, avg_logprob: -0.2, start: 0, end: 12 }],
  });

  function twoAnswers(first: string, second: string) {
    let n = 0;
    return audio({ reply: async () => ({ status: 200, body: n++ === 0 ? first : second, headers: {} }) });
  }

  it('asks again for Vietnamese and keeps the answer with more words', async () => {
    const { file, calls } = twoAnswers(garbled, clean);
    const result = await transcribeFile(file, 12_000, token);
    expect(result).toEqual({ ok: true, text: 'Bạn phụ trách sẽ viết câu trả lời mẫu cho các câu hỏi' });
    expect(calls).toHaveLength(2);
    expect(calls[0].options?.parameters).toEqual({ model: 'whisper-large-v3', response_format: 'verbose_json' });
    expect(calls[1].options?.parameters).toMatchObject({ language: 'vi' });
  });

  it('keeps the first answer when the second is no better, and never asks a third time', async () => {
    const { file, calls } = twoAnswers(
      JSON.stringify({ segments: [{ text: ' Rồi nhé ch c kh th n c nh c', no_speech_prob: 0.01, avg_logprob: -0.2, start: 0, end: 8 }, accentsLostSegment()] }),
      garbled,
    );
    const result = await transcribeFile(file, 12_000, token);
    expect(result).toEqual({ ok: true, text: 'Rồi nhé' });
    expect(calls).toHaveLength(2);
  });

  it('says so when words were heard and none could be made out, instead of "(nothing said)"', async () => {
    const { file } = twoAnswers(garbled, garbled);
    const result = await transcribeFile(file, 12_000, token);
    expect(result).toEqual({ ok: false, error: SPEECH_NOT_MADE_OUT });
    // A card for it, never "No speech was heard"
    expect(!result.ok && result.error.startsWith('No speech')).toBe(false);
  });

  it('does not send again for clean speech, for silence, or when a language was asked for', async () => {
    const a = audio({ reply: async () => ({ status: 200, body: clean, headers: {} }) });
    await transcribeFile(a.file, 12_000, token);
    const b = audio({ reply: async () => ({ status: 200, body: JSON.stringify({ text: '', segments: [] }), headers: {} }) });
    expect(await transcribeFile(b.file, 12_000, token)).toEqual({ ok: false, error: 'No speech was heard in this recording.' });
    const c = twoAnswers(garbled, clean);
    await transcribeFile(c.file, 12_000, token, { language: 'vi' });
    expect([a.calls.length, b.calls.length, c.calls.length]).toEqual([1, 1, 1]);
    expect(c.calls[0].options?.parameters).toMatchObject({ language: 'vi' });
  });

  it('decides from the answer: at least 3 seconds uncovered and half of what Whisper wrote', () => {
    const base = { text: '', words: 12, wordsLeft: 0, speechSeconds: 12, uncoveredSeconds: 12, gibberish: true };
    expect(needsResend(base)).toBe(true);
    expect(needsResend({ ...base, uncoveredSeconds: 2 })).toBe(false);
    expect(needsResend({ ...base, uncoveredSeconds: 5 })).toBe(false);
    expect(needsResend({ ...base, gibberish: false })).toBe(false);
    expect(needsResend(null)).toBe(false);
  });
});

function accentsLostSegment() {
  return { text: ' B ph tr s vi c tr l m c n g', no_speech_prob: 0.01, avg_logprob: -0.07, start: 8, end: 20 };
}

describe('the callers of the filter (T-0164 review, point 4)', () => {
  it('Dictate: a short real answer with low confidence is kept, a short garbled one is reported', () => {
    expect(resultFromResponse(200, JSON.stringify({ segments: [{ text: ' Dạ.', no_speech_prob: 0.1, avg_logprob: -1.5 }] }))).toEqual({ ok: true, text: 'Dạ.' });
    const lost = resultFromResponse(200, JSON.stringify({ segments: [{ text: ' ch c kh th n c nh c', no_speech_prob: 0.1, avg_logprob: -0.3 }] }));
    expect(lost).toEqual({ ok: false, error: SPEECH_NOT_MADE_OUT });
  });

  it('keyboard sessions: a piece with words that could not be made out counts as failed, silence does not', () => {
    expect(pieceFailed({ ok: false, error: SPEECH_NOT_MADE_OUT })).toBe(true);
    expect(pieceFailed({ ok: false, error: 'No speech was heard in this recording.' })).toBe(false);
  });
});
