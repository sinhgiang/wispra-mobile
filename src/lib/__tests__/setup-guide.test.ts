import { describe, expect, it } from '@jest/globals';

import { anyAppButton, setupReminders, setupSteps, shouldShowGuide, type SetupState } from '../setup-guide';

// The owner's first try on iPhone: not signed in, keyboard turned on in Settings, never switched to
const ownersIphone: SetupState = {
  platform: 'ios',
  signedIn: false,
  keyboard: { enabled: true, lastSeenAt: null },
  bubbleOn: false,
  waiting: 3,
};
const allSet: SetupState = { ...ownersIphone, signedIn: true, keyboard: { enabled: true, lastSeenAt: 1_759_640_000_000 }, waiting: 0 };

describe('the first-run guide', () => {
  it('has three steps on iPhone: sign in, add the keyboard, switch to it with the globe key', () => {
    expect(setupSteps(ownersIphone)).toEqual([
      { id: 'sign-in', done: false },
      { id: 'add-keyboard', done: true },
      { id: 'switch-keyboard', done: false },
    ]);
  });

  it('counts the keyboard as added once it has been on screen, even when iOS does not list it', () => {
    const steps = setupSteps({ ...ownersIphone, keyboard: { enabled: null, lastSeenAt: 1 } });
    expect(steps.map((s) => s.done)).toEqual([false, true, true]);
  });

  it('has sign-in and the mic button on Android', () => {
    expect(setupSteps({ ...ownersIphone, platform: 'android', keyboard: null, bubbleOn: true })).toEqual([
      { id: 'sign-in', done: false },
      { id: 'mic-button', done: true },
    ]);
  });

  it('opens once by itself, and not when everything is set up', () => {
    expect(shouldShowGuide(false, ownersIphone)).toBe(true);
    expect(shouldShowGuide(true, ownersIphone)).toBe(false);
    expect(shouldShowGuide(false, allSet)).toBe(false);
  });
});

describe('the reminders on Dictate and Meetings', () => {
  it('asks to sign in first, saying how many recordings wait', () => {
    const [first] = setupReminders(ownersIphone, 'dictate');
    expect(first.id).toBe('sign-in');
    expect(first.body).toContain('3 recordings are waiting');
    expect(first.action).toEqual({ label: 'Sign in with Google', target: 'sign-in' });
  });

  it('on Dictate, only the sign-in: no big keyboard card any more (T-0154)', () => {
    expect(setupReminders(ownersIphone, 'dictate').map((r) => r.id)).toEqual(['sign-in']);
    expect(setupReminders({ ...ownersIphone, signedIn: true, keyboard: { enabled: false, lastSeenAt: null } }, 'dictate')).toEqual([]);
  });

  it('on Meetings, only the sign-in matters', () => {
    expect(setupReminders(ownersIphone, 'meetings').map((r) => r.id)).toEqual(['sign-in']);
    expect(setupReminders({ ...ownersIphone, signedIn: true }, 'meetings')).toEqual([]);
  });

  it('says nothing once everything is set up, and no keyboard reminders on Android', () => {
    expect(setupReminders(allSet, 'dictate')).toEqual([]);
    expect(setupReminders({ ...allSet, platform: 'android', keyboard: null }, 'dictate')).toEqual([]);
  });

  it('uses the singular for one waiting recording, and a general line when none waits', () => {
    expect(setupReminders({ ...ownersIphone, waiting: 1 }, 'meetings')[0].body).toContain('1 recording is waiting');
    expect(setupReminders({ ...ownersIphone, waiting: 0 }, 'meetings')[0].body).toContain('Sign in once with Google');
  });
});

describe('the small button at the top of Dictate', () => {
  it('on iPhone, leads to the keyboard guide, with a dot until the keyboard is on and used', () => {
    expect(anyAppButton(ownersIphone)).toMatchObject({ label: 'Keyboard', attention: true, target: 'guide' });
    expect(anyAppButton({ ...ownersIphone, keyboard: { enabled: false, lastSeenAt: null } }).attention).toBe(true);
    expect(anyAppButton(allSet)).toMatchObject({ label: 'Keyboard', attention: false, target: 'guide' });
  });

  it('on Android, leads to the mic button setup, with a dot while it is off', () => {
    const android: SetupState = { ...ownersIphone, platform: 'android', keyboard: null };
    expect(anyAppButton(android)).toMatchObject({ label: 'Mic button', attention: true, target: 'mic-setup' });
    expect(anyAppButton({ ...android, bubbleOn: true }).attention).toBe(false);
  });

  it('says what it does to screen readers', () => {
    expect(anyAppButton(ownersIphone).accessibilityLabel).toBe('Set up the Wispra keyboard to dictate in any app');
  });
});
