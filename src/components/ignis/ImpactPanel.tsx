'use client';

// IGNIS Impact Panel — CARBON & CLIMATE IMPACT + SMOKE & AIR QUALITY.
// Carbon: /api/impact (ΣFRP → FRE → dry matter → CO2e; the exact chain of the
//          ignis-fire-calendar emissions dataset) + equivalences + context vs
//          the region's 26-year harmonized record.
// Air:    /api/air-quality (Open-Meteo CAMS, keyless) for the AOI center —
//          US AQI band, PM2.5, CO, aerosol optical depth, smoke suspicion.

import { useEffect, useState } from 'react';
import type { HotspotsResult } from '@/lib/ignis/types';

type ImpactDoc = {
  ok?: boolean; frpMw: number; freTj: number; dryMatterKt: number; co2eMt: number; co2eTons: number;
  equivalents: { carsYears: number; treesYears: number; homesYears: number; longHaulFlights: number };
  context?: { regionMeanAnnualMt: number; regionMaxMt: number; shareOfMeanYear: number; note: string } | null;
  methodology: string;
} | null;

type AqDoc = {
  ok?: boolean; usAqi: number | null; band?: { label: string; advice: string } | null;
  smokeSuspicion?: string | null; pm2_5?: number; pm10?: number; carbonMonoxide?: number;
  aerosolOpticalDepth?: number; source?: string;
} | null;

const fmt = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function ImpactPanel({ hotspots, regionKey, regionName, day, center }: {
  hotspots: HotspotsResult | null; regionKey: string; regionName: string; day: string; center: [number, number];
}) {
  const [impact, setImpact] = useState<ImpactDoc>(null);
  const [loading, setLoading] = useState(false);
  const [aq, setAq] = useState<AqDoc>(null);
  const [aqLoading, setAqLoading] = useState(true);

  const frp = hotspots ? Object.values(hotspots.sensors).reduce((a, s) => a + s.points.reduce((x, p) => x + (p.frp || 0), 0), 0) : 0;
  const detections = hotspots ? Object.values(hotspots.sensors).reduce((a, s) => a + s.count, 0) : 0;

  useEffect(() => {
    let alive = true;
    // deferred — react-hooks/set-state-in-effect (heavy compute / fetch kickoff)
    const t = setTimeout(() => {
      if (!alive) return;
      if (!hotspots) { setImpact(null); setLoading(false); return; }
      setLoading(true);
      fetch(`/api/impact?frp=${frp.toFixed(1)}&region=${regionKey}&day=${day}&detections=${detections}`)
        .then((r) => r.json()).then((j) => { if (alive) { setImpact(j); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [hotspots, regionKey, day]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      setAqLoading(true);
      // center is [lon, lat]
      fetch(`/api/air-quality?lat=${center[1]}&lon=${center[0]}`)
        .then((r) => r.json()).then((j) => { if (alive) { setAq(j); setAqLoading(false); } })
        .catch(() => { if (alive) setAqLoading(false); });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [center[0], center[1]]);

  const aqi = aq?.usAqi ?? null;
  const aqiColor = aqi == null ? '#94A3B8' : aqi <= 50 ? '#22C55E' : aqi <= 100 ? '#FACC15' : aqi <= 150 ? '#F97316' : aqi <= 200 ? '#EF4444' : aqi <= 300 ? '#D946EF' : '#B91C1C';
  const smoke = aq?.smokeSuspicion;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---- carbon & climate ---- */}
      <div className="rounded-xl border border-[#14273F] bg-[#0A1423]/70 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">🌍 CARBON & CLIMATE IMPACT</h3>
          <span className="rounded-full border border-[#1E3A5F] px-2 py-0.5 text-[9px] text-slate-500">{regionName} · {day}</span>
        </div>
        {loading && <div className="mt-3 h-24 animate-pulse rounded-lg bg-[#0C1A2E]" />}
        {!loading && impact?.ok && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-[#14273F] bg-[#060D1A] p-2.5">
                <div className="font-mono text-lg font-bold text-emerald-300">{impact.co2eMt >= 0.01 ? impact.co2eMt.toFixed(2) : '<0.01'}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">Mt CO₂e today</div>
              </div>
              <div className="rounded-lg border border-[#14273F] bg-[#060D1A] p-2.5">
                <div className="font-mono text-lg font-bold text-amber-300">{fmt(impact.dryMatterKt)}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">kt dry matter</div>
              </div>
              <div className="rounded-lg border border-[#14273F] bg-[#060D1A] p-2.5">
                <div className="font-mono text-lg font-bold text-cyan-300">{fmt(impact.freTj)}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">TJ radiative energy</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-300">
              <div>🚗 ≈ <b className="text-slate-100">{fmt(impact.equivalents.carsYears)}</b> passenger-car years</div>
              <div>🌳 ≈ <b className="text-slate-100">{fmt(impact.equivalents.treesYears)}</b> tree-years of sequestration</div>
              <div>🏠 ≈ <b className="text-slate-100">{fmt(impact.equivalents.homesYears)}</b> household-years</div>
              <div>✈️ ≈ <b className="text-slate-100">{fmt(impact.equivalents.longHaulFlights)}</b> long-haul economy seats</div>
            </div>
            {impact.context && (
              <p className="mt-2.5 rounded-lg border border-[#14273F] bg-[#060D1A] p-2 text-[10.5px] leading-relaxed text-slate-400">
                Context: this AOI-day is ≈ <b className="text-slate-200">{impact.context.shareOfMeanYear}%</b> of {regionName}&apos;s mean annual fire emissions ({impact.context.regionMeanAnnualMt} Mt CO₂e/yr; record max {impact.context.regionMaxMt} Mt) from the 26-year harmonized record.
              </p>
            )}
            <p className="mt-2 text-[9.5px] leading-relaxed text-slate-600">{impact.methodology}</p>
          </>
        )}
        {!loading && (!impact || !impact.ok) && <p className="mt-3 text-[11px] text-slate-500">Load live detections for this AOI to compute today&apos;s first-order emissions.</p>}
      </div>

      {/* ---- smoke & air quality ---- */}
      <div className="rounded-xl border border-[#14273F] bg-[#0A1423]/70 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">💨 SMOKE & AIR QUALITY</h3>
          <span className="rounded-full border border-[#1E3A5F] px-2 py-0.5 text-[9px] text-slate-500">AOI center · {center[1].toFixed(1)}°, {center[0].toFixed(1)}°</span>
        </div>
        {aqLoading && <div className="mt-3 h-24 animate-pulse rounded-lg bg-[#0C1A2E]" />}
        {!aqLoading && aq?.ok !== false && (
          <>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border" style={{ borderColor: aqiColor + '66', background: aqiColor + '14' }}>
                <span className="font-mono text-xl font-bold" style={{ color: aqiColor }}>{aqi ?? '—'}</span>
                <span className="text-[8px] uppercase tracking-wider text-slate-500">US AQI</span>
              </div>
              <div className="flex-1 text-[11px] leading-relaxed text-slate-300">
                <b style={{ color: aqiColor }}>{aq?.band?.label ?? '—'}</b>
                {smoke && <span className="ml-2 rounded bg-[#13253D] px-1.5 py-0.5 text-[9.5px] font-bold text-slate-300">smoke: {smoke}</span>}
                <div className="mt-0.5 text-slate-400">{aq?.band?.advice ?? 'air-quality readout for the selected AOI'}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ['PM2.5', aq?.pm2_5 != null ? aq.pm2_5.toFixed(1) : '—', 'µg/m³'],
                ['PM10', aq?.pm10 != null ? aq.pm10.toFixed(1) : '—', 'µg/m³'],
                ['CO', aq?.carbonMonoxide != null ? fmt(aq.carbonMonoxide) : '—', 'µg/m³'],
                ['AOD', aq?.aerosolOpticalDepth != null ? aq.aerosolOpticalDepth.toFixed(2) : '—', 'aerosol'],
              ].map(([k, v, u]) => (
                <div key={k} className="rounded-lg border border-[#14273F] bg-[#060D1A] p-2">
                  <div className="font-mono text-sm font-bold text-slate-100">{v}</div>
                  <div className="text-[8.5px] uppercase tracking-wider text-slate-500">{k} · {u}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[9.5px] text-slate-600">{aq?.source ?? 'Open-Meteo Air Quality (CAMS)'} — wildfire smoke drives PM2.5 spikes; AOD ≥ 0.35 with active fire nearby flags a likely smoke plume. Per-hotspot smoke rows render inside every map popup.</p>
          </>
        )}
        {!aqLoading && aq?.ok === false && <p className="mt-3 text-[11px] text-slate-500">Air-quality feed unavailable right now — the per-hotspot smoke rows will retry automatically.</p>}
      </div>
    </div>
  );
}
