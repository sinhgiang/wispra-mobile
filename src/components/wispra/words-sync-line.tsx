import { StyleSheet, Text, View } from 'react-native';

import { Button } from './ui';

import { W } from '@/constants/wispra';
import { currentSession } from '@/lib/cloud-auth';
import { useEntries } from '@/lib/entries-store';
import { formatTime } from '@/lib/entries';
import { useSession } from '@/lib/use-session';
import { syncWords, useWordsSyncStatus } from '@/lib/words-sync-store';

// What the Custom vocabulary and Learned screens say about sharing the words with Wispra on the computer
// (T-0193), and a button to do it now.
export function WordsSyncLine() {
  const { cloudAllowed } = useEntries();
  const session = useSession();
  const status = useWordsSyncStatus();
  const allowed = session !== null && cloudAllowed();
  const now = () => void syncWords(() => (allowed && currentSession() ? { userId: currentSession()?.userId ?? '' } : null));

  let text: string;
  if (!session) text = 'Sign in to Wispra Cloud in Account to share these words with Wispra on your computer.';
  else if (!allowed) text = 'Answer the question about your accounts to share these words with Wispra Cloud.';
  else if (status.running) text = 'Sharing with Wispra Cloud…';
  else if (status.note) text = status.note;
  else if (status.at) text = `Shared with Wispra Cloud, last at ${formatTime(status.at)}. They reach Wispra on your computer at its next sync.`;
  else text = 'Shared with Wispra Cloud when you are online.';

  return (
    <View style={styles.box}>
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {text}
      </Text>
      {allowed ? <Button small label="Sync now" disabled={status.running} onPress={now} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  text: { color: W.muted, fontSize: 13, lineHeight: 19 },
});
