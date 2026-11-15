// IGNIS — shared Burning-Activity-Calendar builder (MODIS + VIIRS, GIBS vector archive).
//
// Used by BOTH:
//   • scripts/ignis/build_calendar.mjs  — offline precompute of the preset regions
//     (Node ≥ 22.18 / 23.6 imports this .ts file directly via native type stripping)
//   • /api/calendar?w&s&e&n            — on-demand calendar for any custom AOI
//
// Keep this file free of path aliases (`@/…`) and runtime-only TS syntax (enums,
// parameter properties) so plain Node can load it.
//
// Source: NASA GIBS WMTS vector tiles (FIRMS-derived MODIS C6.1 / VIIRS V2 thermal
// anomalies with the full FIRMS attribute schema per pixel). z5 tiles = 9°×9°.
import zlib from 'node:zlib';
import Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import type { CalendarDoc, MonthRow } from './types';

export type CalSensor = {
  key: string;
  layer: string;
  tms: string;
  /** first archive month [year, month] */
  start: [number, number];
  /** last archive month [year, month] */
  end: [number, number];
};

// Last COMPLETE calendar month (UTC) — the archive is current for every sensor except
// Suomi NPP, which stopped delivering new data on 2026-11-02 (last full month: 2026-10).
function lastCompleteMonth(): [number, number] {
  const d = new Date();
  const y = d.getUTCFullYear(), m = d.getUTCMonth(); // getUTCMonth() is 0-based → previous month, 1-based
  return m === 0 ? [y - 1, 12] : [y, m];
}
const NOW_END = lastCompleteMonth();
const SNPP_END: [number, number] = NOW_END[0] < 2026 || (NOW_END[0] === 2026 && NOW_END[1] < 10) ? NOW_END : [2026, 10];

export const CALENDAR_SENSORS: CalSensor[] = [
  { key: 'MODIS-Terra', layer: 'MODIS_Terra_Thermal_Anomalies_All', tms: '1km', start: [2000, 11], end: NOW_END },
  { key: 'MODIS-Aqua', layer: 'MODIS_Aqua_Thermal_Anomalies_All', tms: '1km', start: [2002, 7], end: NOW_END },
  { key: 'VIIRS-SNPP', layer: 'VIIRS_SNPP_Thermal_Anomalies_375m_All', tms: '500m', start: [2012, 1], end: SNPP_END },
  { key: 'VIIRS-NOAA20', layer: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', tms: '500m', start: [2020, 1], end: NOW_END },
  { key: 'VIIRS-NOAA21', layer: 'VIIRS_NOAA21_Thermal_Anomalies_375m_All', tms: '500m', start: [2024, 1], end: NOW_END },
];

/** Sensors the harmonized series actually needs (MODIS reference + VIIRS reference + VIIRS bridges). */
export const HARMONIZATION_SENSORS = ['MODIS-Terra', 'MODIS-Aqua', 'VIIRS-SNPP', 'VIIRS-NOAA20', 'VIIRS-NOAA21'];

export type BuildOptions = {
  key: string;
  name: string;
  note?: string;
  bbox: number[];
  /** subset of CALENDAR_SENSORS keys (default: all) */
  sensors?: string[];
  /** sampled days per month, or 'all' for an exact daily count (default 2 = the 8th & 22nd) */
  samples?: number | 'all';
  /** parallel tile requests (default 48) */
  concurrency?: number;
  /** abort the whole build (e.g. request cancelled) */
  signal?: AbortSignal;
  onMonth?: (sensor: string, ym: string) => void;
  /** called when a sensor is complete — lets the caller checkpoint long builds */
  onSensor?: (sensor: string, entry: CalendarDoc['sensors'][string]) => void;
  /** called before each retry round for failed tile downloads */
  onRetry?: (sensor: string, failed: number, pauseMs: number) => void;
};

// z5 grid: 40 cols × 20 rows of 9° tiles (valid for both the 1km and 500m TMS)
export function tilesForBbox([w, s, e, n]: number[]): [number, number][] {
  const out: [number, number][] = [];
  const c0 = Math.max(0, Math.floor((w + 180) / 9)), c1 = Math.min(39, Math.floor((e + 180) / 9));
  const r0 = Math.max(0, Math.floor((90 - n) / 9)), r1 = Math.min(19, Math.floor((90 - s) / 9));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([r, c]);
  return out;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Sample days for a month. n=2 keeps the historical 8th/22nd convention for reproducibility. */
export function sampleDays(y: number, m: number, samples: number | 'all'): number[] {
  const dim = daysInMonth(y, m);
  if (samples === 'all') return Array.from({ length: dim }, (_, i) => i + 1);
  const n = Math.max(1, Math.min(dim, Math.floor(samples)));
  if (n === 2) return [8, 22];
  // evenly spaced, centred in each 1/n slice of the month
  return Array.from({ length: n }, (_, i) => Math.min(dim, Math.max(1, Math.round(((i + 0.5) * dim) / n))));
}

type TileFeature = { lat: number; lon: number; frp: number; conf: number | null; night: boolean };

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// One tile request has four possible outcomes, and they must not be confused:
//   TileFeature[]  the tile's detections
//   []             a genuinely empty tile (GIBS answers 404): no fires there that day
//   'nodata'       GIBS answers 400: the layer has NO DATA for that date at all (for example
//                  VIIRS NOAA-21 on many days in 2024) — the day is left out of the sample
//   null           the download FAILED (throttling, 5xx, timeout) — retried, and a calendar
//                  is never written while any remain
type TileResult = TileFeature[] | 'nodata' | null;

async function fetchTile(layer: string, tms: string, day: string, r: number, c: number, signal?: AbortSignal): Promise<TileResult> {
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer}/default/${day}/${tms}/5/${r}/${c}.mvt`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) return null;
    if (attempt > 0) await sleep(1500 * attempt * attempt); // 1.5 s, 6 s, 13.5 s back-off
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 404) return []; // GIBS answers 404 for an empty tile
      if (res.status === 400) return 'nodata'; // the layer has no data for this date
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
      const tile = new VectorTile(new Protobuf(raw));
      const layerKey = Object.keys(tile.layers)[0];
      if (!layerKey) return [];
      const L = tile.layers[layerKey];
      const feats: TileFeature[] = [];
      for (let i = 0; i < L.length; i++) {
        const p = L.feature(i).properties as Record<string, string | number | boolean>;
        // MODIS confidence is 0-100; VIIRS is l/n/h → treat 'h' as high (≥80 equivalent)
        const rawConf = p.CONFIDENCE;
        const conf = typeof rawConf === 'number' ? rawConf : rawConf === 'h' ? 90 : rawConf === 'n' ? 60 : rawConf === 'l' ? 30 : null;
        feats.push({ lat: Number(p.LATITUDE), lon: Number(p.LONGITUDE), frp: Number(p.FRP) || 0, conf, night: String(p.DAYNIGHT) === 'N' });
      }
      return feats;
    } catch {
      /* network error or timeout — retried with back-off */
    } finally {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return null;
}

async function pool<T>(jobs: (() => Promise<T>)[], conc: number): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const idx = i++;
      results[idx] = await jobs[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
  return results;
}

export async function buildCalendar(opts: BuildOptions): Promise<CalendarDoc> {
  const samples = opts.samples ?? 2;
  const conc = opts.concurrency ?? 48;
  const wanted = opts.sensors ?? CALENDAR_SENSORS.map((s) => s.key);
  const sensors = CALENDAR_SENSORS.filter((s) => wanted.includes(s.key));
  const tiles = tilesForBbox(opts.bbox);
  const [w, s, e, n] = opts.bbox;
  const inBox = (f: TileFeature) => f.lon >= w && f.lon <= e && f.lat >= s && f.lat <= n;

  const sensorsOut: CalendarDoc['sensors'] = {};
  for (const sensor of sensors) {
    const [sy, sm] = sensor.start, [ey, em] = sensor.end;
    // Queue EVERY tile request of this sensor into one pool, so the concurrency limit is
    // actually used (a per-month pool would only ever run days×tiles requests at once).
    const months: { y: number; m: number; days: number[]; jobIdx: number[] }[] = [];
    const jobs: (() => Promise<TileResult>)[] = [];
    for (let y = sy; y <= ey; y++) {
      for (let m = y === sy ? sm : 1; m <= (y === ey ? em : 12); m++) {
        const days = sampleDays(y, m, samples);
        const jobIdx: number[] = [];
        for (const day of days) {
          const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          for (const [r, c] of tiles) {
            jobIdx.push(jobs.length);
            jobs.push(async () => {
              if (opts.signal?.aborted) throw new Error('aborted');
              const f = await fetchTile(sensor.layer, sensor.tms, ds, r, c, opts.signal);
              return f;
            });
          }
        }
        months.push({ y, m, days, jobIdx });
      }
    }
    const allRes = await pool(jobs, conc);
    // Second-chance rounds for failed downloads: slower and after a pause, so a server that
    // was throttling us has time to recover.
    for (const pauseMs of [20000, 60000, 180000]) {
      const failed = allRes.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
      if (!failed.length) break;
      opts.onRetry?.(sensor.key, failed.length, pauseMs);
      await sleep(pauseMs);
      const again = await pool(failed.map((i) => jobs[i]), Math.max(2, Math.floor(conc / 6)));
      failed.forEach((i, k) => { allRes[i] = again[k]; });
    }
    const stillFailed = allRes.filter((v) => v === null).length;
    if (stillFailed) {
      throw new Error(`${stillFailed} of ${allRes.length} tile downloads for ${sensor.key} failed after retries — refusing to write a calendar with missing data. Run again later (the archive may be throttling requests).`);
    }
    const monthly: MonthRow[] = [];
    const perDay = tiles.length; // jobIdx holds `perDay` consecutive tile jobs for each sampled day
    for (const { y, m, days, jobIdx } of months) {
      const dim = daysInMonth(y, m);
      let count = 0, frp = 0, hi = 0, night = 0, usedDays = 0;
      for (let d = 0; d < days.length; d++) {
        const dayRes = jobIdx.slice(d * perDay, (d + 1) * perDay).map((i) => allRes[i]);
        // a day the layer has no data for is not a fire-free day: leave it out of the sample
        if (dayRes.some((v) => v === 'nodata')) continue;
        usedDays++;
        for (const feats of dayRes) {
          if (!Array.isArray(feats)) continue;
          for (const f of feats) {
            if (!inBox(f)) continue;
            count++;
            frp += f.frp;
            if (f.conf === null || f.conf >= 80) hi++;
            if (f.night) night++;
          }
        }
      }
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      opts.onMonth?.(sensor.key, ym);
      if (!usedDays) continue; // the sensor has no data at all this month → no row (not a zero)
      const scale = dim / usedDays; // 1 when every day was sampled → exact count
      monthly.push({
        ym,
        sampled: count,
        days: usedDays,
        est: Math.round(count * scale),
        frp: Math.round(frp * scale),
        meanFrp: count ? +(frp / count).toFixed(1) : 0,
        hiConf: Math.round(hi * scale),
        night: Math.round(night * scale),
      });
    }
    opts.onSensor?.(sensor.key, { layer: sensor.layer, tms: sensor.tms, monthly });
    sensorsOut[sensor.key] = { layer: sensor.layer, tms: sensor.tms, monthly };
  }

  // raw overlap diagnostic (the app recomputes the seasonal coefficients in analytics.ts)
  const mod = sensorsOut['MODIS-Terra']?.monthly ?? [];
  const snpMap = new Map((sensorsOut['VIIRS-SNPP']?.monthly ?? []).map((x) => [x.ym, x]));
  const overlap = mod
    .filter((x) => { const v = snpMap.get(x.ym); return v && x.sampled > 0 && v.sampled > 0; })
    .map((x) => { const v = snpMap.get(x.ym)!; return { ym: x.ym, ratio: +(v.sampled / x.sampled).toFixed(3), m: x.sampled, s: v.sampled }; });
  const meanRatio = overlap.length ? +(overlap.reduce((a, b) => a + b.ratio, 0) / overlap.length).toFixed(3) : null;

  const sampling = samples === 'all'
    ? 'every day of every month (exact monthly counts)'
    : `${samples} evenly spaced sampled day(s)/month${samples === 2 ? ' (8th, 22nd)' : ''}, scaled to a monthly estimate`;
  return {
    region: opts.key,
    name: opts.name,
    note: opts.note ?? '',
    bbox: opts.bbox,
    sensors: sensorsOut,
    harmonization: { overlapMonths: overlap.length, meanRatioSNPPtoMODIS: meanRatio, sample: overlap.slice(-6) },
    meta: {
      method: `GIBS WMTS vector tiles (FIRMS-derived MODIS C6.1 / VIIRS V2 thermal anomalies), z5 9° tiles, ${sampling}, bbox-filtered. Sensors: ${sensors.map((x) => x.key).join(', ')}.`,
      source: 'NASA GIBS https://gibs.earthdata.nasa.gov · data NASA FIRMS/LANCE',
      generated: new Date().toISOString(),
    },
  };
}
