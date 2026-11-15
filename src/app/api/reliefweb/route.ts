import { NextRequest, NextResponse } from 'next/server';

// ReliefWeb — UN OCHA humanitarian disaster reports.
// The v1/v2 JSON APIs now require an approved appname (v1 → HTTP 410,
// v2 → 403 unapproved), so IGNIS consumes the public RSS feed instead:
//   https://reliefweb.int/disasters/rss.xml  (latest 20 disasters)
// Items are parsed for title/link/date/country and classified as wildfire vs
// general disaster context (honest labeling — no fake matches). Cached 30 min.

export const dynamic = 'force-dynamic';

export type ReliefItem = {
  id: string;
  name: string;
  url: string;
  dateEvent: string | null;
  disasterType: string;
  country: string;
  fire: boolean;
};

let cache: { at: number; items: ReliefItem[] } | null = null;
const TTL = 30 * 60 * 1000;

// REGION → country display names used in ReliefWeb titles/descriptions
const REGION_COUNTRIES: Record<string, string[]> = {
  amazon: ['brazil', 'colombia', 'peru', 'bolivia', 'venezuela', 'ecuador', 'guyana', 'suriname'],
  california: ['united states', 'usa', 'un states'],
  canada: ['canada'],
  siberia: ['russia', 'russian federation'],
  congo: ['congo', 'democratic republic'],
  borneo: ['indonesia', 'malaysia'],
  australia: ['australia'],
  bangladesh: ['bangladesh'],
  india: ['india'],
};

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function clean(s: string): string {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseXml(xml: string): ReliefItem[] {
  const out: ReliefItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks) {
    const title = clean(tag(b, 'title') || '');
    // ReliefWeb disaster titles are "Country: Type - Mon YYYY"
    const [countryPart, ...rest] = title.split(':');
    const typeAndDate = rest.join(':').trim();
    const type = (typeAndDate.split(' - ')[0] || typeAndDate || 'Disaster').trim();
    const desc = clean(tag(b, 'description') || '');
    const country = /affected country:\s*([^<.]+)/i.exec(desc)?.[1]?.trim() || countryPart.trim();
    const date = tag(b, 'pubDate');
    out.push({
      id: tag(b, 'guid') || tag(b, 'link') || title,
      name: title,
      url: (tag(b, 'link') || 'https://reliefweb.int/disasters').replace(/&amp;/g, '&'),
      dateEvent: date ? new Date(date).toISOString() : null,
      disasterType: type,
      country,
      fire: /wild.?fire|forest fire|fire/i.test(`${type} ${title}`),
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const regionKey = (req.nextUrl.searchParams.get('region') || '').toLowerCase();
  const limit = Math.min(12, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 6));
  try {
    if (!cache || Date.now() - cache.at > TTL) {
      const r = await fetch('https://reliefweb.int/disasters/rss.xml', {
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/xml,text/xml,application/rss+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          // their edge 406/444s bare runtime UAs — identify as a normal client
          'User-Agent': 'Mozilla/5.0 (compatible; IGNIS-SpaceApps2026/1.0; +https://ignis-spaceapps2026.vercel.app)',
        },
      });
      if (!r.ok) throw new Error(`reliefweb ${r.status}`);
      cache = { at: Date.now(), items: parseXml(await r.text()) };
    }
    let items = cache.items;
    let scope: 'fire' | 'context' = 'fire';
    let fireItems = items.filter((i) => i.fire);
    if (regionKey && REGION_COUNTRIES[regionKey]) {
      const cnames = REGION_COUNTRIES[regionKey];
      const regionalFire = fireItems.filter((i) => cnames.some((c) => `${i.country} ${i.name}`.toLowerCase().includes(c)));
      if (regionalFire.length) fireItems = regionalFire;
    }
    if (!fireItems.length) {
      // honest fallback: no active wildfire disaster reports in the feed right
      // now — surface the latest disaster reports as regional context instead
      scope = 'context';
      let context = items;
      if (regionKey && REGION_COUNTRIES[regionKey]) {
        const cnames = REGION_COUNTRIES[regionKey];
        const regional = context.filter((i) => cnames.some((c) => `${i.country} ${i.name}`.toLowerCase().includes(c)));
        if (regional.length) context = regional;
      }
      return NextResponse.json({ source: 'reliefweb', feed: 'rss+xml', ok: true, scope, count: Math.min(limit, context.length), items: context.slice(0, limit) });
    }
    return NextResponse.json({ source: 'reliefweb', feed: 'rss+xml', ok: true, scope, count: Math.min(limit, fireItems.length), items: fireItems.slice(0, limit) });
  } catch (e) {
    return NextResponse.json({ source: 'reliefweb', ok: false, reason: (e as Error).message, items: [] }, { status: 200 });
  }
}
