import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { newId } from '@/lib/entries';
import type { LearningSettings } from '@/lib/learning';
import {
  addManualEntry,
  lexiconMode,
  MODE_LABEL,
  MODE_TITLE,
  removeEntry,
  updateEntry,
  type LexiconEntry,
  type LexiconPatch,
} from '@/lib/lexicon';
import { loadLearning, loadLexicon, saveLearning, saveLexicon } from '@/lib/storage';

// The computer's Learned tab words (Settings › Learned), kept the same
export const LEARNED_HINT =
  'Wispra learns your own words from the fixes you make in History (open a dictation and tap Edit): fix a misheard word once and Wispra remembers it; fix it again and it is replaced automatically.';
export const LEARNED_EMPTY = 'Nothing here yet. Words you fix in History or add yourself appear here.';
export const ADD_NOTE =
  'Terms you add here replace the misheard forms right away. The Custom vocabulary list keeps working too.';
const ARMED_MS = 4000;

// Account › Learned (T-0182): the list of the words learned from fixes, as on the computer, with the switch,
// the Add a term form, and per word Pin, Turn off, remove a heard-as form and Delete.
export default function LearnedScreen() {
  const [settings, setSettings] = useState<LearningSettings>(() => loadLearning());
  const [entries, setEntries] = useState<LexiconEntry[]>(() => loadLexicon());
  const [term, setTerm] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const commit = (next: LexiconEntry[]) => {
    try {
      saveLexicon(next);
      setEntries(next);
      setError(null);
    } catch {
      setError('Could not save the change.');
    }
  };
  const toggle = (patch: Partial<LearningSettings>) => {
    const next = { ...settings, ...patch };
    try {
      saveLearning(next);
      setSettings(next);
    } catch {
      setError('Could not save the change.');
    }
  };
  const patch = (id: string, change: LexiconPatch) => commit(updateEntry(entries, id, change));
  const add = () => {
    const forms = heard.split(/[,;\n]/).map((f) => f.trim()).filter(Boolean);
    const result = addManualEntry(entries, term, forms, new Date().toISOString(), newId);
    if (!result.entry) {
      setError('Could not add that term.');
      return;
    }
    commit(result.entries);
    setTerm('');
    setHeard('');
  };
  const clearAll = () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), ARMED_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    commit([]);
  };

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button small label="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Title>Learned</Title>
        <Body style={styles.hint}>{LEARNED_HINT}</Body>

        <Card style={styles.switchCard}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Learn my words</Text>
              <Text style={styles.hint}>When off, Wispra neither learns new words nor applies anything below. Your lists are kept.</Text>
            </View>
            <Switch accessibilityLabel="Learn my words" value={settings.learning} onValueChange={(learning) => toggle({ learning })} />
          </View>
        </Card>

        <Text style={styles.sub}>Add a term</Text>
        <TextInput
          accessibilityLabel="Correct spelling"
          placeholder="Correct spelling — e.g. Claude Code"
          placeholderTextColor={W.faint}
          value={term}
          onChangeText={setTerm}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Often misheard as"
          placeholder="Often misheard as (optional, comma-separated) — e.g. Cloud Code, Clod Code"
          placeholderTextColor={W.faint}
          value={heard}
          onChangeText={setHeard}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <View style={ui.row}>
          <Button small kind="primary" label="Add" disabled={!term.trim()} onPress={add} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Body style={styles.hint}>{ADD_NOTE}</Body>

        <View style={styles.subRow}>
          <Text style={styles.sub}>
            Your words <Text style={styles.count}>{entries.length}</Text>
          </Text>
          {entries.length > 0 ? <Button small label={armed ? 'Click again to clear' : 'Clear all'} kind={armed ? 'danger' : 'secondary'} onPress={clearAll} /> : null}
        </View>
        {entries.length === 0 ? <Body style={styles.hint}>{LEARNED_EMPTY}</Body> : null}
        <View style={[styles.list, !settings.learning && styles.paused]}>
          {entries.map((e) => (
            <Item key={e.id} entry={e} onPatch={(change) => patch(e.id, change)} onDelete={() => commit(removeEntry(entries, e.id))} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Item({ entry, onPatch, onDelete }: { entry: LexiconEntry; onPatch: (change: LexiconPatch) => void; onDelete: () => void }) {
  const mode = lexiconMode(entry);
  return (
    <View style={[styles.item, !entry.enabled && styles.itemOff]}>
      <View style={styles.itemHead}>
        <Text style={[styles.term, !entry.enabled && styles.termOff]}>
          {entry.term}
          {entry.pinned ? ' 📌' : ''}
        </Text>
        <Text accessibilityLabel={`${MODE_LABEL[mode]}. ${MODE_TITLE[mode]}`} style={styles.badge}>
          {MODE_LABEL[mode]}
        </Text>
      </View>
      {entry.heardAs.length > 0 ? (
        <View style={styles.forms}>
          <Text style={styles.meta}>heard as</Text>
          {entry.heardAs.map((form) => (
            <Pressable
              key={form}
              accessibilityRole="button"
              accessibilityLabel={`Stop replacing “${form}”`}
              onPress={() => onPatch({ heardAs: entry.heardAs.filter((h) => h !== form) })}
              style={styles.chip}>
              <Text style={styles.chipText}>{form} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.meta}>{entry.source === 'manual' ? 'Added by you' : `Fixed ${entry.count}×`}</Text>
      <Text style={styles.meta}>{MODE_TITLE[mode]}</Text>
      <View style={ui.row}>
        <Button small label={entry.pinned ? 'Unpin' : 'Pin'} onPress={() => onPatch({ pinned: !entry.pinned })} />
        <Button small label={entry.enabled ? 'Turn off' : 'Turn on'} onPress={() => onPatch({ enabled: !entry.enabled })} />
        <Button small label="Delete" onPress={onDelete} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  hint: { color: W.muted, fontSize: 13, lineHeight: 19 },
  switchCard: { padding: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Gap.m },
  switchText: { flex: 1, gap: 4 },
  switchLabel: { color: W.text, fontSize: 15, fontWeight: '600' },
  sub: { color: W.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: W.faint, fontWeight: '500' },
  input: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: W.surface, color: W.text, fontSize: 15 },
  error: { color: W.red, fontSize: 13 },
  list: { gap: Gap.s },
  paused: { opacity: 0.55 },
  item: { padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: W.line, backgroundColor: W.surface, gap: 6 },
  itemOff: { opacity: 0.7 },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Gap.s },
  term: { flex: 1, color: W.text, fontSize: 14, fontWeight: '600' },
  termOff: { textDecorationLine: 'line-through', color: W.muted },
  badge: { color: W.accentSoft, fontSize: 11, fontWeight: '600' },
  forms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { borderRadius: 999, backgroundColor: W.bg, borderWidth: 1, borderColor: W.lineStrong, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: W.text, fontSize: 12.5 },
  meta: { color: W.muted, fontSize: 12, lineHeight: 17 },
});
