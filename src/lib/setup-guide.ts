// Getting set up (T-0145): the first-run guide and the reminders on Dictate and Meetings. On
// iPhone, dictating into other apps only works through the Wispra keyboard, and nothing is turned
// into text before signing in to Wispra Cloud, so the app says plainly what is missing and leads
// there. Pure functions; the screens read the state and show what comes out.

import { DEFAULT_SESSION_MINUTES, sessionLabel } from './keyboard-session';

export type SetupPlatform = 'ios' | 'android';

export interface SetupState {
  platform: SetupPlatform;
  signedIn: boolean;
  // iPhone: the Wispra keyboard (null on Android or when unknown)
  keyboard: { enabled: boolean | null; lastSeenAt: number | null } | null;
  // Android: the mic button over other apps
  bubbleOn: boolean;
  // Recordings waiting to be turned into text
  waiting: number;
}

export type StepId = 'sign-in' | 'add-keyboard' | 'switch-keyboard' | 'mic-button';

export interface SetupStep {
  id: StepId;
  done: boolean;
}

// The keyboard counts as added when iOS lists it, or when it has been on screen already
function keyboardAdded(state: SetupState): boolean {
  return state.keyboard?.enabled === true || state.keyboard?.lastSeenAt != null;
}

function keyboardUsed(state: SetupState): boolean {
  return state.keyboard?.lastSeenAt != null;
}

export function setupSteps(state: SetupState): SetupStep[] {
  const signIn = { id: 'sign-in' as const, done: state.signedIn };
  if (state.platform === 'android') return [signIn, { id: 'mic-button', done: state.bubbleOn }];
  return [signIn, { id: 'add-keyboard', done: keyboardAdded(state) }, { id: 'switch-keyboard', done: keyboardUsed(state) }];
}

// The guide opens by itself once, the first time Wispra starts, unless everything is already set up
export function shouldShowGuide(seen: boolean, state: SetupState): boolean {
  return !seen && setupSteps(state).some((s) => !s.done);
}

export type ReminderTarget = 'sign-in' | 'guide';

export interface Reminder {
  id: StepId;
  title: string;
  body: string;
  action: { label: string; target: ReminderTarget };
}

function recordings(n: number): string {
  return `${n} recording${n === 1 ? '' : 's'}`;
}

// What is missing, said where it matters: the sign-in on Meetings. Dictate shows no cards at all
// (the owner, T-0154): the keyboard (iPhone) and the mic button (Android) are small rows in Account
// (otherAppsRows), next to the sign-in.
export function setupReminders(state: SetupState): Reminder[] {
  const out: Reminder[] = [];
  if (!state.signedIn) {
    out.push({
      id: 'sign-in',
      title: 'Sign in to turn speech into text',
      body:
        state.waiting > 0
          ? `${recordings(state.waiting)} ${state.waiting === 1 ? 'is' : 'are'} waiting. Wispra keeps the audio on this phone and turns it into text once you sign in to Wispra Cloud.`
          : 'Wispra turns what you say into text with Wispra Cloud. Sign in once with Google; until then recordings wait on this phone.',
      action: { label: 'Sign in with Google', target: 'sign-in' },
    });
  }
  return out;
}

// Where a row of "Dictate in other apps" leads: iPhone's Settings page of Wispra (where its keyboard
// is turned on), the choice of the listening session's length, or a screen of the app
export type OtherAppsTarget = 'ios-settings' | 'session-length' | '/welcome' | '/keyboard-log' | '/keyboard-setup' | '/dictation-setup';

export interface OtherAppsRow {
  id: 'keyboard' | 'session-length' | 'keyboard-guide' | 'keyboard-log' | 'mic-button';
  label: string;
  // On / Turn on, when the app knows; nothing when it cannot tell
  value: string | null;
  // Something is still to set up: the row shows a dot
  attention: boolean;
  target: OtherAppsTarget;
  accessibilityLabel: string;
}

// Dictating into other apps, as small rows in Account (T-0154: the owner wants none of it on
// Dictate). iPhone: the Wispra keyboard opens Settings › Wispra straight away, the listening
// session's length is chosen here once (T-0163: never each time the mic opens Wispra), and the guide
// stays one tap away. Android: the Wispra keyboard and the mic button, each to its own setup screen
// (Android keyboards use the microphone themselves: no session there).
export function otherAppsRows(state: SetupState, sessionMinutes: number = DEFAULT_SESSION_MINUTES): OtherAppsRow[] {
  if (state.platform === 'ios') {
    const added = keyboardAdded(state);
    // In use: it has been on screen (it notes when, with full access). On but never on screen after
    // switching to it means iOS did not get to show it.
    return [
      {
        id: 'keyboard',
        label: 'Wispra keyboard',
        value: keyboardUsed(state) ? 'In use' : added ? 'On' : 'Turn on',
        attention: !added,
        target: 'ios-settings',
        accessibilityLabel: 'Wispra keyboard: opens Settings, Wispra, Keyboards',
      },
      {
        id: 'session-length',
        label: 'Listening session',
        value: sessionLabel(sessionMinutes),
        attention: false,
        target: 'session-length',
        accessibilityLabel: `The keyboard's listening session lasts ${sessionLabel(sessionMinutes)}. Change it`,
      },
      {
        id: 'keyboard-guide',
        label: 'How the keyboard works',
        value: null,
        attention: false,
        target: '/welcome',
        accessibilityLabel: 'How the Wispra keyboard works',
      },
      {
        id: 'keyboard-log',
        label: 'Keyboard log',
        value: null,
        attention: false,
        target: '/keyboard-log',
        accessibilityLabel: 'Keyboard log: what Wispra and its keyboard noted, to find out why the keyboard does not work in an app',
      },
    ];
  }
  return [
    {
      id: 'keyboard',
      label: 'Wispra keyboard',
      value: null,
      attention: false,
      target: '/keyboard-setup',
      accessibilityLabel: 'Wispra keyboard: turn it on and choose it',
    },
    {
      id: 'mic-button',
      label: 'Mic button',
      value: state.bubbleOn ? 'On' : 'Turn on',
      attention: !state.bubbleOn,
      target: '/dictation-setup',
      accessibilityLabel: state.bubbleOn ? 'Wispra mic button settings' : 'Set up the Wispra mic button to dictate in any app',
    },
  ];
}
