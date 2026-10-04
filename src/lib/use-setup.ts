import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { needsTranscription } from './entries';
import { useEntries } from './entries-store';
import type { SetupState } from './setup-guide';
import { useSession } from './use-session';
import { isServiceEnabled } from '@/modules/wispra-dictation';
import { keyboardStatus, type KeyboardStatus } from '@/modules/wispra-keyboard-bridge';

// What is set up on this phone, read again when Wispra comes back from Settings or another app
// (where the keyboard is turned on and used). Works outside screens (the root layout).
export function useSetupStateBase(): { state: SetupState; refresh: () => void } {
  const session = useSession();
  const { entries } = useEntries();
  const [keyboard, setKeyboard] = useState<KeyboardStatus | null>(null);
  const [bubbleOn, setBubbleOn] = useState(false);

  const refresh = useCallback(() => {
    if (Platform.OS === 'ios') void keyboardStatus().then(setKeyboard);
    else setBubbleOn(isServiceEnabled());
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const waiting = useMemo(() => entries.filter(needsTranscription).length, [entries]);
  const state: SetupState = {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    signedIn: !!session,
    keyboard: Platform.OS === 'ios' ? (keyboard ?? { enabled: null, lastSeenAt: null }) : null,
    bubbleOn,
    waiting,
  };
  return { state, refresh };
}

// In a screen: also read again whenever the screen comes into view
export function useSetupState(): SetupState {
  const { state, refresh } = useSetupStateBase();
  useFocusEffect(refresh);
  return state;
}
