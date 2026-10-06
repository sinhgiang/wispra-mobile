// A Wispra Cloud sign-in. The same JSON shape is stored for the Android mic-button service
// (CloudSession.kt), so both sides can use and refresh it.
export interface Session {
  accessToken: string;
  refreshToken: string;
  // Unix milliseconds
  expiresAt: number;
  userId: string;
  email: string;
  avatarUrl?: string;
}

export interface CallbackTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// wispra://auth#access_token=...&refresh_token=...&expires_in=3600 (or the same in the query)
export function parseAuthCallback(url: string): CallbackTokens | null {
  if (!/^wispra(mobile)?:\/\/auth\b/i.test(url)) return null;
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const raw = hash >= 0 ? url.slice(hash + 1) : query >= 0 ? url.slice(query + 1) : '';
  const params = new URLSearchParams(raw);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const expiresIn = Number.parseInt(params.get('expires_in') ?? '3600', 10);
  return { accessToken, refreshToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 };
}

// Refresh five minutes before the access token runs out
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(session: Session, now: number = Date.now()): boolean {
  return session.expiresAt - now < REFRESH_MARGIN_MS;
}

// A refresh the server turned down (HTTP 400 or 401). Refresh tokens work once, and the sign-in is kept in
// one place that the app, and on Android the mic-button service, both refresh: so a refusal often only means
// that someone else refreshed first (T-0182). What to do then:
// - the stored sign-in has another refresh token: it was refreshed meanwhile, use it (a new try if it is already due)
// - the same token: the server really does not know it any more, the sign-in is over
export type Refusal = { kind: 'use'; session: Session } | { kind: 'retry'; session: Session } | { kind: 'sign-out' };

export function afterRefusal(sentRefreshToken: string, storedNow: Session | null, now: number = Date.now()): Refusal {
  if (!storedNow || storedNow.refreshToken === sentRefreshToken) return { kind: 'sign-out' };
  return needsRefresh(storedNow, now) ? { kind: 'retry', session: storedNow } : { kind: 'use', session: storedNow };
}

export function parseSession(json: string | null | undefined): Session | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<Session>;
    if (typeof v.accessToken !== 'string' || typeof v.refreshToken !== 'string' || typeof v.expiresAt !== 'number') return null;
    return {
      accessToken: v.accessToken,
      refreshToken: v.refreshToken,
      expiresAt: v.expiresAt,
      userId: typeof v.userId === 'string' ? v.userId : '',
      email: typeof v.email === 'string' ? v.email : '',
      avatarUrl: typeof v.avatarUrl === 'string' ? v.avatarUrl : undefined,
    };
  } catch {
    return null;
  }
}
