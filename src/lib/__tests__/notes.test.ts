// Notes (T-0979): what a note is, how it travels to Wispra Cloud and back, and that it follows the
// same rules as the history for accounts and deletion.
import { describe, expect, it } from '@jest/globals';

import { mergeIntoNewAccount, phoneData, leaveForNewAccount, choiceText } from '../account-switch';
import { createEntry, defaultNoteTitle, parseEntries, previewText, serializeEntries, type Entry } from '../entries';
import {
  applyRemoteDeletes,
  deleteAllWarning,
  deleteOneWarning,
  emptyPendingDeletes,
  isInCloud,
  queueDelete,
} from '../history-delete';
import { planSync, type HistoryEntry } from '../history-sync';
import { nextJob } from '../transcribe-queue';
import {
  changedSinceShared,
  copyText,
  formatNoteDate,
  isNoteShareable,
  mapAsText,
  mapFallbackText,
  mapProblem,
  NOTE_APP,
  noteFromHistoryEntry,
  noteStamp,
  parseBasics,
  parseExpertText,
  planNoteSync,
  shownArticle,
  statusLabel,
  toNoteHistoryEntry,
  type NoteData,
} from '../notes';

const SAID = 'Tôi muốn làm nền tảng cho người địa phương tự đăng tour và tự dẫn khách.';
const MAP = {
  title: 'Nền tảng tour',
  topics: [{ label: 'Khoảng trống', points: [{ label: 'Cao Bằng' }] }, { label: 'Rủi ro' }],
  decisions: [],
  actions: [{ label: 'Hỏi luật sư' }],
  questions: [],
  branchLabels: { decisions: 'Quyết định', actions: 'Việc cần làm', questions: 'Câu hỏi mở' },
};

function note(over: Partial<Entry> = {}, data: Partial<NoteData> = {}): Entry {
  return {
    ...createEntry('note', new Date(2026, 9, 25, 14, 32), 'mobile-n1'),
    status: 'done',
    text: SAID,
    durationMs: 21_500,
    note: { status: 'new', ...data },
    ...over,
  };
}

describe('a note', () => {
  it('starts as a recording with the placeholder title and the status New', () => {
    const e = createEntry('note', new Date(2026, 9, 25, 14, 32), 'mobile-x');
    expect(e.kind).toBe('note');
    expect(e.title).toBe('Note 14:32');
    expect(e.title).toBe(defaultNoteTitle(new Date(2026, 9, 25, 14, 32)));
    expect(e.status).toBe('recording');
    expect(e.note).toEqual({ status: 'new' });
  });

  it('is saved and read back with everything on it, and one without a note field gets the status New', () => {
    const e = note({}, { domain: 'Du lịch', role: 'a travel expert', outline: '## Ý chính\n- x', articles: ['a'], mindMap: MAP });
    const back = parseEntries(serializeEntries([e]))[0];
    expect(back.note).toEqual(e.note);
    expect(back.kind).toBe('note');
    const bare = parseEntries(JSON.stringify({ entries: [{ id: 'a', kind: 'note', createdAt: '2026-10-25T07:32:00.000Z', status: 'done' }] }))[0];
    expect(bare.note).toEqual({ status: 'new' });
    expect(bare.title).toBe('Note');
  });

  it('shows its words in the list, like a dictation', () => {
    expect(previewText(note())).toBe(SAID);
  });

  it('writes the day and the moment like the rest of the app', () => {
    expect(formatNoteDate(new Date(2026, 9, 25, 14, 32).toISOString())).toBe('25 Oct 2026 · 14:32');
    expect(formatNoteDate(new Date(2026, 9, 24, 8, 5).toISOString())).toBe('24 Oct 2026 · 08:05');
  });

  it('has four statuses to choose and the short names of the list', () => {
    expect(statusLabel('new')).toBe('New');
    expect(statusLabel('develop')).toBe('Develop into a product');
    expect(statusLabel('develop', true)).toBe('Develop');
    expect(statusLabel('remind')).toBe('Remind me in 3 days');
  });
});

describe('Copy copies what is on show', () => {
  const e = note({}, { outline: 'Outline một', articles: ['Bài một', 'Bài hai'], mindMap: MAP });

  it('the words as they were said', () => {
    expect(copyText(e, 'verbatim', 'outline', -1)).toBe(SAID);
  });

  it('the outline or the article version being viewed', () => {
    expect(copyText(e, 'expert', 'outline', 0)).toBe('Outline một');
    expect(copyText(e, 'expert', 'article', 0)).toBe('Bài một');
    expect(copyText(e, 'expert', 'article', 1)).toBe('Bài hai');
    expect(copyText(e, 'expert', 'article', 9)).toBe('Bài hai');
    expect(shownArticle(e.note, -1)).toBe('Bài một');
  });

  it('an empty string when there is nothing yet', () => {
    expect(copyText(note(), 'expert', 'article', 0)).toBe('');
    expect(copyText(note(), 'map', 'outline', 0)).toBe('');
  });

  it('the map as an indented list', () => {
    expect(mapAsText(MAP as never)).toBe(
      ['Nền tảng tour', '- Khoảng trống', '  - Cao Bằng', '- Rủi ro', 'Việc cần làm', '  - Hỏi luật sư'].join('\n'),
    );
  });
});

describe('the AI’s answers are checked before they are kept', () => {
  it('needs a title, a field and an expert', () => {
    expect(parseBasics({ title: ' Nền tảng tour ', domain: 'Du lịch', role: 'chuyên gia du lịch' })).toEqual({
      title: 'Nền tảng tour',
      domain: 'Du lịch',
      role: 'chuyên gia du lịch',
    });
    expect(parseBasics({ title: 'x', domain: '', role: 'r' })).toBeNull();
    expect(parseBasics('nope')).toBeNull();
  });

  it('reads the outline and the article, turning written-out line breaks into line breaks', () => {
    expect(parseExpertText({ outline: '## A\\n- b' }, 'outline')).toBe('## A\n- b');
    expect(parseExpertText({ outline: '  ' }, 'outline')).toBeNull();
    expect(parseExpertText({ article: 'Tiêu đề' }, 'outline')).toBeNull();
    expect(parseExpertText(null, 'article')).toBeNull();
  });

  it('says why a map cannot be drawn', () => {
    expect(mapProblem(MAP)).toBeNull();
    expect(mapProblem(null)).toMatch(/not a JSON object/);
    expect(mapProblem({ topics: [{ label: 'a' }] })).toMatch(/title/);
    expect(mapProblem({ title: 't', topics: [] })).toMatch(/topics/);
    expect(mapProblem({ title: 't', topics: [{ note: 'no label' }] })).toMatch(/label/);
  });

  it('keeps the labels of a map that cannot be drawn as text, and falls back to the words', () => {
    const broken = { title: 'T', topics: [{ label: 'Một', points: [{ label: 'Hai' }] }, { title: 'Ba' }] };
    expect(mapFallbackText(broken, SAID)).toBe(['- T', '  - Một', '    - Hai', '  - Ba'].join('\n'));
    expect(mapFallbackText({ nothing: true }, SAID)).toBe(SAID);
  });
});

describe('how a note travels to Wispra Cloud', () => {
  const full = note(
    { title: 'Nền tảng tour' },
    { domain: 'Du lịch', role: 'a travel expert', outline: '## Ý chính\n- x', articles: ['Bài'], mindMap: MAP, status: 'develop', updatedAt: '2026-10-25T08:00:00.000Z' },
  );

  it('is a row of the shared history: a mobile- id, the words as text, the field as topic, the rest as JSON', () => {
    const row = toNoteHistoryEntry(full);
    expect(row.id).toBe('mobile-n1');
    expect(row.app).toBe(NOTE_APP);
    expect(row.text).toBe(SAID);
    expect(row.topic).toBe('Du lịch');
    expect(row.createdAt).toBe(full.createdAt);
    expect(row.durationSeconds).toBe(21.5);
    expect(JSON.parse(row.rawText!)).toMatchObject({ wispraNote: 1, title: 'Nền tảng tour', status: 'develop', domain: 'Du lịch', outline: '## Ý chính\n- x' });
  });

  it('comes back as the same note on another phone, already shared', () => {
    const back = noteFromHistoryEntry(toNoteHistoryEntry(full), '2026-10-25T09:00:00.000Z')!;
    expect(back).toMatchObject({ id: 'mobile-n1', kind: 'note', title: 'Nền tảng tour', text: SAID, status: 'done', audioUri: null, syncedAt: '2026-10-25T09:00:00.000Z' });
    expect(back.note).toMatchObject({ status: 'develop', domain: 'Du lịch', role: 'a travel expert', outline: '## Ý chính\n- x', articles: ['Bài'], updatedAt: '2026-10-25T08:00:00.000Z' });
    expect(back.note?.mindMap?.title).toBe('Nền tảng tour');
  });

  it('keeps the words whole when the rest is too long for a row: the map goes first, then the articles', () => {
    const big = note({}, { outline: 'o', articles: ['a'.repeat(60_000)], mindMap: MAP, mapText: 'm'.repeat(40_000) });
    const row = toNoteHistoryEntry(big);
    const payload = JSON.parse(row.rawText!);
    expect(row.text).toBe(SAID);
    expect(row.rawText!.length).toBeLessThanOrEqual(100_000);
    expect(payload.mindMap).toBeUndefined();
    expect(payload.mapText).toBeUndefined();
    expect(payload.articles).toHaveLength(1);
    const huge = toNoteHistoryEntry(note({}, { outline: 'o'.repeat(95_000) }));
    expect(JSON.parse(huge.rawText!).outline).toBeUndefined();
  });

  it('is not taken from a row that is not a note, or is not whole', () => {
    const row = toNoteHistoryEntry(full);
    const read = (h: HistoryEntry) => noteFromHistoryEntry(h, 'now');
    expect(read({ ...row, app: 'Notes' })).toBeNull();
    expect(read({ ...row, id: 'desktop-1' })).toBeNull();
    expect(read({ ...row, rawText: null })).toBeNull();
    expect(read({ ...row, rawText: '{not json' })).toBeNull();
    expect(read({ ...row, rawText: JSON.stringify({ wispraNote: 2 }) })).toBeNull();
    expect(read({ ...row, text: '  ' })).toBeNull();
  });

  it('does not trust the shape of what it reads: odd values are dropped, not kept', () => {
    const row = toNoteHistoryEntry(full);
    const odd = { ...row, rawText: JSON.stringify({ wispraNote: 1, status: 'hacked', articles: [1, 'ok', ''], mindMap: { title: 1 }, outline: 5 }) };
    const back = noteFromHistoryEntry(odd, 'now')!;
    expect(back.note).toMatchObject({ status: 'new', articles: ['ok'] });
    expect(back.note?.mindMap).toBeUndefined();
    expect(back.note?.outline).toBeUndefined();
  });

  it('is shared only once its words are written', () => {
    expect(isNoteShareable(note())).toBe(true);
    expect(isNoteShareable(note({ status: 'pending', text: null }))).toBe(false);
    expect(isNoteShareable(note({ text: '  ' }))).toBe(false);
    expect(isNoteShareable({ ...note(), kind: 'dictation' })).toBe(false);
  });
});

describe('what is shared after reading the cloud history', () => {
  const NOW = '2026-10-25T10:00:00.000Z';
  const skip = new Set<string>();

  it('pushes a note that was never shared, and one changed after it was shared', () => {
    const fresh = note({ id: 'mobile-a' });
    const shared = note({ id: 'mobile-b', syncedAt: '2026-10-25T09:00:00.000Z' }, { updatedAt: '2026-10-25T08:00:00.000Z' });
    const edited = note({ id: 'mobile-c', syncedAt: '2026-10-25T09:00:00.000Z' }, { updatedAt: '2026-10-25T09:30:00.000Z' });
    const inCloud = [shared, edited].map(toNoteHistoryEntry);
    const plan = planNoteSync([fresh, shared, edited], inCloud, skip, true, NOW);
    expect(plan.push.map((e) => e.id)).toEqual(['mobile-a', 'mobile-c']);
    expect(changedSinceShared(edited)).toBe(true);
    expect(changedSinceShared(shared)).toBe(false);
  });

  it('counts a change made in the very millisecond of the share as a change (sending twice is harmless, missing one is not)', () => {
    const same = '2026-10-25T09:00:00.000Z';
    const e = note({ id: 'mobile-a', syncedAt: same }, { updatedAt: same });
    expect(changedSinceShared(e)).toBe(true);
    expect(planNoteSync([e], [toNoteHistoryEntry(e)], skip, true, NOW).push).toHaveLength(1);
    expect(changedSinceShared({ ...e, syncedAt: '2026-10-25T09:00:00.001Z' })).toBe(false);
  });

  it('pushes a shared note the cloud lost (another device deleted everything and it came back), but only within the page read', () => {
    const lost = note({ id: 'mobile-a', syncedAt: '2026-10-24T09:00:00.000Z', createdAt: '2026-10-24T08:00:00.000Z' });
    const olderThanPage = note({ id: 'mobile-b', syncedAt: '2026-10-01T09:00:00.000Z', createdAt: '2026-10-01T08:00:00.000Z' });
    const page: HistoryEntry[] = [{ id: 'pc-1', text: 'x', createdAt: '2026-10-20T00:00:00.000Z' }];
    expect(planNoteSync([lost, olderThanPage], page, skip, false, NOW).push.map((e) => e.id)).toEqual(['mobile-a']);
    expect(planNoteSync([lost, olderThanPage], page, skip, true, NOW).push.map((e) => e.id)).toEqual(['mobile-a', 'mobile-b']);
  });

  it('brings in a note made on another phone of the account, unless it was deleted here', () => {
    const theirs = note({ id: 'mobile-z', title: 'Từ máy khác' });
    const rows = [toNoteHistoryEntry(theirs)];
    expect(planNoteSync([], rows, skip, true, NOW).upserts.map((e) => e.id)).toEqual(['mobile-z']);
    expect(planNoteSync([], rows, new Set(['mobile-z']), true, NOW).upserts).toEqual([]);
  });

  it('takes the cloud’s newer copy of a note only when this phone has no change of its own waiting', () => {
    const mine = note({ id: 'mobile-a', syncedAt: '2026-10-25T09:00:00.000Z' }, { updatedAt: '2026-10-25T08:00:00.000Z', status: 'new' });
    const theirsNewer = toNoteHistoryEntry(note({ id: 'mobile-a' }, { updatedAt: '2026-10-25T09:30:00.000Z', status: 'keep' }));
    const taken = planNoteSync([mine], [theirsNewer], skip, true, NOW).upserts;
    expect(taken).toHaveLength(1);
    expect(taken[0].note?.status).toBe('keep');
    // This phone changed it after sharing: its change wins and is pushed
    const dirty = { ...mine, note: { ...mine.note!, updatedAt: '2026-10-25T09:45:00.000Z' } };
    const plan = planNoteSync([dirty], [theirsNewer], skip, true, NOW);
    expect(plan.upserts).toEqual([]);
    expect(plan.push.map((e) => e.id)).toEqual(['mobile-a']);
    // Same time on both sides: nothing to do
    const same = toNoteHistoryEntry(mine);
    expect(planNoteSync([mine], [same], skip, true, NOW)).toEqual({ upserts: [], push: [] });
  });

  it('never touches dictations: the history’s own plan ignores notes, and the note plan ignores dictations', () => {
    const n = note({ id: 'mobile-a' });
    const rows = [toNoteHistoryEntry(n)];
    const dictation: Entry = { ...createEntry('dictation', new Date(2026, 9, 25), 'mobile-d'), status: 'done', text: 'xin chào' };
    const history = planSync([n, dictation], rows, new Set(), true);
    expect(history.upserts).toEqual([]);
    expect(history.push.map((e) => e.id)).toEqual(['mobile-d']);
    const notes = planNoteSync([n, dictation], [{ id: 'mobile-d', text: 'xin chào', createdAt: dictation.createdAt, app: 'Wispra (phone)' }], skip, true, NOW);
    expect(notes.push.map((e) => e.id)).toEqual(['mobile-a']);
    expect(notes.upserts).toEqual([]);
  });

  it('stamps a note with its last change, or the moment it was said', () => {
    expect(noteStamp(note())).toBe(note().createdAt);
    expect(noteStamp(note({}, { updatedAt: '2026-10-26T00:00:00.000Z' }))).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('accounts and deleting follow the history’s rules', () => {
  it('a note shared with the cloud is in the cloud, and is deleted on every device by its id', () => {
    const shared = note({ id: 'mobile-a', syncedAt: '2026-10-25T09:00:00.000Z' });
    const unshared = note({ id: 'mobile-b' });
    expect(isInCloud(shared)).toBe(true);
    expect(isInCloud(unshared)).toBe(false);
    expect(queueDelete(emptyPendingDeletes('u1'), [shared, unshared]).ids).toEqual(['mobile-a']);
  });

  it('a note another device deleted leaves this phone; a meeting and an unrelated note stay', () => {
    const a = note({ id: 'mobile-a', syncedAt: 'x' });
    const b = note({ id: 'mobile-b', syncedAt: 'x' });
    const { keep, removed } = applyRemoteDeletes([a, b], ['mobile-a']);
    expect(removed.map((e) => e.id)).toEqual(['mobile-a']);
    expect(keep.map((e) => e.id)).toEqual(['mobile-b']);
  });

  it('the warning before deleting says where a note goes', () => {
    expect(deleteOneWarning(note({ syncedAt: 'x' }), true).title).toBe('Delete this note everywhere?');
    expect(deleteOneWarning(note(), true).confirm).toBe('Delete from this phone');
    expect(deleteOneWarning(note(), false).message).toContain('You are not signed in');
    expect(deleteAllWarning([note(), note({ id: 'mobile-2' })], true).message).toContain('0 dictations, 0 meetings and 2 notes');
  });

  it('a note counts in the question asked when another account signs in, and is lost if the new account is used alone', () => {
    const shared = note({ id: 'mobile-a', syncedAt: '2026-10-25T09:00:00.000Z' });
    const unshared = note({ id: 'mobile-b' });
    const data = phoneData([shared, unshared]);
    expect(data).toEqual({ dictations: 0, meetings: 0, notes: 2, onlyHere: 1 });
    expect(choiceText({ userId: 'a', email: 'anna@example.com' }, { userId: 'b', email: 'ben@example.com' } as never, data).intro).toContain('0 dictations, 0 meetings and 2 notes');
    expect(leaveForNewAccount([shared, unshared]).removed).toHaveLength(2);
  });

  it('merging into the new account shares the notes again with that account', () => {
    const shared = note({ id: 'mobile-a', syncedAt: '2026-10-25T09:00:00.000Z' });
    const [merged] = mergeIntoNewAccount([shared]);
    expect(merged.syncedAt).toBeUndefined();
    expect(merged.note).toEqual(shared.note);
  });
});

describe('the queue gives a note its title, field and outline once the words have arrived', () => {
  const rules = { readyToFinish: () => false, wantsNotes: () => false, needsSplit: () => false };

  it('a recorded note waits to be transcribed first, then asks for the AI', () => {
    const pending = note({ status: 'pending', text: null });
    expect(nextJob([pending], new Set(), rules)).toEqual({ kind: 'transcribe-entry', entry: pending });
    const done = note();
    expect(nextJob([done], new Set(), { ...rules, wantsNoteAi: (e) => e.kind === 'note' })).toEqual({ kind: 'note-ai', entry: done });
    // A job that waits for a passing reason is skipped for the rest of the run
    expect(nextJob([done], new Set([`${done.id}:note-ai`]), { ...rules, wantsNoteAi: () => true })).toBeNull();
    // Rules written before notes existed still work
    expect(nextJob([done], new Set(), rules)).toBeNull();
  });
});
