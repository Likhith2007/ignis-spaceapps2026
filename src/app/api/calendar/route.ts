import { NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCalendar, tilesForBbox, HARMONIZATION_SENSORS } from '@/lib/ignis/calendarBuilder';
import type { CalendarDoc } from '@/lib/ignis/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/calendar?region=amazon            → precomputed 26-year calendar (preset regions)
 * GET /api/calendar?w=&s=&e=&n=[&name=]      → on-demand calendar for ANY custom AOI,
 *     built from the NASA GIBS vector archive with the same builder as the precompute
 *     (scripts/ignis/build_calendar.mjs), restricted to the sensors the harmonized series
 *     needs. Cached in memory + on disk (tmp) by bbox rounded to 0.1°.
 */

// A custom build fetches ~590 sensor-months × 2 days × N tiles. Cap N so a request
// finishes well inside maxDuration; larger areas should use a preset region.
const MAX_TILES = 4;
const CACHE_DIR = path.join(os.tmpdir(), 'ignis-calendar-cache');
const CACHE_VERSION = 'v2'; // v2: MODIS Aqua included (same-overpass harmonization)
const memCache = new Map<string, CalendarDoc>();
const inflight = new Map<string, Promise<CalendarDoc>>();

const round1 = (v: number) => Math.round(v * 10) / 10;

function readDiskCache(key: string): CalendarDoc | null {
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as CalendarDoc) : null;
  } catch {
    return null;
  }
}

function writeDiskCache(key: string, doc: CalendarDoc) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(doc));
  } catch {
    /* read-only FS — memory cache still works */
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ---------- custom AOI ----------
  if (searchParams.has('w')) {
    const [w, s, e, n] = ['w', 's', 'e', 'n'].map((k) => round1(Number(searchParams.get(k))));
    if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s || w < -180 || e > 180 || s < -90 || n > 90) {
      return NextResponse.json({ error: 'invalid bbox' }, { status: 400 });
    }
    const bbox = [w, s, e, n];
    const tiles = tilesForBbox(bbox).length;
    if (tiles > MAX_TILES) {
      return NextResponse.json(
        { error: `AOI spans ${tiles} archive tiles (max ${MAX_TILES}) — draw a smaller box (≈ up to 9°×9°) or use a preset region for continental areas.` },
        { status: 413 },
      );
    }
    const name = (searchParams.get('name') || '').slice(0, 80) || `Custom AOI ${w},${s},${e},${n}`;
    const key = `${CACHE_VERSION}_${bbox.join('_')}`.replace(/[^0-9a-z_.-]/gi, '');

    const cached = memCache.get(key) ?? readDiskCache(key);
    if (cached) {
      memCache.set(key, cached);
      return NextResponse.json({ ...cached, name }, { headers: { 'X-Ignis-Cache': 'hit' } });
    }

    let job = inflight.get(key);
    if (!job) {
      job = buildCalendar({
        key: 'custom', name, bbox,
        note: 'On-demand calendar for a user-defined area (GIBS archive, 2 sampled days/month).',
        sensors: HARMONIZATION_SENSORS, samples: 2, concurrency: 48,
      }).then((doc) => {
        memCache.set(key, doc);
        writeDiskCache(key, doc);
        return doc;
      }).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    try {
      const doc = await job;
      return NextResponse.json({ ...doc, name }, { headers: { 'X-Ignis-Cache': 'miss' } });
    } catch (err) {
      return NextResponse.json({ error: `calendar build failed: ${String(err)}` }, { status: 502 });
    }
  }

  // ---------- preset region ----------
  const region = (searchParams.get('region') || 'amazon').replace(/[^a-z]/g, '');
  const file = path.join(process.cwd(), 'data', 'ignis', `calendar_${region}.json`);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ status: 'building', message: 'Calendar precompute still running — try again shortly.' }, { status: 202 });
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return NextResponse.json(json);
}
