'use client';

// react-bits "CountUp" — spring-eased animated number for KPI telemetry.
// Renders text (tabular-nums) so it never breaks layout; animation respects
// prefers-reduced-motion; tiny (no deps — rAF + easeOutExpo).

import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  duration?: number; // ms
  format?: (n: number) => string;
  className?: string;
};

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export default function CountUp({ value, duration = 1100, format, className }: Props) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    // deferred (never sync setState in an effect body) — established IGNIS pattern
    const t = setTimeout(() => {
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        fromRef.current = value;
        setShown(value);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const v = from + (value - from) * easeOutExpo(p);
        setShown(v);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
        else fromRef.current = value;
      };
      rafRef.current = requestAnimationFrame(tick);
    }, 0);
    return () => { clearTimeout(t); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());
  return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(shown)}</span>;
}
