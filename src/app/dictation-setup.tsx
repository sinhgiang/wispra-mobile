import { requestRecordingPermissionsAsync } from 'expo-audio';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import {
  isBubbleEnabled,
  isServiceEnabled,
  openAccessibilitySettings,
  setBubbleEnabled,
} from '@/modules/wispra-dictation';

// Shown before the user is sent to Settings > Accessibility: what the mic button does, what the
// Accessibility permission lets Wispra see, and what it never does. Google Play requires this
// disclosure, and the user's consent, before an app asks for Accessibility.
export default function DictationSetupScreen() {
  const [serviceOn, setServiceOn] = useState(isServiceEnabled);
  const [bubbleOn, setBubbleOn] = useState(isBubbleEnabled);
  const [micDenied, setMicDenied] = useState(false);

  const refresh = useCallback(() => {
    setServiceOn(isServiceEnabled());
    setBubbleOn(isBubbleEnabled());
  }, []);

  // Coming back from Settings
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const agree = async () => {
    const mic = await requestRecordingPermissionsAsync();
    if (!mic.granted) {
      setMicDenied(true);
      return;
    }
    setMicDenied(false);
    openAccessibilitySettings();
  };

  const toggleBubble = (on: boolean) => {
    setBubbleEnabled(on);
    setBubbleOn(on);
  };

  return (
    <SafeAreaView style={ui.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.round}>
          <Text style={styles.roundText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Mic button in any app</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Body style={styles.lead}>
          Tap a text field in any app, such as Messenger, Zalo or Gmail, and a small Wispra mic appears just above it. Tap
          the mic, speak, then tap ■. Your phone&apos;s keyboard stays as it is.
        </Body>

        <Card>
          <Text style={styles.cardTitle}>Why Wispra asks for Accessibility</Text>
          <Body style={styles.note}>
            Android lets an app place a button next to another app&apos;s text field, and type into it, only through an
            Accessibility service. Wispra uses it for exactly that:
          </Body>
          <Bullet>It looks at the text field you tapped: where it is, its text and the cursor.</Bullet>
          <Bullet>It shows the mic button there, and types your dictated words at the cursor.</Bullet>
          <Body style={[styles.note, styles.gapTop]}>And it does not:</Body>
          <Bullet>read anything else on your screen;</Bullet>
          <Bullet>listen or record until you tap the mic, and it stops when you tap ■ or Cancel;</Bullet>
          <Bullet>collect, store or share what you type. Password fields are skipped.</Bullet>
          <Body style={[styles.note, styles.gapTop]}>
            Each dictation is saved in Wispra&apos;s History on this phone. You can turn the service off at any time in
            Settings, or hide the button below.
          </Body>
        </Card>

        <Card style={styles.notice}>
          <Text style={styles.noticeText}>
            Your words are typed into the field once you are signed in to Wispra Cloud (Account tab). Without
            sign-in, each dictation waits in History and is transcribed later.
          </Text>
        </Card>

        <View style={styles.rows}>
          <View style={[styles.row, styles.rowLine]}>
            <Text style={styles.rowLabel}>Wispra mic button service</Text>
            <Text style={[styles.rowValue, serviceOn && { color: W.green }]}>{serviceOn ? 'On' : 'Off'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, !serviceOn && { color: W.muted }]}>Show the mic button</Text>
            <Switch
              accessibilityLabel="Show the mic button"
              value={bubbleOn}
              onValueChange={toggleBubble}
              disabled={!serviceOn}
              trackColor={{ true: W.accent, false: W.lineStrong }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {micDenied ? (
          <Text style={styles.error}>Wispra needs the microphone to dictate. Allow it in your phone settings.</Text>
        ) : null}

        {serviceOn ? (
          <Label style={styles.center}>All set. Open any app and tap a text field.</Label>
        ) : (
          <>
            <Button kind="primary" label="Agree and open Settings" onPress={agree} />
            <Label style={styles.center}>
              In Settings, open Installed apps (or Downloaded apps), then Wispra mic button, and turn it on.
            </Label>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.dot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Gap.m, paddingHorizontal: Gap.xl, paddingTop: Gap.xl, paddingBottom: Gap.m },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: W.surface, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: W.text, fontSize: 22, lineHeight: 24 },
  title: { color: W.text, fontSize: 20, fontWeight: '700', flex: 1 },
  body: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xxl, gap: Gap.l },
  lead: { color: W.text, fontSize: 15, lineHeight: 22 },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  gapTop: { marginTop: Gap.xs },
  bullet: { flexDirection: 'row', gap: Gap.s, paddingRight: Gap.s },
  dot: { color: W.accentSoft, fontSize: 13, lineHeight: 19 },
  bulletText: { flex: 1, color: W.text, fontSize: 13, lineHeight: 19 },
  notice: { borderWidth: 1, borderColor: W.amber, backgroundColor: 'transparent' },
  noticeText: { color: W.amberSoft, fontSize: 13, lineHeight: 19 },
  rows: { backgroundColor: W.surface, borderRadius: 16 },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLine: { borderBottomWidth: 1, borderBottomColor: W.line },
  rowLabel: { color: W.text, fontSize: 14 },
  rowValue: { color: W.muted, fontSize: 13, fontWeight: '600' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
  center: { textAlign: 'center', lineHeight: 18 },
});
