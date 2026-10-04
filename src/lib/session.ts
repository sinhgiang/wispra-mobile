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
