import { describe, expect, it } from '@jest/globals';

import { LONG_SEGMENT_MAX_MS, LONG_SEGMENT_MIN_MS, NO_SOUND_IN_MEETING, NO_SOUND_IN_RECORDING, SEGMENT_MAX_MS, SPLIT_OVER_MS, finishedMeeting, segmentRules, shouldStartNextSegment } from '../meeting';
import { DOWN_LOOKS, RETRY_MS, SETTLE_MS, WATCH_START, recovered, watchStep, type Look, type Watch } from '../recording-watch';

const look = (over: Partial<Look> = {}): Look => ({ recording: true, pieceMs: 20_000, platform: 'ios', now: 100_000, ...over });

// Runs looks half a second apart and returns the actions and the final watch
function run(start: Watch, looks: Partial<Look>[], at = 100_000) {
  let watch = start;
  const actions: string[] = [];
  looks.forEach((l, i) => {
    const step = watchStep(watch, look({ now: at + i * 500, ...l }));
    watch = step.watch;
    actions.push(step.action);
  });
  return { watch, actions };
}

describe('a recording that was cut off (T-1072)', () => {
  it('does nothing while the recorder is recording', () => {
    expect(run(WATCH_START, Array(10).fill({ recording: true })).actions.every((a) => a === 'none')).toBe(true);
  });

  it('gives a new piece time to show that it is recording before it counts it as cut off', () => {
    const { actions } = run(WATCH_START, Array(6).fill({ recording: false, pieceMs: SETTLE_MS - 1 }));
    expect(actions.every((a) => a === 'none')).toBe(true);
  });

  it('on iPhone, a recorder that stopped for a second is an interruption: the part so far is kept and new tries start at once', () => {
    const { actions, watch } = run(WATCH_START, [{ recording: false }, { recording: false }]);
    expect(actions).toEqual(['none', 'interrupted']);
    expect(watch.interrupted).toBe(true);
    expect(watch.retryAt).toBe(100_500);
  });

  it('on iPhone, tries to record again every two seconds until it works, then is back to normal', () => {
    const { watch, actions } = run({ down: 0, interrupted: true, retryAt: 100_000 }, Array(9).fill({ recording: false, pieceMs: 0 }));
    // Half-second looks over four seconds: a try at 0, none until 2 s, a try at 2 s, none, a try at 4 s
    expect(actions).toEqual(['retry', 'none', 'none', 'none', 'retry', 'none', 'none', 'none', 'retry']);
    expect(RETRY_MS).toBe(2000);
    expect(watch.interrupted).toBe(true);
    expect(recovered()).toEqual(WATCH_START);
    expect(run(recovered(), [{ recording: true }]).actions).toEqual(['none']);
  });

  it('on Android, a recorder that stopped for a second was ended from outside (the notification’s Stop): no tries, the recording is saved', () => {
    const { actions } = run(WATCH_START, [{ recording: false, platform: 'android' }, { recording: false, platform: 'android' }]);
    expect(actions).toEqual(['none', 'ended-outside']);
  });

  it('a single look at a stopped recorder is not enough (the state can lag a moment)', () => {
    expect(DOWN_LOOKS).toBe(2);
    const { actions } = run(WATCH_START, [{ recording: false }, { recording: true }, { recording: false }, { recording: true }]);
    expect(actions.every((a) => a === 'none')).toBe(true);
  });
});

describe('how long the pieces of a recording are (T-1072)', () => {
  it('a meeting is cut every 12 to 20 seconds, as before', () => {
    expect(segmentRules('meeting')).toEqual({ minMs: 12_000, maxMs: SEGMENT_MAX_MS });
    expect(shouldStartNextSegment(19_999, -10)).toBe(false);
    expect(shouldStartNextSegment(15_000, -60)).toBe(true);
    expect(shouldStartNextSegment(20_000, -10)).toBe(true);
  });

  it('a dictation or a note is cut every 30 to 40 seconds, at a quiet moment, never over the length that is cut again before it is sent', () => {
    for (const kind of ['dictation', 'note'] as const) {
      expect(segmentRules(kind)).toEqual({ minMs: LONG_SEGMENT_MIN_MS, maxMs: LONG_SEGMENT_MAX_MS });
      expect(shouldStartNextSegment(25_000, -60, kind)).toBe(false);
      expect(shouldStartNextSegment(35_000, -60, kind)).toBe(true);
      expect(shouldStartNextSegment(35_000, -10, kind)).toBe(false);
      expect(shouldStartNextSegment(LONG_SEGMENT_MAX_MS, -10, kind)).toBe(true);
    }
    expect(LONG_SEGMENT_MAX_MS).toBeLessThan(SPLIT_OVER_MS);
  });

  it('a recording with no sound says so in its own words, not "this meeting"', () => {
    const silent = [{ id: 'a', uri: 'a.m4a', startMs: 0, durationMs: 5000, status: 'done' as const, text: '', error: null }];
    expect(finishedMeeting(silent).error).toBe(NO_SOUND_IN_MEETING);
    expect(finishedMeeting(silent, 'note').error).toBe(NO_SOUND_IN_RECORDING);
    expect(NO_SOUND_IN_RECORDING).not.toMatch(/meeting/i);
  });
});
