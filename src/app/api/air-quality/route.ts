import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * IGNIS Smoke & Air Quality — Open-Meteo Air Quality API (free, keyless).
 * Smoke readout for any hotspot / AOI center: PM2.5, PM10, CO, aerosol optical
 * depth, dust + US AQI with health band. Feeds the per-hotspot AI event card
 * ("💨 smoke & air") and the Impact tab.
 */

type AqBand = { label: string; fg: string; bg: string; advice: string };

export function aqiBand(usAqi: number | null): AqBand | null {
  if (usAqi == null) return null;
  if (usAqi <= 50) return { label: 'GOOD', fg: '#BBF7D0', bg: 'rgba(74,222,128,0.16)', advice: 'air quality is satisfactory' };
  if (usAqi <= 100) return { label: 'MODERATE', fg: '#FDE68A', bg: 'rgba(251,191,36,0.16)', advice: 'unusually sensitive people should watch smoke' };
  if (usAqi <= 150) return { label: 'UNHEALTHY (SENSITIVE)', fg: '#FDBA74', bg: 'rgba(251,146,60,0.18)', advice: 'children, elders and asthmatics should limit outdoor exertion' };
  if (usAqi <= 200) return { label: 'UNHEALTHY', fg: '#FCA5A5', bg: 'rgba(239,68,68,0.20)', advice: 'everyone may feel effects — N95 masks recommended outdoors' };
  if (usAqi <= 300) return { label: 'VERY UNHEALTHY', fg: '#F5D0FE', bg: 'rgba(217,70,239,0.18)', advice: 'health alert — avoid outdoor activity' };
  return { label: 'HAZARDOUS', fg: '#FECACA', bg: 'rgba(185,28,28,0.65)', advice: 'emergency conditions — stay indoors, filter air' };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lon = parseFloat(searchParams.get('lon') ?? '');
  if (!isFinite(lat) || !isFinite(lon)) {
    return NextResponse.json({ error: 'lat & lon required' }, { status: 400 });
  }
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&current=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth,dust,us_aqi` +
    `&timezone=auto`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ac.signal, next: { revalidate: 600 } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const d = (await res.json()) as { current?: Record<string, number | string> };
    const cur = d.current ?? {};
    const usAqi = typeof cur.us_aqi === 'number' ? Math.round(cur.us_aqi) : null;
    const band = aqiBand(usAqi);
    // smoke signal: aerosol optical depth + CO are the strongest wildfire-smoke
    // markers in the CAMS fields; PM2.5 carries the health impact
    const aod = typeof cur.aerosol_optical_depth === 'number' ? cur.aerosol_optical_depth : null;
    const smokeSuspicion = aod != null && aod >= 0.6 ? 'HIGH' : aod != null && aod >= 0.35 ? 'ELEVATED' : aod != null ? 'LOW' : null;
    return NextResponse.json({
      ok: true,
      lat, lon,
      usAqi,
      band,
      smokeSuspicion,
      pm2_5: cur.pm2_5 ?? null,
      pm10: cur.pm10 ?? null,
      carbonMonoxide: cur.carbon_monoxide != null ? Math.round(Number(cur.carbon_monoxide)) : null, // μg/m³
      aerosolOpticalDepth: aod,
      dust: cur.dust ?? null,
      ozone: cur.ozone ?? null,
      time: cur.time ?? null,
      source: 'Open-Meteo Air Quality (CAMS global, keyless)',
    });
  } catch (e) {
    clearTimeout(t);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'air-quality fetch failed' }, { status: 200 });
  }
}
