import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, MicGlyph, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { setupSteps, type StepId } from '@/lib/setup-guide';
import { signInWithGoogle } from '@/lib/sign-in';
import { useSetupState } from '@/lib/use-setup';

// The first-run guide (T-0145): each step with a picture, ticked off as it gets done. Opens by
// itself the first time Wispra starts; Account › How the keyboard works opens it again.
export default function WelcomeScreen() {
  const state = useSetupState();
  const steps = setupSteps(state);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    const result = await signInWithGoogle();
    setSigningIn(false);
    if (!result.ok && !result.cancelled) setError(result.error ?? 'Could not sign in. Try again.');
  };

  const done = (id: StepId) => steps.find((s) => s.id === id)?.done ?? false;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/dictate'));

  return (
    <SafeAreaView style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Set up Wispra</Text>
        <Body style={styles.intro}>
          {state.platform === 'ios'
            ? 'Three steps, about a minute: sign in, add the Wispra keyboard, and switch to it in any app.'
            : 'Two steps: sign in, and turn on the Wispra mic button over other apps.'}
        </Body>

        <Step n={1} title="Sign in to Wispra Cloud" done={done('sign-in')}>
          <Body style={styles.text}>Wispra turns your voice into text with Wispra Cloud. Until you sign in, recordings wait on this phone.</Body>
          {done('sign-in') ? null : (
            <Button kind="primary" label={signingIn ? 'Signing in…' : 'Sign in with Google'} disabled={signingIn} onPress={signIn} />
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Step>

        {state.platform === 'ios' ? (
          <>
            <Step n={2} title="Add the Wispra keyboard" done={done('add-keyboard')}>
              <Body style={styles.text}>Tap Open Settings, then Keyboards, and turn on both switches:</Body>
              <SettingsPicture />
              <Button kind={done('add-keyboard') ? 'secondary' : 'primary'} label="Open Settings" onPress={() => void Linking.openSettings()} />
            </Step>

            <Step n={3} title="Switch to Wispra in any app" done={done('switch-keyboard')}>
              <Body style={styles.text}>
                In Zalo, Messenger or any app, tap where you type. Touch and hold the globe key 🌐 at the bottom left of the keyboard,
                then slide to Wispra and let go.
              </Body>
              <GlobePicture />
              <Body style={styles.text}>
                Keep Wispra as your keyboard: it has every letter and types Vietnamese (Telex), so there is no need to switch back.
                To speak, tap the small purple mic at the top left of the keyboard. Wispra opens to listen (iPhone keyboards cannot
                use the microphone): say your text, tap Done, then tap ◀ at the top left to go back. The keyboard types your words.
              </Body>
            </Step>
          </>
        ) : (
          <Step n={2} title="Turn on the mic button" done={done('mic-button')}>
            <Body style={styles.text}>A small Wispra mic appears over the text field you tap in any app.</Body>
            <Button kind="primary" label="Set up" onPress={() => router.push('/dictation-setup')} />
          </Step>
        )}

        <Button label={steps.every((s) => s.done) ? 'Done' : 'Later'} onPress={close} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <Card style={[styles.step, done && styles.stepDone]}>
      <View style={styles.stepHead}>
        <View style={[styles.badge, done && styles.badgeDone]}>
          <Text style={styles.badgeText}>{done ? '✓' : n}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

// Settings > Wispra > Keyboards, as the owner's screenshot shows it
function SettingsPicture() {
  return (
    <View style={pic.settings} accessible accessibilityLabel="Settings, Keyboards: Wispra on, Allow Full Access on">
      <Text style={pic.settingsHead}>Keyboards</Text>
      <View style={pic.settingsGroup}>
        <View style={pic.row}>
          <Text style={pic.rowText}>Wispra</Text>
          <Switch />
        </View>
        <View style={pic.divider} />
        <View style={pic.row}>
          <Text style={pic.rowText}>Allow Full Access</Text>
          <Switch />
        </View>
      </View>
    </View>
  );
}

function Switch() {
  return (
    <View style={pic.switch}>
      <View style={pic.knob} />
    </View>
  );
}

// An iPhone keyboard with the globe key held and the list of keyboards open on Wispra
function GlobePicture() {
  const keys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
  return (
    <View style={pic.keyboard} accessible accessibilityLabel="Hold the globe key, the list of keyboards opens, choose Wispra">
      <View style={pic.menu}>
        <Text style={pic.menuItem}>English (US)</Text>
        <Text style={pic.menuItem}>Tiếng Việt</Text>
        <View style={pic.menuPick}>
          <MicGlyph size={14} />
          <Text style={pic.menuPickText}>Wispra</Text>
        </View>
      </View>
      <View style={pic.keyRow}>
        {keys.map((k) => (
          <View key={k} style={pic.key}>
            <Text style={pic.keyText}>{k}</Text>
          </View>
        ))}
      </View>
      <View style={pic.keyRow}>
        <View style={[pic.key, pic.wide]}>
          <Text style={pic.keyText}>123</Text>
        </View>
        <View style={[pic.key, pic.space]}>
          <Text style={pic.keyText}>space</Text>
        </View>
        <View style={[pic.key, pic.wide]}>
          <Text style={pic.keyText}>return</Text>
        </View>
      </View>
      <View style={pic.bottom}>
        <View style={pic.globe}>
          <Text style={pic.globeText}>🌐</Text>
        </View>
        <Text style={pic.hold}>touch and hold</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.l },
  title: { color: W.text, fontSize: 26, fontWeight: '700' },
  intro: { color: W.muted, fontSize: 14, lineHeight: 21 },
  text: { color: W.muted, fontSize: 13, lineHeight: 19 },
  error: { color: W.red, fontSize: 12 },
  step: { gap: Gap.m },
  stepDone: { opacity: 0.75 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: Gap.s },
  stepTitle: { color: W.text, fontSize: 16, fontWeight: '600', flex: 1 },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: W.green },
  badgeText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});

const pic = StyleSheet.create({
  settings: { backgroundColor: '#f2f2f7', borderRadius: 12, padding: 12, gap: 8 },
  settingsHead: { color: '#000000', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  settingsGroup: { backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  rowText: { color: '#000000', fontSize: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#c6c6c8' },
  switch: { width: 40, height: 24, borderRadius: 12, backgroundColor: '#34c759', justifyContent: 'center', alignItems: 'flex-end', padding: 2 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff' },
  keyboard: { backgroundColor: '#d1d3d9', borderRadius: 12, padding: 6, gap: 6 },
  menu: { position: 'absolute', left: 6, bottom: 44, zIndex: 1, backgroundColor: '#f9f9f9', borderRadius: 10, paddingVertical: 4, minWidth: 140, elevation: 3 },
  menuItem: { color: '#000000', fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
  menuPick: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: W.accent, paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 4, borderRadius: 6 },
  menuPickText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  keyRow: { flexDirection: 'row', gap: 4 },
  key: { flex: 1, height: 30, borderRadius: 5, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#000000', fontSize: 12 },
  wide: { flex: 2, backgroundColor: '#adb1ba' },
  space: { flex: 5 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 52 },
  globe: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: W.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  globeText: { fontSize: 18 },
  hold: { color: '#3a3a3c', fontSize: 12, fontWeight: '600' },
});
