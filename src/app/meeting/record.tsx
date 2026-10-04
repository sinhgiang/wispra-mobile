import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionList, TabChips } from '@/components/wispra/meeting-views';
import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { formatClock } from '@/lib/meeting';
import { useLiveNotes } from '@/lib/use-live-notes';
import { useMeetingRecording } from '@/lib/use-meeting-recording';
import { useSession } from '@/lib/use-session';

type Tab = 'transcript' | 'topics' | 'actions';
const TABS: { value: Tab; label: string }[] = [
  { value: 'transcript', label: 'Transcript' },
  { value: 'topics', label: 'Topics' },
  { value: 'actions', label: 'Actions' },
];

export default function RecordMeetingScreen() {
  const rec = useMeetingRecording();
  const { entries, update } = useEntries();
  const session = useSession();
  const [tab, setTab] = useState<Tab>('transcript');
  const started = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const entry = entries.find((e) => e.id === rec.entryId);
  const running = rec.phase === 'recording' || rec.phase === 'paused';
  useLiveNotes(entry, running);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void rec.start();
    // Starts once when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = async () => {
    const id = await rec.stop();
    if (id) router.replace({ pathname: '/meeting/[id]', params: { id } });
    else router.back();
  };

  // Leaving the screen would end the recorders, so the back button asks first
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

  const pieces = useMemo(() => [...(entry?.segments ?? [])].sort((a, b) => a.startMs - b.startMs), [entry?.segments]);
  const actions = entry?.notes?.actions ?? [];
  const topics = entry?.notes?.topics ?? [];
  const latestAction = actions[actions.length - 1];

  if (rec.phase === 'idle' && rec.error && !entry) {
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
            {paused ? 'Paused' : rec.phase === 'saving' ? 'Saving' : 'Recording'} · {formatDuration(rec.elapsedMs)}
          </Text>
          <Text style={styles.live}>{session ? 'Live transcript' : 'Sign in for live transcript'}</Text>
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

      <TabChips tabs={TABS} value={tab} onChange={setTab} />

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.body}
        onContentSizeChange={() => tab === 'transcript' && scroll.current?.scrollToEnd({ animated: true })}>
        {tab === 'transcript' ? (
          pieces.length === 0 || pieces.every((p) => !p.text) ? (
            <Body style={styles.note}>
              {session
                ? 'The transcript appears here about every half minute while you talk. The audio is saved on this phone and keeps recording when the screen locks.'
                : 'The audio is saved on this phone and keeps recording when the screen locks. Sign in to Wispra Cloud in Account to see the transcript while you talk; otherwise it is made after the meeting.'}
            </Body>
          ) : (
            pieces.map((p) => (
              <View key={p.id} style={styles.line}>
                <Text style={styles.time}>{formatClock(p.startMs)}</Text>
                {p.text ? (
                  <Text style={styles.text}>{p.text}</Text>
                ) : (
                  <Text style={styles.waiting}>{p.status === 'failed' ? 'Could not transcribe this part; the audio is kept.' : p.status === 'done' ? '…' : 'Listening…'}</Text>
                )}
              </View>
            ))
          )
        ) : null}

        {tab === 'topics' ? (
          topics.length === 0 ? (
            <Body style={styles.note}>Topics show up here every minute or two while the meeting goes on.</Body>
          ) : (
            topics.map((t, i) => (
              <View key={`${t.title}-${i}`} style={styles.line}>
                <Text style={styles.time}>{formatClock(t.startMs)}</Text>
                <Text style={styles.text}>{t.title}</Text>
              </View>
            ))
          )
        ) : null}

        {tab === 'actions' ? (
          actions.length === 0 ? (
            <Body style={styles.note}>Tasks someone takes on in the meeting show up here.</Body>
          ) : (
            <ActionList actions={actions} />
          )
        ) : null}

        {entry && entry.bookmarks.length > 0 ? (
          <Card>
            <Label>Bookmarks</Label>
            {entry.bookmarks.map((ms, i) => (
              <Text key={`${ms}-${i}`} style={styles.text}>
                Bookmark {i + 1} · {formatClock(ms)}
              </Text>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      {latestAction && tab !== 'actions' ? (
        <Pressable accessibilityRole="button" onPress={() => setTab('actions')} style={styles.spotted}>
          <Text style={styles.spottedLabel}>Action item spotted</Text>
          <Text style={styles.text}>
            {latestAction.owner ? `${latestAction.owner}: ` : ''}
            {latestAction.text}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.controls}>
        <Button label={paused ? 'Resume' : 'Pause'} disabled={!running} onPress={paused ? rec.resume : rec.pause} />
        <Pressable accessibilityRole="button" accessibilityLabel="Stop recording" disabled={!running} onPress={finish} style={styles.stop}>
          <View style={styles.square} />
        </Pressable>
        <Button label="Bookmark" disabled={!running} onPress={rec.bookmark} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Gap.xl, paddingTop: Gap.xxl, paddingBottom: Gap.xs, gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  status: { color: W.red, fontSize: 13, fontWeight: '600' },
  live: { marginLeft: 'auto', color: W.muted, fontSize: 12 },
  title: { color: W.text, fontSize: 22, fontWeight: '700', padding: 0 },
  body: { paddingHorizontal: Gap.xl, paddingBottom: Gap.l, gap: Gap.l },
  line: { gap: 4 },
  time: { color: W.accentSoft, fontSize: 12, fontWeight: '600' },
  text: { color: W.text, fontSize: 15, lineHeight: 23 },
  waiting: { color: W.faint, fontSize: 15, lineHeight: 23 },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  spotted: { marginHorizontal: Gap.xl, marginBottom: Gap.m, padding: 14, borderRadius: 12, backgroundColor: W.surface, borderWidth: 1, borderColor: W.line, gap: 6 },
  spottedLabel: { color: W.muted, fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Gap.xl, paddingTop: Gap.s, paddingBottom: Gap.xxl },
  stop: { width: 72, height: 72, borderRadius: 36, backgroundColor: W.red, alignItems: 'center', justifyContent: 'center' },
  square: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#ffffff' },
  failed: { padding: Gap.xl, gap: Gap.l, justifyContent: 'center' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
});
