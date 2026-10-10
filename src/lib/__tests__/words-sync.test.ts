// The word lists shared with the computer through Wispra Cloud (T-0193), run against a stand-in for wispra-web's
// GET/PUT /api/lexicon (docs/LEXICON_API.md): the same checks, replace-a-list-that-is-sent, and no write when
// nothing changed. A second client plays the computer.
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LexiconEntry } from '../lexicon';
import { mergeLexicon, mergeVocabulary, parseCloudLists } from '../lexicon-sync';
import { syncWords } from '../words-sync-store';
import { Device, FakeCloud, entry } from '../__fixtures__/words-cloud';

let cloud: FakeCloud;
let phone: Device;
beforeEach(() => {
  cloud = new FakeCloud();
  phone = new Device(cloud);
});

describe('the first sync is a union: nothing the person has is lost', () => {
  it('sends the phone’s words, brings in the cloud’s, and keeps the ones both have once', async () => {
    phone.vocabulary = ['Github', 'Capcut'];
    phone.lexicon = [entry('p1', 'Claude', { heardAs: ['cloud'], count: 2 })];
    cloud.vocabulary = ['capcut', 'Timio'];
    cloud.lexicon = { c1: entry('c1', 'Lenvid', { heardAs: ['lenvit'] }) as never };
    const result = await phone.sync();
    expect(result).toMatchObject({ ok: true, wrote: { vocabulary: true, lexicon: true } });
    // The cloud's spelling is kept for a term both have; the others are added after it
    expect(phone.vocabulary).toEqual(['capcut', 'Timio', 'Github']);
    expect(cloud.vocabulary).toEqual(['capcut', 'Timio', 'Github']);
    expect(phone.lexicon.map((e) => e.term).sort()).toEqual(['Claude', 'Lenvid']);
    expect(Object.values(cloud.lexicon).map((e) => e.term).sort()).toEqual(['Claude', 'Lenvid']);
  });

  it('a new account with nothing on the cloud gets everything the phone has', async () => {
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude')];
    await phone.sync();
    expect(cloud.vocabulary).toEqual(['Github']);
    expect(Object.keys(cloud.lexicon)).toEqual(['p1']);
  });

  it('a phone with nothing gets the cloud’s lists', async () => {
    cloud.vocabulary = ['Github', 'Capcut'];
    cloud.lexicon = { c1: entry('c1', 'Claude') as never };
    await phone.sync();
    expect(phone.vocabulary).toEqual(['Github', 'Capcut']);
    expect(phone.lexicon.map((e) => e.term)).toEqual(['Claude']);
    expect(cloud.puts).toBe(0);
  });
});

describe('both ways, with the computer', () => {
  // The computer, until it keeps a snapshot, reads, adds what it has and writes the union (T-0192)
  async function computerAdds(vocabulary: string[], lexicon: LexiconEntry[]) {
    const read = (await cloud.request('GET', 'good')).json as { vocabulary: { terms: string[] }; lexicon: LexiconEntry[] };
    const parsed = parseCloudLists(read) ?? { vocabulary: [], lexicon: [] };
    await cloud.request('PUT', 'good', {
      vocabulary: mergeVocabulary(vocabulary, parsed.vocabulary, null),
      lexicon: mergeLexicon(lexicon, parsed.lexicon, null),
    });
  }

  it('a word added on the phone is on the computer after the sync, and the other way round', async () => {
    await phone.sync();
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude Code', { heardAs: ['Cloud Code'], source: 'manual' })];
    await phone.sync();
    // The computer's next sync reads them
    const onComputer = parseCloudLists((await cloud.request('GET', 'good')).json);
    expect(onComputer?.vocabulary).toEqual(['Github']);
    expect(onComputer?.lexicon.map((e) => e.term)).toEqual(['Claude Code']);
    // The computer adds its own and writes the union back
    await computerAdds(['Github', 'TikTok'], [entry('d1', 'Lenvid', { heardAs: ['lenvit'] })]);
    await phone.sync();
    expect(phone.vocabulary).toEqual(['Github', 'TikTok']);
    expect(phone.lexicon.map((e) => e.term).sort()).toEqual(['Claude Code', 'Lenvid']);
  });

  it('the same word learned on both with different ids becomes one, and both end with the same id', async () => {
    phone.lexicon = [entry('p1', 'Claude', { heardAs: ['cloud'], count: 1, createdAt: '2026-10-02T00:00:00.000Z', lastSeen: '2026-10-02T00:00:00.000Z' })];
    await computerAdds([], [entry('d1', 'claude', { heardAs: ['clod'], count: 3, createdAt: '2026-10-01T00:00:00.000Z', lastSeen: '2026-10-05T00:00:00.000Z' })]);
    await phone.sync();
    expect(phone.lexicon).toHaveLength(1);
    expect(phone.lexicon[0]).toMatchObject({ id: 'd1', term: 'claude', count: 3, createdAt: '2026-10-01T00:00:00.000Z', lastSeen: '2026-10-05T00:00:00.000Z' });
    expect(phone.lexicon[0].heardAs.sort()).toEqual(['clod', 'cloud']);
    expect(Object.keys(cloud.lexicon)).toEqual(['d1']);
    // The count is not added up (the same fix would be counted twice)
    expect(phone.lexicon[0].count).not.toBe(4);
  });
});

describe('the newest entry wins', () => {
  it('takes the newer one’s spelling, on/off and pinned, whichever side it is on', async () => {
    cloud.lexicon = { c1: entry('c1', 'Github', { lastSeen: '2026-10-03T00:00:00.000Z', enabled: true, pinned: false }) as never };
    phone.lexicon = [entry('c1', 'GitHub', { lastSeen: '2026-10-06T00:00:00.000Z', enabled: false, pinned: true })];
    await phone.sync();
    expect(phone.lexicon[0]).toMatchObject({ term: 'GitHub', enabled: false, pinned: true });
    expect(cloud.lexicon.c1).toMatchObject({ term: 'GitHub', enabled: false, pinned: true });
    // And the other way
    const other = new Device(cloud);
    other.lexicon = [entry('c1', 'github', { lastSeen: '2026-10-01T00:00:00.000Z' })];
    await other.sync();
    expect(other.lexicon[0].term).toBe('GitHub');
  });

  it('a word is the same word whatever its case or spacing', () => {
    expect(mergeLexicon([entry('a', 'Claude  Code')], [entry('b', 'claude code')], null)).toHaveLength(1);
    expect(mergeVocabulary(['Git Hub'], ['git  hub'], null)).toHaveLength(1);
  });
});

describe('deleting', () => {
  it('a word deleted on the phone is deleted on the cloud and does not come back', async () => {
    phone.vocabulary = ['Github', 'Capcut'];
    phone.lexicon = [entry('p1', 'Claude'), entry('p2', 'Lenvid')];
    await phone.sync();
    phone.vocabulary = ['Capcut'];
    phone.lexicon = [entry('p2', 'Lenvid')];
    await phone.sync();
    expect(cloud.vocabulary).toEqual(['Capcut']);
    expect(Object.keys(cloud.lexicon)).toEqual(['p2']);
    await phone.sync();
    expect(phone.vocabulary).toEqual(['Capcut']);
    expect(phone.lexicon.map((e) => e.term)).toEqual(['Lenvid']);
  });

  it('a word taken off the cloud by another device is taken off the phone', async () => {
    phone.vocabulary = ['Github', 'Capcut'];
    phone.lexicon = [entry('p1', 'Claude'), entry('p2', 'Lenvid')];
    await phone.sync();
    cloud.vocabulary = ['Capcut'];
    delete cloud.lexicon.p1;
    await phone.sync();
    expect(phone.vocabulary).toEqual(['Capcut']);
    expect(phone.lexicon.map((e) => e.term)).toEqual(['Lenvid']);
  });

  it('a word the phone deleted but another device used since stays: the newest wins over a delete', async () => {
    phone.lexicon = [entry('p1', 'Claude', { lastSeen: '2026-10-01T00:00:00.000Z' })];
    await phone.sync();
    phone.lexicon = [];
    cloud.lexicon.p1 = { ...cloud.lexicon.p1, lastSeen: '2026-10-06T00:00:00.000Z', count: 4 };
    await phone.sync();
    expect(phone.lexicon.map((e) => e.term)).toEqual(['Claude']);
    expect(Object.keys(cloud.lexicon)).toEqual(['p1']);
  });

  it('a word the cloud lost but the phone used since stays on the phone and goes back up', async () => {
    phone.lexicon = [entry('p1', 'Claude', { lastSeen: '2026-10-01T00:00:00.000Z' })];
    await phone.sync();
    delete cloud.lexicon.p1;
    phone.lexicon = [entry('p1', 'Claude', { lastSeen: '2026-10-06T00:00:00.000Z', count: 2 })];
    await phone.sync();
    expect(Object.keys(cloud.lexicon)).toEqual(['p1']);
  });

  it('a wrong form taken off here is taken off the word on the cloud, and a new one from the cloud is kept', async () => {
    phone.lexicon = [entry('p1', 'Claude', { heardAs: ['cloud', 'clod'], lastSeen: '2026-10-01T00:00:00.000Z' })];
    await phone.sync();
    phone.lexicon = [entry('p1', 'Claude', { heardAs: ['clod'], lastSeen: '2026-10-02T00:00:00.000Z' })];
    cloud.lexicon.p1 = { ...cloud.lexicon.p1, heardAs: ['cloud', 'clod', 'clode'], lastSeen: '2026-10-01T00:00:00.000Z' };
    await phone.sync();
    expect(phone.lexicon[0].heardAs.sort()).toEqual(['clod', 'clode']);
    expect(((cloud.lexicon.p1.heardAs as string[]) ?? []).sort()).toEqual(['clod', 'clode']);
  });

  it('another account’s memory is not used: a first sync with this account is a plain union', async () => {
    phone.vocabulary = ['Github'];
    phone.userId = 'u1';
    await phone.sync();
    phone.vocabulary = [];
    phone.userId = 'u2';
    cloud.vocabulary = ['Capcut'];
    await phone.sync();
    // Nothing deleted for the account that never had it
    expect(phone.vocabulary).toEqual(['Capcut']);
    expect(phone.snapshot?.userId).toBe('u2');
  });
});

describe('writing only what changed, and never losing the lists', () => {
  it('writes nothing when the phone and the cloud already agree', async () => {
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude')];
    await phone.sync();
    const puts = cloud.puts;
    const again = await phone.sync();
    expect(again).toMatchObject({ ok: true, wrote: { vocabulary: false, lexicon: false }, changedHere: false });
    expect(cloud.puts).toBe(puts);
  });

  it('sends each list alone, so a cloud without the vocabulary table (503) still takes the learned words', async () => {
    cloud.vocabularyTable = false;
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude')];
    const result = await phone.sync();
    expect(result).toMatchObject({ ok: true, skipped: 'vocabulary', wrote: { vocabulary: false, lexicon: true } });
    expect(Object.keys(cloud.lexicon)).toEqual(['p1']);
    expect(phone.vocabulary).toEqual(['Github']);
    expect(phone.notes.join(' ')).toMatch(/cannot take the vocabulary yet/);
  });

  it('no connection leaves the phone’s lists as they are and says so', async () => {
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude')];
    cloud.down = true;
    const result = await phone.sync();
    expect(result).toMatchObject({ ok: false, reason: 'offline' });
    expect(phone.vocabulary).toEqual(['Github']);
    expect(phone.lexicon).toHaveLength(1);
    expect(phone.snapshot).toBeNull();
  });

  it('an expired sign-in (401), a missing one, and a server error are told and change nothing', async () => {
    phone.vocabulary = ['Github'];
    phone.token = 'stale';
    expect(await phone.sync()).toMatchObject({ ok: false, reason: 'signed-out' });
    phone.token = null;
    expect(await phone.sync()).toMatchObject({ ok: false, reason: 'signed-out' });
    phone.token = 'good';
    cloud.failWith = 500;
    expect(await phone.sync()).toMatchObject({ ok: false, reason: 'error', message: expect.stringContaining('kept on this phone') });
    expect(phone.vocabulary).toEqual(['Github']);
  });

  it('does not touch the network when Wispra Cloud may not be used for this phone’s data (another account waits)', async () => {
    phone.allowed = false;
    expect(await phone.sync()).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(cloud.requests).toEqual([]);
  });

  it('what is sent passes the server’s checks: flags, dates, counts, the 500 limit', async () => {
    phone.lexicon = Array.from({ length: 520 }, (_, i) => entry(`p${i}`, `Từ ${i}`, { count: i % 4, lastSeen: `2026-10-0${1 + (i % 9)}T00:00:00.000Z` }));
    const result = await phone.sync();
    expect(result.ok).toBe(true);
    expect(Object.keys(cloud.lexicon).length).toBeLessThanOrEqual(500);
    expect(cloud.requests.every((r) => r.method === 'GET' || (r.body as object) !== undefined)).toBe(true);
  });

  it('a save the reread missed is not overwritten, and that same sync sends it', async () => {
    cloud.vocabulary = ['Github'];
    phone.vocabulary = ['Github'];
    await phone.sync();
    const puts = cloud.puts;
    phone.duringSync = () => {
      // The file already has the new word, but the reread still returns the list from before the save
      phone.armStaleRead();
      phone.vocabulary = ['ZzThuNghiem', 'Github'];
      phone.revision += 1;
    };
    const result = await syncWords(() => ({ userId: phone.userId }), phone.deps());
    expect(result).toMatchObject({ ok: true, raced: false, wrote: { vocabulary: true } });
    expect(phone.vocabulary).toEqual(['Github', 'ZzThuNghiem']);
    expect(cloud.vocabulary).toEqual(['Github', 'ZzThuNghiem']);
    expect(cloud.puts).toBe(puts + 1);
  });

  it('a deletion the reread missed does not come back, and that same sync removes it from the cloud', async () => {
    cloud.vocabulary = ['Github', 'Capcut'];
    phone.vocabulary = ['Github', 'Capcut'];
    await phone.sync();
    phone.duringSync = () => {
      phone.armStaleRead();
      phone.vocabulary = ['Capcut'];
      phone.revision += 1;
    };
    await syncWords(() => ({ userId: phone.userId }), phone.deps());
    expect(phone.vocabulary).toEqual(['Capcut']);
    expect(cloud.vocabulary).toEqual(['Capcut']);
  });

  it('a change made while the network was busy is not overwritten, and the next run merges it', async () => {
    cloud.vocabulary = ['Capcut'];
    phone.vocabulary = ['Github'];
    phone.duringSync = () => {
      phone.vocabulary = ['Github', 'TikTok'];
    };
    const first = await phone.sync();
    expect(first).toMatchObject({ ok: true, raced: true, changedHere: false });
    // The person's list is theirs; the snapshot was not moved
    expect(phone.vocabulary).toEqual(['Github', 'TikTok']);
    expect(phone.snapshot).toBeNull();
    const second = await phone.sync();
    expect(second).toMatchObject({ ok: true, raced: false });
    expect(phone.vocabulary.sort()).toEqual(['Capcut', 'Github', 'TikTok']);
    expect(cloud.vocabulary.sort()).toEqual(['Capcut', 'Github', 'TikTok']);
  });

  it('says in the keyboard log what happened, never the words', async () => {
    phone.vocabulary = ['SecretName'];
    await phone.sync();
    expect(phone.notes[0]).toMatch(/^words sync: 1 vocabulary terms, 0 learned words, sent to the cloud/);
    expect(phone.notes.join(' ')).not.toMatch(/SecretName/);
  });
});

describe('guards (T-0193 review)', () => {
  it('a cloud that suddenly lacks most of its words is not the person deleting them: nothing is deleted here and the words go back up', async () => {
    phone.vocabulary = ['A one', 'B two', 'C three', 'D four', 'E five'];
    phone.lexicon = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id, i) => entry(id, `Từ ${i}`));
    await phone.sync();
    // A server fault, or the computer writing an empty list
    cloud.vocabulary = [];
    cloud.lexicon = {};
    const result = await phone.sync();
    expect(result).toMatchObject({ ok: true });
    expect(phone.vocabulary).toHaveLength(5);
    expect(phone.lexicon).toHaveLength(5);
    expect(cloud.vocabulary).toHaveLength(5);
    expect(Object.keys(cloud.lexicon)).toHaveLength(5);
    expect(phone.notes.join(' ')).toMatch(/deletions were not carried out/);
  });

  it('a few words taken off by another device are still taken off (too few to tell from a fault)', async () => {
    phone.vocabulary = ['A one', 'B two', 'C three', 'D four', 'E five'];
    await phone.sync();
    cloud.vocabulary = ['A one', 'B two', 'C three', 'D four'];
    await phone.sync();
    expect(phone.vocabulary).toEqual(['A one', 'B two', 'C three', 'D four']);
  });

  it('a vocabulary the server refuses (400) does not stop the learned words', async () => {
    phone.vocabulary = ['Github'];
    phone.lexicon = [entry('p1', 'Claude')];
    const put = cloud.request.bind(cloud);
    cloud.request = async (method, token, body) =>
      method === 'PUT' && (body as { vocabulary?: unknown })?.vocabulary !== undefined ? { status: 400, json: { error: 'vocabulary[0] is longer than 200 characters' } } : put(method, token, body);
    const result = await phone.sync();
    expect(result).toMatchObject({ ok: true, skipped: 'vocabulary', wrote: { vocabulary: false, lexicon: true } });
    expect(Object.keys(cloud.lexicon)).toEqual(['p1']);
  });

  it('a refused sign-in on the vocabulary is still a sign-in problem, not a skipped list', async () => {
    phone.vocabulary = ['Github'];
    const put = cloud.request.bind(cloud);
    cloud.request = async (method, token, body) => (method === 'PUT' ? { status: 401, json: { error: 'Invalid or expired token' } } : put(method, token, body));
    expect(await phone.sync()).toMatchObject({ ok: false, reason: 'signed-out' });
  });
});

describe('reading the cloud’s answer', () => {
  it('fills what the database left empty, and refuses an answer in another shape', () => {
    const lists = parseCloudLists({
      vocabulary: { terms: ['Github', 5, ' '], updatedAt: null },
      lexicon: [{ id: 'a', term: 'Claude', heardAs: ['cloud', 7], count: null, enabled: null, pinned: null, source: 'fix', createdAt: null, lastSeen: null, syncedAt: 'x' }, { id: 'b' }, null],
    });
    expect(lists?.vocabulary).toEqual(['Github']);
    expect(lists?.lexicon).toHaveLength(1);
    expect(lists?.lexicon[0]).toMatchObject({ heardAs: ['cloud'], count: 1, enabled: true, pinned: false, source: 'correction' });
    expect(parseCloudLists({ nope: true })).toBeNull();
    expect(parseCloudLists(null)).toBeNull();
  });
});
