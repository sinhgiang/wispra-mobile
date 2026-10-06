// Account › Custom vocabulary and Account › Learned (T-0182), the real screens with the phone's files played
// by memory.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Entry } from '@/lib/entries';
import { EMPTY_STATE, recordDictation, recordFix, type LearnedState } from '@/lib/learned/learned';
import type { LearningSettings } from '@/lib/learning';
import type { LexiconEntry } from '@/lib/lexicon';

// The first render of these screens loads a lot of modules; on a busy CI machine that took more than the
// default 5 s once (the test is fast on a computer)
jest.setTimeout(30_000);

let mockVocabulary: string[] = [];
let mockLexicon: LexiconEntry[] = [];
let mockLearning: LearningSettings = { learning: true, autoLearn: true };
let mockLearned: LearnedState = EMPTY_STATE;
let mockEntries: Entry[] = [];

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ entries: mockEntries }) }));
jest.mock('@/lib/storage', () => ({
  loadLearned: () => ({ ...mockLearned }),
  saveLearned: (s: LearnedState) => {
    mockLearned = { ...s };
  },
  loadVocabulary: () => [...mockVocabulary],
  saveVocabulary: (list: string[]) => {
    mockVocabulary = [...list];
  },
  loadLexicon: () => JSON.parse(JSON.stringify(mockLexicon)),
  saveLexicon: (list: LexiconEntry[]) => {
    mockLexicon = JSON.parse(JSON.stringify(list));
  },
  loadLearning: () => ({ ...mockLearning }),
  saveLearning: (s: LearningSettings) => {
    mockLearning = { ...s };
  },
}));

// eslint-disable-next-line import/first
import LearnedScreen, { ADD_NOTE, AUTO_EMPTY, EVAL_EMPTY, LEARNED_EMPTY, STYLE_EMPTY } from '@/app/learned';
// eslint-disable-next-line import/first
import VocabularyScreen, { VOCABULARY_EMPTY } from '@/app/vocabulary';

const entry = (term: string, heardAs: string[], over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  id: `id-${term}`,
  term,
  heardAs,
  count: 1,
  enabled: true,
  pinned: false,
  source: 'correction',
  createdAt: '2026-10-06T00:00:00.000Z',
  lastSeen: '2026-10-06T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mockVocabulary = [];
  mockLexicon = [];
  mockLearning = { learning: true, autoLearn: true };
  mockLearned = EMPTY_STATE;
  mockEntries = [];
});

describe('Custom vocabulary', () => {
  it('starts empty, adds a term, and removes it', async () => {
    await render(<VocabularyScreen />);
    expect(screen.getByText(VOCABULARY_EMPTY)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Add a word or phrase'), 'Github');
    await fireEvent.press(screen.getByText('Add'));
    expect(mockVocabulary).toEqual(['Github']);
    expect(screen.getByText('Github')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Remove Github'));
    expect(mockVocabulary).toEqual([]);
    expect(screen.getByText(VOCABULARY_EMPTY)).toBeTruthy();
  });

  it('takes the owner’s whole list pasted at once, in order, once each', async () => {
    await render(<VocabularyScreen />);
    await fireEvent.changeText(
      screen.getByLabelText('Add a word or phrase'),
      'Github, Capcut, Timio, Wispra, TikTok, Facebook, MCP, claude, push, Helme, commit, Lenvid, Agent, Dictate, Github',
    );
    await fireEvent.press(screen.getByText('Add'));
    expect(mockVocabulary).toEqual(['Github', 'Capcut', 'Timio', 'Wispra', 'TikTok', 'Facebook', 'MCP', 'claude', 'push', 'Helme', 'commit', 'Lenvid', 'Agent', 'Dictate']);
  });

  it('shows what is saved when it opens, and Add is off for an empty field', async () => {
    mockVocabulary = ['Capcut'];
    await render(<VocabularyScreen />);
    expect(screen.getByText('Capcut')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add'));
    expect(mockVocabulary).toEqual(['Capcut']);
  });
});

describe('Learned', () => {
  it('starts with the empty words, and Add a term makes a word that replaces its wrong forms', async () => {
    await render(<LearnedScreen />);
    expect(screen.getByText(LEARNED_EMPTY)).toBeTruthy();
    expect(screen.getByText(ADD_NOTE)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Correct spelling'), 'Claude Code');
    await fireEvent.changeText(screen.getByLabelText('Often misheard as'), 'Cloud Code, Clod Code');
    await fireEvent.press(screen.getByText('Add'));
    expect(mockLexicon).toHaveLength(1);
    expect(mockLexicon[0]).toMatchObject({ term: 'Claude Code', heardAs: ['Cloud Code', 'Clod Code'], source: 'manual' });
    expect(screen.getByText('Always replace')).toBeTruthy();
    expect(screen.getByText('Added by you')).toBeTruthy();
  });

  it('shows a word learned from one fix as a hint, and a second fix as always replace', async () => {
    mockLexicon = [entry('Claude', ['cloud']), entry('Github', ['git hub'], { count: 2 })];
    await render(<LearnedScreen />);
    expect(screen.getByText('Hint only')).toBeTruthy();
    expect(screen.getByText('Always replace')).toBeTruthy();
    expect(screen.getByText('Fixed 1×')).toBeTruthy();
    expect(screen.getByText('Fixed 2×')).toBeTruthy();
  });

  it('Pin, Turn off, removing a heard-as form and Delete work on the word', async () => {
    mockLexicon = [entry('Claude', ['cloud', 'clod'])];
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Pin'));
    expect(mockLexicon[0].pinned).toBe(true);
    expect(screen.getByText('Unpin')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Stop replacing “cloud”'));
    expect(mockLexicon[0].heardAs).toEqual(['clod']);
    await fireEvent.press(screen.getByText('Turn off'));
    expect(mockLexicon[0].enabled).toBe(false);
    expect(screen.getByText('Off')).toBeTruthy();
    await fireEvent.press(screen.getByText('Turn on'));
    expect(mockLexicon[0].enabled).toBe(true);
    await fireEvent.press(screen.getByText('Delete'));
    expect(mockLexicon).toEqual([]);
    expect(screen.getByText(LEARNED_EMPTY)).toBeTruthy();
  });

  it('Clear all asks twice, and the first click alone clears nothing', async () => {
    mockLexicon = [entry('Claude', ['cloud']), entry('Github', ['git hub'])];
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Clear all'));
    expect(mockLexicon).toHaveLength(2);
    await fireEvent.press(screen.getByText('Click again to clear'));
    expect(mockLexicon).toEqual([]);
  });

  it('the Learn my words switch is saved, and the list is kept while it is off', async () => {
    mockLexicon = [entry('Claude', ['cloud'])];
    await render(<LearnedScreen />);
    await fireEvent(screen.getByLabelText('Learn my words'), 'valueChange', false);
    expect(mockLearning.learning).toBe(false);
    expect(mockLexicon).toHaveLength(1);
  });
});

const dictation = (n: number, text: string, over: Partial<Entry> = {}): Entry => ({
  id: `mobile-${n}`,
  kind: 'dictation',
  title: 'Dictation',
  createdAt: `2026-10-0${(n % 9) + 1}T08:00:00.000Z`,
  durationMs: 4000,
  status: 'done',
  audioUri: null,
  text,
  error: null,
  bookmarks: [],
  ...over,
});

describe('Learned: picked up from History, suggestions, style, statistics (T-0182)', () => {
  const SEEN = [
    dictation(1, 'Hôm nay mình họp với Lumora về kế hoạch quý này'),
    dictation(2, 'Gửi báo cáo cho Lumora trước giờ trưa nhé'),
    dictation(3, 'Anh nhớ hỏi Lumora về hợp đồng mới'),
  ];

  it('says nothing is picked up yet, then lists the name used again and again with why', async () => {
    const empty = await render(<LearnedScreen />);
    expect(screen.getByText(AUTO_EMPTY)).toBeTruthy();
    expect(screen.getByText(EVAL_EMPTY)).toBeTruthy();
    expect(screen.getByText(STYLE_EMPTY)).toBeTruthy();
    await empty.unmount();
    mockEntries = SEEN;
    await render(<LearnedScreen />);
    expect(screen.getByText('Lumora')).toBeTruthy();
    expect(screen.getByText('You used “Lumora” 3× in 3 places.')).toBeTruthy();
  });

  it('Keep makes it one of the person’s words; Remove hides it for good', async () => {
    mockEntries = SEEN;
    const view = await render(<LearnedScreen />);
    await fireEvent.press(screen.getByLabelText('Keep Lumora: make it one of your own words'));
    expect(mockLexicon.map((e) => e.term)).toEqual(['Lumora']);
    await view.unmount();
    mockLexicon = [];
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByLabelText("Remove Lumora: Wispra won't use this word again"));
    expect(mockLearned.dismissed).toEqual(['term:lumora']);
    expect(screen.getByText(AUTO_EMPTY)).toBeTruthy();
  });

  it('Learn my vocabulary from History off hides the picked-up list and keeps the saved lists', async () => {
    mockEntries = SEEN;
    await render(<LearnedScreen />);
    await fireEvent(screen.getByLabelText('Learn my vocabulary from History'), 'valueChange', false);
    expect(mockLearning.autoLearn).toBe(false);
    expect(screen.queryByText(/Picked up from your History/)).toBeNull();
    // The name is then only a suggestion, as on the computer
    expect(screen.getByText(/comes up a lot/)).toBeTruthy();
    // Learning off hides the style and the second switch too
    await fireEvent(screen.getByLabelText('Learn my words'), 'valueChange', false);
    expect(screen.queryByLabelText('Learn my vocabulary from History')).toBeNull();
    expect(screen.queryByText('Your writing style')).toBeNull();
  });

  it('offers a suggestion with the person’s own text, and Yes, replace it adds the word', async () => {
    mockVocabulary = ['Claude Code'];
    mockEntries = [dictation(1, 'Hôm nay mình dùng Cloud Code để viết'), dictation(2, 'Mình thích Cloud Code lắm')];
    await render(<LearnedScreen />);
    expect(screen.getByText(/did you mean/)).toBeTruthy();
    expect(screen.getByText('Seen 2× in 2 places · would be replaced with “Claude Code”')).toBeTruthy();
    await fireEvent.press(screen.getByText('Yes, replace it'));
    expect(mockLexicon[0]).toMatchObject({ term: 'Claude Code', heardAs: ['Cloud Code'], source: 'manual' });
    expect(screen.queryByText('Yes, replace it')).toBeNull();
  });

  it('No on a suggestion hides it for good', async () => {
    mockVocabulary = ['Claude Code'];
    mockEntries = [dictation(1, 'Hôm nay mình dùng Cloud Code để viết'), dictation(2, 'Mình thích Cloud Code lắm')];
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('No'));
    expect(mockLearned.dismissed).toHaveLength(1);
    expect(screen.queryByText('No')).toBeNull();
  });

  it('saves the style notes when the field is left, and shows a habit with its switch', async () => {
    mockEntries = Array.from({ length: 5 }, (_, i) =>
      dictation(i + 1, `Mình sẽ gửi báo cáo ngày ${i + 1}`, { originalText: `Mình sẽ gửi báo cáo ngày ${i + 1}.` }),
    );
    await render(<LearnedScreen />);
    const notes = screen.getByLabelText('Your writing style, in your own words');
    await fireEvent.changeText(notes, 'short sentences');
    await fireEvent(notes, 'blur');
    expect(mockLearned.styleNotes).toBe('short sentences');
    expect(screen.getByText('Do not end the text with a full stop.')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Do not end the text with a full stop.'), 'valueChange', false);
    expect(mockLearned.styleOff).toEqual(['no-final-stop']);
    // Reset style asks twice
    await fireEvent.press(screen.getByText('Reset style'));
    expect(mockLearned.styleNotes).toBe('short sentences');
    await fireEvent.press(screen.getByText('Click again to reset'));
    expect(mockLearned).toMatchObject({ styleNotes: '', styleOff: [] });
  });

  it('shows the statistics once there are dictations, and Reset statistics asks twice', async () => {
    let state = recordDictation(EMPTY_STATE, 100, true, new Date());
    state = recordFix(state, { original: 'a b c d', before: 'a b c d', after: 'a b x d', createdAt: new Date().toISOString(), learning: true });
    mockLearned = state;
    await render(<LearnedScreen />);
    expect(screen.queryByText(EVAL_EMPTY)).toBeNull();
    expect(screen.getAllByText('1.0').length).toBeGreaterThan(0);
    expect(screen.getByText(/appears once you have dictated 200\+ words/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Reset statistics'));
    expect(mockLearned.evalRecords).toHaveLength(1);
    await fireEvent.press(screen.getByText('Click again to reset'));
    expect(mockLearned.evalRecords).toEqual([]);
    expect(screen.getByText(EVAL_EMPTY)).toBeTruthy();
  });
});
