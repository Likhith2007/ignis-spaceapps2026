// IGNIS model twins — TypeScript inference for the NEW HF model family:
//   · Nabidnur/ignis-fire-type-model    (per-detection fire-TYPE, 5 classes)
//   · Nabidnur/ignis-fire-spread-model  (6-hour spread radius, km)
// Portable Extra-Trees exports (flat node arrays) — identical to the
// ignis-fire-classifier twin pattern. Client-safe: used BOTH server-side
// (/api/hotspots enrichment, /api/hotspot weather-aware re-scoring) and
// in the browser (instant popup chips). Zero network cost at inference.
//
// Carbon estimates use the documented IGNIS emissions chain (identical to the
// ignis-fire-calendar analysis dataset): FRE ≈ FRP × 1800 s (30-min persistence
// assumption for a NRT snapshot) → dry matter 0.223 kg/MJ → CO2e 1.61 kg/kg DM.
import typeW from './typeWeights.json';
import spreadW from './spreadWeights.json';

type Node = [number, number, number, number, number[]];
type ClsW = { classes: string[]; features: string[]; nTrees: number; nodes: Node[][]; skill?: Record<string, unknown>; version?: string };
type RegW = { target: string; features: string[]; nTrees: number; nodes: Node[][]; bands: Record<string, [number, number]>; skill?: { default_weather?: { wind_ms: number; rh_pct: number; temp_c: number } }; version?: string };

const TW = typeW as unknown as ClsW;
const SW = spreadW as unknown as RegW;

/** [featIdx (-1 = leaf), threshold, left, right, value(s)] */
function walkCls(nodes: Node[], x: number[]): number[] {
  let i = 0;
  for (;;) {
    const nd = nodes[i];
    if (nd[0] < 0) return nd[4];
    i = x[nd[0]] <= nd[1] ? nd[2] : nd[3];
  }
}
function walkReg(nodes: Node[], x: number[]): number {
  let i = 0;
  for (;;) {
    const nd = nodes[i];
    if (nd[0] < 0) return nd[4][0];
    i = x[nd[0]] <= nd[1] ? nd[2] : nd[3];
  }
}

// ------------------------------------------------------------- fire type ----
export type FireTypeMeta = { type: string; p: number };

/** Fire-type label + display metadata */
export const FIRE_TYPE_META: Record<string, { label: string; icon: string; fg: string; bg: string }> = {
  AGRICULTURAL: { label: 'Agricultural / managed burn', icon: '🌾', fg: '#FDE68A', bg: 'rgba(251,191,36,0.16)' },
  FOREST: { label: 'Forest wildfire', icon: '🌲', fg: '#FECACA', bg: 'rgba(185,28,28,0.30)' },
  GRASS_SAVANNA: { label: 'Grass / savanna burning', icon: '🌿', fg: '#BBF7D0', bg: 'rgba(74,222,128,0.14)' },
  URBAN_INTERFACE: { label: 'Urban / settlement fire', icon: '🏙', fg: '#E9D5FF', bg: 'rgba(168,85,247,0.18)' },
  INDUSTRIAL_FLARE: { label: 'Industrial gas flare', icon: '🏭', fg: '#BAE6FD', bg: 'rgba(56,189,248,0.16)' },
};

/** features: log_frp, conf, night, acq_hour, is_viirs, dens5, dens25, dens100, frp_ratio, abs_lat, month */
export function inferFireType(f: {
  frp: number; conf: number; night: boolean; acqHour?: number; isViirs: boolean;
  dens5?: number; dens25?: number; dens100?: number; frpRatio?: number; absLat: number; month: number;
}): FireTypeMeta {
  const x = [
    Math.log1p(f.frp || 0),
    f.conf ?? 60,
    f.night ? 1 : 0,
    f.acqHour ?? 12,
    f.isViirs ? 1 : 0,
    f.dens5 ?? 0, f.dens25 ?? 0, f.dens100 ?? 0,
    f.frpRatio ?? 1,
    Math.min(80, Math.abs(f.absLat)),
    f.month,
  ];
  const probs = new Array(TW.classes.length).fill(0);
  for (let t = 0; t < TW.nodes.length; t++) {
    const tp = walkCls(TW.nodes[t], x);
    for (let k = 0; k < probs.length; k++) probs[k] += tp[k] ?? 0;
  }
  let best = 0;
  for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
  return { type: TW.classes[best], p: Math.round((probs[best] / TW.nodes.length) * 100) };
}

// ------------------------------------------------------------ fire spread ----
export type SpreadMeta = { km6h: number; band: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'; fg: string };

/** features: log_frp, conf/100, night, dens25, wind_ms, rh_pct, temp_c, abs_lat */
export function inferSpread(f: {
  frp: number; conf: number; night: boolean; dens25?: number;
  windMs?: number; rhPct?: number; tempC?: number; absLat: number;
}): SpreadMeta {
  const dw = SW.skill?.default_weather ?? { wind_ms: 4.5, rh_pct: 45, temp_c: 30 };
  const x = [
    Math.log1p(f.frp || 0),
    (f.conf ?? 60) / 100,
    f.night ? 1 : 0,
    f.dens25 ?? 0,
    f.windMs ?? dw.wind_ms,
    f.rhPct ?? dw.rh_pct,
    f.tempC ?? dw.temp_c,
    Math.min(80, Math.abs(f.absLat)),
  ];
  let acc = 0;
  for (let t = 0; t < SW.nodes.length; t++) acc += walkReg(SW.nodes[t], x);
  const km = Math.round(Math.min(45, Math.max(0.02, 10 ** (acc / SW.nodes.length))) * 10) / 10;
  const band = km < 0.5 ? 'LOW' : km < 2 ? 'MODERATE' : km < 8 ? 'HIGH' : 'EXTREME';
  const fg = band === 'EXTREME' ? '#FECACA' : band === 'HIGH' ? '#FCA5A5' : band === 'MODERATE' ? '#FDE68A' : '#BBF7D0';
  return { km6h: km, band: band as SpreadMeta['band'], fg };
}

// ---------------------------------------------------------------- carbon ----
// documented chain (ignis-fire-calendar analysis): FRE = FRP × 1800 s;
// dry matter = FRE × 0.223 kg/MJ; CO2e = DM × 1.61 kg/kg
export const CARBON = { FRE_S: 1800, DM_PER_MJ: 0.223, CO2_PER_DM: 1.61 };
export const co2eTons = (frpMw: number): number => (frpMw * CARBON.FRE_S * CARBON.DM_PER_MJ * CARBON.CO2_PER_DM) / 1000;
export const dryMatterTons = (frpMw: number): number => (frpMw * CARBON.FRE_S * CARBON.DM_PER_MJ) / 1000;
/** equivalences for the impact panel */
export function carbonEquivalents(co2eT: number) {
  return {
    carsYears: co2eT / 4.6,            // avg passenger car 4.6 t CO2/yr
    treesYears: co2eT / 0.021,         // mature tree sequesters ~21 kg CO2/yr
    homesYears: co2eT / 7.5,           // ~7.5 t CO2 per household/yr (global mean)
    flights: co2eT / 0.25,             // ~250 kg CO2 per long-haul economy seat
  };
}

export const MODEL_META = {
  fireType: { name: 'Nabidnur/ignis-fire-type-model', version: TW.version ?? '1.0', classes: TW.classes, skill: TW.skill },
  spread: { name: 'Nabidnur/ignis-fire-spread-model', version: SW.version ?? '2.0', bands: SW.bands, skill: SW.skill },
};
