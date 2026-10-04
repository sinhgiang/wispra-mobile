import { useSyncExternalStore } from 'react';

import { currentSession, subscribe } from './cloud-auth';
import type { Session } from './session';

// The current Wispra Cloud sign-in, updated when it changes
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}
