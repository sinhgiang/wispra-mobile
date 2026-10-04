import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PendingCard } from '@/components/wispra/entry-card';
import { ActionList, MeetingPlayer, MindMapView, SummaryText, TabChips } from '@/components/wispra/meeting-views';
import { Body, Button, Card, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDate, formatDuration, meetingLines, needsTranscription, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { formatClock } from '@/lib/meeting';
import { useSession } from '@/lib/use-session';

type Tab = 'summary' | 'transcript' | 'mindmap' | 'post';
const TABS: { value: Tab; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'mindmap', label: 'Mind map' },
  { value: 'post', label: 'Post' },
];

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, remove, busy } = useEntries();
  const entry = entries.find((e) => e.id === id);
  const [tab, setTab] = useState<Tab>('summary');
  const [seek, setSeek] = useState<{ ms: number; n: number } | undefined>();

  if (!entry) {
    return (
      <SafeAreaView style={[ui.screen, styles.missing]}>
        <Text style={styles.cardTitle}>This meeting is no longer here.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const share = () => {
    const text = [entry.title, entry.notes?.summary || entry.text || ''].filter(Boolean).join('\n\n');
    void Share.share({ message: text });
  };

  const confirmDelete = () =>
    Alert.alert('Delete this meeting?', 'The recording, its text and notes are removed from this phone.', [
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

  const playFrom = (ms: number) => setSeek((prev) => ({ ms, n: (prev?.n ?? 0) + 1 }));

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={share} style={styles.round}>
            <Text style={styles.shareText}>↗</Text>
          </Pressable>
        </View>

        <TabChips tabs={TABS} value={tab} onChange={setTab} />

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {needsTranscription(entry) ? <PendingCard entry={entry} /> : null}
          {tab === 'summary' ? <SummaryTab entry={entry} working={busy.has(entry.id)} /> : null}
          {tab === 'transcript' ? <TranscriptTab entry={entry} onPlay={playFrom} /> : null}
          {tab === 'mindmap' ? <MindMapTab entry={entry} working={busy.has(entry.id)} /> : null}
          {tab === 'post' ? <PostTab entry={entry} working={busy.has(entry.id)} /> : null}
          <MeetingPlayer entry={entry} seekRequest={seek} />
          <Button label="Delete meeting" onPress={confirmDelete} />
        </ScrollView>

        <AskBar entry={entry} working={busy.has(entry.id)} onAsked={() => setTab('summary')} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NeedsText({ entry }: { entry: Entry }) {
  const session = useSession();
  return (
    <Card>
      <Body style={styles.note}>
        {!session
          ? 'Sign in to Wispra Cloud in Account: the meeting is transcribed and written up there.'
          : entry.status === 'recording'
            ? 'Notes are written once the meeting stops.'
            : 'Notes are written once the meeting is transcribed.'}
      </Body>
    </Card>
  );
}

function NotesError({ entry, onRetry }: { entry: Entry; onRetry: () => void }) {
  if (!entry.notes?.error) return null;
  return (
    <Card style={styles.errorCard}>
      <Text style={styles.errorText}>{entry.notes.error}</Text>
      <View style={ui.row}>
        <Button small kind="primary" label="Try again" onPress={onRetry} />
      </View>
    </Card>
  );
}

function SummaryTab({ entry, working }: { entry: Entry; working: boolean }) {
  const { makeNotes, updateNotes } = useEntries();
  const notes = entry.notes;
  const hasText = meetingLines(entry).length > 0;
  const toggle = (i: number) =>
    updateNotes(entry.id, { actions: (notes?.actions ?? []).map((a, j) => (j === i ? { ...a, done: !a.done } : a)) });

  return (
    <>
      {notes?.qa && notes.qa.length > 0 ? (
        <Card>
          <Text style={styles.section}>Your questions</Text>
          {notes.qa.map((t, i) => (
            <View key={`${t.askedAt}-${i}`} style={styles.qa}>
              <Text style={styles.question}>{t.question}</Text>
              <Text style={styles.text}>{t.answer}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <NotesError entry={entry} onRetry={() => void makeNotes(entry.id)} />

      {notes?.summary ? (
        <Card>
          <Text style={styles.section}>Summary</Text>
          <SummaryText text={notes.summary} />
        </Card>
      ) : !hasText ? (
        <NeedsText entry={entry} />
      ) : working ? (
        <Card>
          <Body style={styles.note}>Writing the meeting notes…</Body>
        </Card>
      ) : notes?.summary === undefined && !notes?.error ? (
        <Card>
          <Body style={styles.note}>The summary has not been written yet.</Body>
          <View style={ui.row}>
            <Button small kind="primary" label="Write the notes" onPress={() => void makeNotes(entry.id)} />
          </View>
        </Card>
      ) : null}

      {notes?.actions && notes.actions.length > 0 ? (
        <Card>
          <Text style={styles.section}>Action items</Text>
          <ActionList actions={notes.actions} onToggle={toggle} />
        </Card>
      ) : null}

      {notes?.topics && notes.topics.length > 0 ? (
        <Card>
          <Text style={styles.section}>Topics</Text>
          <View style={styles.tags}>
            {notes.topics.map((t, i) => (
              <Text key={`${t.title}-${i}`} style={styles.tag}>
                {t.title}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
    </>
  );
}

function TranscriptTab({ entry, onPlay }: { entry: Entry; onPlay: (ms: number) => void }) {
  const pieces = useMemo(() => [...(entry.segments ?? [])].sort((a, b) => a.startMs - b.startMs), [entry.segments]);
  if (!entry.segments) {
    return entry.text ? (
      <Card>
        <Text style={styles.text}>{entry.text}</Text>
      </Card>
    ) : (
      <NeedsText entry={entry} />
    );
  }
  if (pieces.every((p) => !p.text)) return <NeedsText entry={entry} />;
  return (
    <Card>
      {pieces.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" accessibilityHint="Plays from here" onPress={() => onPlay(p.startMs)} style={styles.line}>
          <Text style={styles.time}>{formatClock(p.startMs)}</Text>
          {p.text ? (
            <Text style={styles.text}>{p.text}</Text>
          ) : (
            <Text style={styles.waiting}>{p.status === 'failed' ? 'Could not transcribe this part; the audio is kept.' : p.status === 'done' ? '(nothing said)' : 'Not transcribed yet'}</Text>
          )}
        </Pressable>
      ))}
    </Card>
  );
}

function MindMapTab({ entry, working }: { entry: Entry; working: boolean }) {
  const { makeMindMapFor } = useEntries();
  if (meetingLines(entry).length === 0) return <NeedsText entry={entry} />;
  const map = entry.notes?.mindMap;
  return (
    <>
      <NotesError entry={entry} onRetry={() => void makeMindMapFor(entry.id)} />
      {map ? (
        <MindMapView map={map} />
      ) : (
        <Card>
          <Body style={styles.note}>A map of the whole meeting: its topics and key points, decisions, action items and open questions.</Body>
          <View style={ui.row}>
            <Button small kind="primary" label={working ? 'Making the mind map…' : 'Make the mind map'} disabled={working} onPress={() => void makeMindMapFor(entry.id)} />
          </View>
        </Card>
      )}
      {map ? (
        <View style={ui.row}>
          <Button small label={working ? 'Making…' : 'Make it again'} disabled={working} onPress={() => void makeMindMapFor(entry.id)} />
        </View>
      ) : null}
    </>
  );
}

function PostTab({ entry, working }: { entry: Entry; working: boolean }) {
  const { makePostFor } = useEntries();
  if (meetingLines(entry).length === 0) return <NeedsText entry={entry} />;
  const post = entry.notes?.post;
  return (
    <>
      <NotesError entry={entry} onRetry={() => void makePostFor(entry.id)} />
      {post ? (
        <Card>
          <Text style={styles.text}>{post}</Text>
          <View style={ui.row}>
            <Button small kind="primary" label="Share" onPress={() => void Share.share({ message: post })} />
            <Button small label={working ? 'Writing…' : 'Write it again'} disabled={working} onPress={() => void makePostFor(entry.id)} />
          </View>
        </Card>
      ) : (
        <Card>
          <Body style={styles.note}>A ready-to-post write-up for LinkedIn or Facebook, from what was said. Check it before you share it.</Body>
          <View style={ui.row}>
            <Button small kind="primary" label={working ? 'Writing the post…' : 'Write a post'} disabled={working} onPress={() => void makePostFor(entry.id)} />
          </View>
        </Card>
      )}
    </>
  );
}

function AskBar({ entry, working, onAsked }: { entry: Entry; working: boolean; onAsked: () => void }) {
  const { ask } = useEntries();
  const [question, setQuestion] = useState('');
  const ready = meetingLines(entry).length > 0;
  const send = async () => {
    const q = question.trim();
    if (!q || working) return;
    setQuestion('');
    onAsked();
    await ask(entry.id, q);
  };
  return (
    <View style={styles.ask}>
      <TextInput
        accessibilityLabel="Ask about this meeting"
        placeholder={ready ? (working ? 'Thinking…' : 'Ask about this meeting…') : 'Ask once the meeting is transcribed'}
        placeholderTextColor={W.faint}
        editable={ready && !working}
        value={question}
        onChangeText={setQuestion}
        onSubmitEditing={send}
        returnKeyType="send"
        style={styles.askInput}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!ready || working || !question.trim()} onPress={send} style={[styles.send, (!ready || !question.trim()) && { opacity: 0.5 }]}>
        <Text style={styles.sendText}>↑</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Gap.m, paddingHorizontal: Gap.xl, paddingTop: Gap.xl, paddingBottom: Gap.xs },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: W.surface, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: W.text, fontSize: 22, lineHeight: 24 },
  shareText: { color: W.text, fontSize: 15 },
  headText: { flex: 1, minWidth: 0 },
  title: { color: W.text, fontSize: 18, fontWeight: '700' },
  meta: { color: W.muted, fontSize: 12 },
  body: { paddingHorizontal: Gap.xl, paddingBottom: Gap.l, gap: Gap.m },
  section: { color: W.accentSoft, fontSize: 13, fontWeight: '600' },
  text: { color: W.text, fontSize: 14, lineHeight: 21 },
  waiting: { color: W.faint, fontSize: 14, lineHeight: 21 },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  line: { gap: 3, paddingVertical: 4 },
  time: { color: W.accentSoft, fontSize: 12, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Gap.s },
  tag: { color: '#c3c8d4', fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: W.surfaceRaised, overflow: 'hidden' },
  qa: { gap: 4, marginTop: 4 },
  question: { color: W.accentSoft, fontSize: 13, fontWeight: '600' },
  errorCard: { borderWidth: 1, borderColor: W.red, backgroundColor: 'transparent' },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 19 },
  ask: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: Gap.xl, paddingTop: Gap.s, paddingBottom: Gap.l },
  askInput: { flex: 1, height: 48, borderRadius: 24, borderWidth: 1, borderColor: W.lineStrong, backgroundColor: W.surface, color: W.text, paddingHorizontal: 16, fontSize: 14 },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#ffffff', fontSize: 18 },
  missing: { padding: Gap.xl, gap: Gap.l, justifyContent: 'center' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
});
