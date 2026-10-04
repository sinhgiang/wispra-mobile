import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { recoverInterrupted, type Entry } from './entries';
import { deleteAudio, loadEntries, saveEntries } from './storage';
import { transcribe } from './transcriber';

interface EntriesApi {
  entries: Entry[];
  loaded: boolean;
  get(id: string): Entry | undefined;
  add(entry: Entry): void;
  update(id: string, change: Partial<Entry>): void;
  // Removes the entry and its audio file
  remove(id: string): void;
  retry(id: string): Promise<void>;
}

const EntriesContext = createContext<EntriesApi | null>(null);

export function EntriesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The latest list, for saving and for callbacks that must not go stale
  const current = useRef<Entry[]>([]);

  const commit = useCallback((next: Entry[]) => {
    current.current = next;
    setEntries(next);
    try {
      saveEntries(next);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let list: Entry[] = [];
    try {
      list = recoverInterrupted(loadEntries());
    } catch (err) {
      Alert.alert('Could not read your recordings', err instanceof Error ? err.message : String(err));
    }
    current.current = list;
    setEntries(list);
    setLoaded(true);
  }, []);

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

  const retry = useCallback(
    async (id: string) => {
      const entry = current.current.find((e) => e.id === id);
      if (!entry) return;
      const result = await transcribe(entry);
      if (result.ok) update(id, { status: 'done', text: result.text, error: null });
      else update(id, { status: 'failed', error: result.error });
    },
    [update],
  );

  const api = useMemo(() => ({ entries, loaded, get, add, update, remove, retry }), [entries, loaded, get, add, update, remove, retry]);
  return <EntriesContext.Provider value={api}>{children}</EntriesContext.Provider>;
}

export function useEntries(): EntriesApi {
  const api = useContext(EntriesContext);
  if (!api) throw new Error('useEntries must be used inside EntriesProvider');
  return api;
}
