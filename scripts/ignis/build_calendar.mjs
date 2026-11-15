// IGNIS — 26-year harmonized MODIS+VIIRS fire activity calendar precompute (preset regions)
//
// Thin CLI around src/lib/ignis/calendarBuilder.ts — the SAME builder the app uses for
// on-demand custom-AOI calendars, so precomputed and custom calendars are identical in method.
// Requires Node ≥ 22.18 (or ≥ 23.6) so the .ts module loads via native type stripping.
//
// Usage (from the repo root or anywhere):
//   node scripts/ignis/build_calendar.mjs                       # all regions, 2 sampled days/month
//   node scripts/ignis/build_calendar.mjs amazon canada         # selected regions
//   node scripts/ignis/build_calendar.mjs --samples=6           # denser sampling
//   node scripts/ignis/build_calendar.mjs --full                # EVERY day → exact monthly counts (slow)
//   node scripts/ignis/build_calendar.mjs --sensors=MODIS-Terra,VIIRS-SNPP
//   node scripts/ignis/build_calendar.mjs --out=./data/ignis --concurrency=32
//
// Data source: NASA GIBS WMTS vector tiles (FIRMS-derived thermal anomalies)
//   MODIS Terra  2000-11 →   MODIS Aqua  2002-07 →
//   VIIRS S-NPP  2012-01 →   VIIRS NOAA-20 2020-01 →   VIIRS NOAA-21 2024-01 →
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCalendar, CALENDAR_SENSORS } from '../../src/lib/ignis/calendarBuilder.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const REGIONS = {
  india:         { name: 'India',               bbox: [68, 6.5, 97.5, 35.7], note: 'Crop-residue burning (wheat Apr-May, paddy Oct-Nov) + dry-season forest fires (Feb-May)' },
  amazon:        { name: 'Amazon Basin',        bbox: [-74, -12, -46, 2],  note: 'Deforestation & drought-driven fire regime' },
  california:    { name: 'California / US West', bbox: [-125, 32, -114, 42], note: 'Mediterranean chaparral + forest fire regime' },
  canada:        { name: 'Boreal Canada',        bbox: [-140, 52, -95, 70],  note: 'Record 2023 fire season (23+ Mha burned)' },
  siberia:       { name: 'Eastern Siberia',      bbox: [100, 50, 145, 70],   note: 'Boreal + permafrost peat fires (Yakutia)' },
  congo:         { name: 'Congo Basin',          bbox: [8, -8, 32, 8],       note: 'Tropical evergreen + savanna boundary' },
  borneo:        { name: 'Borneo & Sumatra',     bbox: [95, -6, 120, 6],     note: 'El Niño peat-land megafires (2015, 2019, 2023)' },
  australia:     { name: 'Australia',            bbox: [112, -42, 154, -10], note: 'Black Summer 2019-20 (24+ Mha burned)' },
  mediterranean: { name: 'Mediterranean Basin',  bbox: [-8, 30, 32, 46],     note: 'European heatwave-driven fires (2021-2025)' },
  bangladesh:    { name: 'Bangladesh',           bbox: [88.0, 20.6, 92.9, 26.7], note: 'Crop-residue (Boro Mar-Apr, Aman Nov) + Sundarbans mangrove fires' },
};

function parseArgs(argv) {
  const opts = { regions: [], samples: 2, sensors: undefined, out: path.join(ROOT, 'data', 'ignis'), concurrency: 48, merge: false };
  for (const a of argv) {
    if (a === '--full') opts.samples = 'all';
    else if (a === '--merge') opts.merge = true; // keep sensors already in the output file that this run does not rebuild
    else if (a.startsWith('--samples=')) opts.samples = Math.max(1, parseInt(a.slice(10), 10) || 2);
    else if (a.startsWith('--sensors=')) opts.sensors = a.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.slice(6));
    else if (a.startsWith('--concurrency=')) opts.concurrency = Math.max(1, parseInt(a.slice(14), 10) || 48);
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else opts.regions.push(a);
  }
  if (!opts.regions.length) opts.regions = Object.keys(REGIONS);
  const unknown = opts.regions.filter((r) => !REGIONS[r]);
  if (unknown.length) throw new Error(`unknown region(s): ${unknown.join(', ')} — valid: ${Object.keys(REGIONS).join(', ')}`);
  const validSensors = CALENDAR_SENSORS.map((s) => s.key);
  const badSensors = (opts.sensors ?? []).filter((s) => !validSensors.includes(s));
  if (badSensors.length) throw new Error(`unknown sensor(s): ${badSensors.join(', ')} — valid: ${validSensors.join(', ')}`);
  return opts;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });
  console.log(`IGNIS calendar build → ${opts.out} · samples=${opts.samples} · sensors=${(opts.sensors ?? 'all')}`);
  for (const k of opts.regions) {
    const t0 = Date.now();
    const r = REGIONS[k];
    let lastSensor = '';
    const outFile = path.join(opts.out, `calendar_${k}.json`);
    // Checkpoint: each finished sensor is saved to <file>.partial, so an interrupted or failed
    // run resumes with the sensors it still needs instead of starting the region again.
    const partFile = `${outFile}.partial`;
    const done = fs.existsSync(partFile) ? JSON.parse(fs.readFileSync(partFile, 'utf8')) : {};
    const requested = opts.sensors ?? CALENDAR_SENSORS.map((x) => x.key);
    const want = requested.filter((x) => !done[x]);
    if (Object.keys(done).length) console.log(`[${k}] resuming — already have ${Object.keys(done).join(', ')}`);
    const doc = await buildCalendar({
      key: k, name: r.name, note: r.note, bbox: r.bbox,
      sensors: want, samples: opts.samples, concurrency: opts.concurrency,
      onRetry: (sensor, failed, pauseMs) => console.log(`\n[${k}] ${sensor}: ${failed} downloads failed, retrying in ${pauseMs / 1000}s`),
      onSensor: (sensor, entry) => {
        done[sensor] = entry;
        fs.writeFileSync(partFile, JSON.stringify(done));
        console.log(`\n[${k}] ${sensor}: ${entry.monthly.length} months, total est=${entry.monthly.reduce((x, y) => x + y.est, 0)} (checkpoint saved)`);
      },
      onMonth: (sensor) => {
        if (sensor !== lastSensor) { process.stdout.write(`\n[${k}] ${sensor} `); lastSensor = sensor; }
        process.stdout.write('.');
      },
    });
    doc.sensors = { ...done, ...doc.sensors };
    if (opts.merge && fs.existsSync(outFile)) {
      const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      doc.sensors = { ...prev.sensors, ...doc.sensors };
      console.log(`\n[${k}] merged with existing file — sensors now: ${Object.keys(doc.sensors).join(', ')}`);
    }
    // raw overlap diagnostic on the final set of sensors
    const mod = doc.sensors['MODIS-Terra']?.monthly ?? [];
    const snp = new Map((doc.sensors['VIIRS-SNPP']?.monthly ?? []).map((x) => [x.ym, x]));
    const overlap = mod.filter((x) => { const v = snp.get(x.ym); return v && x.sampled > 0 && v.sampled > 0; })
      .map((x) => ({ ym: x.ym, ratio: +(snp.get(x.ym).sampled / x.sampled).toFixed(3), m: x.sampled, s: snp.get(x.ym).sampled }));
    doc.harmonization = { overlapMonths: overlap.length, meanRatioSNPPtoMODIS: overlap.length ? +(overlap.reduce((x, y) => x + y.ratio, 0) / overlap.length).toFixed(3) : null, sample: overlap.slice(-6) };
    doc.meta.method = doc.meta.method.replace(/Sensors: .*$/, `Sensors: ${Object.keys(doc.sensors).join(', ')}.`);
    fs.writeFileSync(outFile, JSON.stringify(doc));
    fs.rmSync(partFile, { force: true });
    console.log(`[${k}] saved · raw meanRatio(SNPP/MODIS)=${doc.harmonization.meanRatioSNPPtoMODIS} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('ALL DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
