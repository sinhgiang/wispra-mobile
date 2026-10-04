import Constants from 'expo-constants';

// Wispra Cloud: the same server and Supabase project as Wispra on the computer. The Supabase key
// is the public "anon" key (it only lets a user sign in as themselves); no secret is in the app.
interface CloudConfig {
  apiBase: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

const extra = Constants.expoConfig?.extra as { wispraCloud?: Partial<CloudConfig> } | undefined;

export const cloud: CloudConfig = {
  apiBase: extra?.wispraCloud?.apiBase ?? 'https://wispra-web.vercel.app',
  supabaseUrl: extra?.wispraCloud?.supabaseUrl ?? '',
  supabasePublishableKey: extra?.wispraCloud?.supabasePublishableKey ?? '',
};

// Sign-in goes through the page Wispra on the computer already uses: Supabase sends the browser to
// wispra-web's /auth/callback, which hands the session to the app through a wispra:// link.
export const AUTH_REDIRECT = 'https://wispra-web.vercel.app/auth/callback';
export const APP_AUTH_URL = 'wispra://auth';

export function authorizeUrl(): string {
  const params = new URLSearchParams({ provider: 'google', redirect_to: AUTH_REDIRECT });
  return `${cloud.supabaseUrl}/auth/v1/authorize?${params.toString()}`;
}
