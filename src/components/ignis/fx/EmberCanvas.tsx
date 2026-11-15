'use client';

// react-bits "Particles"-style background, themed as drifting EMBERS —
// a fixed canvas of slow-rising fire sparks with additive blending.
// Canvas 2D only (no WebGL, safe alongside the map), pauses when the tab is
// hidden, density adapts to viewport area, honors prefers-reduced-motion,
// and caps DPR at 1.5 for battery friendliness.

import { useEffect, useRef } from 'react';

type Particle = { x: number; y: number; r: number; vx: number; vy: number; a: number; hue: number; life: number };

export default function EmberCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0, H = 0, raf = 0, dpr = 1;
    const parts: Particle[] = [];

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(90, Math.round((W * H) / 26000));
      while (parts.length < target) parts.push(spawn(true));
      parts.length = Math.min(parts.length, target);
    };

    const spawn = (anywhere = false): Particle => ({
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 8,
      r: 0.6 + Math.random() * 1.7,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -(0.12 + Math.random() * 0.42),
      a: 0.14 + Math.random() * 0.4,
      hue: 14 + Math.random() * 30, // ember orange → amber
      life: 0.4 + Math.random() * 0.6,
    });

    let running = true;
    const frame = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx + Math.sin((p.y + p.hue * 7) / 90) * 0.09; // gentle sway
        p.y += p.vy;
        const fadeIn = Math.min(1, (p.life * 40 - (H - p.y) / 40) / 8 + 0.4);
        const alpha = p.a * Math.max(0, Math.min(1, fadeIn));
        if (p.y < -10 || alpha <= 0.001) { parts[i] = spawn(); continue; }
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2);
        grad.addColorStop(0, `hsla(${p.hue}, 95%, 62%, ${alpha})`);
        grad.addColorStop(0.55, `hsla(${p.hue - 6}, 90%, 45%, ${alpha * 0.35})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };

    resize();
    frame();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const onVis = () => {
      running = !document.hidden;
      if (running) { cancelAnimationFrame(raf); frame(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none ${className}`} />;
}
