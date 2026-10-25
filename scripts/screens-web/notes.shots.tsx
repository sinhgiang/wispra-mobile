// Pictures of the Notes screens (T-0979). The real screens and components are drawn with react-native-web
// in a browser-like environment; the store, the recording and the phone's files are stand-ins with sample
// notes. These are NOT iPhone screenshots: fonts and spacing differ a little from the phone.
//
// Writes one HTML file per picture into the folder in WISPRA_SHOTS_DIR (default: ./.screens-web). Open them
// at a phone width (390 x 844) to take the pictures; see README.md in this folder.
import { describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Entry } from '@/lib/entries';
import type { NoteData } from '@/lib/notes';

// The project has no types for react-dom (it is only used here, to draw into a page)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as {
  createRoot(el: Element): { render(node: React.ReactElement): void; unmount(): void };
};

let mockEntries: Entry[] = [];
let mockId = 'mobile-n1';
let mockPhase = 'idle';
const mockBusy = new Set<string>();

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: mockId }),
}));
jest.mock('expo-router/ui', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const { cloneElement } = jest.requireActual('react') as typeof import('react');
  return {
    Tabs: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    TabSlot: () => null,
    TabList: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    // The tab of the screen being drawn is the focused one
    TabTrigger: ({ children, name }: { children: React.ReactElement; name: string }) => cloneElement(children, { isFocused: name === 'notes' } as never),
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: async () => true }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: { cache: 'cache' } }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}) }));
jest.mock('@/lib/storage', () => ({ audioExists: () => true }));
jest.mock('@/lib/use-session', () => ({ useSession: () => ({ email: 'anna@example.com' }) }));
jest.mock('@/lib/transcriber', () => ({ transcriptionAvailable: () => true }));
jest.mock('@/lib/use-recording', () => ({
  useRecording: () => ({ phase: mockPhase, durationMs: 14_000, error: null, start: jest.fn(), stop: jest.fn(), cancel: jest.fn() }),
}));
jest.mock('@/lib/entries-store', () => ({
  useEntries: () => ({
    entries: mockEntries,
    busy: mockBusy,
    retry: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
    writeNote: jest.fn(async () => undefined),
    setNoteStatus: jest.fn(),
  }),
}));

// eslint-disable-next-line import/first
import WispraTabs from '@/app/(tabs)/_layout';
// eslint-disable-next-line import/first
import NotesScreen from '@/app/(tabs)/notes';
// eslint-disable-next-line import/first
import NoteScreen from '@/app/note/[id]';
// eslint-disable-next-line import/first
import { createEntry } from '@/lib/entries';

// There is no layout in this environment, so the pieces that measure themselves (the map's canvas, the
// seek bar) would stay at zero size. Every element that asks to be told its size is told the size it has
// on a 390-point-wide phone.
class FixedSizes {
  observe(node: { __reactLayoutHandler?: (e: unknown) => void; getAttribute?: (n: string) => string | null }): void {
    const canvas = node.getAttribute?.('data-testid') === 'mind-map-canvas';
    const layout = { x: 0, y: 0, left: 0, top: 0, width: canvas ? 350 : 350, height: canvas ? 440 : 40 };
    setTimeout(() => node.__reactLayoutHandler?.({ nativeEvent: { layout }, timeStamp: Date.now() }), 0);
  }
  unobserve(): void {}
  disconnect(): void {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FixedSizes;

const OUT = process.env.WISPRA_SHOTS_DIR ?? path.resolve(process.cwd(), '.screens-web');

const SAID =
  'Mình đang nghĩ tới một nền tảng để người địa phương ở các tỉnh tự đăng tour và tự dẫn khách. Công ty có giấy phép đứng tên tổ chức. Cao Bằng đang có nhiều khách quốc tế nhưng ít tour trên các sàn. Khách hay phàn nàn chuyện hoàn tiền và huỷ sát giờ, nên phải nghĩ kỹ phần thanh toán.';
const OUTLINE = [
  '## Ý chính',
  '- Nền tảng cho người địa phương vùng tỉnh tự đăng tour và tự dẫn khách.',
  '- Công ty có giấy phép đứng tên tổ chức tour.',
  '## Khoảng trống và rủi ro',
  '- Cao Bằng: khách quốc tế tăng nhanh nhưng ít tour trên sàn.',
  '- Hoàn tiền và huỷ sát giờ là điểm khách hay phàn nàn.',
  '## Ba bước đầu',
  '- Hỏi luật sư về mô hình hợp đồng với hướng dẫn viên.',
  '- Thử thu tiền bằng PayPal và cổng thanh toán trong nước.',
  '- Phỏng vấn tám hướng dẫn viên ở Cao Bằng.',
].join('\n');
const MAP = {
  title: 'Nền tảng tour',
  note: 'Người địa phương tự đăng tour và tự dẫn khách.',
  topics: [
    { label: 'Khoảng trống', note: 'Cao Bằng thiếu tour trên sàn.', points: [{ label: 'Cao Bằng', note: 'Khách quốc tế tăng nhanh' }, { label: 'Ít tour trên sàn' }] },
    { label: 'Mô hình', points: [{ label: 'Giấy phép đứng tên công ty' }, { label: 'Hợp đồng hướng dẫn viên' }] },
    { label: 'Rủi ro', points: [{ label: 'Hoàn tiền' }, { label: 'Huỷ sát giờ' }] },
  ],
  decisions: [],
  actions: [{ label: 'Hỏi luật sư' }, { label: 'Phỏng vấn 8 hướng dẫn viên' }],
  questions: [],
  branchLabels: { decisions: 'Quyết định', actions: 'Việc cần làm', questions: 'Câu hỏi mở' },
};

function note(id: string, title: string, at: Date, data: Partial<NoteData>, over: Partial<Entry> = {}): Entry {
  return { ...createEntry('note', at, id), status: 'done', title, text: SAID, durationMs: 21_000, note: { status: 'new', ...data }, ...over };
}

const main = note('mobile-n1', 'Nền tảng tour do người địa phương dẫn', new Date(2026, 9, 25, 14, 32), {
  domain: 'Du lịch',
  role: 'chuyên gia phát triển thị trường du lịch',
  outline: OUTLINE,
  mindMap: MAP,
  usage: { outline: { tokens: 2412, at: '2026-10-25T07:40:00.000Z' } },
});
const LIST: Entry[] = [
  main,
  note('mobile-n2', 'Gói bảo dưỡng ô tô theo km', new Date(2026, 9, 23, 8, 51), { domain: 'Ô tô', status: 'keep' }),
  note('mobile-n3', 'Bản tin theo ngành cho nhà sáng lập', new Date(2026, 9, 22, 19, 20), { domain: 'Marketing' }),
  note('mobile-n4', 'Tính năng tải số liệu cho RepoTrending', new Date(2026, 9, 21, 21, 8), { domain: 'Phần mềm', status: 'develop' }),
];

function page(name: string, css: string, body: string): void {
  fs.mkdirSync(OUT, { recursive: true });
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title>
<style>html,body{margin:0;height:100%;background:#0f1117}#root{display:flex;flex-direction:column;width:390px;height:844px;overflow:hidden;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}</style>
<style id="rnw">${css}</style></head><body><div id="root">${body}</div></body></html>`;
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
}

// A tab screen with the bottom bar under it, as on the phone
function WithBar({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <WispraTabs />
    </View>
  );
}

function textOf(el: Element): string {
  return (el.textContent ?? '').trim();
}

// Presses the control whose own text (or label) is `label`
async function press(container: HTMLElement, label: string): Promise<void> {
  const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
  const hit =
    all.find((el) => el.getAttribute('aria-label') === label) ??
    all.filter((el) => textOf(el) === label).sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
  if (!hit) throw new Error(`No control "${label}"`);
  let target: HTMLElement | null = hit;
  while (target && !target.matches('[role=button],[role=tab],[role=menuitem],[tabindex]')) target = target.parentElement;
  const el = target ?? hit;
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  });
}

async function shot(name: string, element: React.ReactElement, steps: (c: HTMLElement) => Promise<void> = async () => undefined): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex:1;flex-direction:column;height:844px';
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await steps(container);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const sheet = (StyleSheet as unknown as { getSheet(): { textContent: string } }).getSheet();
  page(name, sheet.textContent, container.innerHTML);
  await act(async () => root.unmount());
  container.remove();
}

describe('pictures of the Notes screens', () => {
  it('the list', async () => {
    mockEntries = LIST;
    await shot('1-list', <WithBar><NotesScreen /></WithBar>);
    expect(fs.existsSync(path.join(OUT, '1-list.html'))).toBe(true);
  });

  it('recording, and a note not written out yet', async () => {
    mockEntries = [note('mobile-n5', 'Ghi chú 16:05', new Date(2026, 9, 25, 16, 5), {}, { status: 'pending', text: null }), ...LIST];
    mockPhase = 'recording';
    await shot('2-recording', <WithBar><NotesScreen /></WithBar>);
    mockPhase = 'idle';
  });

  it('a note: the words as said, the expert outline, the status menu, the map', async () => {
    mockEntries = LIST;
    mockId = 'mobile-n1';
    await shot('3-note-verbatim', <NoteScreen />);
    await shot('4-note-expert', <NoteScreen />, async (c) => {
      await press(c, 'Chuyên gia');
    });
    await shot('5-note-menu', <NoteScreen />, async (c) => {
      await press(c, 'Chuyên gia');
      await press(c, 'Trạng thái: Mới');
    });
    await shot('6-note-map', <NoteScreen />, async (c) => {
      await press(c, 'Sơ đồ');
    });
    await shot('7-note-article-empty', <NoteScreen />, async (c) => {
      await press(c, 'Chuyên gia');
      await press(c, 'Bài viết');
    });
  });
});
