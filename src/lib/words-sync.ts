// The sync run for the phone's two word lists (T-0193): who may sync, the calls to GET and PUT /api/lexicon,
// what is saved afterwards and what is told to the person. The merge itself is lexicon-sync.ts. The network
// and the phone's files are given in (`WordsDeps`), so a whole run is tested against a stand-in server.

import { parseCloudLists, syncLists, type CloudIo, type CloudLists, type SyncSnapshot } from './lexicon-sync';
import { sameLexicon, sameVocabulary } from './lexicon-sync';
import type { LexiconEntry } from './lexicon';

export class CloudHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface WordsDeps {
  // The signed-in account when Wispra Cloud may be used for this phone's data (see entries-store cloudAllowed), else null
  account(): { userId: string } | null;
  token(): Promise<string | null>;
  // GET and PUT of /api/lexicon: the status and the parsed JSON body
  request(method: 'GET' | 'PUT', token: string, body?: unknown): Promise<{ status: number; json: unknown }>;
  loadLocal(): CloudLists;
  saveVocabulary(terms: string[]): void;
  saveLexicon(entries: LexiconEntry[]): void;
  loadSnapshot(): SyncSnapshot | null;
  saveSnapshot(snapshot: SyncSnapshot): void;
  now(): string;
  note(text: string): void;
}

export type WordsResult =
  | { ok: true; vocabulary: number; lexicon: number; wrote: { vocabulary: boolean; lexicon: boolean }; changedHere: boolean; skipped?: string; raced: boolean }
  | { ok: false; reason: 'not-allowed' | 'signed-out' | 'offline' | 'error'; message: string };

// What goes on the wire for a learned word (docs/LEXICON_API.md)
export function entryToWire(e: LexiconEntry) {
  return {
    id: e.id,
    term: e.term,
    heardAs: e.heardAs,
    count: e.count,
    enabled: e.enabled,
    pinned: e.pinned,
    source: e.source,
    createdAt: e.createdAt,
    lastSeen: e.lastSeen,
  };
}

function ioFor(deps: WordsDeps, token: string): CloudIo {
  const call = async (method: 'GET' | 'PUT', body?: unknown) => {
    const answer = await deps.request(method, token, body);
    if (answer.status < 200 || answer.status >= 300) {
      const detail = (answer.json as { error?: unknown } | null)?.error;
      throw new CloudHttpError(typeof detail === 'string' ? detail : `HTTP ${answer.status}`, answer.status);
    }
    return answer.json;
  };
  return {
    async get(): Promise<CloudLists> {
      const lists = parseCloudLists(await call('GET'));
      if (!lists) throw new CloudHttpError('Wispra Cloud sent the word lists in a form that could not be read', 502);
      return lists;
    },
    async putVocabulary(terms) {
      await call('PUT', { vocabulary: terms });
    },
    async putLexicon(entries) {
      await call('PUT', { lexicon: entries.map(entryToWire) });
    },
  };
}

// One run. Never throws: the person's lists are theirs on the phone whatever the network does.
export async function runWordsSync(deps: WordsDeps): Promise<WordsResult> {
  const account = deps.account();
  if (!account) return { ok: false, reason: 'not-allowed', message: 'Sign in to Wispra Cloud, and answer the question about your accounts, to share your words.' };
  try {
    const token = await deps.token();
    if (!token) return { ok: false, reason: 'signed-out', message: 'Sign in to Wispra Cloud in Account to share your words.' };
    const local = deps.loadLocal();
    const outcome = await syncLists({ userId: account.userId, local, snapshot: deps.loadSnapshot(), now: deps.now(), io: ioFor(deps, token) });

    // The person may have changed a list while the network was busy: their change is not overwritten, and the
    // next run (called for by that change) merges it
    const nowLocal = deps.loadLocal();
    const raced = !sameVocabulary(nowLocal.vocabulary, local.vocabulary) || !sameLexicon(nowLocal.lexicon, local.lexicon);
    if (!raced) {
      if (outcome.changedHere.vocabulary) deps.saveVocabulary(outcome.vocabulary);
      if (outcome.changedHere.lexicon) deps.saveLexicon(outcome.lexicon);
    }
    // Not when the lists changed meanwhile: what the cloud brought was not saved here, and a snapshot that says it
    // was would read as "deleted here" at the next run
    if (!raced) deps.saveSnapshot(outcome.snapshot);
    const changedHere = !raced && (outcome.changedHere.vocabulary || outcome.changedHere.lexicon);
    deps.note(
      `words sync: ${outcome.vocabulary.length} vocabulary terms, ${outcome.lexicon.length} learned words` +
        `${outcome.wrote.vocabulary || outcome.wrote.lexicon ? ', sent to the cloud' : ''}${changedHere ? ', brought in from the cloud' : ''}` +
        `${outcome.skipped ? `, the cloud cannot take the ${outcome.skipped} yet` : ''}${raced ? ', changed meanwhile: run again' : ''}`,
    );
    return {
      ok: true,
      vocabulary: outcome.vocabulary.length,
      lexicon: outcome.lexicon.length,
      wrote: outcome.wrote,
      changedHere,
      raced,
      ...(outcome.skipped ? { skipped: outcome.skipped } : {}),
    };
  } catch (err) {
    if (err instanceof CloudHttpError) {
      if (err.status === 401) {
        deps.note('words sync: the sign-in was refused (401)');
        return { ok: false, reason: 'signed-out', message: 'Your Wispra Cloud sign-in has expired. Sign in again in Account.' };
      }
      deps.note(`words sync: failed (${err.status}: ${err.message})`);
      return { ok: false, reason: 'error', message: `Wispra Cloud could not share your words (${err.message}). They are kept on this phone.` };
    }
    // No connection, or the app was suspended mid-request: nothing was lost, the next run does it
    deps.note('words sync: no answer from Wispra Cloud (offline)');
    return { ok: false, reason: 'offline', message: 'No connection to Wispra Cloud. Your words are kept on this phone and shared later.' };
  }
}
