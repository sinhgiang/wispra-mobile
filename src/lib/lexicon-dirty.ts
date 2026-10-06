// Tells the sync that the phone's own lists changed (the person added, removed or fixed a word), so it runs
// soon. A word saved by the sync itself is saved quietly and does not call this.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onWordsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markWordsChanged(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // A listener's trouble is not the saving's
    }
  }
}
