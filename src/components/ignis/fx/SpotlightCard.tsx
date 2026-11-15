'use client';

// react-bits "SpotlightCard" — a card whose border+interior glow follows the
// pointer (linear-gradient driven by --mx/--my custom props set on pointermove).
// Framework-free, GPU-cheap, degrades to a static border on touch devices.

import { useRef, type ReactNode, type CSSProperties, type MouseEvent } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  glow?: string; // spotlight color (rgb triplet, e.g. "249,115,22")
  style?: CSSProperties;
};

export default function SpotlightCard({ children, className = '', glow = '249,115,22', style }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`ignis-spot relative overflow-hidden rounded-xl border border-[#14273F] bg-[#0A1423]/70 ${className}`}
      style={{ ['--spot' as string]: glow, ...style }}
    >
      {/* border-follow layer */}
      <div aria-hidden className="ignis-spot-border" />
      {/* interior wash layer */}
      <div aria-hidden className="ignis-spot-wash" />
      {children}
      <style>{`
        .ignis-spot { --mx: 50%; --my: 0%; }
        .ignis-spot-border {
          position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
          background: radial-gradient(220px circle at var(--mx) var(--my), rgba(var(--spot), 0.55), transparent 65%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          padding: 1px; opacity: 0; transition: opacity .3s ease;
        }
        .ignis-spot-wash {
          position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
          background: radial-gradient(340px circle at var(--mx) var(--my), rgba(var(--spot), 0.07), transparent 60%);
          opacity: 0; transition: opacity .3s ease;
        }
        .ignis-spot:hover .ignis-spot-border, .ignis-spot:hover .ignis-spot-wash { opacity: 1; }
      `}</style>
    </div>
  );
}
