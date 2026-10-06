// Keeping the session by itself (T-0178, point 3), through the real bridge: opening Wispra (or bringing
// it back) starts the listening session when the keyboard was used within a day, so the keyboard's mic
// works at once. Only the native session, the file that remembers "ended on purpose" and the store are
// stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';

let mockAllowed = true;
let mockSeenAt: number | null = null;
let mockActive = false;
let mockEnded = false;
const mockStarted: number[] = [];

jest.mock('expo-file-system', () => ({ File: class { exists = false; constructor(_uri: string) {} delete() {} } }));
jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ cloudAllowed: () => mockAllowed }) }));
jest.mock('@/lib/use-session', () => ({ useSession: () => null }));
jest.mock('@/lib/storage', () => ({ loadSessionMinutes: () => 240, sessionEndedByUser: () => mockEnded }));
jest.mock('@/lib/transcriber', () => ({ transcribeAudio: async () => ({ ok: true, text: '' }) }));
jest.mock('@/lib/ai', () => ({ chatJson: async () => ({}) }));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  onSessionChunk: () => ({ remove: () => undefined }),
  deliverText: async () => true,
  keyboardStatus: async () => ({ enabled: true, lastSeenAt: mockSeenAt }),
  sessionState: async () => ({ active: mockActive, until: 0, listening: false }),
  startSession: async (minutes: number) => {
    mockStarted.push(minutes);
    return { active: true, until: 0, listening: false };
  },
}));

// eslint-disable-next-line import/first
import { KeyboardSessionBridge } from '@/components/wispra/keyboard-session-bridge';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  mockAllowed = true;
  mockSeenAt = Date.now() - 2 * 60 * 60 * 1000;
  mockActive = false;
  mockEnded = false;
  mockStarted.length = 0;
});

describe('a cold start (T-0178 review)', () => {
  // Wispra is opened from nothing: the sign-in and the data on the phone are not loaded yet, and AppState
  // sends no "active" for the state the app starts in. The session starts when they are.
  it('starts once Wispra Cloud may be used, when it may not be at the first render', async () => {
    mockAllowed = false;
    const view = await render(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([]);
    mockAllowed = true;
    await view.rerender(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([240]);
  });

  it('starts once, not twice, when it may be used from the first render', async () => {
    const view = await render(<KeyboardSessionBridge />);
    await settle();
    await view.rerender(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([240]);
  });
});

describe('the session starts by itself when Wispra is opened', () => {
  it('with the length chosen in Account, when the keyboard was used within a day', async () => {
    await render(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([240]);
  });

  it('and again when Wispra is brought back to the front and no session runs', async () => {
    let onChange: (state: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      onChange = listener;
      return { remove: () => undefined };
    }) as never);
    mockSeenAt = null;
    await render(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([]);
    // The keyboard gets used, and Wispra comes back to the front
    mockSeenAt = Date.now() - 1000;
    onChange('active');
    await settle();
    expect(mockStarted).toEqual([240]);
  });

  it.each([
    ['the keyboard was last used two days ago', () => (mockSeenAt = Date.now() - 48 * 60 * 60 * 1000)],
    ['the keyboard was never used', () => (mockSeenAt = null)],
    ['a session already runs', () => (mockActive = true)],
    ['Wispra Cloud may not be used', () => (mockAllowed = false)],
    ['the user ended the session on purpose', () => (mockEnded = true)],
  ])('does not start when %s', async (_why, arrange) => {
    arrange();
    await render(<KeyboardSessionBridge />);
    await settle();
    expect(mockStarted).toEqual([]);
  });
});
