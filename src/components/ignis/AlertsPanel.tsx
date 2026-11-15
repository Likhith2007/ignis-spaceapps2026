'use client';

// IGNIS AlertsPanel — v7 "Global watchtower":
//   · rule-engine EARLY WARNING on live detections (zero latency, no LLM)
//   · EONET open wildfire events ranked by on-device MiniLM semantic relevance
//   · NEW GDACS authority alerts (EC/JRC — GREEN/ORANGE/RED, filtered to AOI)
//   · NEW ReliefWeb wildfire disaster reports (UN on-the-ground reporting)
// All feeds keyless; failures degrade silently to the core rule engine.

import { useEffect, useState } from 'react';
import { AlertOctagon, Newspaper, Radar, RefreshCw, Siren } from 'lucide-react';
import type { EonetRanked, HotspotsResult } from '@/lib/ignis/types';
import AnimatedList from './fx/AnimatedList';

type Props = { hotspots: HotspotsResult | null; eonet: { ranked: EonetRanked[]; model?: string } | null; loading: boolean; regionKey: string };
// hotspots retained in the signature (call-site stability); the rule engine + GDACS/ReliefWeb drives this panel

export type AlertLevel = { level: 'GREEN' | 'AMBER' | 'ORANGE' | 'RED'; reason: string; color: string };

type GdacsItem = { eventId: string; title: string; alertLevel: string; country: string; url: string; lat: number; lon: number };
type ReliefItem = { id: string; name: string; url: string; dateEvent: string | null; disasterType: string; country: string; fire: boolean };

const ALERT_COLOR: Record<string, string> = { RED: '#EF4444', ORANGE: '#F97316', GREEN: '#22C55E' };

export function computeAlert(hotspots: HotspotsResult | null): AlertLevel {
  if (!hotspots) return { level: 'GREEN', reason: 'no data', color: '#22C55E' };
  const counts = Object.values(hotspots.sensors).map((s) => s.count);
  const total = counts.reduce((a, b) => a + b, 0);
  const frp = Object.values(hotspots.sensors).reduce((a, s) => a + s.points.reduce((x, p) => x + (p.frp || 0), 0), 0);
  if (total >= 150 || frp >= 2500) return { level: 'RED', reason: `${total} detections · ${Math.round(frp)} MW FRP — significant fire activity in AOI`, color: '#EF4444' };
  if (total >= 60 || frp >= 1200) return { level: 'ORANGE', reason: `${total} detections · ${Math.round(frp)} MW FRP — elevated activity`, color: '#F97316' };
  if (total >= 20) return { level: 'AMBER', reason: `${total} detections — scattered activity`, color: '#FACC15' };
  return { level: 'GREEN', reason: `${total} detections — low activity`, color: '#22C55E' };
}

export default function AlertsPanel({ hotspots, eonet, loading, regionKey }: Props) {
  const alert = computeAlert(hotspots);
  const [gdacs, setGdacs] = useState<GdacsItem[] | null>(null);
  const [relief, setRelief] = useState<ReliefItem[] | null>(null);
  const [reliefScope, setReliefScope] = useState<'fire' | 'context'>('fire');
  const [feedsBusy, setFeedsBusy] = useState(true);
  const [feedErr, setFeedErr] = useState<string | null>(null);

  const loadFeeds = () => {
    setFeedsBusy(true);
    setFeedErr(null);
    fetch('/api/gdacs')
      .then((r) => r.json())
      .then((d) => setGdacs(d?.items ?? []))
      .catch(() => setGdacs([]));
    fetch(`/api/reliefweb?region=${regionKey}&limit=5`)
      .then((r) => r.json())
      .then((d) => {
        setRelief(d?.items ?? []);
        setReliefScope(d?.scope === 'context' ? 'context' : 'fire');
      })
      .catch(() => setRelief([]));
    setTimeout(() => setFeedsBusy(false), 1500);
  };

  useEffect(() => {
    const t = setTimeout(loadFeeds, 0); // deferred — no sync setState in effect body
    return () => clearTimeout(t);
  }, [regionKey]);

  return (
    <div className="ignis-glass elev-2 rounded-xl p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-100">
        <Siren className="h-4 w-4 text-rose-300" aria-hidden /> EARLY WARNING &amp; EVENT TRIAGE
      </h3>
      <div className="mt-2 flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: alert.color + '55', background: alert.color + '10' }}>
        <span className="rounded px-2 py-0.5 text-xs font-bold text-slate-950" style={{ background: alert.color }}>{alert.level}</span>
        <span className="text-[11px] text-slate-300">{alert.reason} · rule-engine on live detections (no LLM required)</span>
      </div>

      {/* GDACS authority alerts */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
            <AlertOctagon className="h-3.5 w-3.5 text-orange-300" aria-hidden /> GDACS AUTHORITY ALERTS
            <span className="rounded bg-[#13253D] px-1.5 text-[8.5px] font-normal text-slate-400">EC / JRC + UN</span>
          </div>
          <button onClick={loadFeeds} title="Refresh authority feeds" className="rounded p-1 text-slate-500 hover:text-slate-200" aria-label="refresh feeds">
            <RefreshCw className={`h-3 w-3 ${feedsBusy ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
        <div className="mt-1 max-h-28 space-y-1 overflow-y-auto pr-1">
          {gdacs === null && <div className="text-[10.5px] text-slate-500">Querying GDACS global wildfire feed…</div>}
          {gdacs?.length === 0 && <div className="text-[10.5px] text-slate-500">No active GDACS wildfire alerts right now.</div>}
          <AnimatedList
            refreshKey={`${regionKey}-${feedsBusy}`}
            items={(gdacs ?? []).slice(0, 5).map((g) => (
              <a key={g.eventId} href={g.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 rounded bg-[#060D1A] px-2 py-1.5 text-[10.5px] transition-colors hover:bg-[#0C1A2E]">
                <span className="w-1.5 shrink-0 self-stretch rounded" style={{ background: ALERT_COLOR[g.alertLevel] ?? '#22C55E' }} aria-hidden />
                <span className="flex-1 truncate text-slate-200">{g.title}</span>
                <span className="shrink-0 rounded bg-[#13253D] px-1.5 text-[9px] text-slate-400">{g.alertLevel}{g.country ? ` · ${g.country}` : ''}</span>
              </a>
            ))}
          />
        </div>
      </div>

      {/* ReliefWeb on-the-ground reports */}
      <div className="mt-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
          <Newspaper className="h-3.5 w-3.5 text-sky-300" aria-hidden /> RELIEFWEB DISASTER REPORTS
          <span className="rounded bg-[#13253D] px-1.5 text-[8.5px] font-normal text-slate-400">UN OCHA</span>
          {reliefScope === 'context' && <span className="rounded bg-[#13253D] px-1.5 text-[8.5px] font-normal text-amber-300" title="No active wildfire disaster reports in the current feed — showing the latest reported disasters as context">context</span>}
        </div>
        <div className="mt-1 max-h-28 space-y-1 overflow-y-auto pr-1">
          {relief === null && <div className="text-[10.5px] text-slate-500">Fetching official wildfire disaster reports…</div>}
          {relief?.length === 0 && <div className="text-[10.5px] text-slate-500">No recent ReliefWeb reports available.</div>}
          <AnimatedList
            refreshKey={`${regionKey}-${feedsBusy}`}
            items={(relief ?? []).slice(0, 5).map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noreferrer"
                className="block rounded bg-[#060D1A] px-2 py-1.5 text-[10.5px] transition-colors hover:bg-[#0C1A2E]">
                <div className="truncate text-slate-200">{r.name}</div>
                <div className="text-[9px] text-slate-500">{r.dateEvent?.slice(0, 10)}{r.country ? ` · ${r.country}` : ''}{r.fire ? ' · wildfire' : ''}</div>
              </a>
            ))}
          />
        </div>
      </div>

      {/* EONET (semantic-ranked) — kept from v6 */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
            <Radar className="h-3.5 w-3.5 text-cyan-300" aria-hidden /> OPEN WILDFIRE EVENTS (EONET v3) — RANKED
          </div>
          {eonet?.model && <div className="text-[9px] text-slate-500">{eonet.model}</div>}
        </div>
        {loading && <div className="mt-2 text-[11px] text-slate-500">Fetching events + computing semantic relevance…</div>}
        <div className="mt-1 max-h-56 space-y-1 overflow-y-auto pr-1">
          <AnimatedList
            refreshKey={`${regionKey}-${(eonet?.ranked || []).length}`}
            items={(eonet?.ranked || []).map((ev) => (
              <a key={ev.id} href={ev.link} target="_blank" rel="noreferrer"
                className="block rounded bg-[#060D1A] px-2 py-1.5 text-[11px] transition-colors hover:bg-[#0C1A2E]">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-200">{ev.title}</span>
                  <span className="shrink-0 rounded bg-cyan-950/60 px-1.5 text-[9px] text-cyan-300">rel {ev.relevance.toFixed(2)}</span>
                </div>
                <div className="text-[9px] text-slate-500">{ev.date?.slice(0, 10)}{ev.lat !== null ? ` · ${ev.lat.toFixed(1)}°, ${ev.lon!.toFixed(1)}°` : ''}{ev.semanticScore !== null ? ` · semantic ${ev.semanticScore.toFixed(2)}` : ''}</div>
              </a>
            ))}
          />
          {!loading && (eonet?.ranked?.length || 0) === 0 && <div className="text-[11px] text-slate-500">No open wildfire events right now.</div>}
        </div>
        {feedErr && <div className="mt-1 text-[9px] text-slate-600">{feedErr}</div>}
      </div>
    </div>
  );
}
