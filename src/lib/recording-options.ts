import { RecordingPresets, type RecordingOptions } from 'expo-audio';

// Speech, not music: mono AAC at 16 kHz and 32 kbps is about 14 MB an hour, small enough to send
// for transcription. Written straight into the document directory, which the system never clears.
export const SPEECH_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  directory: 'document',
};

// Every recording is made in pieces: the speech format, plus the input level, used to start the
// next piece at a quiet moment
export const PIECE_RECORDING: RecordingOptions = { ...SPEECH_RECORDING, isMeteringEnabled: true };
