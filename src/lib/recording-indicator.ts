import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { EntryKind } from './entries';
import { hideRecordingBubble, showRecordingBubble } from '@/modules/wispra-dictation';
import { hideRecordingIndicator, showRecordingIndicator } from '@/modules/wispra-keyboard-bridge';

// The small recording indicator (T-1073):
//  - iPhone: a Live Activity, a small wave in the Dynamic Island, and on the lock screen (the only place
//    on iPhones without a Dynamic Island). iOS does not let an app draw over other apps, so there is no
//    floating button there. Tapping it opens Wispra where it was, on the recording.
//  - Android: a faint round button at the right edge, over other apps, while the app is not on screen;
//    tapping it opens Wispra. It needs "Display over other apps" (Account has a row for it).
// The words on the lock screen and in the island are in ios/RecordingLiveActivity.swift (targets/recording).

export type IndicatorStatus = 'recording' | 'paused' | 'interrupted';

// What the Live Activity calls the recording
export function indicatorKindLabel(kind: EntryKind): 'Dictation' | 'Note' | 'Meeting' {
  return kind === 'meeting' ? 'Meeting' : kind === 'note' ? 'Note' : 'Dictation';
}

// The two times the Live Activity counts from, in milliseconds since 1970. Its timer runs by itself, from
// `startedAt` (moved forward by how long was already recorded); while waiting it stops at `pausedAt`.
export function indicatorTimes(status: IndicatorStatus, elapsedMs: number, now: number): { startedAt: number; pausedAt: number } {
  return { startedAt: now - Math.max(0, elapsedMs), pausedAt: status === 'recording' ? 0 : now };
}

// Whether the Android button is on screen: only while recording, and only when Wispra is not the app in front
export function bubbleVisible(status: IndicatorStatus | null, app: AppStateStatus): boolean {
  return status !== null && app !== 'active';
}

// Keeps the indicator in step with a recording. `status` is null when nothing is being recorded; it is
// changed only when the recording changes, never every half second (the timer counts by itself).
export function useRecordingIndicator(kind: EntryKind, status: IndicatorStatus | null, elapsedMs: number) {
  const elapsed = useRef(elapsedMs);
  // Whether this recording has put an indicator up: another screen's recording is never taken down by this one
  const shown = useRef(false);
  useEffect(() => {
    elapsed.current = elapsedMs;
  });

  useEffect(() => {
    if (!status) return;
    const { startedAt, pausedAt } = indicatorTimes(status, elapsed.current, Date.now());
    shown.current = true;
    void showRecordingIndicator(indicatorKindLabel(kind), status, startedAt, pausedAt);
    const apply = (app: AppStateStatus) => {
      if (bubbleVisible(status, app)) showRecordingBubble(status);
      else hideRecordingBubble();
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);
    return () => subscription.remove();
  }, [kind, status]);

  // Nothing recording any more, or the screen closed: both indicators go
  useEffect(() => {
    if (status || !shown.current) return;
    shown.current = false;
    void hideRecordingIndicator();
    hideRecordingBubble();
  }, [status]);

  useEffect(
    () => () => {
      if (!shown.current) return;
      void hideRecordingIndicator();
      hideRecordingBubble();
    },
    [],
  );
}
