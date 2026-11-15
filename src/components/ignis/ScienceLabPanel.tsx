'use client';

import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CalendarDoc, HotspotsResult } from '@/lib/ignis/types';
import { buildUnified, buildClimatology, fmtNum } from '@/lib/ignis/analytics';
import {
  mannKendall, acf, hurstExponent, periodogram, deseasonalize, returnPeriods,
  peaksOverThreshold, sensorAgreement, phenology, momentum, frpStats, moransI, moranScatter, MONTHS_SCI,
} from '@/lib/ignis/science';

type Props = { doc: CalendarDoc | null; hotspots: HotspotsResult | null; regionName: string };
type Tab = 'significance' | 'memory' | 'cycles' | 'extremes' | 'agreement' | 'phenology' | 'energy';

const TABS: [Tab, string][] = [
  ['significance', 'Trend significance'], ['memory', 'Memory & persistence'], ['cycles', 'Hidden cycles'],
  ['extremes', 'Extremes & return periods'], ['agreement', 'Sensor agreement'], ['phenology', 'Season phenology'],
  ['energy', 'Energy & clustering'],
];

const tooltipStyle = { background: '#0B1524', border: '1px solid #1E3A5F', borderRadius: 8, fontSize: 12 } as const;

function Card({ label, value, sub, tone = 'cyan' }: { label: string; value: string; sub?: string; tone?: 'cyan' | 'orange' | 'violet' | 'rose' | 'emerald' }) {
  const tones: Record<string, string> = {
    cyan: 'text-cyan-300 border-cyan-900/60', orange: 'text-orange-300 border-orange-900/60',
    violet: 'text-violet-300 border-violet-900/60', rose: 'text-rose-300 border-rose-900/60',
    emerald: 'text-emerald-300 border-emerald-900/60',
  };
  return (
    <div className={`rounded-lg border bg-[#0A1423]/70 p-2.5 ${tones[tone]}`}>
      <div className="text-[8.5px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="font-mono text-[15px] font-bold leading-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-[8.5px] leading-tight text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Verdict({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-orange-500/25 bg-gradient-to-br from-orange-950/30 to-[#0A1423]/70 p-3 text-[10.5px] leading-relaxed text-slate-300">
      <span className="font-bold text-orange-200">Deterministic read · </span>{children}
    </div>
  );
}

export default function ScienceLabPanel({ doc, hotspots, regionName }: Props) {
  const [tab, setTab] = useState<Tab>('significance');

  const eng = useMemo(() => {
    if (!doc) return null;
    const u = buildUnified(doc);
    const rows = u.rows;
    const clim = buildClimatology(rows);
    const des = deseasonalize(rows);
    // annual totals, 12-month-normalized for partial years
    const annual = new Map<number, { sum: number; n: number }>();
    for (const r of rows) {
      const y = Number(r.ym.slice(0, 4));
      const a = annual.get(y) || { sum: 0, n: 0 };
      a.sum += r.count; a.n++;
      annual.set(y, a);
    }
    const annualArr = [...annual.entries()].filter(([, a]) => a.n >= 10).sort((a, b) => a[0] - b[0]).map(([y, a]) => ({ y, total: Math.round(a.sum / (a.n / 12)) }));
    const mk = mannKendall(annualArr.map((a) => a.total));
    const ac = acf(des, 18);
    const hurst = hurstExponent(des);
    const spec = periodogram(des, 120);
    const ext = returnPeriods(annualArr);
    const pot = peaksOverThreshold(rows, clim, 1.5);
    const mom = momentum(rows, clim);
    const phen = phenology(rows);
    // sensor agreement: monthly MODIS-Terra vs VIIRS-SNPP counts over the overlap
    const mBy = new Map(doc.sensors['MODIS-Terra']?.monthly.map((r) => [r.ym, r.est]));
    const vBy = new Map(doc.sensors['VIIRS-SNPP']?.monthly.map((r) => [r.ym, r.est]));
    const mA: number[] = [], vA: number[] = [], ovYm: string[] = [];
    for (const [ym, mv] of mBy) {
      const vv = vBy.get(ym);
      if (mv && vv) { mA.push(mv); vA.push(vv); ovYm.push(ym); }
    }
    const agree = sensorAgreement(mA, vA);
    // live snapshot energy + clustering
    const pts = hotspots ? Object.values(hotspots.sensors).flatMap((s) => s.points.map((p) => ({ lon: p.lon, lat: p.lat, frp: p.frp }))) : [];
    const frp = frpStats(hotspots ? Object.values(hotspots.sensors).flatMap((s) => s.points) : []);
    const moran = moransI(pts, doc.bbox);
    const mScat = moran ? moranScatter(pts, doc.bbox) : [];
    const senFit = annualArr.map((a, i) => ({ ...a, fit: Math.round(mk.senIntercept + mk.senSlope * i) }));
    return { rows, clim, mk, ac, hurst, spec, ext, pot, mom, phen, agree, overlap: { mA, vA, ovYm }, frp, moran, mScat, annualArr, senFit, pts };
  }, [doc, hotspots]);

  if (!doc || !eng) {
    return <div className="flex h-56 items-center justify-center rounded-xl border border-[#14273F] bg-[#0A1423]/70 text-sm text-slate-400">Statistics Lab loads with the calendar…</div>;
  }

  const { mk, ac, hurst, spec, ext, pot, mom, phen, agree, frp, moran, mScat, annualArr, senFit } = eng;

  return (
    <div className="rounded-xl border border-[#14273F] bg-[#0A1423]/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide text-slate-100">STATISTICS SCIENCE LAB — {regionName.toUpperCase()}</h3>
          <p className="text-[11px] text-slate-400">Classical, citable methods on the harmonized MODIS/VIIRS record — Mann-Kendall · ACF · R/S Hurst · DFT spectrum · EVT return periods · Bland-Altman · phenology · Gini · Moran&apos;s I</p>
        </div>
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} data-active={tab === k}
            className={`ignis-tab whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10.5px] ${tab === k ? 'bg-[#13253D] text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
        ))}
      </div>

      {tab === 'significance' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Card label="MK Z statistic" value={String(mk.z)} sub="normal approx, tie-corrected" tone={mk.z > 0 ? 'rose' : 'cyan'} />
            <Card label="p-value (two-sided)" value={mk.p < 0.001 ? '<0.001' : String(mk.p)} sub={mk.significant ? 'significant at α=0.05' : 'not significant'} tone={mk.significant ? 'orange' : 'cyan'} />
            <Card label="S statistic" value={String(mk.s)} sub={`${mk.n} complete years compared`} />
            <Card label="Sen's slope" value={`${mk.senSlope >= 0 ? '+' : ''}${fmtNum(mk.senSlope)}/yr`} sub="median of pairwise slopes" tone={mk.senSlope > 0 ? 'rose' : 'cyan'} />
            <Card label="Direction" value={mk.direction.toUpperCase()} sub={mk.significant ? '95% confidence' : 'within noise'} tone={mk.direction === 'increasing' ? 'rose' : mk.direction === 'decreasing' ? 'emerald' : 'cyan'} />
            <Card label="Record span" value={`${mk.n} yr`} sub="12-month-normalized totals" />
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={senFit} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#13253D" strokeDasharray="3 3" />
                <XAxis dataKey="y" tick={{ fill: '#64748B', fontSize: 9 }} minTickGap={24} />
                <YAxis tick={{ fill: '#64748B', fontSize: 10 }} width={52} tickFormatter={(v: number) => fmtNum(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v))} />
                <Bar dataKey="total" name="annual detections" fill="rgba(56,189,248,0.35)" stroke="#38BDF8" strokeWidth={1} radius={[2, 2, 0, 0]} />
                <Line type="linear" dataKey="fit" name="Sen slope fit" stroke="#F97316" strokeWidth={2} dot={false} strokeDasharray="6 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10.5px] text-slate-500">
            The <span className="text-cyan-300">Mann-Kendall test</span> asks a stricter question than the Theil-Sen fit in the Time-Series Lab: <i>is the monotonic trend statistically significant, or could it arise from random year-to-year shuffling?</i> Sen&apos;s slope (orange) is the median of all pairwise slopes — immune to megafire outliers.
          </p>
          <Verdict>
            Annual fire activity shows a <b className={mk.direction === 'increasing' ? 'text-red-300' : mk.direction === 'decreasing' ? 'text-emerald-300' : 'text-slate-100'}>{mk.direction}</b> trend
            {mk.significant ? ` that is statistically significant (p = ${mk.p < 0.001 ? '<0.001' : mk.p}, Z = ${mk.z}).` : ` that is NOT statistically significant (p = ${mk.p} > 0.05) — the apparent slope is within natural variability.`}
            {' '}Central estimate: {mk.senSlope >= 0 ? '+' : ''}{fmtNum(mk.senSlope)} detections/year, i.e. ≈{fmtNum(mk.senSlope * 10)} per decade.
          </Verdict>
        </div>
      )}

      {tab === 'memory' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="Lag-1 autocorrelation" value={String(ac.lag1)} sub="month-to-month persistence" tone={ac.lag1 > ac.ci ? 'orange' : 'cyan'} />
            <Card label="95% noise band" value={`±${ac.ci}`} sub="ρ outside band = real memory" />
            <Card label="Hurst exponent" value={hurst === null ? '—' : String(hurst)} sub={hurst === null ? 'needs ≥32 months' : hurst > 0.55 ? 'persistent regime (H>0.55)' : hurst < 0.45 ? 'anti-persistent (H<0.45)' : 'random-walk-like (0.45–0.55)'} tone={hurst !== null && hurst > 0.55 ? 'rose' : 'violet'} />
            <Card label="3-month momentum" value={`${mom.last3 >= 0 ? '+' : ''}${mom.last3}%`} sub={`volatility ±${mom.volatility}% · ${mom.verdict}`} tone={mom.verdict === 'accelerating' ? 'rose' : mom.verdict === 'decelerating' ? 'emerald' : 'cyan'} />
          </div>
          <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">Correlogram — autocorrelation of deseasonalized monthly anomalies (lags 1–18)</div>
            <svg viewBox="0 0 340 150" className="h-44 w-full">
              <line x1={30} y1={75} x2={332} y2={75} stroke="#334155" strokeWidth={1} />
              <line x1={30} y1={75 - ac.ci * 65} x2={332} y2={75 - ac.ci * 65} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
              <line x1={30} y1={75 + ac.ci * 65} x2={332} y2={75 + ac.ci * 65} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
              {ac.points.map((p, i) => {
                const x = 38 + i * (294 / Math.max(1, ac.points.length));
                const h = p.rho * 65;
                return (
                  <g key={p.lag}>
                    <line x1={x} y1={75} x2={x} y2={75 - h} stroke={p.rho >= 0 ? (Math.abs(p.rho) > ac.ci ? '#F97316' : '#94A3B8') : (Math.abs(p.rho) > ac.ci ? '#38BDF8' : '#94A3B8')} strokeWidth={3.4} strokeLinecap="round" />
                    <text x={x} y={146} fontSize={7.5} fill="#64748B" textAnchor="middle">{p.lag}</text>
                  </g>
                );
              })}
              <text x={4} y={14} fontSize={8} fill="#64748B">ρ</text>
              <text x={4} y={79} fontSize={8} fill="#64748B">0</text>
              <text x={300} y={75 - ac.ci * 65 - 3} fontSize={7.5} fill="#475569">+95% band</text>
              <text x={300} y={75 + ac.ci * 65 + 9} fontSize={7.5} fill="#475569">−95% band</text>
            </svg>
            <p className="mt-1 text-[9px] text-slate-500">Bars beyond the dashed white-noise band = genuine statistical memory. Orange = positive (active months follow active months), blue = negative (rebound). Long-range significance at 12 mo would flag imperfect seasonal removal; 2–8 mo significance = drought/DMAT-scale persistence.</p>
          </div>
          <Verdict>
            The record carries <b className="text-slate-100">{ac.lag1 > ac.ci ? 'significant month-to-month memory' : 'no significant month-to-month memory'}</b> (ρ₁ = {ac.lag1} vs ±{ac.ci} noise band){hurst !== null ? `, and its long-range scaling Hurst exponent H = ${hurst} indicates ${hurst > 0.55 ? 'persistent clustering — fire-prone regimes tend to stay fire-prone across months-to-years (drought anchoring)' : hurst < 0.45 ? 'anti-persistent, mean-reverting behavior — big months tend to be followed by quieter ones' : 'near-random-walk scaling'}` : ''}. {' '}Momentum over the last 3 months is <b className={mom.verdict === 'accelerating' ? 'text-red-300' : mom.verdict === 'decelerating' ? 'text-emerald-300' : 'text-slate-100'}>{mom.verdict}</b> ({mom.last3 >= 0 ? '+' : ''}{mom.last3}% season-adjusted).
          </Verdict>
        </div>
      )}

      {tab === 'cycles' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {spec.top.map((t, i) => {
              const band = t.period < 18 ? 'sub-annual' : t.period <= 36 ? 'quasi-biennial (ENSO-like)' : t.period <= 84 ? 'interannual–decadal' : 'multi-decadal';
              return <Card key={i} label={`Peak ${i + 1} — period`} value={`≈ ${t.period} mo`} sub={`${band} · ${(t.share * 100).toFixed(1)}% of deseasonalized variance`} tone={i === 0 ? 'orange' : 'violet'} />;
            })}
          </div>
          <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">Power spectrum — DFT periodogram after seasonal removal (periods ≤ 120 months)</div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={spec.bins.map((b) => ({ period: b.period, share: +(b.share * 100).toFixed(2), peak: spec.top.some((t) => Math.abs(t.period - b.period) < 0.2) ? b.share * 100 : null }))} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#13253D" strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fill: '#64748B', fontSize: 9 }} minTickGap={40} label={{ value: 'period (months)', position: 'insideBottom', offset: -2, fill: '#475569', fontSize: 9 }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 10 }} width={44} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}% of variance`} labelFormatter={(l) => `period ≈ ${l} months`} />
                  <Bar dataKey="share" name="variance share" fill="rgba(139,92,246,0.4)" stroke="#8B5CF6" strokeWidth={0.6} />
                  <Line type="monotone" dataKey="peak" name="dominant peaks" stroke="#F97316" strokeWidth={0} dot={{ r: 4, fill: '#F97316' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[9px] text-slate-500">The annual cycle was removed before this transform — anything left is a <i>hidden</i> rhythm: ENSO-band peaks (≈24–36 mo) link fire seasons to equatorial Pacific sea-surface anomalies; 60–90 mo power is the classic drought-return band. This is the climate-teleconnection view of your AOI.</p>
          </div>
          <Verdict>
            After subtracting the seasonal cycle, the strongest residual rhythm is <b className="text-slate-100">≈ {spec.top[0]?.period ?? '—'} months</b> carrying {spec.top[0] ? (spec.top[0].share * 100).toFixed(1) : '—'}% of the anomaly variance ({spec.top[0] ? (spec.top[0].period < 18 ? 'sub-annual — likely land-use/management pacing' : spec.top[0].period <= 36 ? 'quasi-biennial — consistent with ENSO teleconnection' : spec.top[0].period <= 84 ? 'interannual — drought-regime band' : 'multi-decadal — climate-oscillation band') : ''}).
          </Verdict>
        </div>
      )}

      {tab === 'extremes' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="Record year" value={ext.record ? String(ext.record.year) : '—'} sub={ext.record ? `${fmtNum(ext.record.total)} detections` : ''} tone="rose" />
            <Card label="1-in-10-yr level" value={ext.level10 === null ? '—' : fmtNum(ext.level10)} sub="Gumbel fit threshold" tone="orange" />
            <Card label="1-in-25-yr level" value={ext.level25 === null ? '—' : fmtNum(ext.level25)} sub="extreme planning figure" tone="orange" />
            <Card label="1-in-50-yr level" value={ext.level50 === null ? '—' : fmtNum(ext.level50)} sub="design-basis extremity" tone="violet" />
          </div>
          <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">Empirical return periods in Gumbel space — annual detection totals</div>
            <svg viewBox="0 0 340 160" className="h-48 w-full">
              {(() => {
                const yOf = (T: number) => -Math.log(-Math.log(1 - 1 / T)); // Gumbel reduced variate
                const tMax = Math.max(...ext.rows.map((q) => q.T));
                const yMax = Math.max(...ext.rows.map((q) => q.total));
                const xMin = yOf(1.15), xMax = yOf(tMax);
                const X = (T: number) => 34 + ((yOf(T) - xMin) / Math.max(0.01, xMax - xMin)) * 292;
                const Y = (v: number) => 138 - (v / yMax) * 118;
                const fitAt = (T: number) => (ext.gumbelFit ? ext.gumbelFit.a * yOf(T) + ext.gumbelFit.b : 0);
                const ticks = [1.5, 2, 5, 10, 25, 50].filter((T) => yOf(T) <= xMax + 0.25);
                return (
                  <g>
                    {ext.rows.map((r) => (
                      <circle key={r.year} cx={X(r.T)} cy={Y(r.total)} r={3.2} fill={r.total === yMax ? '#F97316' : '#38BDF8'} stroke="#050A14" strokeWidth={1} />
                    ))}
                    {ext.gumbelFit && (
                      <line x1={X(1.15)} y1={Y(fitAt(1.15))} x2={X(tMax)} y2={Y(fitAt(tMax))} stroke="#F97316" strokeWidth={1.6} strokeDasharray="5 3" />
                    )}
                    {ticks.map((T) => (
                      <g key={T}>
                        <line x1={X(T)} y1={ext.gumbelFit ? Y(fitAt(T)) : 138} x2={X(T)} y2={138} stroke="#475569" strokeWidth={0.8} strokeDasharray="2 3" />
                        <text x={X(T)} y={152} fontSize={7.5} fill="#94A3B8" textAnchor="middle">{T}y</text>
                        {ext.gumbelFit && <circle cx={X(T)} cy={Y(fitAt(T))} r={2.6} fill="#FBBF24" stroke="#050A14" />}
                      </g>
                    ))}
                  </g>
                );
              })()}
              <text x={170} y={160} fontSize={8} fill="#64748B" textAnchor="middle">return period (years, Gumbel axis) →</text>
              <text x={6} y={16} fontSize={8} fill="#64748B">{fmtNum(Math.max(...ext.rows.map((q) => q.total)))}</text>
              <text x={6} y={136} fontSize={8} fill="#64748B">0</text>
            </svg>
            <p className="mt-1 text-[9px] text-slate-500">Each dot is one year, ranked by Weibull plotting positions T=(n+1)/m. The dashed orange line is the Gumbel (EVT type-I) fit — read horizontally: the level a given return period is expected to reach. The 1-in-25-yr figure is what fuel-treatment budgets and mutual-aid plans should be sized against.</p>
          </div>
          {pot.length > 0 && (
            <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
              <div className="mb-2 text-[11px] font-bold text-slate-200">Peaks-over-threshold register — months with anomaly z ≥ 1.5 vs their own calendar-month climatology</div>
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-left text-[10px]">
                  <thead className="sticky top-0 bg-[#0B1524] text-[8.5px] uppercase tracking-widest text-slate-500">
                    <tr><th className="py-1 pr-2">Month</th><th className="py-1 pr-2">Detections</th><th className="py-1 pr-2">Anomaly z</th><th className="py-1">Severity</th></tr>
                  </thead>
                  <tbody className="font-mono text-slate-300">
                    {pot.map((e) => (
                      <tr key={e.ym} className="border-t border-[#12223A]">
                        <td className="py-1 pr-2">{e.ym}</td>
                        <td className="py-1 pr-2">{fmtNum(e.count)}</td>
                        <td className="py-1 pr-2 text-orange-300">+{e.z}</td>
                        <td className="py-1">{e.z >= 3 ? 'EXTREME outlier' : e.z >= 2 ? 'severe anomaly' : 'notable anomaly'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <Verdict>
            The most extreme year in the {ext.rows.length}-yr record is <b className="text-slate-100">{ext.record?.year}</b> ({fmtNum(ext.record?.total ?? 0)}). Gumbel extrapolation puts a 1-in-25-yr season at <b className="text-orange-300">{ext.level25 === null ? '—' : fmtNum(ext.level25)}</b> detections — {ext.level25 && ext.record ? (ext.record.total >= ext.level25 ? 'the record year already surpassed it.' : 'still above anything yet observed.') : ''} The POT register lists the statistically unusual months that drive that tail.
          </Verdict>
        </div>
      )}

      {tab === 'agreement' && (
        <div className="space-y-3">
          {agree ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Card label="Pearson r" value={String(agree.pearson)} sub={`n = ${agree.n} overlap months`} tone="cyan" />
                <Card label="Spearman ρ" value={String(agree.spearman)} sub="rank agreement (outlier-robust)" tone="cyan" />
                <Card label="Geometric bias" value={`${agree.ratioGeo}×`} sub={`VIIRS/MODIS — VIIRS counts ${agree.biasPct >= 0 ? '+' : ''}${agree.biasPct}%`} tone="orange" />
                <Card label="95% LoA lower" value={`${agree.ratioLo}×`} sub="limit of agreement" />
                <Card label="95% LoA upper" value={`${agree.ratioHi}×`} sub="limit of agreement" />
              </div>
              <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
                <div className="mb-2 text-[11px] font-bold text-slate-200">Ratio Bland-Altman — VIIRS(375 m) / MODIS(1 km) monthly agreement</div>
                <svg viewBox="0 0 340 160" className="h-48 w-full">
                  {(() => {
                    const xMin = Math.log10(Math.max(1, Math.min(...eng.overlap.mA.map((m, i) => Math.sqrt(m * eng.overlap.vA[i])))));
                    const xMax = Math.log10(Math.max(...eng.overlap.mA.map((m, i) => Math.sqrt(m * eng.overlap.vA[i]))));
                    const yMin = Math.log10(agree.ratioLo * 0.7), yMax = Math.log10(agree.ratioHi * 1.4);
                    const X = (v: number) => 34 + ((Math.log10(Math.max(1e-6, v)) - xMin) / Math.max(0.01, xMax - xMin)) * 292;
                    const Y = (v: number) => 132 - ((Math.log10(v) - yMin) / Math.max(0.01, yMax - yMin)) * 112;
                    return (
                      <g>
                        <line x1={34} y1={Y(agree.ratioGeo)} x2={326} y2={Y(agree.ratioGeo)} stroke="#F97316" strokeWidth={1.4} />
                        <text x={328} y={Y(agree.ratioGeo) + 3} fontSize={7.5} fill="#F97316" textAnchor="end">{agree.ratioGeo}× bias</text>
                        <line x1={34} y1={Y(agree.ratioLo)} x2={326} y2={Y(agree.ratioLo)} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
                        <line x1={34} y1={Y(agree.ratioHi)} x2={326} y2={Y(agree.ratioHi)} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
                        {eng.overlap.mA.map((m, i) => {
                          const gm = Math.sqrt(m * eng.overlap.vA[i]);
                          return <circle key={eng.overlap.ovYm[i]} cx={X(gm)} cy={Y(eng.overlap.vA[i] / m)} r={2.6} fill="#38BDF8" fillOpacity={0.8} stroke="#050A14" strokeWidth={0.6} />;
                        })}
                        <text x={180} y={156} fontSize={8} fill="#64748B" textAnchor="middle">√(MODIS·VIIRS) geometric-mean count (log axis)</text>
                        <text x={10} y={20} fontSize={8} fill="#64748B" transform="rotate(-90 10 20)" textAnchor="middle">VIIRS/MODIS ratio (log)</text>
                      </g>
                    );
                  })()}
                </svg>
                <p className="mt-1 text-[9px] text-slate-500">Classic Bland-Altman, ratio variant (correct for count data with proportional error). The orange line is the systematic bias — the <i>harmonization coefficient</i>; dashed lines are the 95% limits within which 95% of months agree. A bias line that tilts across the x-range would reveal a count-dependence (small fires inflate VIIRS disproportionately) — the core of Challenge #9 quantified.</p>
              </div>
              <Verdict>
                Over {agree.n} overlap months, MODIS and VIIRS agree with Pearson r = {agree.pearson} / Spearman ρ = {agree.spearman}, but VIIRS detects <b className="text-slate-100">{agree.ratioGeo}×</b> the MODIS count (95% of months within {agree.ratioLo}–{agree.ratioHi}×). IGNIS&apos;s unified series applies exactly this coefficient backwards before 2012 — the scale link that makes a single 26-year record defensible.
              </Verdict>
            </>
          ) : (
            <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-6 text-center text-[12px] text-slate-500">Needs ≥6 overlapping MODIS/VIIRS months in this AOI&apos;s calendar document.</div>
          )}
        </div>
      )}

      {tab === 'phenology' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="Seasons detected" value={String(phen.years.length)} sub="years with ≥9 months of data" />
            <Card label="Mean duration" value={phen.meanDuration ? `${phen.meanDuration} mo` : '—'} sub="months ≥40% of year-peak" tone="orange" />
            <Card label="Onset shift" value={phen.onsetShiftMonthsPerDecade === null ? '—' : `${phen.onsetShiftMonthsPerDecade >= 0 ? '+' : ''}${(phen.onsetShiftMonthsPerDecade * 30.4).toFixed(0)} d/decade`} sub="linear trend of season start" tone={phen.onsetShiftMonthsPerDecade !== null && phen.onsetShiftMonthsPerDecade < 0 ? 'rose' : 'cyan'} />
            <Card label="Method" value="40% fractile" sub="onset/offset def. (standard)" />
          </div>
          <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">Fire-season phenology — onset → offset window per year (most recent on top)</div>
            <svg viewBox={`0 0 340 ${Math.max(120, phen.years.length * 14 + 30)}`} className="w-full" style={{ height: Math.max(120, phen.years.length * 14 + 30) }}>
              {(() => {
                const yrs = [...phen.years].reverse();
                const rowH = 14, top = 24, left = 34, width = 294;
                return (
                  <g>
                    {MONTHS_SCI.map((m, i) => (
                      <text key={m} x={left + ((i + 0.5) / 12) * width} y={12} fontSize={7} fill="#64748B" textAnchor="middle">{m[0]}</text>
                    ))}
                    {yrs.map((s, ri) => {
                      const y = top + ri * rowH;
                      const x1 = left + (s.onset / 12) * width;
                      const x2 = left + ((s.offset + 1) / 12) * width;
                      return (
                        <g key={s.year}>
                          <text x={2} y={y + 9} fontSize={8} fill="#94A3B8" fontFamily="monospace">{s.year}</text>
                          <rect x={x1} y={y + 1} width={Math.max(2, x2 - x1)} height={rowH - 5} rx={2.5} fill="rgba(249,115,22,0.55)" stroke="#F97316" strokeWidth={0.6} />
                          <circle cx={left + ((s.peak + 0.5) / 12) * width} cy={y + rowH / 2 - 1.5} r={2.4} fill="#FBBF24" stroke="#050A14" strokeWidth={0.5} />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
            </svg>
            <p className="mt-1 text-[9px] text-slate-500">Bar = months at ≥40% of that year&apos;s peak activity; gold dot = peak month. Drift of bar starts to the left across years = fire seasons arriving earlier (warming signature); widening bars = lengthening operational window for responders.</p>
          </div>
          <Verdict>{phen.verdict} Mean active window: {phen.meanDuration ?? '—'} months. Peak-month dot distribution across the rows shows whether the core of the season is migrating within the calendar.</Verdict>
        </div>
      )}

      {tab === 'energy' && (
        <div className="space-y-3">
          {!frp ? (
            <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-6 text-center text-[12px] text-slate-500">Live FRP energy statistics need today&apos;s hotspots — wait for the map snapshot to load for <b className="text-slate-300">{regionName}</b>, then revisit this tab.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Card label="Detections sampled" value={fmtNum(frp.n)} sub="live FIRMS snapshot, all sensors" />
                <Card label="Median FRP" value={`${fmtNum(frp.p50)} MW`} sub={`mean ${fmtNum(frp.mean)} MW`} tone="orange" />
                <Card label="p90 FRP" value={`${fmtNum(frp.p90)} MW`} sub="intense-fire threshold" tone="rose" />
                <Card label="p99 FRP" value={`${fmtNum(frp.p99)} MW`} sub={`max ${fmtNum(frp.max)} MW`} tone="rose" />
                <Card label="Energy Gini" value={String(frp.gini)} sub="0 = uniform burn intensity, 1 = single megaflare" tone="violet" />
                <Card label="Top-1% share" value={`${(frp.top1Share * 100).toFixed(0)}%`} sub="of total radiative energy" tone="violet" />
              </div>
              <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
                <div className="mb-2 text-[11px] font-bold text-slate-200">FRP intensity spectrum — detection count (bars) vs share of radiative energy (line), log-spaced MW bins</div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={frp.bins.map((b) => ({ label: b.label, count: b.count, share: +(b.energyShare * 100).toFixed(1) }))} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#13253D" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 8.5 }} />
                      <YAxis yAxisId="l" tick={{ fill: '#64748B', fontSize: 9 }} width={44} tickFormatter={(v: number) => fmtNum(v)} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fill: '#64748B', fontSize: 9 }} width={38} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar yAxisId="l" dataKey="count" name="detections" fill="rgba(251,146,60,0.45)" stroke="#FB923C" strokeWidth={0.8} radius={[2, 2, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="share" name="energy share" stroke="#F472B6" strokeWidth={2} dot={{ r: 2.5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-[9px] text-slate-500">The canonical fire-energy result: most detections are faint smouldering pixels, but the right tail owns the energy. Where the pink line crosses the bars defines your <i>operationally significant</i> fire size class.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {frp.classes.map((c) => (
                  <span key={c.label} className="rounded-full border px-2.5 py-1 text-[9.5px] font-semibold" style={{ borderColor: `${c.color}55`, color: c.color, background: `${c.color}11` }}>
                    {c.label}: {c.pct}%
                  </span>
                ))}
              </div>
              {moran && (
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
                    <div className="mb-2 text-[11px] font-bold text-slate-200">Spatial autocorrelation — Moran&apos;s I (499-fold permutation test)</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Card label="Moran's I" value={String(moran.i)} sub={`E[I]=${moran.expected} under randomness`} tone="violet" />
                      <Card label="z-score" value={String(moran.zScore)} sub="randomization inference" tone={moran.zScore > 1.96 ? 'orange' : 'cyan'} />
                      <Card label="pseudo-p" value={String(moran.p)} sub={moran.p < 0.05 ? 'significantly clustered' : 'not clustered'} tone={moran.p < 0.05 ? 'rose' : 'emerald'} />
                      <Card label="Grid" value={`${moran.cells} cells`} sub={`${moran.binDeg}° adaptive bins · ${fmtNum(moran.n)} pts`} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[9.5px]">
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-semibold text-red-300">High-High cores: {moran.lisa.HH}</span>
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 font-semibold text-sky-300">Low-Low voids: {moran.lisa.LL}</span>
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-300">High-islands: {moran.lisa.HL}</span>
                      <span className="rounded-full bg-slate-500/20 px-2 py-0.5 font-semibold text-slate-300">Low-holes: {moran.lisa.LH}</span>
                      <span className="rounded-full bg-[#13253F] px-2 py-0.5 text-slate-400">non-significant: {moran.lisa.NS}</span>
                    </div>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-slate-500">Moran&apos;s I &gt; 0 with p &lt; 0.05 proves the fire front is <i>spatially organized</i>, not random ignitions — the statistical warrant for the cluster-segmentation ML in the Fire Cluster Lab. LISA quadrants (Anselin 1995): High-High = active fire cores; Low-Low = burned-out interiors; High-islands = new isolated ignitions worth early-alert watches.</p>
                  </div>
                  <div className="rounded-lg border border-[#14273F] bg-[#0A1423]/60 p-3">
                    <div className="mb-2 text-[11px] font-bold text-slate-200">Moran scatter plot — cell density vs neighborhood density</div>
                    <svg viewBox="0 0 320 170" className="h-48 w-full">
                      {(() => {
                        const zs = mScat.map((p) => p.z), ls = mScat.map((p) => p.lag);
                        const zMax = Math.max(2.5, ...zs.map(Math.abs)), lMax = Math.max(2.5, ...ls.map(Math.abs));
                        const X = (v: number) => 160 + (v / (lMax * 1.1)) * 140;
                        const Y = (v: number) => 80 - (v / (zMax * 1.1)) * 68;
                        const color = (z: number, lag: number) => (z > 0 && lag > 0 ? '#EF4444' : z < 0 && lag < 0 ? '#38BDF8' : z > 0 ? '#FBBF24' : '#94A3B8');
                        return (
                          <g>
                            <line x1={20} y1={80} x2={300} y2={80} stroke="#334155" strokeWidth={1} />
                            <line x1={160} y1={12} x2={160} y2={148} stroke="#334155" strokeWidth={1} />
                            {mScat.map((p, i) => <circle key={i} cx={X(p.lag)} cy={Y(p.z)} r={2.4} fill={color(p.z, p.lag)} fillOpacity={0.75} />)}
                            <text x={302} y={77} fontSize={7.5} fill="#64748B" textAnchor="end">lag→</text>
                            <text x={166} y={18} fontSize={7.5} fill="#64748B">z↑</text>
                            <text x={24} y={144} fontSize={7.5} fill="#EF4444">HH</text>
                            <text x={286} y={144} fontSize={7.5} fill="#FBBF24">HL</text>
                            <text x={24} y={22} fontSize={7.5} fill="#94A3B8">LH</text>
                            <text x={286} y={22} fontSize={7.5} fill="#38BDF8">LL</text>
                          </g>
                        );
                      })()}
                    </svg>
                    <p className="mt-1 text-[9px] text-slate-500">Each dot = one grid cell (x: mean neighbor density = spatial lag; y: own density, both standardized). The cloud&apos;s upward tilt IS Moran&apos;s I made visible — red = fire cores (HH), blue = quiet voids (LL), amber = isolated new ignitions (HL) that early-alert systems watch.</p>
                  </div>
                </div>
              )}
              <Verdict>
                Today&apos;s {fmtNum(frp.n)} detections over {regionName} carry a median intensity of <b className="text-slate-100">{fmtNum(frp.p50)} MW</b>, but the top 1% of pixels concentrate <b className="text-violet-300">{(frp.top1Share * 100).toFixed(0)}%</b> of all radiative energy (Gini = {frp.gini}).
                {moran && moran.p < 0.05 ? ` Fires are strongly spatially clustered (Moran's I = ${moran.i}, p = ${moran.p}) with ${moran.lisa.HH} High-High core cells — suppression staging belongs at those cores, not at the diffuse periphery.` : moran ? ' Spatial clustering is not significant in today\'s snapshot — detections are dispersed rather than organized.' : ''}
              </Verdict>
            </>
          )}
        </div>
      )}
    </div>
  );
}
