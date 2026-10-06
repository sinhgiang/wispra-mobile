import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { WordsSyncLine } from '@/components/wispra/words-sync-line';
import { Gap, W } from '@/constants/wispra';
import { newId } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { EVAL_MIN_WORDS, EVAL_WEEKS_SHOWN, STYLE_HABIT_MIN_FIXES, STYLE_NOTES_MAX_CHARS } from '@/lib/learned/constants';
import {
  acceptSuggestion,
  autoTermList,
  dismissSuggestion,
  evalReport,
  keepAutoTerm,
  removeAutoTerm,
  resetEval,
  resetLearned,
  resetStyle,
  setHabitEnabled,
  setStyleNotes,
  styleProfile,
  suggestionList,
  type LearnedState,
} from '@/lib/learned/learned';
import type { AutoTerm, EvalTotals, Suggestion } from '@/lib/learned/types';
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
import { loadLearned, loadLearning, loadLexicon, loadVocabulary, saveLearned, saveLearning, saveLexicon } from '@/lib/storage';

// The computer's Learned tab words (Settings › Learned), kept the same
export const LEARNED_HINT =
  'Wispra learns your own words two ways. It reads your History and meetings for the names and terms you use again and again, and gives them to the speech recogniser so it hears them right next time. And it learns from the fixes you make in History (open a dictation and tap Edit): fix a misheard word once and Wispra remembers it; fix it again and it is replaced automatically.';
export const LEARNED_EMPTY = 'Nothing here yet. Words you fix in History, keep from the list above, or add yourself appear here.';
export const ADD_NOTE = 'Terms you add here replace the misheard forms right away. The Custom vocabulary list keeps working too.';
export const AUTO_EMPTY =
  'Nothing yet. Words you use again and again — names, products, abbreviations — show up here once Wispra has seen them in a few of your dictations or meetings.';
export const AUTO_NOTE =
  'These only nudge the speech recogniser towards your spelling. Remove one that is wrong — a word Wispra keeps mishearing can look like a word you use. Keep one to add it to Your words below.';
export const SUGGEST_NOTE = 'Found by reading your History and meetings. Nothing changes until you press a button.';
export const STYLE_EMPTY = `None yet. Wispra looks for a change you keep making — after at least ${STYLE_HABIT_MIN_FIXES} fixes in History (Edit) that show the same pattern.`;
export const EVAL_EMPTY = 'Nothing measured yet. Dictate for a while and fix what is wrong in History — Wispra counts how often you need to.';
const ARMED_MS = 4000;

const places = (n: number): string => (n === 1 ? '1 place' : `${n} places`);
const perHundred = (rate: number | null): string => (rate === null ? '—' : rate.toFixed(1));

// Why a picked-up word was picked, as the computer's tooltip says it. The phone has no AI cleanup step, so a
// word that was fixed was fixed by the user.
export function autoTermTitle(t: AutoTerm): string {
  return t.via === 'fixed'
    ? `You changed “${t.heardAs}” to “${t.term}” ${t.count}× in ${places(t.sources)}.`
    : `You used “${t.term}” ${t.count}× in ${places(t.sources)}.`;
}

// The example text around the word, in three parts, so the word can be shown marked
export function splitExample(example: string, needle: string): [string, string, string] {
  const at = needle ? example.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  return at < 0 ? [example, '', ''] : [example.slice(0, at), example.slice(at, at + needle.length), example.slice(at + needle.length)];
}

// Account › Learned (T-0182): the computer's Learned tab on the phone.
export default function LearnedScreen() {
  const { entries } = useEntries();
  const [settings, setSettings] = useState<LearningSettings>(() => loadLearning());
  const [lexicon, setLexicon] = useState<LexiconEntry[]>(() => loadLexicon());
  const [state, setState] = useState<LearnedState>(() => loadLearned());
  const [term, setTerm] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [notes, setNotes] = useState(state.styleNotes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const inputs = useMemo(
    () => ({ entries: entries ?? [], vocabulary: loadVocabulary(), lexicon, state, learning: settings.learning, autoLearn: settings.autoLearn }),
    [entries, lexicon, state, settings],
  );
  const auto = useMemo(() => autoTermList(inputs), [inputs]);
  const suggestions = useMemo(() => suggestionList(inputs), [inputs]);
  const profile = useMemo(() => styleProfile(entries ?? [], state), [entries, state]);
  const report = useMemo(() => evalReport(state), [state]);

  const failed = () => setError('Could not save the change.');
  const commitLexicon = (next: LexiconEntry[]) => {
    try {
      saveLexicon(next);
      setLexicon(next);
      setError(null);
    } catch {
      failed();
    }
  };
  const commitState = (next: LearnedState) => {
    try {
      saveLearned(next);
      setState(next);
      setError(null);
    } catch {
      failed();
    }
  };
  const toggle = (patch: Partial<LearningSettings>) => {
    const next = { ...settings, ...patch };
    try {
      saveLearning(next);
      setSettings(next);
    } catch {
      failed();
    }
  };
  const patch = (id: string, change: LexiconPatch) => commitLexicon(updateEntry(lexicon, id, change));
  const add = () => {
    const forms = heard.split(/[,;\n]/).map((f) => f.trim()).filter(Boolean);
    const result = addManualEntry(lexicon, term, forms, new Date().toISOString(), newId);
    if (!result.entry) {
      setError('Could not add that term.');
      return;
    }
    commitLexicon(result.entries);
    setTerm('');
    setHeard('');
  };
  // A button that asks twice (Clear all, Reset style, Reset statistics), as on the computer
  const askTwice = (what: string, run: () => void) => {
    if (armed !== what) {
      setArmed(what);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(null), ARMED_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(null);
    run();
  };
  const clearAll = () =>
    askTwice('clear', () => {
      try {
        saveLexicon([]);
        saveLearned(resetLearned(state));
        setLexicon([]);
        setState(resetLearned(state));
      } catch {
        failed();
      }
    });
  const accept = (id: string) => {
    const result = acceptSuggestion(inputs, id, new Date().toISOString(), newId);
    try {
      saveLexicon(result.lexicon);
      saveLearned(result.state);
      setLexicon(result.lexicon);
      setState(result.state);
    } catch {
      failed();
    }
  };
  const keep = (id: string) => {
    const next = keepAutoTerm(inputs, id, new Date().toISOString(), newId);
    commitLexicon(next);
  };
  const saveNotes = () => {
    if (notes === state.styleNotes) return;
    const next = setStyleNotes(state, notes);
    commitState(next);
    setNotes(next.styleNotes);
  };

  const learning = settings.learning;
  const resettableStyle = profile.notes !== '' || profile.habits.some((h) => !h.enabled);

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button small label="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Title>Learned</Title>
        <Body style={styles.hint}>{LEARNED_HINT}</Body>
        <WordsSyncLine />

        <Card style={styles.switchCard}>
          <SwitchRow
            label="Learn my words"
            desc="When off, Wispra neither learns new words nor applies anything below. Your lists are kept."
            value={learning}
            onChange={(v) => toggle({ learning: v })}
          />
          {learning ? (
            <SwitchRow
              label="Learn my vocabulary from History"
              desc="Picks up names, brands and terms you use often, without you fixing anything. It only helps the speech recogniser — your text is never rewritten."
              value={settings.autoLearn}
              onChange={(v) => toggle({ autoLearn: v })}
            />
          ) : null}
        </Card>

        {learning && settings.autoLearn ? (
          <>
            <Text style={styles.sub}>
              Picked up from your History <Text style={styles.count}>{auto.length}</Text>
            </Text>
            {auto.length === 0 ? (
              <Body style={styles.hint}>{AUTO_EMPTY}</Body>
            ) : (
              <View style={styles.list}>
                {auto.map((t) => (
                  <View key={t.id} style={styles.autoItem}>
                    <View style={styles.autoText}>
                      <Text style={styles.term}>{t.term}</Text>
                      <Text style={styles.meta}>{autoTermTitle(t)}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Keep ${t.term}: make it one of your own words`} onPress={() => keep(t.id)} hitSlop={8}>
                      <Text style={styles.keep}>✓</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${t.term}: Wispra won't use this word again`}
                      onPress={() => commitState(removeAutoTerm(state, t.id))}
                      hitSlop={8}>
                      <Text style={styles.remove}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <Body style={styles.hint}>{AUTO_NOTE}</Body>
          </>
        ) : null}

        {learning && suggestions.length > 0 ? (
          <>
            <Text style={styles.sub}>
              Suggestions <Text style={styles.count}>{suggestions.length}</Text>
            </Text>
            <Body style={styles.hint}>{SUGGEST_NOTE}</Body>
            <View style={styles.list}>
              {suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} onAccept={() => accept(s.id)} onDismiss={() => commitState(dismissSuggestion(state, s.id))} />
              ))}
            </View>
          </>
        ) : null}

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
            Your words <Text style={styles.count}>{lexicon.length}</Text>
          </Text>
          {lexicon.length > 0 ? (
            <Button small label={armed === 'clear' ? 'Click again to clear' : 'Clear all'} kind={armed === 'clear' ? 'danger' : 'secondary'} onPress={clearAll} />
          ) : null}
        </View>
        {lexicon.length === 0 ? <Body style={styles.hint}>{LEARNED_EMPTY}</Body> : null}
        <View style={[styles.list, !learning && styles.paused]}>
          {lexicon.map((e) => (
            <Item key={e.id} entry={e} onPatch={(change) => patch(e.id, change)} onDelete={() => commitLexicon(removeEntry(lexicon, e.id))} />
          ))}
        </View>

        {learning ? (
          <>
            <View style={styles.subRow}>
              <Text style={styles.sub}>Your writing style</Text>
              {resettableStyle ? (
                <Button
                  small
                  label={armed === 'style' ? 'Click again to reset' : 'Reset style'}
                  kind={armed === 'style' ? 'danger' : 'secondary'}
                  onPress={() =>
                    askTwice('style', () => {
                      commitState(resetStyle(state));
                      setNotes('');
                    })
                  }
                />
              ) : null}
            </View>
            <Body style={styles.hint}>Passed to the AI that puts the full stops and commas in what the keyboard types, so the text comes out the way you write.</Body>
            <TextInput
              accessibilityLabel="Your writing style, in your own words"
              placeholder="In your own words — e.g. short sentences, casual tone, never use exclamation marks"
              placeholderTextColor={W.faint}
              value={notes}
              onChangeText={setNotes}
              onBlur={saveNotes}
              maxLength={STYLE_NOTES_MAX_CHARS}
              multiline
              style={[styles.input, styles.notes]}
            />
            <Text style={styles.counter}>{`${notes.length}/${STYLE_NOTES_MAX_CHARS}`}</Text>
            <Text style={styles.sub}>
              Habits Wispra noticed <Text style={styles.count}>{profile.habits.length}</Text>
            </Text>
            {profile.habits.length === 0 ? (
              <Body style={styles.hint}>{STYLE_EMPTY}</Body>
            ) : (
              <Card style={styles.switchCard}>
                {profile.habits.map((h) => (
                  <SwitchRow key={h.id} label={h.text} desc={h.evidence} value={h.enabled} onChange={(v) => commitState(setHabitEnabled(state, h.id, v))} />
                ))}
              </Card>
            )}
            <Body style={styles.hint}>
              {profile.exampleCount > 0
                ? `${profile.exampleCount} of your fixed dictations are kept as examples of how you write. The phone does not show them to the AI: the step that puts in the full stops may change nothing but dots, commas and capitals.`
                : 'Once you have fixed a few dictations in History, they are kept as examples of how you write.'}
            </Body>
          </>
        ) : null}

        <View style={styles.subRow}>
          <Text style={styles.sub}>Is learning helping?</Text>
          {report.all.dictations > 0 ? (
            <Button
              small
              label={armed === 'eval' ? 'Click again to reset' : 'Reset statistics'}
              kind={armed === 'eval' ? 'danger' : 'secondary'}
              onPress={() => askTwice('eval', () => commitState(resetEval(state)))}
            />
          ) : null}
        </View>
        {report.all.dictations === 0 ? (
          <Body style={styles.hint}>{EVAL_EMPTY}</Body>
        ) : (
          <>
            <View style={styles.headline}>
              <Text style={styles.rate}>{perHundred(report.all.rate)}</Text>
              <Text style={styles.meta}>
                {`word fixes per 100 dictated words\nlast ${EVAL_WEEKS_SHOWN} weeks · ${report.all.dictations} dictations · ${report.all.edited} of them fixed`}
              </Text>
            </View>
            <Bars weeks={report.weeks} />
            {report.on.words >= EVAL_MIN_WORDS && report.off.words >= EVAL_MIN_WORDS ? (
              <View style={styles.compare}>
                <Side label="Learning on" totals={report.on} />
                <Side label="Learning off" totals={report.off} />
              </View>
            ) : (
              <Body style={styles.hint}>
                {`The learning on / off comparison appears once you have dictated ${EVAL_MIN_WORDS}+ words in each state (so far: ${report.on.words} on, ${report.off.words} off).`}
              </Body>
            )}
          </>
        )}
        <Body style={styles.hint}>
          Counts only the fixes you make yourself in History → Edit, and only changed words (punctuation-only fixes are not counted). A dictation you never corrected counts as fine, so treat this as a rough guide. Only counts are stored, never your text. Dictations made with the keyboard are not in History, so they are not counted.
        </Body>
      </ScrollView>
    </SafeAreaView>
  );
}

function SwitchRow({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        <Text style={styles.hint}>{desc}</Text>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

function SuggestionCard({ s, onAccept, onDismiss }: { s: Suggestion; onAccept: () => void; onDismiss: () => void }) {
  const [before, match, after] = splitExample(s.example, s.heardAs ?? s.term);
  return (
    <View style={styles.item}>
      <Text style={styles.term}>
        {s.kind === 'variant' ? (
          <>
            Wispra wrote <Text style={styles.strong}>{s.heardAs}</Text> — did you mean <Text style={styles.strong}>{s.term}</Text>?
          </>
        ) : (
          <>
            <Text style={styles.strong}>{s.term}</Text> comes up a lot — keep it spelled this way?
          </>
        )}
      </Text>
      <Text style={styles.meta}>
        {`Seen ${s.count}× in ${places(s.sources)}`}
        {s.kind === 'variant' ? ` · would be replaced with “${s.term}”` : ' · added as a spelling to keep'}
      </Text>
      <Text style={styles.example}>
        {before}
        {match ? <Text style={styles.mark}>{match}</Text> : null}
        {after}
      </Text>
      <View style={ui.row}>
        <Button small kind="primary" label={s.kind === 'variant' ? 'Yes, replace it' : 'Add'} onPress={onAccept} />
        <Button small label={s.kind === 'variant' ? 'No' : 'Ignore'} onPress={onDismiss} />
      </View>
    </View>
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

function weekLabel(start: string): string {
  const d = new Date(`${start}T00:00:00`);
  return Number.isNaN(d.getTime()) ? start : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Bars({ weeks }: { weeks: { start: string; dictations: number; rate: number | null }[] }) {
  const peak = Math.max(0, ...weeks.map((w) => w.rate ?? 0));
  return (
    <View style={styles.bars} accessibilityLabel="Word fixes per 100 words, by week">
      {weeks.map((w) => {
        const height = w.rate === null || peak === 0 ? 0 : Math.max(4, Math.round((w.rate / peak) * 100));
        return (
          <View key={w.start} style={styles.col}>
            <View style={styles.track}>
              <View style={[styles.bar, w.dictations === 0 && styles.barEmpty, { height: `${height}%` }]} />
            </View>
            <Text style={styles.colValue}>{w.dictations === 0 ? '' : perHundred(w.rate)}</Text>
            <Text style={styles.colLabel}>{weekLabel(w.start)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Side({ label, totals }: { label: string; totals: EvalTotals }) {
  return (
    <View style={styles.side}>
      <Text style={styles.sub}>{label}</Text>
      <Text style={styles.rate}>{perHundred(totals.rate)}</Text>
      <Text style={styles.meta}>{`fixes per 100 words · ${totals.words} words`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  hint: { color: W.muted, fontSize: 13, lineHeight: 19 },
  switchCard: { padding: 14, gap: Gap.m },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Gap.m },
  switchText: { flex: 1, gap: 4 },
  switchLabel: { color: W.text, fontSize: 15, fontWeight: '600' },
  sub: { color: W.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: W.faint, fontWeight: '500' },
  input: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: W.surface, color: W.text, fontSize: 15 },
  notes: { minHeight: 64, textAlignVertical: 'top' },
  counter: { color: W.faint, fontSize: 12, alignSelf: 'flex-end' },
  error: { color: W.red, fontSize: 13 },
  list: { gap: Gap.s },
  paused: { opacity: 0.55 },
  item: { padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: W.line, backgroundColor: W.surface, gap: 6 },
  itemOff: { opacity: 0.7 },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Gap.s },
  term: { flex: 1, color: W.text, fontSize: 14, fontWeight: '600' },
  strong: { fontWeight: '700', color: W.text },
  termOff: { textDecorationLine: 'line-through', color: W.muted },
  badge: { color: W.accentSoft, fontSize: 11, fontWeight: '600' },
  forms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { borderRadius: 999, backgroundColor: W.bg, borderWidth: 1, borderColor: W.lineStrong, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: W.text, fontSize: 12.5 },
  meta: { color: W.muted, fontSize: 12, lineHeight: 17 },
  example: { color: W.text, fontSize: 13, lineHeight: 19 },
  mark: { backgroundColor: W.accentDeep, color: W.text },
  autoItem: { flexDirection: 'row', alignItems: 'center', gap: Gap.m, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: W.line, backgroundColor: W.surface },
  autoText: { flex: 1, gap: 2 },
  keep: { color: W.green, fontSize: 18, paddingHorizontal: 6 },
  remove: { color: W.muted, fontSize: 16, paddingHorizontal: 6 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: Gap.m },
  rate: { color: W.text, fontSize: 32, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 },
  col: { flex: 1, alignItems: 'center', height: '100%' },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: W.accent, borderRadius: 4 },
  barEmpty: { backgroundColor: W.line },
  colValue: { color: W.muted, fontSize: 10, height: 14 },
  colLabel: { color: W.faint, fontSize: 9 },
  compare: { flexDirection: 'row', gap: Gap.m },
  side: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: W.surface, gap: 4 },
});
