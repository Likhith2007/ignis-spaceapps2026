import { NextResponse } from 'next/server';
import { KEYS } from '@/lib/ignis/keys';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // a local model on CPU can take a few minutes

type AnalystContext = Record<string, unknown>;

const SYSTEM_PROMPT = `You are IGNIS Analyst, the built-in AI of IGNIS — a NASA Space Apps Challenge 2026 application that harmonizes NASA's split satellite fire record (MODIS Terra/Aqua since 2000, VIIRS S-NPP/NOAA-20/NOAA-21 since 2012) into one 26-year Burning Activity Calendar for early warning.

You receive LIVE telemetry JSON about the user's current Area of Interest (AOI): per-sensor detections, FRP (fire radiative power in MW), a 26-year harmonized monthly series summary, climatology, anomaly z-scores, a seasonal forecast, a burn-regime classification, and optionally 7-day fire weather.

RULES:
1. Ground EVERY number in the JSON provided. NEVER invent statistics. If data is missing say what is missing.
2. ANSWER THE USER'S ACTUAL QUESTION FIRST, in the first sentence, in plain everyday language. A yes/no question gets "Yes" or "No" as the first word. Short or casual questions ("is that real?", "why so many?", "what is this?") get a short direct answer of 2-4 sentences, not a briefing. If the question is unclear, give your best direct answer and add one line asking what they meant.
3. Do NOT write an "operational briefing", a status summary or a bullet list of everything in the JSON unless the user asks for a summary, overview, briefing or report. Only mention numbers that help answer the question. Max 130 words.
4. Reference NASA instruments by name when relevant (MODIS 1km on Terra/Aqua, VIIRS 375m on S-NPP/NOAA-20/NOAA-21, GIBS imagery, FIRMS).
5. ZERO-HALLUCINATION GUARD: if totalDetections is 0, perSensor is empty, or a field is missing/null, say the data is still loading or unavailable for that AOI — NEVER invent place names, cluster IDs, systems, events or numbers not present in the JSON.
6. If the user asks to navigate (switch region, go to a date, show a layer), START your reply with exactly one line:
NAVIGATE: {"region":"<regionKey>","date":"<YYYY-MM-DD>"} using only these region keys: amazon, california, canada, siberia, congo, borneo, australia, mediterranean, bangladesh, india. Omit fields you are not changing. If no navigation is needed, omit the line. Then give your analysis.`;

const MODELS = ['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen3-8B'];

const SITREP_PROMPT = `You are IGNIS SITREP, the incident-briefing mode of IGNIS Analyst (NASA Space Apps 2026, Challenge #9: Harmonization of MODIS & VIIRS Hot Spots).

You receive LIVE telemetry JSON: per-sensor detections + FRP, DBSCAN fire-cluster segmentation with convex-hull boundary metrics (class, count, FRP, spread km, front ratio), persistent fire systems tracked across the replay window, 26-year climatology/anomaly z-scores, forecast, burn-regime, and 7-day fire weather.

Write a TIGHT operational situation report in EXACTLY this markdown structure:
**SITUATION** — one paragraph: what is burning, where (reference top clusters by ID), how intense (total FRP, biggest cluster).
**KEY SYSTEMS** — 2-3 bullets on the most significant clusters / persistent systems (ID, class, FRP, trend, front ratio if elongated >1.6).
**ASSESSMENT** — sensor harmonization insight (MODIS vs VIIRS split), whether today is anomalous vs climatology (z), trajectory (growing/decaying systems).
**NEXT 48H** — 2-3 bullets: what responders should watch, tie in fire-weather verdict if present.

RULES: ground every number in the JSON. If totalDetections is 0 or segmentation is null, state plainly that no detections are loaded yet (data loading) and skip the numeric bullets — NEVER invent cluster IDs, fire names, places or numbers. Max 170 words. No preamble, start directly with **SITUATION**.`;

function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function callHF(model: string, question: string, contextJson: string, ctx: AnalystContext, system?: string, maxTokens = 520): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 28000);
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEYS.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system || SYSTEM_PROMPT },
          { role: 'user', content: userMessage(question, contextJson, ctx) },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
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

// ---------- verified facts ----------
// Language models (small local ones especially) misrank and miscompare numbers. Every
// ranking / total / comparison the answer may need is computed HERE, deterministically,
// and handed to the model to phrase — it is told not to re-derive them.
function verifiedFacts(ctx: AnalystContext): string {
  const c = ctx as Record<string, unknown>;
  const lines: string[] = [];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const total = num(c.totalDetections);
  if (c.regionName || c.day) lines.push(`Area and date: ${String(c.regionName ?? 'unknown area')}, ${String(c.day ?? 'unknown date')}.`);
  if (total !== null) lines.push(`Total detections: ${total.toLocaleString('en-US')}.`);
  const frp = num(c.totalFrpMW);
  if (frp !== null) lines.push(`Total fire radiative power: ${Math.round(frp).toLocaleString('en-US')} MW.`);
  const per = (c.perSensor && typeof c.perSensor === 'object' ? c.perSensor : {}) as Record<string, { count?: unknown }>;
  const ranked = Object.entries(per)
    .map(([k, v]) => [k, num(v?.count) ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    lines.push(`Detections per sensor, highest first: ${ranked.map(([k, n]) => `${k} ${n.toLocaleString('en-US')}`).join(', ')}.`);
    const reporting = ranked.filter(([, n]) => n > 0);
    if (reporting.length) lines.push(`Sensor with the MOST detections: ${reporting[0][0]} (${reporting[0][1].toLocaleString('en-US')}).`);
    if (reporting.length > 1) { const last = reporting[reporting.length - 1]; lines.push(`Sensor with the FEWEST detections among those reporting: ${last[0]} (${last[1].toLocaleString('en-US')}).`); }
    const silent = ranked.filter(([, n]) => n === 0).map(([k]) => k);
    if (silent.length) lines.push(`Sensors with no detections in this window (may simply not be delivering data): ${silent.join(', ')}.`);
    const modis = ranked.filter(([k]) => k.startsWith('MODIS')).reduce((a, [, n]) => a + n, 0);
    const viirs = ranked.filter(([k]) => k.startsWith('VIIRS')).reduce((a, [, n]) => a + n, 0);
    lines.push(`MODIS total ${modis.toLocaleString('en-US')} vs VIIRS total ${viirs.toLocaleString('en-US')}${modis > 0 ? ` (VIIRS is ${(viirs / modis).toFixed(1)} times MODIS)` : ''}. Difference: VIIRS has ${Math.abs(viirs - modis).toLocaleString('en-US')} ${viirs >= modis ? 'more' : 'fewer'} detections than MODIS.`);
    const all = modis + viirs;
    if (all > 0) {
      lines.push(`Share of detections: VIIRS ${((viirs / all) * 100).toFixed(1)}%, MODIS ${((modis / all) * 100).toFixed(1)}%.`);
      lines.push(`Share per sensor: ${reporting.map(([k, n]) => `${k} ${((n / all) * 100).toFixed(1)}%`).join(', ')}.`);
      lines.push(`Average detections per reporting sensor: ${Math.round(all / reporting.length).toLocaleString('en-US')} (${reporting.length} sensors reporting).`);
    }
  }
  const z = num(c.latestZ);
  if (z !== null) {
    lines.push(`Latest calendar-month anomaly z = ${z}: ${Math.abs(z) >= 2 ? 'UNUSUAL (|z| is 2 or more)' : 'within the normal range (|z| below 2)'}, ${z < 0 ? 'below' : z > 0 ? 'above' : 'at'} the long-term average for that month.`);
  }
  if (typeof c.peakMonths === 'string' && c.peakMonths) lines.push(`Usual peak fire months: ${c.peakMonths}.`);
  lines.push('About the data (for questions like "is this real?"): YES, the hotspots are real satellite observations, not simulated or made up. They come from NASA FIRMS and NASA GIBS: the MODIS instrument on the Terra and Aqua satellites (1 km pixels) and the VIIRS instrument on NOAA-20 and NOAA-21 (375 m pixels). Each hotspot is one satellite pixel where unusual heat was measured.');
  lines.push('Honest limits of hotspots: a hotspot is detected heat, so a few are not wildfires (gas flares, volcanoes, industrial sites, hot bare ground); clouds and smoke can hide real fires; one large fire appears as many hotspots, and the same fire is seen by several satellites. The 26-year calendar values are estimates and pre-2012 values are converted from MODIS.');
  return lines.length ? lines.join('\n') : 'No verified facts available (data not loaded).';
}

const FACTS_RULE = 'VERIFIED FACTS below were computed by the application and are correct. For any total, ranking ("most", "least") or comparison, use them exactly as written and do NOT recompute from the JSON. Do NO arithmetic of your own (no sums, differences, percentages or averages): if a number is not written in VERIFIED FACTS or the JSON, do not state it.';

function userMessage(question: string, contextJson: string, ctx: AnalystContext): string {
  return `${FACTS_RULE}\n\nVERIFIED FACTS:\n${verifiedFacts(ctx)}\n\nLIVE CONTEXT JSON (extra detail):\n${contextJson}\n\nUSER QUESTION: ${question}\n\nAnswer exactly this question, directly, starting with the answer itself.`;
}

// remove the navigation control line in any form the model writes it
function cleanAnswer(answer: string): string {
  return answer.replace(/^\s*NAVIGATE:.*$/gim, '').trim();
}

// ---------- local model (Ollama) ----------
// Set OLLAMA_MODEL (and optionally OLLAMA_URL) in .env.local to answer with a model running
// on this machine. It is tried FIRST; Hugging Face and the rule engine remain as backups.
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || '').trim();

async function callOllama(question: string, contextJson: string, ctx: AnalystContext, system?: string, maxTokens = 520): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 240000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false, // thinking-mode models would spend the whole token budget before answering
        messages: [
          { role: 'system', content: system || SYSTEM_PROMPT },
          { role: 'user', content: userMessage(question, contextJson, ctx) },
        ],
        // low temperature: stick to the numbers in the JSON; 8k context fits the telemetry
        options: { temperature: 0.2, num_predict: maxTokens, num_ctx: 8192 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const j = await res.json();
    const content: string | null = j.message?.content ?? null;
    if (!content) throw new Error('empty completion');
    return stripThinking(content);
  } finally {
    clearTimeout(t);
  }
}

function templateAnswer(q: string, ctx: AnalystContext): string {
  const c = ctx as Record<string, unknown>;
  const total = (c.totalDetections as number) ?? 0;
  const region = (c.regionName as string) ?? 'the AOI';
  const day = (c.day as string) ?? '';
  const ql = q.toLowerCase();
  if (/peak|season|when|critical/.test(ql)) {
    return `**Peak window:** ${(c.peakMonths as string) || 'climatology pending'}.\n\nThe 26-year record for ${region} shows a strong seasonal cycle; activity typically ramps up weeks before the peak. Current fire weather and the live detection counts above should be watched as the window approaches.`;
  }
  if (/anomal|unusual|strange|record/.test(ql)) {
    return `**Unusual conditions check:** latest harmonized month anomaly z = ${(c.latestZ as number) ?? 'n/a'} (|z| > 2 is unusual). Compare the live detection total (${total}) against the same-month climatology to judge whether today is abnormal for ${region}.`;
  }
  if (/sensor|difference|modis|viirs|compare/.test(ql)) {
    return `**Sensor harmonization:** MODIS (1 km, Terra + Aqua) sees fewer, larger fires; VIIRS (375 m, S-NPP/NOAA-20/NOAA-21) resolves fires ~450x smaller in area, so raw VIIRS counts run higher. IGNIS fuses them with an overlap-derived continuity coefficient, producing one comparable 26-year record for ${region}.`;
  }
  if (/regime|type|classif/.test(ql)) {
    return `**Burn regime:** ${(c.regime as string) || 'classification pending'}. The classifier compares your AOI's seasonality, interannual variability, FRP and night-fraction against 8 NASA-derived reference regions.`;
  }
  if (/forecast|outlook|next/.test(ql)) {
    return `**Seasonal outlook:** ${(c.forecastNote as string) || 'harmonic-regression forecast pending'}. Combine with the 7-day fire-weather panel for operational early warning.`;
  }
  return `**Current snapshot — ${region}, ${day}:** ${total} active-fire detections in the AOI across MODIS Terra/Aqua (1 km) and VIIRS S-NPP/NOAA-20/NOAA-21 (375 m). Ask me about peaks, anomalies, trends, the forecast, or the burn regime — every number I cite comes from the live NASA FIRMS/GIBS pipeline.`;
}

function parseNavigate(answer: string): { region?: string; date?: string } | null {
  const m = answer.match(/NAVIGATE:\s*(\{[^\}]+\})/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as { region?: string; date?: string };
    return o;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { question?: string; context?: AnalystContext; mode?: 'chat' | 'sitrep' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const mode = body.mode === 'sitrep' ? 'sitrep' : 'chat';
  const question = (body.question || (mode === 'sitrep' ? 'Generate the situation report for this AOI now.' : '')).slice(0, 600);
  const context = body.context || {};
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });
  const contextJson = JSON.stringify(context).slice(0, 9000);
  const system = mode === 'sitrep' ? SITREP_PROMPT : undefined;
  const maxTokens = mode === 'sitrep' ? 700 : 520;

  let localError: string | null = null;
  if (OLLAMA_MODEL) {
    try {
      const answer = await callOllama(question, contextJson, context, system, maxTokens);
      if (answer.length > 0) {
        return NextResponse.json({ answer: cleanAnswer(answer), actions: parseNavigate(answer), model: `${OLLAMA_MODEL} · local (Ollama)`, mode });
      }
    } catch (err) {
      localError = String((err as Error)?.message || err).slice(0, 120);
    }
  }

  for (const model of MODELS) {
    try {
      const answer = await callHF(model, question, contextJson, context, system, maxTokens);
      const clean = stripThinking(answer);
      if (clean.length > 0) {
        return NextResponse.json({ answer: cleanAnswer(clean), actions: parseNavigate(answer), model: localError ? `${model} (local model failed: ${localError})` : model, mode });
      }
    } catch {
      continue;
    }
  }
  return NextResponse.json({
    answer: mode === 'sitrep' ? templateSitrep(context) : templateAnswer(question, context),
    model: localError ? `ignis-rule-engine (local model failed: ${localError})` : 'ignis-rule-engine (offline fallback)', fallback: true, mode,
  });
}

// Deterministic SITREP builder — same structure the LLM is told to produce.
function templateSitrep(ctx: AnalystContext): string {
  const c = ctx as Record<string, unknown>;
  const region = (c.regionName as string) ?? 'the AOI';
  const day = (c.day as string) ?? '';
  const total = (c.totalDetections as number) ?? 0;
  const frp = (c.totalFrpMW as number) ?? 0;
  const seg = c.segmentation as Record<string, unknown> | null;
  const perSensor = (c.perSensor ?? {}) as Record<string, { count: number; meanFrp: number; hiConfPct: number }>;
  const modis = (perSensor['MODIS-Terra']?.count || 0) + (perSensor['MODIS-Aqua']?.count || 0);
  const viirs = (perSensor['VIIRS-SNPP']?.count || 0) + (perSensor['VIIRS-NOAA20']?.count || 0) + (perSensor['VIIRS-NOAA21']?.count || 0);
  const fw = c.fireWeather as { verdict?: string; peakDay?: string } | null;
  const z = c.latestZ as number | null | undefined;
  const top = (seg?.topClusters ?? []) as Array<Record<string, unknown>>;
  const persistent = (seg?.persistentSystems ?? []) as Array<Record<string, unknown>>;
  const topLine = top.length
    ? top.slice(0, 2).map((t) => `${t.id} (${t.cls}, ${t.n} det, ${t.frpSum} MW, ${t.spreadKm} km)`).join('; ')
    : 'no organized clusters — activity scattered';
  const trend = persistent.length
    ? persistent.slice(0, 2).map((p) => `${p.id}: ${p.days}d ${p.trend}`).join('; ')
    : 'no multi-day persistence in the loaded window';
  return `**SITUATION** — ${region}, ${day}: ${total} active-fire detections, Σ ${frp.toLocaleString()} MW across MODIS Terra/Aqua (1 km) + VIIRS S-NPP/NOAA-20/21 (375 m). Segmentation identifies ${seg?.clusters ?? 0} clusters (${seg?.clusteredPct ?? 0}% of detections inside boundaries); top: ${topLine}.

**KEY SYSTEMS**
- ${topLine}
- Persistence: ${trend}

**ASSESSMENT**
- Sensor split MODIS ${modis} vs VIIRS ${viirs} — ratio ${modis ? (viirs / modis).toFixed(1) : '—'}:1, the live harmonization gap (VIIRS resolves ~450× smaller fires).
- Latest month anomaly vs 26-yr climatology: z = ${z ?? 'n/a'} ${typeof z === 'number' ? (Math.abs(z) >= 2 ? '(UNUSUAL — |z|≥2)' : '(within normal range)') : ''}.
- Burn regime: ${typeof c.regime === 'object' && c.regime ? JSON.stringify(c.regime).slice(0, 80) : 'pending'}.

**NEXT 48H**
- Fire weather: ${fw?.verdict ?? 'unavailable'} (peak ${fw?.peakDay ?? 'n/a'}).
- Watch persistent systems for growth; re-check after next Terra/Aqua + S-NPP overpasses.
- Trigger: any cluster crossing 150 detections or ΣFRP 5,000 MW → escalate to MEGAFIRE monitoring.`;
}
