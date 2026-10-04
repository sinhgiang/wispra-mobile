import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { AiError } from './ai';
import { subscribe as onSignInChange } from './cloud-auth';
import { File } from 'expo-file-system';

import { defaultMeetingTitle, meetingLines, newId, recoverInterrupted, type Entry } from './entries';
import {
  meetingStatus,
  needsSplit,
  piecesToSegments,
  plainText,
  segmentsWaiting,
  SPLIT_PIECE_MS,
  type MeetingNotes,
  type MeetingSegment,
} from './meeting';
import { canSplitAudio, splitAudio } from '@/modules/wispra-dictation';
import { askMeeting, makeMindMap, makeOutline, makePost } from './meeting-ai';
import { CloudUnavailable, deleteAllHistory, deleteHistoryEntry, mergeHistory, readHistory } from './cloud-history';
import {
  applyRemoteDeletes,
  clearedBefore,
  clearSent,
  deletableEntries,
  hasPendingDeletes,
  NO_PENDING_DELETES,
  pendingDeleteCount,
  queueDelete,
  queueDeleteAll,
  type PendingDeletes,
} from './history-delete';
import { batches, planSync, toHistoryEntry } from './history-sync';
import {
  clearInbox,
  deleteAudio,
  loadEntries,
  loadHidden,
  loadPendingDeletes,
  readInbox,
  removeEmptyLeftovers,
  saveEntries,
  saveHidden,
  savePendingDeletes,
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
  removeAll(): void;
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
  makePostFor(id: string): Promise<void>;
  ask(id: string, question: string): Promise<void>;
}

export interface SyncState {
  at: string | null;
  note: string | null;
  waitingDeletes: number;
}

const EntriesContext = createContext<EntriesApi | null>(null);

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
  // Deletions not yet confirmed by Wispra Cloud (see history-delete.ts)
  const pendingDeletes = useRef<PendingDeletes>(NO_PENDING_DELETES);
  // When the history was last shared with Wispra Cloud, and why it was not, if it was not
  const [syncState, setSyncState] = useState<SyncState>({ at: null, note: null, waitingDeletes: 0 });

  const setPendingDeletes = useCallback((next: PendingDeletes) => {
    pendingDeletes.current = next;
    try {
      savePendingDeletes(next);
    } catch {
      // Kept in memory; tried again at the next change
    }
    setSyncState((prev) => ({ ...prev, waitingDeletes: pendingDeleteCount(next) }));
  }, []);

  // Returns whether the list reached the disk
  const commit = useCallback((next: Entry[]): boolean => {
    current.current = next;
    setEntries(next);
    if (readFailed.current) return false;
    try {
      saveEntries(next);
      return true;
    } catch (err) {
      Alert.alert('Could not save', errorText(err));
      return false;
    }
  }, []);

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
      pendingDeletes.current = loadPendingDeletes();
    } catch {
      pendingDeletes.current = NO_PENDING_DELETES;
    }
    setSyncState((prev) => ({ ...prev, waitingDeletes: pendingDeleteCount(pendingDeletes.current) }));
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

  const remove = useCallback(
    (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      forget([entry]);
      // Signed in: deleted on every device of the account (sent now, or later if offline)
      if (transcriptionAvailable()) setPendingDeletes(queueDelete(pendingDeletes.current, [entry]));
      commit(current.current.filter((e) => e.id !== id));
      void syncRef.current?.();
    },
    [commit, forget, setPendingDeletes],
  );

  const removeAll = useCallback(() => {
    const gone = deletableEntries(current.current);
    const goneIds = new Set(gone.map((e) => e.id));
    forget(gone);
    if (transcriptionAvailable()) setPendingDeletes(queueDeleteAll(pendingDeletes.current));
    commit(current.current.filter((e) => !goneIds.has(e.id)));
    void syncRef.current?.();
  }, [commit, forget, setPendingDeletes]);

  // Shares the phone's dictations with Wispra on the computer, and brings the computer's in.
  // Quietly does nothing when signed out, offline, or while Wispra Cloud has no shared history yet.
  const syncHistory = useCallback(async () => {
    if (readFailed.current || !transcriptionAvailable()) return;
    if (syncing.current) {
      // A deletion made during a sync is sent right after it
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    syncAgain.current = false;
    try {
      // 1. What this phone deleted goes first, so it cannot come back with the history read next
      const waiting = pendingDeletes.current;
      if (hasPendingDeletes(waiting)) {
        try {
          if (waiting.all) {
            const clearedAt = await deleteAllHistory();
            // This phone already deleted everything it had: the clear is not applied again
            setPendingDeletes({
              ...clearSent(pendingDeletes.current, { ...NO_PENDING_DELETES, all: true }),
              clearedHandled: clearedAt ?? pendingDeletes.current.clearedHandled,
            });
          }
          // One request per entry; each is cleared as soon as Wispra Cloud confirms it
          for (const id of waiting.ids) {
            await deleteHistoryEntry(id);
            setPendingDeletes(clearSent(pendingDeletes.current, { ...NO_PENDING_DELETES, ids: [id] }));
          }
        } catch (err) {
          // Until a delete-all reaches Wispra Cloud, nothing is read or shared: the history read now
          // would bring back what the user deleted
          if (pendingDeletes.current.all) throw err;
        }
      }

      // 2. What other devices deleted leaves this phone: the ids in `deleted`, and after a new
      // "delete everything" also the phone's dictations that never reached Wispra Cloud
      const page = await readHistory(pendingDeletes.current.since);
      const arrivedAt = new Date();
      let { keep, removed } = applyRemoteDeletes(current.current, page.deleted);
      const newClear = page.clearedAt && page.clearedAt !== pendingDeletes.current.clearedHandled ? page.clearedAt : null;
      if (newClear && page.serverTime) {
        const old = new Set(clearedBefore(keep, newClear, page.serverTime, arrivedAt).map((e) => e.id));
        removed = [...removed, ...keep.filter((e) => old.has(e.id))];
        keep = keep.filter((e) => !old.has(e.id));
      }
      if (removed.length > 0) {
        forget(removed);
        commit(keep);
      }
      // `since` moves on only after a good answer, so no deletion is missed
      setPendingDeletes({
        ...pendingDeletes.current,
        since: page.serverTime ?? pendingDeletes.current.since,
        clearedHandled: newClear ?? pendingDeletes.current.clearedHandled,
      });

      // 3. New dictations both ways; deleted ones are never brought back
      const skip = new Set([...hidden.current, ...pendingDeletes.current.ids, ...page.deleted]);
      const plan = planSync(current.current, page.entries, skip, page.complete);
      if (plan.upserts.length > 0) {
        const incoming = new Map(plan.upserts.map((e) => [e.id, e]));
        const kept = current.current.map((e) => incoming.get(e.id) ?? e);
        const known = new Set(kept.map((e) => e.id));
        commit([...kept, ...plan.upserts.filter((e) => !known.has(e.id))]);
      }
      for (const batch of batches(plan.push)) {
        await mergeHistory(batch.map(toHistoryEntry));
        const ids = new Set(batch.map((e) => e.id));
        const at = new Date().toISOString();
        commit(current.current.map((e) => (ids.has(e.id) ? { ...e, syncedAt: at } : e)));
      }
      setSyncState((prev) => ({ ...prev, at: new Date().toISOString(), note: null }));
    } catch (err) {
      setSyncState((prev) => ({ ...prev, note: err instanceof CloudUnavailable ? err.message : errorText(err) }));
    } finally {
      syncing.current = false;
    }
    if (syncAgain.current) void syncRef.current?.();
  }, [commit, forget, setPendingDeletes]);
  syncRef.current = syncHistory;

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // A meeting whose pieces are done: its text, and whether everything could be transcribed
  const finishMeeting = useCallback(
    (e: Entry) => {
      const segments = e.segments ?? [];
      const status = meetingStatus(segments);
      update(e.id, {
        status,
        text: plainText(segments) || null,
        error: status === 'failed' ? 'Some parts could not be transcribed. Their audio is kept; tap Try again.' : null,
      });
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

  // The next thing waiting: a piece of a meeting (also while it is still being recorded), a
  // recording in one piece, or a meeting to finish or write notes for. Oldest first.
  const runNextJob = useCallback(async (): Promise<boolean> => {
    const list = [...current.current].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const e of list) {
      if (readyToFinish(e)) {
        finishMeeting(e);
        return true;
      }
      const piece = segmentsWaiting(e.segments)[0];
      if (piece && (e.status === 'pending' || e.status === 'recording')) {
        if (needsSplit(piece) && canSplitAudio) {
          await splitLongPiece(e.id, piece.id);
          return true;
        }
        mark(e.id, true);
        try {
          const result = await transcribeAudio(piece.uri, piece.durationMs);
          if (result.ok) updateSegment(e.id, piece.id, { status: 'done', text: result.text, error: null });
          else if (result.transient) return false;
          // A piece with nothing said in it is simply empty, not a failure
          else if (result.error.startsWith('No speech')) updateSegment(e.id, piece.id, { status: 'done', text: '', error: null });
          else updateSegment(e.id, piece.id, { status: 'failed', error: result.error });
        } finally {
          mark(e.id, false);
        }
        return true;
      }
      if (!e.segments && e.status === 'pending') {
        if (await splitLargeRecording(e)) return true;
        mark(e.id, true);
        try {
          const result = await transcribe(e);
          if (!current.current.some((x) => x.id === e.id)) return true;
          if (result.ok) update(e.id, { status: 'done', text: result.text, error: null });
          else if (result.transient) {
            update(e.id, { error: result.error });
            return false;
          } else update(e.id, { status: 'failed', error: result.error });
        } finally {
          mark(e.id, false);
        }
        return true;
      }
      if (wantsNotes(e)) {
        try {
          await makeNotes(e.id);
        } catch {
          return false;
        }
        return true;
      }
    }
    return false;
  }, [finishMeeting, makeNotes, mark, splitLargeRecording, splitLongPiece, update, updateSegment]);

  // Works through everything waiting, one job at a time, when signed in to Wispra Cloud. A new
  // piece added meanwhile is picked up, because each turn looks at the list again.
  const transcribeWaiting = useCallback(async () => {
    if (running.current || !transcriptionAvailable()) return;
    running.current = true;
    try {
      while (transcriptionAvailable() && (await runNextJob())) {
        // next job
      }
    } finally {
      running.current = false;
    }
    // New text is shared with the computer, and the computer's new dictations come in
    await syncHistory();
  }, [runNextJob, syncHistory]);

  const retry = useCallback(
    async (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
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
        if (result.ok) update(id, { status: 'done', text: result.text, error: null });
        else update(id, { status: 'failed', error: result.error });
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
      mark(id, true);
      try {
        await work();
      } catch (err) {
        updateNotes(id, { error: errorText(err) });
      } finally {
        mark(id, false);
      }
    },
    [mark, updateNotes],
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

  const makePostFor = useCallback(
    (id: string) =>
      userNotes(id, async () => {
        const entry = current.current.find((e) => e.id === id);
        if (!entry) return;
        updateNotes(id, { error: undefined });
        updateNotes(id, { post: await makePost(meetingLines(entry), entry.notes?.summary) });
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

  useEffect(() => {
    if (!loaded) return;
    void transcribeWaiting();
    const unsubscribe = onSignInChange((session) => {
      if (session) void transcribeWaiting();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void transcribeWaiting();
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [loaded, transcribeWaiting]);

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
      retry,
      busy,
      transcribeWaiting,
      syncState,
      makeNotes: makeNotesByUser,
      makeMindMapFor,
      makePostFor,
      ask,
    }),
    [entries, loaded, get, add, update, addSegment, updateSegment, updateNotes, splitLongPiece, remove, removeAll, retry, busy, transcribeWaiting, syncState, makeNotesByUser, makeMindMapFor, makePostFor, ask],
  );
  return <EntriesContext.Provider value={api}>{children}</EntriesContext.Provider>;
}

export function useEntries(): EntriesApi {
  const api = useContext(EntriesContext);
  if (!api) throw new Error('useEntries must be used inside EntriesProvider');
  return api;
}
