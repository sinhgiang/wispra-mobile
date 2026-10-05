import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryCard } from '@/components/wispra/entry-card';
import { SetupReminders } from '@/components/wispra/setup-reminders';
import { Button, Card, Label, MicGlyph, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration, sortEntries } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { transcriptionAvailable } from '@/lib/transcriber';
import { useRecording } from '@/lib/use-recording';

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
        {/* Only the sign-in reminder, while signed out. The keyboard (iPhone) and the mic button
            (Android) are set up from Account (T-0154). */}
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

const styles = StyleSheet.create({
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
  list: { gap: Gap.s + 2 },
});
