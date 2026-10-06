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
  keyboardLog(): Promise<string[]>;
  clearKeyboardLog(): Promise<boolean>;
  noteKeyboardLog(text: string): Promise<boolean>;
  deliverText(utterance: string, index: number, text: string, last: boolean, failed: boolean): Promise<boolean>;
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

// Before Wispra records in the app (a dictation, a meeting): a keyboard listening session holds the
// microphone and the audio session, so it ends first
export async function endSessionBeforeRecording(): Promise<void> {
  if (!native) return;
  try {
    if ((await native.sessionState()).active) await native.endSession();
  } catch {
    // Nothing running, or the module is missing: recording goes on
  }
}

// What the app and the keyboard noted about the listening session, oldest first
export async function keyboardLog(): Promise<string[]> {
  return native ? native.keyboardLog() : [];
}

// A line in the keyboard log from JavaScript; it must never hold the words said. Never fails the caller.
export function noteKeyboardLog(text: string): void {
  try {
    void native?.noteKeyboardLog(text).catch(() => undefined);
  } catch {
    // The log is only for finding out what went wrong
  }
}

export async function clearKeyboardLog(): Promise<void> {
  await native?.clearKeyboardLog();
}

export async function sessionState(): Promise<SessionState> {
  return native ? native.sessionState() : OFF;
}

// A transcribed piece for the keyboard, typed at the cursor in order
// failed: the piece could not be transcribed (the keyboard says so, instead of "not heard")
export async function deliverText(utterance: string, index: number, text: string, last: boolean, failed = false): Promise<boolean> {
  return native ? native.deliverText(utterance, index, text, last, failed) : false;
}

export function onSessionChunk(listener: (chunk: SessionChunk) => void): Subscription | null {
  return native ? native.addListener('onChunk', listener) : null;
}

export function onSessionState(listener: (state: SessionState) => void): Subscription | null {
  return native ? native.addListener('onSession', listener) : null;
}
