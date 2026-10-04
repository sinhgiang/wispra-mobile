import {
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { createEntry, newId } from './entries';
import { useEntries } from './entries-store';
import { needsSplit, shouldStartNextSegment } from './meeting';
import { keepAudio } from './storage';
import { SPEECH_RECORDING } from './use-recording';

// The meeting's pieces use the speech format of every recording, plus the input level, used to
// start the next piece at a quiet moment
const PIECE_RECORDING: RecordingOptions = { ...SPEECH_RECORDING, isMeteringEnabled: true };

const TICK_MS = 500;
const CHECKPOINT_MS = 10_000;

export type MeetingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving';

/**
 * Records a meeting as a run of pieces of about half a minute. Two recorders take turns: the next
 * one starts before the current one stops, so nothing said between pieces is lost, and on Android
 * the recording service (and its notification) never stops between pieces, which keeps recording
 * going with the screen locked. Each finished piece is handed to transcription straight away,
 * which is what fills the live transcript. While the screen is locked Android stops the app's
 * timers, so the current piece simply grows; it is cut into shorter pieces when it ends.
 */
export function useMeetingRecording() {
  const first = useAudioRecorder(PIECE_RECORDING);
  const second = useAudioRecorder(PIECE_RECORDING);
  const { add, update, get, addSegment, updateSegment, splitLongPiece, transcribeWaiting } = useEntries();

  const [phase, setPhase] = useState<MeetingPhase>('idle');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const active = useRef<AudioRecorder | null>(null);
  const piece = useRef<{ id: string; startMs: number } | null>(null);
  // Length of the pieces already finished
  const doneMs = useRef(0);
  const switching = useRef(false);
  const lastCheckpoint = useRef(0);
  const entryRef = useRef<string | null>(null);

  const other = (r: AudioRecorder | null) => (r === first ? second : first);

  const startPiece = useCallback(
    async (recorder: AudioRecorder, startMs: number) => {
      await recorder.prepareToRecordAsync();
      recorder.record();
      const id = newId();
      addSegment(entryRef.current!, { id, uri: recorder.uri, startMs, durationMs: 0, status: 'recording', text: null, error: null });
      active.current = recorder;
      piece.current = { id, startMs };
    },
    [addSegment],
  );

  // Stops a recorder and hands its piece to transcription
  const finishPiece = useCallback(
    async (recorder: AudioRecorder, pieceId: string, lengthMs: number) => {
      try {
        await recorder.stop();
      } catch {
        // The file keeps what was written
      }
      let uri = recorder.uri;
      try {
        if (uri) uri = keepAudio(uri);
      } catch {
        // The file stays where the recorder wrote it
      }
      const entryId = entryRef.current!;
      updateSegment(entryId, pieceId, { status: 'pending', durationMs: lengthMs, uri });
      // A piece that grew long while the screen was locked (no timers then) is cut now
      if (needsSplit({ durationMs: lengthMs })) await splitLongPiece(entryId, pieceId);
      void transcribeWaiting();
    },
    [splitLongPiece, transcribeWaiting, updateSegment],
  );

  // The next piece starts before this one stops
  const nextPiece = useCallback(async () => {
    const current = active.current;
    const currentPiece = piece.current;
    if (!current || !currentPiece || switching.current) return;
    switching.current = true;
    try {
      const next = other(current);
      await next.prepareToRecordAsync();
      const lengthMs = current.getStatus().durationMillis;
      next.record();
      const startMs = doneMs.current + lengthMs;
      const id = newId();
      addSegment(entryRef.current!, { id, uri: next.uri, startMs, durationMs: 0, status: 'recording', text: null, error: null });
      active.current = next;
      piece.current = { id, startMs };
      doneMs.current = startMs;
      await finishPiece(current, currentPiece.id, lengthMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      switching.current = false;
    }
    // other() depends only on the two recorders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSegment, finishPiece]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      const recorder = active.current;
      if (!recorder || switching.current) return;
      const status = recorder.getStatus();
      const total = doneMs.current + status.durationMillis;
      setElapsedMs(total);
      if (entryRef.current && total - lastCheckpoint.current >= CHECKPOINT_MS) {
        lastCheckpoint.current = total;
        update(entryRef.current, { durationMs: total });
      }
      if (shouldStartNextSegment(status.durationMillis, status.metering)) void nextPiece();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [nextPiece, phase, update]);

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
      // Android shows a notification while the meeting records with the screen locked
      if (Platform.OS === 'android') await requestNotificationPermissionsAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      const entry = { ...createEntry('meeting'), segments: [] };
      add(entry);
      entryRef.current = entry.id;
      setEntryId(entry.id);
      doneMs.current = 0;
      lastCheckpoint.current = 0;
      await startPiece(first, 0);
      setPhase('recording');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      return false;
    }
  }, [add, first, startPiece]);

  const pause = useCallback(() => {
    active.current?.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    active.current?.record();
    setPhase('recording');
  }, []);

  const bookmark = useCallback(() => {
    const id = entryRef.current;
    const recorder = active.current;
    if (!id || !recorder) return;
    const entry = get(id);
    if (entry) update(id, { bookmarks: [...entry.bookmarks, doneMs.current + recorder.getStatus().durationMillis] });
  }, [get, update]);

  // Stops and keeps the meeting. Returns its id.
  const stop = useCallback(async (): Promise<string | null> => {
    const id = entryRef.current;
    const recorder = active.current;
    const currentPiece = piece.current;
    if (!id || !recorder || !currentPiece) return id;
    setPhase('saving');
    // A switch to the next piece may be under way
    while (switching.current) await new Promise((r) => setTimeout(r, 50));
    const last = active.current ?? recorder;
    const lastPiece = piece.current ?? currentPiece;
    const lengthMs = last.getStatus().durationMillis;
    const total = doneMs.current + lengthMs;
    update(id, { status: 'pending', durationMs: total });
    await finishPiece(last, lastPiece.id, lengthMs);
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    active.current = null;
    piece.current = null;
    entryRef.current = null;
    setElapsedMs(total);
    setEntryId(null);
    setPhase('idle');
    return id;
  }, [finishPiece, update]);

  return { phase, entryId, elapsedMs, error, start, pause, resume, stop, bookmark };
}
