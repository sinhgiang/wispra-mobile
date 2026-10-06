// The stack of screens (T-0178 points 1 and 2): iOS 26 takes a drag from anywhere on a screen for the
// "back" swipe, so a finger dragging the Recording bar or the mind map pulled the whole page away.
// The layout is rendered; the stack's options are read from the component the layout really gives them to.
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

import { STACK_SCREEN_OPTIONS } from '@/lib/stack-options';

const mockStackProps: { screenOptions?: Record<string, unknown> }[] = [];

jest.mock('expo-router', () => {
  const { Fragment } = jest.requireActual('react') as typeof import('react');
  return {
    DarkTheme: { colors: {} },
    router: { push: jest.fn() },
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    Stack: Object.assign(
      (props: { screenOptions?: Record<string, unknown>; children?: React.ReactNode }) => {
        mockStackProps.push({ screenOptions: props.screenOptions });
        return props.children ?? null;
      },
      { Screen: () => null, Fragment },
    ),
  };
});
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/lib/cloud-auth', () => ({ loadSession: jest.fn(async () => undefined) }));
jest.mock('@/components/wispra/keyboard-session-bridge', () => ({ KeyboardSessionBridge: () => null }));
jest.mock('@/components/wispra/words-sync', () => ({ WordsSync: () => null }));
jest.mock('@/lib/entries-store', () => ({
  EntriesProvider: ({ children }: { children: React.ReactNode }) => children,
  useEntries: () => ({ loaded: false, accountChoice: null }),
}));
jest.mock('@/lib/use-setup', () => ({ useSetupStateBase: () => ({ state: { platform: 'ios', signedIn: true, keyboard: null, bubbleOn: false, waiting: 0 } }) }));
jest.mock('@/lib/storage', () => ({ guideSeen: () => true, markGuideSeen: jest.fn() }));
jest.mock('@/lib/transcribe-language-store', () => ({ syncTranscribeLanguage: jest.fn() }));

// eslint-disable-next-line import/first
import RootLayout from '@/app/_layout';

describe('the stack of screens', () => {
  it('does not let a drag inside a screen take it back: only the swipe from the left edge does', async () => {
    await render(<RootLayout />);
    const options = mockStackProps[mockStackProps.length - 1]?.screenOptions;
    expect(options).toBe(STACK_SCREEN_OPTIONS);
    expect(options).toMatchObject({ fullScreenGestureEnabled: false });
    // The edge swipe is the screens' own default: never switched off for every screen
    expect(options).not.toHaveProperty('gestureEnabled', false);
  });
});
