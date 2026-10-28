import type { EntryKind } from './entries';
import { usePieceRecording, type PieceRecordingOptions, type RecordingPhase } from './use-meeting-recording';

export { SPEECH_RECORDING } from './recording-options';
export type { RecordingPhase };

// A dictation or a note. It is recorded in pieces like a meeting (see use-meeting-recording.ts), so a
// long recording is safe: each piece is kept on the phone as soon as it is done, and with the app in
// the background or the screen locked it goes on until Stop is tapped (T-1072). `background: false` for a
// recording that must end when the person leaves the app (the keyboard's dictation).
export function useRecording(kind: EntryKind, options: PieceRecordingOptions = {}) {
  const rec = usePieceRecording(kind, options);
  return {
    phase: rec.phase,
    durationMs: rec.elapsedMs,
    entryId: rec.entryId,
    error: rec.error,
    notice: rec.notice,
    interrupted: rec.interrupted,
    start: rec.start,
    pause: rec.pause,
    resume: rec.resume,
    stop: rec.stop,
    cancel: rec.cancel,
    bookmark: rec.bookmark,
  };
}
