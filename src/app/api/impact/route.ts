import { NextResponse } from 'next/server';
import baseline from '@/lib/ignis/emissionsBaseline.json';

export const dynamic = 'force-dynamic';

/**
 * IGNIS Carbon & Climate Impact — AOI-scale first-order emissions estimate.
 * Uses the SAME documented chain as the ignis-fire-calendar analysis dataset:
 *   FRE ≈ Σ FRP × 1800 s  (30-min persistence of the NRT snapshot)
 *   dry matter = FRE × 0.223 kg/MJ   (Kaufman-style FRP→biomass coefficient)
 *   CO2e = DM × 1.61 kg/kg            (C 0.45 × CO2/C 3.67 rounded)
 * Contextualized against the region's 26-year harmonized annual record.
 */

type Region = keyof typeof baseline.per_region | string;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const frp = parseFloat(searchParams.get('frp') ?? '');
  const region = (searchParams.get('region') ?? 'amazon') as Region;
  const day = searchParams.get('day') ?? null;
  const detections = parseInt(searchParams.get('detections') ?? '0', 10) || null;
  if (!isFinite(frp) || frp < 0) {
    return NextResponse.json({ error: 'frp (Σ MW) required' }, { status: 400 });
  }
  const freTj = (frp * 1800) / 1e6;                     // MJ → TJ (×1800 s, /1e6)
  const dryMatterKt = (frp * 1800 * 0.223) / 1e9;       // kg → kt
  const co2eMt = (frp * 1800 * 0.223 * 1.61) / 1e9;     // kg → Mt
  const co2eT = co2eMt * 1e6;
  const reg = (baseline.per_region as { region: string; mean_annual_co2e_mt: number; max_co2e_mt: number }[]).find((r) => r.region === region) ?? null;
  const shareOfYear = reg ? co2eMt / reg.mean_annual_co2e_mt : null;
  return NextResponse.json({
    ok: true,
    scope: 'AOI · single-day NRT snapshot',
    region, day, detections, frpMw: Math.round(frp),
    freTj: +freTj.toFixed(1),
    dryMatterKt: +dryMatterKt.toFixed(2),
    co2eMt: +co2eMt.toFixed(4),
    co2eTons: Math.round(co2eT),
    equivalents: {
      carsYears: +(co2eT / 4.6).toFixed(0),
      treesYears: Math.round(co2eT / 0.021),
      homesYears: +(co2eT / 7.5).toFixed(0),
      longHaulFlights: Math.round(co2eT / 0.25),
    },
    context: reg
      ? {
          regionMeanAnnualMt: reg.mean_annual_co2e_mt,
          regionMaxMt: reg.max_co2e_mt,
          shareOfMeanYear: shareOfYear != null ? +(shareOfYear * 100).toFixed(3) : null,
          note: `vs the region's 26-yr harmonized record (mean ${reg.mean_annual_co2e_mt} Mt CO2e/yr, max ${reg.max_co2e_mt} Mt)`,
        }
      : null,
    methodology: 'FRE = ΣFRP × 1800 s · DM = FRE × 0.223 kg/MJ · CO2e = DM × 1.61 kg/kg — identical to the ignis-fire-calendar emissions dataset (HF, private). First-order estimate: FRP snapshots miss between-overpass persistence; treat as a lower bound for long-lived fires.',
    source: 'ignis-fire-calendar (Nabidnur) + NASA FIRMS live telemetry',
  });
}
