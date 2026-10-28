// The small recording indicator (T-1073): what the app tells the phone, and when. The native side (the Live
// Activity in Swift, the overlay button in Kotlin) is built and tested by the iOS and Android workflows; here
// the two native modules are stand-ins that note what they are asked.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import { bubbleVisible, indicatorKindLabel, indicatorTimes, useRecordingIndicator, type IndicatorStatus } from '@/lib/recording-indicator';

const mockShowActivity = jest.fn(async (..._args: unknown[]) => true);
const mockHideActivity = jest.fn(async () => undefined);
const mockShowBubble = jest.fn((_mode: string) => true);
const mockHideBubble = jest.fn();

jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  showRecordingIndicator: (...args: unknown[]) => mockShowActivity(...args),
  hideRecordingIndicator: () => mockHideActivity(),
}));
jest.mock('@/modules/wispra-dictation', () => ({
  bubbleSupported: true,
  showRecordingBubble: (mode: string) => mockShowBubble(mode),
  hideRecordingBubble: () => mockHideBubble(),
}));

type Listener = (state: string) => void;
let appListeners: Listener[] = [];
// jest-expo makes AppState.currentState a mock function; the app reads a string from it
const setApp = (state: string) => void ((AppState as unknown as { currentState: string }).currentState = state);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  for (const f of [mockShowActivity, mockHideActivity, mockShowBubble, mockHideBubble]) f.mockClear();
  appListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: Listener) => {
    appListeners.push(listener);
    return { remove: () => void (appListeners = appListeners.filter((l) => l !== listener)) };
  }) as never);
  setApp('active');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const goTo = (state: string) => act(async () => appListeners.forEach((l) => l(state)));

describe('what the indicator is made of', () => {
  it('names the recording for the lock screen', () => {
    expect(indicatorKindLabel('meeting')).toBe('Meeting');
    expect(indicatorKindLabel('note')).toBe('Note');
    expect(indicatorKindLabel('dictation')).toBe('Dictation');
  });

  it('counts the timer from the start, moved forward by what was already recorded, and stops it while waiting', () => {
    const now = 1_000_000;
    expect(indicatorTimes('recording', 65_000, now)).toEqual({ startedAt: 935_000, pausedAt: 0 });
    expect(indicatorTimes('paused', 65_000, now)).toEqual({ startedAt: 935_000, pausedAt: now });
    expect(indicatorTimes('interrupted', 0, now)).toEqual({ startedAt: now, pausedAt: now });
    expect(indicatorTimes('recording', -5, now).startedAt).toBe(now);
  });

  it('puts the Android button up only while recording and only when Wispra is not in front', () => {
    for (const status of ['recording', 'paused', 'interrupted'] as IndicatorStatus[]) {
      expect(bubbleVisible(status, 'background')).toBe(true);
      expect(bubbleVisible(status, 'inactive')).toBe(true);
      expect(bubbleVisible(status, 'active')).toBe(false);
    }
    expect(bubbleVisible(null, 'background')).toBe(false);
  });
});

describe('the indicator follows a recording', () => {
  it('iPhone: starts the Live Activity with the kind and where the timer counts from, changes it for a pause, ends it at the end', async () => {
    const { rerender, unmount } = await renderHook((p: { status: IndicatorStatus | null; elapsed: number }) => useRecordingIndicator('note', p.status, p.elapsed), {
      initialProps: { status: 'recording' as IndicatorStatus | null, elapsed: 12_000 },
    });
    const now = Date.now();
    expect(mockShowActivity).toHaveBeenLastCalledWith('Note', 'recording', now - 12_000, 0);

    // Half a second later the length is a little more: nothing is sent (the timer counts by itself)
    await rerender({ status: 'recording', elapsed: 12_500 });
    await rerender({ status: 'recording', elapsed: 13_000 });
    expect(mockShowActivity).toHaveBeenCalledTimes(1);

    jest.setSystemTime(now + 3_000);
    await rerender({ status: 'paused', elapsed: 15_000 });
    expect(mockShowActivity).toHaveBeenLastCalledWith('Note', 'paused', now + 3_000 - 15_000, now + 3_000);

    await rerender({ status: null, elapsed: 15_000 });
    expect(mockHideActivity).toHaveBeenCalledTimes(1);
    expect(mockHideBubble).toHaveBeenCalled();
    await unmount();
  });

  it('shows nothing, and ends nothing, for a screen that never recorded (another screen’s indicator is not its to end)', async () => {
    const { unmount } = await renderHook(() => useRecordingIndicator('dictation', null, 0));
    await unmount();
    expect(mockShowActivity).not.toHaveBeenCalled();
    expect(mockHideActivity).not.toHaveBeenCalled();
    expect(mockHideBubble).not.toHaveBeenCalled();
  });

  it('ends the indicator when the screen that was recording goes away', async () => {
    const { unmount } = await renderHook(() => useRecordingIndicator('meeting', 'recording', 1000));
    await unmount();
    expect(mockHideActivity).toHaveBeenCalledTimes(1);
    expect(mockHideBubble).toHaveBeenCalled();
  });

  it('Android: the button is put up when Wispra goes to the background and taken down when it comes back', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderHook(() => useRecordingIndicator('note', 'recording', 5000));
    // Wispra is in front: no button
    expect(mockShowBubble).not.toHaveBeenCalled();
    expect(mockHideBubble).toHaveBeenCalled();

    await goTo('background');
    expect(mockShowBubble).toHaveBeenLastCalledWith('recording');
    mockHideBubble.mockClear();
    await goTo('active');
    expect(mockHideBubble).toHaveBeenCalledTimes(1);
  });

  it('Android: while paused or waiting for the microphone the button says so', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    setApp('background');
    const { rerender } = await renderHook((p: { status: IndicatorStatus }) => useRecordingIndicator('note', p.status, 5000), {
      initialProps: { status: 'recording' as IndicatorStatus },
    });
    expect(mockShowBubble).toHaveBeenLastCalledWith('recording');
    await rerender({ status: 'interrupted' });
    expect(mockShowBubble).toHaveBeenLastCalledWith('interrupted');
    await rerender({ status: 'paused' });
    expect(mockShowBubble).toHaveBeenLastCalledWith('paused');
  });
});
