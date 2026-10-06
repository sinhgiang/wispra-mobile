import * as WebBrowser from 'expo-web-browser';

import { signInWithTokens } from './cloud-auth';
import { APP_AUTH_URL, authorizeUrl } from './cloud-config';
import { parseAuthCallback } from './session';

export type SignInResult = { ok: true } | { ok: false; cancelled: boolean; error?: string };

// The same tokens can arrive twice: as the result of the browser session and as a link opened in
// the app. Only the first one is used.
const used = new Set<string>();

export async function finishSignIn(url: string): Promise<SignInResult> {
  const tokens = parseAuthCallback(url);
  if (!tokens) return { ok: false, cancelled: false, error: 'The sign-in link was incomplete. Try again.' };
  if (used.has(tokens.refreshToken)) return { ok: true };
  used.add(tokens.refreshToken);
  try {
    await signInWithTokens(tokens);
    return { ok: true };
  } catch (err) {
    used.delete(tokens.refreshToken);
    return { ok: false, cancelled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Google sign-in in the system browser, then back to the app through wispra://auth
export async function signInWithGoogle(): Promise<SignInResult> {
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl(), APP_AUTH_URL);
  if (result.type === 'success') return finishSignIn(result.url);
  return { ok: false, cancelled: true };
}

// A wispra://auth link that reached the app outside the browser session (for example after the
// app was closed during sign-in). Handled once the app is running.
export function handleAuthLink(url: string): void {
  void finishSignIn(url);
}
