import { Directory, File, Paths } from 'expo-file-system';

import { parseEntries, serializeEntries, type Entry } from './entries';

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

export function deleteAudio(uri: string | null): void {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function audioExists(uri: string | null): boolean {
  return !!uri && new File(uri).exists;
}
