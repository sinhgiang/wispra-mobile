// Signing in with another Wispra account than the one whose data is on this phone (the owner's
// choice, W-0218 / T-0142): before anything is shared, the user picks one of two plainly worded
// options, and until then nothing is synced.
//   Merge: keep what is on the phone and share it with the new account (it goes up to the new
//     account's Wispra Cloud).
//   Use only the new account: what is on the phone leaves it; the previous account's Wispra Cloud
//     is not touched, and signing back into it brings its shared history back.
// The first sign-in on a phone, or signing back into the same account, asks nothing. Pure functions.

import { newId, type Entry } from './entries';

// The account the data on this phone belongs to (account.json); null before any sign-in
export interface DataOwner {
  userId: string;
  email: string;
}

/**
 * Whose the data on this phone is:
 * - an account (account.json names it)
 * - 'unknown': there is data but no account.json (it was made by a version of Wispra that did not
 *   keep one), so any sign-in asks, like another account would (Chief's decision, T-0142)
 * - null: nobody yet (a fresh phone, or account.json says unclaimed): the first sign-in takes it
 */
export type Owner = DataOwner | 'unknown' | null;

export interface SignedIn {
  userId: string;
  email: string;
}

export type AccountChoice = 'merge' | 'new-only';

// Whether the user has to choose before anything is synced
export function needsChoice(owner: Owner, session: SignedIn | null): boolean {
  if (!session || !owner) return false;
  return owner === 'unknown' || owner.userId !== session.userId;
}

// Syncing with Wispra Cloud is allowed only for the account the phone's data belongs to
export function syncAllowed(owner: Owner, session: SignedIn | null): boolean {
  return !!session && !needsChoice(owner, session);
}

// After a sign-in that needs no choice: the first account becomes the owner; the same account
// keeps it (with its current email). Returns the owner unchanged while a choice is waiting.
export function ownerAfterSignIn(owner: Owner, session: SignedIn | null): Owner {
  if (!session || owner === 'unknown') return owner;
  if (!owner || owner.userId === session.userId) return { userId: session.userId, email: session.email };
  return owner;
}

export interface PhoneData {
  dictations: number;
  meetings: number;
  // Only on this phone: phone dictations never shared, and every meeting (meetings never go to
  // Wispra Cloud). Using only the new account deletes these for good.
  onlyHere: number;
}

// Entries a choice applies to: everything but a recording in progress
function settled(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.status !== 'recording');
}

export function phoneData(entries: Entry[]): PhoneData {
  const list = settled(entries);
  const meetings = list.filter((e) => e.kind === 'meeting').length;
  const onlyHere = list.filter((e) => e.kind === 'meeting' || (e.source !== 'computer' && !e.syncedAt)).length;
  return { dictations: list.length - meetings, meetings, onlyHere };
}

/**
 * Merge: the phone's entries now belong to the new account. Phone dictations are shared again
 * (their syncedAt was for the previous account). The previous account's computer dictations become
 * phone dictations with new ids, since Wispra Cloud only takes phone entries ("mobile-" ids) from the
 * phone. Meetings stay on the phone, as always.
 */
export function mergeIntoNewAccount(entries: Entry[], makeId: () => string = newId): Entry[] {
  return entries.map((e) => {
    if (e.kind !== 'dictation') return e;
    if (e.source === 'computer') return { ...e, id: makeId(), source: undefined, syncedAt: undefined };
    return { ...e, syncedAt: undefined };
  });
}

// Use only the new account: what leaves the phone (removed locally only, never deleted in Wispra
// Cloud), and what stays (a recording in progress)
export function leaveForNewAccount(entries: Entry[]): { keep: Entry[]; removed: Entry[] } {
  const keep = entries.filter((e) => e.status === 'recording');
  const removed = entries.filter((e) => e.status !== 'recording');
  return { keep, removed };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export interface ChoiceText {
  title: string;
  intro: string;
  merge: { label: string; detail: string };
  newOnly: { label: string; detail: string };
  // A way out for a sign-in with the wrong account; not a third choice about the data
  signOut: { label: string; detail: string };
}

export function choiceText(previous: DataOwner | 'unknown', next: SignedIn, data: PhoneData): ChoiceText {
  const prev = previous === 'unknown' ? 'an earlier account' : previous.email || 'the previous account';
  const from =
    previous === 'unknown' ? 'from an earlier account (this phone did not keep which one)' : `from ${previous.email || 'the previous account'}`;
  const what = `${plural(data.dictations, 'dictation')} and ${plural(data.meetings, 'meeting')}`;
  const lost =
    data.onlyHere > 0
      ? ` ${data.onlyHere === 1 ? '1 of them is' : `${data.onlyHere} of them are`} only on this phone (meetings, and dictations not shared yet) and will be deleted for good.`
      : '';
  return {
    title: 'You signed in with another account',
    intro: `This phone has ${what} ${from}. You are now signed in as ${next.email || 'a new account'}. Choose what happens to them. Nothing is synced until you choose.`,
    merge: {
      label: `Merge into ${next.email || 'the new account'}`,
      detail: `Keep the ${what} on this phone and sync them with ${next.email || 'the new account'}: the dictations go up to its Wispra Cloud and appear on its other devices. Meetings stay on this phone only: Wispra Cloud does not keep meetings from the phone.`,
    },
    newOnly: {
      label: `Use only ${next.email || 'the new account'}`,
      detail: `Remove the ${what} of ${prev} from this phone and take the dictation history of ${next.email || 'the new account'} from Wispra Cloud. Nothing is deleted in the Wispra Cloud of ${prev}; sign in to it again to get its shared dictations back.${lost} Meetings of ${next.email || 'the new account'} made on other devices cannot be brought to this phone.`,
    },
    signOut: {
      label: 'Sign out',
      detail: 'Signed in with the wrong account? Sign out: nothing is synced and nothing changes on this phone.',
    },
  };
}

// account.json: an account, or 'unclaimed' (nobody yet); null when there is no readable file
export function parseOwner(text: string | null): DataOwner | 'unclaimed' | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<DataOwner> & { unclaimed?: unknown };
    if (raw.unclaimed === true) return 'unclaimed';
    return typeof raw.userId === 'string' && raw.userId ? { userId: raw.userId, email: typeof raw.email === 'string' ? raw.email : '' } : null;
  } catch {
    return null;
  }
}

export function serializeOwner(owner: DataOwner | 'unclaimed'): string {
  return owner === 'unclaimed' ? JSON.stringify({ unclaimed: true }) : JSON.stringify({ userId: owner.userId, email: owner.email });
}

/**
 * The owner when Wispra starts, from account.json and the entries on the phone. No file and no
 * data: a fresh phone, marked unclaimed so what is recorded before the first sign-in belongs to that
 * first account. No file but data: made by an older version, so the owner is unknown and a sign-in
 * asks (nothing is pushed to the account that signs in until the user chose).
 */
export function ownerAtStart(file: DataOwner | 'unclaimed' | null, entries: Entry[]): { owner: Owner; markUnclaimed: boolean } {
  if (file === 'unclaimed') return { owner: null, markUnclaimed: false };
  if (file) return { owner: file, markUnclaimed: false };
  if (settled(entries).length > 0) return { owner: 'unknown', markUnclaimed: false };
  return { owner: null, markUnclaimed: true };
}

// What the question shows, and exactly which entries it counted (the choice is bound to them)
export interface AccountChoiceView {
  data: PhoneData;
  text: ChoiceText;
  shownIds: string[];
}

export function choiceView(owner: Owner, session: SignedIn | null, entries: Entry[]): AccountChoiceView | null {
  if (!owner || !session || !needsChoice(owner, session)) return null;
  const data = phoneData(entries);
  return { data, text: choiceText(owner, session, data), shownIds: settled(entries).map((e) => e.id) };
}

/**
 * - done: applied
 * - changed: the entries are no longer the ones the question counted (a dictation came in from the
 *   mic button, a recording ended): nothing was changed; the question is shown again, updated
 * - save-failed: the new list could not be saved: nothing was changed, no file deleted, the owner
 *   is still the previous account
 * - not-needed: no choice is waiting any more (signed out, or the same account again)
 */
export type ChoiceResult = 'done' | 'changed' | 'save-failed' | 'not-needed';

export interface ChoiceDeps {
  session(): SignedIn | null;
  owner(): Owner;
  // The latest entries
  entries(): Entry[];
  // Saves the list; false when it did not reach the disk
  saveEntries(list: Entry[]): boolean;
  deleteAudio(uri: string): void;
  saveOwner(owner: DataOwner): void;
  // The new account's history is read afresh (without `since`), as on the computer: a "delete
  // everything" from before is only noted and never deletes what was just merged in; deleted ids
  // still apply
  resetReadCursor(userId: string): void;
  makeId?: () => string;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function applyAccountChoice(deps: ChoiceDeps, choice: AccountChoice, shownIds: readonly string[]): ChoiceResult {
  const session = deps.session();
  const owner = deps.owner();
  if (!session || !needsChoice(owner, session)) return 'not-needed';
  const entries = deps.entries();
  if (!sameIds(settled(entries).map((e) => e.id), shownIds)) return 'changed';

  if (choice === 'merge') {
    if (!deps.saveEntries(mergeIntoNewAccount(entries, deps.makeId))) return 'save-failed';
  } else {
    // The list without the previous account's entries is saved first; only then do their audio
    // files go. Nothing is sent to the previous account's Wispra Cloud.
    const { keep, removed } = leaveForNewAccount(entries);
    if (!deps.saveEntries(keep)) return 'save-failed';
    for (const e of removed) {
      for (const uri of [e.audioUri, ...(e.segments ?? []).map((s) => s.uri)]) {
        if (uri) deps.deleteAudio(uri);
      }
    }
  }
  deps.resetReadCursor(session.userId);
  deps.saveOwner({ userId: session.userId, email: session.email });
  return 'done';
}
