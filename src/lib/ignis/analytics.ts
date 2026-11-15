// IGNIS analytics engine — pure client-side time-series science over the harmonized NASA record.
// All methods are deterministic and auditable (no black-box), per the REV 2.0 doctrine:
//   - unified harmonized series via overlap-derived continuity coefficient
//   - monthly climatology + z-score anomaly ("unusual conditions")
//   - Theil-Sen robust trend, CUSUM change-point detection
//   - classical seasonal-trend decomposition
//   - harmonic (Fourier) regression forecast with residual bands
//   - burn-regime nearest-prototype classification (k=1 over 8 NASA-derived references)
import type { CalendarDoc, MonthRow, UnifiedRow, Climatology, ForecastPoint, RegimeResult, RegimeFeatureVec } from './types';
import PROTOTYPES from './regimePrototypes.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LABELS = MONTHS;

function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a: number[]): number { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); }
function quantile(a: number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export function median(a: number[]): number { return quantile(a, 0.5); }

// ---------- 1. unified harmonized series ----------
// Reference scale = VIIRS S-NPP (375 m), the longest-running VIIRS record.
//   • MODIS-era months (no VIIRS): MODIS × r(m), where r(m) is a SEASONAL (calendar-month)
//     continuity coefficient from the 2012+ overlap, shrunk toward the all-months median in
//     log space when a calendar month has few overlap years:
//         log r(m) = (k·median_m(log ratio) + K0·log r̄) / (k + K0),  K0 = 3
//     Seasonality matters: VIIRS/MODIS ratios swing with fire size distribution (many
//     small agricultural burns in one season, large fronts in another).
//   • OBSERVATION SCHEDULE: the MODIS reference is AQUA wherever Aqua exists (2002-07 →).
//     Aqua and the VIIRS satellites share the same ~13:30 / 01:30 local overpass, so the
//     Aqua↔VIIRS ratio compares the two instruments looking at the fire's daily cycle at
//     the same moment — it measures sensor sensitivity/resolution, not time of day. MODIS
//     Terra (~10:30 / 22:30, before the afternoon fire peak) is used only for the months
//     before Aqua (2000-11 → 2002-06), with its own Terra↔VIIRS ratio, which therefore
//     also absorbs the morning-vs-afternoon difference for those months.
//   • Post-S-NPP months: VIIRS NOAA-20 / NOAA-21 × bridge coefficient
//     median(S-NPP / NOAA-xx) over their own overlap — the record keeps going on the VIIRS
//     constellation as MODIS and S-NPP retire.
export type ModisRef = {
  sensor: string;
  ratioCount: number | null;
  ratioFrp: number | null;
  overlapMonths: number;
  ratioCV: number | null;
  ratioByMonth: (number | null)[];
  ratioFrpByMonth: (number | null)[];
};
export type UnifiedMeta = {
  /** MODIS sensor the headline coefficients below belong to (Aqua when the calendar has it) */
  modisRef: string;
  /** all-months median VIIRS-SNPP / MODIS count ratio (r̄) for `modisRef` */
  ratioCount: number | null;
  ratioFrp: number | null;
  overlapMonths: number;
  /** coefficient of variation of the raw monthly ratios */
  ratioCV: number | null;
  /** seasonal count coefficients r(m), Jan..Dec (null if no overlap at all) */
  ratioByMonth: (number | null)[];
  ratioFrpByMonth: (number | null)[];
  /** every MODIS reference in use, in priority order (Aqua first, then Terra) */
  modisRefs: ModisRef[];
  /** VIIRS-to-VIIRS bridges used after the S-NPP record ends */
  bridges: { sensor: string; ratioCount: number; ratioFrp: number | null; overlapMonths: number }[];
};

const SHRINK_K0 = 3;
const BRIDGE_SENSORS = ['VIIRS-NOAA20', 'VIIRS-NOAA21'] as const;

function seasonalRatios(pairs: { mi: number; ratio: number }[], global: number | null): (number | null)[] {
  if (global === null || global <= 0) return Array(12).fill(null);
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const p of pairs) if (p.ratio > 0) byMonth[p.mi].push(Math.log(p.ratio));
  const lg = Math.log(global);
  return byMonth.map((logs) => {
    const k = logs.length;
    if (!k) return +global.toFixed(4);
    return +Math.exp((k * median(logs) + SHRINK_K0 * lg) / (k + SHRINK_K0)).toFixed(4);
  });
}

// priority order: Aqua shares the VIIRS overpass time, Terra covers the months before Aqua
const MODIS_REFS = ['MODIS-Aqua', 'MODIS-Terra'] as const;

export function buildUnified(doc: CalendarDoc): { rows: UnifiedRow[]; meta: UnifiedMeta } {
  const snpp = doc.sensors['VIIRS-SNPP']?.monthly || [];
  const sByYm = new Map<string, MonthRow>(snpp.map((r) => [r.ym, r]));

  // MODIS ↔ S-NPP continuity coefficients from the 2012+ overlap window, per MODIS satellite
  const modisRefs: ModisRef[] = [];
  const modisRows = new Map<string, Map<string, MonthRow>>();
  for (const sensor of MODIS_REFS) {
    const monthly = doc.sensors[sensor]?.monthly || [];
    if (!monthly.length) continue;
    const byYm = new Map<string, MonthRow>(monthly.map((r) => [r.ym, r]));
    const pairsC: { mi: number; ratio: number }[] = [];
    const pairsF: { mi: number; ratio: number }[] = [];
    for (const [ym, sv] of sByYm) {
      const m = byYm.get(ym);
      if (!m || m.est <= 0 || sv.est <= 0) continue;
      const mi = Number(ym.slice(5, 7)) - 1;
      pairsC.push({ mi, ratio: sv.est / m.est });
      if (m.frp > 0 && sv.frp > 0) pairsF.push({ mi, ratio: sv.frp / m.frp }); // no max(1,·) floor — it inflated near-zero-FRP months
    }
    const ratiosC = pairsC.map((x) => x.ratio);
    const ratioCount = ratiosC.length ? median(ratiosC) : null;
    const ratioFrp = pairsF.length ? median(pairsF.map((x) => x.ratio)) : null;
    modisRefs.push({
      sensor, ratioCount, ratioFrp, overlapMonths: ratiosC.length,
      ratioCV: ratiosC.length ? +(std(ratiosC) / Math.max(1e-6, mean(ratiosC))).toFixed(3) : null,
      ratioByMonth: seasonalRatios(pairsC, ratioCount),
      ratioFrpByMonth: seasonalRatios(pairsF, ratioFrp),
    });
    modisRows.set(sensor, byYm);
  }
  // a reference with no overlap at all cannot be scaled — keep it only as a last resort
  const usable = modisRefs.filter((r) => r.ratioCount !== null);
  const refs = usable.length ? usable : modisRefs;
  const primary: ModisRef = refs[0] ?? { sensor: 'MODIS-Terra', ratioCount: null, ratioFrp: null, overlapMonths: 0, ratioCV: null, ratioByMonth: Array(12).fill(null), ratioFrpByMonth: Array(12).fill(null) };

  // VIIRS bridges (NOAA-20 / NOAA-21 → S-NPP scale) — need ≥ 3 overlap months to be trusted
  const bridges: UnifiedMeta['bridges'] = [];
  const bridgeRows = new Map<string, Map<string, MonthRow>>();
  for (const key of BRIDGE_SENSORS) {
    const rows = doc.sensors[key]?.monthly || [];
    if (!rows.length) continue;
    const c: number[] = [], f: number[] = [];
    for (const r of rows) {
      const sv = sByYm.get(r.ym);
      if (!sv || sv.est <= 0 || r.est <= 0) continue;
      c.push(sv.est / r.est);
      if (sv.frp > 0 && r.frp > 0) f.push(sv.frp / r.frp);
    }
    if (c.length < 3) continue;
    bridges.push({ sensor: key, ratioCount: +median(c).toFixed(4), ratioFrp: f.length ? +median(f).toFixed(4) : null, overlapMonths: c.length });
    bridgeRows.set(key, new Map(rows.map((r) => [r.ym, r])));
  }

  const allYm = new Set<string>([...sByYm.keys()]);
  for (const m of modisRows.values()) for (const ym of m.keys()) allYm.add(ym);
  for (const m of bridgeRows.values()) for (const ym of m.keys()) allYm.add(ym);

  const rows: UnifiedRow[] = [...allYm].sort().map((ym): UnifiedRow => {
    const sv = sByYm.get(ym);
    // S-NPP reporting zero while another sensor sees fires = an S-NPP outage (e.g. Aug 2022
    // safe mode), not a fire-free month → fall through to the bridge sensors / MODIS.
    const othersSeeFire = [...modisRows.values()].some((m) => (m.get(ym)?.est ?? 0) > 0)
      || bridges.some((b) => (bridgeRows.get(b.sensor)?.get(ym)?.est ?? 0) > 0);
    if (sv && !(sv.est === 0 && othersSeeFire)) return { ym, count: sv.est, frp: sv.frp, scaled: false, src: 'VIIRS-SNPP' };
    for (const b of bridges) {
      const r = bridgeRows.get(b.sensor)?.get(ym);
      if (r) {
        return {
          ym,
          count: Math.round(r.est * b.ratioCount),
          frp: Math.round(r.frp * (b.ratioFrp ?? 1)),
          scaled: true,
          src: b.sensor,
        };
      }
    }
    // MODIS era: Aqua when it has the month (same overpass time as VIIRS), else Terra
    const mi = Number(ym.slice(5, 7)) - 1;
    for (const ref of refs) {
      const m = modisRows.get(ref.sensor)?.get(ym);
      if (!m) continue;
      return {
        ym,
        count: Math.round(m.est * (ref.ratioByMonth[mi] ?? ref.ratioCount ?? 1)),
        frp: Math.round(m.frp * (ref.ratioFrpByMonth[mi] ?? ref.ratioFrp ?? 1)),
        scaled: true,
        src: ref.sensor,
      };
    }
    return { ym, count: 0, frp: 0, scaled: false };
  }).filter((r) => r.count > 0 || r.frp > 0);

  return {
    rows,
    meta: {
      modisRef: primary.sensor, ratioCount: primary.ratioCount, ratioFrp: primary.ratioFrp, overlapMonths: primary.overlapMonths,
      ratioCV: primary.ratioCV, ratioByMonth: primary.ratioByMonth, ratioFrpByMonth: primary.ratioFrpByMonth,
      modisRefs: refs, bridges,
    },
  };
}

/** Harmonized monthly calendar as CSV (one row per month) — the downloadable analytic. */
export function unifiedToCsv(doc: CalendarDoc, rows: UnifiedRow[], meta: UnifiedMeta, clim: Climatology | null): string {
  const raw = (sensor: string, ym: string) => doc.sensors[sensor]?.monthly.find((r) => r.ym === ym)?.est ?? '';
  const header = ['month', 'harmonized_detections', 'harmonized_frp_mw', 'source_sensor', 'scaled', 'coefficient',
    'anomaly_z', 'modis_terra_est', 'modis_aqua_est', 'viirs_snpp_est', 'viirs_noaa20_est', 'viirs_noaa21_est'];
  const lines = [
    `# IGNIS harmonized burning-activity calendar — ${doc.name} — bbox ${doc.bbox.join(',')}`,
    `# reference scale VIIRS S-NPP 375 m; MODIS-era months = MODIS Aqua (same overpass time as VIIRS) x seasonal r(m), MODIS Terra before Aqua; method: ${doc.meta.method.replace(/[\r\n]+/g, ' ')}`,
    header.join(','),
  ];
  for (const r of rows) {
    const mi = Number(r.ym.slice(5, 7)) - 1;
    const mref = meta.modisRefs.find((x) => x.sensor === r.src);
    const coef = mref ? mref.ratioByMonth[mi] ?? mref.ratioCount
      : r.src && r.src !== 'VIIRS-SNPP' ? meta.bridges.find((b) => b.sensor === r.src)?.ratioCount ?? null
        : 1;
    const z = clim ? anomalyZ(rows, clim, r.ym) : null;
    lines.push([
      r.ym, r.count, r.frp, r.src ?? '', r.scaled, coef ?? '', z ?? '',
      raw('MODIS-Terra', r.ym), raw('MODIS-Aqua', r.ym), raw('VIIRS-SNPP', r.ym), raw('VIIRS-NOAA20', r.ym), raw('VIIRS-NOAA21', r.ym),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------- 2. climatology + anomalies ----------
export function buildClimatology(rows: UnifiedRow[], baselineEnd = '2024-01'): Climatology {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of rows) {
    if (r.ym >= baselineEnd) continue; // climatology baseline ends before the evaluation window
    const mi = Number(r.ym.slice(5, 7)) - 1;
    byMonth[mi].push(r.count);
  }
  const meanA = byMonth.map(mean);
  const medianA = byMonth.map(median);
  const stdA = byMonth.map(std);
  const peakMonth = meanA.indexOf(Math.max(...meanA));
  // peak window = months >= 70% of peak
  const peakWindow: number[] = [];
  meanA.forEach((v, i) => { if (v >= 0.7 * Math.max(...meanA)) peakWindow.push(i); });
  return { mean: meanA.map((v) => Math.round(v)), median: medianA.map((v) => Math.round(v)), std: stdA.map((v) => Math.round(v)), peakMonth, peakWindow };
}

export function anomalyZ(rows: UnifiedRow[], clim: Climatology, ym: string): number | null {
  const row = rows.find((r) => r.ym === ym);
  if (!row) return null;
  const mi = Number(ym.slice(5, 7)) - 1;
  const sd = clim.std[mi] || Math.max(1, clim.mean[mi] * 0.3);
  return +(((row.count - clim.mean[mi]) / sd).toFixed(2));
}

export function latestAnomalies(rows: UnifiedRow[], clim: Climatology, n = 3): { ym: string; z: number; count: number }[] {
  const out: { ym: string; z: number; count: number }[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    const z = anomalyZ(rows, clim, rows[i].ym);
    if (z !== null) out.push({ ym: rows[i].ym, z, count: rows[i].count });
  }
  return out.reverse();
}

// ---------- 3. robust trend (Theil-Sen) ----------
export function theilSen(y: number[]): { slope: number; intercept: number } {
  const n = y.length;
  if (n < 4) return { slope: 0, intercept: mean(y) };
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((y[j] - y[i]) / (j - i));
  const slope = median(slopes);
  const intercept = median(y.map((v, i) => v - slope * i));
  return { slope, intercept };
}

// ---------- 4. change points (CUSUM on annual totals) ----------
export function changePoints(rows: UnifiedRow[]): { year: number; score: number; before: number; after: number }[] {
  const annual = new Map<number, number>();
  for (const r of rows) {
    const y = Number(r.ym.slice(0, 4));
    // scale partial years out: weight by months present
    annual.set(y, (annual.get(y) || 0) + r.count);
  }
  const monthCount = new Map<number, number>();
  for (const r of rows) { const y = Number(r.ym.slice(0, 4)); monthCount.set(y, (monthCount.get(y) || 0) + 1); }
  const years = [...annual.keys()].filter((y) => monthCount.get(y)! >= 10).sort();
  if (years.length < 6) return [];
  const vals = years.map((y) => annual.get(y)! / (monthCount.get(y)! / 12)); // 12-month normalized
  const m = mean(vals);
  let cum = 0, min = 0, argmin = 0, max = 0, argmax = 0;
  const cums: number[] = [];
  vals.forEach((v, i) => { cum += v - m; cums.push(cum); if (cum < min) { min = cum; argmin = i + 1; } if (cum > max) { max = cum; argmax = i + 1; } });
  const sMax = max - min;
  const sRange = std(vals) * Math.sqrt(vals.length) * 2 || 1;
  const cands: { year: number; score: number; before: number; after: number }[] = [];
  for (const k of [argmin, argmax]) {
    if (k <= 0 || k >= years.length) continue;
    const before = mean(vals.slice(0, k)), after = mean(vals.slice(k));
    const score = +Math.min(0.99, Math.abs(before - after) / (std(vals) + 1e-9) / 1.5).toFixed(2);
    if (score > 0.25) cands.push({ year: years[k], score, before: Math.round(before), after: Math.round(after) });
  }
  void sMax; void sRange; void cums;
  return cands.sort((a, b) => b.score - a.score).slice(0, 2);
}

// ---------- 5. decomposition ----------
export function decompose(rows: UnifiedRow[]): { ym: string; observed: number; trend: number | null; seasonal: number; resid: number | null }[] {
  const obs = rows.map((r) => r.count);
  const trend: (number | null)[] = rows.map((_, i) => {
    if (i < 6 || i >= rows.length - 6) return null;
    return mean(obs.slice(i - 6, i + 6));
  });
  // seasonal = mean detrended value per calendar month
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  rows.forEach((r, i) => {
    if (trend[i] === null) return;
    byMonth[Number(r.ym.slice(5, 7)) - 1].push(r.count - (trend[i] as number));
  });
  const seasonal = byMonth.map((a) => (a.length ? mean(a) : 0));
  return rows.map((r, i) => ({
    ym: r.ym, observed: r.count, trend: trend[i],
    seasonal: Math.round(seasonal[Number(r.ym.slice(5, 7)) - 1]),
    resid: trend[i] === null ? null : Math.round(r.count - (trend[i] as number) - seasonal[Number(r.ym.slice(5, 7)) - 1]),
  }));
}

// ---------- 6. harmonic regression forecast ----------
export function harmonicForecast(rows: UnifiedRow[], horizon = 12, trainMonths = 216): { points: ForecastPoint[]; sigma: number; r2: number } {
  if (rows.length < 36) return { points: [], sigma: 0, r2: 0 };
  const train = rows.slice(-trainMonths);
  const n = train.length;
  const t0 = 0;
  // design: [1, t, sin(2π m/12), cos(2π m/12), sin(4π m/12), cos(4π m/12)] on log1p(count)
  const X: number[][] = [];
  const Y: number[] = [];
  train.forEach((r, i) => {
    const mi = Number(r.ym.slice(5, 7)) - 1;
    X.push([1, i + t0, Math.sin((2 * Math.PI * mi) / 12), Math.cos((2 * Math.PI * mi) / 12), Math.sin((4 * Math.PI * mi) / 12), Math.cos((4 * Math.PI * mi) / 12)]);
    Y.push(Math.log1p(r.count));
  });
  const p = X[0].length;
  // normal equations with ridge for stability
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      b[a] += X[i][a] * Y[i];
      for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c];
    }
  }
  for (let a = 0; a < p; a++) A[a][a] += 1e-6;
  // gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r2 = col + 1; r2 < p; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let r2 = 0; r2 < p; r2++) {
      if (r2 === col) continue;
      const f = M[r2][col] / M[col][col];
      for (let c = col; c <= p; c++) M[r2][c] -= f * M[col][c];
    }
  }
  const beta = M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[p] / row[i]));
  const fit = X.map((xi) => xi.reduce((s, x, k) => s + x * beta[k], 0));
  const resid = Y.map((y, i) => y - fit[i]);
  const sigma = Math.sqrt(mean(resid.map((r) => r * r)));
  const ssRes = resid.reduce((s, r) => s + r * r, 0);
  const ssTot = Y.reduce((s, y) => s + (y - mean(Y)) ** 2, 0);
  const r2 = ssTot > 0 ? +Math.max(0, 1 - ssRes / ssTot).toFixed(3) : 0;

  // forecast next `horizon` months after last observed
  const lastYm = rows[rows.length - 1].ym;
  let y = Number(lastYm.slice(0, 4)), mo = Number(lastYm.slice(5, 7));
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    mo++; if (mo > 12) { mo = 1; y++; }
    const mi = mo - 1;
    const x = [1, n - 1 + h, Math.sin((2 * Math.PI * mi) / 12), Math.cos((2 * Math.PI * mi) / 12), Math.sin((4 * Math.PI * mi) / 12), Math.cos((4 * Math.PI * mi) / 12)];
    const pred = Math.max(0, Math.expm1(x.reduce((s, xv, k) => s + xv * beta[k], 0)));
    points.push({
      ym: `${y}-${String(mo).padStart(2, '0')}`,
      mean: Math.round(pred),
      lo: Math.round(Math.max(0, Math.expm1(x.reduce((s, xv, k) => s + xv * beta[k], 0) - 1.96 * sigma))),
      hi: Math.round(Math.expm1(x.reduce((s, xv, k) => s + xv * beta[k], 0) + 1.96 * sigma)),
    });
  }
  return { points, sigma: +sigma.toFixed(3), r2 };
}

export function forecastPeak(points: ForecastPoint[]): { ym: string; mean: number } | null {
  if (!points.length) return null;
  return points.reduce((a, b) => (b.mean > a.mean ? b : a));
}

// ---------- 7. burn-regime classifier (nearest prototype, z-standardized) ----------
type Proto = { key: string; label: string; note: string; features: RegimeFeatureVec };

export function regimeFeatures(doc: CalendarDoc, rows: UnifiedRow[]): RegimeFeatureVec | null {
  const modis = doc.sensors['MODIS-Terra']?.monthly || [];
  if (!rows.length || !modis.length) return null;
  const counts = rows.map((r) => r.count);
  const clim = buildClimatology(rows);
  const byMonthMean = clim.mean;
  const peak = Math.max(...byMonthMean);
  const trough = Math.max(1, Math.min(...byMonthMean.filter((v) => v > 0)));
  const seasonality = +(peak / Math.max(1, median(counts))).toFixed(2);
  const annual = new Map<number, number>();
  const monthsIn = new Map<number, number>();
  for (const r of rows) {
    const y = Number(r.ym.slice(0, 4));
    annual.set(y, (annual.get(y) || 0) + r.count);
    monthsIn.set(y, (monthsIn.get(y) || 0) + 1);
  }
  // normalize partial years to 12-month equivalent (consistent with changePoints)
  const av = [...annual.entries()].map(([y, v]) => v / Math.max(1, (monthsIn.get(y) || 12) / 12));
  const interannualCV = +(std(av) / Math.max(1, mean(av))).toFixed(3);
  const night = modis.reduce((s, m) => s + m.night, 0);
  const tot = modis.reduce((s, m) => s + m.est, 0);
  const nightFraction = +(night / Math.max(1, tot)).toFixed(3);
  const frpSum = rows.reduce((s, r) => s + r.frp, 0);
  const countSum = rows.reduce((s, r) => s + r.count, 0);
  const meanFrp = +(frpSum / Math.max(1, countSum)).toFixed(1);
  const logMedianCount = +Math.log10(Math.max(1, median(counts))).toFixed(2);
  return { peakMonth: clim.peakMonth, seasonality, interannualCV, nightFraction, meanFrp, logMedianCount };
}

const FEATURE_KEYS: (keyof RegimeFeatureVec)[] = ['peakMonth', 'seasonality', 'interannualCV', 'nightFraction', 'meanFrp', 'logMedianCount'];
const FEATURE_META: Record<string, { name: string; unit: string }> = {
  peakMonth: { name: 'Peak month', unit: '' },
  seasonality: { name: 'Seasonality (peak/median)', unit: '×' },
  interannualCV: { name: 'Interannual variability (CV)', unit: '' },
  nightFraction: { name: 'Night detections', unit: 'frac' },
  meanFrp: { name: 'Mean FRP', unit: 'MW' },
  logMedianCount: { name: 'Typical monthly detections', unit: 'log10' },
};

function circDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

export function classifyRegime(fv: RegimeFeatureVec): RegimeResult {
  const protos = PROTOTYPES as Proto[];
  // standardize each feature across [fv + protos]
  const all = [fv, ...protos.map((p) => p.features)];
  const z = (v: number, key: keyof RegimeFeatureVec) => {
    const col = all.map((x) => x[key]);
    const m = mean(col), s = std(col) || 1;
    return (v - m) / s;
  };
  const scored = protos.map((p) => {
    let d2 = 0;
    const contrib: { k: keyof RegimeFeatureVec; d: number }[] = [];
    for (const k of FEATURE_KEYS) {
      const dd = k === 'peakMonth'
        ? (circDist(fv.peakMonth, p.features.peakMonth) / 6) ** 2
        : (z(fv[k], k) - z(p.features[k], k)) ** 2;
      d2 += dd;
      contrib.push({ k, d: +dd.toFixed(3) });
    }
    const dist = Math.sqrt(d2 / FEATURE_KEYS.length);
    return { p, dist, sim: +(1 / (1 + dist)).toFixed(3), contrib };
  }).sort((a, b) => a.dist - b.dist);

  const top = scored[0];
  const runners = scored.slice(1, 3).map((s) => ({ key: s.p.key, label: s.p.label, similarity: s.sim, note: s.p.note }));
  const features = FEATURE_KEYS.map((k) => ({
    name: FEATURE_META[k].name, value: fv[k], unit: FEATURE_META[k].unit,
    matchValue: top.p.features[k],
  }));
  const summary = `This AOI most resembles the ${top.p.label} regime (${Math.round(top.sim * 100)}% prototype similarity): ${top.p.note} Closest analog region: ${top.p.label}. Runner-ups: ${runners.map((r) => r.label).join(', ')}.`;
  return {
    top: { key: top.p.key, label: top.p.label, similarity: top.sim, note: top.p.note },
    runners,
    features,
    summary,
  };
}

// ---------- helpers for UI ----------
export function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function ymLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
