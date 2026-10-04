import { DarkTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { W } from '@/constants/wispra';
import { loadSession } from '@/lib/cloud-auth';
import { EntriesProvider, useEntries } from '@/lib/entries-store';

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
  }, []);

  return (
    <ThemeProvider value={theme}>
      <EntriesProvider>
        <HideSplashWhenLoaded />
        <AskAccountChoice />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: W.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="meeting/record" options={{ gestureEnabled: false }} />
          <Stack.Screen name="meeting/[id]" />
          <Stack.Screen name="account-switch" options={{ gestureEnabled: false }} />
        </Stack>
      </EntriesProvider>
    </ThemeProvider>
  );
}
