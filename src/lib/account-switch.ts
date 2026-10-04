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

export interface SignedIn {
  userId: string;
  email: string;
}

export type AccountChoice = 'merge' | 'new-only';

// Whether the user has to choose before anything is synced
export function needsChoice(owner: DataOwner | null, session: SignedIn | null): boolean {
  return !!owner && !!session && owner.userId !== session.userId;
}

// Syncing with Wispra Cloud is allowed only for the account the phone's data belongs to
export function syncAllowed(owner: DataOwner | null, session: SignedIn | null): boolean {
  return !!session && !needsChoice(owner, session);
}

// After a sign-in that needs no choice: the first account becomes the owner; the same account
// keeps it (with its current email). Returns the owner unchanged while a choice is waiting.
export function ownerAfterSignIn(owner: DataOwner | null, session: SignedIn | null): DataOwner | null {
  if (!session) return owner;
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
}

export function choiceText(previous: DataOwner, next: SignedIn, data: PhoneData): ChoiceText {
  const what = `${plural(data.dictations, 'dictation')} and ${plural(data.meetings, 'meeting')}`;
  const lost =
    data.onlyHere > 0
      ? ` ${data.onlyHere === 1 ? '1 of them is' : `${data.onlyHere} of them are`} only on this phone (meetings, and dictations not shared yet) and will be deleted for good.`
      : '';
  return {
    title: 'You signed in with another account',
    intro: `This phone has ${what} from ${previous.email || 'the previous account'}. You are now signed in as ${next.email || 'a new account'}. Choose what happens to them. Nothing is synced until you choose.`,
    merge: {
      label: `Merge into ${next.email || 'the new account'}`,
      detail: `Keep the ${what} on this phone and sync them with ${next.email || 'the new account'}: they go up to its Wispra Cloud and appear on its other devices.`,
    },
    newOnly: {
      label: `Use only ${next.email || 'the new account'}`,
      detail: `Remove the ${what} of ${previous.email || 'the previous account'} from this phone and take everything from ${next.email || 'the new account'}. Nothing is deleted in the Wispra Cloud of ${previous.email || 'the previous account'}; sign in to it again to get its shared history back.${lost}`,
    },
  };
}

// account.json
export function parseOwner(text: string | null): DataOwner | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<DataOwner>;
    return typeof raw.userId === 'string' && raw.userId ? { userId: raw.userId, email: typeof raw.email === 'string' ? raw.email : '' } : null;
  } catch {
    return null;
  }
}

export function serializeOwner(owner: DataOwner): string {
  return JSON.stringify({ userId: owner.userId, email: owner.email });
}
