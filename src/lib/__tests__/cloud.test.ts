import { describe, expect, it } from '@jest/globals';

import { needsRefresh, parseAuthCallback, parseSession } from '../session';
import { cleanTranscript, filterKnownHallucinations } from '../transcript-filter';

describe('sign-in callback', () => {
  it('reads the tokens wispra-web hands to the app', () => {
    expect(parseAuthCallback('wispra://auth#access_token=a.b.c&refresh_token=r1&expires_in=3600&token_type=bearer')).toEqual({
      accessToken: 'a.b.c',
      refreshToken: 'r1',
      expiresIn: 3600,
    });
  });

  it('accepts the query form and a missing lifetime', () => {
    expect(parseAuthCallback('wispramobile://auth?access_token=a&refresh_token=r')).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 });
  });

  it('ignores other links and incomplete ones', () => {
    expect(parseAuthCallback('wispra://meeting/1#access_token=a&refresh_token=r')).toBeNull();
    expect(parseAuthCallback('wispra://auth#access_token=a')).toBeNull();
    expect(parseAuthCallback('https://evil.example/auth#access_token=a&refresh_token=r')).toBeNull();
  });
});

describe('session', () => {
  const s = { accessToken: 'a', refreshToken: 'r', expiresAt: 1_000_000, userId: 'u', email: 'e@x.com' };

  it('refreshes five minutes before expiry', () => {
    expect(needsRefresh(s, 1_000_000 - 6 * 60_000)).toBe(false);
    expect(needsRefresh(s, 1_000_000 - 4 * 60_000)).toBe(true);
  });

  it('round-trips and rejects broken JSON', () => {
    expect(parseSession(JSON.stringify(s))).toEqual({ ...s, avatarUrl: undefined });
    expect(parseSession('{"accessToken":"a"}')).toBeNull();
    expect(parseSession('nope')).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});

describe('transcript cleaning', () => {
  it('drops segments Whisper thinks are silence or was guessing at', () => {
    expect(
      cleanTranscript({
        segments: [
          { text: ' Chào anh Minh.', no_speech_prob: 0.01, avg_logprob: -0.2 },
          { text: ' Cảm ơn các bạn đã theo dõi.', no_speech_prob: 0.9 },
          { text: ' C ph th nh', no_speech_prob: 0.1, avg_logprob: -1.6 },
        ],
      }),
    ).toBe('Chào anh Minh.');
  });

  it('drops YouTube outros Whisper invents, keeping the real speech around them', () => {
    expect(filterKnownHallucinations('Gửi báo giá trước thứ Hai. Cảm ơn các bạn đã theo dõi! Kết thúc video.')).toBe(
      'Gửi báo giá trước thứ Hai.',
    );
    expect(filterKnownHallucinations('Kết thúc video này, chúng ta chốt giá.')).toBe('Kết thúc video này, chúng ta chốt giá.');
  });

  it('cuts a sentence Whisper repeats over and over', () => {
    expect(filterKnownHallucinations('Okay. Okay. Okay. Okay.')).toBe('Okay. Okay.');
  });

  it('falls back to the plain text when there are no segments', () => {
    expect(cleanTranscript({ text: '  Hello world  ' })).toBe('Hello world');
  });
});
