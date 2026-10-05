// The keyboard log (T-0178): what the Wispra app and the Wispra keyboard noted about the listening
// session, shown in Account. In some apps (Messenger, Zalo) the keyboard got no words and said "Đang
// viết…" for ever; nothing showed why. The lines are written by the two sides (SharedChannel.swift,
// SharedLog) as "06/10 06:06:12 app: text"; here they are read and the likely cause pointed out.
// Pure, so it is tested.

export interface LogFinding {
  // The line that shows it
  line: string;
  // What it most likely means, for the owner
  meaning: string;
}

// Signs, from the most telling down: what iOS did to Wispra, then what the keyboard saw
const SIGNS: { match: RegExp; meaning: string }[] = [
  { match: /iOS closed Wispra/i, meaning: 'iOS closed Wispra while its session was on (usually to free memory when a big app opens). The keyboard then has no app to answer it.' },
  { match: /the app was not running for \d+ s \(suspended/i, meaning: 'iOS suspended Wispra for a while: it did not run, so it could not hear or answer.' },
  { match: /no sign of life/i, meaning: 'The keyboard saw Wispra stop giving signs of life: iOS had stopped it.' },
  { match: /interrupted by another app or iOS/i, meaning: 'Another app (or iOS) took the microphone from Wispra.' },
  { match: /could not start the microphone again/i, meaning: 'Wispra could not take the microphone back: it is busy with another app.' },
  { match: /memory is short/i, meaning: 'iOS warned that memory is short: it may close Wispra when a big app opens.' },
  { match: /no live session/i, meaning: 'The keyboard found no running session, so it asked Wispra to open.' },
  { match: /no words after \d+ s/i, meaning: 'The words did not come back in time.' },
];

export function parseLogLines(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

// The last thing in the log that shows what went wrong, newest first
export function lastFinding(lines: string[]): LogFinding | null {
  const all = parseLogLines(lines);
  for (let i = all.length - 1; i >= 0; i--) {
    const sign = SIGNS.find((s) => s.match.test(all[i]));
    if (sign) return { line: all[i], meaning: sign.meaning };
  }
  return null;
}

// Newest first, as the screen shows them
export function newestFirst(lines: string[]): string[] {
  return [...parseLogLines(lines)].reverse();
}

// The text shared with the Chief: the finding, then every line
export function logToShare(lines: string[]): string {
  const finding = lastFinding(lines);
  const head = finding ? `Last sign: ${finding.line}\n${finding.meaning}\n\n` : '';
  return `${head}${parseLogLines(lines).join('\n')}`;
}
