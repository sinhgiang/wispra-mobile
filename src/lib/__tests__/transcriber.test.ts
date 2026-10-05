import { describe, expect, it, jest } from '@jest/globals';
import { UploadType, type UploadOptions, type UploadResult } from 'expo-file-system';

import { resultFromResponse, transcribeFile, type AudioFile } from '../transcriber';

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
