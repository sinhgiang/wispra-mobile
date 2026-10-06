import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { TranscriptLine } from '../meeting';

const mockCalls: { system: string; user: string; maxTokens: number; temperature: number | undefined }[] = [];
jest.mock('../ai', () => ({
  chatJson: async (system: string, user: string, maxTokens: number, temperature?: number) => {
    mockCalls.push({ system, user, maxTokens, temperature });
    return system.includes('"metaDescription"')
      ? { title: 'Bảo mật web: bài học', metaDescription: 'Mô tả', body: 'Mở bài.\\n\\n## Điểm chính\\n- Một' }
      : { posts: ['Một', 'Hai', 'Ba'] };
  },
}));

// eslint-disable-next-line import/first
import { CONTENT_MAX_TOKENS, contentPrompt, contentSource, makeContent, MAX_TRANSCRIPT_CHARS, parseContent, PLATFORMS } from '../meeting-content';

const vietnamese: TranscriptLine[] = [
  { ref: 1, startMs: 0, text: 'Hôm nay mình kiểm tra trang web, xem API của SuperPay có lộ email, username, password không. Sau đó dùng AI để quét lỗi.' },
];

beforeEach(() => {
  mockCalls.length = 0;
});

describe('posts like the computer’s (T-0164)', () => {
  it('has the computer’s five platforms, the X one shown as X', () => {
    expect(PLATFORMS.map((p) => [p.value, p.label])).toEqual([
      ['website', 'Website'],
      ['facebook', 'Facebook'],
      ['instagram', 'Instagram'],
      ['linkedin', 'LinkedIn'],
      ['twitter', 'X'],
    ]);
  });

  it('uses the computer’s prompts, naming Vietnamese when the meeting is in Vietnamese', () => {
    expect(contentPrompt('facebook', null)).toContain('Write exactly 3 distinct ready-to-post variants');
    expect(contentPrompt('twitter', null)).toContain('number each post "1/", "2/", "3/"');
    expect(contentPrompt('website', null)).toContain('"## Key takeaways"');
    const vi = contentPrompt('linkedin', 'Vietnamese');
    expect(vi).toContain('- Write in Vietnamese.');
    expect(vi).not.toContain('the SAME language as the transcript');
  });

  it('writes three versions of a social post, and a website article with its SEO title', async () => {
    const fb = await makeContent(vietnamese, 'facebook');
    expect(fb.posts).toEqual(['Một', 'Hai', 'Ba']);
    expect(mockCalls[0]).toMatchObject({ maxTokens: CONTENT_MAX_TOKENS.facebook, temperature: 0.5 });
    expect(mockCalls[0].system).toContain('Write in Vietnamese');
    const site = await makeContent(vietnamese, 'website');
    expect(site).toMatchObject({ title: 'Bảo mật web: bài học', metaDescription: 'Mô tả' });
    // "\n" written as two characters by the model becomes a real line break
    expect(site.body).toBe('Mở bài.\n\n## Điểm chính\n- Một');
  });

  it('reads only usable answers', () => {
    expect(parseContent('facebook', { posts: [' ', 'Một'] })?.posts).toEqual(['Một']);
    expect(parseContent('facebook', { posts: [] })).toBeNull();
    expect(parseContent('website', { title: 'x' })).toBeNull();
    expect(parseContent('instagram', 'not json')).toBeNull();
  });

  it('sends the start and the end of a long meeting, as the computer does', () => {
    const long = [{ ref: 1, startMs: 0, text: `${'a'.repeat(15_000)}${'b'.repeat(15_000)}` }];
    const source = contentSource(long);
    expect(source.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS + 20);
    expect(source.startsWith('a')).toBe(true);
    expect(source.endsWith('b')).toBe(true);
    expect(source).toContain('[...]');
  });
});
