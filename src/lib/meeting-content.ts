// Publish-ready content from a meeting (T-0164), as on the computer (spetotext/src/main/
// postprocess.ts, CONTENT_PROMPTS): a website article, and three versions of a post for Facebook,
// Instagram, LinkedIn and X. Each is written on demand, the first time it is asked for. The prompts
// are the computer's, word for word, so both write the same kind of posts.

import { chatJson } from './ai';
import { meetingLanguage, type TranscriptLine } from './meeting';

export type ContentPlatform = 'website' | 'facebook' | 'instagram' | 'linkedin' | 'twitter';

export interface MeetingContent {
  // website
  title?: string;
  metaDescription?: string;
  body?: string;
  // facebook, instagram, linkedin, twitter: three versions
  posts?: string[];
  generatedAt: string;
}

export const PLATFORMS: { value: ContentPlatform; label: string; create: string; about: string; share: string }[] = [
  { value: 'website', label: 'Website', create: 'Create website article', about: 'An SEO-ready article written from this recording.', share: 'Share article' },
  { value: 'facebook', label: 'Facebook', create: 'Create Facebook post', about: 'Three versions of a Facebook post written from this recording.', share: 'Share post' },
  { value: 'instagram', label: 'Instagram', create: 'Create Instagram caption', about: 'Three versions of an Instagram caption written from this recording.', share: 'Share caption' },
  { value: 'linkedin', label: 'LinkedIn', create: 'Create LinkedIn post', about: 'Three versions of a LinkedIn post written from this recording.', share: 'Share post' },
  { value: 'twitter', label: 'X', create: 'Create X post', about: 'Three versions of an X post (one is a short thread) written from this recording.', share: 'Share post' },
];

const ANTI_FABRICATION_RULE =
  '- Base everything only on what is actually said in the transcript. NEVER invent facts, numbers, statistics, quotes, or claims that are not present in it — if the transcript lacks specifics, stay general rather than making something up.';

const AI_SLOP_RULE = `- Never use generic AI-sounding filler: phrases like "in today's fast-paced world", "in the ever-evolving landscape of", "unlock the power of", "dive into"/"delve into", "it's important to note that", "in conclusion", "whether you're a beginner or an expert", or similar throat-clearing. Write like a specific, confident person — pull concrete details straight from the transcript, vary sentence length, and get to the point.`;

export const CONTENT_PROMPTS: Record<ContentPlatform, string> = {
  website: `You are a content strategist with 10+ years of hands-on SEO experience, writing in 2026 when search results blend classic organic ranking with AI Overviews and answer engines (AEO/GEO) — content earns visibility by directly answering real questions, not by keyword-stuffing. Turn the meeting/voice-memo transcript into a publish-ready blog/website article. Read the whole transcript and respond with ONLY a JSON object (no markdown, no code fences, no explanation) in this exact shape:
{"title": "...", "metaDescription": "...", "body": "..."}

- "title": an SEO title tag, 50-60 characters long, with the main topic/keyword appearing within the first 30-40 characters. Written to earn clicks, not just describe the topic — but never clickbait or exaggerate beyond what the transcript supports.
- "metaDescription": a meta description tag, 150-160 characters, that summarizes the specific value of the article and ends with a soft call to action — it must add information beyond the title, not just restate it, since it is what shows under the title in search results.
- "body": the full article as plain text (rendered as-is, not markdown), laid out like this:
  - A short intro paragraph (2-4 sentences) that hooks the reader with something specific from the transcript (a real detail, tension, or claim — not a generic opener) and states what the article covers. Answer the reader's core question in this intro rather than saving it for the end — 2026 search/AI-overview visibility rewards giving the answer up front, then backing it up.
  - A blank line, then a "## Key takeaways" section: 3-5 "- " bullet points, each a single self-contained sentence that could stand alone as a snippet answer.
  - A blank line, then the body split into further sections. Each section starts with a one-line heading on its own line prefixed with "## " (e.g. "## Why it matters"), followed by a blank line, then 2-4 sentences of paragraph text or a "- " bulleted list. Open each section by directly answering the question its heading implies, then elaborate. Leave a blank line between sections. Weave in related/secondary terms naturally where the transcript supports them — never force or repeat the exact keyword.
  - A blank line, then a "## FAQ" section with 2-4 "- " bullet points, each phrased as "Question? Answer." using only questions the transcript actually gives enough material to answer honestly.
  - A blank line, then a short closing paragraph with a takeaway or call to action.
  - Aim for roughly 1200-2000 words of substantive content when the transcript has enough material to support it (2026 SEO favors in-depth, search-intent-satisfying articles over hitting an exact word count) — but NEVER pad with repetition, filler, or fabricated content just to reach that length. A shorter, complete, accurate article beats a longer padded one.
- Every heading in the article — "Key takeaways", "FAQ", and every other "## " section heading — must be written in the same language as the rest of the article's body text. "Key takeaways", "Why it matters" and "FAQ" above are only English placeholder labels showing the format; translate them (and every heading you write) into that language. Never leave any heading in English while the body around it is in another language.
${ANTI_FABRICATION_RULE}
${AI_SLOP_RULE}
- Write in the SAME language as the transcript.`,

  facebook: `You are one of the top 1% Facebook copywriters — 10+ years writing viral, high-engagement native text posts — turning a meeting/voice-memo transcript into ready-to-post Facebook content. Follow 2026 Facebook mechanics: short personal-style posts under ~80 characters get the highest engagement rate; business posts' sweet spot is 150-250 characters; Facebook truncates behind "See More" around 477 characters on desktop (sooner on mobile), so the hook must land before that cutoff; leading with a question, a bold claim, or a pattern-interrupt line outperforms a slow windup; posts broken into short, scannable lines with blank lines between beats consistently out-engage a dense single paragraph. Read the whole transcript and respond with ONLY a JSON object (no markdown, no explanation):
{"posts": ["...", "...", "..."]}

Write exactly 3 distinct ready-to-post variants (plain post text only — no labels, no explanation, no "Version 1:" prefixes):
1. An ultra-short, punchy post (roughly 40-80 characters) — one sharp line that hooks attention on its own. A single line is correct here; don't pad it with extra lines.
2. A medium business-style post (roughly 150-250 characters) formatted as 2-3 short lines separated by blank lines: a bold hook line, then the key point, then a light call to action on its own line — never one dense paragraph.
3. A longer post (under 400 characters) shaped like a real high-performing Facebook post: a scroll-stopping hook line, a blank line, then 2-3 short lines of context (use a couple of "✅"/"👉"/"🔥"-prefixed lines instead of a paragraph when the content is naturally a list), a blank line, then a call to action or a question inviting comments, on its own line.
${ANTI_FABRICATION_RULE}
${AI_SLOP_RULE}
- Write in the SAME language as the transcript. Emoji are fine if they fit naturally; don't force them.`,

  instagram: `You are one of the top 1% Instagram caption writers — 10+ years turning ideas into scroll-stopping captions — turning a meeting/voice-memo transcript into ready-to-post Instagram captions. Follow 2026 Instagram mechanics: short punchy captions (under ~125 characters, the point where feed captions get cut to "more") tend to win on raw reach; medium storytelling captions (roughly 150-220 words) get the highest comment rates on carousel/educational posts; the key message must land before the "more" cutoff; hashtags should be just 3-5 highly relevant ones placed at the end, not long hashtag strings (the 2026 algorithm favors keywords woven into the caption text itself over hashtags). Read the whole transcript and respond with ONLY a JSON object (no markdown, no explanation):
{"posts": ["...", "...", "..."]}

Write exactly 3 distinct ready-to-post caption variants (plain caption text only — no labels, no explanation). Analyze and write these differently from Facebook — more visual/personal voice, short line breaks, hashtags at the end — not the same copy reused:
1. A short, punchy caption (under ~125 characters) with a strong hook, ending with 3-5 relevant hashtags.
2. A medium storytelling caption (roughly 150-220 words) using short line breaks between thoughts for readability, ending with a call to action then 3-5 relevant hashtags.
3. A quick-tip/list-style caption: a short hook line, then 3-4 short lines of value separated by line breaks (not "-" bullets), ending with a call to action then 3-5 relevant hashtags.
${ANTI_FABRICATION_RULE}
${AI_SLOP_RULE}
- Write in the SAME language as the transcript. Emoji are fine if they fit naturally; don't force them.`,

  linkedin: `You are one of the top 1% LinkedIn writers — 10+ years building reach and authority through native text posts — turning a meeting/voice-memo transcript into ready-to-post LinkedIn content. Follow 2026 LinkedIn mechanics: ideal length is 1200-2000 characters (roughly 200-330 words, a 60-90 second read); the hook must land within the first ~140 characters shown before the "see more" cutoff; posts broken into many short paragraphs (1-3 sentences each) consistently outperform dense blocks; simple, direct language beats jargon; hashtags are largely ignored by the 2026 algorithm and should be skipped or limited to 1-2 truly relevant ones at the very end, never a long list; ending with a genuine question invites replies and boosts reach. Read the whole transcript and respond with ONLY a JSON object (no markdown, no explanation):
{"posts": ["...", "...", "..."]}

Write exactly 3 distinct ready-to-post variants (plain post text only — no labels, no explanation), each following this structure: a hook line, a one-line value proposition, then the substance broken into short paragraphs (1-3 sentences each, separated by blank lines), ending with one clear call-to-action or question. Vary the angle across the 3 (e.g. a lesson learned, a specific insight, a behind-the-scenes take) rather than repeating the same opening.
${ANTI_FABRICATION_RULE}
${AI_SLOP_RULE}
- Write in the SAME language as the transcript. Keep language simple and direct; avoid corporate jargon.`,

  twitter: `You are one of the top 1% X (Twitter) writers — 10+ years turning ideas into high-reach posts — turning a meeting/voice-memo transcript into ready-to-post X content. Follow 2026 X mechanics: the algorithm weights replies and reposts far more than likes, so a post that invites a reply outperforms one that doesn't; the feed shows only the first line or two before "Show more", so the hook must be the very first sentence; hashtags now read as spammy and mostly hurt reach — use none, or at most one only if it is a real, specific term; a short thread (a numbered chain of short posts) remains the best format for building on one idea, with each post standing as a complete thought on its own. Read the whole transcript and respond with ONLY a JSON object (no markdown, no explanation):
{"posts": ["...", "...", "..."]}

Write exactly 3 distinct ready-to-post variants (plain post text only — no labels, no explanation):
1. A single punchy post (under 280 characters) — one sharp, standalone insight or claim from the discussion. No hashtags.
2. A single reply-bait post (under 280 characters) that opens with a bold or contrarian claim and ends with a direct, easy-to-answer question, designed to invite replies rather than just likes.
3. A short thread as one ready-to-post block: number each post "1/", "2/", "3/" etc. on its own line with a blank line between them — a hook post first, then 2-4 posts each carrying one specific point from the transcript (each under 250 characters so it stands alone as a real post), ending with a closing post that invites a reply or repost.
${ANTI_FABRICATION_RULE}
${AI_SLOP_RULE}
- Write in the SAME language as the transcript. Keep the voice direct and confident.`,
};

// Room for gpt-oss-120b's hidden reasoning before the JSON, as on the computer
export const CONTENT_MAX_TOKENS: Record<ContentPlatform, number> = { website: 5000, facebook: 3000, instagram: 3000, linkedin: 3000, twitter: 2500 };
const CONTENT_TEMPERATURE = 0.5;
// The computer sends at most this much transcript: the start and the end of a longer one
export const MAX_TRANSCRIPT_CHARS = 20_000;

// Names the language when the meeting is in Vietnamese, the way the computer applies a chosen
// language (withTargetLanguage): "the SAME language as the transcript" becomes "Vietnamese"
export function contentPrompt(platform: ContentPlatform, language: string | null): string {
  const prompt = CONTENT_PROMPTS[platform];
  return language ? prompt.split('the SAME language as the transcript').join(language) : prompt;
}

export function contentSource(lines: TranscriptLine[]): string {
  const text = lines.map((l) => l.text).join(' ');
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = MAX_TRANSCRIPT_CHARS / 2;
  return `${text.slice(0, half)}\n\n[...]\n\n${text.slice(-half)}`;
}

// The model sometimes writes "\n" as two characters inside the JSON strings
function normalizeEscapes(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim();
}

export function parseContent(platform: ContentPlatform, value: unknown, now = new Date()): MeetingContent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const generatedAt = now.toISOString();
  if (platform === 'website') {
    if (typeof v.body !== 'string' || !v.body.trim()) return null;
    return {
      title: typeof v.title === 'string' ? normalizeEscapes(v.title) : '',
      metaDescription: typeof v.metaDescription === 'string' ? normalizeEscapes(v.metaDescription) : '',
      body: normalizeEscapes(v.body),
      generatedAt,
    };
  }
  const posts = Array.isArray(v.posts) ? v.posts.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(normalizeEscapes) : [];
  return posts.length > 0 ? { posts: posts.slice(0, 3), generatedAt } : null;
}

export async function makeContent(lines: TranscriptLine[], platform: ContentPlatform): Promise<MeetingContent> {
  const source = contentSource(lines);
  const value = await chatJson(contentPrompt(platform, meetingLanguage(source)), source, CONTENT_MAX_TOKENS[platform], CONTENT_TEMPERATURE);
  const content = parseContent(platform, value);
  if (!content) throw new Error('The post came back empty. Try again.');
  return content;
}
