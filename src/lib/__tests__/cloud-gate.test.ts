import { describe, expect, it } from '@jest/globals';

import { commitWithRollback, drainQueue } from '../cloud-gate';

describe('the transcription queue checks the account before every job', () => {
  it('stops as soon as another account signs in, even in the middle of a long queue', async () => {
    let account = 'user-a';
    const owner = 'user-a';
    const sent: string[] = [];
    const queue = ['piece-1', 'piece-2', 'piece-3', 'piece-4'];
    const next = async () => {
      const job = queue.shift();
      if (!job) return false;
      sent.push(`${job} as ${account}`);
      if (job === 'piece-2') account = 'user-b'; // signed out and into B while piece 2 was sent
      return true;
    };
    const ran = await drainQueue(() => account === owner, next);
    expect(ran).toBe(2);
    expect(sent).toEqual(['piece-1 as user-a', 'piece-2 as user-a']);
    expect(queue).toEqual(['piece-3', 'piece-4']);
  });

  it('runs nothing when not allowed at the start, and everything while allowed', async () => {
    let calls = 0;
    expect(await drainQueue(() => false, async () => ++calls > 0)).toBe(0);
    expect(calls).toBe(0);
    const jobs = [1, 2, 3];
    expect(await drainQueue(() => true, async () => jobs.shift() !== undefined)).toBe(3);
  });
});

describe('saving a list that cannot be undone', () => {
  it('keeps the new list when it reaches the disk', () => {
    let list = ['a', 'b'];
    const ok = commitWithRollback({ get: () => list, set: (l) => (list = l) }, () => true, ['b']);
    expect(ok).toBe(true);
    expect(list).toEqual(['b']);
  });

  it('puts the previous list back in memory when the save fails', () => {
    const before = ['a', 'b'];
    let list = before;
    const seen: string[][] = [];
    const ok = commitWithRollback(
      { get: () => list, set: (l) => (list = l) },
      (l) => {
        seen.push(l);
        return false;
      },
      ['b'],
    );
    expect(ok).toBe(false);
    expect(seen).toEqual([['b']]);
    expect(list).toBe(before);
  });
});
