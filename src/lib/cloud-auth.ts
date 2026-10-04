import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { cloud } from './cloud-config';
import { needsRefresh, parseSession, type CallbackTokens, type Session } from './session';
import * as NativeDictation from '@/modules/wispra-dictation';

// Where the sign-in is kept. On Android it is in the app's private storage through the native
// module, so the mic-button service (which runs without the app's JavaScript) uses the same
// sign-in. On iPhone it is in the Keychain.
const SECURE_KEY = 'wispra.session';

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
  if (json) await SecureStore.setItemAsync(SECURE_KEY, json);
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

export async function loadSession(): Promise<Session | null> {
  if (NativeDictation.bubbleSupported) NativeDictation.setCloudConfig(cloud.apiBase, cloud.supabaseUrl, cloud.supabasePublishableKey);
  const session = await readStored();
  loaded = true;
  publish(session);
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
    // Offline: keep the sign-in, try again later
    return stored.expiresAt > Date.now() ? stored : null;
  }
  if (response.status === 400 || response.status === 401) {
    await signOut();
    return null;
  }
  if (!response.ok) return stored.expiresAt > Date.now() ? stored : null;
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
