import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { subscribe as onSignInChange } from './cloud-auth';
import { recoverInterrupted, type Entry } from './entries';
import { clearInbox, deleteAudio, loadEntries, readInbox, saveEntries } from './storage';
import { transcribe, transcriptionAvailable } from './transcriber';

interface EntriesApi {
  entries: Entry[];
  loaded: boolean;
  get(id: string): Entry | undefined;
  add(entry: Entry): void;
  update(id: string, change: Partial<Entry>): void;
  // Removes the entry and its audio file
  remove(id: string): void;
  retry(id: string): Promise<void>;
  // Ids of the entries being transcribed right now
  busy: ReadonlySet<string>;
  // Transcribes what is waiting, if signed in (called after a new recording)
  transcribeWaiting(): Promise<void>;
}

const EntriesContext = createContext<EntriesApi | null>(null);

export function EntriesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The latest list, for saving and for callbacks that must not go stale
  const current = useRef<Entry[]>([]);
  // When the saved list could not be read, nothing is written, so it is never replaced by an empty one
  const readFailed = useRef(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(false);

  // Returns whether the list reached the disk
  const commit = useCallback((next: Entry[]): boolean => {
    current.current = next;
    setEntries(next);
    if (readFailed.current) return false;
    try {
      saveEntries(next);
      return true;
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
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
      Alert.alert('Could not bring in a dictation', err instanceof Error ? err.message : String(err));
    }
  }, [commit]);

  useEffect(() => {
    let list: Entry[] = [];
    try {
      list = recoverInterrupted(loadEntries());
    } catch (err) {
      readFailed.current = true;
      const reason = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not read your recordings', `${reason}. Nothing is changed on this phone until Wispra restarts.`);
    }
    current.current = list;
    setEntries(list);
    setLoaded(true);
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

  const remove = useCallback(
    (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      try {
        deleteAudio(entry?.audioUri ?? null);
      } catch {
        // The entry goes even if its file is already gone
      }
      commit(current.current.filter((e) => e.id !== id));
    },
    [commit],
  );

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // One recording at a time. A failure that is no fault of the recording (offline, signed out,
  // server busy) leaves it waiting, so it is tried again by itself later.
  const transcribeOne = useCallback(
    async (id: string, byUser: boolean) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      mark(id, true);
      try {
        const result = await transcribe(entry);
        if (!current.current.some((e) => e.id === id)) return;
        if (result.ok) update(id, { status: 'done', text: result.text, error: null });
        else if (result.transient && !byUser) update(id, { status: 'pending', error: result.error });
        else update(id, { status: 'failed', error: result.error });
      } finally {
        mark(id, false);
      }
    },
    [mark, update],
  );

  const retry = useCallback((id: string) => transcribeOne(id, true), [transcribeOne]);

  // Transcribes every recording that is waiting, oldest first, when signed in to Wispra Cloud
  const transcribeWaiting = useCallback(async () => {
    if (running.current || !transcriptionAvailable()) return;
    running.current = true;
    try {
      const waiting = current.current
        .filter((e) => e.status === 'pending')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((e) => e.id);
      for (const id of waiting) {
        if (!transcriptionAvailable()) break;
        await transcribeOne(id, false);
      }
    } finally {
      running.current = false;
    }
  }, [transcribeOne]);

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
    () => ({ entries, loaded, get, add, update, remove, retry, busy, transcribeWaiting }),
    [entries, loaded, get, add, update, remove, retry, busy, transcribeWaiting],
  );
  return <EntriesContext.Provider value={api}>{children}</EntriesContext.Provider>;
}

export function useEntries(): EntriesApi {
  const api = useContext(EntriesContext);
  if (!api) throw new Error('useEntries must be used inside EntriesProvider');
  return api;
}
