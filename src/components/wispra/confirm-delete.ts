import { Alert } from 'react-native';

import type { DeleteWarning } from '@/lib/history-delete';

// The warning before anything is deleted: says what goes and where, and the button says it again
export function confirmDelete(warning: DeleteWarning, onConfirm: () => void): void {
  Alert.alert(warning.title, warning.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: warning.confirm, style: 'destructive', onPress: onConfirm },
  ]);
}
