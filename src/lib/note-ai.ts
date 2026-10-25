import { AiError, chatJson, type AiMeter } from './ai';
import { MIND_MAP_PROMPT, SINGLE_PASS_CHARS, withLanguage } from './meeting-ai';
import { meetingLanguage, parseMindMap, type MindMap } from './meeting';
import { mapFallbackText, mapProblem, parseBasics, parseExpertText, type NoteBasics } from './notes';

// The AI work of a note (T-0979). It goes through Wispra Cloud's AI like the meeting notes (ai.ts):
// the words of the note are sent there to be rewritten, and counted in the account's monthly AI
// allowance. The words said are never replaced by what comes back.

// Characters of a note sent in one call; a note is a spoken idea, so this is far above a normal one
export const NOTE_CHARS = 20_000;

// Room for the model's hidden reasoning before the answer, as for the meeting notes
export const NOTE_MAX_TOKENS = { basics: 1200, outline: 3000, article: 4000, map: 6000, repair: 6000 };

// The repairs of a map the AI wrote wrongly: one answer first, then at most this many fixes
export const MAP_REPAIRS = 2;

function sameLanguage(text: string): string {
  const language = meetingLanguage(text);
  return language
    ? `- Write everything in ${language}, even where the note uses words of another language. Names of people, products and companies stay as they are said.`
    : '- Write everything in the SAME language as the note. Names of people, products and companies stay as they are said.';
}

const JSON_ONLY = 'Respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:';
const NOTE_FORMAT = 'The note is the text of an idea somebody said aloud, as it was transcribed.';
const ANTI_FABRICATION =
  '- Base the note\'s own content only on what is actually said. NEVER invent facts, numbers, names, quotes or claims about the person\'s situation. If it lacks specifics, stay general.';

function basicsPrompt(text: string): string {
  return `You name and classify a short voice note. ${NOTE_FORMAT}

${JSON_ONLY}
{"title": "...", "domain": "...", "role": "..."}

- "title": what the note is about, in 3-7 specific words. No date or time. No quotation marks.
- "domain": the field it belongs to, one to three words (for example "Travel", "Marketing", "Cars", "Software"), as a short label.
- "role": the kind of expert who would best develop this idea, as one short phrase of at most 12 words (for example "a travel-market development expert").
${sameLanguage(text)}`;
}

function outlinePrompt(text: string, role: string): string {
  return `You are ${role}. You turn a voice note into a clear outline an expert would write. ${NOTE_FORMAT}

${JSON_ONLY}
{"outline": "..."}

- "outline": plain text laid out as three sections. Each section is a heading line starting with "## " followed by "- " bullet points: first the main idea (only what the person said, in your clearer words), then the gaps, risks and open questions an expert in this field would raise, then the three best first steps. A short note gets a short outline.
- The headings are written in the same language as the bullets under them.
- Your expert judgement belongs in the second and third sections; the first stays true to the note.
${ANTI_FABRICATION}
${sameLanguage(text)}`;
}

function articlePrompt(text: string, role: string): string {
  return `You are ${role}. You develop a voice note into a short article or brief that the person could use. ${NOTE_FORMAT}

${JSON_ONLY}
{"article": "..."}

- "article": plain text (rendered as it is, not markdown): a one-line title, then short paragraphs, with a heading line starting with "## " before each part when it has more than three parts. Its length follows the note: about 150-300 words for a short note, up to about 600 for a long one. Never pad it with repetition or filler.
- Use your expertise to organise and clarify the idea and to say what it needs, but do not state invented facts, figures or sources as if the person had said them.
- Never use generic AI-sounding filler ("in today's fast-paced world", "unlock the power of", "dive into", "in conclusion").
${sameLanguage(text)}`;
}

function mapPrompt(role: string): string {
  // The prompt is the meeting mind map's, so both maps are alike; the expert reads the note
  return `${MIND_MAP_PROMPT}\n- You are ${role}: choose the branches an expert in this field would draw.`;
}

function repairPrompt(problem: string): string {
  return `You repair a mind map written as JSON that cannot be drawn: ${problem}.

${JSON_ONLY}
{"title": "...", "note": "...", "topics": [{"label": "...", "note": "...", "points": [{"label": "..."}]}], "decisions": [], "actions": [], "questions": [], "branchLabels": {"decisions": "...", "actions": "...", "questions": "..."}}

- Keep the content of the map you are given; fix the shape. "title" is the centre of the map; "topics" is a non-empty array of items that each have a "label".
- If the given text has no usable map, build one from the NOTE.`;
}

function clip(text: string): string {
  return text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS / 2)}\n[…]\n${text.slice(-NOTE_CHARS / 2)}` : text;
}

export async function makeBasics(text: string, meter?: AiMeter): Promise<NoteBasics> {
  const basics = parseBasics(await chatJson(basicsPrompt(text), clip(text), NOTE_MAX_TOKENS.basics, 0.2, meter));
  if (!basics) throw new Error('The note’s title came back incomplete. Try again.');
  return basics;
}

export async function makeExpertOutline(text: string, role: string, meter?: AiMeter): Promise<string> {
  const outline = parseExpertText(await chatJson(outlinePrompt(text, role), clip(text), NOTE_MAX_TOKENS.outline, 0.3, meter), 'outline');
  if (!outline) throw new Error('The outline came back empty. Try again.');
  return outline;
}

export async function makeExpertArticle(text: string, role: string, meter?: AiMeter): Promise<string> {
  // The computer writes posts at 0.5; an article is a little freer than the outline
  const article = parseExpertText(await chatJson(articlePrompt(text, role), clip(text), NOTE_MAX_TOKENS.article, 0.5, meter), 'article');
  if (!article) throw new Error('The article came back empty. Try again.');
  return article;
}

export interface NoteMapResult {
  map?: MindMap;
  // The map as text when it stayed invalid after the repairs
  text?: string;
}

/**
 * The mind map of a note. The AI writes it as JSON; Wispra checks that it can be drawn (a title and
 * topics with labels). When it cannot, the AI is asked to fix it, at most MAP_REPAIRS times. When it
 * still cannot be drawn, what it wrote is returned as text, never as an error.
 * An answer that is not JSON at all counts as a failed try too. A connection or allowance problem
 * (AiError) is not a bad map and passes through.
 */
export async function makeNoteMap(
  text: string,
  role: string,
  meter?: AiMeter,
  ask: typeof chatJson = chatJson,
): Promise<NoteMapResult> {
  const source = clip(text).slice(0, SINGLE_PASS_CHARS);
  const noteLine = `[1] (0:00) ${source}`;
  let value: unknown = null;
  let problem: string | null = 'nothing was written yet';
  for (let attempt = 0; attempt <= MAP_REPAIRS; attempt++) {
    try {
      value =
        attempt === 0
          ? await ask(withLanguage(mapPrompt(role), meetingLanguage(source)), noteLine, NOTE_MAX_TOKENS.map, 0.2, meter)
          : await ask(repairPrompt(problem ?? 'unknown'), `GIVEN MAP:\n${safeJson(value)}\n\nNOTE:\n${source}`, NOTE_MAX_TOKENS.repair, 0.1, meter);
    } catch (err) {
      if (!isUnexpectedForm(err)) throw err;
      // Not JSON at all: counts as a try, and the next one asks again
      problem = 'the answer was not JSON';
      continue;
    }
    problem = mapProblem(value);
    if (!problem) return { map: parseMindMap(value) ?? undefined };
  }
  return { text: mapFallbackText(value, text) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null).slice(0, 20_000);
  } catch {
    return 'null';
  }
}

// ai.ts marks an answer that has no JSON in it
function isUnexpectedForm(err: unknown): boolean {
  return err instanceof AiError && err.badForm;
}
