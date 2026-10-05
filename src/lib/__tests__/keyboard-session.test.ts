import { describe, expect, it } from '@jest/globals';

import { actionFor, DEFAULT_SESSION_MINUTES, minutesLeft, SESSION_CHOICES, wordsFrom } from '../keyboard-session';

describe('each piece of a listening session', () => {
  it('is transcribed when something was said and Wispra Cloud may be used', () => {
    expect(actionFor({ voiced: true, last: false }, true)).toEqual({ kind: 'transcribe' });
  });

  it('is handed over empty when it was silence, so the keyboard keeps the order', () => {
    expect(actionFor({ voiced: false, last: true }, true)).toEqual({ kind: 'deliver-empty', reason: 'silence' });
  });

  it('never goes to Wispra Cloud before the account choice (or signed out)', () => {
    expect(actionFor({ voiced: true, last: false }, false)).toEqual({ kind: 'deliver-empty', reason: 'not-allowed' });
  });

  it('gives the keyboard the words, or nothing when the transcription failed', () => {
    expect(wordsFrom({ ok: true, text: '  Hôm nay chúng ta họp lúc 2 giờ. ' })).toBe('Hôm nay chúng ta họp lúc 2 giờ.');
    expect(wordsFrom({ ok: false, error: 'Offline', transient: true })).toBe('');
  });
});

describe('the session length', () => {
  it('offers 5 minutes, 15 minutes and an hour, 15 by default', () => {
    expect(SESSION_CHOICES).toEqual([5, 15, 60]);
    expect(DEFAULT_SESSION_MINUTES).toBe(15);
  });

  it('counts the minutes left, rounded up', () => {
    expect(minutesLeft(1_000_000 + 14 * 60_000 + 1, 1_000_000)).toBe(15);
    expect(minutesLeft(1_000_000, 1_000_001)).toBe(0);
  });
});
