import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface NativeKeyboardBridge {
  handOff(id: string, text: string): Promise<boolean>;
}

// iPhone only: the Wispra keyboard there has no microphone, so the app hands it the words
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeKeyboardBridge>('WispraKeyboardBridge') : null;

export const keyboardBridgeAvailable = native !== null;

// Leaves the words for the Wispra keyboard, which types them when the user goes back to the app
// they were typing in
export async function handOffToKeyboard(id: string, text: string): Promise<boolean> {
  return native ? native.handOff(id, text) : false;
}
