// The real Dictate and Account screens, rendered (T-0154 review: what the owner sees is checked on
// the screens themselves, not only in the functions that choose their labels). Everything outside
// the screen (recording, the store, the phone's setup) is played by small stand-ins.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { SetupState } from '@/lib/setup-guide';

const mockPush = jest.fn();
let mockSetup: SetupState;

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() }, useFocusEffect: () => undefined }));
jest.mock('@/lib/use-setup', () => ({ useSetupState: () => mockSetup }));
jest.mock('@/lib/use-session', () => ({ useSession: () => ({ email: 'owner@example.com' }) }));
jest.mock('@/lib/use-recording', () => ({
  useRecording: () => ({ phase: 'idle', durationMs: 0, error: null, start: jest.fn(), stop: jest.fn(), cancel: jest.fn() }),
}));
jest.mock('@/lib/entries-store', () => ({
  useEntries: () => ({ entries: [], syncState: { note: null, at: null, waitingDeletes: 0 }, retry: jest.fn(), busy: new Set() }),
}));
jest.mock('@/lib/transcriber', () => ({ transcriptionAvailable: () => true }));
jest.mock('@/lib/cloud-history', () => ({ readUsage: () => new Promise(() => undefined) }));
jest.mock('@/lib/cloud-auth', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/sign-in', () => ({ signInWithGoogle: jest.fn() }));

// eslint-disable-next-line import/first
import AccountScreen from '@/app/(tabs)/account';
// eslint-disable-next-line import/first
import DictateScreen from '@/app/(tabs)/dictate';

const iphone: SetupState = { platform: 'ios', signedIn: true, keyboard: { enabled: true, lastSeenAt: null }, bubbleOn: false, waiting: 0 };
const android: SetupState = { platform: 'android', signedIn: true, keyboard: null, bubbleOn: false, waiting: 0 };

beforeEach(() => {
  mockPush.mockClear();
  mockSetup = iphone;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('Dictate', () => {
  it('shows the mic and nothing about setting up the keyboard, on iPhone and on Android', async () => {
    for (const state of [iphone, android]) {
      mockSetup = state;
      const view = await render(<DictateScreen />);
      expect(screen.getByLabelText('Start dictating')).toBeTruthy();
      for (const gone of [/Switch to the Wispra keyboard/, /Dictate into any app/, /Wispra keyboard/, /^Keyboard$/, /Mic button/, /Show me how/, /Open Settings/]) {
        expect(screen.queryByText(gone)).toBeNull();
      }
      await view.unmount();
    }
  });
});

describe('Account › Dictate in other apps', () => {
  it('on iPhone, the Wispra keyboard opens Wispra in Settings', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<AccountScreen />);
    expect(screen.getByText('Dictate in other apps')).toBeTruthy();
    await fireEvent.press(screen.getByText('Wispra keyboard'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('How the keyboard works'));
    expect(mockPush).toHaveBeenCalledWith('/welcome');
  });

  it('on Android, leads to the keyboard and the mic button setup screens', async () => {
    mockSetup = android;
    await render(<AccountScreen />);
    await fireEvent.press(screen.getByText('Wispra keyboard'));
    await fireEvent.press(screen.getByText('Mic button'));
    expect(mockPush.mock.calls).toEqual([['/keyboard-setup'], ['/dictation-setup']]);
  });
});
