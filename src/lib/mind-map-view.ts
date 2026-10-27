// Where the mind map is on the canvas and how fingers move it (T-1000). Pure, so it is tested;
// components/wispra/mind-map-canvas.tsx only passes the touches in and draws what comes out.
//
// The view is the screen position of the map's centre (the point the layout calls 0, 0) and the zoom.
// A branch opening or closing changes the map's size, not that point, so the picture stays where it is.

export interface MapView {
  x: number;
  y: number;
  k: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface MapBounds {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

// The smallest and the largest the map can be zoomed to
export const MIN_K = 0.15;
export const MAX_K = 2.5;
// How much of the map must stay on the canvas, so it can never be lost off the side
export const REACH = 80;
const FIT_PAD = 24;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The whole map, centred, as large as the canvas allows (never past 1.15, as on the computer)
export function fitView(bounds: MapBounds, width: number, height: number): MapView {
  const k = clamp(Math.min((width - FIT_PAD * 2) / Math.max(bounds.w, 1), (height - FIT_PAD * 2) / Math.max(bounds.h, 1), 1.15), MIN_K, MAX_K);
  return { k, x: (width - bounds.w * k) / 2 - bounds.minX * k, y: (height - bounds.h * k) / 2 - bounds.minY * k };
}

// Zoom by a factor with `focus` (a point of the canvas) staying where it is
export function zoomAbout(view: MapView, factor: number, focus: Pt): MapView {
  const k = clamp(view.k * factor, MIN_K, MAX_K);
  return { k, x: focus.x - ((focus.x - view.x) / view.k) * k, y: focus.y - ((focus.y - view.y) / view.k) * k };
}

// A node moved in the map (a branch opened above it): move the view the same way, so that node stays
// under the finger that touched it
export function keepNodeInPlace(view: MapView, before: Pt, after: Pt): MapView {
  return { k: view.k, x: view.x + (before.x - after.x) * view.k, y: view.y + (before.y - after.y) * view.k };
}

// At least a piece of the map stays on the canvas
export function keepInReach(view: MapView, bounds: MapBounds, width: number, height: number): MapView {
  if (width <= 0 || height <= 0) return view;
  const place = (origin: number, min: number, len: number, size: number) => {
    const span = len * view.k;
    const margin = Math.min(REACH, span, size);
    const start = clamp(origin + min * view.k, margin - span, size - margin);
    return start - min * view.k;
  };
  const x = place(view.x, bounds.minX, bounds.w, width);
  const y = place(view.y, bounds.minY, bounds.h, height);
  return x === view.x && y === view.y ? view : { ...view, x, y };
}

// ── Fingers ──────────────────────────────────────────────────────────────────────────────────
// A gesture is read from where it began: the view then, the middle of the fingers and, for two
// fingers, how far apart they were. Everything after that is worked out from those and the touches now.
export interface GestureBase {
  view: MapView;
  centre: Pt;
  // 0 for one finger
  dist: number;
  count: 1 | 2;
  // What the last step gave, which a change of the number of fingers carries on from
  last: MapView;
}

const centroid = (pts: Pt[]): Pt => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const apart = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function beginGesture(view: MapView, touches: Pt[]): GestureBase {
  const count = touches.length >= 2 ? 2 : 1;
  const used = touches.slice(0, count);
  return { view, last: view, centre: used.length ? centroid(used) : { x: 0, y: 0 }, dist: count === 2 ? apart(used[0], used[1]) : 0, count };
}

// One step of a gesture. `origin` is the canvas's corner on the screen (touches are in screen points,
// the view is in canvas points).
//  - One finger moves the map by how far the finger has moved.
//  - Two fingers zoom by how much further apart (or closer) they are, and move it with their middle; the
//    point of the map that was between them stays between them.
//  - A finger put down or lifted starts again from the view as it is, so the map never jumps.
//  - When the zoom reaches its smallest or largest, the gesture starts again from there, so fingers that
//    went on past the limit do not have to come all the way back before the map answers.
export function stepGesture(base: GestureBase, touches: Pt[], origin: Pt): { view: MapView; base: GestureBase } {
  if (touches.length === 0) return { view: base.last, base };
  const count = touches.length >= 2 ? 2 : 1;
  if (count !== base.count) return { view: base.last, base: beginGesture(base.last, touches) };
  const used = touches.slice(0, count);
  const mid = centroid(used);
  const dist = count === 2 ? apart(used[0], used[1]) : 0;
  if (count === 1 || base.dist < 1 || dist < 1) {
    const view = { ...base.view, x: base.view.x + mid.x - base.centre.x, y: base.view.y + mid.y - base.centre.y };
    return { view, base: { ...base, last: view } };
  }
  const raw = base.view.k * (dist / base.dist);
  const k = clamp(raw, MIN_K, MAX_K);
  const px = (base.centre.x - origin.x - base.view.x) / base.view.k;
  const py = (base.centre.y - origin.y - base.view.y) / base.view.k;
  const view = { k, x: mid.x - origin.x - px * k, y: mid.y - origin.y - py * k };
  return { view, base: raw === k ? { ...base, last: view } : beginGesture(view, used) };
}
