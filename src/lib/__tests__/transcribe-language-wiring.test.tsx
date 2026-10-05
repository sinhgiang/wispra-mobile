// The saved language reaching Whisper through the real path (T-0145 review, point 2): the tests run
// transcribeAudio, which reads the choice from storage and sends it, from each of the three places that
// call it: Dictate (transcribe), a meeting piece, and the keyboard's pieces (KeyboardSessionBridge).
// Only the phone's file, its storage and the sign-in are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

import type { Entry } from '../entries';
import { createEntry } from '../entries';

let mockSaved = 'vi';
const mockUploads: { url: string; parameters: Record<string, string> }[] = [];
const mockListeners: ((chunk: unknown) => void)[] = [];
const mockDelivered: { utterance: string; index: number; text: string; last: boolean; failed: boolean }[] = [];

const mockAnswer = JSON.stringify({ segments: [{ text: ' Xin chào cả nhà', no_speech_prob: 0.01, avg_logprob: -0.2, start: 0, end: 3 }] });

jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  File: class {
    exists = true;
    size = 120_000;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {}
    async upload(url: string, options: { parameters?: Record<string, string> }) {
      mockUploads.push({ url, parameters: options.parameters ?? {} });
      return { status: 200, body: mockAnswer, headers: {} };
    }
  },
}));
// The real reading of a saved value, as storage does it
jest.mock('../storage', () => ({
  loadTranscribeLanguage: () => (jest.requireActual('../transcribe-language') as typeof import('../transcribe-language')).parseTranscribeLanguage(mockSaved),
}));
jest.mock('../cloud-auth', () => ({ currentSession: () => ({ email: 'a@b.c' }), validToken: async () => 'tok' }));
// The punctuation step asks Wispra Cloud's chat: never for real here
jest.mock('@/lib/ai', () => ({ chatJson: async () => Promise.reject(new Error('no network in tests')) }));
jest.mock('../entries-store', () => ({ useEntries: () => ({ cloudAllowed: () => true }) }));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  onSessionChunk: (listener: (chunk: unknown) => void) => {
    mockListeners.push(listener);
    return { remove: () => undefined };
  },
  deliverText: async (utterance: string, index: number, text: string, last: boolean, failed: boolean) => {
    mockDelivered.push({ utterance, index, text, last, failed });
    return true;
  },
}));

// eslint-disable-next-line import/first
import { KeyboardSessionBridge } from '@/components/wispra/keyboard-session-bridge';
// eslint-disable-next-line import/first
import { transcribe, transcribeAudio } from '../transcriber';

const language = () => mockUploads[mockUploads.length - 1].parameters.language;

beforeEach(() => {
  mockSaved = 'vi';
  mockUploads.length = 0;
  mockListeners.length = 0;
  mockDelivered.length = 0;
});

describe('transcribeAudio sends the language saved in Account', () => {
  it.each([
    ['vi', 'vi'],
    ['en', 'en'],
  ])('sends %s', async (saved, expected) => {
    mockSaved = saved;
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'Xin chào cả nhà' });
    expect(language()).toBe(expected);
  });

  it('sends none for Auto-detect, so Whisper guesses', async () => {
    mockSaved = 'auto';
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockUploads[0].parameters).not.toHaveProperty('language');
  });

  it('sends Vietnamese when nothing was ever saved', async () => {
    mockSaved = 'garbage';
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(language()).toBe('vi');
  });

  it('lets a caller name its own language, which wins over the saved one', async () => {
    mockSaved = 'vi';
    await transcribeAudio('file:///a.m4a', 3_000, { language: 'en' });
    expect(language()).toBe('en');
  });
});

describe('each of the three places that transcribe uses it', () => {
  it('Dictate: a recording in one piece (transcribe)', async () => {
    mockSaved = 'en';
    const dictation: Entry = { ...createEntry('dictation', new Date('2026-10-05T10:00:00Z'), 'mobile-d'), audioUri: 'file:///d.m4a', durationMs: 8_000 };
    await transcribe(dictation);
    expect(language()).toBe('en');
  });

  it('a piece of a meeting (what the queue calls with the piece’s file and length)', async () => {
    mockSaved = 'vi';
    await transcribeAudio('file:///piece-3.m4a', 20_000);
    expect(language()).toBe('vi');
    mockSaved = 'auto';
    mockUploads.length = 0;
    await transcribeAudio('file:///piece-4.m4a', 20_000);
    expect(mockUploads[0].parameters).not.toHaveProperty('language');
  });

  it('the keyboard: a piece of a listening session, from chunk to words handed back', async () => {
    mockSaved = 'en';
    await render(<KeyboardSessionBridge />);
    expect(mockListeners).toHaveLength(1);
    mockListeners[0]({ path: 'file:///session-piece.m4a', durationMs: 5_000, utterance: 'u1', index: 0, last: true, voiced: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(language()).toBe('en');
    expect(mockDelivered).toEqual([{ utterance: 'u1', index: 0, text: 'Xin chào cả nhà', last: true, failed: false }]);
  });
});
