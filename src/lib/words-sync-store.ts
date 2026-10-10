// The sync of the word lists as the app runs it (T-0193): the real network and files for words-sync.ts, one
// run at a time, and what the screens show about it.
import { useSyncExternalStore } from 'react';

import { validToken } from './cloud-auth';
import { cloud } from './cloud-config';
import { loadLexicon, loadVocabulary, loadWordsSnapshot, saveLexicon, saveVocabulary, saveWordsSnapshot, wordsRevisionNow } from './storage';
import { runWordsSync, type WordsDeps, type WordsResult } from './words-sync';
import { noteKeyboardLog } from '@/modules/wispra-keyboard-bridge';

const TIMEOUT_MS = 30_000;

export interface WordsSyncStatus {
  // The last run that got through, when
  at: string | null;
  // What to tell the person, when the last run did not get through
  note: string | null;
  running: boolean;
}

let status: WordsSyncStatus = { at: null, note: null, running: false };
const listeners = new Set<() => void>();

function setStatus(next: WordsSyncStatus): void {
  status = next;
  for (const l of listeners) l();
}

export function wordsSyncStatus(): WordsSyncStatus {
  return status;
}

export function useWordsSyncStatus(): WordsSyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    wordsSyncStatus,
    wordsSyncStatus,
  );
}

async function request(method: 'GET' | 'PUT', token: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${cloud.apiBase}/api/lexicon`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export interface Account {
  // The signed-in account when Wispra Cloud may be used for this phone's data, else null
  (): { userId: string } | null;
}

function realDeps(account: Account): WordsDeps {
  return {
    account,
    token: validToken,
    request,
    loadLocal: () => ({ vocabulary: loadVocabulary(), lexicon: loadLexicon() }),
    revision: wordsRevisionNow,
    saveVocabulary: (terms) => saveVocabulary(terms, true),
    saveLexicon: (entries) => saveLexicon(entries, true),
    loadSnapshot: loadWordsSnapshot,
    saveSnapshot: saveWordsSnapshot,
    now: () => new Date().toISOString(),
    note: (text) => noteKeyboardLog(text),
  };
}

let running = false;
let again = false;

// Runs the sync, one at a time: a call while one runs asks for one more run after it. Never throws.
export async function syncWords(account: Account, deps: WordsDeps = realDeps(account)): Promise<WordsResult | null> {
  if (running) {
    again = true;
    return null;
  }
  running = true;
  setStatus({ ...status, running: true });
  let result: WordsResult | null = null;
  try {
    // Again at most twice more, when the lists changed during a run
    let runs = 0;
    do {
      again = false;
      result = await runWordsSync(deps);
      if (result.ok && result.raced) again = true;
      // A refusal or no connection is not repeated at once
      if (!result.ok) again = false;
    } while (again && ++runs < 3);
    setStatus(result.ok ? { at: new Date().toISOString(), note: null, running: false } : { ...status, note: result.message, running: false });
  } catch {
    setStatus({ ...status, running: false });
  } finally {
    running = false;
  }
  return result;
}

// After the person signs out or switches account the status starts again
export function resetWordsSyncStatus(): void {
  setStatus({ at: null, note: null, running: false });
}
