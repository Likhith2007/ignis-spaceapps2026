'use client';

// IGNIS RegionContext — a Wikipedia-powered "what am I looking at?" placard.
// Nullschool/Zoom-Earth keep chrome minimal; IGNIS answers the natural first
// question ("what is this place and why does it burn?") with a two-line extract
// straight from Wikipedia via the keyless /api/context route. Degrades silently.

import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

type Props = { label: string; onAskAi?: (q: string) => void };

type Doc = { ok: boolean; title?: string; extract?: string; thumbnail?: string | null; url?: string };

export default function RegionContext({ label, onAskAi }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    // deferred (never sync setState in an effect body) — established IGNIS pattern
    const t = setTimeout(() => {
      setDoc(null);
      setOpen(false);
      if (!label || label.startsWith('CUSTOM')) return;
      fetch(`/api/context?q=${encodeURIComponent(label)}`)
        .then((r) => r.json())
        .then((d: Doc) => { if (alive && d?.ok) setDoc(d); })
        .catch(() => { /* context is a bonus, never an error surface */ });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [label]);

  if (!doc?.extract) return null;

  return (
    <div className="ignis-glass elev-1 rounded-xl px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Region context · Wikipedia</span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-auto rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-[#7DD3FC] hover:bg-[#0F1D31]"
        >
          {open ? 'less ▴' : 'more ▾'}
        </button>
      </div>
      <p className={`mt-1 text-[10.5px] leading-relaxed text-slate-400 ${open ? '' : 'line-clamp-2'}`}>
        <b className="text-slate-200">{doc.title}</b> — {doc.extract}{' '}
        <a href={doc.url} target="_blank" rel="noreferrer" className="text-[#38BDF8] hover:underline">read more ↗</a>
      </p>
      {open && onAskAi && (
        <button
          onClick={() => onAskAi(`Explain the fire regime of ${doc.title ?? label} — seasonal drivers, dominant fuel types, and the latest IGNIS telemetry for it.`)}
          className="mt-1.5 w-full rounded border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[10px] font-semibold text-orange-200 transition-colors hover:bg-orange-500/20"
        >
          Ask the IGNIS Analyst about this region →
        </button>
      )}
    </div>
  );
}
