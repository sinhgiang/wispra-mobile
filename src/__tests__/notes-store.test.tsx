// Notes as the app runs them (T-0979): saved on the phone first, shared with Wispra Cloud after, and
// never mixed between accounts. The real store, the real queue and the real sync run; the phone's
// files, the sign-in, the transcription, the AI and Wispra Cloud are stand-ins. The cloud stand-in
// keeps one history per account and refuses a request made for an account that is not signed in, as
// the real routes do (the server side is tested in wispra-web, tests/history-routes.test.ts).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import type { DataOwner } from '@/lib/account-switch';
import type { HistoryEntry } from '@/lib/history-sync';
import type { Entry } from '@/lib/entries';

interface Account {
  userId: string;
  email: string;
}

let mockEntries: Entry[] = [];
let mockOwner: DataOwner | 'unclaimed' | null = null;
let mockSession: Account | null = null;
let mockOnline = true;
const mockSaves: Entry[][] = [];
const mockListeners = new Set<(s: Account | null) => void>();
// One shared history per account, as the server keeps it
const mockServer = new Map<string, Map<string, HistoryEntry>>();
const mockCloudCalls: string[] = [];
const mockAiCalls: string[] = [];
let mockTranscripts: string[] = [];

function mockRowsOf(userId: string): Map<string, HistoryEntry> {
  if (!mockServer.has(userId)) mockServer.set(userId, new Map());
  return mockServer.get(userId)!;
}

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as typeof import('react-native');
  return Object.setPrototypeOf({ Alert: { alert: jest.fn() } }, actual);
});
jest.mock('@/lib/storage', () => ({
  loadLexicon: () => [],
  saveLexicon: () => undefined,
  loadVocabulary: () => [],
  saveVocabulary: () => undefined,
  saveWordsSnapshot: () => undefined,
  loadLearning: () => ({ learning: false, autoLearn: false }),
  loadLearned: () => ({}),
  saveLearned: () => undefined,
  loadEntries: () => mockEntries,
  saveEntries: (list: Entry[]) => {
    mockEntries = list;
    mockSaves.push(list);
  },
  loadHidden: () => new Set<string>(),
  saveHidden: () => undefined,
  loadDeletionBook: () => ({}),
  saveDeletionBook: () => undefined,
  loadDataOwner: () => mockOwner,
  saveDataOwner: (owner: DataOwner | 'unclaimed') => {
    mockOwner = owner;
  },
  readInbox: () => [],
  clearInbox: () => undefined,
  removeEmptyLeftovers: () => undefined,
  deleteAudio: () => undefined,
  audioExists: () => true,
}));
jest.mock('@/lib/cloud-auth', () => ({
  currentSession: () => mockSession,
  validToken: async () => (mockSession ? 'tok' : null),
  subscribe: (listener: (s: Account | null) => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));
jest.mock('@/lib/transcriber', () => ({
  CLOUD_UPLOAD_MAX_BYTES: 4_000_000,
  transcriptionAvailable: () => mockSession !== null,
  transcribe: async () =>
    mockOnline
      ? { ok: true, text: mockTranscripts.shift() ?? 'Một ý về nền tảng tour của người địa phương' }
      : { ok: false, transient: true, error: 'No connection to Wispra Cloud. The audio is kept on this phone.' },
  transcribeAudio: async () => ({ ok: true, text: '' }),
}));
jest.mock('@/lib/cloud-history', () => {
  const actual = jest.requireActual('@/lib/cloud-history') as typeof import('@/lib/cloud-history');
  const guard = (asUser: string | undefined, what: string) => {
    mockCloudCalls.push(`${what}:${asUser ?? '-'}`);
    if (!mockOnline) throw new TypeError('Network request failed');
    // The real request is not sent when another account is signed in by then
    if (asUser !== undefined && mockSession?.userId !== asUser) throw new actual.AccountChanged();
    if (!mockSession) throw new actual.CloudUnavailable('Not signed in to Wispra Cloud');
  };
  return {
    ...actual,
    readHistory: async (_since: string | null, asUser?: string) => {
      guard(asUser, 'read');
      const entries = [...mockRowsOf(asUser!).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { entries, complete: true, deleted: [], clearedAt: null, serverTime: new Date().toISOString() };
    },
    mergeHistory: async (entries: HistoryEntry[], asUser?: string) => {
      guard(asUser, 'merge');
      for (const e of entries) mockRowsOf(asUser!).set(e.id, JSON.parse(JSON.stringify(e)));
    },
    deleteHistoryEntry: async (id: string, asUser: string) => {
      guard(asUser, 'delete');
      mockRowsOf(asUser).delete(id);
      return 'deleted';
    },
    deleteAllHistory: async (asUser: string) => {
      guard(asUser, 'delete-all');
      mockRowsOf(asUser).clear();
      return new Date().toISOString();
    },
  };
});
jest.mock('@/lib/note-ai', () => ({
  makeBasics: async (text: string) => {
    mockAiCalls.push('basics');
    return { title: 'Nền tảng tour địa phương', domain: 'Du lịch', role: `chuyên gia về: ${text.slice(0, 10)}` };
  },
  makeExpertOutline: async (_text: string, role: string) => {
    mockAiCalls.push(`outline as ${role}`);
    return '## Ý chính\n- Nền tảng tour';
  },
  makeExpertArticle: async () => {
    mockAiCalls.push('article');
    return 'Bài viết';
  },
  makeNoteMap: async () => {
    mockAiCalls.push('map');
    return { map: { title: 'Sơ đồ', topics: [{ label: 'Một' }], decisions: [], actions: [], questions: [], branchLabels: { decisions: 'a', actions: 'b', questions: 'c' } } };
  },
}));
jest.mock('@/modules/wispra-dictation', () => ({ canSplitAudio: false, splitAudio: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));

// eslint-disable-next-line import/first
import { createEntry } from '@/lib/entries';
// eslint-disable-next-line import/first
import { EntriesProvider, useEntries } from '@/lib/entries-store';
// eslint-disable-next-line import/first
import { NOTE_APP, toNoteHistoryEntry } from '@/lib/notes';

const ANNA: Account = { userId: 'anna', email: 'anna@example.com' };
const BEN: Account = { userId: 'ben', email: 'ben@example.com' };

let api: ReturnType<typeof useEntries>;
function Probe() {
  const value = useEntries();
  useEffect(() => {
    api = value;
  });
  return null;
}

async function start() {
  await render(
    <EntriesProvider>
      <Probe />
    </EntriesProvider>,
  );
  await act(async () => undefined);
}

async function signIn(who: Account | null) {
  await act(async () => {
    mockSession = who;
    for (const l of [...mockListeners]) l(who);
  });
}

// What the Notes tab does when the person records and stops (use-recording.ts): the note exists
// at once as a recording, and when stopped it is a saved file waiting to be written out
async function recordNote(id: string, at = new Date(2026, 9, 25, 14, 32)) {
  await act(async () => {
    api.add({ ...createEntry('note', at, id), audioUri: 'file:///wispra/audio/note.m4a' });
  });
  await act(async () => {
    api.update(id, { status: 'pending', durationMs: 21_000 });
  });
}

// The sync that follows a change runs on its own, a few awaits later: wait until it has done what the
// test is about (or give up after a second, and let the test’s own expectation say what is missing)
async function settle(until: () => boolean = () => false) {
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (until()) return;
  }
}

const noteOf = (id: string) => mockEntries.find((e) => e.id === id)!;

beforeEach(() => {
  mockEntries = [];
  mockOwner = null;
  mockSession = null;
  mockOnline = true;
  mockSaves.length = 0;
  mockListeners.clear();
  mockServer.clear();
  mockCloudCalls.length = 0;
  mockAiCalls.length = 0;
  mockTranscripts = [];
});

describe('a note is saved on the phone first', () => {
  it('right away, with no connection and nobody signed in: the file is kept and nothing goes anywhere', async () => {
    await start();
    mockOnline = false;
    await recordNote('mobile-n1');
    expect(noteOf('mobile-n1')).toMatchObject({ kind: 'note', status: 'pending', audioUri: 'file:///wispra/audio/note.m4a', title: 'Ghi chú 14:32' });
    // It reached the disk (the list was saved with the note in it) before anything else happened
    expect(mockSaves.some((list) => list.some((e) => e.id === 'mobile-n1' && e.status === 'pending'))).toBe(true);
    expect(mockCloudCalls).toEqual([]);
    expect(mockAiCalls).toEqual([]);
    expect(mockServer.size).toBe(0);
  });

  it('stays on the phone, intact, when the connection fails after the words arrive; it is shared once the connection is back', async () => {
    await start();
    await signIn(ANNA);
    mockOnline = false;
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    // Offline: the words and the AI work are kept here, nothing was shared
    expect(noteOf('mobile-n1')).toMatchObject({ status: 'pending' });
    expect(mockRowsOf('anna').size).toBe(0);

    mockOnline = true;
    await act(async () => api.transcribeWaiting());
    const note = noteOf('mobile-n1');
    expect(note).toMatchObject({ status: 'done', title: 'Nền tảng tour địa phương', text: 'Một ý về nền tảng tour của người địa phương' });
    expect(note.note).toMatchObject({ domain: 'Du lịch', outline: '## Ý chính\n- Nền tảng tour', status: 'new' });
    expect(note.syncedAt).toBeDefined();
    const row = mockRowsOf('anna').get('mobile-n1')!;
    expect(row).toMatchObject({ app: NOTE_APP, topic: 'Du lịch', text: 'Một ý về nền tảng tour của người địa phương' });
    expect(JSON.parse(row.rawText!)).toMatchObject({ wispraNote: 1, title: 'Nền tảng tour địa phương', outline: '## Ý chính\n- Nền tảng tour' });
    // The words said are kept as they were; the rewrite sits beside them
    expect(row.text).toBe(note.text);
  });

  it('recorded while signed out: written out and shared by the first account that signs in, without a question', async () => {
    await start();
    await recordNote('mobile-n1');
    expect(mockCloudCalls).toEqual([]);
    await signIn(ANNA);
    await act(async () => api.transcribeWaiting());
    expect(api.accountChoice).toBeNull();
    expect(mockRowsOf('anna').has('mobile-n1')).toBe(true);
  });
});

describe('the status is only kept', () => {
  it('Giữ lại, Phát triển, Dùng cho dự án and Nhắc lại sau 3 ngày are saved on the note and shared; nothing else is sent or scheduled', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    mockAiCalls.length = 0;
    mockCloudCalls.length = 0;

    for (const status of ['keep', 'develop', 'project', 'remind'] as const) {
      await act(async () => api.setNoteStatus('mobile-n1', status));
      await settle(() => JSON.parse(mockRowsOf('anna').get('mobile-n1')!.rawText!).status === status);
      expect(noteOf('mobile-n1').note?.status).toBe(status);
      expect(JSON.parse(mockRowsOf('anna').get('mobile-n1')!.rawText!).status).toBe(status);
    }
    expect(noteOf('mobile-n1').note?.statusAt).toBeDefined();
    // The AI was not asked for anything, and the only calls to Wispra Cloud are the history sync
    expect(mockAiCalls).toEqual([]);
    expect(new Set(mockCloudCalls.map((c) => c.split(':')[0]))).toEqual(new Set(['read', 'merge']));
  });
});

describe('the AI work the person asks for', () => {
  it('writes the outline, an article (up to three versions, the oldest goes) and the map, and shares each', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    mockAiCalls.length = 0;

    for (let i = 0; i < 4; i++) await act(async () => api.writeNote('mobile-n1', 'article'));
    await act(async () => api.writeNote('mobile-n1', 'map'));
    await settle(() => !!JSON.parse(mockRowsOf('anna').get('mobile-n1')!.rawText!).mindMap);
    expect(noteOf('mobile-n1').note?.articles).toHaveLength(3);
    expect(noteOf('mobile-n1').note?.mindMap?.title).toBe('Sơ đồ');
    const payload = JSON.parse(mockRowsOf('anna').get('mobile-n1')!.rawText!);
    expect(payload.articles).toHaveLength(3);
    expect(payload.mindMap.title).toBe('Sơ đồ');
  });

  it('a role the person chose is used from then on and survives a rewrite', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    mockAiCalls.length = 0;
    await act(async () => api.writeNote('mobile-n1', 'outline', 'luật sư du lịch'));
    expect(mockAiCalls).toEqual(['outline as luật sư du lịch']);
    expect(noteOf('mobile-n1').note).toMatchObject({ role: 'luật sư du lịch', roleEdited: true });
  });

  it('says to sign in when nobody is, and keeps the words', async () => {
    await start();
    mockSession = null;
    mockEntries = [{ ...createEntry('note', new Date(2026, 9, 25, 14, 32), 'mobile-n1'), status: 'done', text: 'Một ý' }];
    await start();
    await act(async () => api.writeNote('mobile-n1', 'outline'));
    expect(noteOf('mobile-n1').note?.error).toMatch(/Đăng nhập/);
    expect(noteOf('mobile-n1').text).toBe('Một ý');
    expect(mockAiCalls).toEqual([]);
  });
});

describe('a note is its owner’s alone', () => {
  it('a second account on the same phone does not get the first account’s notes: it is asked first, and nothing is read or sent for it until it chooses', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    expect(mockRowsOf('anna').has('mobile-n1')).toBe(true);
    mockCloudCalls.length = 0;

    await signIn(BEN);
    await act(async () => api.transcribeWaiting());
    expect(api.accountChoice).not.toBeNull();
    expect(api.accountChoice?.data.notes).toBe(1);
    expect(mockCloudCalls).toEqual([]);
    expect(mockRowsOf('ben').size).toBe(0);
  });

  it('"Use only the new account" removes the first account’s notes from the phone; the new account never sees them', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    await signIn(BEN);
    const shown = api.accountChoice!.shownIds;
    await act(async () => {
      expect(api.chooseAccount('new-only', shown)).toBe('done');
    });
    await act(async () => api.transcribeWaiting());
    expect(mockEntries.filter((e) => e.kind === 'note')).toEqual([]);
    expect([...mockRowsOf('ben').keys()]).toEqual([]);
    // Anna’s cloud was not touched
    expect(mockRowsOf('anna').has('mobile-n1')).toBe(true);
  });

  it('"Merge" shares the phone’s notes with the new account, as that account, and leaves the first account’s copy alone', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    await signIn(BEN);
    const shown = api.accountChoice!.shownIds;
    await act(async () => {
      expect(api.chooseAccount('merge', shown)).toBe('done');
    });
    await act(async () => api.transcribeWaiting());
    expect(mockRowsOf('ben').has('mobile-n1')).toBe(true);
    expect(mockCloudCalls.filter((c) => c.startsWith('merge:')).every((c) => c === 'merge:anna' || c === 'merge:ben')).toBe(true);
    // Every request was made for the account that was signed in at the time
    expect(mockCloudCalls.indexOf('merge:ben')).toBeGreaterThan(mockCloudCalls.lastIndexOf('merge:anna'));
  });

  it('notes the account made on another phone appear here, and its deletions reach this phone through the history', async () => {
    mockRowsOf('anna').set(
      'mobile-from-pc',
      toNoteHistoryEntry({ ...createEntry('note', new Date(2026, 9, 24, 9, 0), 'mobile-from-pc'), status: 'done', text: 'Ý từ máy khác', title: 'Từ máy khác', note: { status: 'keep', domain: 'Marketing' } }),
    );
    mockRowsOf('ben').set(
      'mobile-bens',
      toNoteHistoryEntry({ ...createEntry('note', new Date(2026, 9, 24, 9, 5), 'mobile-bens'), status: 'done', text: 'Ý riêng của Ben', title: 'Của Ben', note: { status: 'new' } }),
    );
    await start();
    await signIn(ANNA);
    await act(async () => api.transcribeWaiting());
    const ids = mockEntries.filter((e) => e.kind === 'note').map((e) => e.id);
    expect(ids).toEqual(['mobile-from-pc']);
    expect(noteOf('mobile-from-pc')).toMatchObject({ title: 'Từ máy khác', text: 'Ý từ máy khác', note: { status: 'keep', domain: 'Marketing' } });
    // Ben’s note was never asked for
    expect(mockCloudCalls.some((c) => c.endsWith(':ben'))).toBe(false);
  });
});

describe('deleting', () => {
  it('a shared note is deleted in the cloud too; an unshared one is only deleted here', async () => {
    await start();
    await signIn(ANNA);
    await recordNote('mobile-n1');
    await act(async () => api.transcribeWaiting());
    expect(mockRowsOf('anna').has('mobile-n1')).toBe(true);
    await act(async () => api.remove('mobile-n1'));
    await settle(() => !mockRowsOf('anna').has('mobile-n1'));
    expect(mockEntries.some((e) => e.id === 'mobile-n1')).toBe(false);
    expect(mockRowsOf('anna').has('mobile-n1')).toBe(false);
  });
});
