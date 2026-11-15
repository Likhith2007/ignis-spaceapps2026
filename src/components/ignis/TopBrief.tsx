'use client';

// IGNIS TopBrief — one-line live summary + EARLY ALERT banner (features: summary at top + early alert).
// The summary is computed from LIVE telemetry (no LLM dependency, never blocks),
// and the early-alert strip escalates GREEN→AMBER→ORANGE→RED from FRP + density.
// v7: Lucide SVG icons (ui-ux-pro-max: no emoji as icons), SplitText reveal on
// the summary line, Material-elevated alert bar with animated severity beacon.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Satellite, SignalHigh, SignalLow, SignalMedium, X } from 'lucide-react';
import type { HotspotsResult } from '@/lib/ignis/types';
import SplitText from './fx/SplitText';
import GradientText from './fx/GradientText';
import ShinyText from './fx/ShinyText';

type Props = { hotspots: HotspotsResult | null; day: string; regionName: string; loading: boolean };

type Level = { level: 'GREEN' | 'AMBER' | 'ORANGE' | 'RED'; color: string; headline: string };

function earlyAlert(h: HotspotsResult | null): Level {
  if (!h) return { level: 'GREEN', color: '#22C55E', headline: 'No significant fire activity flagged in this AOI right now' };
  const sensors = Object.values(h.sensors);
  const total = sensors.reduce((a, s) => a + s.count, 0);
  const frp = sensors.reduce((a, s) => a + s.points.reduce((x, p) => x + (p.frp || 0), 0), 0);
  const extreme = sensors.reduce((a, s) => a + s.points.filter((p) => p.frp >= 250).length, 0);
  if (total >= 150 || frp >= 2500 || extreme >= 3) {
    return { level: 'RED', color: '#EF4444', headline: `Significant fire activity — ${total.toLocaleString()} detections, ${Math.round(frp).toLocaleString()} MW FRP${extreme ? `, ${extreme} conflagration-grade (≥250 MW)` : ''}` };
  }
  if (total >= 60 || frp >= 1200) {
    return { level: 'ORANGE', color: '#F97316', headline: `Elevated fire activity — ${total.toLocaleString()} detections, ${Math.round(frp).toLocaleString()} MW FRP` };
  }
  if (total >= 20) {
    return { level: 'AMBER', color: '#FACC15', headline: `Scattered fire activity — ${total.toLocaleString()} detections, watch list active` };
  }
  return { level: 'GREEN', color: '#22C55E', headline: `${total} detections — low activity in this AOI today` };
}

function LevelIcon({ level, color }: { level: Level['level']; color: string }) {
  const cls = 'h-4.5 w-4.5 shrink-0';
  if (level === 'RED') return <span className="relative flex"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: color }} /><AlertTriangle className={cls} style={{ color }} aria-hidden /></span>;
  if (level === 'ORANGE') return <SignalHigh className={cls} style={{ color }} aria-hidden />;
  if (level === 'AMBER') return <SignalMedium className={cls} style={{ color }} aria-hidden />;
  return <SignalLow className={cls} style={{ color }} aria-hidden />;
}

export default function TopBrief({ hotspots, day, regionName, loading }: Props) {
  const alert = useMemo(() => earlyAlert(hotspots), [hotspots]);
  const line = useMemo(() => {
    if (loading) return 'Syncing live NASA FIRMS telemetry…';
    if (!hotspots) return 'Live fire telemetry unavailable — showing archive fallback.';
    const sensors = Object.values(hotspots.sensors);
    const total = sensors.reduce((a, s) => a + s.count, 0);
    const frp = sensors.reduce((a, s) => a + s.points.reduce((x, p) => x + (p.frp || 0), 0), 0);
    const maxP = sensors.flatMap((s) => s.points).reduce((m, p) => (p.frp > (m?.frp ?? 0) ? p : m), null as { frp: number } | null);
    const viirs = Object.entries(hotspots.sensors).filter(([k]) => k.startsWith('VIIRS')).reduce((a, [, s]) => a + s.count, 0);
    const modis = total - viirs;
    const src = hotspots.source === 'firms-api' ? 'FIRMS NRT' : hotspots.source === 'mixed' ? 'FIRMS+GIBS' : 'GIBS archive';
    return `${total.toLocaleString()} active fire detections across ${regionName} on ${day} (Σ ${Math.round(frp).toLocaleString()} MW · peak ${maxP ? Math.round(maxP.frp) : 0} MW · MODIS ${modis.toLocaleString()} / VIIRS ${viirs.toLocaleString()} · ${src}) — click any red dot for the full AI event card.`;
  }, [hotspots, day, regionName, loading]);

  // alert banner only for ORANGE/RED; auto-dismissable, breathes while active
  const [dismissed, setDismissed] = useState(false);
  const [flash, setFlash] = useState(false);
  const prevLevel = useRef(alert.level);
  useEffect(() => {
    if ((alert.level === 'RED' || alert.level === 'ORANGE') && prevLevel.current !== alert.level) {
      prevLevel.current = alert.level;
      const t1 = setTimeout(() => setDismissed(false), 0);
      const t2 = setTimeout(() => setFlash(true), 0);
      const t3 = setTimeout(() => setFlash(false), 2400);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
    prevLevel.current = alert.level;
  }, [alert.level]);
  const showAlert = !dismissed && (alert.level === 'RED' || alert.level === 'ORANGE');

  return (
    <div className="space-y-2">
      {showAlert && (
        <div
          role="alert"
          className={`elev-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 text-[11.5px] transition-all ${flash ? 'animate-pulse' : ''}`}
          style={{ borderColor: alert.color + '66', background: `linear-gradient(90deg, ${alert.color}18, rgba(10,20,35,0.6))` }}
        >
          <LevelIcon level={alert.level} color={alert.color} />
          <span className="rounded px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-slate-950" style={{ background: alert.color }}>
            {alert.level === 'RED' ? <ShinyText text={`EARLY ALERT · ${alert.level}`} className="text-slate-950" /> : `EARLY ALERT · ${alert.level}`}
          </span>
          <span className="flex-1 text-slate-200">{alert.headline}</span>
          <button onClick={() => setDismissed(true)} className="rounded border border-slate-600/40 px-1.5 text-slate-400 hover:text-slate-200" aria-label="dismiss alert">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      <div data-tour="summary" className="ignis-glass flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 elev-1">
        <Satellite className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
        <p className="text-[11.5px] leading-relaxed text-slate-300">
          <GradientText colors={['#F97316', '#FBBF24', '#FDE68A', '#F97316']} className="font-bold"><b>Today in brief:</b></GradientText>{' '}
          {loading || !hotspots ? (
            <span>{line}</span>
          ) : (
            <SplitText text={line} className="inline" by="word" delay={0.05} once />
          )}
        </p>
      </div>
    </div>
  );
}
