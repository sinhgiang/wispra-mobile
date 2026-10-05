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
  setTranscribeLanguage(language: string): void;
  isKeyboardEnabled(): boolean;
  openKeyboardSettings(): void;
  showKeyboardPicker(): void;
  splitAudio(uri: string, pieceMs: number): Promise<{ uri: string; startMs: number; durationMs: number }[]>;
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

// The Wispra keyboard (Android): the backup for apps where the mic button cannot appear
export function isKeyboardEnabled(): boolean {
  return native?.isKeyboardEnabled() ?? false;
}

export function openKeyboardSettings(): void {
  native?.openKeyboardSettings();
}

export function showKeyboardPicker(): void {
  native?.showKeyboardPicker();
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

export const canSplitAudio = native !== null;

// Cuts an .m4a recording into pieces of pieceMs without re-encoding (Android). The original file
// stays; remove it once the pieces are saved.
export async function splitAudio(uri: string, pieceMs: number): Promise<{ uri: string; startMs: number; durationMs: number }[]> {
  if (!native) throw new Error('Splitting audio is not available on this phone.');
  return native.splitAudio(uri, pieceMs);
}

// The language the Android keyboard and the mic button tell Whisper ("vi", "auto" or "en"), the one
// chosen in Account
export function setTranscribeLanguage(language: string): void {
  native?.setTranscribeLanguage(language);
}

// Where the service sends dictations to be transcribed
export function setCloudConfig(apiBase: string, supabaseUrl: string, publishableKey: string): void {
  native?.setCloudConfig(apiBase, supabaseUrl, publishableKey);
}
