// The cost of an AI call, read from the answer of Wispra Cloud (T-0979): what a note's rewrite and a
// meeting's summary use of the account's monthly allowance is shown to the person, so it is measured
// from the "usage" the service reports for each call, not guessed.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AiError, chatJson, newMeter } from '../ai';

jest.mock('../cloud-auth', () => ({ validToken: async () => 'tok' }));
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://example.test' } }));

const answer = (content: string, usage?: object) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage }) }) as Response;

let fetchMock: jest.Mock<typeof fetch>;
beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the meter', () => {
  it('adds up the tokens Wispra Cloud reports for each call it is given', async () => {
    fetchMock
      .mockResolvedValueOnce(answer('{"a":1}', { prompt_tokens: 400, completion_tokens: 900, total_tokens: 1300 }))
      .mockResolvedValueOnce(answer('{"b":2}', { prompt_tokens: 100, completion_tokens: 50 }));
    const meter = newMeter();
    await chatJson('system', 'user', 100, 0.2, meter);
    await chatJson('system', 'user', 100, 0.2, meter);
    expect(meter).toEqual({ tokens: 1450, calls: 2 });
  });

  it('counts nothing when no meter is given, or the service does not say', async () => {
    fetchMock.mockResolvedValue(answer('{"a":1}'));
    const meter = newMeter();
    await chatJson('system', 'user', 100);
    await chatJson('system', 'user', 100, 0.2, meter);
    expect(meter).toEqual({ tokens: 0, calls: 1 });
  });

  it('sends the same request as before: the model, the limit, JSON mode, and the sign-in', async () => {
    fetchMock.mockResolvedValue(answer('{"a":1}'));
    await chatJson('sys', 'usr', 777, 0.3, newMeter());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/api/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ model: 'openai/gpt-oss-120b', max_tokens: 777, temperature: 0.3, response_format: { type: 'json_object' } });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('marks an answer without JSON so a caller can ask again, and does not mark other failures', async () => {
    fetchMock.mockResolvedValueOnce(answer('no json here'));
    await expect(chatJson('s', 'u', 10)).rejects.toMatchObject({ badForm: true, transient: true });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await chatJson('s', 'u', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).badForm).toBe(false);
  });
});
