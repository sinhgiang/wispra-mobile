import { StyleSheet, Text, View } from 'react-native';

import { W } from '@/constants/wispra';
import { statusLabel, type NoteStatus } from '@/lib/notes';

// The colour of a status chip: new in the accent, kept grey, developing green, the others amber
export function statusColors(status: NoteStatus): { bg: string; fg: string } {
  switch (status) {
    case 'keep':
      return { bg: W.line, fg: W.muted };
    case 'develop':
      return { bg: '#1b3a2a', fg: W.green };
    case 'project':
    case 'remind':
      return { bg: '#3a2d18', fg: W.amberSoft };
    default:
      return { bg: '#272a52', fg: W.accentSoft };
  }
}

export function StatusPill({ status, short = true }: { status: NoteStatus; short?: boolean }) {
  const c = statusColors(status);
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{statusLabel(status, short)}</Text>
    </View>
  );
}

// The field of a note and where it stands, under the words in a list
export function NoteChips({ domain, status }: { domain?: string; status: NoteStatus }) {
  return (
    <View style={styles.chips}>
      {domain ? (
        <View style={[styles.chip, { backgroundColor: '#272a52' }]}>
          <Text style={[styles.chipText, { color: W.accentSoft }]}>{domain}</Text>
        </View>
      ) : null}
      <StatusPill status={status} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99 },
  chipText: { fontSize: 12 },
});
