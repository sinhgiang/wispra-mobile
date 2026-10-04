import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Title, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { signOut } from '@/lib/cloud-auth';
import { readUsage, type Usage } from '@/lib/cloud-history';
import { formatDuration, formatTime, needsTranscription } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { signInWithGoogle } from '@/lib/sign-in';
import { useSession } from '@/lib/use-session';

export default function AccountScreen() {
  const { entries, syncState } = useEntries();
  const session = useSession();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const waiting = entries.filter(needsTranscription);
    return {
      count: entries.length,
      waiting: waiting.length,
      waitingMs: waiting.reduce((sum, e) => sum + e.durationMs, 0),
    };
  }, [entries]);

  const signIn = async () => {
    setError(null);
    setSigningIn(true);
    const result = await signInWithGoogle();
    setSigningIn(false);
    if (!result.ok && !result.cancelled) setError(result.error ?? 'Sign-in did not finish. Try again.');
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out of Wispra Cloud?', 'Recordings stay on this phone. They are transcribed again once you sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Account</Title>

        {session ? (
          <Card style={styles.account}>
            <View style={styles.who}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(session.email || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.whoText}>
                <Text style={styles.email} numberOfLines={1}>
                  {session.email || 'Signed in'}
                </Text>
                <Text style={styles.note}>Signed in with Google</Text>
              </View>
            </View>
            <Text style={styles.note}>Same account as Wispra on your computer. Your recordings are transcribed with Wispra Cloud.</Text>
            <View style={styles.action}>
              <Button small label="Sign out" onPress={confirmSignOut} />
            </View>
          </Card>
        ) : (
          <Card style={styles.account}>
            <Text style={styles.cardTitle}>Wispra Cloud</Text>
            <Body style={styles.note}>
              Sign in with the same Google account as Wispra on your computer. Wispra Cloud turns your recordings into
              text; until then they wait on this phone.
            </Body>
            <View style={styles.action}>
              <Button kind="primary" label={signingIn ? 'Signing in…' : 'Sign in with Google'} disabled={signingIn} onPress={signIn} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </Card>
        )}

        {session ? <UsageCard /> : null}

        <View style={styles.rows}>
          <Row label="Saved on this phone" value={`${stats.count}`} />
          {session ? (
            <Row
              label="Shared with your computer"
              value={syncState.note ? 'Not yet' : syncState.at ? `Synced ${formatTime(syncState.at)}` : '…'}
            />
          ) : null}
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

// This month's Wispra Cloud minutes and AI, as on the computer's Account page
function UsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      readUsage()
        .then((u) => alive && (setUsage(u), setFailed(false)))
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }, []),
  );
  if (!usage) return failed ? null : <Card><Text style={styles.note}>Reading this month’s usage…</Text></Card>;
  const minutes = Math.round(usage.usageSeconds / 60);
  const limit = usage.limitSeconds ? Math.round(usage.limitSeconds / 60) : null;
  const share = limit ? Math.min(1, usage.usageSeconds / (usage.limitSeconds ?? 1)) : 0;
  return (
    <Card style={styles.account}>
      <View style={styles.usageHead}>
        <Text style={styles.cardTitle}>Wispra Cloud this month</Text>
        <Text style={styles.plan}>{usage.unlimited ? 'Unlimited' : usage.plan === 'pro' ? 'Pro' : 'Free'}</Text>
      </View>
      <View style={styles.usageRow}>
        <Text style={styles.note}>Transcription</Text>
        <Text style={styles.note}>{limit ? `${minutes} / ${limit} min` : `${minutes} min`}</Text>
      </View>
      {limit ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
      ) : null}
      {usage.aiTokensUsed !== null ? (
        <View style={styles.usageRow}>
          <Text style={styles.note}>AI notes</Text>
          <Text style={styles.note}>
            {usage.aiTokensLimit
              ? `${Math.round((usage.aiTokensUsed / usage.aiTokensLimit) * 100)}% used`
              : `${usage.aiTokensUsed.toLocaleString('en-US')} tokens`}
          </Text>
        </View>
      ) : null}
    </Card>
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
  account: { gap: Gap.m, padding: 16, borderRadius: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: Gap.m },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: W.accentDeep, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: W.text, fontWeight: '700', fontSize: 16 },
  whoText: { flex: 1, minWidth: 0 },
  email: { color: W.text, fontSize: 15, fontWeight: '600' },
  cardTitle: { color: W.text, fontSize: 15, fontWeight: '600' },
  note: { color: W.muted, fontSize: 12, lineHeight: 18 },
  action: { flexDirection: 'row' },
  error: { color: W.red, fontSize: 13 },
  rows: { backgroundColor: W.surface, borderRadius: 16 },
  usageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plan: { color: '#c7d2fe', backgroundColor: '#1e1b4b', fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: W.line, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: W.accent },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLine: { borderBottomWidth: 1, borderBottomColor: W.line },
  rowLabel: { color: W.text, fontSize: 14 },
  rowValue: { color: W.muted, fontSize: 13 },
});
