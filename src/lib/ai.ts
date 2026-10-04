import { validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import { extractJson } from './meeting';

// Wispra Cloud's AI (an OpenAI-style chat endpoint on wispra-web), the same one Wispra on the
// computer uses. Counts toward the account's monthly AI allowance.
const MODEL = 'openai/gpt-oss-120b';
const TIMEOUT_MS = 90_000;

export class AiError extends Error {
  constructor(
    message: string,
    // Nothing is wrong with the request: try again later (offline, busy, signed out)
    readonly transient: boolean,
  ) {
    super(message);
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function chat(messages: ChatMessage[], maxTokens: number, json: boolean): Promise<string> {
  const token = await validToken();
  if (!token) throw new AiError('Sign in to Wispra Cloud in Account to use AI notes.', true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cloud.apiBase}/api/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AiError('No connection to Wispra Cloud. Try again later.', true);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // No JSON body
    }
    if (response.status === 401) throw new AiError('Your Wispra Cloud sign-in has expired. Sign in again in Account.', false);
    if (response.status === 402) throw new AiError(detail || 'This month’s Wispra Cloud AI allowance is used up.', false);
    throw new AiError(detail ? `Wispra Cloud: ${detail}` : `AI request failed (HTTP ${response.status}).`, response.status === 429 || response.status >= 500);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new AiError('Wispra Cloud gave an empty answer. Try again.', true);
  return content;
}

export async function chatJson(system: string, user: string, maxTokens: number): Promise<unknown> {
  const answer = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    true,
  );
  const value = extractJson(answer);
  if (!value) throw new AiError('Wispra Cloud answered in an unexpected form. Try again.', true);
  return value;
}
