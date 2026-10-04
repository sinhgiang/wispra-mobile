import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PendingCard } from '@/components/wispra/entry-card';
import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDate, formatDuration, needsTranscription, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { audioExists } from '@/lib/storage';

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, remove } = useEntries();
  const entry = entries.find((e) => e.id === id);

  if (!entry) {
    return (
      <SafeAreaView style={[ui.screen, styles.missing]}>
        <Text style={styles.cardTitle}>This meeting is no longer here.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const confirmDelete = () =>
    Alert.alert('Delete this meeting?', 'The recording and its text are removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          router.back();
          remove(entry.id);
        },
      },
    ]);

  return (
    <SafeAreaView style={ui.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.round}>
          <Text style={styles.roundText}>‹</Text>
        </Pressable>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.meta}>
            {formatDate(entry.createdAt)} · {formatDuration(entry.durationMs)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {needsTranscription(entry) ? <PendingCard entry={entry} /> : null}
        {entry.text ? (
          <Card>
            <Text style={styles.section}>Transcript</Text>
            <Body>{entry.text}</Body>
          </Card>
        ) : null}
        <Player entry={entry} />
        <Button label="Delete meeting" onPress={confirmDelete} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Player({ entry }: { entry: Entry }) {
  const available = audioExists(entry.audioUri);
  const player = useAudioPlayer(available ? entry.audioUri : null);
  const status = useAudioPlayerStatus(player);

  if (!available) {
    return (
      <Card>
        <Label>Recording</Label>
        <Body style={styles.note}>The audio file is not on this phone.</Body>
      </Card>
    );
  }

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) player.seekTo(0);
      player.play();
    }
  };

  const jump = (ms: number) => {
    player.seekTo(ms / 1000);
    player.play();
  };

  return (
    <Card>
      <Label>Recording</Label>
      <View style={ui.row}>
        <Button small kind="primary" label={status.playing ? 'Pause' : 'Play'} onPress={toggle} />
        <Text style={styles.position}>
          {formatDuration(status.currentTime * 1000)} / {formatDuration((status.duration || entry.durationMs / 1000) * 1000)}
        </Text>
      </View>
      {entry.bookmarks.length > 0 ? (
        <View style={styles.marks}>
          <Text style={styles.section}>Bookmarks</Text>
          {entry.bookmarks.map((ms, i) => (
            <Pressable key={`${ms}-${i}`} accessibilityRole="button" onPress={() => jump(ms)} style={styles.mark}>
              <Text style={styles.markText}>Bookmark {i + 1}</Text>
              <Text style={styles.markTime}>{formatDuration(ms)} ›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Gap.m, paddingHorizontal: Gap.xl, paddingTop: Gap.xl, paddingBottom: Gap.m },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: W.surface, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: W.text, fontSize: 22, lineHeight: 24 },
  headText: { flex: 1, minWidth: 0 },
  title: { color: W.text, fontSize: 18, fontWeight: '700' },
  meta: { color: W.muted, fontSize: 12 },
  body: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xxl, gap: Gap.m },
  section: { color: W.accentSoft, fontSize: 13, fontWeight: '600' },
  note: { color: W.muted, fontSize: 13 },
  position: { color: W.muted, fontSize: 13 },
  marks: { gap: 2, marginTop: Gap.xs },
  mark: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markText: { color: W.text, fontSize: 14 },
  markTime: { color: W.muted, fontSize: 13 },
  missing: { padding: Gap.xl, gap: Gap.l, justifyContent: 'center' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
});
