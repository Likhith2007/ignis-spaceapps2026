'use client';

// IGNIS WindCanvas — the earth.nullschool signature: live wind streamlines
// drifting over the map. Renderer-agnostic: the parent supplies projectors for
// MapLibre GL or Leaflet, this component owns the grid fetch (Open-Meteo,
// keyless) + the Canvas2D particle loop + its own one-line readout chip.
// Transparent overlay — pointer-events pass through to the map.

import { useEffect, useRef, useState } from 'react';
import { fetchWindGrid, runParticles, windReadout, type Projector, type WindGrid } from '@/lib/ignis/wind';

type Props = {
  enabled: boolean;
  bbox: number[];
  /** live projector accessors — read at animation time, never captured stale */
  getProjector: () => Projector | null;
};

export default function WindCanvas({ enabled, bbox, getProjector }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projRef = useRef(getProjector);
  const [grid, setGrid] = useState<WindGrid | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'live' | 'fail'>('idle');

  useEffect(() => { projRef.current = getProjector; }, [getProjector]);

  const bboxKey = bbox.join(',');

  // grid fetch — keyed by AOI, cached 30 min inside wind.ts
  // (setState deferred to a timeout — established IGNIS effect pattern)
  useEffect(() => {
    if (!enabled) {
      const t0 = setTimeout(() => { setState('idle'); setGrid(null); }, 0);
      return () => clearTimeout(t0);
    }
    let alive = true;
    const t = setTimeout(() => {
      setState((s) => (s === 'live' ? s : 'loading'));
      fetchWindGrid(bbox).then((g) => {
        if (!alive) return;
        setGrid(g);
        setState(g ? 'live' : 'fail');
      });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [enabled, bboxKey, bbox]);

  // particle loop
  useEffect(() => {
    if (!enabled || !canvasRef.current) return;
    let stop: (() => void) | null = null;
    const t = setTimeout(() => {
      const proj = projRef.current();
      if (!proj || !canvasRef.current) return;
      stop = runParticles({ canvas: canvasRef.current, grid, proj, maxParticles: 850 });
    }, 60);
    return () => { clearTimeout(t); stop?.(); };
  }, [enabled, grid]);

  // dim streamlines while a popup is open (both renderers dispatch this) —
  // keeps event-card text crisp over the animation
  useEffect(() => {
    const dim = () => { if (canvasRef.current) canvasRef.current.style.opacity = '0.14'; };
    const restore = () => { if (canvasRef.current) canvasRef.current.style.opacity = '1'; };
    window.addEventListener('ignis-popup-open', dim);
    window.addEventListener('ignis-popup-close', restore);
    return () => {
      window.removeEventListener('ignis-popup-open', dim);
      window.removeEventListener('ignis-popup-close', restore);
    };
  }, []);

  if (!enabled) return null;

  const centerReadout = grid ? windReadout(grid, (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2) : null;

  return (
    <>
      <canvas
        ref={canvasRef}
        data-ignis-wind=""
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
        aria-hidden
      />
      {grid && (
        <div className="ignis-probe pointer-events-none absolute bottom-9 right-3 z-[6] rounded border border-[#14273F] bg-[#050A14]/80 px-2 py-0.5 backdrop-blur">
          <span className="text-[#7DD3FC]">🌬 {centerReadout}</span>
          <span className="text-slate-500"> · AOI mean {grid.meanMs.toFixed(1)} m/s · Open-Meteo live</span>
        </div>
      )}
      {state === 'loading' && (
        <div className="ignis-probe pointer-events-none absolute bottom-9 right-3 z-[6] rounded border border-[#14273F] bg-[#050A14]/80 px-2 py-0.5 backdrop-blur">
          <span className="text-slate-500">🌬 wind field…</span>
        </div>
      )}
      {state === 'fail' && (
        <div className="ignis-probe pointer-events-none absolute bottom-9 right-3 z-[6] rounded border border-[#14273F] bg-[#050A14]/80 px-2 py-0.5 backdrop-blur">
          <span className="text-slate-600">🌬 wind unavailable</span>
        </div>
      )}
    </>
  );
}
