// History › a dictation (T-0179): all of its words, Copy, and Edit that teaches Wispra the fixed words.
// The real screen, the real store and the real transcription run; only the phone's files, its storage,
// the clipboard and the sign-in are stand-ins. The last test is the one that matters to the owner: fix a
// word twice, then dictate again, and the word comes out as it was fixed.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Entry } from '@/lib/entries';
import type { LexiconEntry } from '@/lib/lexicon';

let mockEntries: Entry[] = [];
let mockLexicon: LexiconEntry[] = [];
const mockCopied: string[] = [];
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockAnswerText = ' Tôi dùng Cloud Code mỗi ngày';

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), canGoBack: () => true, replace: jest.fn(), push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ id: 'mobile-1' }),
}));
jest.mock('expo-clipboard', () => ({
  setStringAsync: async (text: string) => {
    mockCopied.push(text);
    return true;
  },
}));
jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  File: class {
    exists = true;
    size = 120_000;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async upload() {
      return {
        status: 200,
        body: JSON.stringify({ segments: [{ text: mockAnswerText, no_speech_prob: 0.01, avg_logprob: -0.2, start: 0, end: 3 }] }),
        headers: {},
      };
    }
  },
}));
// The real reading and writing of the words, kept in memory instead of a file
jest.mock('@/lib/storage', () => ({
  loadLexicon: () => JSON.parse(JSON.stringify(mockLexicon)),
  saveLexicon: (list: LexiconEntry[]) => {
    mockLexicon = JSON.parse(JSON.stringify(list));
  },
  loadTranscribeLanguage: () => 'vi',
  loadEntries: () => mockEntries,
  saveEntries: (list: Entry[]) => {
    mockEntries = list;
  },
  loadHidden: () => new Set<string>(),
  saveHidden: () => undefined,
  loadDeletionBook: () => ({}),
  saveDeletionBook: () => undefined,
  loadDataOwner: () => null,
  saveDataOwner: () => undefined,
  readInbox: () => [],
  clearInbox: () => undefined,
  removeEmptyLeftovers: () => undefined,
  deleteAudio: () => undefined,
  audioExists: () => true,
}));
jest.mock('@/lib/cloud-auth', () => ({
  currentSession: () => null,
  validToken: async () => 'tok',
  subscribe: () => () => undefined,
}));
jest.mock('@/lib/use-session', () => ({ useSession: () => null }));
jest.mock('@/modules/wispra-dictation', () => ({ canSplitAudio: () => false, splitAudio: jest.fn() }));

// eslint-disable-next-line import/first
import EntryScreen, { EDIT_HINT } from '@/app/entry/[id]';
// eslint-disable-next-line import/first
import HistoryScreen from '@/app/(tabs)/history';
// eslint-disable-next-line import/first
import { EntriesProvider, useEntries } from '@/lib/entries-store';
// eslint-disable-next-line import/first
import { transcribeAudio } from '@/lib/transcriber';

const entry = (text: string, over: Partial<Entry> = {}): Entry => ({
  id: 'mobile-1',
  kind: 'dictation',
  title: 'Dictation',
  createdAt: '2026-10-06T07:00:00.000Z',
  durationMs: 5_000,
  status: 'done',
  audioUri: null,
  text,
  error: null,
  bookmarks: [],
  ...over,
});

let api: ReturnType<typeof useEntries> | null = null;
function Probe() {
  api = useEntries();
  return null;
}

async function open(e: Entry, ...others: Entry[]) {
  mockEntries = [e, ...others];
  await render(
    <EntriesProvider>
      <Probe />
      <EntryScreen />
    </EntriesProvider>,
  );
}

const LONG = 'Hôm nay tôi dùng Cloud Code để viết một bản báo cáo khá dài về cuộc họp sáng nay, rồi gửi cho cả nhóm xem trước giờ trưa.';

beforeEach(() => {
  mockEntries = [];
  mockLexicon = [];
  mockCopied.length = 0;
  mockBack.mockClear();
  mockPush.mockClear();
  api = null;
});

describe('opening a dictation', () => {
  it('shows all of its words, not a preview', async () => {
    await open(entry(LONG));
    expect(screen.getByText(LONG)).toBeTruthy();
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('Copy puts the whole text on the clipboard and says Copied', async () => {
    await open(entry(LONG));
    await fireEvent.press(screen.getByText('Copy'));
    expect(mockCopied).toEqual([LONG]);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('says so when the entry is no longer there', async () => {
    mockEntries = [];
    await render(
      <EntriesProvider>
        <EntryScreen />
      </EntriesProvider>,
    );
    expect(screen.getByText('This dictation is no longer here.')).toBeTruthy();
  });
});

describe('History', () => {
  it('opens a dictation with all of its words; a recording not transcribed yet stays as it is', async () => {
    mockEntries = [entry(LONG), entry('', { id: 'mobile-2', status: 'pending', text: null })];
    await render(
      <EntriesProvider>
        <HistoryScreen />
      </EntriesProvider>,
    );
    await fireEvent.press(screen.getByText(/Hôm nay tôi dùng Cloud Code/));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/entry/[id]', params: { id: 'mobile-1' } });
    mockPush.mockClear();
    await fireEvent.press(screen.getByText(/not transcribed yet/));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('editing', () => {
  it('Edit opens the text to change, with the hint; Cancel leaves it as it was', async () => {
    await open(entry(LONG));
    await fireEvent.press(screen.getByText('Edit'));
    expect(screen.getByLabelText('Text of this dictation').props.value).toBe(LONG);
    expect(screen.getByText(EDIT_HINT)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Text of this dictation'), 'something else');
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByText(LONG)).toBeTruthy();
    expect(mockEntries[0].text).toBe(LONG);
  });

  it('Save shows the fixed text, keeps the first one, and tells what was learned', async () => {
    await open(entry(LONG));
    await fireEvent.press(screen.getByText('Edit'));
    await fireEvent.changeText(screen.getByLabelText('Text of this dictation'), LONG.replace('Cloud', 'Claude'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(/^Learned: “Cloud” → “Claude”\./)).toBeTruthy();
    expect(screen.getByText(LONG.replace('Cloud', 'Claude'))).toBeTruthy();
    expect(mockEntries[0]).toMatchObject({ text: LONG.replace('Cloud', 'Claude'), originalText: LONG });
    expect(mockLexicon).toHaveLength(1);
    expect(screen.getByText(/edited/)).toBeTruthy();
    // Copy now copies the fixed text
    await fireEvent.press(screen.getByText('Copy'));
    expect(mockCopied).toEqual([LONG.replace('Cloud', 'Claude')]);
  });

  it('an empty text is refused and nothing is saved', async () => {
    await open(entry(LONG));
    expect(api?.fixEntry('mobile-1', '   ')).toEqual({ ok: false, error: 'The text cannot be empty.' });
    expect(mockEntries[0].text).toBe(LONG);
  });

  it('Save is off while the text is empty', async () => {
    await open(entry(LONG));
    await fireEvent.press(screen.getByText('Edit'));
    await fireEvent.changeText(screen.getByLabelText('Text of this dictation'), '   ');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockEntries[0].text).toBe(LONG);
    expect(mockEntries[0].originalText).toBeUndefined();
  });

  it('a change of punctuation only is saved and says no word corrections were found', async () => {
    await open(entry('xin chào các bạn'));
    await fireEvent.press(screen.getByText('Edit'));
    await fireEvent.changeText(screen.getByLabelText('Text of this dictation'), 'Xin chào, các bạn.');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Saved. No word corrections detected.')).toBeTruthy();
    expect(mockLexicon).toEqual([]);
  });

  it('an entry that is gone cannot be fixed', async () => {
    await open(entry(LONG));
    expect(api?.fixEntry('nope', 'x')).toEqual({ ok: false, error: 'That entry no longer exists.' });
  });
});

describe('the next dictation uses what was fixed (through the real transcription)', () => {
  it('after the same fix twice, Cloud is written Claude; after once, it is only remembered', async () => {
    await open(entry('Tôi dùng Cloud Code mỗi ngày'), entry('Viết bằng Cloud Code', { id: 'mobile-2' }));
    // Once
    await act(async () => {
      api?.fixEntry('mobile-1', 'Tôi dùng Claude Code mỗi ngày');
    });
    expect(mockLexicon[0].count).toBe(1);
    expect(await transcribeAudio('file:///a.m4a', 3_000)).toEqual({ ok: true, text: 'Tôi dùng Cloud Code mỗi ngày' });
    // Twice, on another dictation
    await act(async () => {
      api?.fixEntry('mobile-2', 'Viết bằng Claude Code');
    });
    expect(mockLexicon[0].count).toBe(2);
    expect(await transcribeAudio('file:///b.m4a', 3_000)).toEqual({ ok: true, text: 'Tôi dùng Claude Code mỗi ngày' });
  });
});
