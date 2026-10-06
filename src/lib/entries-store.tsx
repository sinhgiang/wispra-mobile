import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { AiError } from './ai';
import {
  applyAccountChoice,
  choiceView,
  ownerAfterSignIn,
  syncAllowed,
  ownerAtStart,
  type AccountChoice,
  type AccountChoiceView,
  type ChoiceResult,
  type DataOwner,
  type Owner,
} from './account-switch';
import { currentSession, subscribe as onSignInChange } from './cloud-auth';
import { commitWithRollback } from './cloud-gate';
import { nextJob, pieceUpdate, runQueue, TRANSCRIBE_CONCURRENCY, type Job, type JobOutcome } from './transcribe-queue';
import { File } from 'expo-file-system';

import { defaultMeetingTitle, fixText, meetingLines, newId, recoverInterrupted, type Entry } from './entries';
import { learnFromFix, type WordPair } from './lexicon';
import { recordDictation, recordFix, refreshAutoTerms } from './learned/learned';
import { AUTO_REFRESH_DELAY_MS } from './learned/constants';
import {
  finishedMeeting,
  needsSplit,
  piecesToSegments,
  segmentsWaiting,
  SPLIT_PIECE_MS,
  type MeetingNotes,
  type MeetingSegment,
} from './meeting';
import { canSplitAudio, splitAudio } from '@/modules/wispra-dictation';
import { askMeeting, makeMindMap, makeOutline } from './meeting-ai';
import { makeContent, type ContentPlatform } from './meeting-content';
import { AccountChanged, CloudUnavailable, deleteAllHistory, deleteHistoryEntry, mergeHistory, readHistory } from './cloud-history';
import { deleteEverything, queueDeletion, syncDeletes, type DeleteSyncCloud, type DeleteSyncStore } from './delete-sync';
import { EMPTY_BOOK, stateOf, withState, type DeletionBook, type PendingDeletes } from './history-delete';
import { batches, planSync, toHistoryEntry } from './history-sync';
import {
  clearInbox,
  deleteAudio,
  loadEntries,
  loadHidden,
  loadVocabulary,
  loadLearned,
  loadLearning,
  loadLexicon,
  loadDataOwner,
  loadDeletionBook,
  readInbox,
  removeEmptyLeftovers,
  saveEntries,
  saveHidden,
  saveLearned,
  saveLexicon,
  saveDataOwner,
  saveDeletionBook,
} from './storage';
import { CLOUD_UPLOAD_MAX_BYTES, transcribe, transcribeAudio, transcriptionAvailable } from './transcriber';

interface EntriesApi {
  entries: Entry[];
  loaded: boolean;
  get(id: string): Entry | undefined;
  add(entry: Entry): void;
  update(id: string, change: Partial<Entry>): void;
  // Meeting pieces and notes are changed one at a time, so recording (which adds pieces) and
  // transcribing (which fills them in) never overwrite each other
  addSegment(entryId: string, segment: MeetingSegment): void;
  updateSegment(entryId: string, segmentId: string, change: Partial<MeetingSegment>): void;
  updateNotes(entryId: string, change: Partial<MeetingNotes>): void;
  // Cuts a piece that grew long into shorter ones (Android), so it can be transcribed
  splitLongPiece(entryId: string, segmentId: string): Promise<void>;
  // Removes the entry and its audio files. Signed in, a dictation is deleted on every device of the
  // account too (the screen warns first, see history-delete.ts).
  remove(id: string): void;
  // Removes every entry except one being recorded; signed in, the whole shared history too
  // Deletes exactly these entries (the ones the warning counted). Signed in, Wispra Cloud deletes
  // the whole history first; with no connection nothing is deleted and it throws. Returns how many
  // entries left the phone.
  // `asUser`: the account the warning spoke of (null: this phone only); if another is signed in
  // now, nothing is deleted.
  removeAll(shownIds: readonly string[], asUser: string | null): Promise<number>;
  // Saves the words a person fixed in a dictation and learns from them (T-0179); the first text is
  // kept. Says why when nothing is saved.
  fixEntry(id: string, text: string): FixResult;
  // Try again on a recording that could not be transcribed
  retry(id: string): Promise<void>;
  // Ids of the entries being transcribed or written up right now
  busy: ReadonlySet<string>;
  // Transcribes what is waiting, if signed in (called after a new recording or piece), then
  // shares the history with Wispra on the computer
  transcribeWaiting(): Promise<void>;
  // Last time the history was shared with Wispra Cloud, why not when it could not be, and how many
  // deletions still have to reach the other devices
  syncState: SyncState;
  // AI notes for a meeting: the summary and outline, the mind map, the post, a question
  makeNotes(id: string): Promise<void>;
  makeMindMapFor(id: string): Promise<void>;
  // A website article or three social posts, written on demand (T-0164)
  makeContentFor(id: string, platform: ContentPlatform): Promise<void>;
  ask(id: string, question: string): Promise<void>;
  // Signed in with another account than the one whose data is on this phone: what the user must
  // choose before anything is synced (null when there is nothing to choose)
  accountChoice: AccountChoiceView | null;
  // Wispra Cloud may be used for this phone's data now (signed in, no account choice waiting)
  cloudAllowed(): boolean;
  // Applies the choice to exactly the entries the question showed (shownIds); see ChoiceResult
  chooseAccount(choice: AccountChoice, shownIds: readonly string[]): ChoiceResult;
}

// learning: the "Learn my words" switch was on, so what the fix teaches was kept (T-0182)
export type FixResult = { ok: true; learned: WordPair[]; learning: boolean } | { ok: false; error: string };

export interface SyncState {
  at: string | null;
  note: string | null;
  waitingDeletes: number;
}

const EntriesContext = createContext<EntriesApi | null>(null);

// Wispra Cloud as delete-sync.ts sees it
const deleteCloud: DeleteSyncCloud = {
  deleteOne: deleteHistoryEntry,
  deleteAll: deleteAllHistory,
  read: (since, asUser) => readHistory(since, asUser),
};

// What a dictation records when its words arrive (T-0182): whether "Learn my words" was on, which the
// statistics compare; the count of its words. Never fails the transcription.
function dictated(entry: Entry, text: string): Pick<Entry, 'learning'> {
  if (entry.kind !== 'dictation') return {};
  try {
    const learning = loadLearning().learning;
    const state = loadLearned();
    const next = recordDictation(state, text.trim().split(/\s+/).filter(Boolean).length, learning);
    if (next !== state) saveLearned(next);
    return { learning };
  } catch {
    return {};
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A meeting whose pieces are all transcribed (or given up on) and which is no longer recording
function readyToFinish(e: Entry): boolean {
  return !!e.segments && e.status === 'pending' && !e.segments.some((s) => s.status === 'pending' || s.status === 'recording');
}

// A finished meeting that has no notes yet
function wantsNotes(e: Entry): boolean {
  return e.kind === 'meeting' && e.status === 'done' && e.notes?.summary === undefined && !e.notes?.error && meetingLines(e).length > 0;
}

export function EntriesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The latest list, for saving and for callbacks that must not go stale
  const current = useRef<Entry[]>([]);
  // When the saved list could not be read, nothing is written, so it is never replaced by an empty one
  const readFailed = useRef(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(false);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  // syncHistory, for callbacks defined before it (remove)
  const syncRef = useRef<(() => Promise<void>) | null>(null);
  // Computer dictations removed on this phone (see remove)
  const hidden = useRef<Set<string>>(new Set());
  // Each account's deletions not yet confirmed by Wispra Cloud (see history-delete.ts). Read as it is
  // at start; the account signed in is looked up at each use, never when the file is read.
  const deletionBook = useRef<DeletionBook>(EMPTY_BOOK);
  // The account the data on this phone belongs to (account.json, see account-switch.ts)
  const dataOwner = useRef<Owner>(null);
  const [accountChoice, setAccountChoice] = useState<AccountChoiceView | null>(null);
  const myDeletes = useCallback((): PendingDeletes => stateOf(deletionBook.current, currentSession()?.userId ?? null), []);
  // When the history was last shared with Wispra Cloud, and why it was not, if it was not
  const [syncState, setSyncState] = useState<SyncState>({ at: null, note: null, waitingDeletes: 0 });

  const setPendingDeletes = useCallback(
    (next: PendingDeletes) => {
      deletionBook.current = withState(deletionBook.current, next);
      try {
        saveDeletionBook(deletionBook.current);
      } catch {
        // Kept in memory; tried again at the next change
      }
      setSyncState((prev) => ({ ...prev, waitingDeletes: myDeletes().ids.length }));
    },
    [myDeletes],
  );

  // Returns whether the list reached the disk
  // Writes the list to the disk; false when it did not get there
  const persistList = useCallback((next: Entry[]): boolean => {
    if (readFailed.current) return false;
    try {
      saveEntries(next);
      return true;
    } catch (err) {
      Alert.alert('Could not save', errorText(err));
      return false;
    }
  }, []);

  const commit = useCallback(
    (next: Entry[]): boolean => {
      current.current = next;
      setEntries(next);
      return persistList(next);
    },
    [persistList],
  );

  // Like commit, but when the save fails the list in memory goes back to what it was (choices that
  // cannot be undone must not look done when they are not on the disk)
  const commitOrRollback = useCallback(
    (next: Entry[]): boolean =>
      commitWithRollback(
        {
          get: () => current.current,
          set: (list) => {
            current.current = list;
            setEntries(list);
          },
        },
        persistList,
        next,
      ),
    [persistList],
  );

  // Wispra Cloud may be used for this phone's data: signed in, and no account choice waiting.
  // Checked again before every job of a queue, since the account can change while it runs.
  const cloudAllowed = useCallback(() => transcriptionAvailable() && syncAllowed(dataOwner.current, currentSession()), []);

  // Brings in dictations made with the mic button over other apps (Android) while Wispra was closed
  const importInbox = useCallback(() => {
    try {
      const items = readInbox();
      if (items.length === 0) return;
      const known = new Set(current.current.map((e) => e.id));
      const fresh = items.map((i) => i.entry).filter((e) => !known.has(e.id));
      if (commit([...fresh, ...current.current])) clearInbox(items);
    } catch (err) {
      Alert.alert('Could not bring in a dictation', errorText(err));
    }
  }, [commit]);

  useEffect(() => {
    let list: Entry[] = [];
    try {
      list = recoverInterrupted(loadEntries());
    } catch (err) {
      readFailed.current = true;
      Alert.alert('Could not read your recordings', `${errorText(err)}. Nothing is changed on this phone until Wispra restarts.`);
    }
    try {
      hidden.current = loadHidden();
    } catch {
      hidden.current = new Set();
    }
    try {
      deletionBook.current = loadDeletionBook();
    } catch {
      deletionBook.current = EMPTY_BOOK;
    }
    try {
      if (readFailed.current) {
        // The entries could not be read: whose they are cannot be told either, so a sign-in asks
        dataOwner.current = 'unknown';
      } else {
        const { owner, markUnclaimed } = ownerAtStart(loadDataOwner(), list);
        dataOwner.current = owner;
        if (markUnclaimed) saveDataOwner('unclaimed');
      }
    } catch {
      dataOwner.current = 'unknown';
    }
    setSyncState((prev) => ({ ...prev, waitingDeletes: myDeletes().ids.length }));
    current.current = list;
    setEntries(list);
    setLoaded(true);
    if (!readFailed.current) {
      try {
        removeEmptyLeftovers(list);
      } catch {
        // Tidying up can wait for the next start
      }
    }
    importInbox();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') importInbox();
    });
    return () => sub.remove();
  }, [importInbox]);

  const get = useCallback((id: string) => current.current.find((e) => e.id === id), []);

  const add = useCallback((entry: Entry) => commit([entry, ...current.current.filter((e) => e.id !== entry.id)]), [commit]);

  const update = useCallback(
    (id: string, change: Partial<Entry>) => commit(current.current.map((e) => (e.id === id ? { ...e, ...change } : e))),
    [commit],
  );

  const addSegment = useCallback(
    (entryId: string, segment: MeetingSegment) =>
      commit(current.current.map((e) => (e.id === entryId ? { ...e, segments: [...(e.segments ?? []), segment] } : e))),
    [commit],
  );

  const updateSegment = useCallback(
    (entryId: string, segmentId: string, change: Partial<MeetingSegment>) =>
      commit(
        current.current.map((e) =>
          e.id === entryId ? { ...e, segments: (e.segments ?? []).map((s) => (s.id === segmentId ? { ...s, ...change } : s)) } : e,
        ),
      ),
    [commit],
  );

  const updateNotes = useCallback(
    (entryId: string, change: Partial<MeetingNotes>) =>
      commit(current.current.map((e) => (e.id === entryId ? { ...e, notes: { ...e.notes, ...change } } : e))),
    [commit],
  );

  // The original file is removed only once the pieces that replace it are saved
  const splitLongPiece = useCallback(
    async (entryId: string, segmentId: string) => {
      const segment = current.current.find((e) => e.id === entryId)?.segments?.find((s) => s.id === segmentId);
      if (!segment?.uri || !needsSplit(segment) || !canSplitAudio) return;
      let pieces: { uri: string; startMs: number; durationMs: number }[] = [];
      try {
        pieces = await splitAudio(segment.uri, SPLIT_PIECE_MS);
      } catch {
        pieces = [];
      }
      if (pieces.length < 2) {
        for (const p of pieces) if (p.uri !== segment.uri) deleteAudio(p.uri);
        updateSegment(entryId, segmentId, { splitTried: true });
        return;
      }
      const replacement = piecesToSegments(segment.startMs, pieces, newId);
      const saved = commit(
        current.current.map((e) =>
          e.id === entryId ? { ...e, segments: (e.segments ?? []).flatMap((s) => (s.id === segmentId ? replacement : [s])) } : e,
        ),
      );
      if (saved) deleteAudio(segment.uri);
    },
    [commit, updateSegment],
  );

  // A recording in one file that is too large for Wispra Cloud becomes a run of pieces (Android)
  const splitLargeRecording = useCallback(
    async (entry: Entry): Promise<boolean> => {
      if (!entry.audioUri || !canSplitAudio) return false;
      const file = new File(entry.audioUri);
      if (!file.exists || (file.size ?? 0) <= CLOUD_UPLOAD_MAX_BYTES) return false;
      let pieces: { uri: string; startMs: number; durationMs: number }[] = [];
      try {
        pieces = await splitAudio(entry.audioUri, SPLIT_PIECE_MS);
      } catch {
        return false;
      }
      if (pieces.length < 2) return false;
      const saved = commit(
        current.current.map((e) =>
          e.id === entry.id ? { ...e, audioUri: null, segments: piecesToSegments(0, pieces, newId) } : e,
        ),
      );
      if (saved) deleteAudio(entry.audioUri);
      return saved;
    },
    [commit],
  );

  // Deletes the audio of entries leaving the phone; a computer dictation is also remembered, so the
  // shared history does not bring it back while Wispra Cloud has not deleted it yet
  const forget = useCallback((gone: Entry[]) => {
    let hiddenChanged = false;
    for (const entry of gone) {
      for (const uri of [entry.audioUri, ...(entry.segments ?? []).map((s) => s.uri)]) {
        try {
          deleteAudio(uri);
        } catch {
          // The entry goes even if a file is already gone
        }
      }
      if (entry.source === 'computer') {
        hidden.current.add(entry.id);
        hiddenChanged = true;
      }
    }
    if (hiddenChanged) {
      try {
        saveHidden(hidden.current);
      } catch {
        // It may come back from the shared history; nothing is lost
      }
    }
  }, []);

  // The store as delete-sync.ts sees it: always the latest state, read again after every await
  const deleteStore = useMemo<DeleteSyncStore>(
    () => ({
      // Nobody, as far as deletions go, until the user chose what happens to another account's data
      userId: () => {
        const session = currentSession();
        return session && syncAllowed(dataOwner.current, session) ? session.userId : null;
      },
      pending: myDeletes,
      setPending: (next) => setPendingDeletes(next),
      entries: () => current.current,
      removeLocal: (gone) => {
        if (gone.length === 0) return;
        const ids = new Set(gone.map((e) => e.id));
        forget(gone);
        commit(current.current.filter((e) => !ids.has(e.id)));
      },
    }),
    [commit, forget, setPendingDeletes, myDeletes],
  );

  const fixEntry = useCallback(
    (id: string, text: string): FixResult => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return { ok: false, error: 'That entry no longer exists.' };
      if (!text.trim()) return { ok: false, error: 'The text cannot be empty.' };
      const fixed = fixText(entry, text);
      // The same words: saved as they are, nothing to learn
      const learningOn = loadLearning().learning;
      // The statistics count the fix whether or not learning is on
      if (fixed) {
        try {
          const state = loadLearned();
          const next = recordFix(state, {
            original: entry.originalText ?? fixed.before,
            before: fixed.before,
            after: fixed.entry.text ?? '',
            createdAt: entry.createdAt,
            learning: entry.learning,
          });
          if (next !== state) saveLearned(next);
        } catch {
          // The statistics are a rough guide; the fix itself goes on
        }
      }
      if (!fixed) return { ok: true, learned: [], learning: learningOn };
      commit(current.current.map((e) => (e.id === id ? fixed.entry : e)));
      // The fix is saved either way; with "Learn my words" off nothing is learned from it
      if (!learningOn) return { ok: true, learned: [], learning: false };
      const now = new Date().toISOString();
      const known = loadLexicon();
      const learning = learnFromFix(known, fixed.before, fixed.entry.text ?? '', now, newId);
      // Saved only when a correction changed the words (a wrong form put back is a change too)
      if (learning.entries !== known) {
        try {
          saveLexicon(learning.entries);
        } catch {
          return { ok: false, error: 'The text was saved, but what it teaches could not be.' };
        }
      }
      return { ok: true, learned: learning.learned, learning: true };
    },
    [commit],
  );

  // The words picked up from History are worked out a moment after History changes, so the next
  // transcription finds them ready (the computer does the same, in the background)
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      try {
        const settings = loadLearning();
        if (!settings.learning || !settings.autoLearn) return;
        const state = loadLearned();
        const next = refreshAutoTerms({
          entries: current.current,
          vocabulary: loadVocabulary(),
          lexicon: loadLexicon(),
          state,
          learning: settings.learning,
          autoLearn: settings.autoLearn,
        });
        if (next !== state) saveLearned(next);
      } catch {
        // Only a help for the speech recogniser
      }
    }, AUTO_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [entries, loaded]);

  const remove = useCallback(
    (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      // Signed in and in Wispra Cloud: deleted on every device of the account (sent now, or later
      // if offline). Never queued for another account.
      queueDeletion(deleteStore, entry);
      deleteStore.removeLocal([entry]);
      void syncRef.current?.();
    },
    [deleteStore],
  );

  const removeAll = useCallback(
    (shownIds: readonly string[], asUser: string | null) => deleteEverything(deleteStore, deleteCloud, shownIds, asUser),
    [deleteStore],
  );

  // Shares the phone's dictations with Wispra on the computer, and brings the computer's in.
  // Quietly does nothing when signed out, offline, or while Wispra Cloud has no shared history yet.
  const syncHistory = useCallback(async () => {
    if (readFailed.current || !transcriptionAvailable() || !syncAllowed(dataOwner.current, currentSession())) return;
    if (syncing.current) {
      // A deletion made during a sync is sent right after it
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    syncAgain.current = false;
    try {
      // 1-2. Deletions both ways (delete-sync.ts), then the history read with them
      const result = await syncDeletes(deleteStore, deleteCloud, () => new Date());
      if (!result) return;
      const { page } = result;
      const user = deleteStore.userId();
      if (!user) return;

      // 3. New dictations both ways; deleted ones are never brought back
      const skip = new Set([...hidden.current, ...myDeletes().ids, ...page.deleted]);
      const plan = planSync(current.current, page.entries, skip, page.complete);
      if (plan.upserts.length > 0) {
        const incoming = new Map(plan.upserts.map((e) => [e.id, e]));
        const kept = current.current.map((e) => incoming.get(e.id) ?? e);
        const known = new Set(kept.map((e) => e.id));
        commit([...kept, ...plan.upserts.filter((e) => !known.has(e.id))]);
      }
      for (const batch of batches(plan.push)) {
        await mergeHistory(batch.map(toHistoryEntry), user);
        const ids = new Set(batch.map((e) => e.id));
        const at = new Date().toISOString();
        commit(current.current.map((e) => (ids.has(e.id) ? { ...e, syncedAt: at } : e)));
      }
      setSyncState((prev) => ({ ...prev, at: new Date().toISOString(), note: null }));
    } catch (err) {
      // The account changed during the sync: the new account's own sync follows, nothing to say
      if (!(err instanceof AccountChanged)) {
        setSyncState((prev) => ({ ...prev, note: err instanceof CloudUnavailable ? err.message : errorText(err) }));
      }
    } finally {
      syncing.current = false;
    }
    if (syncAgain.current) void syncRef.current?.();
  }, [commit, deleteStore]);
  syncRef.current = syncHistory;

  // Counted: several pieces of one meeting are transcribed at once (T-0164), and the first one back
  // must not mark the meeting idle while the others are still on their way
  const busyCount = useRef(new Map<string, number>());
  const mark = useCallback((id: string, on: boolean) => {
    const count = Math.max(0, (busyCount.current.get(id) ?? 0) + (on ? 1 : -1));
    if (count > 0) busyCount.current.set(id, count);
    else busyCount.current.delete(id);
    setBusy((prev) => {
      if (prev.has(id) === count > 0) return prev;
      const next = new Set(prev);
      if (count > 0) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // A meeting whose pieces are done: its text, and whether everything could be transcribed
  const finishMeeting = useCallback(
    (e: Entry) => {
      update(e.id, finishedMeeting(e.segments ?? []));
    },
    [update],
  );

  const makeNotes = useCallback(
    async (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      const lines = meetingLines(entry);
      if (lines.length === 0) return;
      mark(id, true);
      updateNotes(id, { error: undefined });
      try {
        const outline = await makeOutline(lines);
        const latest = current.current.find((e) => e.id === id);
        if (!latest) return;
        // The AI title replaces the "Meeting 14:05" placeholder, never a title the user typed
        const placeholder = latest.title === defaultMeetingTitle(new Date(latest.createdAt)) || latest.title === 'Meeting';
        if (outline.title && placeholder) update(id, { title: outline.title });
        updateNotes(id, { summary: outline.summary ?? '', topics: outline.topics, actions: outline.actions, live: false });
      } catch (err) {
        if (err instanceof AiError && err.transient) throw err;
        updateNotes(id, { error: errorText(err) });
      } finally {
        mark(id, false);
      }
    },
    [mark, update, updateNotes],
  );

  // One job of the queue (transcribe-queue.ts picks the jobs and runs the loop): a piece of a
  // meeting (also while it is still being recorded), a recording in one piece, or a meeting to
  // finish or write notes for. A job that fails for a passing reason (no connection, server busy)
  // keeps its reason on the card and answers 'later', so the others still go.
  const runJob = useCallback(
    async (job: Job): Promise<JobOutcome> => {
      const e = job.entry;
      switch (job.kind) {
        case 'finish-meeting':
          finishMeeting(e);
          return 'done';
        case 'split-piece':
          await splitLongPiece(e.id, job.piece.id);
          return 'done';
        case 'transcribe-piece': {
          const piece = job.piece;
          mark(e.id, true);
          try {
            const update = pieceUpdate(await transcribeAudio(piece.uri, piece.durationMs));
            if (update.kind === 'done') updateSegment(e.id, piece.id, { status: 'done', text: update.text, error: null });
            else if (update.kind === 'later') {
              updateSegment(e.id, piece.id, { error: update.error });
              return 'later';
            } else updateSegment(e.id, piece.id, { status: 'failed', error: update.error });
          } finally {
            mark(e.id, false);
          }
          return 'done';
        }
        case 'transcribe-entry': {
          if (await splitLargeRecording(e)) return 'done';
          mark(e.id, true);
          try {
            const result = await transcribe(e);
            if (!current.current.some((x) => x.id === e.id)) return 'done';
            if (result.ok) update(e.id, { status: 'done', text: result.text, error: null, ...dictated(e, result.text) });
            else if (result.transient) {
              update(e.id, { error: result.error });
              return 'later';
            } else update(e.id, { status: 'failed', error: result.error });
          } finally {
            mark(e.id, false);
          }
          return 'done';
        }
        case 'notes':
          try {
            await makeNotes(e.id);
          } catch {
            return 'later';
          }
          return 'done';
      }
    },
    [finishMeeting, makeNotes, mark, splitLargeRecording, splitLongPiece, update, updateSegment],
  );

  // Works through everything waiting, one job at a time, when signed in to Wispra Cloud. A new
  // piece added meanwhile is picked up, because each turn looks at the list again.
  const transcribeWaiting = useCallback(async () => {
    // Until the user chose what happens to another account's data, nothing goes to Wispra Cloud
    if (running.current || !transcriptionAvailable() || !syncAllowed(dataOwner.current, currentSession())) return;
    running.current = true;
    try {
      // What failed for a passing reason is skipped until the next run (the next new recording, the
      // app coming back, a sign-in)
      await runQueue({
        allowed: cloudAllowed,
        pick: (skip) =>
          nextJob(current.current, skip, {
            readyToFinish,
            wantsNotes,
            needsSplit: (piece) => needsSplit(piece) && canSplitAudio,
          }),
        run: runJob,
        concurrency: TRANSCRIBE_CONCURRENCY,
      });
    } finally {
      running.current = false;
    }
    // New text is shared with the computer, and the computer's new dictations come in
    await syncHistory();
  }, [cloudAllowed, runJob, syncHistory]);

  const retry = useCallback(
    async (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      // Another account signed in and the user has not chosen yet: nothing goes to Wispra Cloud
      if (!syncAllowed(dataOwner.current, currentSession()) && transcriptionAvailable()) {
        update(id, { error: 'Choose how to use the account you signed in with first. The audio is kept on this phone.' });
        return;
      }
      if (entry.segments) {
        // Pieces that failed wait again; the meeting is finished again once they are done
        commit(
          current.current.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: e.status === 'recording' ? 'recording' : 'pending',
                  error: null,
                  segments: (e.segments ?? []).map((s) => (s.status === 'failed' ? { ...s, status: 'pending', error: null } : s)),
                }
              : e,
          ),
        );
        if (!transcriptionAvailable()) {
          update(id, { error: 'Sign in to Wispra Cloud in Account to transcribe. The audio is kept on this phone.' });
          return;
        }
        await transcribeWaiting();
        return;
      }
      mark(id, true);
      try {
        const result = await transcribe(entry);
        if (!current.current.some((e) => e.id === id)) return;
        if (result.ok) update(id, { status: 'done', text: result.text, error: null, ...dictated(entry, result.text) });
        // A passing failure waits in the queue, which tries it again by itself, as the card says
        else update(id, { status: result.transient ? 'pending' : 'failed', error: result.error });
      } finally {
        mark(id, false);
      }
      void transcribeWaiting();
    },
    [commit, mark, transcribeWaiting, update],
  );

  // Notes asked for by the user (Try again, Mind map, Post, Ask) show their error in place
  const userNotes = useCallback(
    async (id: string, work: () => Promise<void>) => {
      if (transcriptionAvailable() && !cloudAllowed()) {
        updateNotes(id, { error: 'Choose how to use the account you signed in with first.' });
        return;
      }
      mark(id, true);
      try {
        await work();
      } catch (err) {
        updateNotes(id, { error: errorText(err) });
      } finally {
        mark(id, false);
      }
    },
    [cloudAllowed, mark, updateNotes],
  );

  const makeNotesByUser = useCallback((id: string) => userNotes(id, () => makeNotes(id)), [makeNotes, userNotes]);

  const makeMindMapFor = useCallback(
    (id: string) =>
      userNotes(id, async () => {
        const entry = current.current.find((e) => e.id === id);
        if (!entry) return;
        updateNotes(id, { error: undefined });
        updateNotes(id, { mindMap: await makeMindMap(meetingLines(entry)) });
      }),
    [updateNotes, userNotes],
  );

  const makeContentFor = useCallback(
    (id: string, platform: ContentPlatform) =>
      userNotes(id, async () => {
        const entry = current.current.find((e) => e.id === id);
        if (!entry) return;
        updateNotes(id, { error: undefined });
        const made = await makeContent(meetingLines(entry), platform);
        // Read again after the wait: another platform may have been written meanwhile
        const latest = current.current.find((e) => e.id === id);
        updateNotes(id, { content: { ...(latest?.notes?.content ?? {}), [platform]: made } });
      }),
    [updateNotes, userNotes],
  );

  const ask = useCallback(
    (id: string, question: string) =>
      userNotes(id, async () => {
        const entry = current.current.find((e) => e.id === id);
        if (!entry) return;
        updateNotes(id, { error: undefined });
        const answer = await askMeeting(meetingLines(entry), entry.notes?.qa ?? [], question);
        const latest = current.current.find((e) => e.id === id);
        updateNotes(id, { qa: [...(latest?.notes?.qa ?? []), { question, answer, askedAt: new Date().toISOString() }] });
      }),
    [updateNotes, userNotes],
  );

  // account.json could not be written: tried again at the next check, so a later start does not
  // take the phone's data for unclaimed
  const ownerUnsaved = useRef(false);
  const saveOwner = useCallback((owner: DataOwner | null) => {
    dataOwner.current = owner;
    if (!owner) return;
    try {
      saveDataOwner(owner);
      ownerUnsaved.current = false;
    } catch {
      ownerUnsaved.current = true;
    }
  }, []);

  // After a sign-in: the first account, or the same one, needs nothing; another account waits for
  // the user's choice, and nothing is synced meanwhile
  const checkAccount = useCallback(() => {
    if (readFailed.current) return;
    const session = currentSession();
    const view = choiceView(dataOwner.current, session, current.current);
    if (view) {
      setAccountChoice(view);
      return;
    }
    setAccountChoice(null);
    const before = dataOwner.current;
    const next = ownerAfterSignIn(before, session);
    const changed = before === null || before === 'unknown' || (next !== null && next !== 'unknown' && (next.userId !== before.userId || next.email !== before.email));
    if (next && next !== 'unknown' && (changed || ownerUnsaved.current)) saveOwner(next);
  }, [saveOwner]);

  const chooseAccount = useCallback(
    (choice: AccountChoice, shownIds: readonly string[]): ChoiceResult => {
      if (readFailed.current) return 'save-failed';
      const result = applyAccountChoice(
        {
          session: currentSession,
          owner: () => dataOwner.current,
          entries: () => current.current,
          saveEntries: commitOrRollback,
          deleteAudio: (uri) => {
            try {
              deleteAudio(uri);
            } catch {
              // The entry is gone from the list either way
            }
          },
          saveOwner,
          resetReadCursor: (userId) => setPendingDeletes({ ...stateOf(deletionBook.current, userId), since: null }),
        },
        choice,
        shownIds,
      );
      if (result === 'done') {
        setAccountChoice(null);
        void transcribeWaiting();
      } else {
        // The question shows the entries as they are now (or goes away when nothing is to choose)
        checkAccount();
      }
      return result;
    },
    [checkAccount, commitOrRollback, saveOwner, setPendingDeletes, transcribeWaiting],
  );

  // While the question waits, it follows the entries (a dictation from the mic button, a recording
  // that ended), so the numbers it shows are always the ones a choice applies to
  useEffect(() => {
    if (accountChoice) checkAccount();
    // Only when the entries change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  useEffect(() => {
    if (!loaded) return;
    checkAccount();
    void transcribeWaiting();
    const unsubscribe = onSignInChange((session) => {
      // Each account keeps its own deletions: the count shown is the one of the account signed in now
      setSyncState((prev) => ({ ...prev, waitingDeletes: myDeletes().ids.length }));
      checkAccount();
      if (session) void transcribeWaiting();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void transcribeWaiting();
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [loaded, transcribeWaiting, myDeletes, checkAccount]);

  const api = useMemo(
    () => ({
      entries,
      loaded,
      get,
      add,
      update,
      addSegment,
      updateSegment,
      updateNotes,
      splitLongPiece,
      remove,
      removeAll,
      fixEntry,
      retry,
      busy,
      transcribeWaiting,
      syncState,
      makeNotes: makeNotesByUser,
      makeMindMapFor,
      makeContentFor,
      ask,
      accountChoice,
      chooseAccount,
      cloudAllowed,
    }),
    [entries, loaded, get, add, update, addSegment, updateSegment, updateNotes, splitLongPiece, remove, removeAll, fixEntry, retry, busy, transcribeWaiting, syncState, makeNotesByUser, makeMindMapFor, makeContentFor, ask, accountChoice, chooseAccount, cloudAllowed],
  );
  return <EntriesContext.Provider value={api}>{children}</EntriesContext.Provider>;
}

export function useEntries(): EntriesApi {
  const api = useContext(EntriesContext);
  if (!api) throw new Error('useEntries must be used inside EntriesProvider');
  return api;
}
