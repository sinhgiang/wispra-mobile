import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { currentSession } from '@/lib/cloud-auth';
import { useEntries } from '@/lib/entries-store';
import { onWordsChanged } from '@/lib/lexicon-dirty';
import { useSession } from '@/lib/use-session';
import { syncWords, type Account } from '@/lib/words-sync-store';

// A change of the lists is shared a few seconds later (one run for a burst of changes); the app coming to the
// front, and a clock while it is open, pick up what the other device did
const SOON_MS = 5_000;
const EVERY_MS = 10 * 60_000;

// Keeps the Custom Vocabulary and Learned words the same on the phone and the computer (T-0193). It runs when
// Wispra Cloud may be used for this phone's data (signed in, no question about two accounts waiting), so
// another account's words never go to this one.
export function WordsSync() {
  const { cloudAllowed, loaded } = useEntries();
  const session = useSession();
  const allowedNow = useRef(cloudAllowed);
  allowedNow.current = cloudAllowed;
  const account = useRef<Account>(() => {
    const s = currentSession();
    return s && allowedNow.current() ? { userId: s.userId } : null;
  });
  const ready = loaded && session !== null && cloudAllowed();

  // As soon as it may: after the sign-in, after the account question, at the start
  useEffect(() => {
    if (ready) void syncWords(account.current);
  }, [ready, session?.userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offChange = onWordsChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncWords(account.current), SOON_MS);
    });
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncWords(account.current);
    });
    const clock = setInterval(() => void syncWords(account.current), EVERY_MS);
    return () => {
      offChange();
      state.remove();
      clearInterval(clock);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
