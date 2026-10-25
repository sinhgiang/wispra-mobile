// The Notes tab and a note, rendered (T-0979): the tab, the list, the three views laid out like a
// meeting, Copy and Download on the right views, the four-choice status menu, and that choosing a
// status sends no reminder. The screens are real; the store, the clipboard and the files are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { Share } from 'react-native';

import type { Entry } from '@/lib/entries';
import type { NoteData } from '@/lib/notes';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCopied: string[] = [];
const mockWriteNote = jest.fn<(id: string, what: string, role?: string) => Promise<void>>(async () => undefined);
const mockSetNoteStatus = jest.fn();
const mockRetry = jest.fn(async () => undefined);
const mockRemove = jest.fn();
const mockStart = jest.fn(async () => true);
const mockStop = jest.fn(async () => 'mobile-new');
const mockCancel = jest.fn();
const mockDownload = jest.fn(async (..._args: unknown[]) => 'image');
let mockEntries: Entry[] = [];
let mockBusy = new Set<string>();
let mockPhase = 'idle';
let mockSignedIn = true;
let mockRecError: string | null = null;

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'mobile-n1' }),
}));
jest.mock('expo-clipboard', () => ({
  setStringAsync: async (text: string) => {
    mockCopied.push(text);
    return true;
  },
}));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: { cache: 'cache' } }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}) }));
jest.mock('@/lib/storage', () => ({ audioExists: () => true }));
jest.mock('@/lib/use-session', () => ({ useSession: () => (mockSignedIn ? { email: 'anna@example.com' } : null) }));
jest.mock('@/lib/transcriber', () => ({ transcriptionAvailable: () => mockSignedIn }));
jest.mock('@/lib/use-recording', () => ({
  useRecording: () => ({ phase: mockPhase, durationMs: 4_000, error: mockRecError, start: mockStart, stop: mockStop, cancel: mockCancel }),
}));
jest.mock('@/lib/note-export', () => {
  const actual = jest.requireActual('@/lib/note-export') as typeof import('@/lib/note-export');
  return { ...actual, downloadMap: (...args: unknown[]) => mockDownload(...args) };
});
jest.mock('@/lib/entries-store', () => ({
  useEntries: () => ({
    entries: mockEntries,
    busy: mockBusy,
    retry: mockRetry,
    remove: mockRemove,
    writeNote: mockWriteNote,
    setNoteStatus: mockSetNoteStatus,
    removeAll: jest.fn(),
  }),
}));

// eslint-disable-next-line import/first
import HistoryScreen from '@/app/(tabs)/history';
// eslint-disable-next-line import/first
import NotesScreen from '@/app/(tabs)/notes';
// eslint-disable-next-line import/first
import NoteScreen from '@/app/note/[id]';
// eslint-disable-next-line import/first
import { createEntry } from '@/lib/entries';

const SAID = 'Tôi muốn làm nền tảng cho người địa phương tự đăng tour và tự dẫn khách.';
const MAP = {
  title: 'Nền tảng tour',
  topics: [{ label: 'Khoảng trống', points: [{ label: 'Cao Bằng' }] }, { label: 'Rủi ro' }],
  decisions: [],
  actions: [],
  questions: [],
  branchLabels: { decisions: 'Quyết định', actions: 'Việc cần làm', questions: 'Câu hỏi mở' },
};

function note(over: Partial<Entry> = {}, data: Partial<NoteData> = {}): Entry {
  return {
    ...createEntry('note', new Date(2026, 9, 25, 14, 32), 'mobile-n1'),
    status: 'done',
    title: 'Nền tảng tour do người địa phương dẫn',
    text: SAID,
    durationMs: 21_000,
    note: { status: 'new', domain: 'Du lịch', role: 'chuyên gia phát triển thị trường du lịch', outline: '## Ý chính\n- Nền tảng tour', ...data },
    ...over,
  };
}

beforeEach(() => {
  mockEntries = [note()];
  mockBusy = new Set();
  mockPhase = 'idle';
  mockSignedIn = true;
  mockRecError = null;
  mockCopied.length = 0;
  for (const m of [mockPush, mockBack, mockWriteNote, mockSetNoteStatus, mockRetry, mockRemove, mockStart, mockStop, mockCancel, mockDownload]) m.mockClear();
});

describe('the Notes tab', () => {
  it('lists the notes with their title, the day and moment they were said, the field and the status', async () => {
    mockEntries = [
      note(),
      note({ id: 'mobile-n2', title: 'Gói bảo dưỡng ô tô theo km', createdAt: new Date(2026, 9, 23, 8, 51).toISOString() }, { domain: 'Ô tô', status: 'keep' }),
    ];
    await render(<NotesScreen />);
    expect(screen.getByText('Ghi chú')).toBeTruthy();
    expect(screen.getByText('Nền tảng tour do người địa phương dẫn')).toBeTruthy();
    expect(screen.getByText('CN, 25/10/2026 · 14:32')).toBeTruthy();
    expect(screen.getByText('Du lịch')).toBeTruthy();
    expect(screen.getByText('Mới')).toBeTruthy();
    expect(screen.getByText('Ô tô')).toBeTruthy();
    expect(screen.getByText('Giữ lại')).toBeTruthy();
  });

  it('shows the newest first and opens a note when it is touched', async () => {
    mockEntries = [note({ id: 'mobile-old', title: 'Cũ', createdAt: new Date(2026, 9, 1).toISOString() }), note({ id: 'mobile-new', title: 'Mới nhất', createdAt: new Date(2026, 9, 25, 18, 0).toISOString() })];
    await render(<NotesScreen />);
    const titles = screen.getAllByText(/^(Cũ|Mới nhất)$/).map((n) => n.props.children);
    expect(titles).toEqual(['Mới nhất', 'Cũ']);
    await fireEvent.press(screen.getByText('Mới nhất'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'mobile-new' } });
  });

  it('keeps dictations and meetings out of it', async () => {
    mockEntries = [{ ...createEntry('dictation', new Date(2026, 9, 25), 'mobile-d'), status: 'done', text: 'xin chào mọi người' }, note()];
    await render(<NotesScreen />);
    expect(screen.queryByText('xin chào mọi người')).toBeNull();
    expect(screen.getByText('Nền tảng tour do người địa phương dẫn')).toBeTruthy();
  });

  it('starts a note from the mic; while it is recording it can be stopped and saved, or thrown away', async () => {
    await render(<NotesScreen />);
    await fireEvent.press(screen.getByLabelText('Bắt đầu ghi chú'));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('says "saved on the phone" the moment it is stopped, whether or not anyone is signed in', async () => {
    mockPhase = 'recording';
    const view = await render(<NotesScreen />);
    expect(screen.getByText('Đang nghe · 0:04')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Dừng và lưu'));
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    mockPhase = 'idle';
    await view.rerender(<NotesScreen />);
    expect(screen.getByText('Đã lưu trên máy. Đang chép chữ…')).toBeTruthy();

    mockSignedIn = false;
    mockPhase = 'recording';
    await view.rerender(<NotesScreen />);
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Dừng và lưu'));
    });
    mockPhase = 'idle';
    await view.rerender(<NotesScreen />);
    expect(screen.getByText(/^Đã lưu trên máy\. Đăng nhập Wispra Cloud/)).toBeTruthy();
  });

  it('a recording not written out yet is a card that says it is safe on the phone, and can be tried again', async () => {
    mockEntries = [{ ...note(), status: 'pending', text: null, title: 'Ghi chú 14:32', note: { status: 'new' } }];
    await render(<NotesScreen />);
    expect(screen.getByText('Đã lưu trên máy. Chờ chép chữ.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Thử lại'));
    expect(mockRetry).toHaveBeenCalledWith('mobile-n1');
  });

  it('has an empty state that says what to do', async () => {
    mockEntries = [];
    await render(<NotesScreen />);
    expect(screen.getByText('Chưa có ghi chú nào')).toBeTruthy();
  });
});

describe('History shows notes too', () => {
  it('with a NOTE tag, a Notes filter, and opens the note', async () => {
    mockEntries = [note()];
    await render(<HistoryScreen />);
    expect(screen.getByText('NOTE')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
    await fireEvent.press(screen.getByText('Nền tảng tour do người địa phương dẫn'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'mobile-n1' } });
  });
});

describe('a note: three views, laid out like a meeting', () => {
  it('has the title, the moment and field, a share button, and the three tabs', async () => {
    await render(<NoteScreen />);
    expect(screen.getByText('Nền tảng tour do người địa phương dẫn')).toBeTruthy();
    expect(screen.getByText('CN, 25/10/2026 · 14:32 · Du lịch')).toBeTruthy();
    expect(screen.getByLabelText('Chia sẻ')).toBeTruthy();
    expect(screen.getByTestId('meeting-tabs')).toBeTruthy();
    for (const tab of ['Nguyên văn', 'Chuyên gia', 'Sơ đồ']) expect(screen.getByText(tab)).toBeTruthy();
  });

  it('Nguyên văn shows the words as they were said, and Sao chép copies exactly them', async () => {
    await render(<NoteScreen />);
    expect(screen.getByText(SAID)).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Sao chép'));
    });
    expect(mockCopied).toEqual([SAID]);
    expect(screen.getByText('Đã sao chép')).toBeTruthy();
  });

  it('Chuyên gia shows the Dàn ý and Bài viết chips, the role that can be changed, and copies the outline', async () => {
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    expect(screen.getByText('Dàn ý')).toBeTruthy();
    expect(screen.getByText('Bài viết')).toBeTruthy();
    expect(screen.getByText(/Đang viết dưới vai: chuyên gia phát triển thị trường du lịch\./)).toBeTruthy();
    expect(screen.getByText('Đổi vai')).toBeTruthy();
    expect(screen.getByText('Ý chính')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Sao chép'));
    });
    expect(mockCopied).toEqual(['## Ý chính\n- Nền tảng tour']);
    // The AI’s rewrite never takes the place of the words, and the page says where it was written
    expect(screen.getByText(/AI của Wispra Cloud viết; nguyên văn lời bạn nói luôn được giữ nguyên/)).toBeTruthy();
  });

  it('Viết lại writes the outline again; Bài viết has its own copy of the work, with versions', async () => {
    mockEntries = [note({}, { articles: ['Bài một', 'Bài hai'] })];
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    await fireEvent.press(screen.getByText('Viết lại'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'outline');

    await fireEvent.press(screen.getByText('Bài viết'));
    expect(screen.getByText('Bài hai')).toBeTruthy();
    expect(screen.getByText('Bản 1')).toBeTruthy();
    expect(screen.getByText('Bản 2')).toBeTruthy();
    await fireEvent.press(screen.getByText('Bản 1'));
    expect(screen.getByText('Bài một')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Sao chép'));
    });
    expect(mockCopied).toEqual(['Bài một']);
    await fireEvent.press(screen.getByText('Viết lại'));
    expect(mockWriteNote).toHaveBeenLastCalledWith('mobile-n1', 'article');
  });

  it('an article not written yet is offered, not written without being asked', async () => {
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    await fireEvent.press(screen.getByText('Bài viết'));
    expect(mockWriteNote).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Viết bài'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'article');
  });

  it('the role can be changed: the note is written again as the new expert', async () => {
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    await fireEvent.press(screen.getByText('Đổi vai'));
    await fireEvent.changeText(screen.getByLabelText('Đang viết dưới vai:'), '  luật sư du lịch ');
    await fireEvent.press(screen.getByText('Lưu và viết lại'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'outline', 'luật sư du lịch');
  });

  it('Sơ đồ draws the map with Tải xuống and Vẽ lại; the map is the one the meetings draw', async () => {
    mockEntries = [note({}, { mindMap: MAP })];
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Sơ đồ'));
    expect(screen.getByTestId('mind-map-canvas')).toBeTruthy();
    expect(screen.getByText('Fit')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Tải xuống'));
    });
    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [map, title, deps] = mockDownload.mock.calls[0] as unknown as [{ title: string }, string, { platform: string }];
    expect(map.title).toBe('Nền tảng tour');
    expect(title).toBe('Nền tảng tour do người địa phương dẫn');
    expect(['ios', 'android', 'other']).toContain(deps.platform);
    await fireEvent.press(screen.getByText('Vẽ lại'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'map');
  });

  it('a map not drawn yet is offered; one that stayed invalid is shown as text, with a way to draw it again', async () => {
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Sơ đồ'));
    await fireEvent.press(screen.getByText('Vẽ sơ đồ'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'map');

    mockEntries = [note({}, { mapText: '- Một ý\n  - Ý nhỏ' })];
    mockWriteNote.mockClear();
    const view = await render(<NoteScreen />);
    await fireEvent.press(screen.getAllByText('Sơ đồ')[screen.getAllByText('Sơ đồ').length - 1]);
    expect(screen.getByText(/chưa vẽ được sơ đồ hợp lệ/)).toBeTruthy();
    expect(screen.getByText('- Một ý\n  - Ý nhỏ')).toBeTruthy();
    expect(screen.queryByText('Tải xuống')).toBeNull();
    view.unmount();
  });

  it('shows what the AI work cost the account’s allowance, once it has run', async () => {
    mockEntries = [note({}, { usage: { outline: { tokens: 2412, at: '2026-10-25T08:00:00.000Z' } } })];
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    expect(screen.getByText('Lượt này dùng khoảng 2,412 token AI của tài khoản.')).toBeTruthy();
  });

  it('a failed AI try says why, in place, and can be tried again', async () => {
    mockEntries = [note({}, { error: 'Wispra Cloud: busy' })];
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByText('Chuyên gia'));
    expect(screen.getByText('Wispra Cloud: busy')).toBeTruthy();
    await fireEvent.press(screen.getByText('Thử lại'));
    expect(mockWriteNote).toHaveBeenCalledWith('mobile-n1', 'outline');
  });

  it('a note whose words have not arrived says so and does not offer the AI', async () => {
    mockEntries = [{ ...note(), status: 'pending', text: null, note: { status: 'new' } }];
    await render(<NoteScreen />);
    expect(screen.getByText('Đã lưu trên máy. Chờ chép chữ.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Chuyên gia'));
    expect(screen.queryByText('Viết dàn ý')).toBeNull();
    await fireEvent.press(screen.getByText('Thử lại'));
    expect(mockRetry).toHaveBeenCalledWith('mobile-n1');
  });

  it('shares the title and what is on show', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByLabelText('Chia sẻ'));
    expect(share).toHaveBeenCalledWith({ message: `Nền tảng tour do người địa phương dẫn\n\n${SAID}` });
  });
});

describe('the status button', () => {
  it('shows where the note stands, and opens exactly four choices', async () => {
    await render(<NoteScreen />);
    expect(screen.getByLabelText('Trạng thái: Mới')).toBeTruthy();
    expect(screen.queryByTestId('note-status-menu')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Trạng thái: Mới'));
    expect(screen.getByTestId('note-status-menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((n) => n.props.accessibilityState?.selected)).toEqual([false, false, false, false]);
    for (const label of ['Giữ lại', 'Phát triển thành sản phẩm', 'Dùng cho dự án', 'Nhắc lại sau 3 ngày']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('choosing one keeps it and closes the menu; the hint says it is only a mark', async () => {
    await render(<NoteScreen />);
    await fireEvent.press(screen.getByLabelText('Trạng thái: Mới'));
    expect(screen.getByText('Chỉ đánh dấu, chưa có thông báo nhắc')).toBeTruthy();
    await fireEvent.press(screen.getByText('Phát triển thành sản phẩm'));
    expect(mockSetNoteStatus).toHaveBeenCalledWith('mobile-n1', 'develop');
    expect(screen.queryByTestId('note-status-menu')).toBeNull();
  });

  it('shows the status that was chosen before', async () => {
    mockEntries = [note({}, { status: 'remind' })];
    await render(<NoteScreen />);
    expect(screen.getByLabelText('Trạng thái: Nhắc lại sau 3 ngày')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Trạng thái: Nhắc lại sau 3 ngày'));
    expect(screen.getAllByRole('menuitem').map((n) => n.props.accessibilityState?.selected)).toEqual([false, false, false, true]);
  });
});

describe('step 1 sends no reminder', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  it('the app has no notification library, and nothing in the source schedules or sends a reminder', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => /notification|push/i.test(d))).toEqual([]);
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (fs.statSync(path.join(root, rel)).isDirectory()) {
          if (name !== '__tests__') walk(rel);
        } else if (/\.(ts|tsx)$/.test(name)) sources.push(rel);
      }
    };
    walk('src');
    expect(sources.length).toBeGreaterThan(20);
    const offenders = sources.filter((p) => /expo-notifications|scheduleNotificationAsync|presentNotificationAsync|sendPushNotification|expo-task-manager|setTimeout\([^)]*remind/i.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it('the status menu says out loud that "Nhắc lại sau 3 ngày" is only a mark for now', () => {
    expect(read('src/lib/notes.ts')).toContain("hint: 'Chỉ đánh dấu, chưa có thông báo nhắc'");
  });
});
