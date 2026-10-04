import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './ui';

import { Gap, W } from '@/constants/wispra';
import { formatDuration, formatTime, needsTranscription, previewText, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';

export function EntryCard({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  if (needsTranscription(entry)) return <PendingCard entry={entry} onPress={onPress} />;
  const meeting = entry.kind === 'meeting';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
      <View style={styles.tag}>
        <Text style={[styles.tagText, { color: meeting ? W.green : W.accentSoft }]}>{meeting ? 'MTG' : 'DIC'}</Text>
      </View>
      <View style={styles.main}>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.status === 'recording' ? `${entry.title} · recording` : entry.title}
          </Text>
          <Text style={styles.time}>{formatTime(entry.createdAt)}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={2}>
          {previewText(entry)}
        </Text>
      </View>
    </Pressable>
  );
}

// A recording whose words are not text yet. It is never dropped: it stays here until it is
// transcribed or the user deletes it.
export function PendingCard({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  const { retry, remove, busy: transcribing } = useEntries();
  const busy = transcribing.has(entry.id);

  const tryAgain = () => void retry(entry.id);

  const confirmDelete = () =>
    Alert.alert('Delete this recording?', 'The audio has not been transcribed. It cannot be brought back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
    ]);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pending}>
      <Text style={styles.pendingTitle}>
        {entry.kind === 'meeting' || entry.title !== 'Dictation' ? entry.title : 'Recording'} not transcribed yet ·{' '}
        {formatDuration(entry.durationMs)}
      </Text>
      <Text style={styles.pendingNote}>{busy ? 'Transcribing with Wispra Cloud…' : (entry.error ?? 'The audio is kept on this phone.')}</Text>
      <View style={styles.actions}>
        <Button small kind="primary" label={busy ? 'Trying…' : 'Try again'} disabled={busy} onPress={tryAgain} />
        <Button small label="Delete" onPress={confirmDelete} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: Gap.m, padding: 14, borderRadius: 14, backgroundColor: W.surface, alignItems: 'flex-start' },
  tag: { width: 36, height: 36, borderRadius: 10, backgroundColor: W.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  tagText: { fontSize: 12, fontWeight: '700' },
  main: { flex: 1, minWidth: 0, gap: 3 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: Gap.s },
  title: { flex: 1, color: W.text, fontSize: 14, fontWeight: '600' },
  time: { color: W.muted, fontSize: 12 },
  preview: { color: W.muted, fontSize: 13, lineHeight: 19 },
  pending: { padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: W.amber, gap: 6 },
  pendingTitle: { color: W.amberSoft, fontSize: 13, fontWeight: '600' },
  pendingNote: { color: W.muted, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: Gap.s, marginTop: 2 },
});
