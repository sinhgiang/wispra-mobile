import { useEffect, useRef } from 'react';

import type { Entry } from './entries';
import { useEntries } from './entries-store';
import { mergeLiveOutline, transcriptLines } from './meeting';
import { makeLiveOutline } from './meeting-ai';
import { transcriptionAvailable } from './transcriber';

// New paragraphs (pieces of about half a minute) before the live topics and actions are updated
const LIVE_EVERY = 3;

/**
 * While a meeting records, finds its topics and action items every minute and a half or so, from
 * the part of the transcript that is ready. Only the unbroken start of the transcript is used,
 * so the paragraph numbers the AI sees never shift when an earlier piece is still being
 * transcribed. After Stop, the full notes replace these.
 */
export function useLiveNotes(entry: Entry | undefined, recording: boolean) {
  const { updateNotes } = useEntries();
  const working = useRef(false);

  useEffect(() => {
    if (!entry?.segments || !recording || working.current || !transcriptionAvailable()) return;
    const sorted = [...entry.segments].sort((a, b) => a.startMs - b.startMs);
    const firstWaiting = sorted.findIndex((s) => s.status !== 'done');
    const ready = firstWaiting < 0 ? sorted : sorted.slice(0, firstWaiting);
    const lines = transcriptLines(ready);
    const seen = entry.notes?.liveRefs ?? 0;
    if (lines.length - seen < LIVE_EVERY) return;

    working.current = true;
    const id = entry.id;
    const notes = entry.notes ?? {};
    const previousTopic = notes.topics?.[notes.topics.length - 1]?.title;
    makeLiveOutline(lines.slice(seen), previousTopic)
      .then(({ outline, continues }) => updateNotes(id, mergeLiveOutline(notes, outline, lines.length, continues)))
      .catch(() => {
        // Live notes are a help, not a must: the full notes are made after Stop
      })
      .finally(() => {
        working.current = false;
      });
  }, [entry, recording, updateNotes]);
}
