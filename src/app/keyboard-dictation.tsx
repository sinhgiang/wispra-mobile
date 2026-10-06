import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Label, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import { formatDuration } from '@/lib/entries';
import { useEntries } from '@/lib/entries-store';
import { useRecording } from '@/lib/use-recording';
import { useSession } from '@/lib/use-session';
import { handOffToKeyboard } from '@/modules/wispra-keyboard-bridge';

type Stage = 'listening' | 'transcribing' | 'ready' | 'saved' | 'error';

// Opened by the Wispra keyboard on iPhone (wispra://keyboard-dictation). iPhone keyboards have no
// microphone, so the words are spoken here: listen, tap Done, and once they are transcribed they
// are left for the keyboard, which types them when the user goes back to the app they were in.
export default function KeyboardDictationScreen() {
  const rec = useRecording('dictation');
  const { entries } = useEntries();
  const session = useSession();
  const [stage, setStage] = useState<Stage>('listening');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  const handedOff = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void rec.start();
    // Starts once when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The transcription queue picks the recording up after Done; the words are handed to the
  // keyboard as soon as they are there
  const entry = entries.find((e) => e.id === savedId);
  useEffect(() => {
    if (!entry || handedOff.current) return;
    if (entry.status === 'done' && entry.text) {
      handedOff.current = true;
      void handOffToKeyboard(entry.id, entry.text).then((ok) => {
        setStage(ok ? 'ready' : 'saved');
        if (!ok) setMessage('The keyboard could not be reached. The words are in History.');
      });
    } else if (entry.status === 'failed' || (entry.status === 'pending' && entry.error)) {
      setStage('error');
      setMessage(entry.error ?? 'Could not transcribe. The audio is kept in History.');
    }
  }, [entry]);

  const done = async () => {
    const id = await rec.stop();
    setSavedId(id);
    if (!session) {
      setStage('saved');
      setMessage('Saved in History. Sign in to Wispra Cloud in Account so the keyboard can type your words.');
    } else {
      setStage('transcribing');
    }
  };

  const cancel = async () => {
    await rec.cancel();
    router.replace('/dictate');
  };

  return (
    <SafeAreaView style={[ui.screen, styles.screen]}>
      <Label style={styles.top}>Wispra keyboard</Label>

      {stage === 'listening' ? (
        <View style={styles.centre}>
          <View style={ui.row}>
            <View style={styles.dot} />
            <Text style={styles.live}>Listening · {formatDuration(rec.durationMs)}</Text>
          </View>
          <Body style={styles.hint}>Say what you want to type, then tap Done.</Body>
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={done} style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
          <Button label="Cancel" onPress={cancel} />
          {rec.error ? <Text style={styles.error}>{rec.error}</Text> : null}
        </View>
      ) : null}

      {stage === 'transcribing' ? (
        <View style={styles.centre}>
          <Text style={styles.title}>Transcribing…</Text>
          <Body style={styles.hint}>Stay here a moment; the words are almost ready.</Body>
        </View>
      ) : null}

      {stage === 'ready' ? (
        <View style={styles.centre}>
          <Text style={styles.title}>Ready</Text>
          <Card>
            <Body style={styles.hint}>
              Go back to the app you were typing in: tap ◀ at the top left of the screen. The Wispra keyboard types
              your words there.
            </Body>
          </Card>
          {entry?.text ? <Text style={styles.preview}>{entry.text}</Text> : null}
        </View>
      ) : null}

      {stage === 'saved' || stage === 'error' ? (
        <View style={styles.centre}>
          <Text style={styles.title}>{stage === 'error' ? 'Not typed' : 'Saved'}</Text>
          <Body style={styles.hint}>{message ?? ''}</Body>
          <Button label="Open History" onPress={() => router.replace('/history')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Gap.xl },
  top: { textAlign: 'center', marginTop: Gap.l },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Gap.l },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: W.red },
  live: { color: W.red, fontSize: 15, fontWeight: '600' },
  hint: { color: W.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  done: { width: 120, height: 120, borderRadius: 60, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  title: { color: W.text, fontSize: 22, fontWeight: '700' },
  preview: { color: W.text, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  error: { color: W.red, fontSize: 13, textAlign: 'center' },
});
