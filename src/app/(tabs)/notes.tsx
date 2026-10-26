import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryCard } from '@/components/wispra/entry-card';
import { SetupReminders } from '@/components/wispra/setup-reminders';
import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration, sortEntries } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { NOTE_TEXT } from '@/lib/notes';
import { transcriptionAvailable } from '@/lib/transcriber';
import { useRecording } from '@/lib/use-recording';

// Notes (T-0979), laid out like the Meetings tab: a title, one button, then the list of cards. Say an
// idea; it is saved on the phone at once, then written out, named and shared with Wispra Cloud when
// there is a connection.
export default function NotesScreen() {
  const rec = useRecording('note');
  const { entries } = useEntries();
  const [savedId, setSavedId] = useState<string | null>(null);
  const notes = useMemo(() => sortEntries(entries.filter((e) => e.kind === 'note')), [entries]);
  const live = rec.phase === 'recording' || rec.phase === 'paused' || rec.phase === 'saving';

  const begin = async () => {
    setSavedId(null);
    await rec.start();
  };
  const finish = async () => setSavedId(await rec.stop());

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <View style={styles.header}>
        <Title>{NOTE_TEXT.title}</Title>
        <SetupReminders />
        {live ? (
          <View style={styles.live}>
            <View style={ui.row}>
              <View style={styles.dot} />
              <Text style={styles.liveText}>
                {NOTE_TEXT.listening} · {formatDuration(rec.durationMs)}
              </Text>
            </View>
            <View style={ui.row}>
              <Button kind="danger" label={NOTE_TEXT.stop} disabled={rec.phase === 'saving'} onPress={finish} />
              <Button label={NOTE_TEXT.cancel} onPress={rec.cancel} />
            </View>
          </View>
        ) : (
          <Button kind="primary" label={NOTE_TEXT.record} disabled={rec.phase === 'starting'} onPress={begin} />
        )}
        {rec.error ? <Text style={styles.error}>{rec.error}</Text> : null}
        {savedId && !live ? <Text style={styles.saved}>{transcriptionAvailable() ? NOTE_TEXT.transcribing : NOTE_TEXT.needSignIn}</Text> : null}
      </View>
      <FlatList
        data={notes}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <EntryCard entry={item} onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })} />
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyTitle}>{NOTE_TEXT.listEmptyTitle}</Text>
            <Body style={styles.emptyNote}>{NOTE_TEXT.listEmptyNote}</Body>
          </Card>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  list: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xl, gap: Gap.s + 2 },
  live: { gap: Gap.m },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  liveText: { color: W.red, fontSize: 14, fontWeight: '600' },
  error: { color: W.red, fontSize: 13 },
  saved: { color: W.muted, fontSize: 13, lineHeight: 19 },
  emptyTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  emptyNote: { color: W.muted, fontSize: 13, lineHeight: 19 },
});
