import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card } from './ui';

import { Gap, W } from '@/constants/wispra';
import { setupReminders } from '@/lib/setup-guide';
import { signInWithGoogle } from '@/lib/sign-in';
import { useSetupState } from '@/lib/use-setup';

// What is still missing to use Wispra, right where it matters (T-0145)
export function SetupReminders({ screen }: { screen: 'dictate' | 'meetings' }) {
  const reminders = setupReminders(useSetupState(), screen);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reminders.length === 0) return null;

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    const result = await signInWithGoogle();
    setSigningIn(false);
    if (!result.ok && !result.cancelled) setError(result.error ?? 'Could not sign in. Try again.');
  };

  return (
    <View style={styles.list}>
      {reminders.map((r) => (
        <Card key={r.id} style={styles.card}>
          <Text style={styles.title}>{r.title}</Text>
          <Body style={styles.body}>{r.body}</Body>
          <View style={styles.actions}>
            {r.action.target === 'sign-in' ? (
              <Button small kind="primary" label={signingIn ? 'Signing in…' : r.action.label} disabled={signingIn} onPress={signIn} />
            ) : (
              <Button small kind="primary" label={r.action.label} onPress={() => router.push('/welcome')} />
            )}
          </View>
          {r.id === 'sign-in' && error ? <Text style={styles.error}>{error}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Gap.m },
  card: { borderWidth: 1, borderColor: W.amber, gap: 6 },
  title: { color: W.text, fontSize: 15, fontWeight: '600' },
  body: { color: W.muted, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: Gap.s, marginTop: 2 },
  error: { color: W.red, fontSize: 12 },
});
