import { NextResponse } from 'next/server';
import { KEYS } from '@/lib/ignis/keys';
import { inferSpread, co2eTons } from '@/lib/ignis/models';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// IGNIS Hotspot Responder — per-hotspot AI threat assessment.
// Every interactive hotspot (map popup / 3D fire-field cell / segmentation
// cluster) POSTs its live FIRMS telemetry here and receives a compact
// operational verdict. The model MUST answer in strict JSON so the popup can
// render a structured card; a deterministic rule engine provides a
// zero-network fallback so the button NEVER dead-ends.

type Hotspot = {
  kind?: 'detection' | 'cluster' | 'cell' | 'gibs';
  lat?: number;
  lon?: number;
  frp?: number;
  conf?: number;
  sensor?: string;
  sat?: string;
  acq?: string;
  night?: boolean;
  day?: string;
  regionKey?: string;
  cluster?: {
    id?: string | number;
    cls?: string;
    n?: number;
    frpSum?: number;
    meanFrp?: number;
    spreadKm?: number;
    areaKm2?: number;
    elongation?: number;
    nightPct?: number;
    sensors?: string;
    modelCls?: string;
    modelClsPct?: number;
  };
  cell?: { n?: number; frpSum?: number; meanConf?: number; nightPct?: number; maxFrp?: number };
  // model-twin enrichments (stamped client-side by /api/hotspots pass)
  type?: string;
  typeP?: number;
  spreadKm?: number;
  dens25?: number;
  weather?: { windMs?: number; rhPct?: number; tempC?: number };
};

const REGION_NAMES: Record<string, string> = {
  amazon: 'the Amazon Basin', california: 'California / US West', canada: 'Boreal Canada',
  siberia: 'Eastern Siberia', congo: 'the Congo Basin', borneo: 'Borneo / Sumatra',
  australia: 'Australia', mediterranean: 'the Mediterranean', bangladesh: 'Bangladesh / Bengal',
};

const SYSTEM_PROMPT = `You are IGNIS Hotspot Responder, the per-hotspot AI of IGNIS (NASA Space Apps Challenge 2026, Challenge #9: Harmonization of MODIS & VIIRS Hot Spots). You assess ONE satellite fire detection (or an aggregated fire cell/cluster) for an incident commander.

PHYSICS GROUNDING (use, do not invent):
- FRP = fire radiative power in MW from MODIS (1 km, Terra/Aqua) or VIIRS (375 m, S-NPP/NOAA-20/NOAA-21). <10 MW = smouldering or agricultural/managed burn; 10-100 MW = active surface fire; 100-250 MW = intense fire front; >250 MW = conflagration-grade energy release.
- Confidence is the FIRMS detection confidence %. Night overpass + sustained detections imply smouldering persistence.
- VIIRS resolves fires ~450x smaller in area than MODIS, so VIIRS detects small/early fires MODIS misses.

OUTPUT — STRICT JSON ONLY, no markdown fences, no prose outside JSON:
{"verdict":"LOW|MODERATE|HIGH|EXTREME","headline":"<=12 words","analysis":"<=75 words, operational","watch":["<=12 words","<=12 words","<=12 words"]}

RULES:
1. Ground EVERY number in the provided telemetry. NEVER invent place names, coordinates, trends, or history not present in the JSON.
2. verdict MUST match the FRP band exactly: <10 MW → LOW or MODERATE, 10-100 MW → MODERATE, 100-250 MW → HIGH, >250 MW → EXTREME. Upgrade one level when the overpass is night or cluster/cell aggregation shows organized fire. Never state an intensity band that contradicts the FRP value.
3. analysis explains WHY this verdict (physics), what it likely is, and what matters operationally.
4. watch = concrete next actions (overpass timing, spread watch, cross-checks with GIBS imagery).`;

const MODELS = ['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen3-8B'];

function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function telemetry(h: Hotspot): string {
  const region = REGION_NAMES[h.regionKey ?? ''] ?? `the ${h.regionKey ?? 'selected'} AOI`;
  const lines = [
    `region: ${region}`,
    `date: ${h.day ?? 'unknown'} (UTC, FIRMS NRT)`,
    `detection: lat ${h.lat?.toFixed(3)}, lon ${h.lon?.toFixed(3)}`,
    `FRP: ${(h.frp ?? 0).toFixed(1)} MW`,
    `confidence: ${Math.round(h.conf ?? 0)}%`,
    `sensor: ${h.sensor ?? 'unknown'}${h.sat ? ` (${h.sat})` : ''}`,
    `overpass: ${h.night ? 'night' : 'day'}${h.acq ? ` at ${h.acq} UTC` : ''}`,
  ];
  if (h.cluster) {
    const c = h.cluster;
    lines.push(
      `cluster context: id ${c.id ?? '?'} class ${c.cls ?? '?'}, ${c.n ?? '?'} detections, ΣFRP ${Math.round(c.frpSum ?? 0)} MW, mean ${(c.meanFrp ?? 0).toFixed(1)} MW, spread ${(c.spreadKm ?? 0).toFixed(1)} km, hull ${Math.round(c.areaKm2 ?? 0)} km², front ratio ${(c.elongation ?? 1).toFixed(2)}, night ${(c.nightPct ?? 0).toFixed(0)}%`,
    );
  }
  if (h.cell) {
    const c = h.cell;
    lines.push(`cell context: ${c.n ?? '?'} detections, ΣFRP ${Math.round(c.frpSum ?? 0)} MW, max single ${Math.round(c.maxFrp ?? 0)} MW, mean confidence ${Math.round(c.meanConf ?? 0)}%, night ${(c.nightPct ?? 0).toFixed(0)}%`);
  }
  return lines.join('\n');
}

async function callHF(model: string, telemetryText: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 26000);
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEYS.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `LIVE HOTSPOT TELEMETRY:\n${telemetryText}\n\nAssess this hotspot now. Output the strict JSON object only.` },
        ],
        max_tokens: 420,
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const content: string | null = j.choices?.[0]?.message?.content ?? null;
    if (!content) throw new Error('empty completion');
    return stripThinking(content);
  } finally {
    clearTimeout(t);
  }
}

function parseVerdictJSON(raw: string): { verdict: string; headline: string; analysis: string; watch: string[] } | null {
  const s = raw.replace(/```json/gi, '```').replace(/```/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { verdict?: string; headline?: string; analysis?: string; watch?: string[] };
    const verdict = String(o.verdict ?? '').toUpperCase();
    if (!['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(verdict)) return null;
    return {
      verdict,
      headline: String(o.headline ?? '').slice(0, 90),
      analysis: String(o.analysis ?? '').slice(0, 700),
      watch: Array.isArray(o.watch) ? o.watch.map((w) => String(w).slice(0, 90)) : [],
    };
  } catch {
    return null;
  }
}

// Deterministic fallback — same shape, grounded purely in FIRMS physics bands.
function ruleAssessment(h: Hotspot): { verdict: string; headline: string; analysis: string; watch: string[] } {
  const frp = h.frp ?? 0;
  const conf = h.conf ?? 0;
  const night = !!h.night;
  const region = REGION_NAMES[h.regionKey ?? ''] ?? `the ${h.regionKey ?? 'selected'} AOI`;
  let verdict = 'LOW';
  if (frp >= 250) verdict = 'EXTREME';
  else if (frp >= 120) verdict = 'HIGH';
  else if (frp >= 25) verdict = 'MODERATE';
  if (night && verdict === 'MODERATE') verdict = 'HIGH';
  const band =
    frp < 10 ? 'smouldering or an agricultural / managed burn (FRP < 10 MW band)'
      : frp < 100 ? 'an active surface fire (10–100 MW band)'
        : frp < 250 ? 'an intense fire front (100–250 MW band)'
          : 'conflagration-grade energy release (>250 MW)';
  const sensorNote = (h.sensor ?? '').startsWith('VIIRS')
    ? 'VIIRS 375 m resolves fires ~450× smaller in area than MODIS — early-phase detection is its strength'
    : 'MODIS 1 km confirms larger, established fire signatures';
  const analysis = `${(h.frp ?? 0).toFixed(1)} MW at ${conf}% detection confidence on a ${night ? 'night' : 'day'} overpass reads as ${band} in ${region}. ${sensorNote}.${h.cluster ? ` Cluster aggregation (${h.cluster.n ?? '?'} detections, Σ ${Math.round(h.cluster.frpSum ?? 0)} MW) indicates organized fire behavior rather than an isolated point.` : ''}`;
  return {
    verdict,
    headline: `${frp.toFixed(0)} MW ${night ? 'night' : 'day'} detection — ${verdict.toLowerCase()} threat`,
    analysis,
    watch: [
      `Confirm growth on the next ${night ? 'VIIRS S-NPP' : 'Terra/Aqua'} overpass`,
      'Cross-check GIBS 7-2-1 false color for burn-scar expansion',
      'Escalate if FRP doubles or clustering tightens within 24 h',
    ],
  };
}

const VERDICT_ORDER = ['LOW', 'MODERATE', 'HIGH', 'EXTREME'];

async function fetchAqi(lat: number, lon: number): Promise<{ aqi: number | null; pm25: number | null; band: string | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=pm2_5,us_aqi`,
      { signal: ctrl.signal, next: { revalidate: 600 } },
    );
    if (!res.ok) return null;
    const j = await res.json() as { current?: { us_aqi?: number; pm2_5?: number } };
    const aqi = typeof j.current?.us_aqi === 'number' ? Math.round(j.current.us_aqi) : null;
    const band = aqi == null ? null : aqi <= 50 ? 'GOOD' : aqi <= 100 ? 'MODERATE' : aqi <= 150 ? 'UNHEALTHY (SENSITIVE)' : aqi <= 200 ? 'UNHEALTHY' : aqi <= 300 ? 'VERY UNHEALTHY' : 'HAZARDOUS';
    return { aqi, pm25: typeof j.current?.pm2_5 === 'number' ? Math.round(j.current.pm2_5 * 10) / 10 : null, band };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  let body: { hotspot?: Hotspot };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const h = body.hotspot;
  if (!h || typeof h !== 'object') return NextResponse.json({ error: 'hotspot required' }, { status: 400 });

  // ---- model-twin + smoke enrichment (parallel, 9 s budget) ----
  const lat = h.lat ?? 0;
  const lon = h.lon ?? 0;
  const [aqiInfo] = await Promise.all([lat !== 0 || lon !== 0 ? fetchAqi(lat, lon) : Promise.resolve(null)]);
  // weather-aware spread: live weather (Open-Meteo, client-stamped) else defaults
  const spread = inferSpread({
    frp: h.frp ?? 0, conf: h.conf ?? 60, night: !!h.night, dens25: h.dens25,
    windMs: h.weather?.windMs, rhPct: h.weather?.rhPct, tempC: h.weather?.tempC,
    absLat: lat,
  });
  const co2T = h.cell || h.cluster ? co2eTons(h.cluster?.frpSum ?? h.cell?.frpSum ?? 0) : co2eTons(h.frp ?? 0);
  const enrich = {
    fireType: h.type ?? null,
    typeP: h.typeP ?? null,
    spreadKm: spread.km6h,
    spreadBand: spread.band,
    co2eTons: Math.round(co2T * 100) / 100,
    aqi: aqiInfo?.aqi ?? null,
    aqiBand: aqiInfo?.band ?? null,
    pm25: aqiInfo?.pm25 ?? null,
  };
  const extra = [
    h.type ? `fire type (ignis-fire-type-model): ${h.type}${h.typeP ? ` ${h.typeP}%` : ''}` : null,
    `6h spread forecast (ignis-fire-spread-model): ${spread.km6h} km (${spread.band}); weather: wind ${h.weather?.windMs ?? 'default 4.5'} m/s, RH ${h.weather?.rhPct ?? 'default 45'}%`,
    `first-order CO2e: ${enrich.co2eTons} t (FRE = FRP × 1800 s, DM 0.223 kg/MJ, CO2e 1.61 kg/kg)`,
    aqiInfo?.aqi != null ? `local air quality: US AQI ${aqiInfo.aqi}${aqiInfo.band ? ` (${aqiInfo.band})` : ''}, PM2.5 ${aqiInfo.pm25} µg/m³` : null,
  ].filter(Boolean).join('\n');
  const telemetryText = `${telemetry(h)}\n${extra}`;

  // physics floor — the deterministic FIRMS-band verdict the LLM may never undercut
  const physicsVerdict = ruleAssessment(h).verdict;

  for (const model of MODELS) {
    try {
      const raw = await callHF(model, telemetryText);
      const parsed = parseVerdictJSON(raw);
      if (parsed) {
        // physics clamp: small instruction-tuned models occasionally under-call
        // extreme FRP. The verdict chip is operationally load-bearing, so it is
        // clamped to the deterministic FIRMS-physics band (LLM may still upgrade
        // for night persistence / cluster context, never downgrade below physics).
        const mi = VERDICT_ORDER.indexOf(parsed.verdict);
        const pi = VERDICT_ORDER.indexOf(physicsVerdict);
        if (mi >= 0 && pi > mi) parsed.verdict = physicsVerdict;
        return NextResponse.json({ ...parsed, ...enrich, model });
      }
    } catch {
      continue;
    }
  }
  return NextResponse.json({ ...ruleAssessment(h), ...enrich, model: 'ignis-threat-rules (offline fallback)', fallback: true });
}
