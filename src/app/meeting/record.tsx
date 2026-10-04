import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { useRecording } from '@/lib/use-recording';

export default function RecordMeetingScreen() {
  const rec = useRecording('meeting');
  const { get, update } = useEntries();
  const started = useRef(false);
  const entry = rec.entryId ? get(rec.entryId) : undefined;
  const running = rec.phase === 'recording' || rec.phase === 'paused';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void rec.start();
    // Starts once when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen would end the recorder, so the back button asks first
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running) return false;
      Alert.alert('Stop the recording?', 'The meeting recorded so far is saved.', [
        { text: 'Keep recording', style: 'cancel' },
        { text: 'Stop and save', onPress: finish },
      ]);
      return true;
    });
    return () => sub.remove();
  });

  const finish = async () => {
    const id = await rec.stop();
    if (id) router.replace({ pathname: '/meeting/[id]', params: { id } });
    else router.back();
  };

  if (rec.phase === 'idle' && rec.error) {
    return (
      <SafeAreaView style={[ui.screen, styles.failed]}>
        <Card>
          <Text style={styles.cardTitle}>Could not start recording</Text>
          <Body style={styles.note}>{rec.error}</Body>
        </Card>
        <Button label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const paused = rec.phase === 'paused';

  return (
    <SafeAreaView style={ui.screen}>
      <View style={styles.header}>
        <View style={ui.row}>
          <View style={[styles.dot, paused && { backgroundColor: W.amber }]} />
          <Text style={[styles.status, paused && { color: W.amber }]}>
            {paused ? 'Paused' : rec.phase === 'saving' ? 'Saving' : 'Recording'} · {formatDuration(rec.durationMs)}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Meeting title"
          value={entry?.title ?? ''}
          onChangeText={(title) => entry && update(entry.id, { title })}
          style={styles.title}
          placeholder="Meeting title"
          placeholderTextColor={W.faint}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Card>
          <Label>Live transcript</Label>
          <Body style={styles.note}>
            The audio is being saved on this phone and keeps recording when the screen locks. When you stop, it is
            transcribed with Wispra Cloud if you are signed in. Live transcript, topics and action items come in the
            next update.
          </Body>
        </Card>
        {entry && entry.bookmarks.length > 0 ? (
          <Card>
            <Label>Bookmarks</Label>
            {entry.bookmarks.map((ms, i) => (
              <Text key={`${ms}-${i}`} style={styles.bookmark}>
                Bookmark {i + 1} · {formatDuration(ms)}
              </Text>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <View style={styles.controls}>
        <Button label={paused ? 'Resume' : 'Pause'} disabled={!running} onPress={paused ? rec.resume : rec.pause} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
          disabled={!running}
          onPress={finish}
          style={styles.stop}>
          <View style={styles.square} />
        </Pressable>
        <Button label="Bookmark" disabled={!running} onPress={rec.bookmark} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Gap.xl, paddingTop: Gap.xxl, paddingBottom: Gap.m, gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  status: { color: W.red, fontSize: 13, fontWeight: '600' },
  title: { color: W.text, fontSize: 22, fontWeight: '700', padding: 0 },
  body: { paddingHorizontal: Gap.xl, gap: Gap.m },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  bookmark: { color: W.text, fontSize: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Gap.xl, paddingTop: Gap.s, paddingBottom: Gap.xxl },
  stop: { width: 72, height: 72, borderRadius: 36, backgroundColor: W.red, alignItems: 'center', justifyContent: 'center' },
  square: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#ffffff' },
  failed: { padding: Gap.xl, gap: Gap.l, justifyContent: 'center' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
});
