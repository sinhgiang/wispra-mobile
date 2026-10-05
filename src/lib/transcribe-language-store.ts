import { loadTranscribeLanguage, saveTranscribeLanguage } from './storage';
import type { TranscribeLanguage } from './transcribe-language';
import { setTranscribeLanguage } from '@/modules/wispra-dictation';

// The language chosen in Account is kept in a file the app reads; the Android keyboard and mic
// button run in their own service and read it from there (setTranscribeLanguage), so every choice
// and every start of the app tells it.
export function chooseTranscribeLanguage(language: TranscribeLanguage): void {
  saveTranscribeLanguage(language);
  setTranscribeLanguage(language);
}

export function syncTranscribeLanguage(): TranscribeLanguage {
  const language = loadTranscribeLanguage();
  setTranscribeLanguage(language);
  return language;
}
