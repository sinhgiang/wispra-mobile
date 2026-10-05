import { describe, expect, it } from '@jest/globals';

import { existsSync } from 'fs';
import { join } from 'path';

import { otherAppsRows, setupReminders, setupSteps, shouldShowGuide, type SetupState } from '../setup-guide';

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

describe('"Dictate in other apps" in Account (T-0154)', () => {
  const android: SetupState = { ...ownersIphone, platform: 'android', keyboard: null };

  it('on iPhone, the Wispra keyboard opens Settings › Wispra, and the guide stays one tap away', () => {
    const rows = otherAppsRows({ ...ownersIphone, keyboard: { enabled: false, lastSeenAt: null } });
    expect(rows.map((r) => [r.label, r.target])).toEqual([
      ['Wispra keyboard', 'ios-settings'],
      ['Listening session', 'session-length'],
      ['How the keyboard works', '/welcome'],
    ]);
    expect(rows[0]).toMatchObject({ value: 'Turn on', attention: true });
    expect(otherAppsRows(ownersIphone)[0]).toMatchObject({ value: 'On', attention: false });
    // Once the keyboard has been on screen, it says so: how the owner tells it really loads
    expect(otherAppsRows(allSet)[0]).toMatchObject({ value: 'In use', attention: false });
  });

  it('on Android, the keyboard and the mic button each lead to their setup screen', () => {
    expect(otherAppsRows(android).map((r) => [r.label, r.target])).toEqual([
      ['Wispra keyboard', '/keyboard-setup'],
      ['Mic button', '/dictation-setup'],
    ]);
    expect(otherAppsRows(android)[1]).toMatchObject({ value: 'Turn on', attention: true });
    expect(otherAppsRows({ ...android, bubbleOn: true })[1]).toMatchObject({ value: 'On', attention: false });
  });

  it('leads only to screens that exist, so none of them is left without a way in', () => {
    const screens = [...otherAppsRows(ownersIphone), ...otherAppsRows(android)]
      .map((r) => r.target)
      .filter((t) => t !== 'ios-settings' && t !== 'session-length');
    expect(screens.sort()).toEqual(['/dictation-setup', '/keyboard-setup', '/welcome']);
    for (const screen of screens) expect(existsSync(join(__dirname, '..', '..', 'app', `${screen.slice(1)}.tsx`))).toBe(true);
  });
});
