import { NextRequest, NextResponse } from 'next/server';

// GDACS — Global Disaster Alert and Coordination System (EC/JRC + UN).
// The JSON event API now 400s without extra params, so IGNIS consumes the
// OFFICIAL RSS feed instead — https://www.gdacs.org/xml/rss.xml — which is
// richer anyway: every item carries gdacs:eventtype, gdacs:alertlevel,
// geo:lat/long, gdacs:iso3/country, severity (ha) and a report link.
// WILDFIRE (WF) events only, bbox-filterable, cached 10 min.

export const dynamic = 'force-dynamic';

export type GdacsItem = {
  eventId: string;
  title: string;
  alertLevel: string;
  alertScore: number | null;
  country: string;
  iso3: string | null;
  from: string | null;
  to: string | null;
  lat: number;
  lon: number;
  severityHa: number | null;
  url: string;
};

let cache: { at: number; items: GdacsItem[] } | null = null;
const TTL = 10 * 60 * 1000;

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseXml(xml: string): GdacsItem[] {
  const out: GdacsItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks) {
    const et = (tag(b, 'gdacs:eventtype') || '').toUpperCase();
    if (et !== 'WF') continue;
    const lat = parseFloat(tag(b, 'geo:lat') || '');
    const lon = parseFloat(tag(b, 'geo:long') || '');
    const iso3 = tag(b, 'gdacs:iso3');
    const title = (tag(b, 'title') || 'GDACS wildfire alert').replace(/<!\[CDATA\[|\]\]>/g, '');
    const sevRaw = tag(b, 'gdacs:severity');
    const sevVal = sevRaw ? (sevRaw.match(/value="([\d.]+)"/)?.[1] ?? null) : null;
    const from = tag(b, 'gdacs:fromdate');
    const to = tag(b, 'gdacs:todate');
    const eventid = tag(b, 'gdacs:eventid') || (tag(b, 'guid') ?? '').replace(/^WF/, '');
    out.push({
      eventId: eventid || `${lat.toFixed(2)}-${lon.toFixed(2)}`,
      title,
      alertLevel: (tag(b, 'gdacs:alertlevel') || 'GREEN').toUpperCase(),
      alertScore: Number.isFinite(parseFloat(tag(b, 'gdacs:alertscore') || '')) ? parseFloat(tag(b, 'gdacs:alertscore') || '') : null,
      country: tag(b, 'gdacs:country') || '',
      iso3: iso3 ? iso3.toUpperCase() : null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      lat,
      lon,
      severityHa: sevVal ? parseFloat(sevVal) : null,
      url: `https://www.gdacs.org/report.aspx?eventtype=WF&eventid=${encodeURIComponent(eventid || '')}`,
    });
  }
  return out.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
}

const ORDER: Record<string, number> = { RED: 0, ORANGE: 1, GREEN: 2 };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const w = parseFloat(sp.get('w') || ''), s = parseFloat(sp.get('s') || '');
  const e = parseFloat(sp.get('e') || ''), n = parseFloat(sp.get('n') || '');
  const hasBbox = [w, s, e, n].every(Number.isFinite);
  try {
    if (!cache || Date.now() - cache.at > TTL) {
      const r = await fetch('https://www.gdacs.org/xml/rss.xml', {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/rss+xml,application/xml' },
      });
      if (!r.ok) throw new Error(`gdacs ${r.status}`);
      cache = { at: Date.now(), items: parseXml(await r.text()) };
    }
    let items = cache.items;
    if (hasBbox) {
      const inBox = items.filter((it) => it.lon >= w && it.lon <= e && it.lat >= s && it.lat <= n);
      if (inBox.length) items = inBox;
    }
    items = [...items].sort((a, b) => (ORDER[a.alertLevel] ?? 3) - (ORDER[b.alertLevel] ?? 3) || (b.alertScore ?? 0) - (a.alertScore ?? 0));
    return NextResponse.json({ source: 'gdacs', feed: 'rss+xml', ok: true, count: items.length, items: items.slice(0, 24) });
  } catch (err) {
    return NextResponse.json({ source: 'gdacs', ok: false, reason: (err as Error).message, items: [] }, { status: 200 });
  }
}
