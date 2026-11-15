import { NextResponse } from 'next/server';
import { getHotspotsRange } from '@/lib/ignis/firms';
import { classifyDetections, CLASSIFIER_META } from '@/lib/ignis/inference';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * IGNIS Search — the brief-critical "select a region and a specific date range,
 * then download analytics" endpoint.
 *
 * Given an AOI bbox + [start, end] date range it:
 *   1. fetches the harmonized multi-sensor hotspot record for every day (FIRMS
 *      NRT primary, GIBS vector fallback — reusing the production pipeline,
 *      which chunks ≤5-day windows internally; FIRMS semantics verified from
 *      the official docs: [DATE] .. [DATE + DAY_RANGE-1]),
 *   2. computes per-day / per-sensor / total analytics from the pipeline's
 *      authoritative counts (sn.count, meanFrp) so Σ(perDay) ≡ total exactly,
 *   3. scores every returned point with the IGNIS fire-behavior classifier on
 *      the PER-DAY MERGED cross-sensor set — the same feature contract used at
 *      training time ("per (AOI, day) across all sensors"),
 *   4. returns the point list (deduplicated across sensors/days, capped) for
 *      the client-side CSV/GeoJSON download.
 *
 * The sensor of origin is carried as a column but the analytics are computed
 * over the harmonized whole — exactly the challenge goal.
 */

const MAX_SPAN_DAYS = 45;      // protects the FIRMS MAP_KEY transaction budget
const MAX_POINTS = 20000;      // payload cap; per-day/per-sensor counts stay complete

type Row = {
  sensor: string; satellite: string;
  acq_date: string; acq_time_utc: string;
  latitude: number; longitude: number;
  frp_mw: number; confidence: number | null; confidence_raw: string;
  daynight: 'D' | 'N'; behavior: string; behavior_p: number | null;
};

function ymd(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const w = Number(searchParams.get('w')), s = Number(searchParams.get('s'));
  const e = Number(searchParams.get('e')), n = Number(searchParams.get('n'));
  const start = searchParams.get('start') || '';
  const end = searchParams.get('end') || '';

  if (![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) {
    return NextResponse.json({ error: 'invalid bbox' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    return NextResponse.json({ error: 'start/end must be YYYY-MM-DD with end >= start' }, { status: 400 });
  }
  const yesterday = ymd(Date.now() - 86400000);
  const clampedEnd = end > yesterday ? yesterday : end;
  const span = Math.round((Date.parse(clampedEnd) - Date.parse(start)) / 86400000) + 1;
  if (span > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: `range too long (${span} days) — max ${MAX_SPAN_DAYS} per search` }, { status: 400 });
  }
  if (span < 1) {
    return NextResponse.json({ error: 'empty range' }, { status: 400 });
  }

  try {
    const days: string[] = [];
    for (let t = Date.parse(start); t <= Date.parse(clampedEnd); t += 86400000) days.push(ymd(t));
    const multi = await getHotspotsRange([w, s, e, n], days);

    const rows: Row[] = [];
    let truncated = false;
    let classified = 0;
    const perDay: { date: string; count: number; frp: number }[] = [];
    const perSensorAgg: Record<string, { count: number; frp: number }> = {};
    const t0 = Date.now();
    const seen = new Set<string>();

    for (const day of days) {
      const res = multi.days[day];
      if (!res) continue;

      // classifier contract: score the PER-DAY MERGED cross-sensor set
      const merged = Object.values(res.sensors).flatMap((sn) => sn.points);
      if (merged.length) classifyDetections(merged);
      classified += merged.length;

      // authoritative analytics: pipeline counts (points may be capped per sensor)
      let dayCount = 0;
      let dayFrp = 0;
      for (const [sensor, sn] of Object.entries(res.sensors)) {
        dayCount += sn.count;
        dayFrp += sn.meanFrp * sn.count;
        const agg = (perSensorAgg[sensor] ||= { count: 0, frp: 0 });
        agg.count += sn.count;
        agg.frp += sn.meanFrp * sn.count;
      }
      perDay.push({ date: day, count: dayCount, frp: Math.round(dayFrp) });

      // CSV rows from the (classified, capped) point lists, deduplicated
      for (const [sensor, sn] of Object.entries(res.sensors)) {
        for (const p of sn.points) {
          const key = `${p.sat || sensor}|${p.date || day}|${p.acq || ''}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (rows.length >= MAX_POINTS) { truncated = true; break; }
          rows.push({
            sensor, satellite: p.sat || '',
            acq_date: p.date || day, acq_time_utc: p.acq || '',
            latitude: p.lat, longitude: p.lon,
            frp_mw: +(p.frp || 0).toFixed(1),
            confidence: p.conf, confidence_raw: p.confRaw ?? '',
            daynight: p.night ? 'N' : 'D',
            behavior: p.beh ?? '', behavior_p: p.behP ?? null,
          });
        }
        if (truncated) break;
      }
    }

    const total = perDay.reduce((a, d) => a + d.count, 0);
    const totalFrpMW = perDay.reduce((a, d) => a + d.frp, 0);
    const peakDay = perDay.reduce<null | { date: string; count: number; frp: number }>((a, b) => (!a || b.count > a.count ? b : a), null);
    const perSensor = Object.fromEntries(
      Object.entries(perSensorAgg).map(([k, v]) => [k, { count: v.count, frp: Math.round(v.frp) }]),
    );

    const archiveNote = multi.source === 'firms-api'
      ? undefined
      : 'Historical windows beyond the FIRMS NRT (~10 days) fall back to the NASA GIBS vector archive; for some sensors/days the archive snapshot may be reused or absent — the 26-year Burning Calendar tab is the authoritative historical record.';
    return NextResponse.json(
      {
        bbox: [w, s, e, n],
        start, end: clampedEnd, spanDays: span,
        source: multi.source, note: archiveNote ?? multi.note,
        total, totalFrpMW,
        meanFrpMW: total ? +(totalFrpMW / total).toFixed(1) : 0,
        peakDay,
        perDay, perSensor,
        points: rows,
        truncated,
        ml: { model: CLASSIFIER_META.name, version: CLASSIFIER_META.version, classified, ms: Date.now() - t0 },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
