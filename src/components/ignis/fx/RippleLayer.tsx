'use client';

// Vuetify-style Material ripple — delegated at the document root.
// Any element carrying [data-ripple] (or .btn) gets the ink effect on
// pointerdown. One listener for the whole app, zero per-component wiring,
// compositor-only (transform/opacity), removed from the a11y tree.

import { useEffect } from 'react';

export default function RippleLayer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const onDown = (e: PointerEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('[data-ripple], .btn');
      if (!target) return;
      const host = target as HTMLElement;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // ripple origin = pointer position inside the host (Material spec)
      const size = Math.max(rect.width, rect.height) * 1.15;
      const ink = document.createElement('span');
      ink.className = 'ignis-ripple-ink';
      ink.setAttribute('aria-hidden', 'true');
      ink.style.width = ink.style.height = `${size}px`;
      ink.style.left = `${e.clientX - rect.left - size / 2}px`;
      ink.style.top = `${e.clientY - rect.top - size / 2}px`;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(ink);
      const cleanup = () => {
        ink.removeEventListener('animationend', cleanup);
        ink.remove();
      };
      ink.addEventListener('animationend', cleanup);
    };

    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  return null;
}
