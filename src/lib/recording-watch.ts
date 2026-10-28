// Watching a recording that runs in the background (T-1072). Pure, so it is tested; the hook in
// use-meeting-recording.ts reads the recorder every half second, asks what to do, and does it.
//
// A recorder that is no longer recording although nobody asked it to stop was cut off:
//  - iPhone: a phone call, an alarm or another app took the microphone. The recorded part is kept as a
//    piece, and a new piece is tried every RETRY_MS until the microphone is free again.
//  - Android: the recording service's notification has a Stop button, and the system may end a service.
//    Either way the recording is over: what was recorded is saved, as if Stop had been tapped.

export type Platform = 'ios' | 'android';

// Half-second looks: two in a row (a second) before a recorder counts as cut off, because right after
// record() the state can lag a moment
export const DOWN_LOOKS = 2;
// A piece that has run for less than this has not had time to show it is recording
export const SETTLE_MS = 1500;
export const RETRY_MS = 2000;

export interface Watch {
  // Looks in a row at a recorder that was not recording
  down: number;
  // iPhone: the microphone was taken; the next try is at `retryAt`
  interrupted: boolean;
  retryAt: number;
}

export const WATCH_START: Watch = { down: 0, interrupted: false, retryAt: 0 };

export type WatchAction = 'none' | 'interrupted' | 'retry' | 'ended-outside';

export interface Look {
  // Whether the recorder says it is recording (when there is a running piece)
  recording: boolean;
  // How long the running piece has been going; ignored while interrupted
  pieceMs: number;
  platform: Platform;
  now: number;
}

export function watchStep(watch: Watch, look: Look): { watch: Watch; action: WatchAction } {
  if (watch.interrupted) {
    if (look.now < watch.retryAt) return { watch, action: 'none' };
    return { watch: { ...watch, retryAt: look.now + RETRY_MS }, action: 'retry' };
  }
  if (look.recording || look.pieceMs < SETTLE_MS) return { watch: watch.down === 0 ? watch : { ...watch, down: 0 }, action: 'none' };
  const down = watch.down + 1;
  if (down < DOWN_LOOKS) return { watch: { ...watch, down }, action: 'none' };
  if (look.platform === 'android') return { watch: { ...watch, down }, action: 'ended-outside' };
  // The next try is right away: a short interruption (a notification sound) is over in a moment
  return { watch: { down: 0, interrupted: true, retryAt: look.now }, action: 'interrupted' };
}

// A new piece is recording again
export function recovered(): Watch {
  return WATCH_START;
}

export const NOTICE_INTERRUPTED = 'The microphone was taken by a call or another app. Wispra carries on as soon as it is free; what you said so far is kept.';
export const NOTICE_RESUMED = 'Recording again. The part before the interruption is kept.';
export const NOTICE_ENDED_OUTSIDE = 'The recording was stopped from outside the app. What was recorded is saved.';
// Said on the recording screens, so nobody has to wonder whether leaving the app ends the recording (T-1072)
export const HINT_BACKGROUND_BUTTON = 'Keeps recording if you leave Wispra or lock the screen. Tap ■ to finish.';
export const HINT_BACKGROUND_STOP = 'Keeps recording if you leave Wispra or lock the screen. Tap Stop and save to finish.';
export const NOTICE_NO_NOTIFICATIONS =
  'Notifications are off for Wispra, so it can only record while it is open. Turn them on in your phone settings to keep recording with the screen locked.';
