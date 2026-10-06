// Another account signs in on this phone (T-0193): "Use only the new account" takes what is on the phone away,
// and the words were the previous account's, so they go too; "Merge" keeps them to be shared with the new
// account. The real store runs; the phone's files and the sign-in are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';

import type { Entry } from '@/lib/entries';

const mockCalls: string[] = [];
let mockOwner: { userId: string; email: string } | null = { userId: 'old', email: 'old@example.com' };
let mockEntries: Entry[] = [];

jest.mock('expo-file-system', () => ({ File: class { exists = false; constructor(_uri: string) {} delete() {} } }));
jest.mock('@/lib/storage', () => ({
  loadEntries: () => mockEntries,
  saveEntries: (list: Entry[]) => {
    mockEntries = list;
  },
  loadHidden: () => new Set<string>(),
  saveHidden: () => undefined,
  loadDeletionBook: () => ({}),
  saveDeletionBook: () => undefined,
  loadDataOwner: () => mockOwner,
  saveDataOwner: (o: { userId: string; email: string } | 'unclaimed') => {
    mockOwner = o === 'unclaimed' ? null : o;
  },
  readInbox: () => [],
  clearInbox: () => undefined,
  removeEmptyLeftovers: () => undefined,
  deleteAudio: () => undefined,
  audioExists: () => true,
  loadLexicon: () => [],
  loadVocabulary: () => [],
  loadLearning: () => ({ learning: true, autoLearn: true }),
  loadLearned: () => ({ dismissed: [], styleNotes: '', styleOff: [], autoTerms: [], evalSince: '', evalRecords: [] }),
  saveLexicon: (_l: unknown[], quiet?: boolean) => mockCalls.push(`lexicon cleared:${_l.length === 0} quiet:${quiet}`),
  saveVocabulary: (l: unknown[], quiet?: boolean) => mockCalls.push(`vocabulary cleared:${l.length === 0} quiet:${quiet}`),
  saveWordsSnapshot: (s: unknown) => mockCalls.push(`snapshot ${s === null ? 'forgotten' : 'kept'}`),
  saveLearned: () => mockCalls.push('learned reset'),
}));
jest.mock('@/lib/cloud-auth', () => ({
  currentSession: () => ({ userId: 'new', email: 'new@example.com', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }),
  validToken: async () => 'tok',
  subscribe: () => () => undefined,
}));
jest.mock('@/modules/wispra-dictation', () => ({ canSplitAudio: () => false, splitAudio: jest.fn() }));
jest.mock('@/lib/words-sync-store', () => ({ resetWordsSyncStatus: () => mockCalls.push('status reset') }));

// eslint-disable-next-line import/first
import { EntriesProvider, useEntries } from '@/lib/entries-store';

const dictation: Entry = {
  id: 'mobile-1',
  kind: 'dictation',
  title: 'Dictation',
  createdAt: '2026-10-06T07:00:00.000Z',
  durationMs: 4000,
  status: 'done',
  audioUri: null,
  text: 'Xin chào',
  error: null,
  bookmarks: [],
};

let api: ReturnType<typeof useEntries> | null = null;
function Probe() {
  api = useEntries();
  return null;
}

async function choose(choice: 'merge' | 'new-only') {
  await render(
    <EntriesProvider>
      <Probe />
    </EntriesProvider>,
  );
  const question = api?.accountChoice;
  expect(question).not.toBeNull();
  let result: unknown;
  await act(async () => {
    result = api?.chooseAccount(choice, question?.shownIds ?? []);
  });
  return result;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockOwner = { userId: 'old', email: 'old@example.com' };
  mockEntries = [dictation];
  api = null;
});

describe('another account signs in', () => {
  it('"Use only the new account" takes the words away with the dictations, and forgets what was synced', async () => {
    expect(await choose('new-only')).toBe('done');
    expect(mockCalls).toEqual(
      expect.arrayContaining(['lexicon cleared:true quiet:true', 'vocabulary cleared:true quiet:true', 'snapshot forgotten', 'learned reset', 'status reset']),
    );
  });

  it('"Merge" keeps the words, to be shared with the new account', async () => {
    expect(await choose('merge')).toBe('done');
    expect(mockCalls).toEqual([]);
  });
});
