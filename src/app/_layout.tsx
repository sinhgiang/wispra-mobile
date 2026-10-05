import { DarkTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { W } from '@/constants/wispra';
import { loadSession } from '@/lib/cloud-auth';
import { KeyboardSessionBridge } from '@/components/wispra/keyboard-session-bridge';
import { EntriesProvider, useEntries } from '@/lib/entries-store';
import { shouldShowGuide } from '@/lib/setup-guide';
import { STACK_SCREEN_OPTIONS } from '@/lib/stack-options';
import { guideSeen, markGuideSeen } from '@/lib/storage';
import { syncTranscribeLanguage } from '@/lib/transcribe-language-store';
import { useSetupStateBase } from '@/lib/use-setup';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: W.bg, card: W.bg, text: W.text, border: W.line, primary: W.accent },
};

// Another account signed in: the choice screen comes up, and stays until the user chooses
function AskAccountChoice() {
  const { accountChoice } = useEntries();
  const waiting = accountChoice !== null;
  useEffect(() => {
    if (waiting) router.push('/account-switch');
  }, [waiting]);
  return null;
}

// The first-run guide opens by itself once, unless everything is set up already (T-0145). The
// account question, when there is one, comes first.
function OpenGuideOnce() {
  const { loaded, accountChoice } = useEntries();
  const { state } = useSetupStateBase();
  const show = loaded && accountChoice === null && shouldShowGuide(guideSeenSafe(), state);
  useEffect(() => {
    if (!show) return;
    try {
      markGuideSeen();
    } catch {
      // Opens again next time; nothing else is affected
    }
    router.push('/welcome');
  }, [show]);
  return null;
}

function guideSeenSafe(): boolean {
  try {
    return guideSeen();
  } catch {
    return true;
  }
}

function HideSplashWhenLoaded() {
  const { loaded } = useEntries();
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);
  return null;
}

export default function RootLayout() {
  // The Wispra Cloud sign-in kept from last time
  useEffect(() => {
    void loadSession();
    // The Android keyboard and mic button learn the language chosen in Account
    syncTranscribeLanguage();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <EntriesProvider>
        <HideSplashWhenLoaded />
        <AskAccountChoice />
        <OpenGuideOnce />
        <KeyboardSessionBridge />
        <StatusBar style="light" />
        <Stack screenOptions={STACK_SCREEN_OPTIONS}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="meeting/record" options={{ gestureEnabled: false }} />
          <Stack.Screen name="meeting/[id]" />
          <Stack.Screen name="account-switch" options={{ gestureEnabled: false }} />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="keyboard-session" />
        </Stack>
      </EntriesProvider>
    </ThemeProvider>
  );
}
