import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard } from '@/components/wispra/note-card';
import { Body, Button, Card, Label, MicGlyph, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration, sortEntries } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { NOTE_TEXT } from '@/lib/notes';
import { transcriptionAvailable } from '@/lib/transcriber';
import { useRecording } from '@/lib/use-recording';

// Notes (T-0979): say an idea; it is saved on the phone at once, then written out, named and shared
// with Wispra Cloud when there is a connection
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
      <FlatList
        data={notes}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Title>{NOTE_TEXT.title}</Title>
            <Card style={styles.recorder}>
              {live ? (
                <>
                  <View style={ui.row}>
                    <View style={styles.dot} />
                    <Text style={styles.live}>
                      {NOTE_TEXT.listening} · {formatDuration(rec.durationMs)}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={NOTE_TEXT.stop} onPress={finish} style={styles.stop}>
                    <View style={styles.square} />
                  </Pressable>
                  <Button label={NOTE_TEXT.cancel} onPress={rec.cancel} />
                </>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={NOTE_TEXT.start}
                    disabled={rec.phase === 'starting'}
                    onPress={begin}
                    style={styles.mic}>
                    <MicGlyph size={30} />
                  </Pressable>
                  <Label style={styles.center}>{NOTE_TEXT.micHint}</Label>
                </>
              )}
              {rec.error ? <Text style={styles.error}>{rec.error}</Text> : null}
              {savedId && !live ? (
                <Text style={styles.saved}>{transcriptionAvailable() ? NOTE_TEXT.transcribing : NOTE_TEXT.needSignIn}</Text>
              ) : null}
            </Card>
          </View>
        }
        renderItem={({ item }) => (
          <NoteCard entry={item} onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })} />
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
  header: { gap: Gap.l, paddingTop: Gap.xl + 16, paddingBottom: Gap.s },
  list: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xl, gap: Gap.s + 2 },
  recorder: { alignItems: 'center', paddingVertical: 22, gap: Gap.m },
  mic: { width: 72, height: 72, borderRadius: 36, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' },
  stop: { width: 72, height: 72, borderRadius: 36, backgroundColor: W.red, alignItems: 'center', justifyContent: 'center' },
  square: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#ffffff' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  live: { color: W.red, fontSize: 14, fontWeight: '600' },
  center: { textAlign: 'center' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
  saved: { color: W.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  emptyNote: { color: W.muted, fontSize: 13, lineHeight: 19 },
});
