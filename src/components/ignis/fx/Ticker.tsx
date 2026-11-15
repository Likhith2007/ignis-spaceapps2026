'use client';

// react-bits "Marquee"-style TICKER — a horizontal strip of live headlines that
// drifts continuously; pauses on hover/focus; duplicated track for a seamless
// loop; hidden from screen readers as a whole (each item is still semantic).

import { type ReactNode } from 'react';

type Props = {
  items: ReactNode[];
  speed?: number; // seconds per loop
  className?: string;
  separator?: string;
};

export default function Ticker({ items, speed = 38, className = '', separator = '·' }: Props) {
  if (!items.length) return null;
  const track = (
    <>
      {items.map((it, i) => (
        <span key={i} className="flex shrink-0 items-center gap-2 pr-6">
          {it}
          <span aria-hidden className="text-[#1E3A5F]">{separator}</span>
        </span>
      ))}
    </>
  );
  return (
    <div
      className={`group relative overflow-hidden ${className}`}
      role="marquee"
      aria-label="live headlines"
      style={{ ['--ticker-speed' as string]: `${speed}s` }}
    >
      <div className="flex w-max animate-ignis-ticker group-hover:[animation-play-state:paused]">
        {track}
        {track}
      </div>
      <style>{`
        @keyframes ignis-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .animate-ignis-ticker { animation: ignis-ticker var(--ticker-speed) linear infinite; }
      `}</style>
    </div>
  );
}
