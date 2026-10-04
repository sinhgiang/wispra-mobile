import Constants from 'expo-constants';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration, needsTranscription } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';

export default function AccountScreen() {
  const { entries } = useEntries();
  const stats = useMemo(() => {
    const waiting = entries.filter(needsTranscription);
    return {
      count: entries.length,
      waiting: waiting.length,
      waitingMs: waiting.reduce((sum, e) => sum + e.durationMs, 0),
    };
  }, [entries]);

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Account</Title>

        <Card>
          <Text style={styles.cardTitle}>Wispra Cloud</Text>
          <Body style={styles.note}>
            Signing in with your Wispra account, the same one as Wispra on your computer, is coming in the next update.
            It turns your recordings into text.
          </Body>
        </Card>

        <View style={styles.rows}>
          <Row label="Saved on this phone" value={`${stats.count}`} />
          <Row
            label="Waiting for transcription"
            value={stats.waiting > 0 ? `${stats.waiting} · ${formatDuration(stats.waitingMs)}` : '0'}
          />
          <Row label="Version" value={Constants.expoConfig?.version ?? ''} last />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.l },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  rows: { backgroundColor: W.surface, borderRadius: 16 },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLine: { borderBottomWidth: 1, borderBottomColor: W.line },
  rowLabel: { color: W.text, fontSize: 14 },
  rowValue: { color: W.muted, fontSize: 13 },
});
