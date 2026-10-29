// Recording in the background (T-1072): the real recording hook, with stand-ins for the phone's recorder
// (expo-audio) and for the store of entries. The "phone" is told what the system does: the screen locks
// (time passes), a call takes the microphone, the notification's Stop is tapped.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

import type { Entry } from '@/lib/entries';
import type { MeetingSegment } from '@/lib/meeting';
import { NOTICE_ENDED_OUTSIDE, NOTICE_INTERRUPTED, NOTICE_NO_NOTIFICATIONS, NOTICE_RESUMED } from '@/lib/recording-watch';
import { usePieceRecording } from '@/lib/use-meeting-recording';

class MockRecorder {
  uri: string | null = null;
  recording = false;
  durationMillis = 0;
  metering = -20;
  prepareToRecordAsync = jest.fn(async () => {
    mockFiles += 1;
    this.uri = `file:///recording-${mockFiles}.m4a`;
    this.durationMillis = 0;
  });
  // A microphone that is taken (a call) does not start
  record = jest.fn(() => {
    if (!mockMicrophoneBusy) this.recording = true;
  });
  stop = jest.fn(async () => {
    this.recording = false;
  });
  pause = jest.fn(() => {
    this.recording = false;
  });
  getStatus = () => ({ isRecording: this.recording, durationMillis: this.durationMillis, metering: this.metering });
}

let mockFiles = 0;
let mockMicrophoneBusy = false;
let mockNotificationsAllowed = true;
let mockRecorders: MockRecorder[] = [];
const mockModes: Record<string, unknown>[] = [];
const mockEntries: Entry[] = [];
const mockTranscribe = jest.fn();

jest.mock('expo-audio', () => {
  const { useState } = jest.requireActual('react') as typeof import('react');
  return {
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: async () => ({ granted: true }),
    requestNotificationPermissionsAsync: async () => ({ granted: mockNotificationsAllowed }),
    setAudioModeAsync: async (mode: Record<string, unknown>) => {
      mockModes.push(mode);
    },
    useAudioRecorder: () => {
      const [recorder] = useState(() => {
        const r = new MockRecorder();
        mockRecorders.push(r);
        return r;
      });
      return recorder;
    },
  };
});
jest.mock('@/lib/storage', () => ({ keepAudio: (uri: string) => uri }));
// The small recording indicator (T-1073): the Live Activity on iPhone, noted here
const mockShowActivity = jest.fn(async (..._args: unknown[]) => true);
const mockHideActivity = jest.fn(async () => undefined);
jest.mock('@/modules/wispra-keyboard-bridge', () => ({
  endSessionBeforeRecording: async () => undefined,
  showRecordingIndicator: (...args: unknown[]) => mockShowActivity(...args),
  hideRecordingIndicator: () => mockHideActivity(),
}));
jest.mock('@/modules/wispra-dictation', () => ({ showRecordingBubble: () => false, hideRecordingBubble: () => undefined }));
jest.mock('@/lib/entries-store', () => {
  const change = (id: string, f: (e: Entry) => Entry) => {
    const i = mockEntries.findIndex((e) => e.id === id);
    if (i >= 0) mockEntries[i] = f(mockEntries[i]);
  };
  const store = {
    add: (e: Entry) => void mockEntries.push(e),
    get: (id: string) => mockEntries.find((e) => e.id === id),
    update: (id: string, c: Partial<Entry>) => change(id, (e) => ({ ...e, ...c })),
    remove: (id: string) => {
      const i = mockEntries.findIndex((e) => e.id === id);
      if (i >= 0) mockEntries.splice(i, 1);
    },
    addSegment: (id: string, s: MeetingSegment) => change(id, (e) => ({ ...e, segments: [...(e.segments ?? []), s] })),
    updateSegment: (id: string, sid: string, c: Partial<MeetingSegment>) =>
      change(id, (e) => ({ ...e, segments: (e.segments ?? []).map((s) => (s.id === sid ? { ...s, ...c } : s)) })),
    splitLongPiece: async () => undefined,
    transcribeWaiting: (...args: unknown[]) => mockTranscribe(...args),
  };
  return { useEntries: () => store };
});

// The phone lets half a second go by; the active recorder has recorded that much
async function tick(times = 1, recorded = true) {
  for (let i = 0; i < times; i += 1) {
    if (recorded) for (const r of mockRecorders) if (r.recording) r.durationMillis += 500;
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
  }
}

const segments = () => mockEntries[0]?.segments ?? [];

async function started(kind: 'note' | 'dictation' | 'meeting' = 'note', options?: { background?: boolean }) {
  const hook = await renderHook(() => usePieceRecording(kind, options));
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFiles = 0;
  mockMicrophoneBusy = false;
  mockNotificationsAllowed = true;
  mockRecorders = [];
  mockModes.length = 0;
  mockEntries.length = 0;
  mockTranscribe.mockClear();
  mockShowActivity.mockClear();
  mockHideActivity.mockClear();
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('keeps recording in the background until Stop (T-1072)', () => {
  it('asks the system for background recording, and says so in no other words than the audio mode (iPhone: the audio background mode; Android: the recording service)', async () => {
    await started('note');
    expect(mockModes[0]).toMatchObject({ allowsRecording: true, allowsBackgroundRecording: true });
    expect(mockEntries[0]).toMatchObject({ kind: 'note', status: 'recording', segments: [expect.objectContaining({ status: 'recording' })] });
  });

  it('does the same for a dictation, as it does for a meeting', async () => {
    await started('dictation');
    expect(mockModes[0]).toMatchObject({ allowsBackgroundRecording: true });
    mockModes.length = 0;
    await started('meeting');
    expect(mockModes[0]).toMatchObject({ allowsBackgroundRecording: true });
  });

  it('can be told not to (the keyboard’s dictation ends when the person leaves)', async () => {
    await started('dictation', { background: false });
    expect(mockModes[0]).toMatchObject({ allowsBackgroundRecording: false });
  });

  it('keeps recording while time passes with nobody touching the phone, and stops only at Stop', async () => {
    const hook = await started('note');
    await tick(120); // a minute with the screen off
    expect(hook.result.current.phase).toBe('recording');
    expect(hook.result.current.elapsedMs).toBeGreaterThanOrEqual(59_000);
    await act(async () => {
      await hook.result.current.stop();
    });
    expect(hook.result.current.phase).toBe('idle');
    expect(mockEntries[0].status).toBe('pending');
    expect(mockEntries[0].durationMs).toBeGreaterThanOrEqual(59_000);
    expect(mockModes[mockModes.length - 1]).toMatchObject({ allowsRecording: false, allowsBackgroundRecording: false });
    expect(mockTranscribe).toHaveBeenCalled();
  });

  it('on Android, asks for the notification the recording service shows; without it the recording still works, only while the app is open', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const allowed = await started('note');
    expect(mockModes[0]).toMatchObject({ allowsBackgroundRecording: true });
    expect(allowed.result.current.notice).toBeNull();

    mockModes.length = 0;
    mockEntries.length = 0;
    mockNotificationsAllowed = false;
    const denied = await started('note');
    expect(mockModes[0]).toMatchObject({ allowsRecording: true, allowsBackgroundRecording: false });
    expect(denied.result.current.notice).toBe(NOTICE_NO_NOTIFICATIONS);
    expect(denied.result.current.phase).toBe('recording');
  });
});

describe('a long recording is made in pieces (T-1072)', () => {
  it('cuts a note into pieces of 30 to 40 seconds, keeps each as soon as it is done and hands it to transcription', async () => {
    const hook = await started('note');
    await tick(2 * 100); // 100 seconds
    const all = segments();
    expect(all.length).toBeGreaterThanOrEqual(3);
    const finished = all.filter((s) => s.status === 'pending');
    expect(finished.length).toBe(all.length - 1);
    for (const s of finished) {
      expect(s.durationMs).toBeGreaterThanOrEqual(30_000);
      expect(s.durationMs).toBeLessThanOrEqual(41_000);
      expect(s.uri).toMatch(/^file:\/\//);
    }
    // Each piece starts where the one before ended, and has its own file
    for (let i = 1; i < all.length; i += 1) expect(all[i].startMs).toBe(all[i - 1].startMs + all[i - 1].durationMs);
    expect(new Set(all.map((s) => s.uri)).size).toBe(all.length);
    expect(mockTranscribe).toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.stop();
    });
  });

  it('cuts a meeting into pieces of 12 to 20 seconds, as before', async () => {
    await started('meeting');
    await tick(2 * 50);
    const finished = segments().filter((s) => s.status === 'pending');
    expect(finished.length).toBeGreaterThanOrEqual(2);
    for (const s of finished) expect(s.durationMs).toBeLessThanOrEqual(21_000);
  });

  it('when the network is gone, the pieces already recorded are still on the phone, waiting, and the recording goes on', async () => {
    // The hook never reaches for the network: a piece is saved as "pending" with its file, and the queue
    // sends it when it can (src/lib/transcribe-queue.ts, which keeps a piece that could not be sent)
    const hook = await started('note');
    await tick(2 * 90);
    const pending = segments().filter((s) => s.status === 'pending');
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.every((s) => !!s.uri && s.text === null && s.error === null)).toBe(true);
    expect(hook.result.current.phase).toBe('recording');
  });
});

describe('a call takes the microphone (iPhone) (T-1072)', () => {
  it('keeps what was said, says so, tries again every couple of seconds, and carries on in a new piece when the call is over', async () => {
    const hook = await started('note');
    await tick(2 * 12); // 12 seconds in
    const [first] = mockRecorders;
    // The call starts: the recorder stops by itself and the microphone is busy
    first.recording = false;
    mockMicrophoneBusy = true;
    await tick(2, false);
    expect(hook.result.current.interrupted).toBe(true);
    expect(hook.result.current.notice).toBe(NOTICE_INTERRUPTED);
    expect(segments()).toHaveLength(1);
    expect(segments()[0]).toMatchObject({ status: 'pending', durationMs: 12_000 });

    // Twenty seconds of call: every try fails, and no piece is added for the tries
    await tick(2 * 20, false);
    expect(hook.result.current.interrupted).toBe(true);
    expect(segments()).toHaveLength(1);
    expect(hook.result.current.phase).toBe('recording');

    // The call ends
    mockMicrophoneBusy = false;
    await tick(2 * 3, false);
    expect(hook.result.current.interrupted).toBe(false);
    expect(hook.result.current.notice).toBe(NOTICE_RESUMED);
    expect(segments()).toHaveLength(2);
    expect(segments()[1]).toMatchObject({ status: 'recording', startMs: 12_000 });

    // The words after the call are counted on from where they were
    await tick(2 * 5);
    expect(hook.result.current.elapsedMs).toBeGreaterThanOrEqual(16_500);
    await act(async () => {
      await hook.result.current.stop();
    });
    expect(mockEntries[0].durationMs).toBeGreaterThanOrEqual(16_500);
    expect(segments().map((s) => s.status)).toEqual(['pending', 'pending']);
  });

  it('Stop during the call saves what was recorded before it', async () => {
    const hook = await started('note');
    await tick(2 * 10);
    mockRecorders[0].recording = false;
    mockMicrophoneBusy = true;
    await tick(4, false);
    expect(hook.result.current.interrupted).toBe(true);
    await act(async () => {
      await hook.result.current.stop();
    });
    expect(hook.result.current.phase).toBe('idle');
    expect(mockEntries[0]).toMatchObject({ status: 'pending', durationMs: 10_000 });
    expect(segments()).toEqual([expect.objectContaining({ status: 'pending', durationMs: 10_000 })]);
  });

  it('a pause is not an interruption', async () => {
    const hook = await started('note');
    await tick(2 * 5);
    await act(async () => hook.result.current.pause());
    await tick(2 * 20, false);
    expect(hook.result.current.interrupted).toBe(false);
    expect(hook.result.current.phase).toBe('paused');
  });
});

describe('Stop on the Android notification (T-1072)', () => {
  it('ends the recording and saves it, without trying to start it again', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const hook = await started('note');
    await tick(2 * 20);
    // The service's Stop button ends the recorder from outside
    mockRecorders[0].recording = false;
    await tick(3, false);
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.notice).toBe(NOTICE_ENDED_OUTSIDE);
    expect(hook.result.current.endedId).toBe(mockEntries[0].id);
    expect(mockEntries[0]).toMatchObject({ status: 'pending', durationMs: 20_000 });
    expect(segments()).toEqual([expect.objectContaining({ status: 'pending', durationMs: 20_000 })]);
    expect(mockRecorders[0].prepareToRecordAsync).toHaveBeenCalledTimes(1);
  });
});

describe('Cancel (T-1072)', () => {
  it('throws the whole recording away, every piece of it', async () => {
    const hook = await started('note');
    await tick(2 * 70);
    expect(segments().length).toBeGreaterThan(1);
    await act(async () => {
      await hook.result.current.cancel();
    });
    expect(mockEntries).toHaveLength(0);
    expect(hook.result.current.phase).toBe('idle');
    expect(mockModes[mockModes.length - 1]).toMatchObject({ allowsRecording: false, allowsBackgroundRecording: false });
  });
});

describe('the small indicator follows the recording (T-1073)', () => {
  const statuses = () => mockShowActivity.mock.calls.map((c) => c[1]);

  it('goes up when recording starts, with what is being recorded, and comes down at Stop', async () => {
    const hook = await started('note');
    expect(mockShowActivity).toHaveBeenCalledTimes(1);
    expect(mockShowActivity.mock.calls[0].slice(0, 2)).toEqual(['Note', 'recording']);
    await tick(2 * 30);
    // Half-second looks change nothing on the lock screen: the timer there counts by itself
    expect(mockShowActivity).toHaveBeenCalledTimes(1);
    await act(async () => {
      await hook.result.current.stop();
    });
    expect(mockHideActivity).toHaveBeenCalledTimes(1);
  });

  it('says what the recording is: a meeting, a dictation', async () => {
    await started('meeting');
    expect(mockShowActivity.mock.calls[0][0]).toBe('Meeting');
    await started('dictation');
    expect(mockShowActivity.mock.calls[1][0]).toBe('Dictation');
  });

  it('changes for a pause and back, and for a call', async () => {
    const hook = await started('note');
    await tick(2 * 5);
    await act(async () => hook.result.current.pause());
    expect(statuses()).toEqual(['recording', 'paused']);
    await act(async () => hook.result.current.resume());
    expect(statuses()).toEqual(['recording', 'paused', 'recording']);
    // A call takes the microphone, and gives it back
    mockRecorders[0].recording = false;
    mockMicrophoneBusy = true;
    await tick(4, false);
    expect(statuses()[statuses().length - 1]).toBe('interrupted');
    mockMicrophoneBusy = false;
    await tick(2 * 3, false);
    expect(statuses()[statuses().length - 1]).toBe('recording');
    await act(async () => {
      await hook.result.current.stop();
    });
  });

  it('is not shown for a recording that ends when the person leaves the app', async () => {
    const hook = await started('dictation', { background: false });
    await tick(2 * 5);
    expect(mockShowActivity).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.stop();
    });
  });

  it('comes down when the recording is thrown away', async () => {
    const hook = await started('note');
    await act(async () => {
      await hook.result.current.cancel();
    });
    expect(mockHideActivity).toHaveBeenCalledTimes(1);
  });
});
