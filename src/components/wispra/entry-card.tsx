import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmDelete } from './confirm-delete';
import { Button } from './ui';

import { Gap, W } from '@/constants/wispra';
import { formatDuration, formatTime, needsTranscription, previewText, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { deleteOneWarning } from '@/lib/history-delete';
import { useSession } from '@/lib/use-session';

// Touch and hold an entry to delete it, after a warning that says where it is deleted
function useDelete(entry: Entry): () => void {
  const { remove } = useEntries();
  const session = useSession();
  return () => confirmDelete(deleteOneWarning(entry, !!session), () => remove(entry.id));
}

export function EntryCard({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  if (needsTranscription(entry)) return <PendingCard entry={entry} onPress={onPress} />;
  return <DoneCard entry={entry} onPress={onPress} />;
}

function DoneCard({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  const askDelete = useDelete(entry);
  const meeting = entry.kind === 'meeting';
  // MTG a meeting, PC a dictation made with Wispra on the computer, DIC one made on this phone
  const tag = meeting ? 'MTG' : entry.source === 'computer' ? 'PC' : 'DIC';
  const tagColor = meeting ? W.green : entry.source === 'computer' ? W.amberSoft : W.accentSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Touch and hold to delete"
      onPress={onPress}
      onLongPress={entry.status === 'recording' ? undefined : askDelete}
      style={styles.card}>
      <View style={styles.tag}>
        <Text style={[styles.tagText, { color: tagColor }]}>{tag}</Text>
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
  const { retry, busy: transcribing } = useEntries();
  const askDelete = useDelete(entry);
  const busy = transcribing.has(entry.id);

  const tryAgain = () => void retry(entry.id);


  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.pending}>
      <Text style={styles.pendingTitle}>
        {entry.kind === 'meeting' || entry.title !== 'Dictation' ? entry.title : 'Recording'} not transcribed yet ·{' '}
        {formatDuration(entry.durationMs)}
      </Text>
      <Text style={styles.pendingNote}>{busy ? 'Transcribing with Wispra Cloud…' : (entry.error ?? entry.segments?.find((s) => s.error)?.error ?? 'The audio is kept on this phone.')}</Text>
      <View style={styles.actions}>
        <Button small kind="primary" label={busy ? 'Trying…' : 'Try again'} disabled={busy} onPress={tryAgain} />
        <Button small label="Delete" onPress={askDelete} />
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
