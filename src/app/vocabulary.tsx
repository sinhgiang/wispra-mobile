import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { loadVocabulary, saveVocabulary } from '@/lib/storage';
import { addTerms, removeTerm } from '@/lib/vocabulary';

// The computer's words, on this screen too (Settings › Dictate › Custom vocabulary there)
export const VOCABULARY_HINT =
  'Add proper nouns, names, or technical terms to spell exactly — e.g. “Nguyễn Văn A”, “GPT-4o”. Speech recognition listens for them, and when it writes one differently (“git hub”, “Nguyen Van A”) Wispra puts your spelling back — in Dictate, Meeting and the keyboard. Only words that were said are respelled.';
export const VOCABULARY_EMPTY = 'No custom terms yet.';

// Account › Custom vocabulary (T-0182): the list is used by every transcription: the keyboard's mic, the mic
// button and meetings.
export default function VocabularyScreen() {
  const [terms, setTerms] = useState<string[]>(() => loadVocabulary());
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = (next: string[]) => {
    try {
      saveVocabulary(next);
      setTerms(next);
      setError(null);
    } catch {
      setError('Could not save the list.');
    }
  };
  const add = () => {
    if (input.trim()) change(addTerms(terms, input));
    setInput('');
  };

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button small label="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Title>Custom vocabulary</Title>
        <Body style={styles.hint}>{VOCABULARY_HINT}</Body>

        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel="Add a word or phrase"
            placeholder="Add a word or phrase…"
            placeholderTextColor={W.faint}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={add}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Button small kind="primary" label="Add" disabled={!input.trim()} onPress={add} />
        </View>
        <Body style={styles.hint}>A pasted list works too: separate the terms with commas or lines.</Body>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {terms.length === 0 ? (
          <Body style={styles.hint}>{VOCABULARY_EMPTY}</Body>
        ) : (
          <Card style={styles.list}>
            {terms.map((term) => (
              <View key={term} style={styles.item}>
                <Text style={styles.term}>{term}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${term}`} onPress={() => change(removeTerm(terms, term))} hitSlop={10}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  hint: { color: W.muted, fontSize: 13, lineHeight: 19 },
  addRow: { flexDirection: 'row', gap: Gap.s, alignItems: 'center' },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: W.surface, color: W.text, fontSize: 15 },
  error: { color: W.red, fontSize: 13 },
  list: { gap: 0, padding: 0 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  term: { flex: 1, color: W.text, fontSize: 15 },
  remove: { color: W.muted, fontSize: 16, paddingLeft: Gap.m },
});
