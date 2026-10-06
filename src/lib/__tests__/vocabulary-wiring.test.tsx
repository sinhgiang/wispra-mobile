// Custom vocabulary and learned words reaching every transcription through the real path (T-0182):
// transcribeAudio runs for real (Dictate, meeting pieces, the keyboard's pieces); only the phone's file, its
// storage and the sign-in are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

import type { LexiconEntry } from '../lexicon';

let mockVocabulary: string[] = [];
let mockLexicon: LexiconEntry[] = [];
let mockLearning = true;
let mockAutoLearn = true;
let mockAutoTerms: string[] = [];
let mockDismissed: string[] = [];
let mockAnswer = ' mở git hub lên rồi cap cut';
const mockUploads: { parameters: Record<string, string> }[] = [];
const mockListeners: ((chunk: unknown) => void)[] = [];
const mockDelivered: { text: string }[] = [];
const mockNotes: string[] = [];

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
    async upload(_url: string, options: { parameters?: Record<string, string> }) {
      mockUploads.push({ parameters: options.parameters ?? {} });
      return { status: 200, body: JSON.stringify({ segments: [{ text: mockAnswer, no_speech_prob: 0.01, avg_logprob: -0.2, start: 0, end: 3 }] }), headers: {} };
    }
  },
}));
jest.mock('../storage', () => ({
  loadTranscribeLanguage: () => 'vi',
  loadVocabulary: () => [...mockVocabulary],
  loadLexicon: () => JSON.parse(JSON.stringify(mockLexicon)),
  loadLearning: () => ({ learning: mockLearning, autoLearn: mockAutoLearn }),
  loadLearned: () => ({ autoTerms: [...mockAutoTerms], dismissed: [...mockDismissed] }),
  loadSessionMinutes: () => 240,
  sessionEndedByUser: () => false,
}));
jest.mock('../cloud-auth', () => ({ currentSession: () => ({ email: 'a@b.c' }), validToken: async () => 'tok' }));
jest.mock('@/lib/ai', () => ({ chatJson: async () => Promise.reject(new Error('no network in tests')) }));
jest.mock('../entries-store', () => ({ useEntries: () => ({ cloudAllowed: () => true }) }));
jest.mock('@/lib/use-session', () => ({ useSession: () => null }));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  onSessionChunk: (listener: (chunk: unknown) => void) => {
    mockListeners.push(listener);
    return { remove: () => undefined };
  },
  deliverText: async (_u: string, _i: number, text: string) => {
    mockDelivered.push({ text });
    return true;
  },
  noteKeyboardLog: (text: string) => mockNotes.push(text),
}));

// eslint-disable-next-line import/first
import { KeyboardSessionBridge } from '@/components/wispra/keyboard-session-bridge';
// eslint-disable-next-line import/first
import { transcribeAudio } from '../transcriber';

const OWNER = ['Github', 'Capcut', 'Timio', 'Wispra', 'TikTok'];
const entry = (term: string, heardAs: string[], count: number): LexiconEntry => ({
  id: term,
  term,
  heardAs,
  count,
  enabled: true,
  pinned: false,
  source: 'correction',
  createdAt: '2026-10-06T00:00:00.000Z',
  lastSeen: '2026-10-06T00:00:00.000Z',
});

beforeEach(() => {
  mockVocabulary = [];
  mockLexicon = [];
  mockLearning = true;
  mockAutoLearn = true;
  mockAutoTerms = [];
  mockDismissed = [];
  mockAnswer = ' mở git hub lên rồi cap cut';
  mockUploads.length = 0;
  mockListeners.length = 0;
  mockDelivered.length = 0;
  mockNotes.length = 0;
});

describe('the Custom vocabulary in every transcription', () => {
  it('respells what Whisper wrote its own way, and tells Whisper the terms', async () => {
    mockVocabulary = OWNER;
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'mở Github lên rồi Capcut' });
    expect(mockUploads[0].parameters.prompt).toBe('Github, Capcut, Timio, Wispra, TikTok.');
  });

  it('sends no prompt and changes nothing when the list is empty', async () => {
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'mở git hub lên rồi cap cut' });
    expect(mockUploads[0].parameters).not.toHaveProperty('prompt');
  });

  it('applies to the keyboard’s pieces too', async () => {
    mockVocabulary = OWNER;
    await render(<KeyboardSessionBridge />);
    mockListeners[0]({ path: 'file:///p.m4a', durationMs: 3_000, utterance: 'u', index: 0, last: true, voiced: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(mockDelivered[0].text).toMatch(/Github.*Capcut/);
    expect(mockDelivered[0].text).not.toMatch(/git hub|cap cut/);
  });

  it('says in the keyboard log that the terms were sent and how the answer came back, never the words', async () => {
    mockVocabulary = OWNER;
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockNotes).toHaveLength(1);
    expect(mockNotes[0]).toMatch(/^transcribe: prompt of 5 terms sent, text came back in \d+ ms$/);
    mockNotes.length = 0;
    mockVocabulary = [];
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockNotes[0]).toMatch(/^transcribe: no prompt, text came back/);
  });

  it('drops an answer that is only the prompt echoed back (near silence)', async () => {
    mockVocabulary = OWNER;
    mockAnswer = ' Github, Capcut, Timio, Wispra, TikTok.';
    const result = await transcribeAudio('file:///a.m4a', 3_000);
    expect(result.ok).toBe(false);
    expect(mockNotes.join(' | ')).toMatch(/only the prompt echoed back: dropped/);
  });
});

describe('what was learned from fixes, with the switch', () => {
  it('replaces a wrong form fixed twice, then spells the vocabulary', async () => {
    mockLexicon = [entry('Claude', ['cloud'], 2)];
    mockVocabulary = ['Github'];
    mockAnswer = ' dùng cloud với git hub';
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'dùng Claude với Github' });
    // The learned word is in the prompt too
    expect(mockUploads[0].parameters.prompt).toBe('Github, Claude.');
  });

  it('with "Learn my words" off, applies no learned word but keeps the vocabulary', async () => {
    mockLexicon = [entry('Claude', ['cloud'], 2)];
    mockVocabulary = ['Github'];
    mockLearning = false;
    mockAnswer = ' dùng cloud với git hub';
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'dùng cloud với Github' });
    expect(mockUploads[0].parameters.prompt).toBe('Github.');
  });
});


describe('the words picked up from History', () => {
  it('fill the room left in the prompt, after the vocabulary and the learned words', async () => {
    mockVocabulary = ['Github'];
    mockLexicon = [entry('Claude', ['cloud'], 2)];
    mockAutoTerms = ['Supabase', 'Github'];
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockUploads[0].parameters.prompt).toBe('Github, Claude, Supabase.');
  });

  it('never include a word the person removed, even while it is still in the saved list (T-0182 review)', async () => {
    mockVocabulary = ['Github'];
    mockAutoTerms = ['Supabase', 'Lumora', 'Claude Code'];
    mockDismissed = ['term:lumora', 'term:claude code'];
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockUploads[0].parameters.prompt).toBe('Github, Supabase.');
  });

  it('are left out when Learn my vocabulary from History is off, or learning is', async () => {
    mockVocabulary = ['Github'];
    mockAutoTerms = ['Supabase'];
    mockAutoLearn = false;
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockUploads[0].parameters.prompt).toBe('Github.');
    mockAutoLearn = true;
    mockLearning = false;
    await transcribeAudio('file:///a.m4a', 3_000);
    expect(mockUploads[1].parameters.prompt).toBe('Github.');
  });
});
