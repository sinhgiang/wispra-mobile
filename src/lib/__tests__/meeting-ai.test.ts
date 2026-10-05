import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { meetingLanguage, type TranscriptLine } from '../meeting';

const mockPrompts: string[] = [];
jest.mock('../ai', () => ({
  chatJson: async (system: string) => {
    mockPrompts.push(system);
    return { title: 'Bảo mật web và AI', summary: 'Mở đầu.\n\n## Kiểm tra âm thanh\n- Thử ghi âm', topics: [{ title: 'Kiểm tra âm thanh', start: 1 }], actions: [] };
  },
}));

// eslint-disable-next-line import/first
import { makeOutline, withLanguage } from '../meeting-ai';

const vietnamese: TranscriptLine[] = [
  { ref: 1, startMs: 0, text: 'Hôm nay mình kiểm tra cái trang web, xem cái API của SuperPay có lộ email, username, password không.' },
  { ref: 2, startMs: 30_000, text: 'Sau đó dùng AI để quét lỗi bảo mật và gửi NDA cho các campus leads.' },
];
const english: TranscriptLine[] = [{ ref: 1, startMs: 0, text: 'Today we test the website and check whether the SuperPay API leaks emails and passwords.' }];

beforeEach(() => {
  mockPrompts.length = 0;
});

describe('the language of the meeting notes (T-0164)', () => {
  it('tells a Vietnamese meeting from an English one, English tech words and all', () => {
    expect(meetingLanguage(vietnamese.map((l) => l.text).join(' '))).toBe('Vietnamese');
    expect(meetingLanguage(english[0].text)).toBeNull();
    expect(meetingLanguage('ok')).toBeNull();
  });

  it('names Vietnamese in the prompt, so headings, topics and tasks are not written in English', async () => {
    await makeOutline(vietnamese);
    expect(mockPrompts).toHaveLength(1);
    expect(mockPrompts[0]).toContain('Write everything in Vietnamese');
    expect(mockPrompts[0]).toContain('never copy headings, topic titles, tasks or labels in English');
    expect(mockPrompts[0]).toContain('translate "## " labels into that language too');
    expect(mockPrompts[0]).not.toContain('the SAME language as the transcript');
  });

  it('keeps "the same language as the transcript" for other languages', async () => {
    await makeOutline(english);
    expect(mockPrompts[0]).toContain('the SAME language as the transcript');
    expect(withLanguage('x', null)).toBe('x');
  });
});
