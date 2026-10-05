import { chatJson } from './ai';
import {
  meetingLanguage,
  parseMindMap,
  parseOutline,
  splitLines,
  transcriptText,
  type MindMap,
  type Outline,
  type QaTurn,
  type TranscriptLine,
} from './meeting';

// Prompts follow Wispra on the computer (spetotext/src/main/outline.ts, mindMap.ts,
// postprocess.ts), so a meeting gets the same kind of notes on both. Posts: meeting-content.ts.

const TRANSCRIPT_FORMAT =
  'The transcript is given as one tagged line per paragraph: "[ref] (m:ss) text" — ref is that paragraph\'s reference number.';
const JSON_ONLY = 'Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:';
const ANTI_FABRICATION_RULE =
  '- Base everything only on what is actually said in the transcript. NEVER invent facts, numbers, statistics, quotes, or claims that are not present in it — if the transcript lacks specifics, stay general rather than making something up.';
const SAME_LANGUAGE = '- Write everything in the SAME language as the transcript. Names of people, products and companies stay as they are said.';
// As on the computer (postprocess.ts MEETING_TITLE_PROMPT): headings follow the body's language
const HEADINGS_RULE =
  '- Every heading you write must be in the same language as the rest of the summary — translate "## " labels into that language too, never leave a heading in English while the body around it is in another language.';

// The language rule for a transcript (T-0164): when the meeting is in Vietnamese the prompts name
// it, as the computer does when a language is chosen, so headings, topics and tasks are written in
// Vietnamese even where the speakers use English words
export function withLanguage(prompt: string, language: string | null): string {
  if (!language) return prompt;
  return prompt
    .split(SAME_LANGUAGE)
    .join(
      `- Write everything in ${language}, even where the transcript uses words of another language — translate, never copy headings, topic titles, tasks or labels in English. Names of people, products and companies stay as they are said.`,
    );
}

function languageOf(lines: TranscriptLine[]): string | null {
  return meetingLanguage(lines.map((l) => l.text).join(' '));
}

const ACTION_RULES = `- "actions": tasks someone is to do after the recording — things that were assigned, promised or agreed to be done. "text" says the task in one short line that starts with a verb. "ref" is the ref of the paragraph where the task is stated. "owner" and "due" only when the transcript says who / by when; otherwise leave those keys out. List each task once. If there are no tasks, return an empty array: never turn ordinary discussion, opinions or decisions into tasks.
- Use only refs that appear in the transcript.`;

const OUTLINE_PROMPT = `You are a professional note-taker writing the minutes of a meeting or voice memo from its transcript. ${TRANSCRIPT_FORMAT}

${JSON_ONLY}
{"title": "...", "summary": "...", "topics": [{"title": "...", "start": 1}], "actions": [{"text": "...", "owner": "...", "due": "...", "ref": 9}]}

- "title": what the meeting was actually about, in 3-6 specific words. No date or time.
- "summary": meeting minutes whose length matches how much was covered: one opening paragraph (2-4 sentences) on what was discussed; then, for a longer meeting, one section per topic, each a heading line starting with "## " followed by "- " bullet points with the real substance (names, numbers, decisions); then a closing paragraph on outcomes and next steps if there were any. A short memo gets a short summary.
${HEADINGS_RULE}
- "topics": the sections of the transcript in order; each begins at the paragraph whose ref is "start". Begin a new topic only where the subject really changes. "title" is 2-7 specific words.
${ACTION_RULES}
${ANTI_FABRICATION_RULE}
${SAME_LANGUAGE}`;

const PART_PROMPT = `You are writing notes on ONE PART of a long meeting recording; the parts are joined afterwards. ${TRANSCRIPT_FORMAT}

${JSON_ONLY}
{"summary": "...", "topics": [{"title": "...", "start": 1}], "actions": [{"text": "...", "owner": "...", "due": "...", "ref": 9}]}

- "summary": the substance of this part as "## " topic headings with "- " bullet points (names, numbers, decisions).
${HEADINGS_RULE}
- "topics": the sections of this part in order (usually 1-4); each begins at the paragraph whose ref is "start". "title" is 2-7 specific words.
${ACTION_RULES}
${ANTI_FABRICATION_RULE}
${SAME_LANGUAGE}`;

const JOIN_PROMPT = `You are given the notes of a long meeting, written part by part. Write the title and the opening of the minutes.

${JSON_ONLY}
{"title": "...", "intro": "..."}

- "title": what the meeting was about overall, in 3-6 specific words. No date or time.
- "intro": one paragraph (2-4 sentences) on what the meeting covered overall.
${ANTI_FABRICATION_RULE}
${SAME_LANGUAGE}`;

const LIVE_PROMPT = `You follow a meeting WHILE it is being recorded. You are given the latest stretch of the transcript and the title of the topic named just before it. ${TRANSCRIPT_FORMAT}

${JSON_ONLY}
{"continues": false, "topics": [{"title": "...", "start": 1}], "actions": [{"text": "...", "owner": "...", "due": "...", "ref": 9}]}

- "topics": the sections of this stretch in order; each begins at the paragraph whose ref is "start". The last one may be unfinished: give it as it stands. "title" is 2-7 specific words.
- "continues": true when the first topic is the same subject as the PREVIOUS TOPIC; false otherwise or when there is none.
${ACTION_RULES}
${ANTI_FABRICATION_RULE}
${SAME_LANGUAGE}`;

const MIND_MAP_PROMPT = `You turn a meeting/voice-memo transcript into a mind map that shows the whole recording at a glance. ${TRANSCRIPT_FORMAT}

${JSON_ONLY}
{"title": "...", "note": "...", "topics": [{"label": "...", "note": "...", "points": [{"label": "...", "note": "...", "points": [{"label": "..."}]}]}], "decisions": [{"label": "...", "note": "..."}], "actions": [{"label": "...", "note": "...", "owner": "...", "due": "..."}], "questions": [{"label": "...", "note": "..."}], "branchLabels": {"decisions": "...", "actions": "...", "questions": "..."}}

- "title": the centre of the map, 2-6 words. "note": one or two sentences on what the recording covers.
- "topics": the main subjects in the order discussed (usually 3-7; one or two for a short memo). "points": 2-6 key points under a topic; a point may have its own "points" (at most 4) only when there is real detail.
- Every "label" is 2-6 words and carries the fact when there is one ("Revenue up 18%", not "Revenue"). Every "note" is one or two sentences with the concrete detail.
- "decisions": what was actually decided. "actions": tasks for afterwards, "owner"/"due" only when stated. "questions": raised and left unanswered. Use empty arrays when there are none; never turn ordinary discussion into a decision or a task.
- "branchLabels": "Decisions", "Action items", "Open questions" in the language of the map.
${ANTI_FABRICATION_RULE}
${SAME_LANGUAGE}`;

const ASK_PROMPT = `You answer questions about a meeting/voice-memo transcript. ${TRANSCRIPT_FORMAT}

${JSON_ONLY}
{"answer": "..."}

- "answer": a direct, specific answer based ONLY on what the transcript says. If the transcript does not cover it, say so plainly instead of guessing.
- Answer in the SAME language the question was asked in, regardless of the transcript's language.
- Keep it conversational and concise: a few sentences, not a report. Mention the time (m:ss) when it helps to find the place.`;

// Characters of transcript per call. gpt-oss-120b has a large context; this leaves room for its
// hidden reasoning and the answer.
const SINGLE_PASS_CHARS = 60_000;
const PART_CHARS = 40_000;
const ASK_CHARS = 80_000;

export async function makeOutline(lines: TranscriptLine[]): Promise<Outline> {
  if (lines.length === 0) return { topics: [], actions: [] };
  const text = transcriptText(lines);
  const language = languageOf(lines);
  if (text.length <= SINGLE_PASS_CHARS) {
    const outline = parseOutline(await chatJson(withLanguage(OUTLINE_PROMPT, language), text, 6000), lines);
    if (!outline) throw new Error('The meeting notes came back incomplete. Try again.');
    return outline;
  }
  // A long meeting: notes part by part, then one small call for the title and the opening
  const parts: Outline[] = [];
  for (const part of splitLines(lines, PART_CHARS)) {
    const outline = parseOutline(await chatJson(withLanguage(PART_PROMPT, language), transcriptText(part), 4000), part);
    if (outline) parts.push(outline);
  }
  const body = parts.map((p) => p.summary ?? '').filter(Boolean).join('\n\n');
  const joined = (await chatJson(withLanguage(JOIN_PROMPT, language), body.slice(0, SINGLE_PASS_CHARS), 1500)) as { title?: unknown; intro?: unknown };
  const intro = typeof joined.intro === 'string' ? joined.intro.trim() : '';
  return {
    title: typeof joined.title === 'string' ? joined.title.trim() : undefined,
    summary: [intro, body].filter(Boolean).join('\n\n'),
    topics: parts.flatMap((p) => p.topics),
    actions: parts.flatMap((p) => p.actions),
  };
}

export async function makeLiveOutline(
  stretch: TranscriptLine[],
  previousTopic: string | undefined,
): Promise<{ outline: Outline; continues: boolean }> {
  const user = `PREVIOUS TOPIC: ${previousTopic ?? '(none)'}\n\n${transcriptText(stretch)}`;
  const value = (await chatJson(withLanguage(LIVE_PROMPT, languageOf(stretch)), user, 2500)) as { continues?: unknown };
  const outline = parseOutline(value, stretch) ?? { topics: [], actions: [] };
  return { outline, continues: value?.continues === true };
}

export async function makeMindMap(lines: TranscriptLine[]): Promise<MindMap> {
  const text = transcriptText(lines);
  const map = parseMindMap(await chatJson(withLanguage(MIND_MAP_PROMPT, languageOf(lines)), text.slice(0, SINGLE_PASS_CHARS), 6000));
  if (!map) throw new Error('The mind map came back incomplete. Try again.');
  return map;
}

export async function askMeeting(lines: TranscriptLine[], history: QaTurn[], question: string): Promise<string> {
  const text = transcriptText(lines);
  // Very long meetings: keep the start and the end, as the computer does
  const transcript = text.length > ASK_CHARS ? `${text.slice(0, ASK_CHARS / 2)}\n[…]\n${text.slice(-ASK_CHARS / 2)}` : text;
  const earlier = history
    .slice(-4)
    .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
    .join('\n\n');
  const user = `TRANSCRIPT:\n${transcript}\n\n${earlier ? `EARLIER QUESTIONS:\n${earlier}\n\n` : ''}QUESTION: ${question}`;
  const value = (await chatJson(ASK_PROMPT, user, 2000)) as { answer?: unknown };
  if (typeof value.answer !== 'string' || !value.answer.trim()) throw new Error('No answer came back. Try again.');
  return value.answer.trim();
}
