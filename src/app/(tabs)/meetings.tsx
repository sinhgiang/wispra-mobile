import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryCard } from '@/components/wispra/entry-card';
import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { sortEntries } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';

export default function MeetingsScreen() {
  const { entries } = useEntries();
  const meetings = useMemo(() => sortEntries(entries.filter((e) => e.kind === 'meeting')), [entries]);

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <View style={styles.header}>
        <Title>Meetings</Title>
        <Button kind="primary" label="Record a meeting" onPress={() => router.push('/meeting/record')} />
      </View>
      <FlatList
        data={meetings}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <EntryCard entry={item} onPress={() => router.push({ pathname: '/meeting/[id]', params: { id: item.id } })} />
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyTitle}>No meetings yet</Text>
            <Body style={styles.emptyNote}>
              Record a meeting and Wispra keeps the audio on this phone. It keeps recording when the screen locks.
            </Body>
          </Card>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  list: { paddingHorizontal: Gap.xl, paddingBottom: Gap.xl, gap: Gap.s + 2 },
  emptyTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  emptyNote: { color: W.muted, fontSize: 13, lineHeight: 19 },
});
