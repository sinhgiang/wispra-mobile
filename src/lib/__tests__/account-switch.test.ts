import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FakeCloud, fakeAuth } from '../__fixtures__/fake-cloud';
import {
  choiceText,
  leaveForNewAccount,
  mergeIntoNewAccount,
  needsChoice,
  ownerAfterSignIn,
  parseOwner,
  phoneData,
  serializeOwner,
  syncAllowed,
  type DataOwner,
} from '../account-switch';
import { createEntry, type Entry } from '../entries';
import { batches, planSync, toHistoryEntry } from '../history-sync';

jest.mock('../cloud-auth', () => require('../__fixtures__/fake-cloud').fakeAuth);
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://cloud.test' } }));

// eslint-disable-next-line import/first
import { mergeHistory, readHistory } from '../cloud-history';

const at = new Date('2026-10-05T08:00:00.000Z');
function dictation(over: Partial<Entry>): Entry {
  return { ...createEntry('dictation', at, 'mobile-a'), status: 'done', text: 'Hello', ...over };
}
function meeting(over: Partial<Entry>): Entry {
  return { ...createEntry('meeting', at, 'mobile-m'), status: 'done', text: 'We met', ...over };
}

const anna: DataOwner = { userId: 'user-a', email: 'anna@example.com' };
const ben = { userId: 'user-b', email: 'ben@example.com' };

// What the phone holds for Anna: a shared dictation, one not shared yet, one from her computer,
// a meeting, and a recording in progress
const annasPhone = [
  dictation({ id: 'mobile-shared', syncedAt: '2026-10-05T08:01:00.000Z' }),
  dictation({ id: 'mobile-unshared' }),
  dictation({ id: 'pc-1', source: 'computer', title: 'Gmail' }),
  meeting({ id: 'mobile-meeting' }),
  dictation({ id: 'mobile-recording', status: 'recording', text: null }),
];

describe('when to ask', () => {
  it('asks only when another account signs in than the one whose data is on the phone', () => {
    expect(needsChoice(anna, ben)).toBe(true);
    expect(needsChoice(anna, { userId: 'user-a', email: 'anna@new-mail.example' })).toBe(false);
    expect(needsChoice(null, ben)).toBe(false);
    expect(needsChoice(anna, null)).toBe(false);
  });

  it('syncs nothing until the user chose', () => {
    expect(syncAllowed(anna, ben)).toBe(false);
    expect(syncAllowed(anna, { ...anna })).toBe(true);
    expect(syncAllowed(null, ben)).toBe(true);
    expect(syncAllowed(anna, null)).toBe(false);
  });

  it('makes the first account the owner without asking, and keeps the same one', () => {
    expect(ownerAfterSignIn(null, ben)).toEqual(ben);
    expect(ownerAfterSignIn(anna, { userId: 'user-a', email: 'anna@new-mail.example' })).toEqual({ userId: 'user-a', email: 'anna@new-mail.example' });
    expect(ownerAfterSignIn(anna, ben)).toBe(anna);
    expect(ownerAfterSignIn(anna, null)).toBe(anna);
  });

  it('remembers the owner in account.json', () => {
    expect(parseOwner(serializeOwner(anna))).toEqual(anna);
    expect(parseOwner(null)).toBeNull();
    expect(parseOwner('{nope')).toBeNull();
    expect(parseOwner('{"email":"x"}')).toBeNull();
  });
});

describe('what the question says', () => {
  const data = phoneData(annasPhone);

  it('counts what is on the phone, and what is only here', () => {
    expect(data).toEqual({ dictations: 3, meetings: 1, onlyHere: 2 });
  });

  it('names both accounts, the counts, and says nothing syncs before a choice', () => {
    const t = choiceText(anna, ben, data);
    expect(t.intro).toBe(
      'This phone has 3 dictations and 1 meeting from anna@example.com. You are now signed in as ben@example.com. Choose what happens to them. Nothing is synced until you choose.',
    );
    expect(t.merge.label).toBe('Merge into ben@example.com');
    expect(t.merge.detail).toContain("they go up to its Wispra Cloud");
    expect(t.newOnly.label).toBe('Use only ben@example.com');
    expect(t.newOnly.detail).toContain('Nothing is deleted in the Wispra Cloud of anna@example.com');
    expect(t.newOnly.detail).toContain('2 of them are only on this phone');
  });

  it('does not warn about losses when everything is shared', () => {
    const t = choiceText(anna, ben, phoneData([annasPhone[0]]));
    expect(t.newOnly.detail).not.toContain('only on this phone');
  });
});

describe('Merge', () => {
  it('keeps everything; phone dictations are shared again, computer ones become phone ones with new ids', () => {
    let n = 0;
    const merged = mergeIntoNewAccount(annasPhone, () => `mobile-new-${++n}`);
    expect(merged.map((e) => e.id)).toEqual(['mobile-shared', 'mobile-unshared', 'mobile-new-1', 'mobile-meeting', 'mobile-recording']);
    expect(merged.every((e) => e.kind === 'meeting' || !e.syncedAt)).toBe(true);
    expect(merged[2]).toMatchObject({ source: undefined, title: 'Gmail', text: 'Hello' });
  });
});

describe('Use only the new account', () => {
  it('removes everything but a recording in progress', () => {
    const { keep, removed } = leaveForNewAccount(annasPhone);
    expect(keep.map((e) => e.id)).toEqual(['mobile-recording']);
    expect(removed).toHaveLength(4);
  });
});

describe('the two choices against a fake Wispra Cloud', () => {
  let server: FakeCloud;
  const realFetch = global.fetch;

  beforeEach(() => {
    server = new FakeCloud();
    global.fetch = server.fetch as unknown as typeof fetch;
    server.account('user-a').entries = [{ id: 'mobile-shared', text: 'Hello', createdAt: at.toISOString() }];
    server.account('user-b').entries = [{ id: 'desk-ben', text: 'Ben on his computer', createdAt: at.toISOString() }];
    fakeAuth.user = 'user-b';
  });

  afterEach(() => {
    global.fetch = realFetch;
    fakeAuth.user = null;
  });

  it('Use only the new account: nothing is sent about Anna, her cloud is intact, Ben’s history comes in', async () => {
    const { keep } = leaveForNewAccount(annasPhone);
    const page = await readHistory(null, 'user-b');
    const plan = planSync(keep, page.entries, new Set(), page.complete);
    expect(plan.push).toEqual([]);
    expect(plan.upserts.map((e) => e.id)).toEqual(['desk-ben']);
    expect(server.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    expect(server.account('user-a').entries.map((e) => e.id)).toEqual(['mobile-shared']);
    expect(server.account('user-a').marks).toEqual([]);
  });

  it('Merge: the phone’s dictations go up to Ben’s cloud, as Ben; Anna’s cloud is untouched', async () => {
    let n = 0;
    const merged = mergeIntoNewAccount(annasPhone, () => `mobile-new-${++n}`);
    const page = await readHistory(null, 'user-b');
    const plan = planSync(merged, page.entries, new Set(), page.complete);
    for (const batch of batches(plan.push)) await mergeHistory(batch.map(toHistoryEntry), 'user-b');
    expect(server.account('user-b').entries.map((e) => e.id).sort()).toEqual(['desk-ben', 'mobile-new-1', 'mobile-shared', 'mobile-unshared']);
    expect(server.requests.filter((r) => r.method === 'POST').every((r) => r.user === 'user-b')).toBe(true);
    expect(server.account('user-a').entries.map((e) => e.id)).toEqual(['mobile-shared']);
  });
});
