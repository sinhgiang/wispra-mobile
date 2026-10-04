import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface NativeWispraDictation {
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  isBubbleEnabled(): boolean;
  setBubbleEnabled(enabled: boolean): void;
}

// Android only: the mic button over other apps' text fields. iPhone gets the Wispra keyboard instead.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeWispraDictation>('WispraDictation') : null;

export const bubbleSupported = native !== null;

export function isServiceEnabled(): boolean {
  return native?.isServiceEnabled() ?? false;
}

export function openAccessibilitySettings(): void {
  native?.openAccessibilitySettings();
}

export function isBubbleEnabled(): boolean {
  return native?.isBubbleEnabled() ?? false;
}

export function setBubbleEnabled(enabled: boolean): void {
  native?.setBubbleEnabled(enabled);
}
