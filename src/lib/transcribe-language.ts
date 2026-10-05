// The language Whisper is told the speech is in (T-0145, the owner's choice at W-0311): as on the
// computer ("Spoken (input)"), the language goes to Whisper through Wispra Cloud as the `language`
// field. Vietnamese by default, since Whisper guessing the language of a short, noisy piece is a
// suspected cause of Vietnamese written without its accents (T-0164). Pure, so it is tested.

export type TranscribeLanguage = 'vi' | 'auto' | 'en';

export const TRANSCRIBE_LANGUAGES: { value: TranscribeLanguage; label: string }[] = [
  { value: 'vi', label: 'Vietnamese' },
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
];

export const DEFAULT_TRANSCRIBE_LANGUAGE: TranscribeLanguage = 'vi';

// The saved choice, read back: one of the three, or the default
export function parseTranscribeLanguage(text: string | null | undefined): TranscribeLanguage {
  const value = text?.trim();
  return TRANSCRIBE_LANGUAGES.some((l) => l.value === value) ? (value as TranscribeLanguage) : DEFAULT_TRANSCRIBE_LANGUAGE;
}

export function transcribeLanguageLabel(language: TranscribeLanguage): string {
  return TRANSCRIBE_LANGUAGES.find((l) => l.value === language)?.label ?? 'Vietnamese';
}

// What is sent to Whisper: the language code, nothing for "auto" (Whisper guesses)
export function whisperLanguage(language: TranscribeLanguage): string | undefined {
  return language === 'auto' ? undefined : language;
}

// The options a transcription is sent with: the language chosen in Account, unless the caller names
// one (an explicit `language` key, even undefined, which means "let Whisper guess")
export function withChosenLanguage<T extends { language?: string }>(options: T, chosen: TranscribeLanguage): T {
  return 'language' in options ? options : { ...options, language: whisperLanguage(chosen) };
}
