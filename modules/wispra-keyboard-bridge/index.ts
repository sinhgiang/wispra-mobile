import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface KeyboardStatus {
  // Turned on in Settings; null when iOS does not say
  enabled: boolean | null;
  // When the Wispra keyboard was last on screen (ms since 1970); null: never (or no full access)
  lastSeenAt: number | null;
}

// The listening session behind the keyboard's mic (ios/KeyboardSession.swift)
export interface SessionState {
  active: boolean;
  // When it ends, ms since 1970 (0 when off)
  until: number;
  // The keyboard's mic is red: what is said is being cut into pieces
  listening: boolean;
}

// A piece of what was said, ready to transcribe; `last` ends the utterance
export interface SessionChunk {
  path: string;
  durationMs: number;
  utterance: string;
  index: number;
  last: boolean;
  // Something louder than silence was heard in it
  voiced: boolean;
}

interface Subscription {
  remove(): void;
}

interface NativeKeyboardBridge {
  handOff(id: string, text: string): Promise<boolean>;
  keyboardStatus(): Promise<KeyboardStatus>;
  startSession(minutes: number): Promise<SessionState>;
  endSession(): Promise<SessionState>;
  sessionState(): Promise<SessionState>;
  deliverText(utterance: string, index: number, text: string, last: boolean): Promise<boolean>;
  addListener(event: 'onChunk', listener: (chunk: SessionChunk) => void): Subscription;
  addListener(event: 'onSession', listener: (state: SessionState) => void): Subscription;
}

// iPhone only: the Wispra keyboard there has no microphone, so the app listens for it
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeKeyboardBridge>('WispraKeyboardBridge') : null;

export const keyboardBridgeAvailable = native !== null;

const OFF: SessionState = { active: false, until: 0, listening: false };

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

// Starts (or extends) the listening session: the microphone runs in the background until it ends
export async function startSession(minutes: number): Promise<SessionState> {
  return native ? native.startSession(minutes) : OFF;
}

export async function endSession(): Promise<SessionState> {
  return native ? native.endSession() : OFF;
}

export async function sessionState(): Promise<SessionState> {
  return native ? native.sessionState() : OFF;
}

// A transcribed piece for the keyboard, typed at the cursor in order
export async function deliverText(utterance: string, index: number, text: string, last: boolean): Promise<boolean> {
  return native ? native.deliverText(utterance, index, text, last) : false;
}

export function onSessionChunk(listener: (chunk: SessionChunk) => void): Subscription | null {
  return native ? native.addListener('onChunk', listener) : null;
}

export function onSessionState(listener: (state: SessionState) => void): Subscription | null {
  return native ? native.addListener('onSession', listener) : null;
}
