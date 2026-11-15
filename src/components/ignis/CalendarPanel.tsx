'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CalendarDoc } from '@/lib/ignis/types';
import { SENSOR_COLORS } from '@/lib/ignis/regions';
import { buildUnified, buildClimatology, anomalyZ, fmtNum, ymLabel, unifiedToCsv, MONTH_LABELS } from '@/lib/ignis/analytics';

type Props = {
  doc: CalendarDoc | null;
  loading: boolean;
  onPickDate: (ym: string) => void;
  /** calendar is being built on demand for a user-drawn / searched AOI */
  custom?: boolean;
  error?: string | null;
};

const SRC_LABEL: Record<string, string> = {
  'VIIRS-SNPP': 'VIIRS S-NPP (reference)',
  'MODIS-Terra': 'MODIS Terra × seasonal r(m) (before Aqua)',
  'MODIS-Aqua': 'MODIS Aqua × seasonal r(m) (same overpass time as VIIRS)',
  'VIIRS-NOAA20': 'VIIRS NOAA-20 bridged to S-NPP',
  'VIIRS-NOAA21': 'VIIRS NOAA-21 bridged to S-NPP',
};

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type View = 'harmonized' | 'per-sensor' | 'frp';

// ---------- accessible color ramps (brief: "Consider using accessible color ramps") ----------
// inferno   — default fire ramp (matches the mission-control identity)
// colorblind — viridis: perceptually uniform, safe for deuteranopia/protanopia
// mono      — luminance ramp for grayscale print + low-vision contexts
type Ramp = 'inferno' | 'colorblind' | 'mono';
const RAMP_META: { key: Ramp; label: string; title: string }[] = [
  { key: 'inferno', label: 'Inferno', title: 'Default fire ramp' },
  { key: 'colorblind', label: 'Colorblind-safe', title: 'Viridis — safe for red-green color vision deficiency' },
  { key: 'mono', label: 'Mono', title: 'Grayscale luminance ramp (print / low vision)' },
];
const RAMP_STOPS: Record<Ramp, [number, number, number][]> = {
  inferno: [[30, 15, 12], [120, 30, 20], [220, 90, 30], [255, 195, 80]],
  colorblind: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  mono: [[51, 65, 85], [148, 163, 184], [248, 250, 252]],
};
function rampColor(v: number, maxV: number, ramp: Ramp): string {
  if (v <= 0) return 'rgba(30,41,59,0.35)';
  const t = Math.min(1, Math.pow(v / maxV, 0.4));
  const stops = RAMP_STOPS[ramp];
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  const r = Math.round(r0 + (r1 - r0) * f);
  const g = Math.round(g0 + (g1 - g0) * f);
  const b = Math.round(b0 + (b1 - b0) * f);
  return `rgb(${r},${g},${b})`;
}
function rampSwatch(ramp: Ramp): string {
  return `linear-gradient(90deg, ${RAMP_STOPS[ramp].map((c) => `rgb(${c[0]},${c[1]},${c[2]})`).join(',')})`;
}

const SENSOR_LABELS: Record<string, string> = {
  'MODIS-Terra': 'MODIS Terra (1 km, 2000–now)',
  'MODIS-Aqua': 'MODIS Aqua (1 km, 2002–now)',
  'VIIRS-SNPP': 'VIIRS S-NPP (375 m, 2012–now)',
  'VIIRS-NOAA20': 'VIIRS NOAA-20 (375 m, 2018–now)',
  'VIIRS-NOAA21': 'VIIRS NOAA-21 (375 m, 2023–now)',
};

export default function CalendarPanel({ doc, loading, onPickDate, custom = false, error = null }: Props) {
  const [view, setView] = useState<View>('harmonized');
  const [hover, setHover] = useState<string | null>(null);
  const [ramp, setRamp] = useState<Ramp>('inferno');
  useEffect(() => {
    // deferred (not sync-in-effect) localStorage restore — keeps SSR/hydration stable
    const id = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem('ignis-ramp');
        if (saved === 'colorblind' || saved === 'mono' || saved === 'inferno') setRamp(saved);
      } catch { /* private mode */ }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  const pickRamp = (r: Ramp) => { setRamp(r); try { window.localStorage.setItem('ignis-ramp', r); } catch { /* private mode */ } };

  const { rows, clim, years, maxV } = useMemo(() => {
    if (!doc) return { rows: [], clim: null, years: [] as string[], maxV: 1 };
    const u = buildUnified(doc);
    const c = buildClimatology(u.rows);
    const ys: string[] = [];
    for (const r of u.rows) { const y = r.ym.slice(0, 4); if (!ys.includes(y)) ys.push(y); }
    ys.sort();
    const maxV = Math.max(1, ...u.rows.map((r) => r.count));
    return { rows: u.rows, clim: c, years: ys, maxV };
  }, [doc]);

  const zByYm = useMemo(() => {
    const m = new Map<string, number>();
    if (!clim) return m;
    for (const r of rows) { const z = anomalyZ(rows, clim, r.ym); if (z !== null) m.set(r.ym, z); }
    return m;
  }, [rows, clim]);

  if (loading || !doc) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-[#14273F] bg-[#0A1423]/70 px-6 text-center text-sm text-slate-400">
        {loading && custom && (
          <>
            <span>Building this area&apos;s 26-year harmonized calendar from the NASA GIBS archive…</span>
            <span className="text-[11px] text-slate-500">MODIS Terra 2000→ · VIIRS S-NPP 2012→ · NOAA-20 · NOAA-21 — first build takes ~15–90 s, then it is cached.</span>
          </>
        )}
        {loading && !custom && 'Loading the 26-year harmonized fire calendar…'}
        {!loading && error && <span className="text-amber-300">{error}</span>}
        {!loading && !error && 'Calendar is precomputed from GIBS vector tiles — check back shortly.'}
      </div>
    );
  }

  const cellColor = (v: number) => rampColor(v, maxV, ramp);

  const u = buildUnified(doc);
  const meta = u.meta;
  const seasonal = meta.ratioByMonth.filter((v): v is number => v !== null);
  const sMin = seasonal.length ? Math.min(...seasonal) : null;
  const sMax = seasonal.length ? Math.max(...seasonal) : null;
  const onDownload = () => {
    const slug = (doc.region === 'custom' ? doc.name : doc.region).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'aoi';
    downloadText(`ignis_harmonized_calendar_${slug}.csv`, unifiedToCsv(doc, u.rows, meta, clim));
  };

  return (
    <div className="rounded-xl border border-[#14273F] bg-[#0A1423]/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">BURNING ACTIVITY CALENDAR — {doc.name.toUpperCase()}</h3>
          <p className="text-[11px] text-slate-400">One comparable record across the sensor break · click any month to load it on the map</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className="rounded-full border border-[#1E3A5F] px-2.5 py-1 text-slate-300"
            title={`Seasonal VIIRS/MODIS coefficients r(m): ${meta.ratioByMonth.map((v, i) => `${MONTH_LABELS[i]} ×${v?.toFixed(2) ?? '—'}`).join(' · ')}`}>
            continuity ×{meta.ratioCount ? meta.ratioCount.toFixed(1) : '—'}
            {sMin !== null && sMax !== null && <span className="text-slate-500"> (seasonal ×{sMin.toFixed(1)}–{sMax.toFixed(1)})</span>}
            <span className="text-slate-500"> vs {meta.modisRef.replace('-', ' ')} · {meta.overlapMonths} overlap months</span>
          </span>
          <button onClick={onDownload} className="rounded-full border border-[#1E3A5F] px-2.5 py-1 text-slate-300 hover:border-[#38BDF8] hover:text-[#38BDF8]"
            title="Download the harmonized monthly calendar (with per-sensor raw estimates, coefficients and anomaly z) as CSV">
            ⬇ CSV
          </button>
          <div className="flex overflow-hidden rounded-full border border-[#1E3A5F]">
            {(['harmonized', 'per-sensor', 'frp'] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 capitalize ${view === v ? 'bg-[#38BDF8] text-slate-950' : 'text-slate-400'}`}>{v.replace('-', ' ')}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Color ramp (accessibility)">
            {RAMP_META.map((r) => (
              <button key={r.key} onClick={() => pickRamp(r.key)} title={r.title} aria-pressed={ramp === r.key}
                className={`rounded-full border px-2 py-1 text-[10px] ${ramp === r.key ? 'border-orange-400/70 bg-orange-400/15 text-orange-200' : 'border-[#1E3A5F] text-slate-500 hover:text-slate-300'}`}>
                {r.label}
              </button>
            ))}
            <span aria-hidden className="h-2 w-16 rounded-full" style={{ background: rampSwatch(ramp) }} />
          </div>
        </div>
      </div>

      {view === 'harmonized' && clim && (
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="flex">
              <div className="w-11 shrink-0" />
              <div className="grid flex-1 grid-cols-12 gap-[2px]">
                {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => (
                  <div key={i} className="text-center text-[9px] text-slate-500">{m}</div>
                ))}
              </div>
            </div>
            {years.map((y) => (
              <div key={y} className="flex items-center">
                <div className="w-11 shrink-0 text-[10px] text-slate-500">{y}</div>
                <div className="grid flex-1 grid-cols-12 gap-[2px] pb-[2px]">
                  {Array.from({ length: 12 }, (_, mi) => {
                    const ym = `${y}-${String(mi + 1).padStart(2, '0')}`;
                    const row = rows.find((r) => r.ym === ym);
                    const z = zByYm.get(ym);
                    const unusual = z !== undefined && Math.abs(z) >= 2;
                    const v = row?.count ?? 0;
                    return (
                      <button
                        key={ym}
                        onClick={() => onPickDate(ym)}
                        onMouseEnter={() => setHover(ym)}
                        title={`${ymLabel(ym)}: est ${v.toLocaleString()} detections${row ? ` · Σ FRP ${fmtNum(row.frp)} MW` : ''}${z !== undefined ? ` · z ${z > 0 ? '+' : ''}${z}` : ''}${row?.src ? ` · ${SRC_LABEL[row.src] ?? row.src}` : ''}`}
                        className={`h-[13px] rounded-[2px] transition-transform hover:scale-125 ${unusual ? 'ring-1 ring-cyan-300' : ''}`}
                        style={{ background: cellColor(v) }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm ring-1 ring-cyan-300" /> ring = unusual month (|z| ≥ 2 vs 2000–2023 climatology)</span>
              <span className="flex items-center gap-1.5">MODIS-era months use {meta.modisRef === 'MODIS-Aqua' ? 'MODIS Aqua (same 13:30 overpass as VIIRS)' : 'MODIS Terra'} × the seasonal coefficient r(m) (hover the continuity chip){meta.bridges.length ? ` · post-S-NPP months bridged via ${meta.bridges.map((b) => `${b.sensor.replace('VIIRS-', '')} ×${b.ratioCount.toFixed(2)}`).join(', ')}` : ''}</span>
              <span className="flex items-center gap-1.5">few → many:</span>
              <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: rampSwatch(ramp) }} />
              {ramp === 'colorblind' && <span className="text-cyan-300">viridis — safe for red-green color-vision deficiency</span>}
              {ramp === 'mono' && <span className="text-cyan-300">luminance ramp — readable in grayscale / low vision</span>}
              {hover && <span className="text-slate-300">{hover}: {rows.find((r) => r.ym === hover)?.count.toLocaleString() ?? 0} est. detections</span>}
            </div>
          </div>
        </div>
      )}

      {view === 'per-sensor' && (
        <div className="space-y-2 overflow-x-auto">
          {Object.entries(doc.sensors).map(([s, sv]) => {
            const maxS = Math.max(1, ...sv.monthly.map((m) => m.est));
            const ys: string[] = [];
            for (const r of sv.monthly) { const y = r.ym.slice(0, 4); if (!ys.includes(y)) ys.push(y); }
            ys.sort();
            return (
              <div key={s} className="min-w-[680px]">
                <div className="mb-1 flex items-center gap-2 text-[11px]" style={{ color: SENSOR_COLORS[s] || '#94A3B8' }}>
                  <span className="font-semibold">{s}</span>
                  <span className="text-slate-500">{SENSOR_LABELS[s] ?? ''} · max {maxS.toLocaleString()} det/mo</span>
                </div>
                <div className="flex">
                  <div className="w-11 shrink-0" />
                  <div className="grid flex-1 grid-cols-12 gap-[2px]">
                    {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => <div key={i} className="text-center text-[9px] text-slate-500">{m}</div>)}
                  </div>
                </div>
                {ys.map((y) => (
                  <div key={s + y} className="flex items-center">
                    <div className="w-11 shrink-0 text-[10px] text-slate-500">{y}</div>
                    <div className="grid flex-1 grid-cols-12 gap-[2px] pb-[2px]">
                      {Array.from({ length: 12 }, (_, mi) => {
                        const ym = `${y}-${String(mi + 1).padStart(2, '0')}`;
                        const row = sv.monthly.find((m) => m.ym === ym);
                        return (
                          <button key={ym} onClick={() => onPickDate(ym)}
                            title={`${s} ${ym}: est ${row?.est ?? 0} · FRP ${row?.frp ?? 0} MW`}
                            className="h-[10px] rounded-[2px] transition-transform hover:scale-125"
                            style={{ background: cellColor(row?.est ?? 0) }} />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          <p className="text-[10px] text-slate-500">Raw per-sensor records (VIIRS S-NPP/NOAA-20 from GIBS archive; NOAA-21 begins 2024). The gaps are the “split record” this challenge asks us to heal.</p>
        </div>
      )}

      {view === 'frp' && (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows.filter((r) => r.ym >= `${Number(rows[rows.length - 1].ym.slice(0, 4)) - 10}`).map((r) => ({ ym: r.ym, frp: r.frp, scaled: r.scaled }))}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              onClick={(e) => { const p = e?.activePayload?.[0]?.payload as { ym?: string } | undefined; if (p?.ym) onPickDate(p.ym); }}>
              <CartesianGrid stroke="#13253D" strokeDasharray="3 3" />
              <XAxis dataKey="ym" tick={{ fill: '#64748B', fontSize: 9 }} minTickGap={48} />
              <YAxis tick={{ fill: '#64748B', fontSize: 10 }} width={52} tickFormatter={(v: number) => fmtNum(v)} />
              <Tooltip contentStyle={{ background: '#0B1524', border: '1px solid #1E3A5F', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#94A3B8' }}
                formatter={(value: number, name: string) => [`${fmtNum(value)} MW${name === 'frp' ? '' : ''}`, name === 'frp' ? 'Σ FRP (harmonized)' : name]} />
              <Bar dataKey="frp" fill="#F97316" />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[10px] text-slate-500">FRP in megawatts is physically comparable across sensors; the unified series additionally scales MODIS-era months by the seasonal FRP continuity ratio (median ×{meta.ratioFrp ? meta.ratioFrp.toFixed(2) : '—'}) for one consistent energy record. Click a bar to load that month.</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-[#13253D] pt-2 text-[11px] text-slate-400">
        <span>VIIRS 375 m resolves fires ~450× smaller in area — the ×{meta.ratioCount ? meta.ratioCount.toFixed(1) : '—'} coefficient makes MODIS-era months comparable</span>
        {meta.ratioCV !== null && <span className="text-slate-500">ratio variability CV {meta.ratioCV} → ±{Math.round(meta.ratioCV * 100)}% uncertainty on scaled months</span>}
        <span className="text-slate-500">Source: {doc.meta.source}</span>
      </div>
    </div>
  );
}
