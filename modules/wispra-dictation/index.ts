import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface NativeWispraDictation {
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  isBubbleEnabled(): boolean;
  setBubbleEnabled(enabled: boolean): void;
  getSession(): string | null;
  setSession(json: string | null): void;
  setCloudConfig(apiBase: string, supabaseUrl: string, publishableKey: string): void;
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

// The Wispra Cloud sign-in (JSON), kept where the mic-button service can use it too
export function getSession(): string | null {
  return native?.getSession() ?? null;
}

export function setSession(json: string | null): void {
  native?.setSession(json);
}

// Where the service sends dictations to be transcribed
export function setCloudConfig(apiBase: string, supabaseUrl: string, publishableKey: string): void {
  native?.setCloudConfig(apiBase, supabaseUrl, publishableKey);
}
