import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Gap, W } from '@/constants/wispra';

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'danger' && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      <Text style={[styles.buttonText, small && { fontSize: 13 }]}>{label}</Text>
    </Pressable>
  );
}

// A microphone drawn with plain views, so no icon font is needed
export function MicGlyph({ size = 22, color = '#ffffff' }: { size?: number; color?: string }) {
  const w = size * 0.32;
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: w, height: size * 0.56, borderRadius: w / 2, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          top: size * 0.3,
          width: size * 0.62,
          height: size * 0.42,
          borderBottomLeftRadius: size * 0.31,
          borderBottomRightRadius: size * 0.31,
          borderWidth: size * 0.09,
          borderTopWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', bottom: 0, width: size * 0.09, height: size * 0.18, backgroundColor: color }} />
    </View>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: W.bg },
  pad: { paddingHorizontal: Gap.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: Gap.s },
});

const styles = StyleSheet.create({
  title: { color: W.text, fontSize: 26, fontWeight: '700' },
  label: { color: W.muted, fontSize: 12 },
  body: { color: W.text, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: W.surface, borderRadius: 14, padding: 14, gap: Gap.s },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: W.surface },
  chipActive: { backgroundColor: W.accent },
  chipText: { color: W.muted, fontSize: 13 },
  chipTextActive: { color: '#ffffff', fontWeight: '600' },
  button: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: W.lineStrong,
    backgroundColor: W.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { height: 36, paddingHorizontal: 14, borderRadius: 18 },
  buttonPrimary: { backgroundColor: W.accent, borderColor: W.accent },
  buttonDanger: { backgroundColor: W.red, borderColor: W.red },
  buttonText: { color: W.text, fontSize: 14 },
});
