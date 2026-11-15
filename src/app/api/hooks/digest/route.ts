import { NextResponse } from 'next/server';

// /api/hooks/digest — machine-readable DAILY FIRE DIGEST for automation.
//
// Designed as the single integration point for n8n / GitHub Actions / Vercel
// Cron / any webhook orchestrator (user-referenced: github.com/n8n-io/n8n).
// One GET returns: per-region live detection rollups, EXTREME hotspots worth
// alerting on, GDACS authority alerts, and deep links back into IGNIS.
//
// An importable n8n workflow ships at automation/ignis-n8n-workflow.json —
// it schedules a daily call to this endpoint, filters EXTREME items and
// delivers them to Telegram / Email / Slack nodes.
//
// Optional guard: set env IGNIS_HOOK_TOKEN and call with
//   Authorization: Bearer <token>   (skipped when unset — public read)

export const dynamic = 'force-dynamic';

type DigestRegion = {
  key: string;
  name: string;
  bbox: number[];
  day: string;
  detections: number;
  frpMW: number;
  maxFrpMW: number;
  extreme: number;
  high: number;
  source: string;
  link: string;
};

const REGIONS: Array<{ key: string; name: string; bbox: number[] }> = [
  { key: 'amazon', name: 'Amazon Basin', bbox: [-74, -12, -46, 2] },
  { key: 'california', name: 'California / US West', bbox: [-125, 32, -114, 42] },
  { key: 'canada', name: 'Boreal Canada', bbox: [-140, 52, -95, 70] },
  { key: 'siberia', name: 'Eastern Siberia', bbox: [100, 50, 145, 70] },
  { key: 'congo', name: 'Congo Basin', bbox: [8, -8, 32, 8] },
  { key: 'borneo', name: 'Borneo & Sumatra', bbox: [95, -6, 120, 6] },
  { key: 'australia', name: 'Australia', bbox: [112, -42, 154, -10] },
  { key: 'mediterranean', name: 'Mediterranean Basin', bbox: [-8, 30, 32, 46] },
];

function threatScore(frp: number, conf: number, night: boolean): number {
  const frpPts = Math.min(60, (Math.log10(1 + Math.max(0, frp)) / Math.log10(501)) * 60);
  return Math.round(frpPts + (Math.max(0, Math.min(100, conf)) / 100) * 25 + (night ? 15 : 8));
}

export async function GET(req: Request) {
  const token = process.env.IGNIS_HOOK_TOKEN;
  if (token) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }
  }
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://ignis-spaceapps2026.vercel.app';

  const regions = await Promise.all(
    REGIONS.map(async (r) => {
      try {
        const [w, s, e, n] = r.bbox;
        const res = await fetch(`${base}/api/hotspots?w=${w}&s=${s}&e=${e}&n=${n}&day=${day}&days=1`, {
          signal: AbortSignal.timeout(20000),
        });
        const d = (await res.json()) as {
          error?: string;
          source?: string;
          days?: Record<string, { sensors?: Record<string, { count: number; points: Array<{ frp: number; conf: number; night: boolean }> }> }>;
        };
        const hot = d.days?.[day] ?? Object.values(d.days ?? {})[0];
        const sensors = Object.values(hot?.sensors ?? {});
        const points = sensors.flatMap((s2) => s2.points);
        let extreme = 0, high = 0;
        for (const p of points) {
          const sc = threatScore(p.frp || 0, typeof p.conf === 'number' ? p.conf : 60, !!p.night);
          if (sc >= 80) extreme += 1;
          else if (sc >= 62) high += 1;
        }
        const det = sensors.reduce((a, s2) => a + s2.count, 0);
        const frp = points.reduce((a, p) => a + (p.frp || 0), 0);
        const maxFrp = points.reduce((m, p) => Math.max(m, p.frp || 0), 0);
        return {
          key: r.key,
          name: r.name,
          bbox: r.bbox,
          day,
          detections: det,
          frpMW: Math.round(frp),
          maxFrpMW: Math.round(maxFrp),
          extreme,
          high,
          source: d.source ?? 'unknown',
          link: `${base}/?region=${r.key}`,
        } satisfies DigestRegion;
      } catch {
        return {
          key: r.key, name: r.name, bbox: r.bbox, day,
          detections: 0, frpMW: 0, maxFrpMW: 0, extreme: 0, high: 0,
          source: 'unreachable', link: `${base}/?region=${r.key}`,
        } satisfies DigestRegion;
      }
    }),
  );

  const alertRegions = regions
    .filter((r) => r.extreme + r.high > 0 || r.detections >= 60)
    .sort((a, b) => b.extreme - a.extreme || b.detections - a.detections);

  let gdacs: Array<{ alertLevel: string; title: string; country: string; url: string }> = [];
  try {
    const g = await fetch(`${base}/api/gdacs`, { signal: AbortSignal.timeout(12000) });
    const gj = (await g.json()) as { items?: Array<{ alertLevel: string; title: string; country: string; url: string }> };
    gdacs = (gj.items ?? []).filter((i) => i.alertLevel === 'RED' || i.alertLevel === 'ORANGE').slice(0, 8);
  } catch { /* digest must never fail because of a side feed */ }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    day,
    consumer: 'n8n / GitHub Actions / Vercel Cron',
    headline:
      alertRegions.length === 0
        ? `IGNIS daily digest ${day}: no regions above HIGH threat.`
        : `IGNIS daily digest ${day}: ${alertRegions.length} region(s) need attention — ` +
          alertRegions.slice(0, 3).map((r) => `${r.name} (${r.extreme} EXTREME / ${r.detections} det)`).join(' · '),
    alertRegions,
    regions,
    gdacs,
    links: { app: base, health: `${base}/api/health` },
  });
}
