import { describe, expect, it } from '@jest/globals';

import { lastFinding, logToShare, newestFirst, parseLogLines } from '../keyboard-log';

// What the owner's try in Zalo is expected to leave in the log (T-0178): the keyboard says it waited and
// the app gave no sign of life; the app, started again, says iOS closed it
const ZALO = [
  '06/10 06:05:40 app: session started for 240 min (engine running: true)',
  '06/10 06:05:58 keyboard: purple mic tapped: session live (beat 3 s ago, 238 min left): start',
  '06/10 06:06:03 keyboard: red mic tapped: stop (app beat 4 s ago)',
  '06/10 06:06:30 keyboard: no words after 27 s and the app gave no sign of life for 38 s: iOS stopped Wispra?',
  '06/10 06:09:00 app: Wispra was started again; the last run ended without ending its session (its last beat was 41 s ago): iOS closed Wispra',
];

describe('the keyboard log (T-0178)', () => {
  it('shows the newest line first and drops empty ones', () => {
    expect(newestFirst(['a', '', '  ', 'b'])).toEqual(['b', 'a']);
    expect(parseLogLines([' x ', ''])).toEqual(['x']);
  });

  it('points at iOS closing Wispra when the log says so, over the weaker signs before it', () => {
    const finding = lastFinding(ZALO);
    expect(finding?.line).toContain('iOS closed Wispra');
    expect(finding?.meaning).toMatch(/iOS closed Wispra while its session was on/);
  });

  it('points at the other signs: suspension, another app taking the microphone, no live session, slow words', () => {
    expect(lastFinding(['06/10 06:00:01 app: the app was not running for 90 s (suspended by iOS), engine running: false'])?.meaning).toMatch(/suspended Wispra/);
    expect(lastFinding(['06/10 06:00:01 app: audio interrupted by another app or iOS (reason 0)'])?.meaning).toMatch(/Another app/);
    expect(lastFinding(['06/10 06:00:01 app: could not start the microphone again: busy'])?.meaning).toMatch(/busy with another app/);
    expect(lastFinding(['06/10 06:00:01 app: iOS warned that memory is short (it may close Wispra next)'])?.meaning).toMatch(/memory is short/);
    expect(lastFinding(['06/10 06:00:01 keyboard: purple mic tapped: no live session (beat 80 s ago): opening Wispra'])?.meaning).toMatch(/no running session/);
    expect(lastFinding(['06/10 06:00:01 keyboard: no words after 45 s (the app beats 3 s ago)'])?.meaning).toMatch(/did not come back in time/);
  });

  it('says nothing is wrong when the log holds a working try', () => {
    expect(
      lastFinding([
        '06/10 06:05:40 app: session started for 240 min (engine running: true)',
        '06/10 06:05:58 keyboard: purple mic tapped: session live (beat 3 s ago, 238 min left): start',
        '06/10 06:06:05 keyboard: words arrived after 1800 ms',
      ]),
    ).toBeNull();
    expect(lastFinding([])).toBeNull();
  });

  it('is shared with the finding first, then every line', () => {
    const text = logToShare(ZALO);
    expect(text.startsWith('Last sign: ')).toBe(true);
    expect(text.split('\n').filter((l) => l.startsWith('06/10'))).toHaveLength(ZALO.length);
    expect(logToShare(['one'])).toBe('one');
  });
});
