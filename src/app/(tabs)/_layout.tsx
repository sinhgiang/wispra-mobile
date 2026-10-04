import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { W } from '@/constants/wispra';

// The bottom bar of the approved design: four text tabs, the current one in the accent colour
export default function WispraTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1, backgroundColor: W.bg }} />
      <TabList asChild>
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TabTrigger name="dictate" href="/dictate" asChild>
            <TabButton>Dictate</TabButton>
          </TabTrigger>
          <TabTrigger name="meetings" href="/meetings" asChild>
            <TabButton>Meetings</TabButton>
          </TabTrigger>
          <TabTrigger name="history" href="/history" asChild>
            <TabButton>History</TabButton>
          </TabTrigger>
          <TabTrigger name="account" href="/account" asChild>
            <TabButton>Account</TabButton>
          </TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: !!isFocused }} style={styles.button}>
      <Text style={[styles.label, isFocused && styles.labelActive]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: W.line, backgroundColor: W.bg, paddingTop: 12 },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  label: { color: W.muted, fontSize: 12 },
  labelActive: { color: W.accent, fontWeight: '600' },
});
