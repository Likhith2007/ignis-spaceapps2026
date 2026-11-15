// Numerical verification of the IGNIS science engine — synthetic ground-truth tests
import { mannKendall, acf, hurstExponent, periodogram, deseasonalize, returnPeriods, peaksOverThreshold, sensorAgreement, phenology, momentum, frpStats, moransI } from '../../src/lib/ignis/science';
import type { UnifiedRow, Climatology, FirePoint } from '../../src/lib/ignis/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

console.log('— 1. Mann-Kendall —');
const inc = Array.from({ length: 24 }, (_, i) => 100 + i * 10 + Math.round(Math.sin(i) * 5));
const mkInc = mannKendall(inc);
check('strictly increasing → significant increase', mkInc.direction === 'increasing' && mkInc.significant, `Z=${mkInc.z} p=${mkInc.p} slope=${mkInc.senSlope}`);
const rnd = (() => { const r = mulberry32(42); return Array.from({ length: 24 }, () => Math.round(r() * 1000)); })();
const mkRnd = mannKendall(rnd);
check('pure noise → not significant', !mkRnd.significant, `Z=${mkRnd.z} p=${mkRnd.p}`);
const dec1 = Array.from({ length: 24 }, (_, i) => 500 - i * 12);
const mkDec = mannKendall(dec1);
check('strictly decreasing → significant decrease', mkDec.direction === 'decreasing' && mkDec.significant, `slope=${mkDec.senSlope}`);

console.log('— 2. ACF —');
const wn = (() => { const r = mulberry32(7); return Array.from({ length: 120 }, () => r()); })();
const acWn = acf(wn, 12);
check('white noise: lag-1 inside CI', Math.abs(acWn.lag1) <= acWn.ci, `ρ1=${acWn.lag1} CI=±${acWn.ci}`);
const ar = (() => { const r = mulberry32(11); const x = [0.5]; for (let i = 1; i < 200; i++) x.push(0.8 * x[i - 1] + 0.2 * r()); return x; })();
const acAr = acf(ar, 6);
check('AR(1) φ=0.8: strong positive lag-1', acAr.lag1 > 0.6, `ρ1=${acAr.lag1}`);
check('AR(1): lag-1 exceeds noise band', acAr.lag1 > acAr.ci);

console.log('— 3. Hurst —');
const hWn = hurstExponent(wn);
check('white-noise H ≈ 0.5 (0.35–0.65)', hWn !== null && hWn > 0.35 && hWn < 0.65, `H=${hWn}`);
const trended = Array.from({ length: 200 }, (_, i) => i * 0.5 + 5 * Math.sin(i / 3));
const hT = hurstExponent(trended);
check('trending series H > 0.6 (persistent)', hT !== null && hT > 0.6, `H=${hT}`);

console.log('— 4. Periodogram —');
// build 240 months with a pure 24-month cycle + annual cycle, then deseasonalize
const rows240: UnifiedRow[] = Array.from({ length: 240 }, (_, i) => {
  const y = 2006 + Math.floor(i / 12), m = (i % 12) + 1;
  const c = Math.round(1000 * Math.exp(-((m - 8) ** 2) / 8)) + Math.round(600 * Math.sin((2 * Math.PI * i) / 24) + 700);
  return { ym: `${y}-${String(m).padStart(2, '0')}`, count: Math.max(0, c), frp: 0, scaled: false };
});
const des = deseasonalize(rows240);
const spec = periodogram(des, 120);
check('deseasonalized: top peak ≈ 24 mo (planted cycle)', spec.top.length > 0 && Math.abs(spec.top[0].period - 24) < 3, `top=${spec.top[0]?.period}mo share=${spec.top[0]?.share}`);
check('annual cycle removed (no 12-mo peak in top)', !spec.top.some((t) => Math.abs(t.period - 12) < 1.5));

console.log('— 5. Return periods —');
const ann = Array.from({ length: 20 }, (_, i) => ({ y: 2006 + i, total: Math.round(5000 + 3000 * (mulberry32(i + 3)()) ) }));
const ext = returnPeriods(ann);
check('return rows: record year carries longest T', ext.rows[0].T >= ext.rows[1].T && ext.rows[0].total >= ext.rows[1].total, `T0=${ext.rows[0].T} T1=${ext.rows[1].T}`);
check('level25 ≥ level10 ≥ 0', (ext.level25 ?? 0) >= (ext.level10 ?? 0), `10y=${ext.level10} 25y=${ext.level25}`);
check('record = highest year', ext.record?.total === Math.max(...ann.map((a) => a.total)), `record=${ext.record?.year}`);

console.log('— 6. POT —');
const climFake: Climatology = { mean: Array(12).fill(100), median: Array(12).fill(100), std: Array(12).fill(20), peakMonth: 7, peakWindow: [6, 7, 8] };
const potRows: UnifiedRow[] = [
  { ym: '2024-08', count: 250, frp: 0, scaled: false }, { ym: '2024-02', count: 180, frp: 0, scaled: false },
  { ym: '2024-01', count: 90, frp: 0, scaled: false },
];
const pot = peaksOverThreshold(potRows, climFake, 1.5);
check('POT captures z≥1.5 months only', pot.length === 2 && pot[0].ym === '2024-08', `got ${pot.map((p) => p.ym + ' z' + p.z).join(',')}`);

console.log('— 7. Sensor agreement —');
const mS = [100, 200, 300, 400, 500, 600, 700, 800];
const vS = mS.map((v) => v * 3 + (v % 7)); // exact 3× proportional + tiny noise
const ag = sensorAgreement(mS, vS);
check('proportional ×3 recovered as ratioGeo≈3', ag !== null && Math.abs(ag.ratioGeo - 3) < 0.05, `ratio=${ag?.ratioGeo}`);
check('perfect proportional → Pearson ≈ 1', ag !== null && ag.pearson > 0.99, `r=${ag?.pearson}`);

console.log('— 8. Phenology —');
const phenRows: UnifiedRow[] = [];
for (let y = 2015; y <= 2024; y++) {
  for (let m = 1; m <= 12; m++) {
    const c = Math.round(1000 * Math.exp(-((m - 7.5) ** 2) / 6));
    phenRows.push({ ym: `${y}-${String(m).padStart(2, '0')}`, count: c, frp: 0, scaled: false });
  }
}
const ph = phenology(phenRows);
check('10 complete seasons detected', ph.years.length === 10, `got ${ph.years.length}`);
check('onset ≈ May–Jun for July-peak synthetic', ph.years.every((s) => s.onset >= 3 && s.onset <= 6), `onsets=${ph.years.map((s) => s.onset).join(',')}`);
check('duration ≈ 6±3 months', ph.years.every((s) => s.duration >= 3 && s.duration <= 9), `durations=${ph.years.map((s) => s.duration).join(',')}`);

console.log('— 9. Momentum —');
const momRows: UnifiedRow[] = Array.from({ length: 30 }, (_, i) => ({ ym: `2022-${String((i % 12) + 1).padStart(2, '0')}`, count: 100 + (i < 15 ? i * 20 : (29 - i) * 20), frp: 0, scaled: false }));
const momC: Climatology = { ...climFake, mean: Array(12).fill(100) };
const mom = momentum(momRows, momC);
check('momentum series non-empty with bounded ROC', mom.series.length === 29 && mom.series.every((s) => Number.isFinite(s.roc)));
check('verdict ∈ {accelerating, decelerating, steady}', ['accelerating', 'decelerating', 'steady'].includes(mom.verdict), `last3=${mom.last3}`);

console.log('— 10. FRP stats —');
const ptsFrp: FirePoint[] = [];
for (let i = 0; i < 500; i++) ptsFrp.push({ lat: 0, lon: 0, frp: 2 + Math.exp(mulberry32(i + 9)() * 5), conf: 80, night: false });
const fs = frpStats(ptsFrp);
check('frpStats: n=500, percentiles ordered', fs !== null && fs.p50 <= fs.p90 && fs.p90 <= fs.p99 && fs.p99 <= fs.max, `p50=${fs?.p50} p90=${fs?.p90} p99=${fs?.p99} max=${fs?.max}`);
check('Gini in (0,1), top1% share in (0.01,1)', fs !== null && fs.gini > 0 && fs.gini < 1 && fs.top1Share > 0.01 && fs.top1Share <= 1, `G=${fs?.gini} top1=${fs?.top1Share}`);
check('bins sum to n', fs !== null && fs.bins.reduce((s, b) => s + b.count, 0) === 500);

console.log('— 11. Moran&apos;s I —');
// clustered: smooth 2-D Gaussian density gradient over the bbox → neighbors share similar counts
const clustered: { lon: number; lat: number }[] = [];
{
  const r = mulberry32(21);
  const cx = -66, cy = -7;
  while (clustered.length < 3000) {
    const lon = -75 + r() * 17, lat = -12 + r() * 10;
    const d2 = ((lon - cx) / 3.2) ** 2 + ((lat - cy) / 2.2) ** 2;
    if (r() < Math.exp(-d2)) clustered.push({ lon, lat });
  }
}
const miC = moransI(clustered, [-75, -12, -58, -2], 199);
check('gradient density → I significantly > 0', miC !== null && miC.i > 0.2 && miC.p < 0.05, `I=${miC?.i} z=${miC?.zScore} p=${miC?.p}`);
check('LISA: HH cells found', miC !== null && miC.lisa.HH > 0, `HH=${miC?.lisa.HH}`);
// checkerboard: alternating high/low cells → strong NEGATIVE autocorrelation
const checker: { lon: number; lat: number }[] = [];
for (let gx = 0; gx < 12; gx++) for (let gy = 0; gy < 10; gy++) {
  const n = (gx + gy) % 2 === 0 ? 120 : 4;
  for (let k = 0; k < n; k++) checker.push({ lon: -70 + gx * 0.5 + mulberry32(gx * 100 + gy * 7 + k)() * 0.45, lat: -10 + gy * 0.5 + mulberry32(gx * 13 + gy * 97 + k + 55)() * 0.45 });
}
const miX = moransI(checker, [-71, -11, -64, -4], 199);
check('checkerboard → negative I, significant', miX !== null && miX.i < 0 && miX.p < 0.05, `I=${miX?.i} z=${miX?.zScore} p=${miX?.p}`);
const dispersed: { lon: number; lat: number }[] = Array.from({ length: 400 }, (_, i) => ({ lon: -70 + (i % 20) * 0.35 + 0.1, lat: -10 + Math.floor(i / 20) * 0.35 + 0.1 }));
const miD = moransI(dispersed, [-72, -12, -62, -2], 199);
check('uniform lattice → near-zero I', miD !== null && Math.abs(miD.i) < 0.4, `I=${miD?.i} p=${miD?.p}`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
