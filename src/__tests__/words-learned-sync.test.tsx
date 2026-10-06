// What the person does on the Learned screen (Pin, Turn off, taking off a wrong form, Delete), then two rounds of
// the sync with Wispra Cloud (T-0193 review): the change must stay on the phone and reach the cloud, not be put
// back by the cloud's older copy. Nothing here sets a date by hand: the real screen and the real functions do.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LearnedState } from '@/lib/learned/learned';
import { EMPTY_STATE } from '@/lib/learned/learned';
import { Device, FakeCloud, entry } from '@/lib/__fixtures__/words-cloud';

let cloud: FakeCloud;
let phone: Device;
const mockHolder: { phone: Device | null } = { phone: null };
let mockLearned: LearnedState = EMPTY_STATE;

jest.mock('react-native-safe-area-context', () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default);
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/lib/entries-store', () => ({ useEntries: () => ({ entries: [], cloudAllowed: () => true }) }));
jest.mock('@/lib/use-session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/lib/cloud-auth', () => ({ currentSession: () => ({ userId: 'u1' }), validToken: async () => 'good' }));
jest.mock('@/lib/cloud-config', () => ({ cloud: { apiBase: 'https://example.test' } }));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({ noteKeyboardLog: () => undefined }));
// The screen reads and saves through the same lists the sync reads: those of the phone in the test
jest.mock('@/lib/storage', () => ({
  loadLearning: () => ({ learning: true, autoLearn: true }),
  saveLearning: () => undefined,
  loadVocabulary: () => [...(mockHolder.phone as Device).vocabulary],
  loadLexicon: () => (mockHolder.phone as Device).lexicon.map((e) => ({ ...e, heardAs: [...e.heardAs] })),
  saveLexicon: (list: Device['lexicon']) => {
    (mockHolder.phone as Device).lexicon = list;
  },
  loadLearned: () => ({ ...mockLearned }),
  saveLearned: (s: LearnedState) => {
    mockLearned = { ...s };
  },
}));

// eslint-disable-next-line import/first
import LearnedScreen from '@/app/learned';

// Two rounds, as the app does a few seconds after a change and again later
async function twoRounds() {
  await phone.sync();
  await phone.sync();
}

beforeEach(async () => {
  cloud = new FakeCloud();
  phone = new Device(cloud);
  mockHolder.phone = phone;
  mockLearned = EMPTY_STATE;
  // A word already shared: the phone and the cloud have the same copy, the same date
  phone.lexicon = [entry('w1', 'Claude', { heardAs: ['cloud', 'clod'], count: 2, lastSeen: '2026-10-01T00:00:00.000Z' })];
  await phone.sync();
  expect(cloud.lexicon.w1.enabled).toBe(true);
});

describe('a change made on the Learned screen is kept by the sync', () => {
  it('Turn off stays off, on the phone and on the cloud, after two rounds', async () => {
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Turn off'));
    expect(phone.lexicon[0].enabled).toBe(false);
    await twoRounds();
    expect(phone.lexicon[0].enabled).toBe(false);
    expect(cloud.lexicon.w1.enabled).toBe(false);
  });

  it('Pin stays pinned, and Turn on after Turn off stays on', async () => {
    const view = await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Pin'));
    await twoRounds();
    expect(phone.lexicon[0].pinned).toBe(true);
    expect(cloud.lexicon.w1.pinned).toBe(true);
    await fireEvent.press(screen.getByText('Turn off'));
    await twoRounds();
    expect(cloud.lexicon.w1.enabled).toBe(false);
    await view.unmount();
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Turn on'));
    await twoRounds();
    expect(phone.lexicon[0].enabled).toBe(true);
    expect(cloud.lexicon.w1.enabled).toBe(true);
  });

  it('taking off a wrong form takes it off the cloud too, and it does not come back', async () => {
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByLabelText('Stop replacing “cloud”'));
    await twoRounds();
    expect(phone.lexicon[0].heardAs).toEqual(['clod']);
    expect(cloud.lexicon.w1.heardAs).toEqual(['clod']);
  });

  it('Delete removes the word from the cloud, and it does not come back', async () => {
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Delete'));
    await twoRounds();
    expect(phone.lexicon).toEqual([]);
    expect(cloud.lexicon).toEqual({});
  });

  it('the computer’s copy that is equally old does not undo the change, even when the computer syncs in between', async () => {
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Turn off'));
    // The computer writes back what it read (its copy, older than the change), as a computer that only adds does
    const before = { ...cloud.lexicon.w1 };
    await phone.sync();
    cloud.lexicon.w1 = { ...before, ...cloud.lexicon.w1, lastSeen: cloud.lexicon.w1.lastSeen };
    await twoRounds();
    expect(phone.lexicon[0].enabled).toBe(false);
    expect(cloud.lexicon.w1.enabled).toBe(false);
  });

  it('a change made on the other side later wins: the newest decides', async () => {
    await render(<LearnedScreen />);
    await fireEvent.press(screen.getByText('Turn off'));
    await phone.sync();
    // The computer turns it back on afterwards, with a later date
    cloud.lexicon.w1 = { ...cloud.lexicon.w1, enabled: true, lastSeen: '2099-01-01T00:00:00.000Z' };
    await twoRounds();
    expect(phone.lexicon[0].enabled).toBe(true);
  });
});
