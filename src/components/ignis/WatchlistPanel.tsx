'use client';

// IGNIS Watchlist — PERSONAL FIRE ALERTS (feature: users save a location —
// home / farm / village — and get alerted when fire approaches).
// · Saved places live in localStorage (name, lat, lon, radius km, channels)
// · Distance check runs against the LIVE detections already loaded for the AOI
//   (and auto-rechecks every 5 min while the tab is open)
// · Channels: in-app 🔔 + Browser Notification API + optional e-mail via the
//   keyless FormSubmit relay (first delivery requires the one-time activation
//   e-mail FormSubmit sends — documented in the UI)
// · Zero server state, zero credentials — privacy-first by design.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HotspotsResult } from '@/lib/ignis/types';
import { threatBadge } from '@/lib/ignis/hotspotAI';

type Place = { id: string; name: string; lat: number; lon: number; radiusKm: number; email?: string; notify?: boolean; createdAt: number };
type Hit = { place: Place; distKm: number; frp: number; night: boolean; sensor: string; at: string };

const LS_KEY = 'ignis:watchlist';

function load(): Place[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Place[]; } catch { return []; }
}
function save(list: Place[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function sendWatchAlertEmail(place: Place, hit: Hit): Promise<{ ok: boolean; error?: string }> {
  // keyless relay — FormSubmit AJAX endpoint; requires one-time activation per
  // inbox (the very first alert e-mail asks the owner to activate). No API key
  // is stored anywhere; the inbox owner is the only recipient.
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(place.email ?? '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `🔥 IGNIS fire alert — fire ${hit.distKm.toFixed(1)} km from ${place.name}`,
        _template: 'box',
        Place: place.name,
        Coordinates: `${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`,
        'Watch radius': `${place.radiusKm} km`,
        'Nearest detection': `${hit.distKm.toFixed(1)} km · FRP ${hit.frp.toFixed(1)} MW · ${hit.sensor}${hit.night ? ' · night overpass' : ''}`,
        Detected: hit.at,
        Note: 'Live NASA FIRMS NRT telemetry via IGNIS (NASA Space Apps 2026). Open the dashboard and set your AOI near this location to monitor.',
      }),
    });
    const j = (await res.json()) as { success?: string | boolean; message?: string };
    return { ok: res.ok && j.success !== 'false', error: j.success === 'false' ? j.message : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'mail relay failed' };
  }
}

export default function WatchlistPanel({ hotspots, regionName, onFly }: { hotspots: HotspotsResult | null; regionName: string; onFly?: (lat: number, lon: number) => void }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radiusKm, setRadiusKm] = useState(25);
  const [email, setEmail] = useState('');
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [notifState, setNotifState] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    // deferred — react-hooks/set-state-in-effect (localStorage read + permission probe)
    const t = setTimeout(() => {
      setPlaces(load());
      setNotifState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const evaluate = useCallback((list: Place[], hs: HotspotsResult | null): Hit[] => {
    if (!hs || !list.length) return [];
    const pts = Object.values(hs.sensors).flatMap((s) => s.points.map((p) => ({ frp: p.frp || 0, night: p.night, sensor: s.source ?? 'FIRMS', lat: p.lat, lon: p.lon, acq: p.acq ?? '' })));
    const out: Hit[] = [];
    for (const place of list) {
      let best: Hit | null = null;
      for (const p of pts) {
        const d = haversineKm(place.lat, place.lon, p.lat, p.lon);
        if (d <= place.radiusKm && (!best || d < best.distKm)) {
          best = { place, distKm: d, frp: p.frp, night: p.night, sensor: p.sensor, at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
        }
      }
      if (best) out.push(best);
    }
    return out.sort((a, b) => a.distKm - b.distKm);
  }, []);

  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => {
      const h = evaluate(places, hotspots);
      setHits(h);
      if (!h.length) return;
      // browser notification for NEW hits only
      for (const hit of h) {
        const key = `${hit.place.id}|${hit.at}|${hit.distKm.toFixed(1)}`;
        if (notifiedRef.current.has(key)) continue;
        notifiedRef.current.add(key);
        if (hit.place.notify !== false && notifState === 'granted' && typeof Notification !== 'undefined') {
          try {
            const bt = threatBadge(hit.frp, 80, hit.night);
            new Notification(`🔥 IGNIS — fire ${hit.distKm.toFixed(1)} km from ${hit.place.name}`, {
              body: `FRP ${hit.frp.toFixed(1)} MW · ${hit.sensor}${hit.night ? ' · night' : ''} · threat ${bt.label}. Watch radius ${hit.place.radiusKm} km.`,
              tag: key,
            });
          } catch { /* notification failed silently */ }
        }
        if (hit.place.email && hit.place.notify !== false) {
          void sendWatchAlertEmail(hit.place, hit).then((r) => {
            setMailStatus(r.ok ? `e-mail alert queued for ${hit.place.name}` : `e-mail relay: ${r.error ?? 'needs activation — check the inbox for the FormSubmit confirmation'}`);
          });
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [places, hotspots, evaluate, notifState]);

  // recheck every 5 min while open (fresh hits re-notify)
  useEffect(() => {
    const t = setInterval(() => setHits((prev) => evaluate(places, hotspots)), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [places, hotspots, evaluate]);

  const add = useCallback(() => {
    const la = parseFloat(lat), lo = parseFloat(lon);
    if (!name.trim() || !isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return;
    const place: Place = { id: `w${Date.now().toString(36)}`, name: name.trim().slice(0, 48), lat: la, lon: lo, radiusKm: Math.max(1, Math.min(300, radiusKm)), email: email.trim() || undefined, notify: true, createdAt: Date.now() };
    const next = [...places, place];
    setPlaces(next); save(next);
    setName(''); setLat(''); setLon(''); setEmail('');
  }, [name, lat, lon, radiusKm, email, places]);

  const remove = useCallback((id: string) => {
    const next = places.filter((p) => p.id !== id);
    setPlaces(next); save(next);
  }, [places]);

  const useAoiCenter = useMemo(() => {
    if (!hotspots) return null;
    const pts = Object.values(hotspots.sensors).flatMap((s) => s.points);
    if (!pts.length) return null;
    const la = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const lo = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
    return { lat: la.toFixed(3), lon: lo.toFixed(3) };
  }, [hotspots]);

  const askNotify = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifState(p);
  }, []);

  return (
    <div className="rounded-xl border border-[#14273F] bg-[#0A1423]/70 p-4" data-tour="watchlist">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-slate-100">🔔 PERSONAL FIRE ALERTS</h3>
        {notifState !== 'unsupported' && notifState !== 'granted' && (
          <button onClick={askNotify} className="rounded-full border border-[#38BDF8]/50 px-2 py-0.5 text-[9.5px] text-[#7DD3FC] hover:bg-[#38BDF8]/10">enable browser alerts</button>
        )}
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
        Save home, farm or village — IGNIS watches live FIRMS detections against your radius and alerts you in-app, via browser notification, and optionally by e-mail. Stored only on this device.
      </p>

      {hits.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {hits.map((h) => {
            const t = threatBadge(h.frp, 80, h.night);
            return (
              <div key={h.place.id + h.at} className="flex flex-wrap items-center gap-x-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}>
                <span className="rounded px-1.5 py-0.5 text-[9px] font-extrabold text-slate-950" style={{ background: t.fg }}>{t.label}</span>
                <span className="text-[11px] font-bold text-slate-100">{h.place.name}</span>
                <span className="text-[10.5px] text-slate-300">fire {h.distKm.toFixed(1)} km away · FRP {h.frp.toFixed(1)} MW · {h.sensor}{h.night ? ' · night' : ''}</span>
                {onFly && <button onClick={() => onFly(h.place.lat, h.place.lon)} className="ml-auto text-[10px] text-[#7DD3FC] hover:underline">locate ↗</button>}
              </div>
            );
          })}
          {mailStatus && <div className="text-[10px] text-slate-500">✉ {mailStatus}</div>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Place name (home, farm…)"
          className="col-span-2 rounded border border-[#1E3A5F] bg-[#060D1A] px-2 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#38BDF8]" />
        <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat (-90…90)" inputMode="decimal"
          className="rounded border border-[#1E3A5F] bg-[#060D1A] px-2 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#38BDF8]" />
        <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="lon (-180…180)" inputMode="decimal"
          className="rounded border border-[#1E3A5F] bg-[#060D1A] px-2 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#38BDF8]" />
        <label className="col-span-2 flex items-center gap-2 text-[10.5px] text-slate-400">
          radius
          <input type="range" min={1} max={100} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="flex-1 accent-orange-500" />
          <b className="w-12 text-right text-slate-200">{radiusKm} km</b>
        </label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail for alerts (optional)"
          className="col-span-2 rounded border border-[#1E3A5F] bg-[#060D1A] px-2 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#38BDF8]" />
        <button onClick={add} className="col-span-2 rounded bg-gradient-to-r from-orange-500 to-amber-400 py-1.5 text-[11px] font-extrabold text-slate-950 transition-transform hover:scale-[1.01]">＋ Watch this place</button>
        {useAoiCenter && (
          <button onClick={() => { setLat(useAoiCenter.lat); setLon(useAoiCenter.lon); }} className="col-span-2 text-[10px] text-slate-500 hover:text-slate-300">
            ⌖ pre-fill with {regionName} activity center ({useAoiCenter.lat}, {useAoiCenter.lon})
          </button>
        )}
      </div>

      {places.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {places.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded bg-[#060D1A] px-2 py-1.5 text-[10.5px]">
              <span className="text-slate-200">📍 <b>{p.name}</b></span>
              <span className="text-slate-500">{p.lat.toFixed(2)}, {p.lon.toFixed(2)} · r={p.radiusKm} km{p.email ? ' · ✉' : ''}</span>
              <button onClick={() => remove(p.id)} className="ml-auto text-slate-600 hover:text-red-400" aria-label={`remove ${p.name}`}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
