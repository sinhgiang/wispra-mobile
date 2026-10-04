import {
  RecordingPresets,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { createEntry, type EntryKind } from './entries';
import { useEntries } from './entries-store';
import { keepAudio } from './storage';

// Speech, not music: mono AAC at 16 kHz and 32 kbps is about 14 MB an hour, small enough to send
// for transcription. Written straight into the document directory, which the system never clears.
export const SPEECH_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  directory: 'document',
};

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving';

// How often the length of a running recording is written down, so a crash loses little
const CHECKPOINT_MS = 10_000;

export function useRecording(kind: EntryKind) {
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const state = useAudioRecorderState(recorder, 250);
  const { add, update, get, remove, transcribeWaiting } = useEntries();
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastCheckpoint = useRef(0);

  const durationMs = state.durationMillis;

  useEffect(() => {
    if (!entryId || phase !== 'recording') return;
    if (durationMs - lastCheckpoint.current >= CHECKPOINT_MS) {
      lastCheckpoint.current = durationMs;
      update(entryId, { durationMs });
    }
  }, [durationMs, entryId, phase, update]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    setPhase('starting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Wispra needs the microphone to record. Allow it in your phone settings.');
        setPhase('idle');
        return false;
      }
      // Meetings keep recording with the screen locked; Android shows a notification while it does
      if (kind === 'meeting' && Platform.OS === 'android') await requestNotificationPermissionsAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: kind === 'meeting' });
      await recorder.prepareToRecordAsync();
      recorder.record();
      const entry = { ...createEntry(kind), audioUri: recorder.uri };
      add(entry);
      lastCheckpoint.current = 0;
      setEntryId(entry.id);
      setPhase('recording');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      return false;
    }
  }, [add, kind, recorder]);

  const pause = useCallback(() => {
    recorder.pause();
    setPhase('paused');
  }, [recorder]);

  const resume = useCallback(() => {
    recorder.record();
    setPhase('recording');
  }, [recorder]);

  const bookmark = useCallback(() => {
    if (!entryId) return;
    const entry = get(entryId);
    if (entry) update(entryId, { bookmarks: [...entry.bookmarks, recorder.getStatus().durationMillis] });
  }, [entryId, get, recorder, update]);

  // Stops and keeps the recording. Returns the id of the saved entry.
  const stop = useCallback(async (): Promise<string | null> => {
    if (!entryId) return null;
    const id = entryId;
    setPhase('saving');
    const length = recorder.getStatus().durationMillis;
    try {
      await recorder.stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    let audioUri = recorder.uri ?? get(id)?.audioUri ?? null;
    try {
      if (audioUri) audioUri = keepAudio(audioUri);
    } catch (err) {
        // The file stays where the recorder wrote it
    }
    update(id, { status: 'pending', durationMs: Math.max(length, get(id)?.durationMs ?? 0), audioUri });
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    setEntryId(null);
    setPhase('idle');
    void transcribeWaiting();
    return id;
  }, [entryId, get, recorder, transcribeWaiting, update]);

  // Stops and throws the recording away
  const cancel = useCallback(async () => {
    if (!entryId) return;
    const id = entryId;
    try {
      await recorder.stop();
    } catch {
      // Nothing to keep anyway
    }
    remove(id);
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    setEntryId(null);
    setPhase('idle');
  }, [entryId, recorder, remove]);

  return { phase, durationMs, entryId, error, start, pause, resume, stop, cancel, bookmark };
}
