// The mind map keeps its zoom and its place when a branch opens or closes, and answers two fingers
// without jumping (T-1000). The real component is drawn; the fingers are the touch events the phone
// sends to it.
import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MindMapView } from '@/components/wispra/mind-map-canvas';
import type { MindMap } from '@/lib/meeting';
import { buildTree, expandedForLevel, layoutMap } from '@/lib/mind-map-layout';
import { MAX_K, MIN_K } from '@/lib/mind-map-view';

const MAP: MindMap = {
  title: 'Local tour platform',
  topics: [
    { label: 'Gaps', points: [{ label: 'Cao Bang' }, { label: 'Few tours listed' }] },
    { label: 'Model', points: [{ label: 'Licence in company name' }, { label: 'Guide contracts' }, { label: 'Payments' }] },
    { label: 'Risks', points: [{ label: 'Refunds' }, { label: 'Late cancellations' }] },
  ],
  decisions: [],
  actions: [{ label: 'Ask a lawyer' }, { label: 'Interview 8 guides' }],
  questions: [],
  branchLabels: { decisions: 'Decisions', actions: 'Action items', questions: 'Open questions' },
};
const WIDTH = 350;
const HEIGHT = 440;

// What the layer is doing on the canvas now
function transform() {
  const style = StyleSheet.flatten(screen.getByTestId('mind-map-layer').props.style) as { transform: { translateX?: number; translateY?: number; scale?: number }[] };
  const get = (key: 'translateX' | 'translateY' | 'scale') => style.transform.find((t) => key in t)?.[key] as number;
  return { tx: get('translateX'), ty: get('translateY'), k: get('scale') };
}

// Where a node is on the canvas, by the layout the screen should be showing
function nodeOnCanvas(label: string, open: Set<string>) {
  const laid = layoutMap(buildTree(MAP), open);
  const node = laid.nodes.find((n) => n.label === label);
  if (!node) throw new Error(`No node ${label}`);
  const { tx, ty, k } = transform();
  return { x: tx + (node.x - laid.bounds.minX) * k, y: ty + (node.y - laid.bounds.minY) * k };
}

async function drawn(map: MindMap = MAP) {
  const view = await render(<MindMapView map={map} />);
  // The canvas is told its size, as the phone does once it has drawn it
  const onLayout = screen.getByTestId('mind-map-canvas').props.onLayout as (e: unknown) => void;
  await act(async () => onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: HEIGHT } } }));
  return view;
}

// The events a phone sends for fingers at these points (the touch history is what PanResponder reads)
let stamp = 1000;
function touches(points: { x: number; y: number }[]) {
  stamp += 16;
  return {
    nativeEvent: { touches: points.map((p) => ({ pageX: p.x, pageY: p.y, locationX: 0, locationY: 0 })), timestamp: stamp },
    touchHistory: {
      indexOfSingleActiveTouch: points.length === 1 ? 0 : -1,
      mostRecentTimeStamp: stamp,
      numberActiveTouches: points.length,
      touchBank: points.map((p) => ({
        touchActive: true,
        startPageX: p.x,
        startPageY: p.y,
        startTimeStamp: stamp,
        currentPageX: p.x,
        currentPageY: p.y,
        currentTimeStamp: stamp,
        previousPageX: p.x,
        previousPageY: p.y,
        previousTimeStamp: stamp,
      })),
    },
  };
}
// The responder events go straight to the handlers the canvas was given (the test renderer's own
// fireEvent does not send them), inside act as the phone's event loop would
async function send(name: 'onResponderGrant' | 'onResponderMove' | 'onResponderRelease', event: ReturnType<typeof touches>) {
  const handler = screen.getByTestId('mind-map-canvas').props[name] as (e: unknown) => void;
  await act(async () => handler(event));
}
const pair = (gap: number) => [
  { x: WIDTH / 2 - gap / 2, y: HEIGHT / 2 },
  { x: WIDTH / 2 + gap / 2, y: HEIGHT / 2 },
];

// Two fingers on the map, going from `from` apart to `to` apart in steps; returns every scale seen
async function pinch(from: number, to: number, steps = 20) {
  const seen: number[] = [];
  await send('onResponderGrant', touches(pair(from)));
  for (let i = 1; i <= steps; i += 1) {
    await send('onResponderMove', touches(pair(from + ((to - from) * i) / steps)));
    seen.push(transform().k);
  }
  await send('onResponderRelease', touches([]));
  return seen;
}

describe('opening a branch (T-1000)', () => {
  it('keeps the zoom and the place: zoomed in, a tap on a branch’s circle opens it and the map does not go back to its first size', async () => {
    await drawn();
    const fitted = transform();
    for (let i = 0; i < 3; i += 1) await fireEvent.press(screen.getByText('+'));
    const zoomed = transform();
    expect(zoomed.k).toBeCloseTo(fitted.k * 1.25 ** 3);

    const open = expandedForLevel(buildTree(MAP), 2);
    const before = nodeOnCanvas('Model', open);
    await fireEvent.press(screen.getByTestId('map-toggle-Model'));
    expect(screen.getByTestId('map-node-Guide contracts')).toBeTruthy();

    // The same zoom, and the branch that was touched is still where the finger touched it
    expect(transform().k).toBe(zoomed.k);
    const opened = new Set(open).add(buildTree(MAP).children.find((c) => c.label === 'Model')?.id as string);
    const after = nodeOnCanvas('Model', opened);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);

    // And closing it again does the same
    await fireEvent.press(screen.getByTestId('map-toggle-Model'));
    expect(screen.queryByTestId('map-node-Guide contracts')).toBeNull();
    expect(transform().k).toBe(zoomed.k);
    const closed = nodeOnCanvas('Model', open);
    expect(closed.x).toBeCloseTo(before.x, 5);
    expect(closed.y).toBeCloseTo(before.y, 5);
  });

  it('keeps a zoom made with two fingers when a branch is opened', async () => {
    await drawn();
    const fitted = transform();
    await pinch(60, 150);
    const zoomed = transform();
    expect(zoomed.k).toBeGreaterThan(fitted.k * 2);
    await fireEvent.press(screen.getByTestId('map-toggle-Risks'));
    expect(screen.getByTestId('map-node-Refunds')).toBeTruthy();
    expect(transform().k).toBe(zoomed.k);
  });

  it('keeps the zoom when the screen is given the same map again, as another copy', async () => {
    const view = await drawn();
    for (let i = 0; i < 2; i += 1) await fireEvent.press(screen.getByText('+'));
    await fireEvent.press(screen.getByTestId('map-toggle-Gaps'));
    const before = transform();
    await view.rerender(<MindMapView map={JSON.parse(JSON.stringify(MAP)) as MindMap} />);
    // The branch the person opened is still open and the map is where it was
    expect(screen.getByTestId('map-node-Cao Bang')).toBeTruthy();
    expect(transform()).toEqual(before);
  });

  it('still fits the map when it is another level, or Fit is pressed', async () => {
    await drawn();
    const fitted = transform();
    await fireEvent.press(screen.getByText('+'));
    await fireEvent.press(screen.getByText('+'));
    expect(transform().k).not.toBeCloseTo(fitted.k);
    await fireEvent.press(screen.getByText('Fit'));
    expect(transform().k).toBeCloseTo(fitted.k);
    await fireEvent.press(screen.getByText('+'));
    await fireEvent.press(screen.getByText('All'));
    // Every branch is open, so the map is wider and taller: fitted again, smaller than the first fit
    expect(screen.getByTestId('map-node-Late cancellations')).toBeTruthy();
    expect(transform().k).toBeLessThan(fitted.k);
  });

  it('fits a different map to the canvas, not the one before', async () => {
    const view = await drawn();
    for (let i = 0; i < 3; i += 1) await fireEvent.press(screen.getByText('+'));
    await view.rerender(<MindMapView map={{ ...MAP, title: 'Another map', topics: [{ label: 'One', points: [{ label: 'Two' }] }] }} />);
    expect(screen.getByTestId('map-node-Another map')).toBeTruthy();
    const laid = layoutMap(buildTree({ ...MAP, title: 'Another map', topics: [{ label: 'One', points: [{ label: 'Two' }] }] }), new Set());
    expect(transform().k).toBeCloseTo(Math.min((WIDTH - 48) / laid.bounds.w, (HEIGHT - 48) / laid.bounds.h, 1.15));
  });
});

describe('two fingers on the map (T-1000)', () => {
  it('zooms in step by step, with no step a jump, up to the largest and no further', async () => {
    await drawn();
    const start = transform().k;
    const seen = await pinch(60, 400, 90);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // Fingers moving 4 points a step: a step is a few percent, never a jump from the first size to the last
    const biggest = Math.max(...seen.map((k, i) => Math.abs(k - (i ? seen[i - 1] : start)) / (i ? seen[i - 1] : start)));
    expect(biggest).toBeLessThan(0.1);
    expect(seen[seen.length - 1]).toBe(MAX_K);
  });

  it('shrinks again from the largest, down to the smallest and no further', async () => {
    await drawn();
    await pinch(40, 700, 20);
    expect(transform().k).toBe(MAX_K);
    // A second pinch, from far apart to close: the map gets smaller at once and ends at the smallest
    await send('onResponderGrant', touches(pair(500)));
    await send('onResponderMove', touches(pair(450)));
    expect(transform().k).toBeLessThan(MAX_K);
    for (let gap = 440; gap >= 4; gap -= 12) await send('onResponderMove', touches(pair(gap)));
    expect(transform().k).toBe(MIN_K);
    await send('onResponderRelease', touches([]));
  });

  it('does not read the touches inside the zoomed layer: fingers that stay still stay still, whatever locationX says', async () => {
    await drawn();
    for (let i = 0; i < 2; i += 1) await fireEvent.press(screen.getByText('+'));
    // locationX / locationY are in the points of whatever was touched; inside the zoomed layer they change as
    // the layer is zoomed. The map must go by where the fingers are on the screen.
    const withLocation = (extra: number) => {
      const e = touches(pair(100));
      e.nativeEvent.touches.forEach((t) => {
        t.locationX = extra;
        t.locationY = extra;
      });
      return e;
    };
    const still = transform();
    await send('onResponderGrant', withLocation(10));
    await send('onResponderMove', withLocation(9000));
    await send('onResponderMove', withLocation(3));
    expect(transform()).toEqual(still);
    await send('onResponderRelease', touches([]));
  });

  it('follows one finger, and a finger put down in the middle of it does not make the map jump', async () => {
    await drawn();
    const first = transform();
    await send('onResponderGrant', touches([{ x: 100, y: 100 }]));
    await send('onResponderMove', touches([{ x: 130, y: 100 }]));
    expect(transform().tx).toBeCloseTo(first.tx + 30);
    const panned = transform();
    await send('onResponderMove', touches([{ x: 130, y: 100 }, { x: 250, y: 100 }]));
    expect(transform()).toEqual(panned);
    await send('onResponderMove', touches([{ x: 130, y: 100 }]));
    expect(transform()).toEqual(panned);
    await send('onResponderMove', touches([{ x: 140, y: 100 }]));
    expect(transform().tx).toBeCloseTo(panned.tx + 10);
    await send('onResponderRelease', touches([]));
  });

  it('cannot push the map away off the canvas', async () => {
    await drawn();
    await send('onResponderGrant', touches([{ x: 0, y: 200 }]));
    await send('onResponderMove', touches([{ x: 5000, y: 200 }]));
    const { tx, k } = transform();
    // The left edge of the map is no further right than the canvas's right edge less a piece of the map
    expect(tx).toBeLessThanOrEqual(WIDTH - 80 + 1e-6);
    expect(k).toBeGreaterThan(0);
    await send('onResponderRelease', touches([]));
  });
});

