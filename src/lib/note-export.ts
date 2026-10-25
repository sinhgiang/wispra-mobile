import { mapAsText } from './notes';
import type { MindMap } from './meeting';

// "Tải xuống" on the mind map of a note. The map is drawn by the phone; the picture is saved as a PNG
// in the cache and handed to the system's share sheet (Save Image, Save to Files, Messages…). Only the
// iPhone's share sheet takes a file from React Native's own Share; on Android the map goes as text
// (an image share there needs the expo-sharing package, which this step does not add).

export interface ExportDeps {
  platform: 'ios' | 'android' | 'other';
  // The map drawn as a PNG, base64 (react-native-svg's toDataURL); null when it cannot be drawn
  toPngBase64(): Promise<string | null>;
  // Writes the picture to a file the share sheet can read; returns its address
  saveToCache(base64: string, name: string): string;
  shareFile(uri: string, title: string): Promise<void>;
  shareText(title: string, message: string): Promise<void>;
}

export type ExportResult = 'image' | 'text';

export function mapFileName(title: string, now: Date = new Date()): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `wispra-so-do-${slug || 'ghi-chu'}-${now.getTime()}.png`;
}

export async function downloadMap(map: MindMap, title: string, deps: ExportDeps): Promise<ExportResult> {
  if (deps.platform === 'ios') {
    const base64 = await deps.toPngBase64();
    if (base64) {
      await deps.shareFile(deps.saveToCache(base64, mapFileName(title)), title);
      return 'image';
    }
  }
  await deps.shareText(title, mapAsText(map));
  return 'text';
}
