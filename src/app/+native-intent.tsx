import { handleAuthLink } from '@/lib/sign-in';

// wispra://auth#access_token=... is the end of the Wispra Cloud sign-in, not a screen: finish the
// sign-in and show the Account tab. Every other link opens as usual.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^wispra(mobile)?:\/\/auth\b/i.test(path)) {
      handleAuthLink(path);
      return '/account';
    }
    return path;
  } catch {
    return '/';
  }
}
