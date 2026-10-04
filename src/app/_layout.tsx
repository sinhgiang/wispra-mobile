import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { W } from '@/constants/wispra';
import { EntriesProvider, useEntries } from '@/lib/entries-store';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: W.bg, card: W.bg, text: W.text, border: W.line, primary: W.accent },
};

function HideSplashWhenLoaded() {
  const { loaded } = useEntries();
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);
  return null;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <EntriesProvider>
        <HideSplashWhenLoaded />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: W.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="meeting/record" options={{ gestureEnabled: false }} />
          <Stack.Screen name="meeting/[id]" />
        </Stack>
      </EntriesProvider>
    </ThemeProvider>
  );
}
