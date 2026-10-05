import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FakeCloud, fakeAuth } from '../__fixtures__/fake-cloud';
import { FakeStore } from '../__fixtures__/fake-store';
import {
  applyAccountChoice,
  choiceText,
  choiceView,
  leaveForNewAccount,
  mergeIntoNewAccount,
  needsChoice,
  ownerAfterSignIn,
  ownerAtStart,
  parseOwner,
  phoneData,
  serializeOwner,
  syncAllowed,
  type ChoiceDeps,
  type DataOwner,
} from '../account-switch';
import { createEntry, type Entry } from '../entries';
import { batches, planSync, toHistoryEntry } from '../history-sync';

jest.mock('../cloud-auth', () => require('../__fixtures__/fake-cloud').fakeAuth);
jest.mock('../cloud-config', () => ({ cloud: { apiBase: 'https://cloud.test' } }));

// eslint-disable-next-line import/first
import { deleteAllHistory, deleteHistoryEntry, mergeHistory, readHistory } from '../cloud-history';
// eslint-disable-next-line import/first
import { syncDeletes, type DeleteSyncCloud } from '../delete-sync';

const realCloud: DeleteSyncCloud = { deleteOne: deleteHistoryEntry, deleteAll: deleteAllHistory, read: (since, asUser) => readHistory(since, asUser) };

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
    expect(t.merge.detail).toContain("the dictations go up to its Wispra Cloud");
    expect(t.merge.detail).toContain("Meetings stay on this phone only");
    expect(t.newOnly.detail).toContain("Meetings of ben@example.com made on other devices cannot be brought to this phone");
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

describe('choosing, through applyAccountChoice (the path the app runs)', () => {
  let server: FakeCloud;
  let store: FakeStore;
  const realFetch = global.fetch;
  const clock = () => new Date(server.now);

  // Anna's phone, as in the question; Ben signs in
  function annaThenBen(): string[] {
    store.list = annasPhone.map((e) => ({ ...e, audioUri: e.kind === 'meeting' ? null : `file:///audio/${e.id}.m4a` }));
    store.dataOwner = anna;
    fakeAuth.user = 'user-b';
    const view = choiceView(store.owner(), store.session(), store.entries());
    return view!.shownIds;
  }

  beforeEach(() => {
    server = new FakeCloud();
    store = new FakeStore();
    global.fetch = server.fetch as unknown as typeof fetch;
    server.account('user-a').entries = [{ id: 'mobile-shared', text: 'Hello', createdAt: at.toISOString() }];
    server.account('user-b').entries = [{ id: 'desk-ben', text: 'Ben on his computer', createdAt: at.toISOString() }];
  });

  afterEach(() => {
    global.fetch = realFetch;
    fakeAuth.user = null;
  });

  it('asks nothing on the first sign-in or when the same account signs in again', () => {
    fakeAuth.user = 'user-a';
    expect(choiceView(null, store.session(), annasPhone)).toBeNull();
    expect(choiceView(anna, store.session(), annasPhone)).toBeNull();
    expect(applyAccountChoice(bind(store), 'new-only', [])).toBe('not-needed');
    expect(store.log).toEqual([]);
  });

  it('counts exactly the entries a choice applies to (not a recording in progress)', () => {
    expect(annaThenBen()).toEqual(['mobile-shared', 'mobile-unshared', 'pc-1', 'mobile-meeting']);
  });

  it('syncs nothing while the question waits', () => {
    annaThenBen();
    expect(syncAllowed(store.owner(), store.session())).toBe(false);
    expect(server.requests).toEqual([]);
  });

  it('Use only: saves the new list first, then deletes the audio, then takes Ben as owner; nothing goes to Anna’s cloud', async () => {
    const shown = annaThenBen();
    expect(applyAccountChoice(bind(store), 'new-only', shown)).toBe('done');
    expect(store.list.map((e) => e.id)).toEqual(['mobile-recording']);
    expect(store.log[0]).toBe('saved');
    expect(store.log.filter((l) => l.startsWith('deleted'))).toHaveLength(3);
    expect(store.log.at(-1)).toBe('owner user-b');
    expect(syncAllowed(store.owner(), store.session())).toBe(true);

    // Ben's first sync after the choice
    await syncDeletes(store, realCloud, clock);
    expect(server.requests.every((r) => r.user === 'user-b' && r.method === 'GET')).toBe(true);
    expect(server.account('user-a').entries.map((e) => e.id)).toEqual(['mobile-shared']);
    expect(server.account('user-a').marks).toEqual([]);
  });

  it('Use only: when the list cannot be saved, nothing is deleted and Anna stays the owner', () => {
    const shown = annaThenBen();
    store.failSaves = true;
    expect(applyAccountChoice(bind(store), 'new-only', shown)).toBe('save-failed');
    expect(store.deletedAudio).toEqual([]);
    expect(store.dataOwner).toBe(anna);
    // The list in memory went back too (the save changes it first, like the app's commit)
    expect(store.list.map((e) => e.id)).toEqual(['mobile-shared', 'mobile-unshared', 'pc-1', 'mobile-meeting', 'mobile-recording']);
    expect(store.log).toEqual(['save failed']);
  });

  it('Merge: when the list cannot be saved, the ids are not changed in memory either', () => {
    const shown = annaThenBen();
    store.failSaves = true;
    expect(applyAccountChoice(bind(store), 'merge', shown)).toBe('save-failed');
    expect(store.list.find((e) => e.id === 'pc-1')?.source).toBe('computer');
    expect(store.dataOwner).toBe(anna);
  });

  it('Merge into an account whose history is longer than one page: merged entries go up once, nothing is deleted or doubled', async () => {
    // Ben has 600 dictations in Wispra Cloud, all newer than Anna's
    server.account('user-b').entries = Array.from({ length: 600 }, (_, i) => ({
      id: `desk-ben-${i}`,
      text: `Ben ${i}`,
      createdAt: new Date(Date.parse('2026-10-05T09:00:00.000Z') + i * 1000).toISOString(),
    }));
    const shown = annaThenBen();
    let n = 0;
    expect(applyAccountChoice({ ...bind(store), makeId: () => `mobile-new-${++n}` }, 'merge', shown)).toBe('done');

    const syncOnce = async () => {
      const result = await syncDeletes(store, realCloud, clock);
      expect(result!.page.complete).toBe(false);
      const plan = planSync(store.list, result!.page.entries, new Set(), result!.page.complete);
      const known = new Set(store.list.map((e) => e.id));
      store.list = [...store.list, ...plan.upserts.filter((e) => !known.has(e.id))];
      for (const batch of batches(plan.push)) {
        await mergeHistory(batch.map(toHistoryEntry), 'user-b');
        const ids = new Set(batch.map((e) => e.id));
        store.list = store.list.map((e) => (ids.has(e.id) ? { ...e, syncedAt: new Date(server.now).toISOString() } : e));
      }
      return plan.push.length;
    };

    expect(await syncOnce()).toBe(3);
    expect(await syncOnce()).toBe(0);
    const ids = server.account('user-b').entries.map((e) => e.id);
    expect(ids).toHaveLength(603);
    expect(new Set(ids).size).toBe(603);
    expect(ids).toEqual(expect.arrayContaining(['mobile-shared', 'mobile-unshared', 'mobile-new-1']));
    expect(server.account('user-b').marks).toEqual([]);
    expect(store.list.map((e) => e.id)).toEqual(expect.arrayContaining(['mobile-shared', 'mobile-unshared', 'mobile-new-1', 'mobile-meeting']));
  });

  it('refuses when a dictation came in from the mic button after the question was shown', () => {
    const shown = annaThenBen();
    store.list = [...store.list, dictation({ id: 'mobile-from-inbox' })];
    expect(applyAccountChoice(bind(store), 'new-only', shown)).toBe('changed');
    expect(store.log).toEqual([]);
    expect(store.list).toHaveLength(6);
    // The question shown again counts it
    expect(choiceView(store.owner(), store.session(), store.entries())?.data.dictations).toBe(4);
  });

  it('refuses when the recording in progress ended after the question was shown', () => {
    const shown = annaThenBen();
    store.list = store.list.map((e) => (e.id === 'mobile-recording' ? { ...e, status: 'pending' as const } : e));
    expect(applyAccountChoice(bind(store), 'new-only', shown)).toBe('changed');
    expect(store.deletedAudio).toEqual([]);
  });

  it('Merge: Ben’s cloud gets the phone’s dictations, as Ben; Anna’s cloud is untouched', async () => {
    const shown = annaThenBen();
    let n = 0;
    expect(applyAccountChoice({ ...bind(store), makeId: () => `mobile-new-${++n}` }, 'merge', shown)).toBe('done');
    expect(store.dataOwner).toEqual({ userId: 'user-b', email: 'user-b@example.com' });

    const result = await syncDeletes(store, realCloud, clock);
    const plan = planSync(store.list, result!.page.entries, new Set(), result!.page.complete);
    for (const batch of batches(plan.push)) await mergeHistory(batch.map(toHistoryEntry), 'user-b');
    expect(server.account('user-b').entries.map((e) => e.id).sort()).toEqual(['desk-ben', 'mobile-new-1', 'mobile-shared', 'mobile-unshared']);
    expect(server.requests.filter((r) => r.method !== 'GET').every((r) => r.user === 'user-b')).toBe(true);
    expect(server.account('user-a').entries.map((e) => e.id)).toEqual(['mobile-shared']);
  });

  it('Merge into an account that read its history here before and was cleared since: the merged entries stay, deleted ids still apply', async () => {
    // Ben used this phone before (his since is old); then everything of Ben was deleted on his computer
    store.setPending({ userId: 'user-b', ids: [], since: '2026-10-05T11:00:00.000Z', clearedHandled: null });
    server.account('user-b').entries.push({ id: 'mobile-gone', text: 'x', createdAt: at.toISOString() });
    server.deleteAll('user-b');
    server.tick(10);

    annaThenBen();
    store.list = [...store.list, dictation({ id: 'mobile-gone', syncedAt: at.toISOString() })];
    const shown = choiceView(store.owner(), store.session(), store.entries())!.shownIds;
    expect(applyAccountChoice(bind(store), 'merge', shown)).toBe('done');
    expect(store.pending().since).toBeNull();

    await syncDeletes(store, realCloud, clock);
    const ids = store.list.map((e) => e.id);
    // Anna's dictations, made long before Ben's clear, are kept to be shared
    expect(ids).toEqual(expect.arrayContaining(['mobile-shared', 'mobile-unshared', 'mobile-meeting']));
    // An id Ben deleted is still deleted
    expect(ids).not.toContain('mobile-gone');
    expect(store.pending().clearedHandled).toBe('2026-10-05T12:00:00.000Z');
  });
});

// The store's methods, bound, so they can be spread into deps
function bind(store: FakeStore): ChoiceDeps {
  return {
    session: () => store.session(),
    owner: () => store.owner(),
    entries: () => store.entries(),
    saveEntries: (list) => store.saveEntries(list),
    deleteAudio: (uri) => store.deleteAudio(uri),
    saveOwner: (owner) => store.saveOwner(owner),
    resetReadCursor: (userId) => store.resetReadCursor(userId),
  };
}

describe('a phone whose data has no known owner (made by an older version)', () => {
  it('knows the owner at start: account.json, unclaimed, or unknown when there is data but no file', () => {
    expect(ownerAtStart(anna, annasPhone)).toEqual({ owner: anna, markUnclaimed: false });
    expect(ownerAtStart('unclaimed', annasPhone)).toEqual({ owner: null, markUnclaimed: false });
    expect(ownerAtStart(null, annasPhone)).toEqual({ owner: 'unknown', markUnclaimed: false });
    // A fresh phone: marked unclaimed, so what is recorded before the first sign-in is that account's
    expect(ownerAtStart(null, [])).toEqual({ owner: null, markUnclaimed: true });
    // Only a recording in progress counts as no data yet
    expect(ownerAtStart(null, [annasPhone[4]]).owner).toBeNull();
  });

  it('keeps unclaimed in account.json', () => {
    expect(parseOwner(serializeOwner('unclaimed'))).toBe('unclaimed');
  });

  it('asks on any sign-in, syncs nothing before the choice, and does not take the account by itself', () => {
    expect(needsChoice('unknown', ben)).toBe(true);
    expect(syncAllowed('unknown', ben)).toBe(false);
    expect(ownerAfterSignIn('unknown', ben)).toBe('unknown');
    expect(needsChoice('unknown', null)).toBe(false);
  });

  it('says the data comes from an earlier account it cannot name', () => {
    const t = choiceText('unknown', ben, phoneData(annasPhone));
    expect(t.intro).toContain('from an earlier account (this phone did not keep which one)');
    expect(t.newOnly.detail).toContain('Nothing is deleted in the Wispra Cloud of an earlier account');
  });

  it('applies either choice through applyAccountChoice, then the account signed in owns the data', () => {
    const store = new FakeStore();
    store.list = annasPhone;
    store.dataOwner = 'unknown';
    fakeAuth.user = 'user-b';
    const shown = choiceView(store.owner(), store.session(), store.entries())!.shownIds;
    expect(applyAccountChoice(bind(store), 'merge', shown)).toBe('done');
    expect(store.dataOwner).toEqual({ userId: 'user-b', email: 'user-b@example.com' });
    expect(store.list).toHaveLength(5);
    fakeAuth.user = null;
  });
});

describe('Sign out from the question (a sign-in with the wrong account)', () => {
  let server: FakeCloud;
  const realFetch = global.fetch;

  beforeEach(() => {
    server = new FakeCloud();
    global.fetch = server.fetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
    fakeAuth.user = null;
  });

  it('is offered by the question, and is not a choice about the data', () => {
    const t = choiceText(anna, ben, phoneData(annasPhone));
    expect(t.signOut.label).toBe('Sign out');
    expect(t.signOut.detail).toBe('Signed in with the wrong account? Sign out: nothing is synced and nothing changes on this phone.');
  });

  it('after signing out: no question, nothing synced or changed, the data still belongs to Anna', async () => {
    const store = new FakeStore();
    store.list = annasPhone;
    store.dataOwner = anna;
    fakeAuth.user = 'user-b';
    const shown = choiceView(store.owner(), store.session(), store.entries())!.shownIds;
    fakeAuth.user = null; // Sign out
    expect(choiceView(store.owner(), store.session(), store.entries())).toBeNull();
    expect(applyAccountChoice(bind(store), 'new-only', shown)).toBe('not-needed');
    expect(syncAllowed(store.owner(), store.session())).toBe(false);
    expect(await syncDeletes(store, realCloud, () => new Date())).toBeNull();
    expect(server.requests).toEqual([]);
    expect(store.log).toEqual([]);
    expect(store.dataOwner).toBe(anna);
    expect(store.list).toHaveLength(5);
  });
});
