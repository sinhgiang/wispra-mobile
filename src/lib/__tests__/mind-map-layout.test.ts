import { describe, expect, it } from '@jest/globals';

import type { MindMap } from '../meeting';
import { branchPalette, buildTree, expandedForLevel, layoutMap, oklchToHex } from '../mind-map-layout';

const point = (label: string, points: string[] = []) => ({ label, points: points.map((p) => ({ label: p })) });

// Shaped like the owner's meeting "Bảo mật web và AI"
const map: MindMap = {
  title: 'Bảo mật web và AI',
  note: 'Kiểm tra bảo mật trang web và dùng AI',
  topics: [
    point('Kiểm tra ghi âm', ['Âm thanh rõ']),
    point('Phân tích bảo mật OnlyHell', ['Lộ API SuperPay', 'Thiếu captcha', 'Lộ quyền admin']),
    point('AI quét lỗ hổng', ['Quét 200 khách hàng']),
    point('Học N8N AI Agents'),
  ],
  decisions: [point('Sửa lỗ hổng bằng AI')],
  actions: [point('Gửi NDA cho campus leads')],
  questions: [],
  branchLabels: { decisions: 'Quyết định', actions: 'Việc cần làm', questions: 'Câu hỏi còn mở' },
};

describe('the mind map, laid out like the computer’s (T-0164)', () => {
  it('puts topics on the right and decisions and action items on the left, each in its own colour', () => {
    const tree = buildTree(map);
    expect(tree.label).toBe('Bảo mật web và AI');
    expect(tree.children.map((b) => [b.label, b.side, b.hue])).toEqual([
      ['Kiểm tra ghi âm', 1, 262],
      ['Phân tích bảo mật OnlyHell', 1, 232],
      ['AI quét lỗ hổng', 1, 205],
      ['Học N8N AI Agents', 1, 172],
      ['Quyết định', -1, 150],
      ['Việc cần làm', -1, 65],
    ]);
  });

  it('balances a map with only topics: the second half moves left', () => {
    const tree = buildTree({ ...map, decisions: [], actions: [] });
    expect(tree.children.map((b) => b.side)).toEqual([1, 1, -1, -1]);
  });

  it('shows two levels first, three, or all', () => {
    const tree = buildTree(map);
    const two = layoutMap(tree, expandedForLevel(tree, 2));
    expect(two.nodes.map((n) => n.depth)).toEqual([0, 1, 1, 1, 1, 1, 1]);
    const three = layoutMap(tree, expandedForLevel(tree, 3));
    expect(three.nodes.filter((n) => n.depth === 2)).toHaveLength(7);
    const all = layoutMap(tree, expandedForLevel(tree, 0));
    expect(all.nodes).toHaveLength(14);
    // A closed branch still says how many it holds
    expect(two.nodes.find((n) => n.label === 'Phân tích bảo mật OnlyHell')).toMatchObject({ childCount: 3, expanded: false });
  });

  it('never lets two nodes overlap, and joins each node to its parent', () => {
    const tree = buildTree(map);
    const { nodes, edges, bounds } = layoutMap(tree, expandedForLevel(tree, 0));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
    expect(edges).toHaveLength(nodes.length - 1);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(n.x + n.w).toBeLessThanOrEqual(bounds.maxX);
    }
    // Right-side branches start right of the centre, left-side ones end left of it
    const root = nodes[0];
    for (const n of nodes.filter((x) => x.depth === 1)) {
      if (n.side > 0) expect(n.x).toBeGreaterThan(root.x + root.w);
      else expect(n.x + n.w).toBeLessThan(root.x);
    }
  });

  it('wraps a long label onto more lines instead of a wider node', () => {
    const tree = buildTree({ ...map, topics: [point('Một nhãn rất dài để thử xem bản đồ có xuống dòng đúng như trên máy tính không')] });
    const { nodes } = layoutMap(tree, new Set());
    const long = nodes.find((n) => n.depth === 1)!;
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.w).toBeLessThanOrEqual(190 + 28 + 1);
  });

  it('turns the computer’s oklch colours into colours the phone can draw', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(0.6279554, 0.2576833, 29.2338851)).toBe('#ff0000');
    for (const colour of Object.values(branchPalette(262))) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});
