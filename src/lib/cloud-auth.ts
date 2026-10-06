import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { cloud } from './cloud-config';
import { afterRefusal, needsRefresh, parseSession, type CallbackTokens, type Session } from './session';
import * as NativeDictation from '@/modules/wispra-dictation';
import { noteKeyboardLog } from '@/modules/wispra-keyboard-bridge';

// Where the sign-in is kept. On Android it is in the app's private storage through the native
// module, so the mic-button service (which runs without the app's JavaScript) uses the same
// sign-in. On iPhone it is in the Keychain.
const SECURE_KEY = 'wispra.session';

// Said in the keyboard log (Account), never the tokens or the address: what the account was doing when the
// keyboard asked for it (T-0182)
function note(text: string): void {
  noteKeyboardLog(`account: ${text}`);
}

async function readStored(): Promise<Session | null> {
  if (NativeDictation.bubbleSupported) return parseSession(NativeDictation.getSession());
  return parseSession(await SecureStore.getItemAsync(SECURE_KEY));
}

async function writeStored(session: Session | null): Promise<void> {
  const json = session ? JSON.stringify(session) : null;
  if (NativeDictation.bubbleSupported) {
    NativeDictation.setSession(json);
    return;
  }
  // After the first unlock, not only while unlocked: the listening session runs with the screen locked, and
  // a sign-in the keychain refuses to give then looks like a signed-out account
  if (json) await SecureStore.setItemAsync(SECURE_KEY, json, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  else await SecureStore.deleteItemAsync(SECURE_KEY);
}

type Listener = (session: Session | null) => void;

let current: Session | null = null;
let loaded = false;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<Listener>();

function publish(session: Session | null) {
  current = session;
  for (const l of listeners) l(session);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentSession(): Session | null {
  return current;
}

// Whether the saved sign-in has been read yet. Until then "no sign-in" only means "not read yet".
export function sessionLoaded(): boolean {
  return loaded;
}

export async function loadSession(): Promise<Session | null> {
  if (NativeDictation.bubbleSupported) NativeDictation.setCloudConfig(cloud.apiBase, cloud.supabaseUrl, cloud.supabasePublishableKey);
  let session: Session | null;
  try {
    session = await readStored();
  } catch (err) {
    // The keychain would not answer (a phone still locked after a restart, say). That is not "signed out":
    // nothing is published, and the next use reads it again.
    note(`the saved sign-in could not be read (${err instanceof Error ? err.message : String(err)})`);
    return current;
  }
  loaded = true;
  note(session ? `read, signed in, token valid for ${Math.max(0, Math.round((session.expiresAt - Date.now()) / 60_000))} min` : 'read, signed out');
  publish(session);
  // Items saved by earlier builds can only be read while unlocked: save it again as readable after first unlock
  if (session && !NativeDictation.bubbleSupported) void writeStored(session).catch(() => undefined);
  return session;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: cloud.supabasePublishableKey, ...extra };
}

// Finishes a sign-in from the tokens in the wispra://auth link
export async function signInWithTokens(tokens: CallbackTokens): Promise<Session> {
  const response = await fetch(`${cloud.supabaseUrl}/auth/v1/user`, {
    headers: authHeaders({ Authorization: `Bearer ${tokens.accessToken}` }),
  });
  if (!response.ok) throw new Error(`Wispra Cloud did not accept the sign-in (HTTP ${response.status}).`);
  const user = (await response.json()) as { id: string; email?: string; user_metadata?: { avatar_url?: string } };
  const session: Session = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    userId: user.id,
    email: user.email ?? '',
    avatarUrl: user.user_metadata?.avatar_url,
  };
  await writeStored(session);
  publish(session);
  return session;
}

export async function signOut(): Promise<void> {
  note('signed out');
  await writeStored(null);
  publish(null);
}

async function refresh(): Promise<Session | null> {
  // The Android service may have refreshed it meanwhile: refresh tokens work only once
  const stored = await readStored();
  if (!stored) {
    publish(null);
    return null;
  }
  if (!needsRefresh(stored)) {
    publish(stored);
    return stored;
  }
  let response: Response;
  try {
    response = await fetch(`${cloud.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ refresh_token: stored.refreshToken }),
    });
  } catch {
    // Offline (or the app was suspended mid-request): keep the sign-in, try again later
    note('refresh did not get an answer (offline): the sign-in is kept');
    return stored.expiresAt > Date.now() ? stored : null;
  }
  if (response.status === 400 || response.status === 401) {
    // Not always "signed out": the sign-in may have been refreshed meanwhile by another side
    const refusal = afterRefusal(stored.refreshToken, await readStored().catch(() => null));
    if (refusal.kind === 'use') {
      note(`refresh refused (HTTP ${response.status}) but the sign-in was refreshed meanwhile: used`);
      publish(refusal.session);
      return refusal.session;
    }
    if (refusal.kind === 'retry') {
      note(`refresh refused (HTTP ${response.status}) but a newer sign-in is stored: trying it`);
      return refresh();
    }
    note(`refresh refused (HTTP ${response.status}) and nothing newer is stored: signed out`);
    await signOut();
    return null;
  }
  if (!response.ok) {
    note(`refresh failed (HTTP ${response.status}): the sign-in is kept`);
    return stored.expiresAt > Date.now() ? stored : null;
  }
  note('token refreshed');
  const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const next: Session = {
    ...stored,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await writeStored(next);
  publish(next);
  return next;
}

// A token for Wispra Cloud, refreshed when it is about to run out. Null when signed out.
export async function validToken(): Promise<string | null> {
  if (!loaded) await loadSession();
  if (!current) return null;
  if (!needsRefresh(current)) return current.accessToken;
  refreshing ??= refresh().finally(() => {
    refreshing = null;
  });
  return (await refreshing)?.accessToken ?? null;
}
