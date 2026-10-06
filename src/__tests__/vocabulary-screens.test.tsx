// Account › Custom vocabulary and Account › Learned (T-0182), the real screens with the phone's files played
// by memory.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LearningSettings } from '@/lib/learning';
import type { LexiconEntry } from '@/lib/lexicon';

let mockVocabulary: string[] = [];
let mockLexicon: LexiconEntry[] = [];
let mockLearning: LearningSettings = { learning: true, autoLearn: true };

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/lib/storage', () => ({
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
import LearnedScreen, { ADD_NOTE, LEARNED_EMPTY } from '@/app/learned';
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
