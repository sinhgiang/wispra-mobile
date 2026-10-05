import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Button, Card, Chip, Label } from './ui';

import { Gap, W } from '@/constants/wispra';
import { formatDuration, type Entry } from '@/lib/entries';
import { formatClock, seekPosition, seekShare, type ActionItem } from '@/lib/meeting';
import { audioExists } from '@/lib/storage';

export function TabChips<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips} testID="meeting-tabs">
      {tabs.map((t) => (
        <Chip key={t.value} label={t.label} active={value === t.value} onPress={() => onChange(t.value)} />
      ))}
    </ScrollView>
  );
}

// Summary text as the AI writes it: paragraphs, "## " headings and "- " bullets
export function SummaryText({ text }: { text: string }) {
  const blocks = text.split('\n').map((l) => l.trimEnd());
  return (
    <View style={styles.summary}>
      {blocks.map((line, i) => {
        if (!line.trim()) return <View key={i} style={styles.gap} />;
        if (line.startsWith('## ')) return <Text key={i} style={styles.heading}>{line.slice(3)}</Text>;
        if (/^\s*[-•]\s+/.test(line))
          return (
            <View key={i} style={styles.bullet}>
              <Text style={styles.dot}>•</Text>
              <Text style={styles.body}>{line.replace(/^\s*[-•]\s+/, '')}</Text>
            </View>
          );
        return (
          <Text key={i} style={styles.body}>
            {line}
          </Text>
        );
      })}
    </View>
  );
}

export function ActionList({ actions, onToggle }: { actions: ActionItem[]; onToggle?: (index: number) => void }) {
  return (
    <View style={styles.actions}>
      {actions.map((a, i) => (
        <Pressable
          key={`${a.text}-${i}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!a.done }}
          disabled={!onToggle}
          onPress={() => onToggle?.(i)}
          style={styles.action}>
          <View style={[styles.box, a.done && styles.boxDone]}>{a.done ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={[styles.body, styles.actionText, a.done && styles.doneText]}>
            {a.owner ? `${a.owner}: ` : ''}
            {a.text}
            {a.due ? ` (${a.due})` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// The mind map, drawn like the computer's (T-0164)
export { MindMapView } from './mind-map-canvas';

interface Source {
  uri: string;
  startMs: number;
  durationMs: number;
}

// Plays a meeting from its pieces one after the other, as one recording
export function MeetingPlayer({ entry, seekRequest }: { entry: Entry; seekRequest?: { ms: number; n: number } }) {
  const sources = useMemo<Source[]>(() => {
    if (entry.segments) {
      return [...entry.segments]
        .filter((s) => s.uri && s.status !== 'recording' && audioExists(s.uri))
        .sort((a, b) => a.startMs - b.startMs)
        .map((s) => ({ uri: s.uri!, startMs: s.startMs, durationMs: s.durationMs }));
    }
    return entry.audioUri && audioExists(entry.audioUri) ? [{ uri: entry.audioUri, startMs: 0, durationMs: entry.durationMs }] : [];
  }, [entry]);

  const [index, setIndex] = useState(0);
  const player = useAudioPlayer(sources[0]?.uri ?? null);
  const status = useAudioPlayerStatus(player);
  // What to do once the next piece has loaded: where to start and whether to play
  const pending = useRef<{ offsetMs: number; play: boolean } | null>(null);
  const totalMs = entry.durationMs || sources.reduce((sum, s) => sum + s.durationMs, 0);

  const load = (i: number, offsetMs: number, play: boolean) => {
    if (!sources[i]) return;
    pending.current = { offsetMs, play };
    if (i === index) {
      player.seekTo(offsetMs / 1000);
      if (play) player.play();
      pending.current = null;
      return;
    }
    setIndex(i);
    player.replace(sources[i].uri);
  };

  useEffect(() => {
    if (!pending.current || !status.isLoaded) return;
    const { offsetMs, play } = pending.current;
    pending.current = null;
    if (offsetMs > 0) player.seekTo(offsetMs / 1000);
    if (play) player.play();
  }, [player, status.isLoaded, index]);

  // At the end of a piece, carry on with the next one
  useEffect(() => {
    if (status.didJustFinish && index < sources.length - 1) load(index + 1, 0, true);
    // load depends on index and sources, both listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  // Plays from a moment of the meeting (a bookmark, a line of the transcript)
  const jump = (ms: number) => {
    const i = locateIndex(sources, ms);
    load(i, Math.max(0, ms - (sources[i]?.startMs ?? 0)), true);
  };

  // The seek bar: goes to that moment, playing on if it was playing
  const seek = (ms: number) => {
    const i = locateIndex(sources, ms);
    load(i, Math.max(0, ms - (sources[i]?.startMs ?? 0)), status.playing);
  };

  useEffect(() => {
    if (seekRequest) jump(seekRequest.ms);
    // Runs when a new seek is asked for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.n]);

  if (sources.length === 0) {
    return (
      <Card>
        <Label>Recording</Label>
        <Text style={styles.note}>The audio is not on this phone.</Text>
      </Card>
    );
  }

  const positionMs = (sources[index]?.startMs ?? 0) + status.currentTime * 1000;
  const toggle = () => {
    if (status.playing) player.pause();
    else if (status.didJustFinish && index === sources.length - 1) load(0, 0, true);
    else player.play();
  };

  return (
    <Card>
      <Label>Recording</Label>
      <SeekBar positionMs={positionMs} totalMs={totalMs} onSeek={seek} />
      <View style={styles.row}>
        <Button small kind="primary" label={status.playing ? 'Pause' : 'Play'} onPress={toggle} />
        <Text style={styles.note}>
          {formatDuration(positionMs)} / {formatDuration(totalMs)}
        </Text>
      </View>
      {entry.bookmarks.length > 0 ? (
        <View style={styles.marks}>
          <Text style={styles.section}>Bookmarks</Text>
          {entry.bookmarks.map((ms, i) => (
            <Pressable key={`${ms}-${i}`} accessibilityRole="button" onPress={() => jump(ms)} style={styles.mark}>
              <Text style={styles.body}>Bookmark {i + 1}</Text>
              <Text style={styles.note}>{formatClock(ms)} ›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// A bar from the start of the meeting to its end: tap or drag to any moment (T-0164). While the
// finger is down it shows where it will go; the recording moves there when the finger lifts.
export function SeekBar({ positionMs, totalMs, onSeek }: { positionMs: number; totalMs: number; onSeek: (ms: number) => void }) {
  const [width, setWidth] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const live = useRef({ width, totalMs, onSeek });
  live.current = { width, totalMs, onSeek };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => setDragMs(seekPosition(e.nativeEvent.locationX, live.current.width, live.current.totalMs)),
        onPanResponderMove: (e) => setDragMs(seekPosition(e.nativeEvent.locationX, live.current.width, live.current.totalMs)),
        onPanResponderRelease: (e) => {
          const ms = seekPosition(e.nativeEvent.locationX, live.current.width, live.current.totalMs);
          setDragMs(null);
          live.current.onSeek(ms);
        },
        onPanResponderTerminate: () => setDragMs(null),
      }),
    [],
  );

  const shown = dragMs ?? positionMs;
  const share = seekShare(shown, totalMs);
  return (
    <View style={styles.seek}>
      <View
        {...responder.panHandlers}
        testID="seek-bar"
        accessibilityRole="adjustable"
        accessibilityLabel="Position in the recording"
        accessibilityValue={{ min: 0, max: Math.round(totalMs / 1000), now: Math.round(shown / 1000), text: formatDuration(shown) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onSeek(Math.min(totalMs, Math.max(0, positionMs + (e.nativeEvent.actionName === 'increment' ? 10_000 : -10_000))))}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={styles.seekTouch}>
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: `${share * 100}%` }]} />
        </View>
        <View style={[styles.seekThumb, { left: Math.max(0, share * width - 8) }]} pointerEvents="none" />
      </View>
      <View style={styles.seekTimes}>
        <Text style={styles.note}>{formatDuration(shown)}</Text>
        <Text style={styles.note}>{formatDuration(totalMs)}</Text>
      </View>
    </View>
  );
}

function locateIndex(sources: Source[], ms: number): number {
  for (let i = sources.length - 1; i >= 0; i--) if (ms >= sources[i].startMs) return i;
  return 0;
}

const styles = StyleSheet.create({
  // A horizontal list takes all the height it can unless told not to grow, and a ScrollView shrinks by
  // default: with the ask bar and the keyboard below, the tabs were squeezed and the content slid over
  // them (T-0164). Fixed height, never shrinks, its own background and a line under it.
  chipBar: { flexGrow: 0, flexShrink: 0, minHeight: 48, backgroundColor: W.bg, borderBottomWidth: 1, borderBottomColor: W.line, zIndex: 1 },
  chips: { gap: Gap.s, paddingHorizontal: Gap.xl, paddingVertical: Gap.s, alignItems: 'center' },
  summary: { gap: 6 },
  gap: { height: 4 },
  heading: { color: W.accentSoft, fontSize: 14, fontWeight: '600', marginTop: 4 },
  body: { color: W.text, fontSize: 14, lineHeight: 21 },
  bullet: { flexDirection: 'row', gap: Gap.s, paddingRight: Gap.s },
  dot: { color: W.accentSoft, fontSize: 14, lineHeight: 21 },
  actions: { gap: 10 },
  action: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: '#4b5563', marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  boxDone: { backgroundColor: W.accent, borderColor: W.accent },
  tick: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  actionText: { flex: 1 },
  doneText: { color: W.muted, textDecorationLine: 'line-through' },
  note: { color: W.muted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Gap.s },
  section: { color: W.accentSoft, fontSize: 13, fontWeight: '600' },
  marks: { gap: 2, marginTop: Gap.xs },
  mark: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seek: { gap: 4, marginTop: Gap.xs },
  // Tall enough to catch a finger; the track itself is thin
  seekTouch: { height: 32, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: W.line, overflow: 'hidden' },
  seekFill: { height: '100%', backgroundColor: W.accent },
  seekThumb: { position: 'absolute', top: 8, width: 16, height: 16, borderRadius: 8, backgroundColor: W.accentSoft },
  seekTimes: { flexDirection: 'row', justifyContent: 'space-between' },
});
