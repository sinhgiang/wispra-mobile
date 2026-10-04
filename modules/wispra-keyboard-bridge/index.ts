import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface KeyboardStatus {
  // Turned on in Settings; null when iOS does not say
  enabled: boolean | null;
  // When the Wispra keyboard was last on screen (ms since 1970); null: never (or no full access)
  lastSeenAt: number | null;
}

interface NativeKeyboardBridge {
  handOff(id: string, text: string): Promise<boolean>;
  keyboardStatus(): Promise<KeyboardStatus>;
}

// iPhone only: the Wispra keyboard there has no microphone, so the app hands it the words
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeKeyboardBridge>('WispraKeyboardBridge') : null;

export const keyboardBridgeAvailable = native !== null;

// iPhone only (null elsewhere, or in a build without the module)
export async function keyboardStatus(): Promise<KeyboardStatus | null> {
  if (!native) return null;
  try {
    return await native.keyboardStatus();
  } catch {
    return null;
  }
}

// Leaves the words for the Wispra keyboard, which types them when the user goes back to the app
// they were typing in
export async function handOffToKeyboard(id: string, text: string): Promise<boolean> {
  return native ? native.handOff(id, text) : false;
}
