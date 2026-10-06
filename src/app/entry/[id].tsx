import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmDelete } from '@/components/wispra/confirm-delete';
import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDate, formatDuration, formatTime } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { deleteOneWarning } from '@/lib/history-delete';
import { learnNote } from '@/lib/lexicon';
import { useSession } from '@/lib/use-session';

// What the computer's History shows under a text being fixed
export const EDIT_HINT = 'Fix the words Wispra got wrong. It learns your spelling from what you change.';
const COPIED_MS = 1500;

// A dictation opened from History (T-0179): all of its words, Copy, and Edit, which teaches Wispra
// the words that were fixed, as on the computer.
export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, fixEntry, remove } = useEntries();
  const session = useSession();
  const entry = entries.find((e) => e.id === id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!entry) {
    return (
      <SafeAreaView style={[ui.screen, styles.missing]}>
        <Text style={styles.missingText}>This dictation is no longer here.</Text>
        <Button label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/history'))} />
      </SafeAreaView>
    );
  }

  const text = entry.text ?? '';
  const copy = () => {
    // The current text: the fixed one when it was fixed
    void Clipboard.setStringAsync(text).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => setNote({ text: 'Could not copy the text.', error: true }),
    );
  };
  const startEdit = () => {
    setDraft(text);
    setNote(null);
    setEditing(true);
  };
  const save = () => {
    const result = fixEntry(entry.id, draft);
    if (!result.ok) {
      // The editor stays open with what was typed
      setNote({ text: result.error, error: true });
      return;
    }
    setNote({ text: learnNote(result.learned), error: false });
    setEditing(false);
  };
  const askDelete = () =>
    confirmDelete(deleteOneWarning(entry, !!session), () => {
      router.back();
      remove(entry.id);
    });

  const tag = entry.source === 'computer' ? 'Dictated on your computer' : 'Dictated on this phone';

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Button small label="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/history'))} />
          <Title>{entry.title}</Title>
          <Body style={styles.meta}>
            {formatDate(entry.createdAt)}, {formatTime(entry.createdAt)}
            {entry.durationMs > 0 ? ` · ${formatDuration(entry.durationMs)}` : ''} · {tag}
            {entry.originalText !== undefined ? ' · edited' : ''}
          </Body>

          {editing ? (
            <View style={styles.editor}>
              <TextInput
                accessibilityLabel="Text of this dictation"
                value={draft}
                onChangeText={setDraft}
                multiline
                autoFocus
                textAlignVertical="top"
                style={styles.input}
              />
              <Body style={styles.hint}>{EDIT_HINT}</Body>
              <View style={ui.row}>
                <Button small kind="primary" label="Save" disabled={!draft.trim()} onPress={save} />
                <Button small label="Cancel" onPress={() => setEditing(false)} />
              </View>
            </View>
          ) : (
            <Card>
              <Text style={styles.text} selectable>
                {text}
              </Text>
            </Card>
          )}

          {note ? <Text style={[styles.note, note.error && styles.noteError]}>{note.text}</Text> : null}

          {editing ? null : (
            <View style={ui.row}>
              <Button small label="Edit" onPress={startEdit} />
              <Button small label={copied ? 'Copied' : 'Copy'} onPress={copy} />
              <Button small label="Delete" onPress={askDelete} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  meta: { color: W.muted, fontSize: 13 },
  text: { color: W.text, fontSize: 16, lineHeight: 24 },
  editor: { gap: Gap.s },
  input: { minHeight: 140, borderRadius: 14, padding: 14, backgroundColor: W.surface, color: W.text, fontSize: 16, lineHeight: 24 },
  hint: { color: W.muted, fontSize: 13, lineHeight: 19 },
  note: { color: W.green, fontSize: 13, lineHeight: 19 },
  noteError: { color: W.red },
  missing: { alignItems: 'center', justifyContent: 'center', gap: Gap.l },
  missingText: { color: W.text, fontSize: 16 },
});
