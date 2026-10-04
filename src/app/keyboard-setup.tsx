import { requestRecordingPermissionsAsync } from 'expo-audio';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { isKeyboardEnabled, openKeyboardSettings, showKeyboardPicker } from '@/modules/wispra-dictation';

// The Wispra keyboard on Android: what it does, what Android's warning means for it, and the two
// steps to use it (turn it on in Settings, then pick it as the keyboard).
export default function KeyboardSetupScreen() {
  const [enabled, setEnabled] = useState(isKeyboardEnabled);
  const [micDenied, setMicDenied] = useState(false);

  const refresh = useCallback(() => setEnabled(isKeyboardEnabled()), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const turnOn = async () => {
    const mic = await requestRecordingPermissionsAsync();
    setMicDenied(!mic.granted);
    if (mic.granted) openKeyboardSettings();
  };

  return (
    <SafeAreaView style={ui.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.round}>
          <Text style={styles.roundText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Wispra keyboard</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Body style={styles.lead}>
          For apps where the mic button does not show up. Switch to the Wispra keyboard, tap the mic, speak, then tap
          Done: your words are typed where the cursor is. Tap ABC to go back to your usual keyboard.
        </Body>

        <Card>
          <Text style={styles.cardTitle}>About Android&apos;s warning</Text>
          <Body style={styles.note}>
            When you turn on any keyboard, Android warns that it could collect what you type. The Wispra keyboard has no
            letter keys: it only types what you dictate, and it keeps no record of what you type. Each dictation is saved
            in Wispra&apos;s History on this phone, and is sent to Wispra Cloud only to turn it into text. Password fields
            are skipped.
          </Body>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>On the keyboard</Text>
          <Body style={styles.note}>
            Undo takes back the words just typed. Clean up, Formal and English rewrite them with Wispra Cloud&apos;s AI.
            Signed in to Wispra Cloud (Account tab) is needed to type and rewrite.
          </Body>
        </Card>

        <View style={styles.rows}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Turned on in Settings</Text>
            <Text style={[styles.rowValue, enabled && { color: W.green }]}>{enabled ? 'On' : 'Off'}</Text>
          </View>
        </View>

        {micDenied ? <Text style={styles.error}>Wispra needs the microphone to dictate. Allow it in your phone settings.</Text> : null}

        {enabled ? (
          <>
            <Button kind="primary" label="Choose the keyboard" onPress={showKeyboardPicker} />
            <Label style={styles.center}>Pick Wispra keyboard in the list. You can switch back any time with ABC.</Label>
          </>
        ) : (
          <>
            <Button kind="primary" label="Open keyboard settings" onPress={turnOn} />
            <Label style={styles.center}>Turn on Wispra keyboard there, then come back here.</Label>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
  rows: { backgroundColor: W.surface, borderRadius: 16 },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: W.text, fontSize: 14 },
  rowValue: { color: W.muted, fontSize: 13, fontWeight: '600' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
  center: { textAlign: 'center', lineHeight: 18 },
});
