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
let mockTab = 'notes';
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
    TabTrigger: ({ children, name }: { children: React.ReactElement; name: string }) => cloneElement(children, { isFocused: name === mockTab } as never),
  };
});
jest.mock('@/components/wispra/setup-reminders', () => ({ SetupReminders: () => null }));
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
    makeNotes: jest.fn(),
    updateNotes: jest.fn(),
    makeMindMapFor: jest.fn(),
    makeContentFor: jest.fn(),
    ask: jest.fn(),
  }),
}));

// eslint-disable-next-line import/first
import WispraTabs from '@/app/(tabs)/_layout';
// eslint-disable-next-line import/first
import HistoryScreen from '@/app/(tabs)/history';
// eslint-disable-next-line import/first
import MeetingsScreen from '@/app/(tabs)/meetings';
// eslint-disable-next-line import/first
import NotesScreen from '@/app/(tabs)/notes';
// eslint-disable-next-line import/first
import MeetingScreen from '@/app/meeting/[id]';
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
  'I keep thinking about a platform where local people in the provinces list their own tours and guide their own guests. The company holds the licence and is the named organiser. Cao Bang gets a lot of foreign visitors but there are almost no tours on the big sites. Guests complain about refunds and last-minute cancellations, so payments need real thought.';
const OUTLINE = [
  '## Main idea',
  '- A platform for local people in the provinces to list tours and guide their own guests.',
  '- The company holds the licence and is the named organiser of each tour.',
  '## Gaps and risks',
  '- Cao Bang: foreign visitors are growing fast, but few tours are listed.',
  '- Refunds and late cancellations are what guests complain about most.',
  '## First three steps',
  '- Ask a lawyer about the contract model for guides.',
  '- Try collecting payments with PayPal and a local gateway.',
  '- Interview eight guides in Cao Bang.',
].join('\n');
const MAP = {
  title: 'Local tour platform',
  note: 'Local people list tours and guide their own guests.',
  topics: [
    { label: 'Gaps', note: 'Few tours listed in Cao Bang.', points: [{ label: 'Cao Bang', note: 'Foreign visitors growing' }, { label: 'Few tours listed' }] },
    { label: 'Model', points: [{ label: 'Licence in company name' }, { label: 'Guide contracts' }] },
    { label: 'Risks', points: [{ label: 'Refunds' }, { label: 'Late cancellations' }] },
  ],
  decisions: [],
  actions: [{ label: 'Ask a lawyer' }, { label: 'Interview 8 guides' }],
  questions: [],
  branchLabels: { decisions: 'Decisions', actions: 'Action items', questions: 'Open questions' },
};

function note(id: string, title: string, at: Date, data: Partial<NoteData>, over: Partial<Entry> = {}): Entry {
  return { ...createEntry('note', at, id), status: 'done', title, text: SAID, durationMs: 21_000, note: { status: 'new', ...data }, ...over };
}

const main = note('mobile-n1', 'Local tour platform', new Date(2026, 9, 25, 14, 32), {
  domain: 'Travel',
  role: 'a travel-market development expert',
  outline: OUTLINE,
  mindMap: MAP,
  usage: { outline: { tokens: 2412, at: '2026-10-25T07:40:00.000Z' } },
});
const LIST: Entry[] = [
  main,
  note('mobile-n2', 'Car service plan by mileage', new Date(2026, 9, 23, 8, 51), { domain: 'Cars', status: 'keep' }, { text: 'A service plan priced by kilometres instead of by visit, with one price list shown before the car goes in.' }),
  note('mobile-n3', 'Industry newsletter for founders', new Date(2026, 9, 22, 19, 20), { domain: 'Marketing' }, { text: 'A weekly newsletter per industry, written for founders who have no time to read the news themselves.' }),
  note('mobile-n4', 'Data export for RepoTrending', new Date(2026, 9, 21, 21, 8), { domain: 'Software', status: 'develop' }, { text: 'Let people download the trending numbers as a file, with the date range they choose.' }),
];

const MEETING_NOTES = {
  summary: 'The team agreed to ship the new pricing page next week.\n\n## Pricing\n- Three plans, monthly and yearly.\n- The free plan keeps its current limits.\n\n## Next steps\n- Draft the page copy and review it on Friday.',
  actions: [{ text: 'Draft the pricing page copy', owner: 'Mia', due: 'Friday' }, { text: 'Check the yearly discount', owner: 'Tom' }],
  topics: [{ title: 'Pricing page', startMs: 0 }, { title: 'Launch plan', startMs: 120_000 }],
};
const MEETINGS: Entry[] = [
  { ...createEntry('meeting', new Date(2026, 9, 24, 10, 0), 'mobile-m1'), status: 'done', title: 'Pricing page review', durationMs: 1_820_000, text: 'We talked about the pricing page.', notes: MEETING_NOTES },
  { ...createEntry('meeting', new Date(2026, 9, 22, 15, 30), 'mobile-m2'), status: 'done', title: 'Weekly sync', durationMs: 960_000, text: 'Weekly sync.', notes: { summary: 'Short sync.', actions: [{ text: 'Send the notes' }] } },
];
const DICTATIONS: Entry[] = [
  { ...createEntry('dictation', new Date(2026, 9, 25, 9, 12), 'mobile-d1'), status: 'done', title: 'Notes', text: 'Remind the supplier about the invoice before Friday.', durationMs: 6_000 },
  { ...createEntry('dictation', new Date(2026, 9, 25, 8, 40), 'mobile-d2'), status: 'done', title: 'Wispra (phone)', text: 'Book the table for Saturday at seven.', durationMs: 4_000 },
];

// react-native-web draws a Pressable as a <button>, and a Pressable inside a Pressable (the buttons of a
// "not transcribed yet" card) is a <button> inside a <button>: fine on the phone, but a browser reading the
// saved page repairs it and the card falls apart. Where that happens, the buttons become plain boxes.
function flattenNestedButtons(html: string): string {
  let depth = 0;
  let nested = false;
  for (const m of html.matchAll(/<button(?![a-z])|<[/]button>/g)) {
    if (m[0] === '</button>') depth -= 1;
    else {
      depth += 1;
      if (depth > 1) nested = true;
    }
  }
  return nested ? html.replace(/<button(?![a-z])/g, '<div').replace(/<[/]button>/g, '</div>').replace(/ type="button"/g, '') : html;
}

function page(name: string, css: string, rawBody: string): void {
  const body = flattenNestedButtons(rawBody);
  fs.mkdirSync(OUT, { recursive: true });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title>
<style>html,body{margin:0;height:100%;background:#0f1117}#root{display:flex;flex-direction:column;width:100vw;height:100vh;overflow:hidden;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}</style>
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

// The page is drawn in jsdom, which drops the "-webkit-line-clamp" that numberOfLines becomes: read it back
// from the React props and write it into the style attribute, so the picture cuts long text as the phone does
function keepLineClamps(container: HTMLElement): void {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const clamp = key ? ((el as unknown as Record<string, { style?: { WebkitLineClamp?: number } }>)[key]?.style?.WebkitLineClamp ?? null) : null;
    if (clamp) el.setAttribute('style', `${el.getAttribute('style') ?? ''};-webkit-line-clamp:${clamp}`);
  }
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
  keepLineClamps(container);
  const sheet = (StyleSheet as unknown as { getSheet(): { textContent: string } }).getSheet();
  page(name, sheet.textContent, container.innerHTML);
  await act(async () => root.unmount());
  container.remove();
}

describe('pictures of the Notes screens, with Meetings and History beside them', () => {
  it('the three tabs in the same frame', async () => {
    mockEntries = [...MEETINGS, ...LIST, ...DICTATIONS];
    mockTab = 'meetings';
    await shot('1-meetings', <WithBar><MeetingsScreen /></WithBar>);
    mockTab = 'notes';
    await shot('2-notes', <WithBar><NotesScreen /></WithBar>);
    mockTab = 'history';
    await shot('3-history', <WithBar><HistoryScreen /></WithBar>);
    mockTab = 'notes';
    expect(fs.existsSync(path.join(OUT, '2-notes.html'))).toBe(true);
  });

  it('recording, and a note not written out yet', async () => {
    mockEntries = [note('mobile-n5', 'Note 16:05', new Date(2026, 9, 25, 16, 5), {}, { status: 'pending', text: null }), ...LIST];
    mockPhase = 'recording';
    await shot('4-notes-recording', <WithBar><NotesScreen /></WithBar>);
    mockPhase = 'idle';
  });

  it('a meeting beside a note: the words as said, the expert outline, the status menu, the mind map', async () => {
    mockEntries = [...MEETINGS, ...LIST];
    mockId = 'mobile-m1';
    await shot('5-meeting', <MeetingScreen />);
    mockId = 'mobile-n1';
    await shot('6-note-original', <NoteScreen />);
    await shot('7-note-expert', <NoteScreen />, async (c) => {
      await press(c, 'Expert');
    });
    await shot('8-note-menu', <NoteScreen />, async (c) => {
      await press(c, 'Expert');
      await press(c, 'Status: New');
    });
    await shot('9-note-mind-map', <NoteScreen />, async (c) => {
      await press(c, 'Mind map');
    });
    await shot('10-note-post-empty', <NoteScreen />, async (c) => {
      await press(c, 'Expert');
      await press(c, 'Post');
    });
  });
});
