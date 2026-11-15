// IGNIS statistics science engine — v8.1 "SCIENCE LAB"
// Deterministic, auditable, peer-method statistics layered on top of the harmonized
// MODIS/VIIRS record (analytics.ts) and the live FIRMS hotspot snapshot. No black-box:
// every routine below is a classical, citable method implemented from its textbook form.
//
//   1. Mann-Kendall trend test + Sen's slope          (Mann 1945; Sen 1968; Kendall 1975)
//   2. Autocorrelation function (ACF) + 95% CI        (Box & Jenkins)
//   3. Rescaled-range Hurst exponent                  (Hurst 1951; Mandelbrot)
//   4. DFT periodogram on deseasonalized series       (Bloomfield, Fourier analysis)
//   5. Empirical return periods + Gumbel fit          (Coles, EVT plotting positions)
//   6. Peaks-over-threshold anomaly register          (climatology z ≥ threshold)
//   7. Cross-sensor agreement: Pearson/Spearman +     (Bland & Altman 1986, ratio variant)
//      ratio Bland-Altman limits of agreement
//   8. Fire-season phenology: onset/offset/duration   (season-fractile method)
//   9. Season-adjusted momentum (rate of change)      — persistence of *change*
//  10. FRP intensity economics: log-binned spectrum,  (Gini 1912; Wooster et al. 2005
//      Gini concentration, top-1% energy share         for FRP fire-intensity classes)
//  11. Moran's I spatial autocorrelation + LISA       (Moran 1950; Anselin 1995)
//      quadrant classification + Moran scatter plot
import type { UnifiedRow, Climatology, FirePoint } from './types';

export const MONTHS_SCI = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a: number[]): number { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); }
function quantile(a: number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function median(a: number[]): number { return quantile(a, 0.5); }

// Abramowitz & Stegun 7.1.26 error function → normal CDF for the MK p-value
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// ---------- 1. Mann-Kendall trend test + Sen's slope ----------
export type MKResult = {
  n: number; s: number; varS: number; z: number; p: number;
  senSlope: number; senIntercept: number;
  direction: 'increasing' | 'decreasing' | 'no trend';
  significant: boolean; // at α = 0.05 (two-sided)
};

export function mannKendall(y: number[]): MKResult {
  const n = y.length;
  const empty: MKResult = { n, s: 0, varS: 0, z: 0, p: 1, senSlope: 0, senIntercept: mean(y), direction: 'no trend', significant: false };
  if (n < 4) return empty;
  let s = 0;
  for (let k = 0; k < n - 1; k++) for (let j = k + 1; j < n; j++) s += Math.sign(y[j] - y[k]);
  // tie correction (presence of ties reduces Var(S))
  const ties = new Map<number, number>();
  for (const v of y) ties.set(v, (ties.get(v) || 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (varS <= 0) return empty;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  // Sen's slope: median of all pairwise slopes
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((y[j] - y[i]) / (j - i));
  const senSlope = median(slopes);
  const senIntercept = median(y.map((v, i) => v - senSlope * i));
  const significant = p < 0.05;
  const direction: MKResult['direction'] = senSlope > 0 && significant ? 'increasing' : senSlope < 0 && significant ? 'decreasing' : 'no trend';
  return { n, s, varS, z: +z.toFixed(2), p: +p.toFixed(4), senSlope: +senSlope.toFixed(1), senIntercept: +senIntercept.toFixed(1), direction, significant };
}

// ---------- 2. ACF with 95% white-noise confidence band ----------
export type AcfPoint = { lag: number; rho: number };
export function acf(x: number[], maxLag = 18): { points: AcfPoint[]; ci: number; lag1: number } {
  const n = x.length;
  if (n < 8) return { points: [], ci: 0, lag1: 0 };
  const m = mean(x);
  const d = x.map((v) => v - m);
  const c0 = d.reduce((s, v) => s + v * v, 0) / n;
  const ci = 1.96 / Math.sqrt(n);
  const points: AcfPoint[] = [];
  for (let k = 1; k <= Math.min(maxLag, n - 2); k++) {
    let ck = 0;
    for (let i = 0; i < n - k; i++) ck += d[i] * d[i + k];
    ck /= n;
    points.push({ lag: k, rho: c0 > 0 ? +(ck / c0).toFixed(3) : 0 });
  }
  return { points, ci: +ci.toFixed(3), lag1: points[0]?.rho ?? 0 };
}

// ---------- 3. Hurst exponent via rescaled range (R/S) ----------
export function hurstExponent(x: number[]): number | null {
  const n = x.length;
  if (n < 32) return null;
  const sizes: number[] = [];
  const rsVals: number[] = [];
  for (let m = 8; m <= Math.floor(n / 2); m = Math.max(m + 1, Math.round(m * 1.4))) {
    const chunks = Math.floor(n / m);
    if (chunks < 2) break;
    let acc = 0, cnt = 0;
    for (let c = 0; c < chunks; c++) {
      const seg = x.slice(c * m, (c + 1) * m);
      const mu = mean(seg);
      let cum = 0, min = Infinity, max = -Infinity;
      for (const v of seg) { cum += v - mu; if (cum < min) min = cum; if (cum > max) max = cum; }
      const sd = std(seg);
      if (sd <= 1e-9) continue;
      acc += (max - min) / sd; cnt++;
    }
    if (cnt >= 2) { sizes.push(Math.log(m)); rsVals.push(Math.log(acc / cnt)); }
  }
  if (sizes.length < 4) return null;
  // OLS fit of log(R/S) vs log(m); slope = H
  const mx = mean(sizes), my = mean(rsVals);
  let num = 0, den = 0;
  for (let i = 0; i < sizes.length; i++) { num += (sizes[i] - mx) * (rsVals[i] - my); den += (sizes[i] - mx) ** 2; }
  return den > 0 ? +(num / den).toFixed(3) : null;
}

// ---------- 4. DFT periodogram (deseasonalized input recommended) ----------
export type SpectrumBin = { period: number; share: number };
export function periodogram(x: number[], maxPeriod = 120): { bins: SpectrumBin[]; top: SpectrumBin[] } {
  const n = x.length;
  if (n < 24) return { bins: [], top: [] };
  const m = mean(x);
  const d = x.map((v) => v - m);
  const maxK = Math.floor(n / 2);
  const raw: { k: number; p: number }[] = [];
  for (let k = 1; k <= maxK; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * k * i) / n;
      re += d[i] * Math.cos(ang);
      im -= d[i] * Math.sin(ang);
    }
    raw.push({ k, p: (re * re + im * im) / n });
  }
  const tot = raw.reduce((s, v) => s + v.p, 0) || 1;
  const bins: SpectrumBin[] = raw
    .map((v) => ({ period: +(n / v.k).toFixed(1), share: +(v.p / tot).toFixed(4) }))
    .filter((b) => b.period <= maxPeriod);
  // top local maxima (period window de-duplicated to ±3 months)
  const ranked = [...bins].sort((a, b) => b.share - a.share);
  const top: SpectrumBin[] = [];
  for (const b of ranked) {
    if (top.length >= 3) break;
    if (top.every((t) => Math.abs(t.period - b.period) > 3)) top.push(b);
  }
  return { bins, top };
}

// monthly climatology of the unified series → used to deseasonalize
export function deseasonalize(rows: UnifiedRow[]): number[] {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of rows) byMonth[Number(r.ym.slice(5, 7)) - 1].push(r.count);
  const clim = byMonth.map((a) => (a.length ? mean(a) : 0));
  return rows.map((r) => r.count - clim[Number(r.ym.slice(5, 7)) - 1]);
}

// ---------- 5. empirical return periods + Gumbel space fit ----------
export type ReturnRow = { year: number; total: number; T: number };
export type Extremes = {
  rows: ReturnRow[];
  gumbelFit: { a: number; b: number } | null; // total = a·y + b, y = −ln(−ln(1−1/T))
  level10: number | null; level25: number | null; level50: number | null;
  record: ReturnRow | null;
};
export function returnPeriods(annual: { y: number; total: number }[]): Extremes {
  const rows: ReturnRow[] = [...annual]
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ year: r.y, total: r.total, T: (annual.length + 1) / (i + 1) })); // full precision — rounding to 1 dp collapses T=1.04→1 → log(0)=−∞
  const record = rows[0] ?? null;
  // Gumbel reduced variate + OLS fit
  const ys = rows.map((r) => -Math.log(-Math.log(1 - 1 / r.T)));
  const mx = mean(ys), my = mean(rows.map((r) => r.total));
  let num = 0, den = 0;
  for (let i = 0; i < rows.length; i++) { num += (ys[i] - mx) * (rows[i].total - my); den += (ys[i] - mx) ** 2; }
  if (den <= 0 || rows.length < 5) return { rows, gumbelFit: null, level10: null, level25: null, level50: null, record };
  const a = num / den, b = my - a * mx;
  const at = (T: number) => Math.round(a * -Math.log(-Math.log(1 - 1 / T)) + b);
  return { rows, gumbelFit: { a: +a.toFixed(1), b: +b.toFixed(1) }, level10: at(10), level25: at(25), level50: at(50), record };
}

// ---------- 6. peaks-over-threshold anomaly register ----------
export type PotEvent = { ym: string; count: number; z: number };
export function peaksOverThreshold(rows: UnifiedRow[], clim: Climatology, zMin = 1.5): PotEvent[] {
  const out: PotEvent[] = [];
  for (const r of rows) {
    const mi = Number(r.ym.slice(5, 7)) - 1;
    const sd = clim.std[mi] || Math.max(1, clim.mean[mi] * 0.3);
    const z = (r.count - clim.mean[mi]) / sd;
    if (z >= zMin) out.push({ ym: r.ym, count: r.count, z: +z.toFixed(2) });
  }
  return out.sort((a, b) => b.z - a.z).slice(0, 10);
}

// ---------- 7. cross-sensor agreement ----------
export type Agreement = {
  n: number; pearson: number; spearman: number;
  ratioGeo: number; ratioLo: number; ratioHi: number; // ratio Bland-Altman
  biasPct: number;
};
export function sensorAgreement(modis: number[], viirs: number[]): Agreement | null {
  const pairs = modis.map((m, i) => [m, viirs[i]] as const).filter(([m, v]) => m > 0 && v > 0);
  const n = pairs.length;
  if (n < 6) return null;
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  // Pearson
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  const pearson = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
  // Spearman (average ranks for ties)
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mrx = mean(rx), mry = mean(ry);
  let scov = 0, svx = 0, svy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mrx, dy = ry[i] - mry; scov += dx * dy; svx += dx * dx; svy += dy * dy; }
  const spearman = svx > 0 && svy > 0 ? scov / Math.sqrt(svx * svy) : 0;
  // ratio Bland-Altman on log10 differences (handles proportional error in counts)
  const dlog = pairs.map(([m, v]) => Math.log10(v / m));
  const bias = mean(dlog), sd = std(dlog);
  return {
    n, pearson: +pearson.toFixed(3), spearman: +spearman.toFixed(3),
    ratioGeo: +(10 ** bias).toFixed(2),
    ratioLo: +(10 ** (bias - 1.96 * sd)).toFixed(2),
    ratioHi: +(10 ** (bias + 1.96 * sd)).toFixed(2),
    biasPct: +(((10 ** bias) - 1) * 100).toFixed(1),
  };
}

// ---------- 8. fire-season phenology ----------
export type SeasonYear = { year: number; onset: number; offset: number; duration: number; peak: number; total: number };
export type Phenology = {
  years: SeasonYear[];
  onsetShiftMonthsPerDecade: number | null;
  meanDuration: number | null;
  verdict: string;
};
export function phenology(rows: UnifiedRow[], frac = 0.4): Phenology {
  const byYear = new Map<number, { counts: number[]; months: number[]; total: number }>();
  for (const r of rows) {
    const y = Number(r.ym.slice(0, 4));
    const e = byYear.get(y) ?? { counts: Array<number>(12).fill(0), months: [] as number[], total: 0 };
    const mi = Number(r.ym.slice(5, 7)) - 1;
    e.counts[mi] = r.count; e.months.push(mi); e.total += r.count;
    byYear.set(y, e);
  }
  const years: SeasonYear[] = [];
  for (const [year, e] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    if (e.months.length < 9 || e.total <= 0) continue; // need a mostly-complete year
    const peak = Math.max(...e.counts);
    if (peak <= 0) continue;
    const thr = frac * peak;
    let onset = -1, offset = -1, peakMonth = 0;
    e.counts.forEach((c, mi) => { if (c >= thr) { if (onset < 0) onset = mi; offset = mi; } if (c === peak) peakMonth = mi; });
    if (onset < 0) continue;
    years.push({ year, onset, offset, duration: offset - onset + 1, peak: peakMonth, total: e.total });
  }
  // onset trend (linear slope on month index vs year, robust enough for the display)
  let onsetShift: number | null = null;
  if (years.length >= 6) {
    const ys = years.map((y) => y.year), os = years.map((y) => y.onset);
    const mx = mean(ys), my = mean(os);
    let num = 0, den = 0;
    for (let i = 0; i < ys.length; i++) { num += (ys[i] - mx) * (os[i] - my); den += (ys[i] - mx) ** 2; }
    if (den > 0) onsetShift = +(num / den).toFixed(2); // months per year
  }
  const meanDuration = years.length ? Math.round(mean(years.map((y) => y.duration))) : null;
  let verdict: string;
  if (onsetShift === null) verdict = 'Not enough complete years to estimate a season-timing shift.';
  else if (Math.abs(onsetShift) < 0.05) verdict = 'Season onset is stationary across the record.';
  else if (onsetShift < 0) verdict = `Onset is drifting earlier ≈ ${Math.abs(onsetShift * 120).toFixed(0)} days per decade — a longer fire window (warming/drying signature).`;
  else verdict = `Onset is drifting later ≈ ${(onsetShift * 120).toFixed(0)} days per decade — the active window is compressing or shifting.`;
  return { years, onsetShiftMonthsPerDecade: onsetShift === null ? null : +(onsetShift * 10).toFixed(2), meanDuration, verdict };
}

// ---------- 9. season-adjusted momentum ----------
export type Momentum = {
  series: { ym: string; roc: number }[];
  last3: number;
  volatility: number;
  verdict: 'accelerating' | 'decelerating' | 'steady';
};
export function momentum(rows: UnifiedRow[], clim: Climatology): Momentum {
  const adj = rows.map((r) => {
    const mi = Number(r.ym.slice(5, 7)) - 1;
    return r.count / Math.max(1, clim.mean[mi]); // season-normalized activity
  });
  const roc: { ym: string; roc: number }[] = [];
  for (let i = 1; i < adj.length; i++) {
    roc.push({ ym: rows[i].ym, roc: +(((adj[i] - adj[i - 1]) / Math.max(0.05, adj[i - 1])) * 100).toFixed(1) });
  }
  const last3 = roc.length ? +mean(roc.slice(-3).map((r) => r.roc)).toFixed(1) : 0;
  const volatility = roc.length ? +std(roc.map((r) => r.roc)).toFixed(1) : 0;
  const verdict: Momentum['verdict'] = last3 > 10 ? 'accelerating' : last3 < -10 ? 'decelerating' : 'steady';
  return { series: roc, last3, volatility, verdict };
}

// ---------- 10. FRP intensity economics ----------
export const FRP_BINS: { label: string; lo: number; hi: number }[] = [
  { label: '0–1', lo: 0, hi: 1 }, { label: '1–3', lo: 1, hi: 3 }, { label: '3–5', lo: 3, hi: 5 },
  { label: '5–10', lo: 5, hi: 10 }, { label: '10–20', lo: 10, hi: 20 }, { label: '20–50', lo: 20, hi: 50 },
  { label: '50–100', lo: 50, hi: 100 }, { label: '100–300', lo: 100, hi: 300 },
  { label: '300–1k', lo: 300, hi: 1000 }, { label: '>1k', lo: 1000, hi: Infinity },
];
export type FrpStats = {
  n: number; mean: number; p50: number; p90: number; p99: number; max: number;
  bins: { label: string; count: number; energyShare: number }[];
  gini: number; top1Share: number;
  classes: { label: string; pct: number; color: string }[];
};
export function frpStats(points: FirePoint[]): FrpStats | null {
  const xs = points.map((p) => p.frp || 0).filter((v) => v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 5) return null;
  const totalE = xs.reduce((s, v) => s + v, 0);
  const bins = FRP_BINS.map((b) => {
    const inside = xs.filter((v) => v >= b.lo && v < b.hi);
    return { label: b.label, count: inside.length, energyShare: totalE > 0 ? +(inside.reduce((s, v) => s + v, 0) / totalE).toFixed(3) : 0 };
  });
  // Gini coefficient of the FRP distribution (mean-abs-difference form)
  let gsum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) gsum += Math.abs(xs[i] - xs[j]);
  const gini = totalE > 0 ? +((gsum / (2 * n * n * (totalE / n))) ).toFixed(3) : 0;
  const topK = Math.max(1, Math.round(n * 0.01));
  const top1Share = +([...xs].slice(-topK).reduce((s, v) => s + v, 0) / totalE).toFixed(3);
  const cls = [
    { label: 'Smouldering <10 MW', hi: 10, color: '#FBBF24' },
    { label: 'Moderate 10–50 MW', hi: 50, color: '#F97316' },
    { label: 'Vigorous 50–200 MW', hi: 200, color: '#EF4444' },
    { label: 'Extreme ≥200 MW', hi: Infinity, color: '#F472B6' },
  ].map((c, i, arr) => ({
    label: c.label, color: c.color,
    pct: Math.round((xs.filter((v) => v < c.hi && v >= (i === 0 ? 0 : arr[i - 1].hi)).length / n) * 100),
  }));
  return {
    n, mean: Math.round(mean(xs)), p50: Math.round(quantile(xs, 0.5)), p90: Math.round(quantile(xs, 0.9)),
    p99: Math.round(quantile(xs, 0.99)), max: Math.round(xs[n - 1]),
    bins, gini, top1Share, classes: cls,
  };
}

// ---------- 11. Moran's I + LISA quadrants ----------
export type LisaQuad = 'HH' | 'LL' | 'HL' | 'LH' | 'NS';
export type MoranResult = {
  n: number; cells: number; binDeg: number;
  i: number; expected: number; zScore: number; p: number;
  lisa: { HH: number; LL: number; HL: number; LH: number; NS: number };
};
export function moransI(points: { lon: number; lat: number }[], bbox: number[], perms = 499): MoranResult | null {
  if (points.length < 30) return null;
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const bin = Math.min(2, Math.max(0.25, +(span / 24).toFixed(2)));
  const grid = new Map<string, number>();
  for (const p of points) {
    const k = `${Math.floor(p.lon / bin)},${Math.floor(p.lat / bin)}`;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  const keys = [...grid.keys()];
  const cells = keys.length;
  if (cells < 8) return null;
  const vals = keys.map((k) => grid.get(k) || 0);
  const m = mean(vals), sdv = std(vals) || 1;
  const z = vals.map((v) => (v - m) / sdv);
  // queen contiguity (8-neighbour on the regular grid)
  const nbrs: number[][] = keys.map((k) => {
    const [gx, gy] = k.split(',').map(Number);
    const out: number[] = [];
    keys.forEach((k2, j) => {
      const [qx, qy] = k2.split(',').map(Number);
      if (Math.abs(gx - qx) <= 1 && Math.abs(gy - qy) <= 1 && !(gx === qx && gy === qy)) out.push(j);
    });
    return out;
  });
  const s0 = nbrs.reduce((s, list) => s + list.length, 0);
  if (s0 === 0) return null;
  const moranOf = (zz: number[]): number => {
    let num = 0;
    for (let i = 0; i < cells; i++) for (const j of nbrs[i]) num += zz[i] * zz[j];
    return ((cells / s0) * num) / zz.reduce((s, v) => s + v * v, 0);
  };
  const iObs = moranOf(z);
  // permutation inference: empirical z from the null distribution (robust for small grids)
  let exceed = 0;
  const perm = [...z];
  const permIs: number[] = [];
  for (let it = 0; it < perms; it++) {
    for (let i = cells - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const ip = moranOf(perm);
    permIs.push(ip);
    if (Math.abs(ip) >= Math.abs(iObs)) exceed++;
  }
  const p = +((exceed + 1) / (perms + 1)).toFixed(3);
  // LISA quadrants (Anselin 1995): significant cells where |z| and |lag| both > 1
  const lisa = { HH: 0, LL: 0, HL: 0, LH: 0, NS: 0 };
  for (let i = 0; i < cells; i++) {
    if (!nbrs[i].length) { lisa.NS++; continue; }
    const lag = nbrs[i].reduce((s, j) => s + z[j], 0) / nbrs[i].length;
    if (Math.abs(z[i]) > 1 && Math.abs(lag) > 1) {
      if (z[i] > 0 && lag > 0) lisa.HH++;
      else if (z[i] < 0 && lag < 0) lisa.LL++;
      else if (z[i] > 0) lisa.HL++;
      else lisa.LH++;
    } else lisa.NS++;
  }
  // expected value under randomization: E[I] = −1/(n−1); z from the permutation null
  const expected = -1 / (cells - 1);
  const pm = mean(permIs);
  const psd = std(permIs);
  const zScore = psd > 1e-9 ? +((iObs - pm) / psd).toFixed(2) : 0;
  return { n: points.length, cells, binDeg: bin, i: +iObs.toFixed(3), expected: +expected.toFixed(3), zScore, p, lisa };
}

// Moran scatter-plot points: (spatial lag, z)
export function moranScatter(points: { lon: number; lat: number }[], bbox: number[]): { lag: number; z: number }[] {
  if (points.length < 30) return [];
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const bin = Math.min(2, Math.max(0.25, +(span / 24).toFixed(2)));
  const grid = new Map<string, number>();
  for (const p of points) {
    const k = `${Math.floor(p.lon / bin)},${Math.floor(p.lat / bin)}`;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  const keys = [...grid.keys()];
  const vals = keys.map((k) => grid.get(k) || 0);
  const m = mean(vals), sdv = std(vals) || 1;
  const z = vals.map((v) => (v - m) / sdv);
  const out: { lag: number; z: number }[] = [];
  keys.forEach((k, i) => {
    const [gx, gy] = k.split(',').map(Number);
    let s = 0, c = 0;
    keys.forEach((k2, j) => {
      const [qx, qy] = k2.split(',').map(Number);
      if (Math.abs(gx - qx) <= 1 && Math.abs(gy - qy) <= 1 && !(gx === qx && gy === qy)) { s += z[j]; c++; }
    });
    out.push({ lag: c ? +(s / c).toFixed(2) : 0, z: +z[i].toFixed(2) });
  });
  return out;
}
