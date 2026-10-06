// The mind map's picture (T-0164), as on the computer (spetotext/src/renderer/meeting/
// mindMapData.ts and mindMapRenderer.ts): the title in the centre, topics read down the right side,
// decisions, action items and open questions on the left, each main branch in its own colour, a
// left/right tidy tree joined by curves, and a circle on each branch to open or close it. Pure, so
// it is tested; components/wispra/mind-map-canvas.tsx draws it with react-native-svg.

import type { MindMap, MindMapItem } from './meeting';

export type BranchKind = 'topic' | 'decisions' | 'actions' | 'questions';

export interface TreeNode {
  id: string;
  label: string;
  note?: string;
  kind: BranchKind | 'root';
  // Main branches: colour (oklch hue) and side of the centre
  hue?: number;
  side?: 1 | -1;
  children: TreeNode[];
}

const TOPIC_HUES = [262, 232, 205, 172, 300, 335, 248, 190, 318];
const OUTCOME_HUES: Record<Exclude<BranchKind, 'topic'>, number> = { decisions: 150, actions: 65, questions: 28 };

export function buildTree(map: MindMap): TreeNode {
  let next = 0;
  const id = () => `n${next++}`;
  const convert = (item: MindMapItem, kind: BranchKind): TreeNode => ({
    id: id(),
    label: item.label,
    note: item.note,
    kind,
    children: (item.points ?? []).map((p) => convert(p, kind)),
  });
  const root: TreeNode = { id: id(), label: map.title, note: map.note, kind: 'root', children: [] };
  const topics = map.topics.map((t) => convert(t, 'topic'));
  const outcomes: TreeNode[] = (['decisions', 'actions', 'questions'] as const)
    .filter((k) => map[k].length > 0)
    .map((k) => ({ id: id(), label: map.branchLabels[k], kind: k, children: map[k].map((item) => convert(item, k)) }));
  topics.forEach((b, i) => {
    b.hue = TOPIC_HUES[i % TOPIC_HUES.length];
    // With no outcomes the second half of the topics moves left so the map stays balanced
    b.side = outcomes.length === 0 && topics.length >= 4 && i >= Math.ceil(topics.length / 2) ? -1 : 1;
  });
  for (const b of outcomes) {
    b.hue = OUTCOME_HUES[b.kind as Exclude<BranchKind, 'topic'>];
    b.side = -1;
  }
  root.children = [...topics, ...outcomes];
  return root;
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────
// The computer's palette is in oklch, which React Native cannot read: converted to sRGB hex.
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return (
    '#' +
    lin
      .map((v) => {
        const x = Math.min(1, Math.max(0, v));
        const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

export interface Palette {
  mainFill: string;
  mainStroke: string;
  mainText: string;
  sub: string;
  subFill: string;
  subStroke: string;
  leafFill: string;
  edge: string;
}

// Wispra on the phone is dark: the computer's dark palette
export function branchPalette(hue: number): Palette {
  return {
    mainFill: oklchToHex(0.34, 0.07, hue),
    mainStroke: oklchToHex(0.52, 0.11, hue),
    mainText: oklchToHex(0.95, 0.03, hue),
    sub: oklchToHex(0.8, 0.06, hue),
    subFill: oklchToHex(0.26, 0.035, hue),
    subStroke: oklchToHex(0.4, 0.065, hue),
    leafFill: oklchToHex(0.215, 0.02, hue),
    edge: oklchToHex(0.58, 0.1, hue),
  };
}

export const MAP_THEME = { canvas: '#0f1117', text: '#eef0f5', text2: '#c3c9d6', dot: 'rgba(255,255,255,0.07)', accent: '#6366f1' };

// ── Layout ───────────────────────────────────────────────────────────────────────────────────
export interface NodeStyle {
  size: number;
  weight: '400' | '500' | '600' | '700';
  padX: number;
  padY: number;
  radius: number;
  maxW: number;
  lh: number;
}

// Per depth, as on the computer: strength falls from the centre outward
export const STYLE: NodeStyle[] = [
  { size: 15, weight: '700', padX: 20, padY: 13, radius: 18, maxW: 210, lh: 20 },
  { size: 13.5, weight: '600', padX: 14, padY: 9, radius: 13, maxW: 190, lh: 18 },
  { size: 12.5, weight: '500', padX: 12, padY: 7, radius: 10, maxW: 210, lh: 16.5 },
  { size: 12, weight: '400', padX: 10, padY: 5, radius: 8, maxW: 220, lh: 16 },
];
const VGAP = [18, 9, 6, 5];
const HGAP = [72, 54, 46, 42];
export const TOGGLE_R = 8.5;
export const TOGGLE_OFFSET = 14;
const EDGE_W = [0, 2.4, 1.8, 1.4];

export const styleOf = (depth: number): NodeStyle => STYLE[Math.min(depth, STYLE.length - 1)];

// No canvas to measure text on the phone: the width of the system font, per character, close
// enough for wrapping (wide letters and Vietnamese marks included)
export function textWidth(text: string, size: number, weight: string): number {
  const bold = weight === '700' || weight === '600' ? 1.04 : 1;
  let units = 0;
  for (const ch of text) units += /[mwMW]/.test(ch) ? 0.82 : /[iljtfI.,:;'!|]/.test(ch) ? 0.3 : /[A-ZĐ]/.test(ch) ? 0.66 : ch === ' ' ? 0.28 : 0.55;
  return units * size * bold;
}

export function wrap(text: string, style: NodeStyle): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, style.size, style.weight) <= style.maxW) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

export interface LaidNode {
  id: string;
  depth: number;
  label: string;
  note?: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  side: number;
  hue: number;
  childCount: number;
  expanded: boolean;
  parentId: string | null;
}

export interface LaidEdge {
  id: string;
  d: string;
  hue: number;
  width: number;
}

export interface MapLayout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number };
}

// Which branches are open for "Levels": 2 is the centre and the main branches, 3 one more, 0 all
export function expandedForLevel(tree: TreeNode, level: number): Set<string> {
  const open = new Set<string>();
  const walk = (n: TreeNode, depth: number) => {
    if (n.children.length && depth > 0 && (level === 0 || depth < level - 1)) open.add(n.id);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(tree, 0);
  return open;
}

interface Work {
  data: TreeNode;
  depth: number;
  parent: Work | null;
  side: number;
  hue: number;
  lines: string[];
  w: number;
  h: number;
  x: number;
  y: number;
  children: Work[];
}

export function layoutMap(tree: TreeNode, expanded: ReadonlySet<string>): MapLayout {
  const prepare = (data: TreeNode, depth: number, parent: Work | null, side: number, hue: number): Work => {
    const st = styleOf(depth);
    const lines = wrap(data.label, st);
    const labelW = Math.max(...lines.map((l) => textWidth(l, st.size, st.weight)));
    const ownSide = depth === 0 ? 0 : depth === 1 ? (data.side === -1 ? -1 : 1) : side;
    const ownHue = depth === 1 ? (data.hue ?? 262) : hue;
    const node: Work = { data, depth, parent, side: ownSide, hue: ownHue, lines, w: Math.ceil(labelW + st.padX * 2), h: Math.ceil(lines.length * st.lh + st.padY * 2), x: 0, y: 0, children: [] };
    node.children = data.children.map((c) => prepare(c, depth + 1, node, ownSide, ownHue));
    return node;
  };
  const root = prepare(tree, 0, null, 0, 262);
  const visibleChildren = (n: Work) => (n.depth === 0 || expanded.has(n.data.id) ? n.children : []);

  const span = (n: Work): number => {
    const ch = visibleChildren(n);
    if (!ch.length) return n.h;
    const gap = VGAP[Math.min(n.depth, VGAP.length - 1)];
    return Math.max(n.h, ch.reduce((sum, c) => sum + span(c), 0) + gap * (ch.length - 1));
  };
  const placed: Work[] = [];
  const place = (n: Work, edgeX: number, cy: number, side: number) => {
    n.x = side > 0 ? edgeX : edgeX - n.w;
    n.y = cy - n.h / 2;
    placed.push(n);
    const ch = visibleChildren(n);
    if (!ch.length) return;
    const hgap = HGAP[Math.min(n.depth, HGAP.length - 1)];
    placeChildren(ch, n.depth, side > 0 ? n.x + n.w + hgap : n.x - hgap, cy, side);
  };
  const placeChildren = (children: Work[], depth: number, edgeX: number, cy: number, side: number) => {
    const gap = VGAP[Math.min(depth, VGAP.length - 1)];
    const spans = children.map(span);
    const total = spans.reduce((a, b) => a + b, 0) + gap * (children.length - 1);
    let y = cy - total / 2;
    children.forEach((c, i) => {
      place(c, edgeX, y + spans[i] / 2, side);
      y += spans[i] + gap;
    });
  };

  root.x = -root.w / 2;
  root.y = -root.h / 2;
  placed.push(root);
  const right = root.children.filter((c) => c.side > 0);
  const left = root.children.filter((c) => c.side < 0);
  if (right.length) placeChildren(right, 0, root.w / 2 + HGAP[0], 0, 1);
  if (left.length) placeChildren(left, 0, -root.w / 2 - HGAP[0], 0, -1);

  const edges: LaidEdge[] = [];
  for (const n of placed) {
    const p = n.parent;
    if (!p) continue;
    const sy = p.y + p.h / 2;
    const ey = n.y + n.h / 2;
    const sx = p.depth === 0 ? p.x + (n.side > 0 ? p.w : 0) : n.side > 0 ? p.x + p.w + TOGGLE_OFFSET : p.x - TOGGLE_OFFSET;
    const ex = n.side > 0 ? n.x : n.x + n.w;
    const dx = (ex - sx) * 0.5;
    edges.push({
      id: n.data.id,
      d: `M${sx.toFixed(1)} ${sy.toFixed(1)}C${(sx + dx).toFixed(1)} ${sy.toFixed(1)} ${(ex - dx).toFixed(1)} ${ey.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      hue: n.hue,
      width: EDGE_W[Math.min(n.depth, EDGE_W.length - 1)],
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of placed) {
    const pad = n.children.length && n.depth > 0 ? TOGGLE_OFFSET + TOGGLE_R + 2 : 0;
    minX = Math.min(minX, n.x - (n.side < 0 ? pad : 0));
    maxX = Math.max(maxX, n.x + n.w + (n.side > 0 ? pad : 0));
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.h);
  }

  return {
    nodes: placed.map((n) => ({
      id: n.data.id,
      depth: n.depth,
      label: n.data.label,
      note: n.data.note,
      lines: n.lines,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      side: n.side,
      hue: n.hue,
      childCount: n.children.length,
      expanded: n.depth === 0 || expanded.has(n.data.id),
      parentId: n.parent?.data.id ?? null,
    })),
    edges,
    bounds: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
  };
}
