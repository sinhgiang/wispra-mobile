// Small pieces of entries-store kept apart so they can be tested (T-0142 review).

/**
 * Runs queued jobs one after another while `allowed()` holds, checked again before EVERY job: the
 * account can change while a long queue runs (signing out and into another account), and then no
 * further recording may go to Wispra Cloud before the user chose what happens to the data.
 * Returns how many jobs ran.
 */
export async function drainQueue(allowed: () => boolean, next: () => Promise<boolean>): Promise<number> {
  let done = 0;
  while (allowed() && (await next())) done++;
  return done;
}

/**
 * Shows the new list at once and saves it; when the save fails, the list in memory goes back to
 * what it was, so the app never shows (or acts on) something that is not on the disk.
 */
export function commitWithRollback<T>(state: { get(): T; set(value: T): void }, persist: (value: T) => boolean, next: T): boolean {
  const before = state.get();
  state.set(next);
  if (persist(next)) return true;
  state.set(before);
  return false;
}
