'use client';

// IGNIS Guided Tour — first-time visitor walkthrough (feature: guided tour).
// Highlights the core workflow in 6 steps; advances on click/keys; remembers
// completion in localStorage ("ignis:tour-done"); re-runnable from the header (◈ Tour).

import { useCallback, useEffect, useRef, useState } from 'react';

const TOUR_KEY = 'ignis:tour-done';

type Step = { sel: string; title: string; body: string };

const STEPS: Step[] = [
  { sel: '[data-tour="regions"]', title: '1 · Choose your region', body: 'Nine curated AOIs (or search ANY place on Earth, or ⌖ pick a custom box on the map). Every panel follows your selection.' },
  { sel: '[data-tour="summary"]', title: '2 · One-line live brief', body: 'A plain-language summary of what is burning right now — detections, FRP, sensor split — plus the EARLY ALERT banner when activity escalates.' },
  { sel: '[data-tour="map"]', title: '3 · The living fire map', body: 'Every red dot is a real satellite detection. Click any dot → full AI event card (details, fire type, 6h spread forecast, smoke & air, CO2e). 🗺 switches layers, 🧊/⛰ open 3D, ⛶ goes fullscreen.' },
  { sel: '[data-tour="rail"]', title: '4 · Early warning rail', body: 'Live threat level, ranked EONET wildfire events, 7-day fire-weather outlook and per-sensor telemetry — the operational picture at a glance.' },
  { sel: '[data-tour="tabs"]', title: '5 · Deep analytics', body: '26-year burning calendar, cluster lab, time-series, seasonal outlook, burn regime, methodology and the Open Science model hub.' },
  { sel: '[data-tour="ai"]', title: '6 · IGNIS AI Analyst', body: 'Ask anything about the current AOI — grounded strictly in live telemetry, with a deterministic fallback so it never dead-ends. You are ready — explore! 🔥' },
];

export function tourDone(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return true; }
}

export function markTourDone(): void {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* private mode */ }
}

export default function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; w: number; h: number } | null>(null);
  const rafRef = useRef(0);

  const measure = useCallback(() => {
    if (!open) return;
    const step = STEPS[idx];
    const el = document.querySelector(step.sel) as HTMLElement | null;
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, w: r.width, h: r.height });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx, open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(measure, 60);
    const onResize = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  }, [measure, open]);

  const finish = useCallback(() => { markTourDone(); onClose(); }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') setIdx((i) => Math.min(STEPS.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  useEffect(() => { if (open) { const t = setTimeout(() => setIdx(0), 0); return () => clearTimeout(t); } }, [open]);
  if (!open) return null;

  const step = STEPS[idx];
  // spotlight: 4 shaded rectangles around the target + a floating card near it
  const b = box;
  const pad = 8;
  const cardBelow = b ? b.top + b.h + 180 < window.innerHeight : true;
  const cardTop = b ? (cardBelow ? b.top + b.h + 12 : Math.max(64, b.top - 178)) : window.innerHeight * 0.32;
  const cardLeft = b ? Math.min(Math.max(16, b.left), Math.max(16, window.innerWidth - 336)) : window.innerWidth / 2 - 160;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-label="IGNIS guided tour">
      {/* click-through dimmer: 4 shades around the spotlight */}
      {b ? (
        <>
          <div className="absolute left-0 right-0 top-0 bg-black/72" style={{ height: Math.max(0, b.top - pad) }} />
          <div className="absolute left-0 bg-black/72" style={{ top: b.top - pad, height: b.h + pad * 2, width: Math.max(0, b.left - pad) }} />
          <div className="absolute bg-black/72" style={{ top: b.top - pad, height: b.h + pad * 2, left: b.left + b.w + pad, right: 0 }} />
          <div className="absolute left-0 right-0 bottom-0 bg-black/72" style={{ top: b.top + b.h + pad }} />
          <div className="pointer-events-none absolute rounded-lg border-2 border-[#38BDF8] shadow-[0_0_0_4px_rgba(56,189,248,0.25)]" style={{ top: b.top - pad, left: b.left - pad, width: b.w + pad * 2, height: b.h + pad * 2 }} />
        </>
      ) : <div className="absolute inset-0 bg-black/72" />}

      {/* card */}
      <div className="absolute w-[320px] rounded-xl border border-[#1E3A5F] bg-[#0A1423] p-4 shadow-2xl" style={{ top: cardTop, left: cardLeft }}>
        <div className="flex items-center justify-between">
          <span className="rounded bg-gradient-to-r from-orange-500 to-amber-400 px-2 py-0.5 text-[9.5px] font-extrabold tracking-widest text-slate-950">IGNIS TOUR</span>
          <span className="text-[10px] text-slate-500">{idx + 1} / {STEPS.length}</span>
        </div>
        <h3 className="mt-2 text-[13px] font-bold text-slate-100">{step.title}</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-slate-300">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
            className="rounded border border-[#1E3A5F] px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40">← Back</button>
          {idx < STEPS.length - 1 ? (
            <button onClick={() => setIdx((i) => i + 1)}
              className="flex-1 rounded bg-gradient-to-r from-orange-500 to-amber-400 px-3 py-1 text-[11px] font-bold text-slate-950">Next →</button>
          ) : (
            <button onClick={finish}
              className="flex-1 rounded bg-gradient-to-r from-orange-500 to-amber-400 px-3 py-1 text-[11px] font-bold text-slate-950">Start exploring 🔥</button>
          )}
          <button onClick={finish} className="text-[10.5px] text-slate-500 hover:text-slate-300">Skip</button>
        </div>
        <div className="mt-2 flex gap-1">
          {STEPS.map((_, i) => <span key={i} className={`h-1 flex-1 rounded ${i <= idx ? 'bg-[#38BDF8]' : 'bg-[#1E3A5F]'}`} />)}
        </div>
      </div>
    </div>
  );
}
