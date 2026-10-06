import { describe, expect, it } from '@jest/globals';

import {
  ACCOUNT_CHECK_LIMIT_MS,
  actionFor,
  AUTO_START_WINDOW_MS,
  DEFAULT_SESSION_MINUTES,
  minutesLeft,
  parseSessionMinutes,
  pieceFailed,
  SESSION_CHOICES,
  sessionGate,
  sessionLabel,
  shouldAutoStartSession,
  wordsFrom,
} from '../keyboard-session';

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

describe('keeping the session by itself (T-0178, point 3)', () => {
  const now = 1_800_000_000_000;
  const keyboardUsed = { allowed: true, active: false, keyboardSeenAt: now - 60 * 60 * 1000, now, endedByUser: false };

  it('starts when Wispra is opened and the keyboard was used within a day', () => {
    expect(shouldAutoStartSession(keyboardUsed)).toBe(true);
    expect(shouldAutoStartSession({ ...keyboardUsed, keyboardSeenAt: now - AUTO_START_WINDOW_MS + 1000 })).toBe(true);
  });

  it('does not start when it is not wanted or not possible', () => {
    // The keyboard was never used, or not for more than a day
    expect(shouldAutoStartSession({ ...keyboardUsed, keyboardSeenAt: null })).toBe(false);
    expect(shouldAutoStartSession({ ...keyboardUsed, keyboardSeenAt: now - AUTO_START_WINDOW_MS - 1 })).toBe(false);
    // One already runs
    expect(shouldAutoStartSession({ ...keyboardUsed, active: true })).toBe(false);
    // Signed out, or an account question waits: nothing goes to Wispra Cloud
    expect(shouldAutoStartSession({ ...keyboardUsed, allowed: false })).toBe(false);
    // The user ended it on purpose
    expect(shouldAutoStartSession({ ...keyboardUsed, endedByUser: true })).toBe(false);
  });
});

describe('the session length', () => {
  it('is chosen once in Account (T-0163, T-0178): 1, 4 or 12 hours, 4 hours by default', () => {
    expect(SESSION_CHOICES).toEqual([60, 240, 720]);
    expect(DEFAULT_SESSION_MINUTES).toBe(240);
    expect(SESSION_CHOICES.map(sessionLabel)).toEqual(['1 hour', '4 hours', '12 hours']);
  });

  it('reads the saved length back, and falls back to 4 hours for anything else (a 15 minutes saved before too)', () => {
    expect(parseSessionMinutes('720')).toBe(720);
    expect(parseSessionMinutes(' 60\n')).toBe(60);
    expect(parseSessionMinutes(null)).toBe(240);
    expect(parseSessionMinutes('15')).toBe(240);
    expect(parseSessionMinutes('abc')).toBe(240);
  });

  it('counts the minutes left, rounded up', () => {
    expect(minutesLeft(1_000_000 + 14 * 60_000 + 1, 1_000_000)).toBe(15);
    expect(minutesLeft(1_000_000, 1_000_001)).toBe(0);
  });
});

describe('what the page the keyboard opens says about the account (T-0182)', () => {
  const base = { sessionLoaded: true, dataLoaded: true, signedIn: true, allowed: true };

  it('is checking, never "sign in", until the saved sign-in and the data are both read', () => {
    expect(sessionGate({ ...base, sessionLoaded: false, signedIn: false, allowed: false })).toBe('checking');
    expect(sessionGate({ ...base, dataLoaded: false, allowed: false })).toBe('checking');
  });

  it('says it cannot read the account, with a way out, once the wait passes the limit, and never before', () => {
    const waiting = { ...base, sessionLoaded: false, signedIn: false, allowed: false };
    expect(sessionGate({ ...waiting, waitedMs: ACCOUNT_CHECK_LIMIT_MS - 1 })).toBe('checking');
    expect(sessionGate({ ...waiting, waitedMs: ACCOUNT_CHECK_LIMIT_MS })).toBe('unreadable');
    // Once it is read, the wait does not matter
    expect(sessionGate({ ...base, waitedMs: 60_000 })).toBe('ready');
  });

  it('asks to sign in only when no one is signed in, and to answer the question when someone is but the data belongs to another account', () => {
    expect(sessionGate({ ...base, signedIn: false, allowed: false })).toBe('sign-in');
    expect(sessionGate({ ...base, allowed: false })).toBe('choose');
    expect(sessionGate(base)).toBe('ready');
  });
});
