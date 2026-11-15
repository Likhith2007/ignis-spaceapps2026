import { NextRequest, NextResponse } from 'next/server';

// Wikipedia REST context — "what am I looking at?" placard for each AOI.
// Keyless, public: en.wikipedia.org search + REST summary. Cached 6 h.
// Usage: /api/context?q=Amazon%20Basin

export const dynamic = 'force-dynamic';

type ContextDoc = {
  ok: boolean;
  title?: string;
  extract?: string;
  thumbnail?: string | null;
  url?: string;
  reason?: string;
};

const cache = new Map<string, { at: number; doc: ContextDoc }>();
const TTL = 6 * 60 * 60 * 1000;

const UA = 'IGNIS-SpaceApps2026/1.0 (https://ignis-spaceapps2026.vercel.app)';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 120);
  if (!q) return NextResponse.json({ ok: false, reason: 'missing q' } satisfies ContextDoc);
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.doc);

  try {
    // 1) search for the best-matching article (handles "Borneo & Sumatra" etc.)
    const sr = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) },
    );
    if (!sr.ok) throw new Error(`wiki search ${sr.status}`);
    const sj = (await sr.json()) as { query?: { search?: Array<{ title: string }> } };
    const title = sj.query?.search?.[0]?.title;
    if (!title) throw new Error('no article');

    // 2) REST summary for extract + thumbnail
    const rr = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) },
    );
    if (!rr.ok) throw new Error(`wiki summary ${rr.status}`);
    const rj = (await rr.json()) as {
      title?: string; extract?: string; thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    };
    const doc: ContextDoc = {
      ok: true,
      title: rj.title ?? title,
      extract: (rj.extract ?? '').slice(0, 420),
      thumbnail: rj.thumbnail?.source ?? null,
      url: rj.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
    cache.set(key, { at: Date.now(), doc });
    return NextResponse.json(doc);
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message } satisfies ContextDoc);
  }
}
