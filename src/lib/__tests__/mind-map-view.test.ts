import { describe, expect, it } from '@jest/globals';

import { beginGesture, fitView, keepInReach, keepNodeInPlace, MAX_K, MIN_K, stepGesture, zoomAbout, type MapView, type Pt } from '../mind-map-view';

const BOUNDS = { minX: -300, minY: -200, w: 800, h: 400 };
const ORIGIN: Pt = { x: 20, y: 120 };
const screenOf = (v: MapView, p: Pt): Pt => ({ x: v.x + p.x * v.k, y: v.y + p.y * v.k });

// Two fingers on the screen, `gap` apart, with their middle at (mx, my)
const fingers = (mx: number, my: number, gap: number): Pt[] => [
  { x: mx - gap / 2, y: my },
  { x: mx + gap / 2, y: my },
];

describe('fitting and zooming the map (T-1000)', () => {
  it('centres the map on the canvas, never larger than 1.15 and never past the limits', () => {
    const v = fitView(BOUNDS, 350, 440);
    expect(v.k).toBeCloseTo((350 - 48) / 800);
    // The map's own middle (-300 + 400, -200 + 200) is the middle of the canvas
    expect(screenOf(v, { x: 100, y: 0 }).x).toBeCloseTo(175);
    expect(screenOf(v, { x: 100, y: 0 }).y).toBeCloseTo(220);
    expect(fitView({ minX: 0, minY: 0, w: 10, h: 10 }, 350, 440).k).toBe(1.15);
    expect(fitView({ minX: 0, minY: 0, w: 90_000, h: 90_000 }, 350, 440).k).toBe(MIN_K);
  });

  it('zooms about a point, which stays where it is, and stops at the smallest and the largest', () => {
    const v = { x: 40, y: 60, k: 1 };
    const focus = { x: 175, y: 220 };
    const z = zoomAbout(v, 1.25, focus);
    const mapPoint = { x: (focus.x - v.x) / v.k, y: (focus.y - v.y) / v.k };
    expect(screenOf(z, mapPoint).x).toBeCloseTo(focus.x);
    expect(screenOf(z, mapPoint).y).toBeCloseTo(focus.y);
    let big = v;
    for (let i = 0; i < 40; i += 1) big = zoomAbout(big, 1.25, focus);
    expect(big.k).toBe(MAX_K);
    let small = big;
    for (let i = 0; i < 80; i += 1) small = zoomAbout(small, 1 / 1.25, focus);
    expect(small.k).toBe(MIN_K);
  });

  it('keeps a node that moved under the finger that touched it', () => {
    const v = { x: 100, y: 50, k: 1.8 };
    // Opening the branch above it moved the node 40 up and 6 left in the map
    const w = keepNodeInPlace(v, { x: 200, y: 30 }, { x: 194, y: -10 });
    expect(screenOf(w, { x: 194, y: -10 })).toEqual(screenOf(v, { x: 200, y: 30 }));
    expect(w.k).toBe(v.k);
  });

  it('never lets the map leave the canvas altogether', () => {
    const gone = keepInReach({ x: 5000, y: -5000, k: 1 }, BOUNDS, 350, 440);
    // Part of the map (80 points) stays on the canvas, on the side it was pushed to
    expect(gone.x + BOUNDS.minX).toBeLessThanOrEqual(350 - 80);
    expect(gone.y + BOUNDS.minY + BOUNDS.h).toBeGreaterThanOrEqual(80);
    const here = { x: 175, y: 220, k: 0.5 };
    expect(keepInReach(here, BOUNDS, 350, 440)).toBe(here);
    // No size yet: left as it is
    expect(keepInReach(gone, BOUNDS, 0, 0)).toBe(gone);
  });
});

describe('two fingers on the map (T-1000)', () => {
  it('zooms by how far apart the fingers are and keeps the point between them between them', () => {
    const view = { x: 60, y: 30, k: 0.8 };
    const begin = beginGesture(view, fingers(200, 300, 100));
    const step = stepGesture(begin, fingers(210, 310, 150), ORIGIN);
    expect(step.view.k).toBeCloseTo(0.8 * 1.5);
    // The point of the map that was under the middle of the fingers, in canvas points
    const mapPoint = { x: (200 - ORIGIN.x - view.x) / view.k, y: (300 - ORIGIN.y - view.y) / view.k };
    expect(screenOf(step.view, mapPoint).x).toBeCloseTo(210 - ORIGIN.x);
    expect(screenOf(step.view, mapPoint).y).toBeCloseTo(310 - ORIGIN.y);
  });

  it('moves smoothly: fingers that spread a little at a time move the map a little at a time, all the way to the largest', () => {
    let base = beginGesture({ x: 60, y: 30, k: 1 }, fingers(200, 300, 60));
    let before: MapView = base.view;
    let biggest = 0;
    for (let gap = 60; gap <= 600; gap += 3) {
      const step = stepGesture(base, fingers(200, 300, gap), ORIGIN);
      base = step.base;
      biggest = Math.max(biggest, Math.abs(step.view.k - before.k), Math.abs(step.view.x - before.x) / 100, Math.abs(step.view.y - before.y) / 100);
      before = step.view;
    }
    // No step is a jump (a step of 3 points of spread is 5% of the gap at most)
    expect(biggest).toBeLessThan(0.15);
    expect(before.k).toBe(MAX_K);
  });

  it('shrinks again at once from the largest, however far the fingers went on past it', () => {
    let base = beginGesture({ x: 60, y: 30, k: 1 }, fingers(200, 300, 60));
    let view = base.view;
    // Spread to ten times the gap: the zoom stopped at the largest long ago
    for (const gap of [120, 240, 480, 600]) {
      const step = stepGesture(base, fingers(200, 300, gap), ORIGIN);
      base = step.base;
      view = step.view;
    }
    expect(view.k).toBe(MAX_K);
    // The fingers come back by only ten points
    const closer = stepGesture(base, fingers(200, 300, 590), ORIGIN);
    expect(closer.view.k).toBeLessThan(MAX_K);
    // And on to the smallest, which it does not pass
    let small = closer;
    for (let gap = 580; gap >= 2; gap -= 6) small = stepGesture(small.base, fingers(200, 300, gap), ORIGIN);
    expect(small.view.k).toBe(MIN_K);
    // The same from the smallest: spreading the fingers makes it larger straight away
    const back = stepGesture(small.base, fingers(200, 300, 40), ORIGIN);
    expect(back.view.k).toBeGreaterThan(MIN_K);
  });

  it('does not read the map’s own scale into where the fingers are (the touches are the screen’s, the canvas is only subtracted)', () => {
    // The same fingers, once with the map small and once large, move the map's centre by the same distance
    const small = stepGesture(beginGesture({ x: 100, y: 100, k: 0.3 }, fingers(200, 300, 100)), fingers(230, 300, 100), ORIGIN);
    const large = stepGesture(beginGesture({ x: 100, y: 100, k: 2 }, fingers(200, 300, 100)), fingers(230, 300, 100), ORIGIN);
    expect(small.view.x - 100).toBeCloseTo(30);
    expect(large.view.x - 100).toBeCloseTo(30);
  });
});

describe('one finger on the map, and fingers put down or lifted (T-1000)', () => {
  it('moves the map as far as the finger moved', () => {
    const begin = beginGesture({ x: 10, y: 20, k: 1.4 }, [{ x: 100, y: 100 }]);
    const step = stepGesture(begin, [{ x: 130, y: 85 }], ORIGIN);
    expect(step.view).toEqual({ x: 40, y: 5, k: 1.4 });
  });

  it('does not jump when the second finger comes down, nor when it is lifted again', () => {
    let step = stepGesture(beginGesture({ x: 10, y: 20, k: 1 }, [{ x: 100, y: 100 }]), [{ x: 160, y: 100 }], ORIGIN);
    const panned = step.view;
    // The second finger lands far from the first
    step = stepGesture(step.base, [{ x: 160, y: 100 }, { x: 300, y: 100 }], ORIGIN);
    expect(step.view).toEqual(panned);
    // It moves a little: a little zoom, not a jump
    step = stepGesture(step.base, [{ x: 160, y: 100 }, { x: 310, y: 100 }], ORIGIN);
    expect(Math.abs(step.view.k - 1)).toBeLessThan(0.1);
    const pinched = step.view;
    // Lifted: back to one finger, the map where the pinch left it, and then it follows that finger
    step = stepGesture(step.base, [{ x: 160, y: 100 }], ORIGIN);
    expect(step.view).toEqual(pinched);
    step = stepGesture(step.base, [{ x: 170, y: 100 }], ORIGIN);
    expect(step.view.x).toBeCloseTo(pinched.x + 10);
    expect(step.view.k).toBe(pinched.k);
  });

  it('leaves the map alone when there are no touches', () => {
    const begin = beginGesture({ x: 1, y: 2, k: 1 }, [{ x: 0, y: 0 }]);
    expect(stepGesture(begin, [], ORIGIN).view).toEqual({ x: 1, y: 2, k: 1 });
  });
});
