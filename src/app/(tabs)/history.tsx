import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryCard } from '@/components/wispra/entry-card';
import { Chip, Label, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { filterEntries, groupByDay, type Entry, type KindFilter } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'dictation', label: 'Dictations' },
  { value: 'meeting', label: 'Meetings' },
];

export default function HistoryScreen() {
  const { entries } = useEntries();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  const sections = useMemo(
    () => groupByDay(filterEntries(entries, query, kind)).map((g) => ({ title: g.label, data: g.entries })),
    [entries, query, kind],
  );

  const open = (entry: Entry) => {
    if (entry.kind === 'meeting') router.push({ pathname: '/meeting/[id]', params: { id: entry.id } });
  };

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <View style={styles.header}>
        <Title>History</Title>
        <TextInput
          accessibilityLabel="Search"
          placeholder="Search dictations and meetings"
          placeholderTextColor={W.faint}
          value={query}
          onChangeText={setQuery}
          style={styles.search}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <View style={ui.row}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} active={kind === f.value} onPress={() => setKind(f.value)} />
          ))}
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Label style={styles.day}>{section.title}</Label>}
        renderItem={({ item }) => <EntryCard entry={item} onPress={() => open(item)} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {entries.length === 0 ? 'Your dictations and meetings will show up here.' : 'Nothing matches your search.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: Gap.xl, paddingTop: Gap.xl + 16, paddingBottom: Gap.m, gap: Gap.m },
  search: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: W.lineStrong,
    backgroundColor: W.surface,
    color: W.text,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  list: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xl, gap: Gap.s + 2 },
  day: { paddingTop: Gap.xs, paddingBottom: 2 },
  empty: { color: W.muted, fontSize: 13, textAlign: 'center', marginTop: Gap.xxl },
});
