'use client';

// IGNIS GPU-free INTERACTIVE map — Leaflet (DOM/canvas) renderer.
//
// MapLibre GL v6 is WebGL2-only; on browsers where the GPU/WebGL2 context is
// unavailable (Brave "Strict" fingerprinting shields, VMs, headless runners,
// hardware acceleration off) `new maplibregl.Map()` throws GPUInitializationError.
// MapPanel probes WebGL2 up-front and mounts THIS component as the interactive
// fallback instead of a dead static picture:
//   · NASA GIBS raster basemaps/overlays via plain <img> XYZ tile requests
//     (EPSG:3857 GoogleMapsCompatible WMTS) — zero WebGL anywhere
//   · canvas vector rendering (preferCanvas) keeps 25k+ hotspots smooth
//   · same style modes, sensor filters, hexbin, segmentation, ML forecast,
//     EONET events, GIBS fire-pixel cross-check, popups + Ask-IGNIS-AI, and
//     AOI picking (click / shift-drag) as the MapLibre view
// Leaflet is loaded through a dynamic import inside the mount effect so the
// module (which touches `window` at import time) is never evaluated during SSR.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import type { HotspotsResult, EonetRanked } from '@/lib/ignis/types';
import { SENSOR_COLORS, GIBS_BASEMAPS, GIBS_OVERLAYS, gibs3857Url } from '@/lib/ignis/regions';
import { CLASS_STYLE, type SegmentationResult } from '@/lib/ignis/segmentation';
import type { ForecastField } from '@/lib/ignis/forecast';
import { hexbin } from '@/lib/ignis/hexbin';
import { detectionPopupHTML, gibsPopupHTML, clusterPopupHTML, hexPopupHTML, wireHotspotAI, threatBadge, type ClusterCtx, type WeatherCtx } from '@/lib/ignis/hotspotAI';
import WindCanvas from './WindCanvas';
import { fetchRainFrames, rainTileUrl, type RainFrames } from '@/lib/ignis/rainviewer';
import type { Projector } from '@/lib/ignis/wind';
import type { StyleMode } from './MapPanel';

type Props = {
  bbox: number[];
  regionKey: string;
  day: string;
  displayData: HotspotsResult | null;
  visible: Record<string, boolean>;
  styleMode: StyleMode;
  basemapKey: string;
  overlays: Record<string, boolean>;
  showHex: boolean;
  showSeg: boolean;
  seg: SegmentationResult | null;
  forecast?: ForecastField | null;
  eonet: EonetRanked[];
  pickMode: boolean;
  onPick: (bbox: number[]) => void;
  onAskAi: (q: string) => void;
  flyTarget?: { lat: number; lon: number; k: number } | null;
  resizeNonce?: number; // bumped when the panel geometry changes (focus mode)
  weather?: WeatherCtx; // live Open-Meteo fire weather (upgrades spread model)
  onCursor?: (info: { lat: number; lon: number } | null) => void; // Nullschool-style probe feed
  worldPts?: number[] | null; // whole-world fire dots (lon, lat, layer index triples)
};

type FirePt = { sensor: string; frp: number; conf: number; sat: string; acq: string; night: boolean; lat: number; lon: number; type?: string; typeP?: number; spreadKm?: number; _gx?: number; _gy?: number };

// ---- shared color ramps (mirror MapPanel so both renderers look identical) ----
// v5.12 PROPER RED family — every dot reads as fire-red at any zoom
const FRP_RAMP: [number, string][] = [
  [0, '#FCA5A5'], [10, '#F87171'], [25, '#EF4444'], [60, '#DC2626'], [120, '#B91C1C'], [250, '#7F1D1D'], [500, '#450A0A'],
];
const CONF_RAMP: [number, string][] = [[0, '#475569'], [45, '#FBBF24'], [75, '#FB923C'], [90, '#F8FAFC']];

function rampColor(ramp: [number, string][], v: number): string {
  let c = ramp[0][1];
  for (const [t, col] of ramp) if (v >= t) c = col;
  return c;
}

// zoom-interpolated radii — replicate MapLibre's size curves on the Leaflet
// canvas renderer (circleMarker radius is screen-space px). v6.1 EMBER ENGINE:
// dots stay compact below ~z6 (AOI view shows structure, not a merged red
// blob), then grow to the full spread radius by z8; the pre-z6 floors keep
// every dot solidly watchable when the map is NOT zoomed in.
const zt = (z: number) => Math.min(1, Math.max(0, (z - 4.5) / 3.5));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const glowR = (frp: number, z: number) => mix(2.4 + 1.3 * Math.sqrt(frp), 8 + 6 * Math.sqrt(frp), zt(z));
// plain dots: a stronger fire is only slightly larger and never more than 4.5 px (9 px zoomed in)
const coreR = (frp: number, z: number) => mix(Math.min(4.5, 2.1 + 0.25 * Math.sqrt(frp)), Math.min(9, 3.5 + 0.5 * Math.sqrt(frp)), zt(z));
const segCoreR = (n: number, z: number) => mix(Math.min(7, 2.2 + 0.9 * Math.sqrt(n)), Math.min(12, 5 + 2.0 * Math.sqrt(n)), zt(z)); // capped so big clusters stay markers
const gibsCoreR = (z: number) => mix(1.2, 3.2, zt(z));

// v6.1 EMBER BLOOM sizing — soft CSS radial-gradient halos (divIcon) for the
// hottest detections; canvas circles cannot do per-dot soft gradients cheaply,
// so the top-N FRP points get DOM blooms and the bulk stays on canvas.
const EMBER_BLOOM_CAP = 0; // decorative glows off: plain dots only
const emberSize = (frp: number, z: number) => Math.round(mix(14 + 3.4 * Math.sqrt(frp), 22 + 5.6 * Math.sqrt(frp), zt(z)));

// low-zoom firefront blooms — 2° grid cells rendered as soft blooms so the
// world view reads as glowing fire regions instead of thousands of tiny dots
const bloomCellDeg = 2;
const BLOOM_CELL_CAP = 0; // decorative glows off
const bloomSize = (frp: number) => Math.round(34 + 2.6 * Math.sqrt(frp));

// heatmap-density approximation colors (by FRP of the point — the DOM renderer
// has no GPU density kernel, so hot pixels bloom in heat colors instead)
function heatColor(frp: number): string {
  if (frp < 10) return '#0891B2';
  if (frp < 40) return '#FDE047';
  if (frp < 120) return '#F97316';
  if (frp < 250) return '#DC2626';
  return '#FECACA';
}

// ================= v8 BLAZE ENGINE — shared helpers =================
const HIT_CELL = 0.05; // spatial-index cell size (°) for hover/click hit-tests
const TAU = Math.PI * 2;

// style-mode color for a detection (module-level: shared by canvas + blooms)
function colorForPt(pt: FirePt, mode: StyleMode): string {
  if (mode === 'sensor') return SENSOR_COLORS[pt.sensor] || '#F97316';
  if (mode === 'confidence') return rampColor(CONF_RAMP, pt.conf);
  return rampColor(FRP_RAMP, pt.frp);
}

// hover one-liner (pointer devices)
const tipHTML = (pt: FirePt) =>
  `<span style="font:600 11px/1.3 ui-sans-serif;color:#FEE2E2">🔥 ${pt.frp.toFixed(0)} MW</span>` +
  `<span style="font:400 10px/1.4 ui-sans-serif;color:#CBD5E1"> · ${pt.sensor}${pt.sat ? ` ${pt.sat}` : ''} · ${Math.round(pt.conf)}%${pt.night ? ' · 🌙 night' : ''}</span>`;

// #RRGGBB → rgba() with alpha (sprite gradients)
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

type Scene = { pts: FirePt[]; zoom: number; styleMode: StyleMode };
type Sprite = { img: HTMLCanvasElement; half: number };

// One custom canvas layer paints the WHOLE fire scene — the heart of v8.
// The canvas lives in the 'ignis-fires' pane (above aggregation layers,
// pointer-transparent so clicks fall through to hex/seg):
//   · panning is free — the pane moves with the map; sprites re-project once
//   · animated zooms ride Leaflet's canonical Renderer transform
//   · GLOW pass = additive 'lighter' radial-gradient sprites (true fire optics)
//   · CORE pass = pre-rendered rim+fill+stroke sprites, hottest painted last
//   · DPR-aware (retina-crisp) · viewport culling · sprite cache
function makeFireCanvasLayer(L: typeof LeafletNS, getScene: () => Scene): LeafletNS.Layer {
  const dpr = () => Math.min(2.5, window.devicePixelRatio || 1);
  const PAD: Record<string, number> = { glow: 0.4, core: 1.2, night: 0.6, hot: 0.4 };

  const FireCanvas = L.Layer.extend({
    onAdd(map: LeafletNS.Map) {
      const self = this as unknown as Record<string, unknown>;
      self._zoom = map.getZoom();
      self._center = map.getCenter();
      self._sprites = new Map<string, Sprite>();
      const pane = map.getPane('ignis-fires') ?? map.getPanes().overlayPane;
      const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated ignis-fire-canvas', pane) as HTMLCanvasElement;
      self._canvas = canvas;
      self._ctx = canvas.getContext('2d');
      map.on('moveend viewreset resize', this._reset, this);
      map.on('zoomanim', this._onAnimZoom, this);
      this._reset();
    },
    onRemove(map: LeafletNS.Map) {
      const self = this as unknown as Record<string, unknown>;
      map.off('moveend viewreset resize', this._reset, this);
      map.off('zoomanim', this._onAnimZoom, this);
      if (self._canvas) L.DomUtil.remove(self._canvas as HTMLCanvasElement);
      self._canvas = null;
      self._ctx = null;
      (self._sprites as Map<string, Sprite> | undefined)?.clear();
    },
    _onAnimZoom(ev: { center: LeafletNS.LatLng; zoom: number }) {
      (this as unknown as { _updateTransform: (c?: LeafletNS.LatLng, z?: number) => void })._updateTransform(ev.center, ev.zoom);
    },
    // canonical Leaflet Renderer transform — keeps the canvas glued to the
    // map during animated zooms; _reset snaps it to the new view afterwards
    _updateTransform(center?: LeafletNS.LatLng, zoom?: number) {
      const self = this as unknown as { _canvas: HTMLCanvasElement; _center: LeafletNS.LatLng; _zoom: number };
      const map = this._map as LeafletNS.Map;
      const scale = map.getZoomScale(zoom ?? map.getZoom(), self._zoom ?? map.getZoom());
      const position = L.DomUtil.getPosition(self._canvas);
      const viewHalf = map.getSize().multiplyBy(0.5);
      const currentCenterPoint = map.project(self._center, self._zoom);
      const centerOffset = map.project(center ?? map.getCenter(), zoom ?? map.getZoom()).subtract(currentCenterPoint);
      const topLeftOffset = viewHalf.multiplyBy(-scale).add(position).add(viewHalf).subtract(centerOffset);
      L.DomUtil.setTransform(self._canvas, topLeftOffset, scale);
    },
    _reset() {
      const self = this as unknown as { _canvas: HTMLCanvasElement; _ctx: CanvasRenderingContext2D | null; _center: LeafletNS.LatLng; _zoom: number; _redraw: () => void };
      const map = this._map as LeafletNS.Map;
      self._center = map.getCenter();
      self._zoom = map.getZoom();
      const canvas = self._canvas;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const size = map.getSize();
      const d = dpr();
      canvas.width = Math.max(1, Math.round(size.x * d));
      canvas.height = Math.max(1, Math.round(size.y * d));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      self._redraw();
    },
    _sprite(kind: 'glow' | 'core' | 'night' | 'hot', col: string, r: number): Sprite {
      const self = this as unknown as { _sprites: Map<string, Sprite> };
      const rb = Math.max(1, Math.round(r * 2) / 2);
      const key = `${kind}|${col}|${rb}`;
      const cached = self._sprites.get(key);
      if (cached) return cached;
      const d = dpr();
      const half = rb + PAD[kind];
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.ceil(half * 2 * d));
      c.height = c.width;
      const g = c.getContext('2d')!;
      g.scale(d, d);
      const cx = half, cy = half;
      if (kind === 'glow') {
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rb);
        grad.addColorStop(0, hexA(col, 0.9));
        grad.addColorStop(0.35, hexA(col, 0.38));
        grad.addColorStop(1, hexA(col, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, half * 2, half * 2);
      } else if (kind === 'core') {
        // dark contrast rim → solid red fill → white halo stroke
        g.beginPath(); g.arc(cx, cy, rb + 0.8, 0, TAU); g.fillStyle = 'rgba(5,10,20,0.62)'; g.fill();
        g.beginPath(); g.arc(cx, cy, rb, 0, TAU); g.fillStyle = col; g.fill();
        g.lineWidth = 0.7; g.strokeStyle = 'rgba(255,255,255,0.66)'; g.stroke();
      } else if (kind === 'night') {
        // night detections: thin pale-blue outline, no filled halo
        g.beginPath(); g.arc(cx, cy, rb, 0, TAU); g.lineWidth = 1; g.strokeStyle = 'rgba(186,230,253,0.85)'; g.stroke();
      } else {
        g.beginPath(); g.arc(cx, cy, rb, 0, TAU); g.fillStyle = '#FFFFFF'; g.fill();
      }
      const spr = { img: c, half };
      self._sprites.set(key, spr);
      return spr;
    },
    _redraw() {
      const self = this as unknown as { _ctx: CanvasRenderingContext2D | null; _sprite: (k: 'glow' | 'core' | 'night' | 'hot', c: string, r: number) => Sprite };
      const map = this._map as LeafletNS.Map;
      const ctx = self._ctx;
      if (!map || !ctx) return;
      const scene = getScene();
      const size = map.getSize();
      const d = dpr();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      if (!scene || scene.zoom !== map.getZoom()) return; // stale projections — the fresh layer owns this frame
      const origin = map.getPixelOrigin();
      const b = map.getBounds().pad(0.1);
      const zoom = scene.zoom;
      const pts = scene.pts;
      const P: FirePt[] = [];
      const X: number[] = [];
      const Y: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.lat < b.getSouth() - 0.5 || p.lat > b.getNorth() + 0.5 || p.lon < b.getWest() - 0.5 || p.lon > b.getEast() + 0.5) continue;
        P.push(p); X.push(p._gx! - origin.x); Y.push(p._gy! - origin.y);
        if (P.length >= 30000) break;
      }
      const n = P.length;
      if (!n) return;
      if (scene.styleMode === 'heatmap') {
        // density heat — additive soft sprites in heat colors
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.34;
        for (let i = 0; i < n; i++) {
          const p = P[i];
          const r = glowR(p.frp, zoom) * 2.4;
          const s = self._sprite('glow', heatColor(p.frp), r);
          ctx.drawImage(s.img, X[i] - s.half, Y[i] - s.half, s.half * 2, s.half * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      // PLAIN DOTS — one small crisp mark per detection (no glow pass, no white-hot
      // centres): drawList is FRP-ascending so the strongest fires paint last, on top
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (let i = 0; i < n; i++) {
        const p = P[i];
        const col = colorForPt(p, scene.styleMode);
        const cr = coreR(p.frp, zoom);
        if (p.night) {
          const nr = cr + 1.7;
          const s = self._sprite('night', '#BAE6FD', nr);
          ctx.drawImage(s.img, X[i] - s.half, Y[i] - s.half, s.half * 2, s.half * 2);
        }
        const s2 = self._sprite('core', col, cr);
        ctx.drawImage(s2.img, X[i] - s2.half, Y[i] - s2.half, s2.half * 2, s2.half * 2);
      }
    },
  });
  return new (FireCanvas as unknown as { new (): LeafletNS.Layer })();
}

// hexbin fill interpolation — 0 → rgba(253,224,71,.25) · .4 → rgba(249,115,22,.45) · 1 → rgba(185,28,28,.65)
function hexFill(t: number): string {
  const stops: [number, [number, number, number, number]][] = [[0, [253, 224, 71, 0.25]], [0.4, [249, 115, 22, 0.45]], [1, [185, 28, 28, 0.65]]];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * u));
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3].toFixed(2)})`;
}

// forecast cell fill — #FDE047(.5) → #FB923C(.7) → #EF4444(.85) → #B91C1C(1)
function fcColor(p: number): string {
  const stops: [number, [number, number, number]][] = [[0.5, [253, 224, 71]], [0.7, [251, 146, 60]], [0.85, [239, 68, 68]], [1, [185, 28, 28]]];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (p >= stops[i][0] && p <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = b[0] === a[0] ? 0 : (p - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function fcOpacity(p: number): number {
  const stops: [number, number][] = [[0.5, 0.06], [0.7, 0.16], [0.85, 0.34], [1, 0.55]];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (p >= stops[i][0] && p <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = b[0] === a[0] ? 0 : (p - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * u;
}

export default function LeafletFireMap({ bbox, regionKey, day, displayData, visible, styleMode, basemapKey, overlays, showHex, showSeg, seg, forecast, eonet, pickMode, onPick, onAskAi, flyTarget, resizeNonce, weather, onCursor, worldPts }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const tileBarRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [zoomTick, setZoomTick] = useState(0);
  const [failed, setFailed] = useState(false);

  const onPickRef = useRef(onPick);
  const pickRef = useRef(pickMode);
  const askRef = useRef(onAskAi);
  const weatherRef = useRef<WeatherCtx | undefined>(weather);
  const cursorRef = useRef(onCursor);
  const regionRef = useRef(regionKey);
  const dayRef = useRef(day);
  useEffect(() => { onPickRef.current = onPick; pickRef.current = pickMode; askRef.current = onAskAi; weatherRef.current = weather; cursorRef.current = onCursor; regionRef.current = regionKey; dayRef.current = day; }, [onPick, pickMode, onAskAi, weather, onCursor, regionKey, day]);
  // v8 BLAZE — spatial index (rebuilt by the fire effect) powers hover/click hit-testing
  const idxRef = useRef<{ pts: FirePt[]; grid: Map<string, number[]>; zoom: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // ---- mount (dynamic import — Leaflet touches `window`, never run during SSR) ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = (await import('leaflet')) as unknown as typeof LeafletNS & { default?: typeof LeafletNS };
        const L = mod.default ?? mod;
        if (!alive || !containerRef.current) return;
        LRef.current = L;
        const m = L.map(containerRef.current, {
          center: [-60, -5],
          zoom: 3,
          minZoom: 2,
          maxZoom: 12,
          zoomControl: false,
          attributionControl: true,
          preferCanvas: true, // canvas vector renderer — no WebGL, handles 25k+ hotspots
          boxZoom: false,     // shift+drag is reserved for AOI picking
          worldCopyJump: true,
          zoomSnap: 0.5,
        });
        m.attributionControl.setPrefix('');
        L.control.zoom({ position: 'bottomright' }).addTo(m);
        L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 110 }).addTo(m);
        // wire the shared AI buttons inside every popup: "🤖 Analyze" fills the
        // popup's inline slot via /api/hotspot; "💬 Analyst" seeds the main chat.
        m.on('popupopen', (ev: LeafletNS.LeafletEvent) => {
          const popup = (ev as unknown as { popup?: LeafletNS.Popup }).popup;
          wireHotspotAI(popup?.getElement() ?? null, askRef.current);
          window.dispatchEvent(new Event('ignis-popup-open')); // dim wind streamlines
        });
        m.on('popupclose', () => window.dispatchEvent(new Event('ignis-popup-close')));
        // v8 BLAZE interaction — pane for the fire canvas (above aggregation
        // layers, pointer-transparent so clicks fall through to hex/seg) +
        // spatial hit-testing: EVERY hotspot is hoverable + clickable at any zoom
        m.createPane('ignis-fires');
        const fp = m.getPane('ignis-fires');
        if (fp) { fp.style.zIndex = '420'; fp.style.pointerEvents = 'none'; }

        const hitTest = (cp: LeafletNS.Point): FirePt | null => {
          const idx = idxRef.current;
          if (!idx || !idx.pts.length) return null;
          let coarse = false;
          try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* older browsers */ }
          const baseTol = coarse ? 18 : 11; // generous touch tolerance
          const ll = m.containerPointToLatLng(cp);
          const degPerPx = 360 / (256 * 2 ** m.getZoom());
          const tolLat = baseTol * degPerPx;
          const tolLon = tolLat / Math.max(0.25, Math.cos((ll.lat * Math.PI) / 180));
          const origin = m.getPixelOrigin();
          const y0 = Math.floor((ll.lat - tolLat) / HIT_CELL), y1 = Math.floor((ll.lat + tolLat) / HIT_CELL);
          const x0 = Math.floor((ll.lng - tolLon) / HIT_CELL), x1 = Math.floor((ll.lng + tolLon) / HIT_CELL);
          let best: FirePt | null = null;
          let bestD = Infinity;
          for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
              const cell = idx.grid.get(`${cy}:${cx}`);
              if (!cell) continue;
              for (const i of cell) {
                const p = idx.pts[i];
                const dx = (p._gx ?? 0) - origin.x - cp.x;
                const dy = (p._gy ?? 0) - origin.y - cp.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= Math.max(baseTol, coreR(p.frp, idx.zoom) + 2) && dist < bestD) { bestD = dist; best = p; }
              }
            }
          }
          return best;
        };

        let hoverRaf = 0;
        const showTip = (p: FirePt, cp: LeafletNS.Point) => {
          const el = tipRef.current;
          if (!el) return;
          el.innerHTML = tipHTML(p);
          el.style.left = `${Math.min(cp.x + 12, Math.max(8, m.getSize().x - 200))}px`;
          el.style.top = `${Math.max(cp.y - 34, 6)}px`;
          el.classList.add('on');
        };
        const hideTip = () => tipRef.current?.classList.remove('on');
        const onHover = (e: LeafletNS.LeafletMouseEvent) => {
          if (hoverRaf) return;
          const cp = e.containerPoint.clone();
          hoverRaf = requestAnimationFrame(() => {
            hoverRaf = 0;
            try {
              if (pickRef.current) { hideTip(); return; }
              const hit = hitTest(cp);
              if (hit) { showTip(hit, cp); m.getContainer().style.cursor = 'pointer'; }
              else { hideTip(); m.getContainer().style.cursor = ''; }
            } catch { /* map tearing down */ }
          });
        };
        const onHoverOut = () => {
          if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = 0; }
          hideTip();
          m.getContainer().style.cursor = pickRef.current ? 'crosshair' : '';
        };
        const onFireClick = (e: LeafletNS.LeafletMouseEvent) => {
          if (pickRef.current) return; // AOI picking owns the click
          const hit = hitTest(e.containerPoint);
          if (!hit) return;
          L.popup({ maxWidth: 300, closeButton: true })
            .setLatLng([hit.lat, hit.lon])
            .setContent(
              detectionPopupHTML({ sensor: hit.sensor, sat: hit.sat, frp: hit.frp, conf: hit.conf, acq: hit.acq, night: hit.night, lat: hit.lat, lon: hit.lon, type: hit.type, typeP: hit.typeP, spreadKm: hit.spreadKm, weather: weatherRef.current }, { regionKey: regionRef.current, day: dayRef.current }),
            )
            .openOn(m);
        };
        m.on('mousemove', onHover);
        m.on('mouseout', onHoverOut);
        m.on('click', onFireClick);
        mapRef.current = m;
        // demo/support handle (mirrors __ignisMap) — lets E2E drive the GPU-free renderer
        (window as unknown as { __ignisLeaflet?: LeafletNS.Map }).__ignisLeaflet = m;
        // v6.1 chrome: live coordinate readout (direct DOM write — no React churn)
        m.on('mousemove', (ev: LeafletNS.LeafletMouseEvent) => {
          if (coordRef.current) coordRef.current.textContent = `${ev.latlng.lat.toFixed(3)}°, ${ev.latlng.lng.toFixed(3)}°`;
          cursorRef.current?.({ lat: ev.latlng.lat, lon: ev.latlng.lng });
        });
        m.on('mouseout', () => { if (coordRef.current) coordRef.current.textContent = '—'; cursorRef.current?.(null); });
        setReady(true);
      } catch (err) {
        console.warn('[ignis:leaflet] interactive DOM renderer failed to start', err);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      try { mapRef.current?.remove(); } catch { /* already gone */ }
      mapRef.current = null;
    };
  }, []);

  // re-derive marker radii when the zoom settles (canvas circles are screen-space)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const h = () => setZoomTick((t) => t + 1);
    map.on('zoomend', h);
    return () => { map.off('zoomend', h); };
  }, [ready]);

  // cursor reflects pick mode
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getContainer().style.cursor = pickMode ? 'crosshair' : '';
  }, [pickMode, ready]);

  // focus-mode (fullscreen) toggles change the container geometry after mount —
  // Leaflet caches size at init, so re-measure whenever the nonce bumps
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !resizeNonce) return;
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 60);
    return () => clearTimeout(t);
  }, [resizeNonce, ready]);

  // ---- GIBS raster basemap (plain <img> XYZ tiles — the live "map tile" layer) ----
  const basemapRef = useRef<LeafletNS.TileLayer | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    const bm = GIBS_BASEMAPS[basemapKey];
    const url = gibs3857Url(bm, day);
    if (basemapRef.current) map.removeLayer(basemapRef.current);
    const layer = L.tileLayer(url, {
      tileSize: 256,
      maxNativeZoom: bm.level, // GIBS TileMatrix level — Leaflet over-zooms beyond it
      maxZoom: 14,
      attribution: 'NASA GIBS',
      crossOrigin: true,
      updateWhenIdle: false,
    }).addTo(map);
    // v6.1 chrome: tile pipeline progress — a slim ember bar while GIBS tiles stream
    layer.on('loading', () => { if (tileBarRef.current) tileBarRef.current.style.opacity = '1'; });
    layer.on('load', () => { if (tileBarRef.current) tileBarRef.current.style.opacity = '0'; });
    basemapRef.current = layer;
    basemapRef.current.bringToBack();
  }, [basemapKey, day, ready]);

  // ---- GIBS raster overlays (coastlines / labels / LST day+night) ----
  const overlaysRef = useRef<Record<string, LeafletNS.TileLayer>>({});
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    for (const [key, cfg] of Object.entries(GIBS_OVERLAYS)) {
      const want = overlays[key];
      const opacity = key === 'labels' ? 0.9 : key.startsWith('lst') ? 0.6 : 0.75;
      const url = gibs3857Url(cfg, day);
      const cur = overlaysRef.current[key];
      if (want && !cur) {
        overlaysRef.current[key] = L.tileLayer(url, { tileSize: 256, maxNativeZoom: cfg.level, maxZoom: 14, opacity }).addTo(map);
      } else if (want && cur) {
        cur.setUrl(url);
        cur.setOpacity(opacity);
      } else if (!want && cur) {
        map.removeLayer(cur);
        delete overlaysRef.current[key];
      }
    }
  }, [overlays, day, ready]);

  // ---- v7.1 RainViewer live weather overlays (Leaflet GPU-free renderer) ----
  // Same keyless feed the GL path uses — plain XYZ tile layers, so parity is exact.
  // Frames are STATE (not a ref) so the layer effect re-runs when the fetch lands.
  const [rainFrames, setRainFrames] = useState<RainFrames | null>(null);
  const rainLayersRef = useRef<Record<string, LeafletNS.TileLayer>>({});
  useEffect(() => {
    if (!overlays.radar && !overlays.clouds) return;
    let alive = true;
    fetchRainFrames().then((f) => { if (alive) setRainFrames(f); });
    const t = setInterval(() => { fetchRainFrames().then((f) => { if (alive) setRainFrames(f); }); }, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [overlays.radar, overlays.clouds]);

  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    const kinds: Array<[string, 'radar' | 'cloud', number]> = [['rainviewer-radar', 'radar', 0.65], ['rainviewer-clouds', 'cloud', 0.45]];
    for (const [key, kind, op] of kinds) {
      const want = kind === 'radar' ? overlays.radar : overlays.clouds;
      const cur = rainLayersRef.current[key];
      const path = kind === 'radar' ? rainFrames?.radarPath : rainFrames?.cloudPath;
      if (want && path) {
        const url = rainTileUrl(path, kind);
        if (!cur) {
          rainLayersRef.current[key] = L.tileLayer(url, { tileSize: 256, maxNativeZoom: 10, maxZoom: 14, opacity: op, attribution: 'RainViewer' }).addTo(map);
          rainLayersRef.current[key].bringToBack();
        } else {
          cur.setUrl(url);
          cur.setOpacity(op);
        }
      } else if (!want && cur) {
        map.removeLayer(cur);
        delete rainLayersRef.current[key];
      }
    }
  }, [overlays.radar, overlays.clouds, rainFrames, ready]);

  // ---- AOI rectangle + auto-fit ----
  const aoiRef = useRef<LeafletNS.Rectangle | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    const [w, s, e, n] = bbox;
    const bounds = L.latLngBounds([s, w], [n, e]);
    if (aoiRef.current) aoiRef.current.setBounds(bounds);
    else {
      aoiRef.current = L.rectangle(bounds, { color: '#38BDF8', weight: 1.6, dashArray: '4 4', fillColor: '#38BDF8', fillOpacity: 0, opacity: 0, interactive: false }).addTo(map); // outline hidden
    }
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9, animate: true, duration: 0.9 });
  }, [bbox, ready]);

  // ---- EONET ranked events ----
  const eonetRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (eonetRef.current) { map.removeLayer(eonetRef.current); eonetRef.current = null; }
    if (!eonet.length || !overlays.eonet) return; // reported-wildfire rings are off unless switched on in Layers
    const g = L.layerGroup();
    for (const ev of eonet) {
      if (ev.lat === null || ev.lon === null) continue;
      L.circleMarker([ev.lat, ev.lon], { radius: 7, color: '#38BDF8', weight: 1.6, fillColor: '#38BDF8', fillOpacity: 0.12 })
        .bindPopup(
          `<div style="font:12px/1.5 ui-sans-serif"><div style="font-weight:700;color:#7DD3FC">🌐 EONET wildfire event</div><div>${ev.title}</div><div style="color:#94A3B8">${ev.date?.slice(0, 10)}</div><a href="${ev.link}" target="_blank" rel="noreferrer" style="color:#38BDF8">NASA EONET details →</a></div>`,
          { maxWidth: 260 },
        )
        .addTo(g);
    }
    g.addTo(map);
    eonetRef.current = g;
  }, [eonet, ready, overlays.eonet]);

  // ---- active fire detections — v8 BLAZE single-canvas engine ----
  // Every hotspot is painted by ONE custom canvas layer (sprite glows + crisp
  // cores) instead of ~75k per-point circleMarkers: true fire optics at 25k+
  // detections, smooth pans, and a spatial index that makes EVERY dot
  // hoverable + clickable at any zoom (popup → threat + AI verdict).
  const firesRef = useRef<LeafletNS.LayerGroup | null>(null);
  const pulsesRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (firesRef.current) { map.removeLayer(firesRef.current); firesRef.current = null; }
    if (pulsesRef.current) { map.removeLayer(pulsesRef.current); pulsesRef.current = null; }
    if (!displayData) return;

    const pts: FirePt[] = [];
    for (const [sensor, s] of Object.entries(displayData.sensors)) {
      if (!visible[sensor]) continue;
      for (const p of s.points) {
        pts.push({
          sensor,
          frp: Math.min(600, Math.max(0.5, p.frp || 0.5)),
          conf: typeof p.conf === 'number' ? p.conf : 60,
          sat: p.sat || '', acq: p.acq || '', night: !!p.night, lat: p.lat, lon: p.lon,
          type: p.type, typeP: p.typeP, spreadKm: p.spreadKm,
        });
      }
    }
    if (!pts.length) return;

    const byFrpDesc = [...pts].sort((a, b) => b.frp - a.frp);
    // draw FRP-ASCENDING so the hottest cores paint last (always on top);
    // heatmap mode caps the sprite list for fill-rate safety
    const drawList = (styleMode === 'heatmap' ? byFrpDesc.slice(0, 6000) : byFrpDesc).slice().reverse();

    const zoom = map.getZoom();
    for (const p of drawList) {
      const gp = map.project([p.lat, p.lon], zoom); // cached global px — pans are pure arithmetic
      p._gx = gp.x; p._gy = gp.y;
    }
    // uniform-grid spatial index → hover tooltip + click popup hit-testing
    const grid = new Map<string, number[]>();
    for (let i = 0; i < drawList.length; i++) {
      const p = drawList[i];
      const k = `${Math.floor(p.lat / HIT_CELL)}:${Math.floor(p.lon / HIT_CELL)}`;
      const arr = grid.get(k);
      if (arr) arr.push(i); else grid.set(k, [i]);
    }
    idxRef.current = { pts: drawList, grid, zoom };

    const scene: Scene = { pts: drawList, zoom, styleMode };
    const g = L.layerGroup();
    g.addLayer(makeFireCanvasLayer(L, () => scene));

    // spread rings — real-metre geodesic dashed circles at the modelled radius
    const spreadPts = pts.filter((p) => (p.spreadKm ?? 0) >= 1).sort((a, b) => (b.spreadKm ?? 0) - (a.spreadKm ?? 0)).slice(0, 0); // spread rings off
    for (const p of spreadPts) {
      L.circle([p.lat, p.lon], {
        radius: Math.max(600, (p.spreadKm ?? 1) * 1000),
        color: 'rgba(248,113,113,0.6)', weight: 1.1, dashArray: '3 5',
        fillColor: 'rgba(239,68,68,0.05)', fillOpacity: 1, interactive: false,
      }).addTo(g);
    }

    if (styleMode !== 'heatmap') {
      // ⑤ EMBER BLOOMS — the hottest 240 detections wear a soft CSS radial
      //    halo with a slow breathing animation (pure compositor work)
      for (const pt of byFrpDesc.slice(0, EMBER_BLOOM_CAP)) {
        const size = emberSize(pt.frp, zoom);
        L.marker([pt.lat, pt.lon], {
          icon: L.divIcon({
            className: 'ignis-ember-wrap',
            html: `<span class="ignis-ember" style="width:${size}px;height:${size}px;--ember:${colorForPt(pt, styleMode)}"></span>`,
            iconSize: [size, size],
          }),
          interactive: false, keyboard: false,
        }).addTo(g);
      }

      // ⑥ FIREFRONT BLOOMS (world view) — below z5 the strongest 2° cells glow
      //    with count badges, so the un-zoomed map shows glowing fire REGIONS
      if (zoom < 5) {
        const cells = new Map<string, { lat: number; lon: number; n: number; frp: number }>();
        for (const p of pts) {
          const k = `${Math.floor(p.lat / bloomCellDeg)}:${Math.floor(p.lon / bloomCellDeg)}`;
          const c = cells.get(k);
          if (c) { c.n += 1; c.frp += p.frp; }
          else cells.set(k, { lat: (Math.floor(p.lat / bloomCellDeg) + 0.5) * bloomCellDeg, lon: (Math.floor(p.lon / bloomCellDeg) + 0.5) * bloomCellDeg, n: 1, frp: p.frp });
        }
        const topCells = [...cells.values()].sort((a, b) => b.frp - a.frp).slice(0, BLOOM_CELL_CAP);
        for (const c of topCells) {
          const size = bloomSize(c.frp);
          const badge = c.n >= 40 ? `<b class="ignis-bloom-badge">${c.n > 999 ? `${Math.round(c.n / 100) / 10}k` : c.n}</b>` : '';
          L.marker([c.lat, c.lon], {
            icon: L.divIcon({
              className: 'ignis-ember-wrap',
              html: `<span class="ignis-bloom" style="width:${size}px;height:${size}px">${badge}</span>`,
              iconSize: [size, size],
            }),
            interactive: false, keyboard: false,
          }).addTo(g);
        }
      }

      // ⑦ EXTREME pulse halos — threat score ≥ 80 gets the CSS expanding ring
      const extreme = pts.filter((p) => threatBadge(p.frp, p.conf, p.night).score >= 80).slice(0, 0); // pulse halos off
      if (extreme.length) {
        const pg = L.layerGroup();
        for (const p of extreme) {
          L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: 'ignis-pulse-wrap', html: '<span class="ignis-pulse"></span>', iconSize: [30, 30] }),
            interactive: false, keyboard: false,
          }).addTo(pg);
        }
        pg.addTo(map);
        pulsesRef.current = pg;
      }
    }

    g.addTo(map);
    firesRef.current = g;
  }, [displayData, visible, styleMode, day, regionKey, ready, zoomTick]);



  // ---- click-priority: individual hotspots must stay clickable THROUGH
  // aggregation layers (hexbin cells / seg hulls / forecast cells). Canvas hit
  // order = draw order, so after any aggregation layer (re)renders we re-raise
  // the fire circles — clicks then hit a detection first (per-hotspot AI), and
  // fall through to the cluster/hex popup only where no detection sits.
  const bringFiresToFront = () => {
    firesRef.current?.eachLayer((l) => {
      (l as unknown as { bringToFront?: () => void }).bringToFront?.();
    });
  };

  // ---- hexbin density (same math as the GL path — shared lib) ----
  const hexRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (hexRef.current) { map.removeLayer(hexRef.current); hexRef.current = null; }
    if (!showHex || !displayData) return;
    const pts = Object.entries(displayData.sensors).flatMap(([sensor, s]) =>
      visible[sensor] ? s.points.map((p) => ({ lon: p.lon, lat: p.lat, frp: p.frp || 0 })) : [],
    );
    const { bin, maxN, features } = hexbin(pts, bbox);
    const g = L.layerGroup();
    for (const f of features) {
      L.rectangle(
        [[f.lat - bin / 2, f.lon - bin / 2], [f.lat + bin / 2, f.lon + bin / 2]],
        { color: 'rgba(251,146,60,0.35)', weight: 0.6, fillColor: hexFill(f.n / maxN), fillOpacity: 1 },
      )
        // density cells are AI-interactive too: threat badge + Analyze + Analyst
        .bindPopup(hexPopupHTML({ lat: f.lat, lon: f.lon, n: f.n, frp: f.frp, bin }, { regionKey, day }), { maxWidth: 260 })
        .addTo(g);
    }
    g.addTo(map);
    hexRef.current = g;
    bringFiresToFront();
  }, [displayData, showHex, visible, bbox, ready]);

  // ---- fire segmentation (DBSCAN hulls + class styling, shared with Fire Cluster Lab) ----
  const segRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (segRef.current) { map.removeLayer(segRef.current); segRef.current = null; }
    if (!showSeg || !seg || !seg.clusters.length) return;
    const zoom = map.getZoom();
    const g = L.layerGroup();
    for (const c of seg.clusters) {
      const st = CLASS_STYLE[c.cls];
      const ring = c.hull.map(([lon, lat]) => [lat, lon] as LeafletNS.LatLngExpression);
      const clusterCtx: ClusterCtx = {
        id: c.id, cls: c.cls, n: c.n, frpSum: c.frpSum, meanFrp: c.frpMean, spreadKm: c.spreadKm,
        areaKm2: c.areaKm2, elongation: c.elongation, nightPct: c.nightPct, sensors: Object.keys(c.sensors).join(', '),
        modelCls: c.modelCls, modelClsPct: c.modelClsPct,
        centroidLat: c.centroid[1], centroidLon: c.centroid[0],
      };
      L.polygon(ring, { color: st.stroke, weight: st.width, fillColor: st.fill, fillOpacity: 1 })
        .bindPopup(
          clusterPopupHTML(clusterCtx, { regionKey, day }),
          { maxWidth: 300 },
        )
        .addTo(g);
      L.circleMarker([c.centroid[1], c.centroid[0]], { radius: segCoreR(c.n, zoom), color: '#1C1917', weight: 1, fillColor: 'rgba(255,255,255,0.85)', fillOpacity: 0.9 }).addTo(g);
    }
    g.addTo(map);
    segRef.current = g;
    bringFiresToFront();
  }, [seg, showSeg, day, regionKey, ready, zoomTick]);

  // ---- ML next-day footprint forecast overlay ----
  const fcRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (fcRef.current) { map.removeLayer(fcRef.current); fcRef.current = null; }
    if (!forecast || !forecast.cells.length) return;
    const half = forecast.cellDeg / 2;
    const g = L.layerGroup();
    for (const c of forecast.cells) {
      L.rectangle(
        [[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]],
        { color: 'rgba(254,215,170,0.55)', weight: 0.6, fillColor: fcColor(c.p), fillOpacity: fcOpacity(c.p), interactive: false },
      ).addTo(g);
    }
    g.addTo(map);
    fcRef.current = g;
    bringFiresToFront();
  }, [forecast, ready]);

  // ---- GIBS fire pixels (independent vector cross-check of the FIRMS pipeline) ----
  const gibsRef = useRef<LeafletNS.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready) return;
    let alive = true;
    if (gibsRef.current && map) { map.removeLayer(gibsRef.current); gibsRef.current = null; }
    if (!overlays.gibsfires) return;
    const [w, s, e, n] = bbox;
    fetch(`/api/gibsfires?w=${w}&s=${s}&e=${e}&n=${n}&day=${day}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((fc: { error?: boolean; features?: { geometry: { coordinates: [number, number] }; properties?: Record<string, number | string> }[] } | null) => {
        const L = LRef.current;
        const m = mapRef.current;
        if (!alive || !L || !m || !fc || fc.error || !fc.features) return;
        const zoom = m.getZoom();
        const g = L.layerGroup();
        for (const f of fc.features) {
          const [lon, lat] = f.geometry.coordinates;
          const frp = Math.max(0.5, Number(f.properties?.frp) || 0.5);
          L.circleMarker([lat, lon], { radius: gibsCoreR(zoom) + 0.6, color: '#7F1D1D', weight: 0.5, fillColor: '#FF2A12', fillOpacity: 0.9 })
            .bindPopup(
              gibsPopupHTML({ sensor: String(f.properties?.sensor ?? 'GIBS'), frp, lat, lon }, { regionKey, day }),
              { maxWidth: 300 },
            )
            .addTo(g);
        }
        g.addTo(m);
        gibsRef.current = g;
        bringFiresToFront();
      });
    return () => { alive = false; };
  }, [overlays.gibsfires, day, bbox, ready]);

  // ---- World fire view (NASA Worldview look): one canvas, thinned to stay responsive ----
  const worldRef = useRef<LeafletNS.LayerGroup | null>(null);
  const worldOn = !!worldPts;
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (worldRef.current) { map.removeLayer(worldRef.current); worldRef.current = null; }
    if (!worldPts) return;
    const renderer = L.canvas({ padding: 0.2 });
    const g = L.layerGroup();
    const step = Math.max(1, Math.ceil(worldPts.length / 3 / 30000)); // at most ~30k dots
    for (let i = 0; i < worldPts.length; i += 3 * step) {
      L.circleMarker([worldPts[i + 1], worldPts[i]], { renderer, radius: 1.6, stroke: false, fillColor: worldPts[i + 2] >= 2 ? '#FF7A00' : '#FF1F1F', fillOpacity: 0.92, interactive: false }).addTo(g);
    }
    g.addTo(map);
    worldRef.current = g;
  }, [worldPts, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map && worldOn) map.fitBounds([[-56, -168], [72, 178]]);
  }, [worldOn, ready]);

  // ---- fly-to requests from the 3D Fire Field panel (nonce-keyed) ----
  const flyKRef = useRef<number>(-1);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !flyTarget || flyTarget.k === flyKRef.current) return;
    flyKRef.current = flyTarget.k;
    map.flyTo([flyTarget.lat, flyTarget.lon], Math.max(map.getZoom(), 7), { duration: 0.8 });
  }, [flyTarget, ready]);

  // ---- AOI pick interactions: click-to-pick + shift-drag rectangle (same UX as the GL path) ----
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!ready || !map || !L) return;

    const click = (e: LeafletNS.LeafletMouseEvent) => {
      if (!pickRef.current) return;
      const { lat, lng } = e.latlng;
      onPickRef.current([+(lng - 2.25).toFixed(2), +(lat - 2).toFixed(2), +(lng + 2.25).toFixed(2), +(lat + 2).toFixed(2)]);
    };

    let start: LeafletNS.LatLng | null = null;
    let box: LeafletNS.Rectangle | null = null;
    const down = (e: LeafletNS.LeafletMouseEvent) => {
      if (!e.originalEvent.shiftKey || pickRef.current) return;
      start = e.latlng;
      map.dragging.disable();
      box = L.rectangle(L.latLngBounds(start, start), { color: '#38BDF8', weight: 1.5, dashArray: '4 4', fillColor: '#38BDF8', fillOpacity: 0.08, interactive: false }).addTo(map);
    };
    const move = (e: LeafletNS.LeafletMouseEvent) => {
      if (!start || !box) return;
      box.setBounds(L.latLngBounds(start, e.latlng));
    };
    const up = () => {
      if (!start || !box) return;
      const b = box.getBounds();
      box.remove(); box = null;
      map.dragging.enable();
      start = null;
      const w = +b.getWest().toFixed(2), s2 = +b.getSouth().toFixed(2), e2 = +b.getEast().toFixed(2), n2 = +b.getNorth().toFixed(2);
      if (Math.abs(e2 - w) > 0.5 && Math.abs(n2 - s2) > 0.5) onPickRef.current([w, s2, e2, n2]);
    };

    map.on('click', click);
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', up);
    return () => {
      map.off('click', click);
      map.off('mousedown', down);
      map.off('mousemove', move);
      map.off('mouseup', up);
      if (box) { try { box.remove(); } catch { /* noop */ } }
      try { map.dragging.enable(); } catch { /* noop */ }
    };
  }, [ready]);

  // v7.1 — Leaflet projector for the nullschool wind streamlines
  const leafProjector = (): Projector | null => {
    const map = mapRef.current;
    if (!map) return null;
    return {
      project: (lon, lat) => { try { const p = map.latLngToContainerPoint([lat, lon]); return { x: p.x, y: p.y }; } catch { return null; } },
      unproject: (x, y) => { try { const ll = map.containerPointToLatLng([x, y]); return { lon: ll.lng, lat: ll.lat }; } catch { return null; } },
    };
  };

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#050A14] px-6 text-center text-[11px] text-slate-400">
        <span className="font-bold text-amber-300">Map renderer failed to start</span>
        <span>Reload the page — every stat panel above stays live even without the map.</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* v6.1 EMBER ENGINE stylesheet — soft bloom glows, breathing animation,
          world-view firefront blooms, hover tips (all compositor-only) */}
      <style>{`
        .ignis-ember-wrap { position: relative; display: block; pointer-events: none; }
        .ignis-ember {
          position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
          display: block; border-radius: 9999px; pointer-events: none;
          background: radial-gradient(circle, var(--ember, #EF4444) 0%, rgba(239,68,68,0.55) 34%, rgba(239,68,68,0.14) 58%, transparent 72%);
          mix-blend-mode: screen; opacity: 0.85; will-change: transform, opacity;
          animation: ignis-ember-breathe 2.6s ease-in-out infinite;
        }
        .ignis-bloom {
          position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
          display: flex; align-items: center; justify-content: center;
          border-radius: 9999px; pointer-events: none;
          background: radial-gradient(circle, rgba(254,215,170,0.5) 0%, rgba(249,115,22,0.34) 30%, rgba(239,68,68,0.16) 55%, transparent 72%);
          mix-blend-mode: screen; will-change: transform, opacity;
          animation: ignis-ember-breathe 3.4s ease-in-out infinite;
        }
        .ignis-bloom-badge {
          font: 700 10px/1 ui-sans-serif, system-ui; color: #FEF2F2;
          text-shadow: 0 0 6px rgba(127,29,29,0.9), 0 1px 2px rgba(0,0,0,0.8);
          letter-spacing: 0.02em; pointer-events: none;
        }
        @keyframes ignis-ember-breathe {
          0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.78; }
          50% { transform: translate(-50%,-50%) scale(1.14); opacity: 1; }
        }
        .ignis-tip {
          background: rgba(8,12,22,0.92) !important; color: #F1F5F9;
          border: 1px solid rgba(248,113,113,0.4) !important; border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.45); padding: 4px 8px !important;
        }
        .ignis-tip::before { border-top-color: rgba(248,113,113,0.4) !important; }
        .ignis-fire-canvas { pointer-events: none; }
        .ignis-fire-tip {
          position: absolute; z-index: 645; display: none; max-width: 230px;
          padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(248,113,113,0.4);
          background: rgba(8,12,22,0.94); box-shadow: 0 6px 18px rgba(0,0,0,0.5);
          font: 11px/1.4 ui-sans-serif, system-ui; color: #F1F5F9; pointer-events: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ignis-fire-tip.on { display: block; }
      `}</style>
      <div ref={containerRef} className={`h-full w-full ${pickMode ? 'cursor-crosshair' : ''}`} />

      {/* v8 hover tooltip — spatial hit-test one-liner for the BLAZE canvas */}
      <div ref={tipRef} className="ignis-fire-tip" />

      {/* v7.1 WORLDVIEW — nullschool wind streamlines on the GPU-free renderer */}
      <WindCanvas enabled={!!overlays.wind} bbox={bbox} getProjector={leafProjector} />

      {/* v6.1 map chrome — north chip · live coordinates · tile progress (all pointer-transparent) */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-sky-400/25 bg-[#050A14]/80 px-1.5 font-bold text-sky-300 shadow-lg backdrop-blur-sm" title="North">▲N</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2">
        <span ref={coordRef} className="hidden h-6 items-center rounded-md border border-white/10 bg-[#050A14]/80 px-2.5 font-mono text-[10px] tracking-wide text-slate-300 shadow-lg backdrop-blur-sm sm:inline-flex">—</span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[600]">
        <div ref={tileBarRef} className="h-[2px] w-full bg-gradient-to-r from-amber-500/70 via-red-500/80 to-rose-500/70 opacity-0 shadow-[0_0_8px_rgba(249,115,22,0.8)] transition-opacity duration-300" />
      </div>
    </div>
  );
}
