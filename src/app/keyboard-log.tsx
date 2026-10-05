import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { lastFinding, logToShare, newestFirst } from '@/lib/keyboard-log';
import { clearKeyboardLog, keyboardLog } from '@/modules/wispra-keyboard-bridge';

// Account › Keyboard log (T-0178): what Wispra and its keyboard noted about the listening session. When
// the keyboard does not work in an app, this shows why, and can be shared.
export default function KeyboardLogScreen() {
  const [lines, setLines] = useState<string[] | null>(null);

  const load = useCallback(() => {
    void keyboardLog()
      .then(setLines)
      .catch(() => setLines([]));
  }, []);
  useEffect(load, [load]);

  const finding = lines ? lastFinding(lines) : null;
  const shown = lines ? newestFirst(lines) : [];

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button small label="‹ Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
        <Title>Keyboard log</Title>
        <Body style={styles.note}>
          What Wispra and its keyboard noted about the listening session, newest first. If the keyboard does not work in an app, try
          it there, then open this page.
        </Body>

        {finding ? (
          <Card style={styles.finding}>
            <Text style={styles.findingTitle}>Last sign of a problem</Text>
            <Text style={styles.findingText}>{finding.meaning}</Text>
            <Text style={styles.line}>{finding.line}</Text>
          </Card>
        ) : null}

        <View style={ui.row}>
          <Button small label="Refresh" onPress={load} />
          <Button small kind="primary" label="Share" disabled={shown.length === 0} onPress={() => void Share.share({ message: logToShare(lines ?? []) })} />
          <Button
            small
            label="Clear"
            disabled={shown.length === 0}
            onPress={() => void clearKeyboardLog().then(() => setLines([]))}
          />
        </View>

        {lines === null ? <Body style={styles.note}>Reading…</Body> : null}
        {lines !== null && shown.length === 0 ? <Body style={styles.note}>Nothing noted yet.</Body> : null}
        {shown.map((line, i) => (
          <Text key={`${i}-${line}`} style={styles.line} selectable>
            {line}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.m },
  note: { color: W.muted, fontSize: 13, lineHeight: 19 },
  finding: { gap: 6, borderWidth: 1, borderColor: W.amber, backgroundColor: 'transparent' },
  findingTitle: { color: W.amberSoft, fontSize: 13, fontWeight: '700' },
  findingText: { color: W.text, fontSize: 14, lineHeight: 20 },
  line: { color: W.muted, fontSize: 12, lineHeight: 17 },
});
