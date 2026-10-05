// The app's store without React, for tests: entries in memory, pending-deletes.json as text, the
// owner of the phone's data (account.json), and the deleted audio files. It plays both
// DeleteSyncStore (delete-sync.ts) and ChoiceDeps (account-switch.ts), wired the way entries-store
// wires them.

import type { ChoiceDeps, DataOwner, Owner, SignedIn } from '../account-switch';
import type { DeleteSyncStore } from '../delete-sync';
import { commitWithRollback } from '../cloud-gate';
import type { Entry } from '../entries';
import { EMPTY_BOOK, parseDeletionBook, serializeDeletionBook, stateOf, withState, type DeletionBook, type PendingDeletes } from '../history-delete';
import { fakeAuth } from './fake-cloud';

export class FakeStore implements DeleteSyncStore, ChoiceDeps {
  list: Entry[] = [];
  file: string | null = null;
  book: DeletionBook = EMPTY_BOOK;
  dataOwner: Owner = null;
  // The next saves of the list fail (a full disk)
  failSaves = false;
  deletedAudio: string[] = [];
  // What happened, in order
  log: string[] = [];

  userId(): string | null {
    return fakeAuth.user;
  }
  pending(): PendingDeletes {
    return stateOf(this.book, fakeAuth.user);
  }
  setPending(next: PendingDeletes): void {
    this.book = withState(this.book, next);
    this.file = serializeDeletionBook(this.book);
  }
  entries(): Entry[] {
    return this.list;
  }
  removeLocal(gone: Entry[]): void {
    const ids = new Set(gone.map((e) => e.id));
    this.list = this.list.filter((e) => !ids.has(e.id));
  }
  // What entries-store does when Wispra starts: read the file as it is
  restart(): void {
    this.book = parseDeletionBook(this.file);
  }

  // ChoiceDeps
  session(): SignedIn | null {
    return fakeAuth.user ? { userId: fakeAuth.user, email: `${fakeAuth.user}@example.com` } : null;
  }
  owner(): Owner {
    return this.dataOwner;
  }
  // The same helper entries-store uses: the list changes at once, and goes back when the save fails
  saveEntries(list: Entry[]): boolean {
    return commitWithRollback(
      { get: () => this.list, set: (l) => (this.list = l) },
      () => {
        this.log.push(this.failSaves ? 'save failed' : 'saved');
        return !this.failSaves;
      },
      list,
    );
  }
  deleteAudio(uri: string): void {
    this.deletedAudio.push(uri);
    this.log.push(`deleted ${uri}`);
  }
  saveOwner(owner: DataOwner): void {
    this.dataOwner = owner;
    this.log.push(`owner ${owner.userId}`);
  }
  resetReadCursor(userId: string): void {
    this.setPending({ ...stateOf(this.book, userId), since: null });
  }
}
