import { describe, expect, it } from '@jest/globals';

import { actionFor, DEFAULT_SESSION_MINUTES, minutesLeft, parseSessionMinutes, pieceFailed, SESSION_CHOICES, sessionLabel, wordsFrom } from '../keyboard-session';

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

  it('tells a piece that could not be transcribed from one with nothing said (T-0163 review)', () => {
    expect(pieceFailed({ ok: false, error: 'Could not reach Wispra Cloud (offline).', transient: true })).toBe(true);
    expect(pieceFailed({ ok: false, error: 'Your Wispra Cloud sign-in has expired. Sign in again in Account.' })).toBe(true);
    expect(pieceFailed({ ok: false, error: 'No speech was heard in this recording.' })).toBe(false);
    expect(pieceFailed({ ok: false, error: 'No audio was recorded in this file.' })).toBe(false);
    expect(pieceFailed({ ok: true, text: 'Xin chào' })).toBe(false);
  });
});

describe('the session length', () => {
  it('is chosen once in Account (T-0163): 15 minutes, 1 hour or 4 hours, 1 hour by default', () => {
    expect(SESSION_CHOICES).toEqual([15, 60, 240]);
    expect(DEFAULT_SESSION_MINUTES).toBe(60);
    expect(SESSION_CHOICES.map(sessionLabel)).toEqual(['15 min', '1 hour', '4 hours']);
  });

  it('reads the saved length back, and falls back to 1 hour for anything else', () => {
    expect(parseSessionMinutes('240')).toBe(240);
    expect(parseSessionMinutes(' 15\n')).toBe(15);
    expect(parseSessionMinutes(null)).toBe(60);
    expect(parseSessionMinutes('5')).toBe(60);
    expect(parseSessionMinutes('abc')).toBe(60);
  });

  it('counts the minutes left, rounded up', () => {
    expect(minutesLeft(1_000_000 + 14 * 60_000 + 1, 1_000_000)).toBe(15);
    expect(minutesLeft(1_000_000, 1_000_001)).toBe(0);
  });
});
