import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, MicGlyph, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { useEntries } from '@/lib/entries-store';
import { DEFAULT_SESSION_MINUTES, minutesLeft, SESSION_CHOICES } from '@/lib/keyboard-session';
import { endSession, onSessionState, sessionState, startSession, type SessionState } from '@/modules/wispra-keyboard-bridge';

// Opened by the Wispra keyboard's purple mic when no listening session runs (T-0145). Starts one:
// the microphone keeps running in the background, so back in the other app the keyboard's mic
// takes dictation in place. Apple only lets the app, not the keyboard, start the microphone.
export default function KeyboardSessionScreen() {
  const { cloudAllowed } = useEntries();
  const [state, setState] = useState<SessionState | null>(null);
  const [minutes, setMinutes] = useState<number>(DEFAULT_SESSION_MINUTES);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const allowed = cloudAllowed();

  const start = async (m: number) => {
    setMinutes(m);
    setError(null);
    try {
      setState(await startSession(m));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
    void start(DEFAULT_SESSION_MINUTES);
    // Once, when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

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
      <View style={styles.centre}>
        <View style={[styles.ring, active && styles.ringOn]}>
          <View style={[styles.mic, active && styles.micOn]}>
            <MicGlyph size={36} />
          </View>
        </View>
        <Text style={styles.title}>{active ? 'Listening session on' : 'Starting the listening session…'}</Text>
        <Body style={styles.text}>
          Go back to your app: tap ◀ at the top left of the screen. Tap the small purple mic on the Wispra keyboard and speak; the
          words appear where the cursor is. Tap the red mic again when you are done.
        </Body>
        {active ? (
          <View style={styles.dot}>
            <View style={styles.dotMark} />
            <Text style={styles.dotText}>{`${left} min left · iPhone shows the orange mic dot`}</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Card style={styles.card}>
        <Text style={styles.label}>Session length</Text>
        <View style={styles.choices}>
          {SESSION_CHOICES.map((m) => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: minutes === m }}
              onPress={() => void start(m)}
              style={[styles.choice, minutes === m && styles.choiceOn]}>
              <Text style={styles.choiceText}>{m === 60 ? '1 hour' : `${m} min`}</Text>
            </Pressable>
          ))}
        </View>
        <Body style={styles.note}>
          Only what you say while the keyboard's mic is red is sent to Wispra Cloud. The microphone stays open in the background
          until the session ends, which is why iPhone shows the orange dot.
        </Body>
        {active ? <Button label="End session" onPress={() => void endSession().then(setState)} /> : null}
      </Card>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Gap.xl, gap: Gap.l },
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
  card: { gap: Gap.m },
  label: { color: W.text, fontSize: 15, fontWeight: '600' },
  choices: { flexDirection: 'row', gap: Gap.s },
  choice: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: W.lineStrong, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: W.accent, borderWidth: 2, backgroundColor: W.surfaceRaised },
  choiceText: { color: W.text, fontSize: 14 },
  note: { color: W.muted, fontSize: 12, lineHeight: 18 },
});
