import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryCard } from '@/components/wispra/entry-card';
import { SetupReminders } from '@/components/wispra/setup-reminders';
import { Body, Button, Card, Label, MicGlyph, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration, sortEntries } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { transcriptionAvailable } from '@/lib/transcriber';
import { useRecording } from '@/lib/use-recording';
import { bubbleSupported, isServiceEnabled } from '@/modules/wispra-dictation';

export default function DictateScreen() {
  const rec = useRecording('dictation');
  const { entries } = useEntries();
  const [savedId, setSavedId] = useState<string | null>(null);
  const recent = useMemo(() => sortEntries(entries.filter((e) => e.kind === 'dictation')).slice(0, 3), [entries]);
  const live = rec.phase === 'recording' || rec.phase === 'paused' || rec.phase === 'saving';

  const begin = async () => {
    setSavedId(null);
    await rec.start();
  };

  const finish = async () => setSavedId(await rec.stop());

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Dictate</Title>
        <SetupReminders screen="dictate" />

        <Card style={styles.recorder}>
          {live ? (
            <>
              <View style={ui.row}>
                <View style={styles.dot} />
                <Text style={styles.live}>Listening · {formatDuration(rec.durationMs)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Stop and save" onPress={finish} style={styles.stop}>
                <View style={styles.square} />
              </Pressable>
              <Button label="Cancel" onPress={rec.cancel} />
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start dictating"
                disabled={rec.phase === 'starting'}
                onPress={begin}
                style={styles.mic}>
                <MicGlyph size={34} />
              </Pressable>
              <Label style={styles.center}>Tap to speak. Tap ■ when you are done.</Label>
            </>
          )}
          {rec.error ? <Text style={styles.error}>{rec.error}</Text> : null}
          {savedId && !live ? (
            <Text style={styles.saved}>
              {transcriptionAvailable()
                ? 'Saved. Transcribing…'
                : 'Saved to History. Sign in to Wispra Cloud in Account to turn it into text.'}
            </Text>
          ) : null}
        </Card>

        <AnyAppCard />

        {recent.length > 0 ? (
          <View style={styles.list}>
            <Label>Recent dictations</Label>
            {recent.map((e) => (
              <EntryCard key={e.id} entry={e} onPress={() => router.push('/history')} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Android: the mic button over other apps' text fields. iPhone: the Wispra keyboard, still to come.
function AnyAppCard() {
  const [on, setOn] = useState(isServiceEnabled);
  useFocusEffect(useCallback(() => setOn(isServiceEnabled()), []));

  if (!bubbleSupported) {
    return (
      <Card>
        <Text style={styles.cardTitle}>Dictate into any app</Text>
        <Body style={styles.note}>
          Use the Wispra keyboard: turn it on in Settings (Keyboards, with Allow Full Access), then in any app touch and hold the
          globe key 🌐 and choose Wispra, and tap Speak.
        </Body>
        <Body style={styles.note}>
          iPhone keyboards cannot use the microphone, so Speak opens Wispra to listen. Tap Done, go back with ◀ at the top
          left, and the keyboard types your words. Full access only lets the keyboard pick up those words; it keeps
          nothing you type.
        </Body>
        <View style={styles.cardAction}>
          <Button small kind="primary" label="Show me how" onPress={() => router.push('/welcome')} />
          <Button small label="Open Settings" onPress={() => void Linking.openSettings()} />
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>Dictate into any app</Text>
        <Text style={[styles.status, on && { color: W.green }]}>{on ? 'On' : 'Off'}</Text>
      </View>
      <Body style={styles.note}>
        {on
          ? 'Tap a text field in any app and the Wispra mic appears above it.'
          : 'Show a Wispra mic above the text field you tap in any app, such as Messenger, Zalo or Gmail.'}
      </Body>
      <View style={styles.cardAction}>
        <Button small kind={on ? 'secondary' : 'primary'} label={on ? 'Settings' : 'Set up'} onPress={() => router.push('/dictation-setup')} />
        <Button small label="Wispra keyboard" onPress={() => router.push('/keyboard-setup')} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { color: W.muted, fontSize: 13, fontWeight: '600' },
  cardAction: { flexDirection: 'row', gap: Gap.s },
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.l },
  recorder: { alignItems: 'center', paddingVertical: 28, gap: Gap.l },
  mic: { width: 88, height: 88, borderRadius: 44, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' },
  stop: { width: 72, height: 72, borderRadius: 36, backgroundColor: W.red, alignItems: 'center', justifyContent: 'center' },
  square: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#ffffff' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  live: { color: W.red, fontSize: 14, fontWeight: '600' },
  center: { textAlign: 'center' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
  saved: { color: W.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  list: { gap: Gap.s + 2 },
});
