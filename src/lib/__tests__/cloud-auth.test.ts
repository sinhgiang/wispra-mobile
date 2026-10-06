// The account kept on the phone (T-0182): the keyboard's mic opened a page that said "Sign in first" to
// people who were signed in. The real cloud-auth runs here; only the keychain, the network and the
// native modules are stand-ins.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Session } from '../session';

const KEY = 'wispra.session';
let mockKeychain: Record<string, string> = {};
let mockReadError: Error | null = null;
const mockWrites: { value: string | null; options: unknown }[] = [];
const mockNotes: string[] = [];
let mockFetch: (url: string, init?: { body?: string }) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  getItemAsync: async (key: string) => {
    if (mockReadError) throw mockReadError;
    return mockKeychain[key] ?? null;
  },
  setItemAsync: async (key: string, value: string, options: unknown) => {
    mockWrites.push({ value, options });
    mockKeychain[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    mockWrites.push({ value: null, options: undefined });
    delete mockKeychain[key];
  },
}));
jest.mock('@/modules/wispra-dictation', () => ({
  bubbleSupported: false,
  getSession: () => null,
  setSession: () => undefined,
  setCloudConfig: () => undefined,
}));
jest.mock('@/modules/wispra-keyboard-bridge', () => ({ noteKeyboardLog: (text: string) => mockNotes.push(text) }));

const session = (over: Partial<Session> = {}): Session => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 60 * 60 * 1000,
  userId: 'u1',
  email: 'owner@example.com',
  ...over,
});

const reply = (status: number, body: unknown = {}) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

async function freshAuth() {
  jest.resetModules();
  return require('../cloud-auth') as typeof import('../cloud-auth');
}

beforeEach(() => {
  mockKeychain = {};
  mockReadError = null;
  mockWrites.length = 0;
  mockNotes.length = 0;
  mockFetch = reply(200);
  (globalThis as { fetch: unknown }).fetch = (url: string, init?: { body?: string }) => mockFetch(url, init);
});

describe('reading the saved sign-in', () => {
  it('is "not read yet" first, and listeners are told when it is, also when nobody is signed in', async () => {
    const auth = await freshAuth();
    const told: unknown[] = [];
    auth.subscribe((s) => told.push(s));
    expect(auth.sessionLoaded()).toBe(false);
    await auth.loadSession();
    expect(auth.sessionLoaded()).toBe(true);
    // A screen waiting for this is told even though the answer is "nobody": otherwise it waits for ever
    expect(told).toEqual([null]);
  });

  it('keeps the account when the keychain will not answer (a locked phone), and reads it again at the next use', async () => {
    mockKeychain[KEY] = JSON.stringify(session());
    mockReadError = new Error('User interaction is not allowed');
    const auth = await freshAuth();
    await auth.loadSession();
    expect(auth.sessionLoaded()).toBe(false);
    expect(auth.currentSession()).toBeNull();
    expect(mockNotes.join('\n')).toMatch(/account: the saved sign-in could not be read/);
    // Not "signed out": the next use asks the keychain again, and the account is there
    mockReadError = null;
    expect(await auth.validToken()).toBe('access-1');
    expect(auth.sessionLoaded()).toBe(true);
  });

  it('saves it again as readable after the first unlock, so the locked phone can read it later', async () => {
    mockKeychain[KEY] = JSON.stringify(session());
    const auth = await freshAuth();
    await auth.loadSession();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockWrites.some((w) => w.value && (w.options as { keychainAccessible?: string }).keychainAccessible === 'after-first-unlock')).toBe(true);
  });

  it('says in the keyboard log whether it is signed in and for how long, never the account or the tokens', async () => {
    mockKeychain[KEY] = JSON.stringify(session());
    const auth = await freshAuth();
    await auth.loadSession();
    expect(mockNotes.join('\n')).toMatch(/account: read, signed in, token valid for 60 min/);
    expect(mockNotes.join('\n')).not.toMatch(/owner@example|access-1|refresh-1/);
  });
});

describe('a refresh the server refuses', () => {
  const due = () => session({ expiresAt: Date.now() + 60 * 1000 });

  it('uses the sign-in someone else refreshed meanwhile, instead of signing out', async () => {
    mockKeychain[KEY] = JSON.stringify(due());
    const auth = await freshAuth();
    await auth.loadSession();
    // The server turns the old refresh token down; the keychain meanwhile holds a newer sign-in
    mockFetch = async () => {
      mockKeychain[KEY] = JSON.stringify(session({ accessToken: 'access-2', refreshToken: 'refresh-2' }));
      return { status: 400, ok: false, json: async () => ({ error: 'invalid_grant' }) };
    };
    expect(await auth.validToken()).toBe('access-2');
    expect(auth.currentSession()?.accessToken).toBe('access-2');
    expect(mockNotes.join('\n')).toMatch(/refreshed meanwhile: used/);
  });

  it('signs out only when nothing newer is stored: the server really does not know the sign-in any more', async () => {
    mockKeychain[KEY] = JSON.stringify(due());
    const auth = await freshAuth();
    await auth.loadSession();
    mockFetch = reply(400, { error: 'invalid_grant' });
    expect(await auth.validToken()).toBeNull();
    expect(auth.currentSession()).toBeNull();
    expect(mockNotes.join('\n')).toMatch(/nothing newer is stored: signed out/);
  });

  it('keeps the sign-in when there is no answer, or the server is in trouble', async () => {
    mockKeychain[KEY] = JSON.stringify(due());
    const auth = await freshAuth();
    await auth.loadSession();
    mockFetch = async () => {
      throw new Error('offline');
    };
    expect(await auth.validToken()).toBe('access-1');
    mockFetch = reply(503);
    expect(await auth.validToken()).toBe('access-1');
    expect(auth.currentSession()).not.toBeNull();
    expect(mockKeychain[KEY]).toBeTruthy();
  });

  it('a good refresh is saved, readable after the first unlock', async () => {
    mockKeychain[KEY] = JSON.stringify(due());
    const auth = await freshAuth();
    await auth.loadSession();
    mockFetch = reply(200, { access_token: 'access-3', refresh_token: 'refresh-3', expires_in: 3600 });
    expect(await auth.validToken()).toBe('access-3');
    const last = mockWrites[mockWrites.length - 1];
    expect(JSON.parse(last.value ?? '{}')).toMatchObject({ accessToken: 'access-3', refreshToken: 'refresh-3' });
    expect((last.options as { keychainAccessible?: string }).keychainAccessible).toBe('after-first-unlock');
  });
});
