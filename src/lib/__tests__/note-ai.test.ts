// The AI work of a note (T-0979): the mind map is checked and repaired at most twice, then shown as
// text; a connection problem is not taken for a bad map; the tokens Wispra Cloud bills are added up.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AiError, billedTokens, newMeter } from '../ai';
import { MAP_REPAIRS, makeBasics, makeExpertArticle, makeExpertOutline, makeNoteMap, NOTE_CHARS } from '../note-ai';

const mockChatJson = jest.fn<(system: string, user: string, maxTokens: number, temperature?: number) => Promise<unknown>>();
jest.mock('../ai', () => {
  const actual = jest.requireActual('../ai') as typeof import('../ai');
  return { ...actual, chatJson: (...args: [string, string, number, number?]) => mockChatJson(...args) };
});

const GOOD_MAP = { title: 'Nền tảng tour', topics: [{ label: 'Khoảng trống' }], branchLabels: {} };
const VIETNAMESE = 'Tôi muốn làm một nền tảng cho người địa phương tự đăng tour và tự dẫn khách ở Cao Bằng.';
const ENGLISH = 'I want to build a platform where local guides list their own tours and lead their own groups.';

beforeEach(() => {
  mockChatJson.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the title, field and expert', () => {
  it('asks once, names the language when the note is Vietnamese, and returns the three things', async () => {
    mockChatJson.mockResolvedValueOnce({ title: 'Nền tảng tour địa phương', domain: 'Du lịch', role: 'chuyên gia phát triển thị trường du lịch' });
    const basics = await makeBasics(VIETNAMESE);
    expect(basics).toEqual({ title: 'Nền tảng tour địa phương', domain: 'Du lịch', role: 'chuyên gia phát triển thị trường du lịch' });
    expect(mockChatJson).toHaveBeenCalledTimes(1);
    const [system, user, maxTokens] = mockChatJson.mock.calls[0];
    expect(system).toContain('Write everything in Vietnamese');
    expect(user).toBe(VIETNAMESE);
    expect(maxTokens).toBeGreaterThan(1000);
  });

  it('keeps "the same language" for a note in English, and fails clearly on an incomplete answer', async () => {
    mockChatJson.mockResolvedValueOnce({ title: 'x', domain: 'y', role: 'z' });
    await makeBasics(ENGLISH);
    expect(mockChatJson.mock.calls[0][0]).toContain('SAME language as the note');
    mockChatJson.mockResolvedValueOnce({ title: 'x' });
    await expect(makeBasics(ENGLISH)).rejects.toThrow(/incomplete/);
  });

  it('sends a very long note as its start and its end, never more than the limit', async () => {
    mockChatJson.mockResolvedValueOnce({ title: 'x', domain: 'y', role: 'z' });
    await makeBasics('a'.repeat(NOTE_CHARS * 2));
    const sent = mockChatJson.mock.calls[0][1];
    expect(sent.length).toBeLessThan(NOTE_CHARS + 20);
    expect(sent).toContain('[…]');
  });
});

describe('the expert outline and article', () => {
  it('write as the chosen expert, from the words, and refuse an empty answer', async () => {
    mockChatJson.mockResolvedValueOnce({ outline: '## Ý chính\n- Nền tảng tour' });
    expect(await makeExpertOutline(VIETNAMESE, 'chuyên gia du lịch')).toBe('## Ý chính\n- Nền tảng tour');
    expect(mockChatJson.mock.calls[0][0]).toContain('You are chuyên gia du lịch');
    mockChatJson.mockResolvedValueOnce({ outline: '' });
    await expect(makeExpertOutline(VIETNAMESE, 'r')).rejects.toThrow(/empty/);

    mockChatJson.mockResolvedValueOnce({ article: 'Tiêu đề\n\nĐoạn một.' });
    expect(await makeExpertArticle(VIETNAMESE, 'chuyên gia du lịch')).toBe('Tiêu đề\n\nĐoạn một.');
    const [system, , , temperature] = mockChatJson.mock.calls[2];
    expect(system).toContain('invented facts');
    expect(temperature).toBe(0.5);
  });

  it('never ask the AI to invent what the person did not say', async () => {
    mockChatJson.mockResolvedValue({ outline: 'x', article: 'y' });
    await makeExpertOutline(ENGLISH, 'a travel expert');
    await makeExpertArticle(ENGLISH, 'a travel expert');
    expect(mockChatJson.mock.calls[0][0]).toMatch(/NEVER invent facts/);
    expect(mockChatJson.mock.calls[1][0]).toMatch(/do not state invented facts/);
  });
});

describe('the mind map', () => {
  it('is drawn from the first answer when it is whole', async () => {
    mockChatJson.mockResolvedValueOnce(GOOD_MAP);
    const result = await makeNoteMap(VIETNAMESE, 'chuyên gia du lịch');
    expect(result.map?.title).toBe('Nền tảng tour');
    expect(result.text).toBeUndefined();
    expect(mockChatJson).toHaveBeenCalledTimes(1);
    // The meeting map’s prompt, with the expert added and Vietnamese named
    expect(mockChatJson.mock.calls[0][0]).toContain('mind map');
    expect(mockChatJson.mock.calls[0][0]).toContain('You are chuyên gia du lịch');
    expect(mockChatJson.mock.calls[0][0]).toContain('Vietnamese');
  });

  it('is repaired when the first answer cannot be drawn, with the problem told to the AI', async () => {
    mockChatJson.mockResolvedValueOnce({ title: 'Thiếu nhánh', topics: [] }).mockResolvedValueOnce(GOOD_MAP);
    const result = await makeNoteMap(ENGLISH, 'a travel expert');
    expect(result.map?.title).toBe('Nền tảng tour');
    expect(mockChatJson).toHaveBeenCalledTimes(2);
    const [system, user] = mockChatJson.mock.calls[1];
    expect(system).toContain('"topics" is missing or empty');
    expect(user).toContain('Thiếu nhánh');
    expect(user).toContain(ENGLISH);
  });

  it('is repaired at most twice, and then shown as text made from what the AI wrote', async () => {
    const bad = { title: 'Sơ đồ hỏng', topics: [{ note: 'không có nhãn', title: 'Một ý' }] };
    mockChatJson.mockResolvedValue(bad);
    const result = await makeNoteMap(ENGLISH, 'a travel expert');
    expect(mockChatJson).toHaveBeenCalledTimes(1 + MAP_REPAIRS);
    expect(MAP_REPAIRS).toBe(2);
    expect(result.map).toBeUndefined();
    expect(result.text).toContain('Sơ đồ hỏng');
    expect(result.text).toContain('Một ý');
  });

  it('counts an answer without any JSON as a failed try, and falls back to the note’s own words when nothing was usable', async () => {
    mockChatJson.mockRejectedValue(new AiError('Wispra Cloud answered in an unexpected form. Try again.', true, true));
    const result = await makeNoteMap(ENGLISH, 'a travel expert');
    expect(mockChatJson).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ text: ENGLISH });
  });

  it('does not take a lost connection, a used-up allowance or an expired sign-in for a bad map', async () => {
    mockChatJson.mockRejectedValueOnce(new AiError('No connection to Wispra Cloud. Try again later.', true));
    await expect(makeNoteMap(ENGLISH, 'r')).rejects.toThrow(/No connection/);
    expect(mockChatJson).toHaveBeenCalledTimes(1);
    mockChatJson.mockRejectedValueOnce(new AiError('This month’s Wispra Cloud AI allowance is used up.', false));
    await expect(makeNoteMap(ENGLISH, 'r')).rejects.toThrow(/allowance/);
  });

  it('stops at the first repair that works (the meter sees every call)', async () => {
    const meter = newMeter();
    const ask = jest.fn(async (_s: string, _u: string, _m: number, _t?: number, m?: { tokens: number; calls: number }) => {
      if (m) {
        m.calls += 1;
        m.tokens += 500;
      }
      return ask.mock.calls.length === 1 ? { title: 'x' } : GOOD_MAP;
    });
    const result = await makeNoteMap(ENGLISH, 'r', meter, ask as never);
    expect(result.map).toBeDefined();
    expect(meter).toEqual({ tokens: 1000, calls: 2 });
  });
});

describe('what an AI call costs the account', () => {
  it('is Groq’s total, or prompt plus completion (as wispra-web bills it)', () => {
    expect(billedTokens({ total_tokens: 1234, prompt_tokens: 1, completion_tokens: 1 })).toBe(1234);
    expect(billedTokens({ prompt_tokens: 700, completion_tokens: 300 })).toBe(1000);
    expect(billedTokens(undefined)).toBe(0);
    expect(billedTokens({ total_tokens: 'x' })).toBe(0);
  });
});
