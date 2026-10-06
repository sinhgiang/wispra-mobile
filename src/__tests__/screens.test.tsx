// The real Dictate, Account and keyboard session screens, rendered (T-0154 review: what the owner
// sees is checked on the screens themselves, not only in the functions that choose their labels).
// Everything outside the screen (recording, the store, the phone's setup, the native session) is
// played by small stand-ins.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking, StyleSheet } from 'react-native';

import type { SetupState } from '@/lib/setup-guide';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSetup: SetupState;
const mockSaveMinutes = jest.fn();
let mockSavedLanguage = 'vi';
const mockLanguageSaves: string[] = [];
const mockSessionEnded: boolean[] = [];
const mockLogLines: string[] = [];
// What the page the keyboard's mic opens sees of the account (T-0182)
let mockSessionLoaded = true;
let mockDataLoaded = true;
let mockSignedIn = true;
let mockCloudAllowed = true;
const mockNativeLanguage: string[] = [];
const mockStartSession = jest.fn(async (minutes: number) => ({ active: true, until: Date.now() + minutes * 60_000, listening: false }));

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() }, useFocusEffect: () => undefined }));
jest.mock('@/lib/use-setup', () => ({ useSetupState: () => mockSetup }));
jest.mock('@/lib/use-session', () => ({
  useSession: () => (mockSignedIn ? { email: 'owner@example.com' } : null),
  useSessionLoaded: () => mockSessionLoaded,
}));
jest.mock('@/lib/use-recording', () => ({
  useRecording: () => ({ phase: 'idle', durationMs: 0, error: null, start: jest.fn(), stop: jest.fn(), cancel: jest.fn() }),
}));
jest.mock('@/lib/entries-store', () => ({
  useEntries: () => ({ entries: [], syncState: { note: null, at: null, waitingDeletes: 0 }, retry: jest.fn(), busy: new Set(), loaded: mockDataLoaded, cloudAllowed: () => mockCloudAllowed }),
}));
jest.mock('@/lib/storage', () => ({
  loadSessionMinutes: () => 60,
  setSessionEndedByUser: (ended: boolean) => mockSessionEnded.push(ended),
  saveSessionMinutes: (m: number) => mockSaveMinutes(m),
  audioExists: () => true,
  loadTranscribeLanguage: () => mockSavedLanguage,
  saveTranscribeLanguage: (l: string) => {
    mockSavedLanguage = l;
    mockLanguageSaves.push(l);
  },
}));
jest.mock('@/modules/wispra-dictation', () => ({ setTranscribeLanguage: (l: string) => mockNativeLanguage.push(l) }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}) }));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  startSession: (m: number) => mockStartSession(m),
  endSession: async () => ({ active: false, until: 0, listening: false }),
  keyboardLog: async () => [...mockLogLines],
  noteKeyboardLog: () => undefined,
  clearKeyboardLog: async () => {
    mockLogLines.length = 0;
  },
  sessionState: async () => ({ active: false, until: 0, listening: false }),
  onSessionState: () => ({ remove: () => undefined }),
}));
jest.mock('@/lib/transcriber', () => ({ transcriptionAvailable: () => true }));
jest.mock('@/lib/cloud-history', () => ({ readUsage: () => new Promise(() => undefined) }));
jest.mock('@/lib/cloud-auth', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/sign-in', () => ({ signInWithGoogle: jest.fn() }));

// eslint-disable-next-line import/first
import AccountScreen from '@/app/(tabs)/account';
// eslint-disable-next-line import/first
import DictateScreen from '@/app/(tabs)/dictate';
// eslint-disable-next-line import/first
import KeyboardLogScreen from '@/app/keyboard-log';
// eslint-disable-next-line import/first
import KeyboardSessionScreen from '@/app/keyboard-session';
// eslint-disable-next-line import/first
import WelcomeScreen from '@/app/welcome';
// eslint-disable-next-line import/first
import { SESSION_LIMITS_NOTE, SPEAK_FLOW } from '@/lib/keyboard-session';
// eslint-disable-next-line import/first
import { MindMapView, SeekBar, TabChips } from '@/components/wispra/meeting-views';

const iphone: SetupState = { platform: 'ios', signedIn: true, keyboard: { enabled: true, lastSeenAt: null }, bubbleOn: false, waiting: 0 };
const android: SetupState = { platform: 'android', signedIn: true, keyboard: null, bubbleOn: false, waiting: 0 };

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockSaveMinutes.mockClear();
  mockSavedLanguage = 'vi';
  mockLanguageSaves.length = 0;
  mockSessionEnded.length = 0;
  mockLogLines.length = 0;
  mockSessionLoaded = true;
  mockDataLoaded = true;
  mockSignedIn = true;
  mockCloudAllowed = true;
  mockNativeLanguage.length = 0;
  mockStartSession.mockClear();
  mockSetup = iphone;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('Dictate', () => {
  it('shows the mic and nothing about setting up the keyboard, on iPhone and on Android', async () => {
    // Signed out too: no card on Dictate at all (signing in is in Account)
    for (const state of [iphone, android, { ...iphone, signedIn: false, waiting: 2 }]) {
      mockSetup = state;
      const view = await render(<DictateScreen />);
      expect(screen.getByLabelText('Start dictating')).toBeTruthy();
      for (const gone of [/Switch to the Wispra keyboard/, /Dictate into any app/, /Wispra keyboard/, /^Keyboard$/, /Mic button/, /Show me how/, /Open Settings/, /Sign in/]) {
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

describe('the listening session the keyboard mic opens (T-0163)', () => {
  it('starts at once with the length saved in Account, with no length to choose', async () => {
    await render(<KeyboardSessionScreen />);
    expect(mockStartSession.mock.calls).toEqual([[60]]);
    for (const choice of [/^5 min$/, /^15 min$/, /^1 hour$/, /Session length/]) expect(screen.queryByText(choice)).toBeNull();
    // The user did not end it: starting one clears a mark left by an earlier End session
    expect(mockSessionEnded).toEqual([false]);
  });

  it('End session stays ended: Wispra does not start it by itself again until the keyboard asks', async () => {
    await render(<KeyboardSessionScreen />);
    await fireEvent.press(await screen.findByText('End session'));
    expect(mockSessionEnded[mockSessionEnded.length - 1]).toBe(true);
  });

  it('says first how to go back to the app being typed in', async () => {
    await render(<KeyboardSessionScreen />);
    expect(await screen.findByText('Tap ◀ up here to go back to your app')).toBeTruthy();
    // iOS does not always show ◀: the other way back is there too (T-0163 review)
    expect(screen.getByText(/Swipe right along the bottom edge/)).toBeTruthy();
    expect(screen.getByText(/change it in Account/)).toBeTruthy();
  });

  it('is chosen in Account › Listening session, on iPhone only', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<AccountScreen />);
    await fireEvent.press(screen.getByText('Listening session'));
    const buttons = (alert.mock.calls[0]?.[2] ?? []) as { text?: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['1 hour', '4 hours', '12 hours', 'Cancel']);
    await act(async () => buttons[2].onPress?.());
    expect(mockSaveMinutes).toHaveBeenCalledWith(720);
    expect(await screen.findByText('12 hours')).toBeTruthy();
  });

  it('has no listening session row on Android (its keyboard uses the microphone itself)', async () => {
    mockSetup = android;
    await render(<AccountScreen />);
    expect(screen.queryByText('Listening session')).toBeNull();
  });
});

describe('the meeting seek bar (T-0164)', () => {
  it('shows where the recording is and moves 10 seconds at a time for screen readers', async () => {
    const onSeek = jest.fn();
    await render(<SeekBar positionMs={65_000} totalMs={693_000} onSeek={onSeek} />);
    const bar = screen.getByTestId('seek-bar');
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText('11:33')).toBeTruthy();
    await fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSeek.mock.calls).toEqual([[75_000], [55_000]]);
  });
});

describe('the mind map, drawn like the computer’s (T-0164)', () => {
  const map = {
    title: 'Bảo mật web và AI',
    topics: [{ label: 'Phân tích bảo mật', points: [{ label: 'Lộ API SuperPay' }, { label: 'Thiếu captcha' }] }, { label: 'AI quét lỗ hổng' }],
    decisions: [],
    actions: [{ label: 'Gửi NDA' }],
    questions: [],
    branchLabels: { decisions: 'Quyết định', actions: 'Việc cần làm', questions: 'Câu hỏi còn mở' },
  };

  it('draws the centre and the main branches, then every level on All', async () => {
    await render(<MindMapView map={map} />);
    expect(screen.getByTestId('map-node-Bảo mật web và AI')).toBeTruthy();
    expect(screen.getByTestId('map-node-Việc cần làm')).toBeTruthy();
    expect(screen.queryByTestId('map-node-Lộ API SuperPay')).toBeNull();
    await fireEvent.press(screen.getByText('All'));
    expect(screen.getByTestId('map-node-Lộ API SuperPay')).toBeTruthy();
    expect(screen.getByTestId('map-node-Gửi NDA')).toBeTruthy();
  });

  it('opens a branch from its circle, which says how many it holds', async () => {
    await render(<MindMapView map={map} />);
    expect(screen.queryByTestId('map-node-Thiếu captcha')).toBeNull();
    const circle = screen.getByTestId('map-toggle-Phân tích bảo mật');
    expect(circle.props.accessibilityLabel).toBe('Open Phân tích bảo mật (2)');
    await fireEvent.press(circle);
    expect(screen.getByTestId('map-node-Thiếu captcha')).toBeTruthy();
  });
});

describe('the tab row of a meeting (T-0164 review, point 6)', () => {
  it('keeps its height, never shrinks and has its own background, so the content cannot slide over it', async () => {
    const tabs = [
      { value: 'summary', label: 'Summary' },
      { value: 'transcript', label: 'Transcript' },
      { value: 'mindmap', label: 'Mind map' },
      { value: 'post', label: 'Post' },
    ];
    await render(<TabChips tabs={tabs} value="summary" onChange={() => undefined} />);
    const row = StyleSheet.flatten(screen.getByTestId('meeting-tabs').props.style) as Record<string, unknown>;
    expect(row).toMatchObject({ flexGrow: 0, flexShrink: 0, minHeight: 48, backgroundColor: '#0f1117', borderBottomWidth: 1 });
    // The same component is in the meeting being recorded and in a finished one
    for (const label of ['Summary', 'Transcript', 'Mind map', 'Post']) expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('Account › Transcription language (T-0145, W-0311)', () => {
  it('says Vietnamese until another is chosen, and offers Vietnamese, Auto-detect and English', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<AccountScreen />);
    expect(screen.getByText('Transcription')).toBeTruthy();
    expect(screen.getByText('Vietnamese')).toBeTruthy();
    await fireEvent.press(screen.getByText('Language'));
    const buttons = (alert.mock.calls[0]?.[2] ?? []) as { text?: string }[];
    expect(buttons.map((b) => b.text)).toEqual(['Vietnamese ✓', 'Auto-detect', 'English', 'Cancel']);
  });

  it('keeps the choice and tells the Android keyboard and mic button', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<AccountScreen />);
    await fireEvent.press(screen.getByText('Language'));
    const buttons = (alert.mock.calls[0]?.[2] ?? []) as { text?: string; onPress?: () => void }[];
    await act(async () => buttons[1].onPress?.());
    expect(mockLanguageSaves).toEqual(['auto']);
    // The app start told it too (the first entry), then the choice
    expect(mockNativeLanguage[mockNativeLanguage.length - 1]).toBe('auto');
    expect(await screen.findByText('Auto-detect')).toBeTruthy();
  });

  it('is on Android too: the same row', async () => {
    mockSetup = android;
    await render(<AccountScreen />);
    expect(screen.getByText('Language')).toBeTruthy();
  });
});

describe('the first-run guide describes the mic flow the keyboard really has (T-0145 review, point 1)', () => {
  it('step 3 says: purple mic, Wispra opens and listens by itself, go back, purple again, red to finish; no "tap Done"', async () => {
    await render(<WelcomeScreen />);
    // Step 3, in the words both screens share
    expect(screen.getByText(SPEAK_FLOW, { exact: false })).toBeTruthy();
    expect(screen.getByText(/starts listening by itself/)).toBeTruthy();
    expect(screen.getByText(/swipe right along the bottom edge/)).toBeTruthy();
    // The old flow, where words were spoken in Wispra and Done was tapped there, is gone
    expect(screen.queryByText(/tap Done/i)).toBeNull();
    expect(screen.queryByText(/say your text/i)).toBeNull();
  });

  it('is the same flow the listening session screen tells, word for word', async () => {
    const view = await render(<KeyboardSessionScreen />);
    expect(screen.getByText(`Back in your app, ${SPEAK_FLOW}`)).toBeTruthy();
    expect(screen.getByText(/red mic/)).toBeTruthy();
    expect(SPEAK_FLOW).toContain('purple mic');
    expect(SPEAK_FLOW).toContain('red mic');
    await view.unmount();
    await render(<WelcomeScreen />);
    expect(screen.getByText(/Then tap the purple mic/)).toBeTruthy();
  });
});

describe('what iOS does not allow is said plainly (T-0178, point 3)', () => {
  it('the guide and Account both say when Wispra has to open for the mic, and that it starts a session by itself', async () => {
    const view = await render(<WelcomeScreen />);
    expect(screen.getByText(SESSION_LIMITS_NOTE, { exact: false })).toBeTruthy();
    expect(SESSION_LIMITS_NOTE).toMatch(/Apple lets only the app start the microphone/);
    expect(SESSION_LIMITS_NOTE).toMatch(/after you end the session/);
    expect(SESSION_LIMITS_NOTE).toMatch(/after the iPhone restarts/);
    await view.unmount();
    await render(<AccountScreen />);
    expect(screen.getByText(SESSION_LIMITS_NOTE, { exact: false })).toBeTruthy();
  });

  it('Account on Android does not talk about a listening session', async () => {
    mockSetup = android;
    await render(<AccountScreen />);
    expect(screen.queryByText(SESSION_LIMITS_NOTE, { exact: false })).toBeNull();
  });
});

describe("the page the keyboard's mic opens, and the account (T-0182)", () => {
  it('does not say "Sign in first" while the saved sign-in is still being read', async () => {
    mockSessionLoaded = false;
    mockSignedIn = false;
    mockCloudAllowed = false;
    await render(<KeyboardSessionScreen />);
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    expect(screen.queryByText('Sign in first')).toBeNull();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('does not say it while the data on the phone is still being read either', async () => {
    mockDataLoaded = false;
    mockCloudAllowed = false;
    await render(<KeyboardSessionScreen />);
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    expect(screen.queryByText('Sign in first')).toBeNull();
  });

  it('starts the session once the account is there, with no page of sign-in in between', async () => {
    mockSessionLoaded = false;
    mockCloudAllowed = false;
    const view = await render(<KeyboardSessionScreen />);
    expect(screen.queryByText('Sign in first')).toBeNull();
    // The sign-in is read: the page looks again by itself
    mockSessionLoaded = true;
    mockCloudAllowed = true;
    await view.rerender(<KeyboardSessionScreen />);
    expect(screen.queryByText('Sign in first')).toBeNull();
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });

  it('says "Sign in first" only when nobody is signed in', async () => {
    mockSignedIn = false;
    mockCloudAllowed = false;
    await render(<KeyboardSessionScreen />);
    expect(screen.getByText('Sign in first')).toBeTruthy();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it("says what is really waiting when someone is signed in but the phone's data belongs to another account", async () => {
    mockCloudAllowed = false;
    await render(<KeyboardSessionScreen />);
    expect(screen.queryByText('Sign in first')).toBeNull();
    expect(screen.getByText('One question first')).toBeTruthy();
    await fireEvent.press(screen.getByText('Answer the question'));
    expect(mockReplace).toHaveBeenCalledWith('/account-switch');
  });
});

describe('the keyboard log (T-0178)', () => {
  it('Account has a Keyboard log row on iPhone, opening the log; none on Android', async () => {
    await render(<AccountScreen />);
    await fireEvent.press(screen.getByText('Keyboard log'));
    expect(mockPush).toHaveBeenCalledWith('/keyboard-log');
  });

  it('shows what was noted, newest first, with the likely cause on top, and can clear it', async () => {
    mockLogLines.push(
      '06/10 06:05:58 keyboard: purple mic tapped: session live (beat 3 s ago, 238 min left): start',
      '06/10 06:09:00 app: Wispra was started again; the last run ended without ending its session (its last beat was 41 s ago): iOS closed Wispra',
    );
    await render(<KeyboardLogScreen />);
    expect(await screen.findByText('Last sign of a problem')).toBeTruthy();
    expect(screen.getByText(/iOS closed Wispra while its session was on/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Clear'));
    expect(await screen.findByText('Nothing noted yet.')).toBeTruthy();
    expect(mockLogLines).toEqual([]);
  });
});
