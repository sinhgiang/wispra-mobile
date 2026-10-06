// The word sync as the app runs it (T-0193): when it starts, that a change of the lists is shared once for a
// burst, that two runs never overlap, and what the screens say. The component and the run are real; the cloud
// is a stand-in.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { markWordsChanged, onWordsChanged } from '../lexicon-dirty';
import type { WordsDeps } from '../words-sync';

let mockLoaded = true;
let mockAllowed = true;
let mockSession: { userId: string } | null = { userId: 'u1' };
const mockRuns: string[] = [];

jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ loaded: mockLoaded, cloudAllowed: () => mockAllowed }) }));
jest.mock('@/lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/cloud-auth', () => ({ currentSession: () => mockSession, validToken: async () => 'tok' }));
jest.mock('@/lib/cloud-config', () => ({ cloud: { apiBase: 'https://example.test' } }));
jest.mock('@/lib/storage', () => ({}));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({ noteKeyboardLog: () => undefined }));
// The component calls this; the real one is below, the run is the real one with a fake network
jest.mock('@/lib/words-sync-store', () => {
  const actual = jest.requireActual('@/lib/words-sync-store') as typeof import('@/lib/words-sync-store');
  return {
    ...actual,
    syncWords: (account: () => { userId: string } | null) => {
      mockRuns.push(account()?.userId ?? 'not allowed');
      return Promise.resolve(null);
    },
  };
});

// eslint-disable-next-line import/first
import { WordsSync } from '@/components/wispra/words-sync';
// eslint-disable-next-line import/first
import { WordsSyncLine } from '@/components/wispra/words-sync-line';

beforeEach(() => {
  mockLoaded = true;
  mockAllowed = true;
  mockSession = { userId: 'u1' };
  mockRuns.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('when the words are shared', () => {
  it('as soon as Wispra Cloud may be used for this phone’s data, for the signed-in account', async () => {
    await render(<WordsSync />);
    expect(mockRuns).toEqual(['u1']);
  });

  it('not before: nothing runs while the data is loading, nobody is signed in, or the account question waits', async () => {
    mockLoaded = false;
    const view = await render(<WordsSync />);
    expect(mockRuns).toEqual([]);
    await view.unmount();
    mockLoaded = true;
    mockSession = null;
    const second = await render(<WordsSync />);
    expect(mockRuns).toEqual([]);
    await second.unmount();
    mockSession = { userId: 'u1' };
    mockAllowed = false;
    await render(<WordsSync />);
    expect(mockRuns).toEqual([]);
  });

  it('a burst of changes is one run, a few seconds after the last', async () => {
    await render(<WordsSync />);
    mockRuns.length = 0;
    markWordsChanged();
    markWordsChanged();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      markWordsChanged();
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(mockRuns).toEqual([]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockRuns).toEqual(['u1']);
  });

  it('when the app comes back to the front, and every ten minutes while it is open', async () => {
    let onState: (s: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, l: (s: string) => void) => {
      onState = l;
      return { remove: () => undefined };
    }) as never);
    await render(<WordsSync />);
    mockRuns.length = 0;
    onState('background');
    expect(mockRuns).toEqual([]);
    onState('active');
    expect(mockRuns).toEqual(['u1']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(mockRuns).toHaveLength(2);
  });

  it('stops listening when the screen goes away', async () => {
    const view = await render(<WordsSync />);
    mockRuns.length = 0;
    await view.unmount();
    markWordsChanged();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(mockRuns).toEqual([]);
  });

  it('the saving of the sync itself is quiet: the listeners are told only for the person’s own changes', () => {
    const told: number[] = [];
    const off = onWordsChanged(() => told.push(1));
    markWordsChanged();
    off();
    markWordsChanged();
    expect(told).toEqual([1]);
  });
});

describe('what the screens say about it', () => {
  it('asks to sign in, to answer the account question, or says it is shared', async () => {
    mockSession = null;
    const view = await render(<WordsSyncLine />);
    expect(screen.getByText(/Sign in to Wispra Cloud in Account to share these words/)).toBeTruthy();
    expect(screen.queryByText('Sync now')).toBeNull();
    await view.unmount();
    mockSession = { userId: 'u1' };
    mockAllowed = false;
    const second = await render(<WordsSyncLine />);
    expect(screen.getByText(/Answer the question about your accounts/)).toBeTruthy();
    await second.unmount();
    mockAllowed = true;
    await render(<WordsSyncLine />);
    expect(screen.getByText('Sync now')).toBeTruthy();
  });
});

describe('one run at a time', () => {
  it('a call during a run asks for one more run after it, and never starts two together', async () => {
    jest.useRealTimers();
    const store = jest.requireActual('@/lib/words-sync-store') as typeof import('@/lib/words-sync-store');
    let release: (token: string | null) => void = () => undefined;
    let tokens = 0;
    const deps: WordsDeps = {
      account: () => ({ userId: 'u1' }),
      token: () => {
        tokens++;
        return new Promise<string | null>((resolve) => (release = resolve));
      },
      request: async () => ({ status: 200, json: { vocabulary: { terms: [], updatedAt: null }, lexicon: [] } }),
      loadLocal: () => ({ vocabulary: [], lexicon: [] }),
      saveVocabulary: () => undefined,
      saveLexicon: () => undefined,
      loadSnapshot: () => null,
      saveSnapshot: () => undefined,
      now: () => '2026-10-07T00:00:00.000Z',
      note: () => undefined,
    };
    const first = store.syncWords(() => ({ userId: 'u1' }), deps);
    // A second call while the first waits for its token
    expect(await store.syncWords(() => ({ userId: 'u1' }), deps)).toBeNull();
    expect(tokens).toBe(1);
    release('tok');
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The extra run was made after the first, not beside it
    expect(tokens).toBe(2);
    release('tok');
    await first;
    expect(store.wordsSyncStatus().running).toBe(false);
    expect(store.wordsSyncStatus().at).not.toBeNull();
  });
});
