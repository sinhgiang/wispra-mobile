// Getting set up (T-0145): the first-run guide and the reminders on Dictate and Meetings. On
// iPhone, dictating into other apps only works through the Wispra keyboard, and nothing is turned
// into text before signing in to Wispra Cloud, so the app says plainly what is missing and leads
// there. Pure functions; the screens read the state and show what comes out.

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

// What is missing, said where it matters: the sign-in on Dictate and Meetings. The keyboard (iPhone)
// and the mic button (Android) are behind the small button at the top of Dictate (anyAppButton),
// so the tab keeps only the mic and the recent dictations (T-0154).
export function setupReminders(state: SetupState, screen: 'dictate' | 'meetings'): Reminder[] {
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

export interface AnyAppButton {
  label: string;
  // Something is still to set up: the button shows a dot
  attention: boolean;
  // iPhone: the guide (keyboard); Android: the mic button's setup
  target: 'guide' | 'mic-setup';
  accessibilityLabel: string;
}

// The small button at the top of Dictate that leads to dictating into other apps
export function anyAppButton(state: SetupState): AnyAppButton {
  if (state.platform === 'ios') {
    const ready = keyboardAdded(state) && keyboardUsed(state);
    return {
      label: 'Keyboard',
      attention: !ready,
      target: 'guide',
      accessibilityLabel: ready ? 'Wispra keyboard: how to use it' : 'Set up the Wispra keyboard to dictate in any app',
    };
  }
  return {
    label: 'Mic button',
    attention: !state.bubbleOn,
    target: 'mic-setup',
    accessibilityLabel: state.bubbleOn ? 'Wispra mic button settings' : 'Set up the Wispra mic button to dictate in any app',
  };
}
