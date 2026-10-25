import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmDelete } from '@/components/wispra/confirm-delete';
import { MindMapView, type MapExporter } from '@/components/wispra/mind-map-canvas';
import { SummaryText, TabChips } from '@/components/wispra/meeting-views';
import { Body, Button, Card, Chip, ui } from '@/components/wispra/ui';
import { StatusPill } from '@/components/wispra/note-card';
import { Gap, W } from '@/constants/wispra';
import { needsTranscription, type Entry } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { deleteOneWarning } from '@/lib/history-delete';
import { downloadMap } from '@/lib/note-export';
import {
  copyText,
  formatNoteDate,
  NOTE_STATUSES,
  NOTE_TEXT,
  shownArticle,
  statusOf,
  type ExpertView,
  type NoteStatus,
  type NoteView,
} from '@/lib/notes';
import { useSession } from '@/lib/use-session';

// One note (T-0979), laid out like a meeting: tabs on top, each part a card, share at the top right,
// a small "Write again" on the cards. Three views of the same words: as said, as an expert would write
// them, and as a mind map.
const TABS: { value: NoteView; label: string }[] = [
  { value: 'verbatim', label: NOTE_TEXT.verbatim },
  { value: 'expert', label: NOTE_TEXT.expert },
  { value: 'map', label: NOTE_TEXT.map },
];

// The statuses the menu offers; "Mới" is where every note starts
const MENU_STATUSES = NOTE_STATUSES.filter((s) => s.value !== 'new');

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, remove, busy, retry, writeNote } = useEntries();
  const session = useSession();
  const entry = entries.find((e) => e.id === id);
  const [tab, setTab] = useState<NoteView>('verbatim');
  const [expert, setExpert] = useState<ExpertView>('outline');
  const [version, setVersion] = useState(-1);

  if (!entry || entry.kind !== 'note') {
    return (
      <SafeAreaView style={[ui.screen, styles.missing]}>
        <Text style={styles.cardTitle}>{NOTE_TEXT.missing}</Text>
        <Button label={NOTE_TEXT.back} onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const working = busy.has(entry.id);
  const hasText = !!entry.text?.trim();

  const share = () => {
    const shown = copyText(entry, tab, expert, version);
    void Share.share({ message: [entry.title, shown || entry.text || ''].filter(Boolean).join('\n\n') });
  };

  const askDelete = () =>
    confirmDelete(deleteOneWarning(entry, !!session), () => {
      router.back();
      remove(entry.id);
    });

  // Try again after an AI failure: the work of the view on show
  const tryAgain = () => void writeNote(entry.id, tab === 'map' ? 'map' : tab === 'expert' ? expert : 'outline');

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={NOTE_TEXT.back} onPress={() => router.back()} style={styles.round}>
            <Text style={styles.roundText}>‹</Text>
          </Pressable>
          <View style={styles.headText}>
            <Text style={styles.title} numberOfLines={2}>
              {entry.title}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={NOTE_TEXT.share} onPress={share} style={styles.round}>
            <Text style={styles.shareText}>↗</Text>
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {formatNoteDate(entry.createdAt)}
            {entry.note?.domain ? ` · ${entry.note.domain}` : ''}
          </Text>
          <StatusMenu entry={entry} />
        </View>

        <TabChips tabs={TABS} value={tab} onChange={setTab} />

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {needsTranscription(entry) || !hasText ? <WaitingCard entry={entry} onRetry={() => void retry(entry.id)} /> : null}
          {entry.note?.error ? (
            <Card style={styles.errorCard}>
              <Text style={styles.errorText}>{entry.note.error}</Text>
              <View style={ui.row}>
                <Button small kind="primary" label="Thử lại" disabled={working} onPress={tryAgain} />
              </View>
            </Card>
          ) : null}
          {tab === 'verbatim' ? <VerbatimTab entry={entry} /> : null}
          {tab === 'expert' ? (
            <ExpertTab entry={entry} working={working} sub={expert} onSub={setExpert} version={version} onVersion={setVersion} />
          ) : null}
          {tab === 'map' ? <MapTab entry={entry} working={working} /> : null}
          <Button label={NOTE_TEXT.delete} onPress={askDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function WaitingCard({ entry, onRetry }: { entry: Entry; onRetry: () => void }) {
  const { busy } = useEntries();
  const working = busy.has(entry.id);
  if (entry.status === 'recording') return null;
  return (
    <Card>
      <Body style={styles.note}>{working ? NOTE_TEXT.transcribing : (entry.error ?? (needsTranscription(entry) ? NOTE_TEXT.savedWaiting : NOTE_TEXT.noText))}</Body>
      {needsTranscription(entry) ? (
        <View style={ui.row}>
          <Button small kind="primary" label={working ? 'Đang thử…' : 'Thử lại'} disabled={working} onPress={onRetry} />
        </View>
      ) : null}
    </Card>
  );
}

// The status button: shows where the note stands and opens the four choices. A choice is only kept
// (step 1): no reminder is scheduled and no notification is sent.
function StatusMenu({ entry }: { entry: Entry }) {
  const { setNoteStatus } = useEntries();
  const [open, setOpen] = useState(false);
  const status = statusOf(entry);
  const choose = (value: NoteStatus) => {
    setOpen(false);
    setNoteStatus(entry.id, value);
  };
  return (
    <View style={styles.menuWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Trạng thái: ${NOTE_STATUSES.find((s) => s.value === status)?.label ?? ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.pillButton}>
        <StatusPill status={status} short />
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      {open ? (
        <View style={styles.menu} testID="note-status-menu">
          {MENU_STATUSES.map((s) => (
            <Pressable
              key={s.value}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: s.value === status }}
              onPress={() => choose(s.value)}
              style={[styles.menuItem, s.value === status && styles.menuItemOn]}>
              <Text style={styles.menuLabel}>{s.label}</Text>
              <Text style={styles.menuHint}>{s.hint}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CopyButton({ text, label = NOTE_TEXT.copy }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return <Button small kind="primary" label={copied ? NOTE_TEXT.copied : label} disabled={!text.trim()} onPress={() => void copy()} />;
}

function VerbatimTab({ entry }: { entry: Entry }) {
  if (!entry.text?.trim()) return null;
  return (
    <Card>
      <Text selectable style={styles.text}>
        {entry.text}
      </Text>
      <View style={ui.row}>
        <CopyButton text={entry.text} />
      </View>
    </Card>
  );
}

function Tokens({ n }: { n: number | undefined }) {
  return n ? <Text style={styles.note}>{NOTE_TEXT.tokens(n)}</Text> : null;
}

function ExpertTab({
  entry,
  working,
  sub,
  onSub,
  version,
  onVersion,
}: {
  entry: Entry;
  working: boolean;
  sub: ExpertView;
  onSub: (v: ExpertView) => void;
  version: number;
  onVersion: (v: number) => void;
}) {
  const { writeNote } = useEntries();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const note = entry.note;
  if (!entry.text?.trim()) return null;
  const articles = note?.articles ?? [];
  const shownVersion = articles.length === 0 ? 0 : Math.min(version < 0 ? articles.length - 1 : version, articles.length - 1);
  const article = shownArticle(note, shownVersion);
  const content = sub === 'outline' ? note?.outline : article;
  const make = () => void writeNote(entry.id, sub);

  const saveRole = () => {
    const role = draft.trim();
    setEditing(false);
    if (role) void writeNote(entry.id, sub, role);
  };

  return (
    <>
      <View style={styles.chipRow}>
        <Chip label={NOTE_TEXT.outline} active={sub === 'outline'} onPress={() => onSub('outline')} />
        <Chip label={NOTE_TEXT.article} active={sub === 'article'} onPress={() => onSub('article')} />
      </View>

      {note?.role ? (
        <View style={styles.persona}>
          {editing ? (
            <>
              <TextInput
                accessibilityLabel={NOTE_TEXT.roleLabel}
                value={draft}
                onChangeText={setDraft}
                placeholderTextColor={W.faint}
                style={styles.roleInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveRole}
              />
              <View style={ui.row}>
                <Button small kind="primary" label={NOTE_TEXT.roleSave} onPress={saveRole} />
                <Button small label={NOTE_TEXT.roleCancel} onPress={() => setEditing(false)} />
              </View>
            </>
          ) : (
            <Text style={styles.personaText}>
              {NOTE_TEXT.roleLabel} {note.role}.{' '}
              <Text
                accessibilityRole="button"
                style={styles.personaLink}
                onPress={() => {
                  setDraft(note.role ?? '');
                  setEditing(true);
                }}>
                {NOTE_TEXT.changeRole}
              </Text>
            </Text>
          )}
        </View>
      ) : null}

      {sub === 'article' && articles.length > 1 ? (
        <View style={styles.chipRow}>
          {articles.map((_, i) => (
            <Chip key={i} label={`${NOTE_TEXT.version} ${i + 1}`} active={shownVersion === i} onPress={() => onVersion(i)} />
          ))}
        </View>
      ) : null}

      {content ? (
        <Card>
          <SummaryText text={content} />
          <View style={ui.row}>
            <CopyButton text={content} />
            <Button small label={working ? NOTE_TEXT.writing : NOTE_TEXT.rewrite} disabled={working} onPress={make} />
          </View>
          <Tokens n={note?.usage?.[sub === 'outline' ? 'outline' : 'article']?.tokens} />
          <Text style={styles.note}>{NOTE_TEXT.aiNote}</Text>
        </Card>
      ) : working ? (
        <Card>
          <Body style={styles.note}>{NOTE_TEXT.writing}</Body>
        </Card>
      ) : note?.error ? null : (
        <Card>
          <Body style={styles.note}>{sub === 'outline' ? NOTE_TEXT.writeFirst : NOTE_TEXT.articleAbout}</Body>
          <View style={ui.row}>
            <Button small kind="primary" label={sub === 'outline' ? NOTE_TEXT.writeOutline : NOTE_TEXT.writeArticle} onPress={make} />
          </View>
        </Card>
      )}
    </>
  );
}

function MapTab({ entry, working }: { entry: Entry; working: boolean }) {
  const { writeNote } = useEntries();
  const exporter = useRef<MapExporter | null>(null);
  const setExporter = useCallback((next: MapExporter | null) => {
    exporter.current = next;
  }, []);
  const note = entry.note;
  if (!entry.text?.trim()) return null;
  const draw = () => void writeNote(entry.id, 'map');

  const download = async () => {
    if (!note?.mindMap) return;
    try {
      await downloadMap(note.mindMap, entry.title, {
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other',
        toPngBase64: () => exporter.current?.toPngBase64() ?? Promise.resolve(null),
        saveToCache: (base64, name) => {
          const file = new File(Paths.cache, name);
          if (file.exists) file.delete();
          file.create();
          file.write(base64, { encoding: 'base64' });
          return file.uri;
        },
        shareFile: async (uri, title) => {
          await Share.share({ url: uri, title });
        },
        shareText: async (title, message) => {
          await Share.share({ title, message });
        },
      });
    } catch (err) {
      Alert.alert('Chưa tải xuống được', err instanceof Error ? err.message : String(err));
    }
  };

  if (note?.mindMap) {
    return (
      <>
        <MindMapView map={note.mindMap} onExporter={setExporter} />
        <View style={ui.row}>
          <Button small kind="primary" label={NOTE_TEXT.download} onPress={() => void download()} />
          <Button small label={working ? NOTE_TEXT.drawing : NOTE_TEXT.redraw} disabled={working} onPress={draw} />
        </View>
        <Tokens n={note.usage?.map?.tokens} />
      </>
    );
  }
  if (note?.mapText) {
    return (
      <Card>
        <Body style={styles.note}>{NOTE_TEXT.mapFailed}</Body>
        <Text selectable style={styles.text}>
          {note.mapText}
        </Text>
        <View style={ui.row}>
          <CopyButton text={note.mapText} />
          <Button small label={working ? NOTE_TEXT.drawing : NOTE_TEXT.redraw} disabled={working} onPress={draw} />
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <Body style={styles.note}>{working ? NOTE_TEXT.drawing : NOTE_TEXT.mapAbout}</Body>
      {!working ? (
        <View style={ui.row}>
          <Button small kind="primary" label={NOTE_TEXT.draw} onPress={draw} />
        </View>
      ) : null}
    </Card>
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
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Gap.s, paddingHorizontal: Gap.xl, paddingBottom: Gap.s, zIndex: 20, elevation: 20 },
  meta: { flex: 1, color: W.muted, fontSize: 12 },
  menuWrap: { alignItems: 'flex-end' },
  pillButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  caret: { color: W.muted, fontSize: 12 },
  menu: {
    position: 'absolute',
    top: 36,
    right: 0,
    width: 230,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a3f4e',
    backgroundColor: W.surfaceRaised,
    zIndex: 30,
    elevation: 30,
  },
  menuItem: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 },
  menuItemOn: { backgroundColor: '#272a52' },
  menuLabel: { color: W.text, fontSize: 13 },
  menuHint: { color: W.muted, fontSize: 11, marginTop: 1 },
  body: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xl, gap: Gap.m },
  text: { color: W.text, fontSize: 14, lineHeight: 21 },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Gap.s },
  persona: { backgroundColor: W.surfaceRaised, borderRadius: 10, padding: 10, gap: Gap.s },
  personaText: { color: W.accentSoft, fontSize: 12, lineHeight: 18 },
  personaLink: { color: W.text, textDecorationLine: 'underline' },
  roleInput: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: W.lineStrong, backgroundColor: W.surface, color: W.text, paddingHorizontal: 12, fontSize: 14 },
  errorCard: { borderWidth: 1, borderColor: W.red, backgroundColor: 'transparent' },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 19 },
  missing: { padding: Gap.xl, gap: Gap.l, justifyContent: 'center' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
});
