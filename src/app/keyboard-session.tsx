import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, MicGlyph, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { useEntries } from '@/lib/entries-store';
import { minutesLeft, sessionGate, sessionLabel, SPEAK_FLOW } from '@/lib/keyboard-session';
import { loadSessionMinutes, setSessionEndedByUser } from '@/lib/storage';
import { useSession, useSessionLoaded } from '@/lib/use-session';
import { endSession, noteKeyboardLog, onSessionState, sessionState, startSession, type SessionState } from '@/modules/wispra-keyboard-bridge';

// Opened by the Wispra keyboard's purple mic when no listening session runs (T-0145). Apple only
// lets the app, not the keyboard, start the microphone, so the session starts here at once, with
// the length chosen in Account (T-0163: no choice to make each time), and the screen says one
// thing: go back to the app you were typing in. Each use of the keyboard's mic keeps it going.
export default function KeyboardSessionScreen() {
  const { cloudAllowed, loaded: dataLoaded } = useEntries();
  // Look again when the sign-in is read or changes: this screen can open before it is loaded
  const session = useSession();
  const sessionLoaded = useSessionLoaded();
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const allowed = cloudAllowed();
  const gate = sessionGate({ sessionLoaded, dataLoaded, signedIn: session !== null, allowed });
  const minutes = loadSessionMinutes();

  // The keyboard log says what this page decided about the account (never the account itself)
  useEffect(() => {
    noteKeyboardLog(`account: the page the keyboard opens: ${gate} (sign-in read: ${sessionLoaded}, data read: ${dataLoaded}, signed in: ${session !== null})`);
  }, [gate, sessionLoaded, dataLoaded, session]);

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
    if (started.current || gate !== 'ready') return;
    started.current = true;
    // Asked for by the keyboard's mic: the session is wanted again
    setSessionEndedByUser(false);
    startSession(minutes)
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [gate, minutes]);

  const active = !!state?.active;
  const left = state ? minutesLeft(state.until, now) : 0;

  if (gate === 'checking') {
    // Not "Sign in first": the sign-in is being read
    return (
      <SafeAreaView style={[ui.screen, styles.screen]}>
        <View style={styles.centre}>
          <Text style={styles.title}>Checking your account…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (gate === 'choose') {
    return (
      <SafeAreaView style={[ui.screen, styles.screen]}>
        <View style={styles.centre}>
          <Text style={styles.title}>One question first</Text>
          <Body style={styles.text}>
            You are signed in, but the dictations on this phone belong to another account. Answer the question about your accounts,
            then tap the mic on the keyboard again.
          </Body>
          <Button kind="primary" label="Answer the question" onPress={() => router.replace('/account-switch')} />
        </View>
      </SafeAreaView>
    );
  }

  if (gate === 'sign-in') {
    return (
      <SafeAreaView style={[ui.screen, styles.screen]}>
        <View style={styles.centre}>
          <Text style={styles.title}>Sign in first</Text>
          <Body style={styles.text}>
            The Wispra keyboard's mic turns your voice into text with Wispra Cloud. Sign in in Account, then tap the mic on the
            keyboard again.
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
      {/* iOS does not always show ◀ (it depends on how Wispra was opened): the other way back */}
      {active ? <Text style={styles.backAlt}>No ◀? Swipe right along the bottom edge of the screen to go back to the app before.</Text> : null}

      <View style={styles.centre}>
        <View style={[styles.ring, active && styles.ringOn]}>
          <View style={[styles.mic, active && styles.micOn]}>
            <MicGlyph size={36} />
          </View>
        </View>
        <Text style={styles.title}>{active ? 'Wispra is listening for the keyboard' : 'Starting the listening session…'}</Text>
        <Body style={styles.text}>
          {`Back in your app, ${SPEAK_FLOW}`}
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
        {active ? (
          <Button
            label="End session"
            onPress={() => {
              // Stays off until the keyboard's mic asks again; Wispra does not start it by itself
              setSessionEndedByUser(true);
              void endSession().then(setState);
            }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Gap.xl, gap: Gap.l },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: W.accentDeep, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  backArrow: { color: W.text, fontSize: 22, fontWeight: '700' },
  backText: { color: W.text, fontSize: 15, fontWeight: '600' },
  backAlt: { color: W.muted, fontSize: 13, lineHeight: 18 },
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
