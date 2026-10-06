import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_TRANSCRIBE_LANGUAGE,
  parseTranscribeLanguage,
  TRANSCRIBE_LANGUAGES,
  transcribeLanguageLabel,
  whisperLanguage,
  withChosenLanguage,
} from '../transcribe-language';

// The same cases as TranscribeLanguageTest.kt, so the app and the Android keyboard agree
describe('the transcription language (T-0145, W-0311)', () => {
  it('offers Vietnamese, Auto-detect and English, Vietnamese by default', () => {
    expect(TRANSCRIBE_LANGUAGES.map((l) => [l.value, l.label])).toEqual([
      ['vi', 'Vietnamese'],
      ['auto', 'Auto-detect'],
      ['en', 'English'],
    ]);
    expect(DEFAULT_TRANSCRIBE_LANGUAGE).toBe('vi');
  });

  it('reads the saved choice back, and falls back to Vietnamese for anything else', () => {
    expect(parseTranscribeLanguage('vi')).toBe('vi');
    expect(parseTranscribeLanguage('auto')).toBe('auto');
    expect(parseTranscribeLanguage(' en\n')).toBe('en');
    for (const bad of [null, undefined, '', 'fr', 'Vietnamese']) expect(parseTranscribeLanguage(bad)).toBe('vi');
  });

  it('sends the code to Whisper, and nothing for Auto-detect', () => {
    expect(whisperLanguage('vi')).toBe('vi');
    expect(whisperLanguage('en')).toBe('en');
    expect(whisperLanguage('auto')).toBeUndefined();
    expect(transcribeLanguageLabel('auto')).toBe('Auto-detect');
  });

  it('uses the chosen language unless the caller names one', () => {
    expect(withChosenLanguage({}, 'vi')).toEqual({ language: 'vi' });
    expect(withChosenLanguage({}, 'en')).toEqual({ language: 'en' });
    expect(withChosenLanguage({}, 'auto')).toEqual({ language: undefined });
    // The caller's own choice wins, even "none"
    expect(withChosenLanguage({ language: 'en' }, 'vi')).toEqual({ language: 'en' });
    expect(withChosenLanguage({ language: undefined }, 'vi')).toEqual({ language: undefined });
  });
});
