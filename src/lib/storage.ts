import { Directory, File, Paths } from 'expo-file-system';

import { entryFromInbox, parseEntries, parseInboxRecord, serializeEntries, type Entry } from './entries';
import { parseOwner, serializeOwner, type DataOwner } from './account-switch';
import { parseDeletionBook, serializeDeletionBook, type DeletionBook } from './history-delete';

// Everything lives in the app's document directory, which the system never clears on its own
// (unlike the cache directory).
const root = new Directory(Paths.document, 'wispra');
const audioDir = new Directory(root, 'audio');
const entriesFile = new File(root, 'entries.json');
const entriesTmp = new File(root, 'entries.json.tmp');

function ensureDirs(): void {
  if (!root.exists) root.create({ intermediates: true });
  if (!audioDir.exists) audioDir.create({ intermediates: true });
}

export function loadEntries(): Entry[] {
  ensureDirs();
  if (!entriesFile.exists) {
    // A save that was cut off before the rename leaves only the temporary file
    return entriesTmp.exists ? parseEntries(entriesTmp.textSync()) : [];
  }
  return parseEntries(entriesFile.textSync());
}

// Written to a temporary file first, so a crash during the write never leaves a half-written list
export function saveEntries(entries: Entry[]): void {
  ensureDirs();
  // A new File each time: moving a File changes the path it points to
  const tmp = new File(root, 'entries.json.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(serializeEntries(entries));
  // moveSync, not move: move() returns a promise, and the list must be on disk before we go on
  tmp.moveSync(new File(root, 'entries.json'), { overwrite: true });
}

// The recorder writes into the document directory already; this only moves a file that ended up
// anywhere else (for example the cache) into Wispra's own audio folder.
export function keepAudio(uri: string): string {
  ensureDirs();
  const file = new File(uri);
  if (!file.exists || file.uri.startsWith(audioDir.uri)) return file.uri;
  file.moveSync(audioDir);
  return file.uri;
}

// Ids of computer dictations the user removed on the phone, so the shared history does not bring
// them back. Only the phone forgets them; they stay on the computer and in Wispra Cloud.
export function loadHidden(): Set<string> {
  const file = new File(root, 'hidden.json');
  if (!file.exists) return new Set();
  try {
    const ids = JSON.parse(file.textSync()) as unknown;
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveHidden(ids: Set<string>): void {
  ensureDirs();
  const tmp = new File(root, 'hidden.json.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify([...ids]));
  tmp.moveSync(new File(root, 'hidden.json'), { overwrite: true });
}

// Deletions Wispra Cloud has not confirmed yet, and the time of the last list of deletions read
export function loadDeletionBook(): DeletionBook {
  const file = new File(root, 'pending-deletes.json');
  return parseDeletionBook(file.exists ? file.textSync() : null);
}

export function saveDeletionBook(book: DeletionBook): void {
  ensureDirs();
  const tmp = new File(root, 'pending-deletes.json.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(serializeDeletionBook(book));
  tmp.moveSync(new File(root, 'pending-deletes.json'), { overwrite: true });
}

// The account the data on this phone belongs to (see account-switch.ts)
export function loadDataOwner(): DataOwner | 'unclaimed' | null {
  const file = new File(root, 'account.json');
  return parseOwner(file.exists ? file.textSync() : null);
}

export function saveDataOwner(owner: DataOwner | 'unclaimed'): void {
  ensureDirs();
  const tmp = new File(root, 'account.json.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(serializeOwner(owner));
  tmp.moveSync(new File(root, 'account.json'), { overwrite: true });
}

// Whether the first-run guide was opened already (it opens by itself only once)
export function guideSeen(): boolean {
  return new File(root, 'guide-seen').exists;
}

export function markGuideSeen(): void {
  ensureDirs();
  const file = new File(root, 'guide-seen');
  if (!file.exists) file.create();
}

// Dictations made with the mic button over other apps wait here (written by the Android service)
const inboxDir = new Directory(root, 'inbox');

export interface InboxItem {
  entry: Entry;
  note: File;
}

// Reads every finished dictation in the inbox and moves its audio to the audio folder. The notes
// stay until clearInbox(), which is called only after the entries are saved, so a crash in between
// reads them again (the audio is then found in the audio folder).
export function readInbox(): InboxItem[] {
  if (!inboxDir.exists) return [];
  ensureDirs();
  const items: InboxItem[] = [];
  for (const note of inboxDir.list()) {
    if (!(note instanceof File) || !note.name.endsWith('.json')) continue;
    const record = parseInboxRecord(note.textSync());
    if (!record) continue;
    const waiting = new File(inboxDir, record.audioFileName);
    if (waiting.exists) waiting.moveSync(audioDir);
    const kept = new File(audioDir, record.audioFileName);
    items.push({ entry: entryFromInbox(record, kept.exists ? kept.uri : null), note });
  }
  return items;
}

export function clearInbox(items: InboxItem[]): void {
  for (const { note } of items) if (note.exists) note.delete();
}

// The recorder prepares a file before it knows whether it will record; one that never recorded
// stays empty. Those are removed when Wispra starts: only empty files that belong to no entry and
// are more than ten minutes old. A file with sound in it is never removed here.
const recorderDir = new Directory(Paths.document, 'Audio');
const LEFTOVER_AGE_MS = 10 * 60 * 1000;

export function removeEmptyLeftovers(entries: Entry[]): void {
  if (!recorderDir.exists) return;
  const used = new Set(entries.flatMap((e) => [e.audioUri, ...(e.segments ?? []).map((s) => s.uri)]).filter(Boolean));
  for (const item of recorderDir.list()) {
    if (!(item instanceof File) || used.has(item.uri)) continue;
    const modified = item.modificationTime ?? Date.now();
    if ((item.size ?? 1) === 0 && Date.now() - modified > LEFTOVER_AGE_MS) item.delete();
  }
}

export function deleteAudio(uri: string | null): void {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function audioExists(uri: string | null): boolean {
  return !!uri && new File(uri).exists;
}
