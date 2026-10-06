import { useSyncExternalStore } from 'react';

import { currentSession, sessionLoaded, subscribe } from './cloud-auth';
import type { Session } from './session';

// The current Wispra Cloud sign-in, updated when it changes
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}

// Whether the saved sign-in has been read: until then "no sign-in" means "not known yet"
export function useSessionLoaded(): boolean {
  return useSyncExternalStore(subscribe, sessionLoaded, sessionLoaded);
}
