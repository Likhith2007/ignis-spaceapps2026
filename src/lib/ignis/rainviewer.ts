// IGNIS RainViewer bridge — keyless live weather radar + IR satellite clouds
// (public API: https://www.rainviewer.com/api/weather-maps-api.html).
// Zoom Earth-style "live weather" layer pair for the Layers popover.
// Tile path template: {z}/{x}/{y} + /256/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png

export type RainFrames = {
  radarPath: string | null;   // latest past radar frame path (UTC epoch seconds in the path)
  radarTime: number | null;   // unix seconds
  cloudPath: string | null;   // latest infrared satellite frame
  cloudTime: number | null;
  fetchedAt: number;
};

const CACHE_TTL = 5 * 60 * 1000; // RainViewer refreshes ~every 10 min; 5 min is safe
let cache: { frames: RainFrames | null; at: number } | null = null;
let inflight: Promise<RainFrames | null> | null = null;

export function rainTileUrl(path: string, kind: 'radar' | 'cloud'): string {
  // color scheme 2 (universal blue), smooth 1, snow 1 for radar; IR: color 0, smooth 0
  return kind === 'radar'
    ? `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`
    : `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/0/0_0.png`;
}

export async function fetchRainFrames(): Promise<RainFrames | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.frames;
  if (inflight) return inflight;
  inflight = (async (): Promise<RainFrames | null> => {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`rainviewer ${res.status}`);
      const d = await res.json();
      const past = d?.radar?.past as Array<{ time: number; path: string }> | undefined;
      const ir = d?.satellite?.infrared as Array<{ time: number; path: string }> | undefined;
      const frames: RainFrames = {
        radarPath: past?.length ? past[past.length - 1].path : null,
        radarTime: past?.length ? past[past.length - 1].time : null,
        cloudPath: ir?.length ? ir[ir.length - 1].path : null,
        cloudTime: ir?.length ? ir[ir.length - 1].time : null,
        fetchedAt: Date.now(),
      };
      cache = { frames, at: Date.now() };
      return frames;
    } catch {
      cache = { frames: null, at: Date.now() };
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
