import {
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { createEntry, newId, type EntryKind } from './entries';
import { useEntries } from './entries-store';
import { needsSplit, shouldStartNextSegment } from './meeting';
import { PIECE_RECORDING } from './recording-options';
import { useRecordingIndicator, type IndicatorStatus } from './recording-indicator';
import {
  NOTICE_ENDED_OUTSIDE,
  NOTICE_INTERRUPTED,
  NOTICE_NO_NOTIFICATIONS,
  NOTICE_RESUMED,
  recovered,
  watchStep,
  WATCH_START,
  type Watch,
} from './recording-watch';
import { keepAudio } from './storage';
import { endSessionBeforeRecording } from '@/modules/wispra-keyboard-bridge';

const TICK_MS = 500;
const CHECKPOINT_MS = 10_000;
// A piece shorter than this has nothing in it worth sending for transcription
const EMPTY_PIECE_MS = 300;

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving';
export type MeetingPhase = RecordingPhase;

export interface PieceRecordingOptions {
  // Keep recording when the app goes to the background or the screen is locked, until Stop is tapped
  // (default). Off for a recording that must end when the person leaves the app.
  background?: boolean;
}

/**
 * Records a meeting, a dictation or a note as a run of pieces: about half a minute for a meeting, whose
 * live transcript keeps up with it, 30 to 40 seconds for the others. Two recorders take turns: the next
 * one starts before the current one stops, so nothing said between pieces is lost, and on Android the
 * recording service (and its notification) never stops between pieces. Each finished piece is kept on the
 * phone and handed to transcription straight away; a piece that cannot be sent (no network) waits, and the
 * ones before it are never lost. While the screen is locked Android stops the app's timers, so the
 * current piece simply grows; it is cut into shorter pieces when it ends.
 *
 * In the background (T-1072): iPhone has the "audio" background mode (the config plugin of expo-audio),
 * Android a foreground service with a notification that stays while recording (Stop is on it). If the
 * microphone is taken (a call), the recorded part is kept and the recording carries on by itself when
 * it is free; see recording-watch.ts.
 */
export function usePieceRecording(kind: EntryKind, options: PieceRecordingOptions = {}) {
  const wantsBackground = options.background !== false;
  const first = useAudioRecorder(PIECE_RECORDING);
  const second = useAudioRecorder(PIECE_RECORDING);
  const { add, update, get, remove, addSegment, updateSegment, splitLongPiece, transcribeWaiting } = useEntries();

  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Something to tell the person that is not a failure: the microphone taken, notifications off
  const [notice, setNotice] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  // The recording that was ended from outside the app (Android: the notification's Stop), for the screen to open
  const [endedId, setEndedId] = useState<string | null>(null);

  const active = useRef<AudioRecorder | null>(null);
  const piece = useRef<{ id: string; startMs: number } | null>(null);
  // When the running piece started on the clock, and its length at the last look
  const pieceStartedAt = useRef(0);
  const lastLengthMs = useRef(0);
  // Length of the pieces already finished
  const doneMs = useRef(0);
  const switching = useRef(false);
  const lastCheckpoint = useRef(0);
  const entryRef = useRef<string | null>(null);
  const watch = useRef<Watch>(WATCH_START);
  // Which recorder the next try after an interruption uses (a failed try may leave one prepared)
  const tries = useRef(0);

  // The small indicator while recording: a Live Activity on iPhone, a faint button on Android (T-1073). Not for a
  // recording that must end when the person leaves the app.
  const indicator: IndicatorStatus | null = !wantsBackground ? null : phase === 'recording' ? (interrupted ? 'interrupted' : 'recording') : phase === 'paused' ? 'paused' : null;
  useRecordingIndicator(kind, indicator, elapsedMs);

  const other = (r: AudioRecorder | null) => (r === first ? second : first);

  // `verify`: after an interruption the microphone may still be busy, and record() then does nothing
  const startPiece = useCallback(
    async (recorder: AudioRecorder, startMs: number, verify = false) => {
      // A new file for each piece (see use-recording: iOS reuses the file without the options)
      await recorder.prepareToRecordAsync(PIECE_RECORDING);
      recorder.record();
      if (verify && !recorder.getStatus().isRecording) {
        try {
          await recorder.stop();
        } catch {
          // Nothing was written
        }
        throw new Error('The microphone is busy');
      }
      const id = newId();
      addSegment(entryRef.current!, { id, uri: recorder.uri, startMs, durationMs: 0, status: 'recording', text: null, error: null });
      active.current = recorder;
      piece.current = { id, startMs };
      pieceStartedAt.current = Date.now();
      lastLengthMs.current = 0;
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
      if (lengthMs < EMPTY_PIECE_MS) {
        // Nothing was recorded in it: no request for it
        updateSegment(entryId, pieceId, { status: 'done', durationMs: lengthMs, uri, text: '' });
        void transcribeWaiting();
        return;
      }
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
      await next.prepareToRecordAsync(PIECE_RECORDING);
      const lengthMs = current.getStatus().durationMillis;
      next.record();
      const startMs = doneMs.current + lengthMs;
      const id = newId();
      addSegment(entryRef.current!, { id, uri: next.uri, startMs, durationMs: 0, status: 'recording', text: null, error: null });
      active.current = next;
      piece.current = { id, startMs };
      pieceStartedAt.current = Date.now();
      lastLengthMs.current = 0;
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

  // The microphone was taken (iPhone): what was recorded is kept as a piece, and the next tries start
  const beginInterruption = useCallback(async () => {
    const current = active.current;
    const currentPiece = piece.current;
    if (!current || !currentPiece || switching.current) return;
    switching.current = true;
    try {
      const lengthMs = Math.max(current.getStatus().durationMillis, lastLengthMs.current);
      doneMs.current += lengthMs;
      active.current = null;
      piece.current = null;
      tries.current = 0;
      setInterrupted(true);
      setNotice(NOTICE_INTERRUPTED);
      await finishPiece(current, currentPiece.id, lengthMs);
      setElapsedMs(doneMs.current);
    } finally {
      switching.current = false;
    }
  }, [finishPiece]);

  // One try to record again after an interruption
  const retryAfterInterruption = useCallback(async () => {
    if (switching.current || !entryRef.current) return;
    switching.current = true;
    try {
      tries.current += 1;
      const recorder = tries.current % 2 === 1 ? first : second;
      await startPiece(recorder, doneMs.current, true);
      watch.current = recovered();
      setInterrupted(false);
      setNotice(NOTICE_RESUMED);
    } catch {
      // Still busy: the next try is in a couple of seconds
    } finally {
      switching.current = false;
    }
  }, [first, second, startPiece]);

  // Ends the recording and keeps it. `outside`: it was already stopped from outside the app (Android:
  // the Stop button of the notification), so the recorder has no length to read any more.
  const finish = useCallback(
    async (outside = false): Promise<string | null> => {
      const id = entryRef.current;
      if (!id) return null;
      setPhase('saving');
      // A switch to the next piece may be under way
      while (switching.current) await new Promise((r) => setTimeout(r, 50));
      const last = active.current;
      const lastPiece = piece.current;
      const lengthMs = last && lastPiece ? Math.max(outside ? 0 : last.getStatus().durationMillis, lastLengthMs.current) : 0;
      const total = doneMs.current + lengthMs;
      update(id, { status: 'pending', durationMs: total });
      if (last && lastPiece) await finishPiece(last, lastPiece.id, lengthMs);
      else void transcribeWaiting();
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
      active.current = null;
      piece.current = null;
      entryRef.current = null;
      watch.current = WATCH_START;
      setInterrupted(false);
      setElapsedMs(total);
      setEntryId(null);
      if (outside) setEndedId(id);
      setPhase('idle');
      return id;
    },
    [finishPiece, transcribeWaiting, update],
  );

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      if (switching.current) return;
      const recorder = active.current;
      const status = recorder?.getStatus();
      const now = Date.now();
      const step = watchStep(watch.current, {
        recording: status?.isRecording ?? false,
        pieceMs: recorder ? now - pieceStartedAt.current : 0,
        platform: Platform.OS === 'android' ? 'android' : 'ios',
        now,
      });
      watch.current = step.watch;
      if (step.action === 'interrupted') return void beginInterruption();
      if (step.action === 'retry') return void retryAfterInterruption();
      if (step.action === 'ended-outside') {
        setNotice(NOTICE_ENDED_OUTSIDE);
        return void finish(true);
      }
      if (!recorder || !status) return;
      lastLengthMs.current = status.durationMillis;
      const total = doneMs.current + status.durationMillis;
      setElapsedMs(total);
      if (entryRef.current && total - lastCheckpoint.current >= CHECKPOINT_MS) {
        lastCheckpoint.current = total;
        update(entryRef.current, { durationMs: total });
      }
      if (shouldStartNextSegment(status.durationMillis, status.metering, kind)) void nextPiece();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [beginInterruption, finish, kind, nextPiece, phase, retryAfterInterruption, update]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    setNotice(null);
    setEndedId(null);
    setPhase('starting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Wispra needs the microphone to record. Allow it in your phone settings.');
        setPhase('idle');
        return false;
      }
      // Android keeps recording in the background with a service, which needs its notification allowed:
      // without it the recording still works, but only while the app is open
      let background = wantsBackground;
      if (background && Platform.OS === 'android') {
        const notifications = await requestNotificationPermissionsAsync();
        if (!notifications.granted) {
          background = false;
          setNotice(NOTICE_NO_NOTIFICATIONS);
        }
      }
      // iPhone: a keyboard listening session would share the microphone; it ends first
      await endSessionBeforeRecording();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: background });
      const entry = { ...createEntry(kind), segments: [] };
      add(entry);
      entryRef.current = entry.id;
      setEntryId(entry.id);
      doneMs.current = 0;
      lastCheckpoint.current = 0;
      watch.current = WATCH_START;
      setInterrupted(false);
      await startPiece(first, 0);
      setElapsedMs(0);
      setPhase('recording');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      return false;
    }
  }, [add, first, kind, startPiece, wantsBackground]);

  const pause = useCallback(() => {
    active.current?.pause();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    active.current?.record();
    pieceStartedAt.current = Date.now();
    setPhase('recording');
  }, []);

  const bookmark = useCallback(() => {
    const id = entryRef.current;
    const recorder = active.current;
    if (!id) return;
    const entry = get(id);
    if (entry) update(id, { bookmarks: [...entry.bookmarks, doneMs.current + (recorder?.getStatus().durationMillis ?? 0)] });
  }, [get, update]);

  // Stops and keeps the recording. Returns its id.
  const stop = useCallback(() => finish(false), [finish]);

  // Stops and throws the recording away, with every piece of it
  const cancel = useCallback(async () => {
    const id = entryRef.current;
    if (!id) return;
    while (switching.current) await new Promise((r) => setTimeout(r, 50));
    try {
      await active.current?.stop();
    } catch {
      // Nothing to keep anyway
    }
    remove(id);
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    active.current = null;
    piece.current = null;
    entryRef.current = null;
    watch.current = WATCH_START;
    setInterrupted(false);
    setNotice(null);
    setEntryId(null);
    setElapsedMs(0);
    setPhase('idle');
  }, [remove]);

  return { phase, entryId, endedId, elapsedMs, error, notice, interrupted, start, pause, resume, stop, cancel, bookmark };
}

export function useMeetingRecording() {
  return usePieceRecording('meeting');
}
