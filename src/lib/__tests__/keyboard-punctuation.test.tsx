// The words of a keyboard piece with their dots, commas and capitals, through the real bridge
// (T-0178, point 4): chunk -> transcribed -> punctuated -> handed back to the keyboard. Only the
// transcription, the call to Wispra Cloud's chat and the native hand-over are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

let mockAllowed = true;
const mockHeard: Record<string, string> = {};
const mockChat: { user: string }[] = [];
let mockChatAnswer: (user: string) => unknown = () => ({ text: '' });
const mockListeners: ((chunk: unknown) => void)[] = [];
const mockDelivered: { utterance: string; index: number; text: string; last: boolean; failed: boolean }[] = [];

jest.mock('expo-file-system', () => ({ File: class { exists = false; constructor(_uri: string) {} delete() {} } }));
jest.mock('@/lib/storage', () => ({ loadSessionMinutes: () => 240, sessionEndedByUser: () => false }));
jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ cloudAllowed: () => mockAllowed }) }));
jest.mock('@/lib/transcriber', () => ({
  transcribeAudio: async (path: string) => ({ ok: true, text: mockHeard[path] ?? '' }),
}));
jest.mock('@/lib/ai', () => ({
  chatJson: async (_system: string, user: string) => {
    mockChat.push({ user });
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
