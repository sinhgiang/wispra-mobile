import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, ui } from '@/components/wispra/ui';
import { Gap, W } from '@/constants/wispra';
import type { AccountChoice } from '@/lib/account-switch';
import { useEntries } from '@/lib/entries-store';

// Shown when another account signs in than the one whose data is on this phone (T-0142). It cannot
// be dismissed: nothing is synced until one of the two options is chosen.
export default function AccountSwitchScreen() {
  const { accountChoice, chooseAccount } = useEntries();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Chosen (or nothing to choose any more): back to where the user was
    if (!accountChoice) {
      if (router.canGoBack()) router.back();
      else router.replace('/dictate');
    }
  }, [accountChoice]);

  if (!accountChoice) return <SafeAreaView style={ui.screen} />;
  const { text, data, shownIds } = accountChoice;

  // The choice applies to exactly the entries this screen counted (shownIds)
  const apply = (choice: AccountChoice) => {
    const result = chooseAccount(choice, shownIds);
    if (result === 'changed') {
      Alert.alert(
        'The recordings on this phone changed',
        'A recording came in or ended while you were choosing. Nothing was changed. Look at the numbers again and choose.',
      );
    } else if (result === 'save-failed') {
      Alert.alert('Could not save', 'Nothing was changed and nothing was deleted. Free some space on the phone and try again.');
    }
  };

  const choose = (choice: AccountChoice) => {
    if (choice === 'new-only' && data.onlyHere > 0) {
      Alert.alert(
        'Delete what is only on this phone?',
        `${data.onlyHere === 1 ? '1 recording is' : `${data.onlyHere} recordings are`} only on this phone (meetings, and dictations not shared yet). They cannot be brought back.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: text.newOnly.label, style: 'destructive', onPress: () => apply('new-only') },
        ],
      );
      return;
    }
    apply(choice);
  };

  return (
    <SafeAreaView style={ui.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{text.title}</Text>
        <Body style={styles.intro}>{text.intro}</Body>
        <Option label={text.merge.label} detail={text.merge.detail} onPress={() => choose('merge')} />
        <Option label={text.newOnly.label} detail={text.newOnly.detail} onPress={() => choose('new-only')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Option({ label, detail, onPress }: { label: string; detail: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} onPress={onPress} style={styles.option}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View>
        <Text style={styles.optionDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Gap.xl, paddingTop: Gap.xl + 16, gap: Gap.l },
  title: { color: W.text, fontSize: 22, fontWeight: '700' },
  intro: { color: W.muted, fontSize: 14, lineHeight: 21 },
  option: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: W.lineStrong, backgroundColor: W.surface, gap: 6 },
  optionLabel: { color: W.text, fontSize: 16, fontWeight: '700' },
  optionDetail: { color: W.muted, fontSize: 13, lineHeight: 19 },
});
