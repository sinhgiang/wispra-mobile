import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { Button, Card, Chip } from './ui';

import { Gap, W } from '@/constants/wispra';
import type { MindMap } from '@/lib/meeting';
import {
  branchPalette,
  buildTree,
  expandedForLevel,
  layoutMap,
  MAP_THEME,
  styleOf,
  TOGGLE_OFFSET,
  TOGGLE_R,
  type LaidNode,
  type MapLayout,
  type TreeNode,
} from '@/lib/mind-map-layout';
import { beginGesture, fitView, keepInReach, keepNodeInPlace, stepGesture, zoomAbout, type GestureBase, type MapView, type Pt } from '@/lib/mind-map-view';

// The mind map as on the computer (T-0164): the picture is laid out by lib/mind-map-layout.ts and
// drawn here with SVG. One finger moves the map, two fingers zoom it; − Fit + do the same with
// buttons. A circle on a branch opens or closes it; tapping a node shows it in a card below.
// Where the map is and how the fingers move it is lib/mind-map-view.ts (T-1000): opening or closing a
// branch, or being given a copy of the same map, keeps the zoom and the place; only a new map, another
// level or another width fits the map to the canvas again.

const LEVELS: { value: number; label: string }[] = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 0, label: 'All' },
];
const CANVAS_HEIGHT = 440;
// How long the system gets to draw the map as a picture before the map is shared as text instead
export const SNAPSHOT_TIMEOUT_MS = 5000;

// What a screen needs to save the map as a picture (the Notes tab's "Download")
export interface MapExporter {
  // The whole map, with every branch open as the person left them, as a PNG in base64
  toPngBase64(): Promise<string | null>;
}

const touchesOf = (e: GestureResponderEvent): Pt[] => e.nativeEvent.touches.map((t) => ({ x: t.pageX, y: t.pageY }));

export function MindMapView({ map, onExporter }: { map: MindMap; onExporter?: (exporter: MapExporter | null) => void }) {
  const svgRef = useRef<Svg>(null);
  const [exporting, setExporting] = useState(false);
  // A copy of the same map (the store gave it again) is not a new map: it would close the branches
  // and put the map back at the size it began with
  const [stable, setStable] = useState(map);
  if (stable !== map && JSON.stringify(stable) !== JSON.stringify(map)) setStable(map);
  const tree = useMemo(() => buildTree(stable), [stable]);
  const [level, setLevel] = useState(2);
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedForLevel(tree, 2));
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: CANVAS_HEIGHT });
  const [view, setView] = useState<MapView>({ x: 0, y: 0, k: 1 });
  const layout = useMemo(() => layoutMap(tree, expanded), [tree, expanded]);

  // A new map, another level or another width: the branches are opened as the level says and the map is
  // fitted to the canvas (state adjusted while rendering). Opening or closing one branch is not here: it
  // changes `expanded`, and the zoom and the place stay.
  const [shownFor, setShownFor] = useState({ tree, level, width: size.width });
  if (shownFor.tree !== tree || shownFor.level !== level || shownFor.width !== size.width) {
    const reopened = shownFor.tree !== tree || shownFor.level !== level;
    const open = reopened ? expandedForLevel(tree, level) : expanded;
    setShownFor({ tree, level, width: size.width });
    if (reopened) {
      setExpanded(open);
      setSelected(null);
    }
    if (size.width > 0) setView(fitView(layoutMap(tree, open).bounds, size.width, size.height));
  }

  // What the touches, the buttons and the circles do is in `controls`, made once; it reads what it needs
  // from the screen after each render and puts a new view in at once, so two events in a row never read an
  // old one
  const [controls] = useState(() => createControls({ view, size, layout, expanded, tree }, setView, setExpanded));
  useEffect(() => {
    Object.assign(controls.live, { view, size, layout, expanded, tree });
  });
  const { toggle, zoomBy, fit } = controls;

  const picture = useMemo(() => <MapPicture layout={layout} selected={selected} onToggle={toggle} onSelect={setSelected} />, [layout, selected, toggle]);

  // The picture is drawn at twice its size so the text stays sharp when it is saved
  useEffect(() => {
    if (!onExporter) return;
    const scale = Math.min(2, 4000 / Math.max(layout.bounds.w, layout.bounds.h, 1));
    const snapshot = () =>
      new Promise<string | null>((resolve) => {
        const svg = svgRef.current;
        if (!svg || typeof svg.toDataURL !== 'function') return resolve(null);
        // The system may never answer; the screen then falls back to sharing the map as text
        const timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS);
        const answer = (base64: string | null) => {
          clearTimeout(timer);
          resolve(base64 || null);
        };
        try {
          svg.toDataURL((base64: string) => answer(base64), { width: Math.round(layout.bounds.w * scale), height: Math.round(layout.bounds.h * scale) });
        } catch {
          answer(null);
        }
      });
    onExporter({
      // The background is only put in while the picture is taken, so on screen the dots show through
      toPngBase64: async () => {
        setExporting(true);
        try {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return await snapshot();
        } finally {
          setExporting(false);
        }
      },
    });
    return () => onExporter(null);
  }, [layout, onExporter]);
  const chosen = layout.nodes.find((n) => n.id === selected) ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Text style={styles.barLabel}>Levels</Text>
        {LEVELS.map((l) => (
          <Chip key={l.label} label={l.label} active={level === l.value} onPress={() => setLevel(l.value)} />
        ))}
        <View style={styles.spacer} />
        <Chip label="−" active={false} onPress={() => zoomBy(1 / 1.25)} />
        <Chip label="Fit" active={false} onPress={fit} />
        <Chip label="+" active={false} onPress={() => zoomBy(1.25)} />
      </View>

      <View
        ref={(node) => controls.setCanvas(node)}
        testID="mind-map-canvas"
        style={styles.canvas}
        onLayout={(e: LayoutChangeEvent) => {
          setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
          controls.measure();
        }}
        {...controls.responder.panHandlers}>
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Pattern id="dots" width={26 * view.k} height={26 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
              <Circle cx={1} cy={1} r={1} fill={MAP_THEME.dot} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#dots)" />
        </Svg>
        <View
          testID="mind-map-layer"
          style={[
            styles.layer,
            {
              width: layout.bounds.w,
              height: layout.bounds.h,
              transformOrigin: 'top left',
              // The layer's corner is the map's top left; the view is where the map's centre is
              transform: [{ translateX: view.x + layout.bounds.minX * view.k }, { translateY: view.y + layout.bounds.minY * view.k }, { scale: view.k }],
            },
          ]}>
          <Svg ref={svgRef} width={layout.bounds.w} height={layout.bounds.h} viewBox={`${layout.bounds.minX} ${layout.bounds.minY} ${layout.bounds.w} ${layout.bounds.h}`}>
            {exporting ? <Rect x={layout.bounds.minX} y={layout.bounds.minY} width={layout.bounds.w} height={layout.bounds.h} fill={MAP_THEME.canvas} /> : null}
            {picture}
          </Svg>
        </View>
      </View>

      {chosen ? (
        <Card style={styles.detail}>
          <Text style={[styles.detailTitle, chosen.depth > 0 && { color: branchPalette(chosen.hue).sub }]}>{chosen.label}</Text>
          {chosen.note ? <Text style={styles.detailNote}>{chosen.note}</Text> : null}
          {chosen.childCount > 0 && chosen.depth > 0 ? (
            <View style={styles.detailRow}>
              <Button small label={chosen.expanded ? 'Collapse' : `Expand (${chosen.childCount})`} onPress={() => toggle(chosen.id)} />
            </View>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

interface Live {
  view: MapView;
  size: { width: number; height: number };
  layout: MapLayout;
  expanded: Set<string>;
  tree: TreeNode;
}

// The handlers of the map. Made once, outside the render: `live` is what the screen showed after its last
// render, and the view the handlers change is put in `live` at once as well as on the screen.
function createControls(
  init: Live,
  setView: (v: MapView) => void,
  setExpanded: (e: Set<string>) => void,
) {
  let canvas: View | null = null;
  const live = { ...init, origin: { x: 0, y: 0 } };
  let gesture: GestureBase | null = null;

  const put = (next: MapView) => {
    const settled = keepInReach(next, live.layout.bounds, live.size.width, live.size.height);
    live.view = settled;
    setView(settled);
  };
  // Where the canvas is on the screen: the touches are in screen points
  const measure = () => {
    if (canvas && typeof canvas.measureInWindow === 'function') {
      canvas.measureInWindow((x, y) => {
        live.origin = { x, y };
      });
    }
  };
  const responder = PanResponder.create({
    // Taps go to the nodes; a move of a few points is a pan or a pinch
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4 || g.numberActiveTouches > 1,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      gesture = beginGesture(live.view, touchesOf(e));
      measure();
    },
    onPanResponderMove: (e) => {
      const touches = touchesOf(e);
      if (!gesture) gesture = beginGesture(live.view, touches);
      const step = stepGesture(gesture, touches, live.origin);
      gesture = step.base;
      put(step.view);
    },
    onPanResponderRelease: () => {
      gesture = null;
    },
    onPanResponderTerminate: () => {
      gesture = null;
    },
  });

  return {
    live,
    measure,
    setCanvas: (node: View | null) => {
      canvas = node;
    },
    responder,
    fit: () => put(fitView(live.layout.bounds, live.size.width, live.size.height)),
    zoomBy: (factor: number) => put(zoomAbout(live.view, factor, { x: live.size.width / 2, y: live.size.height / 2 })),
    // Opens or closes a branch. The branch that was touched stays under the finger and the zoom is not
    // touched: the others make room around it.
    toggle: (id: string) => {
      const next = new Set(live.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const before = live.layout.nodes.find((n) => n.id === id);
      const after = layoutMap(live.tree, next).nodes.find((n) => n.id === id);
      if (before && after) put(keepNodeInPlace(live.view, before, after));
      live.expanded = next;
      setExpanded(next);
    },
  };
}

function MapPicture({ layout, selected, onToggle, onSelect }: { layout: MapLayout; selected: string | null; onToggle: (id: string) => void; onSelect: (id: string | null) => void }) {
  return (
    <>
      <G fill="none" strokeLinecap="round">
        {layout.edges.map((e) => (
          <Path key={e.id} d={e.d} stroke={branchPalette(e.hue).edge} strokeWidth={e.width} />
        ))}
      </G>
      {layout.nodes.map((n) => (
        <MapNode key={n.id} node={n} selected={n.id === selected} onToggle={onToggle} onSelect={onSelect} />
      ))}
    </>
  );
}

function MapNode({ node: n, selected, onToggle, onSelect }: { node: LaidNode; selected: boolean; onToggle: (id: string) => void; onSelect: (id: string | null) => void }) {
  const st = styleOf(n.depth);
  const p = branchPalette(n.hue);
  const fill = n.depth === 0 ? MAP_THEME.accent : n.depth === 1 ? p.mainFill : n.depth === 2 ? p.subFill : p.leafFill;
  const stroke = n.depth === 0 ? 'none' : n.depth === 1 ? p.mainStroke : n.depth === 2 ? p.subStroke : 'none';
  const ink = n.depth === 0 ? '#ffffff' : n.depth === 1 ? p.mainText : n.depth === 2 ? MAP_THEME.text : MAP_THEME.text2;
  const cx = n.side > 0 ? n.w + TOGGLE_OFFSET : -TOGGLE_OFFSET;
  const cy = n.h / 2;
  return (
    <G x={n.x} y={n.y} testID={`map-node-${n.label}`} accessibilityLabel={n.label}>
      {selected ? <Rect x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={st.radius + 4} fill="none" stroke={MAP_THEME.accent} strokeWidth={2} /> : null}
      <Rect width={n.w} height={n.h} rx={st.radius} fill={fill} stroke={stroke} strokeWidth={n.depth === 1 ? 1.25 : 1} onPress={() => onSelect(selected ? null : n.id)} />
      {n.lines.map((line, i) => (
        <SvgText
          key={i}
          x={n.depth === 0 ? n.w / 2 : st.padX}
          y={st.padY + i * st.lh + st.lh / 2 + st.size * 0.35}
          fontSize={st.size}
          fontWeight={st.weight}
          fill={ink}
          textAnchor={n.depth === 0 ? 'middle' : 'start'}
          onPress={() => onSelect(selected ? null : n.id)}>
          {line}
        </SvgText>
      ))}
      {n.childCount > 0 && n.depth > 0 ? (
        <G onPress={() => onToggle(n.id)} testID={`map-toggle-${n.label}`} accessibilityLabel={n.expanded ? `Close ${n.label}` : `Open ${n.label} (${n.childCount})`}>
          <Line x1={n.side > 0 ? n.w : 0} y1={cy} x2={cx} y2={cy} stroke={p.edge} strokeWidth={1.8} strokeLinecap="round" />
          {/* A bigger, invisible circle catches the finger */}
          <Circle cx={cx} cy={cy} r={TOGGLE_R + 8} fill="transparent" />
          <Circle cx={cx} cy={cy} r={TOGGLE_R} fill={n.expanded ? MAP_THEME.canvas : p.mainFill} stroke={p.edge} strokeWidth={1.4} />
          {n.expanded ? (
            <Line x1={cx - 3.5} y1={cy} x2={cx + 3.5} y2={cy} stroke={p.edge} strokeWidth={1.6} strokeLinecap="round" />
          ) : (
            <SvgText x={cx} y={cy + 3.5} fontSize={10} fontWeight="600" fill={p.mainText} textAnchor="middle">
              {String(n.childCount)}
            </SvgText>
          )}
        </G>
      ) : null}
    </G>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Gap.s },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  barLabel: { color: W.muted, fontSize: 12, fontWeight: '600' },
  spacer: { flex: 1 },
  canvas: { height: CANVAS_HEIGHT, borderRadius: 16, overflow: 'hidden', backgroundColor: MAP_THEME.canvas, borderWidth: 1, borderColor: W.line },
  layer: { position: 'absolute', left: 0, top: 0 },
  detail: { gap: 6 },
  detailTitle: { color: W.text, fontSize: 15, fontWeight: '700' },
  detailNote: { color: W.muted, fontSize: 13, lineHeight: 19 },
  detailRow: { flexDirection: 'row' },
});
