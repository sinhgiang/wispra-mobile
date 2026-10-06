// The words of a keyboard piece with their dots, commas and capitals, through the real bridge
// (T-0178, point 4): chunk -> transcribed -> punctuated -> handed back to the keyboard. Only the
// transcription, the call to Wispra Cloud's chat and the native hand-over are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

let mockAllowed = true;
const mockHeard: Record<string, string> = {};
const mockChat: { user: string; system: string }[] = [];
let mockStyleNotes = '';
let mockChatAnswer: (user: string) => unknown = () => ({ text: '' });
const mockListeners: ((chunk: unknown) => void)[] = [];
const mockNotes: string[] = [];
const mockDelivered: { utterance: string; index: number; text: string; last: boolean; failed: boolean }[] = [];

jest.mock('expo-file-system', () => ({ File: class { exists = false; constructor(_uri: string) {} delete() {} } }));
jest.mock('@/lib/storage', () => ({
  loadSessionMinutes: () => 240,
  sessionEndedByUser: () => false,
  loadLearning: () => ({ learning: true, autoLearn: true }),
  loadLearned: () => ({ dismissed: [], styleNotes: mockStyleNotes, styleOff: [], autoTerms: [], evalSince: '', evalRecords: [] }),
}));
jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ cloudAllowed: () => mockAllowed }) }));
jest.mock('@/lib/transcriber', () => ({
  transcribeAudio: async (path: string) => ({ ok: true, text: mockHeard[path] ?? '' }),
}));
// The step waits 50 ms here instead of 4 s; the real value is checked in punctuation.test.ts
jest.mock('@/lib/punctuation', () => ({ ...(jest.requireActual('@/lib/punctuation') as object), PUNCTUATION_WAIT_MS: 50 }));
jest.mock('@/lib/use-session', () => ({ useSession: () => null }));
jest.mock('@/lib/ai', () => ({
  chatJson: async (system: string, user: string) => {
    mockChat.push({ user, system });
    return mockChatAnswer(user);
  },
}));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  onSessionChunk: (listener: (chunk: unknown) => void) => {
    mockListeners.push(listener);
    return { remove: () => undefined };
  },
  deliverText: async (utterance: string, index: number, text: string, last: boolean, failed: boolean) => {
    mockDelivered.push({ utterance, index, text, last, failed });
    return true;
  },
  noteKeyboardLog: (text: string) => mockNotes.push(text),
}));

// eslint-disable-next-line import/first
import { KeyboardSessionBridge } from '@/components/wispra/keyboard-session-bridge';

const piece = (path: string, utterance: string, index: number, last: boolean) => ({ path, durationMs: 6_000, utterance, index, last, voiced: true });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  mockAllowed = true;
  for (const key of Object.keys(mockHeard)) delete mockHeard[key];
  mockChat.length = 0;
  mockListeners.length = 0;
  mockDelivered.length = 0;
  mockNotes.length = 0;
  mockStyleNotes = '';
  mockChatAnswer = () => ({ text: '' });
});

describe('the keyboard types punctuated words', () => {
  it('turns the owner’s text into sentences with their stops, commas and capitals', async () => {
    mockHeard['a.m4a'] = 'ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ rằng chúng ta cần thay đổi cách làm';
    mockChatAnswer = () => ({ text: 'Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ rằng chúng ta cần thay đổi cách làm.' });
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('a.m4a', 'u1', 0, true));
    await settle();
    expect(mockDelivered).toEqual([
      { utterance: 'u1', index: 0, text: 'Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ rằng chúng ta cần thay đổi cách làm.', last: true, failed: false },
    ]);
  });

  it('goes on from the piece before: the second piece is told what the first ended with', async () => {
    mockHeard['p0.m4a'] = 'hôm nay mình họp lúc hai giờ chiều';
    mockHeard['p1.m4a'] = 'sau đó mình gửi báo cáo cho anh Nam';
    mockChatAnswer = (user) =>
      user.includes('hôm nay') ? { text: 'Hôm nay mình họp lúc hai giờ chiều.' } : { text: 'Sau đó mình gửi báo cáo cho anh Nam.' };
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('p0.m4a', 'u2', 0, false));
    mockListeners[0](piece('p1.m4a', 'u2', 1, true));
    await settle();
    expect(mockChat).toHaveLength(2);
    expect(mockChat[0].user).toContain('PREVIOUS: (nothing: this starts the dictation)');
    expect(mockChat[1].user).toContain('PREVIOUS: Hôm nay mình họp lúc hai giờ chiều.');
    expect(mockDelivered.map((d) => d.text)).toEqual(['Hôm nay mình họp lúc hai giờ chiều.', 'Sau đó mình gửi báo cáo cho anh Nam.']);
  });

  it('types the words as they came, with a capital for a new sentence, when the model changes a word', async () => {
    mockHeard['b.m4a'] = 'ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ';
    mockChatAnswer = () => ({ text: 'Ngoài kia, không có ai lắng nghe. Vì vậy tôi nghĩ.' });
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('b.m4a', 'u3', 0, true));
    await settle();
    expect(mockDelivered[0].text).toBe('Ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ');
  });

  it('does not ask Wispra Cloud when it may not be used (another account waits for its choice)', async () => {
    mockAllowed = false;
    mockHeard['c.m4a'] = 'xin chào cả nhà';
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('c.m4a', 'u4', 0, true));
    await settle();
    expect(mockChat).toHaveLength(0);
    // Not transcribed either: nothing to type, but the keyboard still hears that the piece ended
    expect(mockDelivered).toEqual([{ utterance: 'u4', index: 0, text: '', last: true, failed: false }]);
  });

  it('is never held up by a chat call that does not answer: after the short wait the words are typed as they came, with a capital', async () => {
    mockHeard['h0.m4a'] = 'xin chào cả nhà hôm nay mình họp';
    mockHeard['h1.m4a'] = 'sau đó mình gửi báo cáo cho anh Nam';
    // Never answers (the real call would give up only after 90 s)
    mockChatAnswer = () => new Promise(() => undefined);
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('h0.m4a', 'u6', 0, false));
    mockListeners[0](piece('h1.m4a', 'u6', 1, true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Both pieces came out, in order; the second did not wait for the first one's 90 s
    expect(mockDelivered.map((d) => [d.index, d.text, d.failed])).toEqual([
      [0, 'Xin chào cả nhà hôm nay mình họp', false],
      [1, 'sau đó mình gửi báo cáo cho anh Nam', false],
    ]);
    // The log says it ran out of time, and holds none of the words
    expect(mockNotes.filter((n) => /punctuation: timeout in \d+ ms, \d+ words/.test(n))).toHaveLength(2);
    expect(mockNotes.join(' ')).not.toMatch(/chào|báo cáo/);
  });

  it('tells the AI step how the user writes (the style notes), before its instructions', async () => {
    mockStyleNotes = 'short sentences, never exclamation marks';
    mockHeard['s.m4a'] = 'ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ';
    mockChatAnswer = () => ({ text: 'Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ.' });
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('s.m4a', 'u8', 0, true));
    await settle();
    expect(mockChat[0].system.startsWith('The user has personal writing conventions')).toBe(true);
    expect(mockChat[0].system).toContain('- In their own words: short sentences, never exclamation marks');
    expect(mockChat[0].system).toContain('You are a transcription editor');
  });

  it('notes how the step went in the log, without the words', async () => {
    mockHeard['n.m4a'] = 'ngoài kia Không có sự lắng nghe Cho nên tôi nghĩ';
    mockChatAnswer = () => ({ text: 'Ngoài kia, không có sự lắng nghe. Cho nên, tôi nghĩ.' });
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('n.m4a', 'u7', 0, true));
    await settle();
    expect(mockNotes).toHaveLength(1);
    expect(mockNotes[0]).toMatch(/^punctuation: model in \d+ ms, 11 words$/);
  });

  it('is never held up by the step: a failing chat call types the words anyway', async () => {
    mockHeard['d.m4a'] = 'xin chào cả nhà hôm nay mình họp';
    mockChatAnswer = () => {
      throw new Error('offline');
    };
    await render(<KeyboardSessionBridge />);
    mockListeners[0](piece('d.m4a', 'u5', 0, true));
    await settle();
    expect(mockDelivered[0]).toMatchObject({ text: 'Xin chào cả nhà hôm nay mình họp', failed: false });
  });
});
