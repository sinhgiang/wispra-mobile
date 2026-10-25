import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmDelete } from './confirm-delete';
import { Button } from './ui';

import { Gap, W } from '@/constants/wispra';
import { needsTranscription, previewText, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { deleteOneWarning } from '@/lib/history-delete';
import { formatNoteDate, NOTE_TEXT, statusLabel, statusOf, type NoteStatus } from '@/lib/notes';
import { useSession } from '@/lib/use-session';

// The colour of a status chip, as in the design: new in the accent, kept grey, developing green, the
// others amber
export function statusColors(status: NoteStatus): { bg: string; fg: string } {
  switch (status) {
    case 'keep':
      return { bg: W.line, fg: W.muted };
    case 'develop':
      return { bg: '#1b3a2a', fg: W.green };
    case 'project':
    case 'remind':
      return { bg: '#3a2d18', fg: W.amberSoft };
    default:
      return { bg: '#272a52', fg: W.accentSoft };
  }
}

export function StatusPill({ status, short = true }: { status: NoteStatus; short?: boolean }) {
  const c = statusColors(status);
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{statusLabel(status, short)}</Text>
    </View>
  );
}

// Touch and hold a note to delete it, after a warning that says where it is deleted
function useDelete(entry: Entry): () => void {
  const { remove } = useEntries();
  const session = useSession();
  return () => confirmDelete(deleteOneWarning(entry, !!session), () => remove(entry.id));
}

export function NoteCard({ entry, onPress }: { entry: Entry; onPress?: () => void }) {
  const { retry, busy } = useEntries();
  const askDelete = useDelete(entry);
  const waiting = needsTranscription(entry);
  const working = busy.has(entry.id);

  if (waiting || entry.status === 'recording') {
    return (
      <View style={styles.pending}>
        <Text style={styles.pendingTitle}>{entry.title}</Text>
        <Text style={styles.date}>{formatNoteDate(entry.createdAt)}</Text>
        <Text style={styles.pendingNote}>
          {entry.status === 'recording'
            ? NOTE_TEXT.saved
            : working
              ? NOTE_TEXT.transcribing
              : (entry.error ?? NOTE_TEXT.savedWaiting)}
        </Text>
        {entry.status !== 'recording' ? (
          <View style={styles.actions}>
            <Button small kind="primary" label={working ? 'Đang thử…' : 'Thử lại'} disabled={working} onPress={() => void retry(entry.id)} />
            <Button small label="Xóa" onPress={askDelete} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" accessibilityHint="Giữ lâu để xóa" onPress={onPress} onLongPress={askDelete} style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        {entry.title}
      </Text>
      <Text style={styles.date}>{formatNoteDate(entry.createdAt)}</Text>
      <View style={styles.chips}>
        {entry.note?.domain ? (
          <View style={[styles.chip, { backgroundColor: '#272a52' }]}>
            <Text style={[styles.chipText, { color: W.accentSoft }]}>{entry.note.domain}</Text>
          </View>
        ) : null}
        <StatusPill status={statusOf(entry)} />
      </View>
      {working ? <Text style={styles.working}>Đang viết…</Text> : null}
      {!entry.note?.domain && !working ? (
        <Text style={styles.preview} numberOfLines={2}>
          {previewText(entry)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 14, backgroundColor: W.surface, gap: 4 },
  title: { color: W.text, fontSize: 15, fontWeight: '600' },
  date: { color: W.muted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99 },
  chipText: { fontSize: 11 },
  working: { color: W.muted, fontSize: 12 },
  preview: { color: W.muted, fontSize: 13, lineHeight: 19 },
  pending: { padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: W.amber, gap: 4 },
  pendingTitle: { color: W.amberSoft, fontSize: 14, fontWeight: '600' },
  pendingNote: { color: W.muted, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: Gap.s, marginTop: 4 },
});
