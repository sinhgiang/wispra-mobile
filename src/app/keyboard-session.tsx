import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, MicGlyph, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { useEntries } from '@/lib/entries-store';
import { minutesLeft, sessionLabel } from '@/lib/keyboard-session';
import { loadSessionMinutes } from '@/lib/storage';
import { endSession, onSessionState, sessionState, startSession, type SessionState } from '@/modules/wispra-keyboard-bridge';

// Opened by the Wispra keyboard's purple mic when no listening session runs (T-0145). Apple only
// lets the app, not the keyboard, start the microphone, so the session starts here at once, with
// the length chosen in Account (T-0163: no choice to make each time), and the screen says one
// thing: go back to the app you were typing in. Each use of the keyboard's mic keeps it going.
export default function KeyboardSessionScreen() {
  const { cloudAllowed } = useEntries();
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const allowed = cloudAllowed();
  const minutes = loadSessionMinutes();

  useEffect(() => {
    void sessionState().then(setState);
    const sub = onSessionState(setState);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      sub?.remove();
      clearInterval(tick);
    };
  }, []);

  // Opened from the keyboard: the session starts at once
  useEffect(() => {
    if (started.current || !allowed) return;
    started.current = true;
    startSession(minutes)
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [allowed, minutes]);

  const active = !!state?.active;
  const left = state ? minutesLeft(state.until, now) : 0;

  if (!allowed) {
    return (
      <SafeAreaView style={[ui.screen, styles.screen]}>
        <View style={styles.centre}>
          <Text style={styles.title}>Sign in first</Text>
          <Body style={styles.text}>
            The Wispra keyboard's mic turns your voice into text with Wispra Cloud. Sign in in Account (or answer the question about
            your accounts), then tap the mic on the keyboard again.
          </Body>
          <Button kind="primary" label="Open Account" onPress={() => router.replace('/account')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[ui.screen, styles.screen]}>
      {/* Where iPhone puts the way back to the app the keyboard was in */}
      <View style={styles.back}>
        <Text style={styles.backArrow}>↖</Text>
        <Text style={styles.backText}>{active ? 'Tap ◀ up here to go back to your app' : 'Starting…'}</Text>
      </View>

      <View style={styles.centre}>
        <View style={[styles.ring, active && styles.ringOn]}>
          <View style={[styles.mic, active && styles.micOn]}>
            <MicGlyph size={36} />
          </View>
        </View>
        <Text style={styles.title}>{active ? 'Wispra is listening for the keyboard' : 'Starting the listening session…'}</Text>
        <Body style={styles.text}>
          Back in your app, tap the purple mic on the Wispra keyboard and speak. Tap the red mic when you are done: the words appear
          where the cursor is.
        </Body>
        {active ? (
          <View style={styles.dot}>
            <View style={styles.dotMark} />
            <Text style={styles.dotText}>{`${left} min left · goes on while you use the mic`}</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.foot}>
        <Body style={styles.note}>
          {`Sessions last ${sessionLabel(minutes)} (change it in Account). Only what you say while the keyboard's mic is red is sent to Wispra Cloud; iPhone shows the orange dot while the session runs.`}
        </Body>
        {active ? <Button label="End session" onPress={() => void endSession().then(setState)} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Gap.xl, gap: Gap.l },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: W.accentDeep, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  backArrow: { color: W.text, fontSize: 22, fontWeight: '700' },
  backText: { color: W.text, fontSize: 15, fontWeight: '600' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Gap.l },
  ring: { width: 120, height: 120, borderRadius: 60, backgroundColor: W.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  ringOn: { backgroundColor: W.accentDeep },
  mic: { width: 88, height: 88, borderRadius: 44, backgroundColor: W.faint, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: W.accent },
  title: { color: W.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  text: { color: W.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  dot: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2a1d0b', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  dotMark: { width: 8, height: 8, borderRadius: 4, backgroundColor: W.amber },
  dotText: { color: W.amberSoft, fontSize: 13, fontWeight: '600' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
  foot: { gap: Gap.m },
  note: { color: W.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
