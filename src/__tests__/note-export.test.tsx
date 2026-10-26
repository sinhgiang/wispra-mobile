// "Download" on the mind map of a note (T-0979): the picture goes to the share sheet on iPhone, the
// map goes as text where a file cannot be shared (Android), and the map view hands the screen what it
// needs to draw the picture.
import { describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';

import { MindMapView, SNAPSHOT_TIMEOUT_MS, type MapExporter } from '@/components/wispra/mind-map-canvas';
import { downloadMap, mapFileName, type ExportDeps } from '@/lib/note-export';
import { parseMindMap } from '@/lib/meeting';

const MAP = parseMindMap({
  title: 'Nền tảng tour',
  topics: [{ label: 'Khoảng trống', points: [{ label: 'Cao Bằng' }] }, { label: 'Rủi ro' }],
})!;

function deps(over: Partial<ExportDeps> = {}) {
  const calls: string[] = [];
  const d: ExportDeps = {
    platform: 'ios',
    toPngBase64: jest.fn(async () => 'AAAA'),
    saveToCache: jest.fn((base64: string, name: string) => {
      calls.push(`save:${base64}:${name}`);
      return `file:///cache/${name}`;
    }),
    shareFile: jest.fn(async (uri: string, title: string) => {
      calls.push(`file:${uri}:${title}`);
    }),
    shareText: jest.fn(async (title: string, message: string) => {
      calls.push(`text:${title}:${message}`);
    }),
    ...over,
  };
  return { d, calls };
}

describe('downloading a map', () => {
  it('on iPhone the picture is saved as a PNG and handed to the share sheet (Save Image, Save to Files…)', async () => {
    const { d, calls } = deps();
    expect(await downloadMap(MAP, 'Nền tảng tour', d)).toBe('image');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^save:AAAA:wispra-mind-map-nen-tang-tour-\d+\.png$/);
    expect(calls[1]).toMatch(/^file:file:\/\/\/cache\/wispra-mind-map-nen-tang-tour-\d+\.png:Nền tảng tour$/);
    expect(d.shareText).not.toHaveBeenCalled();
  });

  it('on iPhone, when the picture cannot be drawn, the map goes as text instead of nothing', async () => {
    const { d, calls } = deps({ toPngBase64: async () => null });
    expect(await downloadMap(MAP, 'Nền tảng tour', d)).toBe('text');
    expect(calls).toEqual(['text:Nền tảng tour:Nền tảng tour\n- Khoảng trống\n  - Cao Bằng\n- Rủi ro']);
  });

  it('on Android the map goes as text (an image share there needs a package this step does not add)', async () => {
    const { d, calls } = deps({ platform: 'android' });
    expect(await downloadMap(MAP, 'Nền tảng tour', d)).toBe('text');
    expect(d.toPngBase64).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('a share sheet that fails is reported, not hidden', async () => {
    const { d } = deps({ shareFile: async () => Promise.reject(new Error('cancelled by the system')) });
    await expect(downloadMap(MAP, 'x', d)).rejects.toThrow('cancelled by the system');
  });

  it('names the file from the title without accents or odd characters', () => {
    const at = new Date(1_700_000_000_000);
    expect(mapFileName('Đường đến Cao Bằng / Sapa?', at)).toBe('wispra-mind-map-duong-den-cao-bang-sapa-1700000000000.png');
    expect(mapFileName('???', at)).toBe('wispra-mind-map-note-1700000000000.png');
  });
});

describe('the map view', () => {
  it('hands the screen a way to take its picture, and takes it back when the map goes away', async () => {
    jest.useFakeTimers();
    try {
      const seen: (MapExporter | null)[] = [];
      const view = await render(<MindMapView map={MAP} onExporter={(e) => seen.push(e)} />);
      expect(seen[0]).not.toBeNull();
      expect(typeof seen[0]?.toPngBase64).toBe('function');
      // The system never answers here (no native view): after the wait the answer is null, never a hang
      let png: string | null = 'x';
      await act(async () => {
        const pending = seen[0]!.toPngBase64().then((p) => {
          png = p;
        });
        await jest.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS + 200);
        await pending;
      });
      expect(png).toBeNull();
      await view.unmount();
      expect(seen[seen.length - 1]).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
