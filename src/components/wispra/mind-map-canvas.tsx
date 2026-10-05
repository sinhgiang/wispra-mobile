import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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
} from '@/lib/mind-map-layout';

// The mind map as on the computer (T-0164): the picture is laid out by lib/mind-map-layout.ts and
// drawn here with SVG. One finger moves the map, two fingers zoom it; − Fit + do the same with
// buttons. A circle on a branch opens or closes it; tapping a node shows it in a card below.

const LEVELS: { value: number; label: string }[] = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 0, label: 'All' },
];
const MIN_K = 0.15;
const MAX_K = 2.5;
const CANVAS_HEIGHT = 440;
const PAD = 24;

interface View2 {
  x: number;
  y: number;
  k: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fitView(layout: MapLayout, width: number, height: number): View2 {
  const { w, h } = layout.bounds;
  const k = clamp(Math.min((width - PAD * 2) / Math.max(w, 1), (height - PAD * 2) / Math.max(h, 1), 1.15), MIN_K, MAX_K);
  return { x: (width - w * k) / 2, y: (height - h * k) / 2, k };
}

export function MindMapView({ map }: { map: MindMap }) {
  const tree = useMemo(() => buildTree(map), [map]);
  const [level, setLevel] = useState(2);
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedForLevel(tree, 2));
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: CANVAS_HEIGHT });
  const [view, setView] = useState<View2>({ x: 0, y: 0, k: 1 });
  const layout = useMemo(() => layoutMap(tree, expanded), [tree, expanded]);

  // A new map, or another level: everything is fitted to the canvas again
  useEffect(() => {
    setExpanded(expandedForLevel(tree, level));
    setSelected(null);
  }, [tree, level]);
  useEffect(() => {
    if (size.width > 0) setView(fitView(layout, size.width, size.height));
    // Fitted when the shape of the map changes, not on every pan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, size.width]);

  const live = useRef({ view, size });
  live.current = { view, size };
  const gesture = useRef<{ start: View2; dist: number; mid: { x: number; y: number } } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Taps go to the nodes; a move of a few points is a pan or a pinch
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4 || g.numberActiveTouches > 1,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          gesture.current = { start: live.current.view, dist: 0, mid: { x: 0, y: 0 } };
        },
        onPanResponderMove: (e, g) => {
          const state = gesture.current;
          if (!state) return;
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const [a, b] = touches;
            const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            const mid = { x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 };
            if (state.dist === 0) {
              state.dist = dist;
              state.mid = mid;
              state.start = live.current.view;
              return;
            }
            const k = clamp(state.start.k * (dist / state.dist), MIN_K, MAX_K);
            // The point under the fingers stays under the fingers
            const px = (state.mid.x - state.start.x) / state.start.k;
            const py = (state.mid.y - state.start.y) / state.start.k;
            setView({ k, x: mid.x - px * k, y: mid.y - py * k });
            return;
          }
          if (state.dist !== 0) return;
          setView({ ...state.start, x: state.start.x + g.dx, y: state.start.y + g.dy });
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
        onPanResponderTerminate: () => {
          gesture.current = null;
        },
      }),
    [],
  );

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const cx = size.width / 2;
      const cy = size.height / 2;
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const picture = useMemo(() => <MapPicture layout={layout} selected={selected} onToggle={toggle} onSelect={setSelected} />, [layout, selected]);
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
        <Chip label="Fit" active={false} onPress={() => setView(fitView(layout, size.width, size.height))} />
        <Chip label="+" active={false} onPress={() => zoomBy(1.25)} />
      </View>

      <View
        testID="mind-map-canvas"
        style={styles.canvas}
        onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        {...responder.panHandlers}>
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Pattern id="dots" width={26 * view.k} height={26 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
              <Circle cx={1} cy={1} r={1} fill={MAP_THEME.dot} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#dots)" />
        </Svg>
        <View
          style={[
            styles.layer,
            {
              width: layout.bounds.w,
              height: layout.bounds.h,
              transformOrigin: 'top left',
              transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.k }],
            },
          ]}>
          <Svg width={layout.bounds.w} height={layout.bounds.h} viewBox={`${layout.bounds.minX} ${layout.bounds.minY} ${layout.bounds.w} ${layout.bounds.h}`}>
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
