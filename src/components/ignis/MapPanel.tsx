'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, CloudLightning, Cloudy, Globe, Hexagon, Keyboard, Layers, Maximize2, Minimize2, Mountain, Scan, Sparkles, Wind } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { HotspotsResult, MultiHotspots, EonetRanked } from '@/lib/ignis/types';
import { SENSOR_COLORS, GIBS_BASEMAPS, GIBS_OVERLAYS, gibs3857Url, LST_RAMP } from '@/lib/ignis/regions';
import { hexbin } from '@/lib/ignis/hexbin';
import LeafletFireMap from './LeafletFireMap';
import FireField3D from './FireField3D';
import TerrainScene3D from './TerrainScene3D';
import { detectionPopupHTML, clusterPopupHTML, gibsPopupHTML, hexPopupHTML, wireHotspotAI, threatBadge, type ClusterCtx, type WeatherCtx } from '@/lib/ignis/hotspotAI';
import { clustersToGeoJSON, CLASS_STYLE, type SegmentationResult, type ClusterClass } from '@/lib/ignis/segmentation';
import type { ForecastField } from '@/lib/ignis/forecast';
import { FORECASTER_META } from '@/lib/ignis/forecast';
import WindCanvas from './WindCanvas';
import { fetchRainFrames, rainTileUrl, type RainFrames } from '@/lib/ignis/rainviewer';
import type { Projector as ProjectorType } from '@/lib/ignis/wind';
type ProjectorGetter = () => ProjectorType | null;

export type StyleMode = 'intensity' | 'sensor' | 'confidence' | 'heatmap';

type Props = {
  bbox: number[];
  regionKey: string;
  day: string;
  hotspots: HotspotsResult | null;
  multiDay: MultiHotspots | null;
  pickMode: boolean;
  onPick: (bbox: number[]) => void;
  eonet: EonetRanked[];
  onAskAi: (q: string) => void;
  seg: SegmentationResult | null;
  forecast?: ForecastField | null;
  forecastLoading?: boolean;
  onToggleForecast?: () => void;
  weather?: WeatherCtx; // live Open-Meteo fire weather (upgrades spread model)
  onSetWindow?: (days: number) => void; // Zoom-Earth-style quick window presets (24H/48H/7D)
};

// v5.12 fire-dot ramp — the PROPER RED family: every detection reads as a red
// fire dot at any zoom (pale red → deep crimson with FRP), instead of the old
// yellow→red ramp where small burns washed out pale-yellow and vanished against
// bright basemaps. Intensity still encodes: red depth + size (∝ √FRP) + glow.
const FRP_RAMP: [number, string][] = [
  [0, '#FCA5A5'], [10, '#F87171'], [25, '#EF4444'], [60, '#DC2626'], [120, '#B91C1C'], [250, '#7F1D1D'], [500, '#450A0A'],
];
const CONF_RAMP: [number, string][] = [[0, '#475569'], [45, '#FBBF24'], [75, '#FB923C'], [90, '#F8FAFC']];

const FRP_EXPR = ['interpolate', ['linear'], ['max', ['get', 'frp'], 0.5], ...FRP_RAMP.flat()] as unknown as maplibregl.ExpressionSpecification;
// Legend gradients precomputed at module scope with INTEGER percentage stops —
// identical on server and client (CSSOM re-serialization of long decimals breaks hydration).
const FRP_GRADIENT = `linear-gradient(90deg,${FRP_RAMP.map(([v, c]) => `${c} ${Math.round((Math.log10(1 + v) / Math.log10(501)) * 100)}%`).join(',')})`;
const CONF_GRADIENT = `linear-gradient(90deg,${CONF_RAMP.map(([v, c]) => `${c} ${Math.round((v / 90) * 100)}%`).join(',')})`;

// Windy-style per-overlay base opacity (scaled by the user's master slider)
const baseOpacity = (key: string) => (key === 'labels' ? 0.9 : key.startsWith('lst') ? 0.6 : 0.75);

// WebGL2 capability probe — MapLibre GL v6 is WebGL2-only and throws
// GPUInitializationError synchronously from `new maplibregl.Map()` when the
// browser/GPU cannot create a context (Brave strict fingerprinting shields,
// headless/CI runners, VMs without GPU drivers, hardware acceleration off).
// We probe up front so the panel can mount the GPU-free Leaflet renderer
// (LeafletFireMap — plain <img> GIBS tiles, canvas vectors, zero WebGL)
// instead of crashing the whole page. Escape hatch: append ?nogpu=1 to the
// URL to force the GPU-free renderer (support / CI / screenshot testing).
function webgl2Supported(): boolean {
  try {
    if (typeof window === 'undefined') return true; // SSR — probed again in the client effect
    if (new URLSearchParams(window.location.search).has('nogpu')) return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
const EMPTY_DAY_KEYS: string[] = [];

// v7.1 shared popup factory — every GL popup dispatches the wind-dim events so
// the nullschool streamlines step back while an AI event card is open
function ignisPopup(map: maplibregl.Map, lngLat: maplibregl.LngLatLike, html: string, maxWidth = '300px'): maplibregl.Popup {
  const p = new maplibregl.Popup({ closeButton: true, maxWidth })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
  p.on('open', () => window.dispatchEvent(new Event('ignis-popup-open')));
  p.on('close', () => window.dispatchEvent(new Event('ignis-popup-close')));
  return p;
}

const SENSOR_EXPR = ['match', ['get', 'sensor'], ...Object.entries(SENSOR_COLORS).flat(), '#F97316'] as unknown as maplibregl.ExpressionSpecification;
const CONF_EXPR = ['interpolate', ['linear'], ['max', ['get', 'conf'], 0], ...CONF_RAMP.flat()] as unknown as maplibregl.ExpressionSpecification;

function colorExpr(mode: StyleMode): maplibregl.ExpressionSpecification {
  if (mode === 'sensor') return SENSOR_EXPR;
  if (mode === 'confidence') return CONF_EXPR;
  return FRP_EXPR;
}

export default function MapPanel({ bbox, regionKey, day, hotspots, multiDay, pickMode, onPick, eonet, onAskAi, seg, forecast, forecastLoading, onToggleForecast, weather, onSetWindow }: Props) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [basemapKey, setBasemapKey] = useState('truecolor_modis_terra');
  const [styleMode, setStyleMode] = useState<StyleMode>('intensity');
  // v7.1 WORLDVIEW ENGINE: wind streamlines default ON (nullschool signature),
  // RainViewer radar/clouds off until asked — the map stays clean by default
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ coastlines: true, labels: false, lst_day: false, lst_night: false, gibsfires: true, wind: true, radar: false, clouds: false, eonet: false });
  const [rain, setRain] = useState<RainFrames | null>(null);
  const [showHex, setShowHex] = useState(false);
  const [showSeg, setShowSeg] = useState(false); // off by default: the map opens with plain fire dots (Layers > Segmentation turns it on)
  const [visible, setVisible] = useState<Record<string, boolean>>({ 'MODIS-Terra': true, 'MODIS-Aqua': true, 'VIIRS-SNPP': true, 'VIIRS-NOAA20': true, 'VIIRS-NOAA21': true });
  const [animDay, setAnimDay] = useState<string | null>(null);
  // NASA Worldview-style global view: the whole world's fires as dots on true color
  const [worldView, setWorldView] = useState(false);
  const [worldFires, setWorldFires] = useState<{ day: string; pts: number[]; total: number; layers: { id: string; label: string; count: number }[] } | null>(null);
  // per-layer eye toggles, by index into the four Worldview fire layers
  const [worldHidden, setWorldHidden] = useState<Record<number, boolean>>({});
  const [worldError, setWorldError] = useState<string | null>(null);
  const worldSaved = useRef<{ visible: Record<string, boolean>; wind: boolean; basemap: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(900);
  const [hudDay, setHudDay] = useState(day);
  const [gpuBlocked, setGpuBlocked] = useState(false);
  const [initNonce, setInitNonce] = useState(0);
  const [show3D, setShow3D] = useState(false);
  const [showTerrainScene, setShowTerrainScene] = useState(false);
  const [terrain3D, setTerrain3D] = useState(false);
  const [show3DTowers, setShow3DTowers] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number; k: number } | null>(null);
  // v5.11 visibility overhaul — the map itself is the hero: every overlay
  // collapses to a compact chip by default and expands on demand, and the
  // panel can go fullscreen (⛶ focus) without touching the page grid
  const [hudOpen, setHudOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [bannerOff, setBannerOff] = useState(false);
  // Why the WebGL map could not start (shown to the user — there is no automatic fallback)
  const [gpuWhy, setGpuWhy] = useState<string>('');
  // the basic (non-WebGL) map is opt-in only: the user must ask for it
  const [useBasicMap, setUseBasicMap] = useState(false);
  // the app's own FRP-sized detection dots; off by default, the map shows the NASA fire layers
  const showAppDots = false; // region fire dots were removed at the user's request (World fire view keeps its own dots)
  // result of the last NASA fire-layer load for the region: dot count, or an error
  // GDACS wildfire alerts (EU/UN, worldwide) — the reported-wildfire rings outside the US
  const [gdacs, setGdacs] = useState<Array<{ title: string; country: string; alertLevel: string; from: string; to: string; lat: number; lon: number; url: string }>>([]);
  const [nasaDots, setNasaDots] = useState<{ day: string; count: number; error?: boolean } | null>(null);
  const [resizeNonce, setResizeNonce] = useState(0);
  // v7 mission-control additions — Nullschool probe · shortcut cheat-sheet · Windy master opacity
  const [probe, setProbe] = useState<{ lat: number; lon: number; hits: number; maxFrp: number; sensor: string; conf: number; src: 'gl' | 'leaf' } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [ovOpacity, setOvOpacity] = useState(1);

  // v7.1 — live weather frames (RainViewer) fetched when a weather layer is on
  useEffect(() => {
    if (!overlays.radar && !overlays.clouds) return;
    let alive = true;
    fetchRainFrames().then((f) => { if (alive) setRain(f); });
    const t = setInterval(() => { fetchRainFrames().then((f) => { if (alive) setRain(f); }); }, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [overlays.radar, overlays.clouds]);

  // bottom hint auto-fades — one glance is enough, then the map is clean
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 7000);
    return () => clearTimeout(t);
  }, []);

  // focus (fullscreen) mode: lock page scroll, re-measure the renderer on
  // every geometry change, Esc exits
  useEffect(() => {
    if (!focus) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [focus]);

  // renderer re-measure after focus toggles resize the container
  useEffect(() => {
    if (!resizeNonce) return;
    const map = mapRef.current;
    const t = setTimeout(() => { try { map?.resize(); } catch { /* noop */ } }, 60);
    return () => clearTimeout(t);
  }, [resizeNonce]);

  const onPickRef = useRef(onPick);
  const pickRef = useRef(pickMode);
  const askRef = useRef(onAskAi);
  const weatherRef = useRef<WeatherCtx | undefined>(weather);
  useEffect(() => { onPickRef.current = onPick; pickRef.current = pickMode; askRef.current = onAskAi; weatherRef.current = weather; }, [onPick, pickMode, onAskAi, weather]);

  const dayKeys = multiDay ? Object.keys(multiDay.days).sort() : EMPTY_DAY_KEYS;
  const displayDay = animDay ?? day;
  const displayData = useMemo(
    () => (multiDay && multiDay.days[displayDay]) || hotspots,
    [multiDay, displayDay, hotspots],
  );

  // ---- map init (with WebGL2 probe + graceful GPU failure) ----
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    // MapLibre v6 ships its worker as a separate ES module and locates it through
    // import.meta.url, which the bundler rewrites. Without a working worker every GeoJSON
    // layer (fire dots, AOI box, rings, world fire view) silently never loads. Serve the
    // worker from /public instead (copied from node_modules/maplibre-gl/dist, same version).
    try { maplibregl.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`); } catch { /* already set */ }
    // MapLibre v6 requires WebGL2 — probe BEFORE constructing so browsers with
    // a blocked/disabled GPU (Brave strict shields, VMs, headless runners)
    // mount the GPU-free Leaflet renderer instead of a thrown
    // GPUInitializationError crashing the whole page.
    if (!webgl2Supported()) {
      const t = setTimeout(() => { setGpuWhy('This browser reports that WebGL2 is not available (graphics acceleration is switched off or blocked).'); setGpuBlocked(true); }, 0); // deferred — no sync setState in effect body
      return () => clearTimeout(t);
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            basemap: { type: 'raster', tiles: [gibs3857Url(GIBS_BASEMAPS[basemapKey], day)], tileSize: 256, maxzoom: GIBS_BASEMAPS[basemapKey].level, attribution: 'NASA GIBS' },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#050A14' } },
            { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } },
          ],
        },
        center: [-60, -5],
        zoom: 3,
        attributionControl: false,
        doubleClickZoom: true,
      });
    } catch (err) {
      // GPUInitializationError & friends — degrade to the Leaflet view, never crash.
      console.warn('[ignis:map] WebGL2 context creation failed', err);
      const t = setTimeout(() => { setGpuWhy(`The browser refused to create the WebGL2 map: ${String((err as Error)?.message || err).slice(0, 160)}`); setGpuBlocked(true); }, 0); // deferred — no sync setState in effect body
      return () => clearTimeout(t);
    }
    mapRef.current = map;
    // Quietly absorb GIBS tile hiccups (404 on empty vector tiles, transient 5xx) so the
    // browser console never spams AJAXError — layers already handle their own fallbacks.
    // GPU/WebGL failures are the exception: they escalate to the static fallback.
    map.on('error', (e) => {
      const msg = e && e.error ? String((e.error as Error).message || e.error) : 'unknown';
      if (/GPUInitializationError|webgl|graphics context|\bGPU\b/i.test(msg)) {
        setGpuWhy(`The map reported a graphics error: ${msg.slice(0, 160)}`);
        setGpuBlocked(true);
        return;
      }
      if (/AJAXError|Failed to fetch|tile|404|400|aborted/i.test(msg)) return;
      console.warn('[ignis:map]', msg);
    });
    // Native canvas event — fires when the driver/GPU drops the context mid-session.
    map.getCanvas().addEventListener('webglcontextlost', () => { setGpuWhy('The graphics driver dropped the WebGL context while the map was running.'); setGpuBlocked(true); }, { once: true });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('load', () => {
      setReady(true);
      (window as unknown as { __ignisMap?: maplibregl.Map }).__ignisMap = map; // debug/demo handle
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [initNonce]);

  // When the GPU dies mid-session (context lost / init error), tear down the
  // broken GL map so the Leaflet renderer takes over cleanly. `Try WebGL`
  // re-creates the GL map from scratch by bumping initNonce.
  useEffect(() => {
    if (!gpuBlocked || !mapRef.current) return;
    try { mapRef.current.remove(); } catch { /* already gone */ }
    mapRef.current = null;
    const t = setTimeout(() => setReady(false), 0); // deferred — no sync setState in effect body
    return () => clearTimeout(t);
  }, [gpuBlocked]);

  const retryInteractive = useCallback(() => {
    setGpuBlocked(false);
    setUseBasicMap(false);
    setInitNonce((n) => n + 1);
  }, []);

  // ---- fly-to requests from the 3D Fire Field panel (GL renderer) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTarget) return;
    map.flyTo({ center: [flyTarget.lat, flyTarget.lon], zoom: Math.max(map.getZoom(), 7), duration: 0.85 });
  }, [flyTarget, ready]);

  const flyToCell = useCallback((lat: number, lon: number) => {
    setFlyTarget({ lat, lon, k: Date.now() });
  }, []);

  // ---- Nullschool-style cursor probe (v7) ----
  // Live "what is under my crosshair" telemetry. GL renderer: queryRenderedFeatures
  // in an 8px radius → detection count, max FRP, sensor, confidence. Leaflet
  // renderer: coordinates only (canvas hit-testing is click-based). rAF-throttled
  // + 70ms min interval so the readout never floods React on fast sweeps.
  const probeRef = useRef<{ lat: number; lon: number } | null>(null);
  const probeBusyRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || gpuBlocked) return;
    let raf = 0;
    const sample = () => {
      raf = 0;
      const c = probeRef.current;
      if (!c) return;
      try {
        const pt = map.project([c.lon, c.lat]);
        const feats = map.getLayer('fires-core')
          ? map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ['fires-core'] })
          : [];
        let hits = 0, maxFrp = 0, sensor = '', conf = 0;
        for (const f of feats) {
          hits += 1;
          const frp = Number(f.properties?.frp ?? 0);
          if (frp > maxFrp) {
            maxFrp = frp;
            sensor = String(f.properties?.sensor ?? '');
            conf = Number(f.properties?.conf ?? 0);
          }
        }
        setProbe({ lat: c.lat, lon: c.lon, hits, maxFrp, sensor, conf, src: 'gl' });
      } catch { /* map tearing down */ }
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      probeRef.current = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      const now = performance.now();
      if (!raf && now - probeBusyRef.current > 70) {
        probeBusyRef.current = now;
        raf = requestAnimationFrame(sample);
      }
    };
    const onLeave = () => { probeRef.current = null; setProbe(null); };
    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    return () => { map.off('mousemove', onMove); map.off('mouseout', onLeave); if (raf) cancelAnimationFrame(raf); };
  }, [ready, gpuBlocked]);

  const onCursorLeaflet = useCallback((info: { lat: number; lon: number } | null) => {
    setProbe(info ? { ...info, hits: -1, maxFrp: 0, sensor: '', conf: 0, src: 'leaf' } : null);
  }, []);

  // v7.1 — GL projector for the nullschool wind streamlines (read live at frame
  // time so pan/zoom never sees a stale camera)
  const glProjector = useCallback<ProjectorGetter>(() => {
    const map = mapRef.current;
    if (!map) return null;
    return {
      project: (lon, lat) => { try { const p = map.project([lon, lat]); return { x: p.x, y: p.y }; } catch { return null; } },
      unproject: (x, y) => { try { const ll = map.unproject([x, y]); return { lon: ll.lng, lat: ll.lat }; } catch { return null; } },
    };
  }, []);

  // ---- keyboard shortcuts — press K for the cheat-sheet (v7) ----
  // F focus · L layers · T terrain · G 3D fire field · B 3D towers · R replay ·
  // H hexbin · S segmentation · 1-4 style modes · Esc exits focus. Ignored while
  // typing in inputs and with modifier keys held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { setFocus((v) => !v); setResizeNonce((n) => n + 1); }
      else if (k === 'l') setLayersOpen((o) => !o);
      else if (k === 'k') setShortcutsOpen((o) => !o);
      else if (k === 't' && !gpuBlocked) setTerrain3D((v) => !v);
      else if (k === 'g') setShow3D((v) => !v);
      else if (k === 'b' && !gpuBlocked) setShow3DTowers((v) => !v);
      else if (k === 'r' && dayKeys.length > 1) setPlaying((p) => !p);
      else if (k === 'w') setOverlays((o) => ({ ...o, wind: !o.wind }));
      else if (k === 'h') setShowHex((v) => !v);
      else if (k === 's') setShowSeg((v) => !v);
      else if (k === '1') setStyleMode('intensity');
      else if (k === '2') setStyleMode('sensor');
      else if (k === '3') setStyleMode('confidence');
      else if (k === '4') setStyleMode('heatmap');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gpuBlocked, dayKeys.length]);

  // ---- 3D terrain (GL renderer only): AWS Terrarium DEM + hillshade + pitch ----
  // Gives WebGL-capable browsers true elevation relief under the fire layers;
  // GPU-blocked browsers get the equivalent depth cue from the GPU-free
  // FireField3D isometric canvas instead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || gpuBlocked) return;
    if (!terrain3D) {
      try { map.setTerrain(null); } catch { /* older core */ }
      if (map.getLayer('hs')) map.removeLayer('hs');
      if (map.getSource('dem')) map.removeSource('dem');
      if (map.getPitch() > 5) map.easeTo({ pitch: 0, duration: 700 });
      return;
    }
    try {
      if (!map.getSource('dem')) {
        map.addSource('dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 13,
          attribution: 'Elevation: AWS/Mapzen Terrain Tiles',
        });
      }
      const before = map.getLayer('aoi-fill') ? 'aoi-fill' : undefined;
      if (!map.getLayer('hs')) {
        map.addLayer({
          id: 'hs', type: 'hillshade', source: 'dem',
          paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#0B1220', 'hillshade-highlight-color': '#E2E8F0' },
        }, before);
      }
      map.setTerrain({ source: 'dem', exaggeration: 1.3 });
      map.easeTo({ pitch: 62, duration: 1100 });
    } catch (err) {
      console.warn('[ignis:map] 3D terrain unavailable on this GPU', err);
    }
  }, [terrain3D, ready, gpuBlocked]);

  // ---- basemap + overlay sources ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bm = GIBS_BASEMAPS[basemapKey];
    const url = gibs3857Url(bm, displayDay);
    const src = map.getSource('basemap') as maplibregl.RasterTileSource | undefined;
    if (src) {
      // maxzoom must match the layer's TileMatrix level so MapLibre over-zooms instead of 404ing
      if ((src as unknown as { maxzoom?: number }).maxzoom === bm.level) {
        try { (src as unknown as { setTiles: (t: string[]) => void }).setTiles([url]); } catch { /* older API */ }
      } else {
        if (map.getLayer('basemap')) map.removeLayer('basemap');
        map.removeSource('basemap');
        map.addSource('basemap', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: bm.level, attribution: 'NASA GIBS' });
        map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } });
        if (map.getLayer('aoi-fill')) map.moveLayer('basemap', 'aoi-fill');
      }
    }
  }, [basemapKey, displayDay, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [key, cfg] of Object.entries(GIBS_OVERLAYS)) {
      const on = overlays[key];
      const srcId = `ov-${key}`, layerId = `ov-${key}`;
      if (on && !map.getSource(srcId)) {
        map.addSource(srcId, { type: 'raster', tiles: [gibs3857Url(cfg, displayDay)], tileSize: 256, maxzoom: cfg.level });
        map.addLayer({ id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': baseOpacity(key) * ovOpacity } });
      } else if (on && map.getLayer(layerId)) {
        const s = map.getSource(srcId) as maplibregl.RasterTileSource;
        try { (s as unknown as { setTiles: (t: string[]) => void }).setTiles([gibs3857Url(cfg, displayDay)]); } catch { /* noop */ }
        try { map.setPaintProperty(layerId, 'raster-opacity', baseOpacity(key) * ovOpacity); } catch { /* noop */ }
      } else if (!on && map.getLayer(layerId)) {
        map.removeLayer(layerId);
        map.removeSource(srcId);
      }
    }
  }, [overlays, displayDay, ready, ovOpacity]);

  // ---- World fire view (NASA Worldview look) ----
  const toggleWorldView = () => {
    if (!worldView) {
      worldSaved.current = { visible, wind: !!overlays.wind, basemap: basemapKey };
      setVisible((v) => Object.fromEntries(Object.keys(v).map((k) => [k, false])));
      setOverlays((o) => ({ ...o, wind: false, gibsfires: false }));
      setBasemapKey('truecolor_modis_terra');
      setWorldView(true);
    } else {
      const sv = worldSaved.current;
      if (sv) {
        setVisible(sv.visible);
        setOverlays((o) => ({ ...o, wind: sv.wind }));
        setBasemapKey(sv.basemap);
      }
      setWorldView(false);
      const map = mapRef.current;
      if (map && ready) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 900, maxZoom: 9 });
    }
  };
  useEffect(() => {
    if (!worldView) return;
    let alive = true;
    (async () => {
      setWorldError(null);
      const d = await fetch(`/api/gibsfires?world=1&day=${displayDay}`).then((r) => r.json()).catch(() => null);
      if (!alive) return;
      if (!d || d.error || !Array.isArray(d.pts)) { setWorldError('Could not load the world fire layers from NASA. Check the internet connection.'); return; }
      setWorldFires({ day: displayDay, pts: d.pts, total: d.total, layers: Array.isArray(d.layers) ? d.layers : [] });
    })();
    return () => { alive = false; };
  }, [worldView, displayDay]);
  const worldPts = worldView && worldFires && worldFires.day === displayDay ? worldFires.pts : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!worldView) {
      if (map.getLayer('worldfires')) map.removeLayer('worldfires');
      if (map.getSource('worldfires')) map.removeSource('worldfires');
      return;
    }
    const features: Array<{ type: 'Feature'; properties: { li: number }; geometry: { type: 'Point'; coordinates: [number, number] } }> = [];
    if (worldPts) for (let i = 0; i < worldPts.length; i += 3) features.push({ type: 'Feature', properties: { li: worldPts[i + 2] }, geometry: { type: 'Point', coordinates: [worldPts[i], worldPts[i + 1]] } });
    const fc = { type: 'FeatureCollection' as const, features };
    const src = map.getSource('worldfires') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else {
      map.addSource('worldfires', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'worldfires', type: 'circle', source: 'worldfires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.4, 3, 2.2, 6, 3.6, 9, 5],
          // Worldview legend: VIIRS = red, MODIS = orange
          'circle-color': ['case', ['>=', ['get', 'li'], 2], '#FF7A00', '#FF1F1F'],
          'circle-opacity': 0.92,
        },
      });
      map.fitBounds([[-168, -56], [178, 72]], { padding: 10, duration: 900 });
    }
  }, [worldView, worldPts, ready]);
  // World fire view shows ONLY the satellite photo + NASA fire layers: park every other
  // map layer (region dots, cluster hulls, event rings, AOI box) and restore it on exit.
  const worldParked = useRef<Record<string, string>>({});
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const keep = (id: string) => id === 'bg' || id === 'basemap' || id === 'worldfires' || id.startsWith('ov-');
    if (worldView) {
      for (const l of map.getStyle().layers) {
        if (keep(l.id) || l.id in worldParked.current) continue;
        worldParked.current[l.id] = (map.getLayoutProperty(l.id, 'visibility') as string | undefined) ?? 'visible';
        map.setLayoutProperty(l.id, 'visibility', 'none');
      }
    } else {
      for (const [id, vis] of Object.entries(worldParked.current)) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis === 'none' ? 'none' : 'visible');
      }
      worldParked.current = {};
    }
  }, [worldView, worldPts, ready]);
  const worldHiddenList = useMemo(() => Object.keys(worldHidden).filter((k) => worldHidden[Number(k)]).map(Number), [worldHidden]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer('worldfires')) return;
    map.setFilter('worldfires', worldHiddenList.length ? ['!', ['in', ['get', 'li'], ['literal', worldHiddenList]]] : null);
  }, [worldHiddenList, worldView, worldPts, ready]);
  // dots the fallback renderer should draw (hidden layers removed)
  const worldPtsShown = useMemo(() => {
    if (!worldPts || !worldHiddenList.length) return worldPts;
    const out: number[] = [];
    for (let i = 0; i < worldPts.length; i += 3) if (!worldHiddenList.includes(worldPts[i + 2])) out.push(worldPts[i], worldPts[i + 1], worldPts[i + 2]);
    return out;
  }, [worldPts, worldHiddenList]);

  // ---- Reported wildfires worldwide (GDACS) — joins the EONET rings, which are US-only ----
  useEffect(() => {
    if (!overlays.eonet || gdacs.length) return;
    let alive = true;
    (async () => {
      const d = await fetch('/api/gdacs').then((r) => r.json()).catch(() => null);
      const items = (d?.items ?? []).filter((x: { lat: unknown; lon: unknown }) => typeof x.lat === 'number' && typeof x.lon === 'number');
      if (alive && items.length) setGdacs(items);
    })();
    return () => { alive = false; };
  }, [overlays.eonet, gdacs.length]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: gdacs.map((g) => ({
        type: 'Feature' as const,
        properties: { title: g.title, country: g.country, level: g.alertLevel, from: g.from, to: g.to, url: g.url },
        geometry: { type: 'Point' as const, coordinates: [g.lon, g.lat] },
      })),
    };
    if (map.getSource('gdacs')) (map.getSource('gdacs') as maplibregl.GeoJSONSource).setData(fc);
    else {
      map.addSource('gdacs', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'gdacs-ring', type: 'circle', source: 'gdacs',
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(251,191,36,0.14)', 'circle-stroke-color': '#FBBF24', 'circle-stroke-width': 1.6 },
      });
      map.on('click', 'gdacs-ring', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        ignisPopup(map, e.lngLat, `<div style="font:12px/1.5 ui-sans-serif"><div style="font-weight:700;color:#FCD34D">GDACS wildfire alert · ${p.level}</div><div>${p.title}</div><div style="color:#94A3B8">${String(p.from).slice(0, 10)} to ${String(p.to).slice(0, 10)}</div><a href="${p.url}" target="_blank" rel="noreferrer" style="color:#38BDF8">GDACS report →</a></div>`);
      });
    }
    map.setLayoutProperty('gdacs-ring', 'visibility', overlays.eonet ? 'visible' : 'none');
  }, [gdacs, ready, overlays.eonet]);

  // ---- GIBS fire pixels (vector cross-check) ----
  // GIBS serves thermal anomalies ONLY as Mapbox vector tiles (epsg4326 1km/500m TMS),
  // so the server parses them to GeoJSON (/api/gibsfires) — the old client-side raster
  // overlay (.png @ epsg3857) is a format GIBS does not provide and always returned 400.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!overlays.gibsfires) {
      for (const l of ['gibsfires-core', 'gibsfires-ring']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('gibsfires')) map.removeSource('gibsfires');
      return;
    }
    let alive = true;
    (async () => {
      const [w, s, e, n] = bbox;
      const fc = await fetch(`/api/gibsfires?w=${w}&s=${s}&e=${e}&n=${n}&day=${displayDay}`)
        .then((r) => r.json()).catch(() => null);
      if (alive) setNasaDots({ day: displayDay, count: fc && Array.isArray(fc.features) ? fc.features.length : 0, error: !fc || !!fc.error });
      if (!alive || !map || !fc || fc.error) return;
      if (!map.getSource('gibsfires')) {
        map.addSource('gibsfires', { type: 'geojson', data: fc });
        const ring: maplibregl.CircleLayerSpecification = {
          id: 'gibsfires-ring', type: 'circle', source: 'gibsfires',
          paint: {
            // Worldview look: plain red dots, one per detection, same size for every fire
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 5, 2.6, 8, 4.5],
            'circle-color': ['case', ['in', 'MODIS', ['get', 'layer']], '#FF7A00', '#FF1F1F'], 'circle-opacity': 0.92,
            'circle-stroke-color': '#7F1D1D', 'circle-stroke-width': 0.5,
          },
        };
        const core: maplibregl.CircleLayerSpecification = {
          id: 'gibsfires-core', type: 'circle', source: 'gibsfires',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 5, 2.6, 8, 4.5], 'circle-color': '#FF2A12', 'circle-opacity': 0.01 }, // click target
        };
        try { map.addLayer(ring, 'fires-glow'); map.addLayer(core, 'fires-glow'); }
        catch { map.addLayer(ring); map.addLayer(core); }
        map.on('click', 'gibsfires-core', (ev) => {
          const f = ev.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, string | number>;
          const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          const popup = ignisPopup(map, ev.lngLat, gibsPopupHTML({ sensor: String(p.sensor ?? 'GIBS'), frp: Number(p.frp), lat: coords[0], lon: coords[1] }, { regionKey, day: displayDay }));
          wireHotspotAI(popup.getElement(), askRef.current);
        });
      } else {
        (map.getSource('gibsfires') as maplibregl.GeoJSONSource).setData(fc);
      }
    })();
    return () => { alive = false; };
  }, [overlays.gibsfires, displayDay, bbox, ready]);

  // ---- AOI box ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const aoi = {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const, properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]] },
      }],
    };
    if (map.getSource('aoi')) (map.getSource('aoi') as maplibregl.GeoJSONSource).setData(aoi);
    else {
      map.addSource('aoi', { type: 'geojson', data: aoi });
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi', layout: { visibility: 'none' }, paint: { 'fill-color': '#38BDF8', 'fill-opacity': 0.05 } });
      map.addLayer({ id: 'aoi-line', type: 'fill', source: 'aoi', layout: { visibility: 'none' }, paint: { 'fill-color': '#38BDF8', 'fill-opacity': 0.0 } });
      map.addLayer({ id: 'aoi-stroke', type: 'line', source: 'aoi', layout: { visibility: 'none' }, paint: { 'line-color': '#38BDF8', 'line-width': 1.6, 'line-dasharray': [2, 2] } });
    }
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 900, maxZoom: 9 });
  }, [bbox, ready]);

  // ---- EONET events ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: eonet.filter((e) => e.lat !== null).map((e) => ({
        type: 'Feature' as const,
        properties: { title: e.title, link: e.link, date: e.date, rel: e.relevance },
        geometry: { type: 'Point' as const, coordinates: [e.lon!, e.lat!] },
      })),
    };
    if (map.getSource('eonet')) (map.getSource('eonet') as maplibregl.GeoJSONSource).setData(fc);
    else {
      map.addSource('eonet', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'eonet-ring', type: 'circle', source: 'eonet',
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(56,189,248,0.12)', 'circle-stroke-color': '#38BDF8', 'circle-stroke-width': 1.6 },
      });
    }
    if (map.getLayer('eonet-ring')) map.setLayoutProperty('eonet-ring', 'visibility', overlays.eonet ? 'visible' : 'none');
  }, [eonet, ready, overlays.eonet]);

  // ---- fire points ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!displayData) return;
    const feats: Array<{ type: 'Feature'; properties: Record<string, string | number>; geometry: { type: 'Point'; coordinates: [number, number] } }> = [];
    for (const [sensor, s] of Object.entries(displayData.sensors)) {
      if (!visible[sensor]) continue;
      for (const p of s.points) {
        feats.push({
          type: 'Feature' as const,
          properties: {
            sensor, frp: Math.min(600, Math.max(0.5, p.frp || 0.5)),
            conf: typeof p.conf === 'number' ? p.conf : 60,
            night: p.night ? 'N' : 'D', sat: p.sat || '', acq: p.acq || '',
            type: p.type ?? '', typeP: p.typeP ?? 0, spreadKm: p.spreadKm ?? 0, dens25: p.dens25 ?? 0,
          },
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        });
      }
    }
    const fc = { type: 'FeatureCollection' as const, features: feats };
    if (map.getSource('fires')) (map.getSource('fires') as maplibregl.GeoJSONSource).setData(fc);
    // v6.1 spread rings — top 80 modelled spread radii as 64-gon polygons
    const spreadFeats: Array<{ type: 'Feature'; properties: Record<string, number>; geometry: { type: 'Polygon'; coordinates: [[number, number][]] } }> = [];
    for (const f of feats) {
      const sk = Number(f.properties.spreadKm) || 0;
      if (sk < 1) continue;
      const [lon, lat] = f.geometry.coordinates;
      const ring: [number, number][] = [];
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * 2 * Math.PI;
        const dx = (sk / 111.32) * Math.cos(th);
        const dy = (sk / 110.57) * Math.sin(th) / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        ring.push([lon + dx, lat + dy]);
      }
      spreadFeats.push({ type: 'Feature', properties: { sk }, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
    spreadFeats.sort((a, b) => (b.properties.sk as number) - (a.properties.sk as number));
    if (map.getSource('fires-spread')) (map.getSource('fires-spread') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection' as const, features: spreadFeats.slice(0, 80) });
    else {
      map.addSource('fires', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'fires-heat', type: 'heatmap', source: 'fires', layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0.5, 0.25, 300, 1.4],
          'heatmap-intensity': 0.7,
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 12, 8, 38],
          'heatmap-opacity': 0.85,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(5,10,20,0)', 0.2, '#1D4ED8', 0.4, '#0891B2', 0.55, '#FDE047', 0.75, '#F97316', 0.9, '#DC2626', 1, '#FECACA'],
        },
      });
      map.addLayer({
        id: 'fires-glow', type: 'circle', source: 'fires',
        paint: { 'circle-color': colorExpr('intensity'), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, ['+', 2.4, ['*', 1.3, ['sqrt', ['get', 'frp']]]], 8, ['+', 8, ['*', 6, ['sqrt', ['get', 'frp']]]]], 'circle-blur': 1.1, 'circle-opacity': 0.4 },
      });
      map.addLayer({
        id: 'fires-core', type: 'circle', source: 'fires',
        // compact until ~z6 (no red blob at AOI zoom), then grow to full spread;
        // the 2.1px+ floor keeps EVERY dot visible at world view
        paint: { 'circle-color': FRP_EXPR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 4.5, ['min', 4.5, ['+', 2.1, ['*', 0.25, ['sqrt', ['get', 'frp']]]]], 9, ['min', 9, ['+', 3.5, ['*', 0.5, ['sqrt', ['get', 'frp']]]]]], 'circle-stroke-width': 0.5, 'circle-stroke-color': 'rgba(255,255,255,0.6)' }, // plain dots: stronger fires are slightly larger, never big discs
      });
      map.addLayer({
        id: 'fires-hot', type: 'circle', source: 'fires', filter: ['>=', ['get', 'frp'], 150],
        paint: { 'circle-color': '#FFFFFF', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, 1.8, 8, 5.4], 'circle-opacity': 0.95 },
      });
      // v6.1 EMBER HALO — blurred deep-red bloom underlay for the hottest
      // detections: the GL mirror of the Leaflet ember blooms, so both
      // renderers read as FIRE at a glance
      map.addLayer({
        id: 'fires-halo', type: 'circle', source: 'fires', filter: ['>=', ['get', 'frp'], 120],
        paint: {
          'circle-color': '#DC2626',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, ['+', 5, ['*', 1.8, ['sqrt', ['get', 'frp']]]], 8, ['+', 11, ['*', 5, ['sqrt', ['get', 'frp']]]]],
          'circle-blur': 2.4, 'circle-opacity': 0.5,
        },
      }, 'fires-glow');
      // v8 EMBER UNDERGLOW — warm orange blur beneath mid-size fires too
      // (FRP ≥ 45): mid detections read as live embers, not just dots
      map.addLayer({
        id: 'fires-ember', type: 'circle', source: 'fires', filter: ['>=', ['get', 'frp'], 45],
        paint: {
          'circle-color': '#F97316',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.5, ['+', 3, ['*', 1.1, ['sqrt', ['get', 'frp']]]], 8, ['+', 7, ['*', 3.2, ['sqrt', ['get', 'frp']]]]],
          'circle-blur': 1.7, 'circle-opacity': 0.32,
        },
      }, 'fires-glow');
      // v6.1 SPREAD RINGS — dashed geodesic circles at the modelled spread
      // radius (64-gon polygons, real km) for the strongest fire fronts
      if (!map.getSource('fires-spread')) {
        map.addSource('fires-spread', { type: 'geojson', data: EMPTY_FC });
        map.addLayer({
          id: 'fires-spread-fill', type: 'fill', source: 'fires-spread',
          paint: { 'fill-color': 'rgba(239,68,68,0.05)', 'fill-opacity': 1 },
        }, 'fires-glow');
        map.addLayer({
          id: 'fires-spread-line', type: 'line', source: 'fires-spread',
          paint: { 'line-color': 'rgba(248,113,113,0.55)', 'line-width': 1.1, 'line-dasharray': [2, 2.5] },
        }, 'fires-glow');
      }
      // v6.1 NIGHT RIMS — cool ice-blue outer rings on night detections,
      // slotted beneath the core so day/night physics read at a glance
      map.addLayer({
        id: 'fires-night', type: 'circle', source: 'fires', filter: ['==', ['get', 'night'], 'N'],
        paint: {
          // night detections: a thin pale-blue outline just outside the dot (no filled halo)
          'circle-color': 'rgba(186,230,253,0)',
          'circle-stroke-color': 'rgba(186,230,253,0.85)', 'circle-stroke-width': 1,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 4.5, ['min', 5.5, ['+', 3.1, ['*', 0.25, ['sqrt', ['get', 'frp']]]]], 9, ['min', 10.5, ['+', 5, ['*', 0.5, ['sqrt', ['get', 'frp']]]]]],
        },
      }, 'fires-core');
      // popups
      map.on('click', 'fires-core', (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point') return;
        const p = f.properties as Record<string, string | number>;
        const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        const popup = ignisPopup(map, e.lngLat, detectionPopupHTML({ sensor: String(p.sensor), sat: p.sat ? String(p.sat) : undefined, frp: Number(p.frp), conf: Number(p.conf), acq: p.acq ? String(p.acq) : undefined, night: p.night === 'N', lat: coords[0], lon: coords[1], type: p.type ? String(p.type) : undefined, typeP: p.typeP ? Number(p.typeP) : undefined, spreadKm: p.spreadKm ? Number(p.spreadKm) : undefined, weather: weatherRef.current }, { regionKey, day: displayDay }));
        wireHotspotAI(popup.getElement(), askRef.current);
      });
      map.on('mouseenter', 'fires-core', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'fires-core', () => { map.getCanvas().style.cursor = pickRef.current ? 'crosshair' : ''; });
    }
    // style mode updates
    const colorForMode = colorExpr(styleMode);
    map.setPaintProperty('fires-glow', 'circle-color', colorExpr('intensity'));
    map.setPaintProperty('fires-core', 'circle-color', colorForMode);
    map.setLayoutProperty('fires-heat', 'visibility', styleMode === 'heatmap' ? 'visible' : 'none');
    map.setLayoutProperty('fires-glow', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    map.setLayoutProperty('fires-core', 'visibility', showAppDots && styleMode !== 'heatmap' ? 'visible' : 'none');
    map.setLayoutProperty('fires-hot', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    map.setLayoutProperty('fires-halo', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    map.setLayoutProperty('fires-ember', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    map.setLayoutProperty('fires-night', 'visibility', showAppDots && styleMode !== 'heatmap' ? 'visible' : 'none');
    map.setLayoutProperty('fires-spread-fill', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    map.setLayoutProperty('fires-spread-line', 'visibility', 'none'); // decorative glow/halo/ring layers are off: plain dots only
    const visList = Object.keys(visible).filter((k) => visible[k]);
    const filter = ['in', ['get', 'sensor'], ['literal', visList]] as unknown as maplibregl.FilterSpecification;
    ['fires-heat', 'fires-glow', 'fires-core', 'fires-hot', 'fires-halo', 'fires-ember', 'fires-night'].forEach((l) => map.setFilter(l, filter));
  }, [displayData, ready, styleMode, visible, displayDay, regionKey, showAppDots]);

  // ---- EXTREME pulse halos (GL renderer) ----
  // The strongest detections (threat score ≥ 80) get a CSS-animated expanding
  // ring via maplibregl.Marker DOM elements — compositor animation, no GPU
  // work in the GL pipeline, so the eye lands on the worst fires instantly.
  const pulsesRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || gpuBlocked) return;
    for (const m of pulsesRef.current) m.remove();
    pulsesRef.current = [];
    if (!displayData) return;
    const extreme: Array<{ lat: number; lon: number }> = [];
    for (const [k, s] of Object.entries(displayData.sensors)) {
      if (!visible[k]) continue;
      for (const p of s.points) {
        if (threatBadge(p.frp || 0, typeof p.conf === 'number' ? p.conf : 60, p.night).score >= 80) extreme.push({ lat: p.lat, lon: p.lon });
      }
    }
    for (const e of extreme.slice(0, 0)) { // pulse halos off: plain dots only
      const el = document.createElement('div');
      el.className = 'ignis-pulse-wrap';
      el.style.pointerEvents = 'none';
      el.innerHTML = '<span class="ignis-pulse"></span>';
      try {
        pulsesRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([e.lon, e.lat]).addTo(map));
      } catch { /* map tearing down */ }
    }
    return () => {
      for (const m of pulsesRef.current) m.remove();
      pulsesRef.current = [];
    };
  }, [displayData, visible, ready, gpuBlocked, displayDay]);

  // ---- 3D fire towers on the map (GL renderer — maplibre fill-extrusion) ----
  // The WebGL sibling of the GPU-free FireField3D panel: the same hexbin
  // aggregation extruded ON the map itself — height = detections, color = mean
  // FRP. Free MapLibre capability, no extra keys, real 3D analysis over real
  // terrain; click a tower for the threat badge + inline AI verdict.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || gpuBlocked) return;
    if (!show3DTowers || !displayData) {
      for (const l of ['hex3d-fill', 'hex3d-line']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('hex3d')) map.removeSource('hex3d');
      return;
    }
    const pts = Object.entries(displayData.sensors).flatMap(([sensor, s]) => (visible[sensor] ? s.points : []));
    const { bin, maxN, features } = hexbin(pts, bbox);
    if (!features.length) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: features.map((g) => ({
        type: 'Feature' as const,
        properties: { n: g.n, frp: Math.round(g.frp), mf: Math.round(g.frp / Math.max(1, g.n)), t: g.n / Math.max(1, maxN) },
        geometry: { type: 'Polygon' as const, coordinates: [[[g.lon - bin / 2, g.lat - bin / 2], [g.lon + bin / 2, g.lat - bin / 2], [g.lon + bin / 2, g.lat + bin / 2], [g.lon - bin / 2, g.lat + bin / 2], [g.lon - bin / 2, g.lat - bin / 2]]] },
      })),
    };
    if (map.getSource('hex3d')) (map.getSource('hex3d') as maplibregl.GeoJSONSource).setData(fc);
    else {
      map.addSource('hex3d', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'hex3d-fill', type: 'fill-extrusion', source: 'hex3d',
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'mf'], 0, '#FDE68A', 25, '#FB923C', 120, '#EF4444', 300, '#7F1D1D'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['get', 't'], 0, 400, 1, 5200],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.62,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.addLayer({ id: 'hex3d-line', type: 'line', source: 'hex3d', paint: { 'line-color': 'rgba(254,215,170,0.35)', 'line-width': 0.6 } });
      map.on('click', 'hex3d-fill', (e) => {
        if (map.getLayer('fires-core') && map.queryRenderedFeatures(e.point, { layers: ['fires-core'] }).length) return;
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, number>;
        const popup = ignisPopup(map, e.lngLat, hexPopupHTML({ lat: e.lngLat.lat, lon: e.lngLat.lng, n: p.n, frp: p.frp, bin }, { regionKey, day: displayDay }), '280px');
        wireHotspotAI(popup.getElement(), askRef.current);
      });
    }
  }, [show3DTowers, displayData, visible, bbox, ready, gpuBlocked, displayDay, regionKey]);

  // ---- hexbin ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!displayData) return;
    const pts = Object.entries(displayData.sensors).flatMap(([sensor, s]) => (visible[sensor] ? s.points : []));
    const { bin, maxN, features } = hexbin(pts, bbox);
    const fc = {
      type: 'FeatureCollection' as const,
      features: features.map((g) => ({
        type: 'Feature' as const,
        properties: { n: g.n, frp: Math.round(g.frp), t: g.n / maxN },
        geometry: { type: 'Polygon' as const, coordinates: [[[g.lon - bin / 2, g.lat - bin / 2], [g.lon + bin / 2, g.lat - bin / 2], [g.lon + bin / 2, g.lat + bin / 2], [g.lon - bin / 2, g.lat + bin / 2], [g.lon - bin / 2, g.lat - bin / 2]]] },
      })),
    };
    if (map.getSource('hex')) (map.getSource('hex') as maplibregl.GeoJSONSource).setData(fc);
    else {
      map.addSource('hex', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'hex-fill', type: 'fill', source: 'hex', layout: { visibility: 'none' },
        paint: { 'fill-color': ['interpolate', ['linear'], ['get', 't'], 0, 'rgba(253,224,71,0.25)', 0.4, 'rgba(249,115,22,0.45)', 1, 'rgba(185,28,28,0.65)'] },
      });
      map.addLayer({
        id: 'hex-line', type: 'line', source: 'hex', layout: { visibility: 'none' },
        paint: { 'line-color': 'rgba(251,146,60,0.35)', 'line-width': 0.6 },
      });
      map.on('click', 'hex-fill', (e) => {
        // click-priority: if an individual fire detection sits under the pointer,
        // the per-hotspot popup (fires-core handler) owns this click — skip.
        if (map.getLayer('fires-core') && map.queryRenderedFeatures(e.point, { layers: ['fires-core'] }).length) return;
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, number>;
        const popup = ignisPopup(map, e.lngLat, hexPopupHTML({ lat: e.lngLat.lat, lon: e.lngLat.lng, n: p.n, frp: p.frp, bin }, { regionKey, day: displayDay }), '260px');
        wireHotspotAI(popup.getElement(), askRef.current);
      });
    }
    map.setLayoutProperty('hex-fill', 'visibility', showHex ? 'visible' : 'none');
    map.setLayoutProperty('hex-line', 'visibility', showHex ? 'visible' : 'none');
  }, [displayData, showHex, bbox, ready, visible]);

  // ---- fire segmentation + boundary identification ----
  // Deterministic in-browser DBSCAN -> convex-hull perimeters, computed once in page.tsx
  // and shared with the Fire Cluster Lab panel. Renders ORGANIZED fire objects
  // (megafire / established / emerging / scattered) with class-styled boundaries so the
  // map reads like an incident map instead of a point cloud.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!showSeg || !seg || !seg.clusters.length) {
      for (const l of ['seg-fill', 'seg-line', 'seg-core']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('seg')) map.removeSource('seg');
      return;
    }
    const fc = clustersToGeoJSON(seg.clusters) as unknown as maplibregl.GeoJSONSourceSpecification['data'];
    if (map.getSource('seg')) (map.getSource('seg') as maplibregl.GeoJSONSource).setData(fc);
    else {
      map.addSource('seg', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'seg-fill', type: 'fill', source: 'seg',
        paint: { 'fill-color': ['match', ['get', 'cls'], ...Object.entries(CLASS_STYLE).flatMap(([k, v]) => [k, v.fill]), 'rgba(148,163,184,0.08)'] as unknown as maplibregl.ExpressionSpecification, 'fill-opacity': 1 },
      });
      map.addLayer({
        id: 'seg-line', type: 'line', source: 'seg',
        paint: {
          'line-color': ['match', ['get', 'cls'], ...Object.entries(CLASS_STYLE).flatMap(([k, v]) => [k, v.stroke]), '#94A3B8'] as unknown as maplibregl.ExpressionSpecification,
          'line-width': ['match', ['get', 'cls'], ...Object.entries(CLASS_STYLE).flatMap(([k, v]) => [k, v.width]), 1] as unknown as maplibregl.ExpressionSpecification,
        },
      });
      map.addLayer({
        id: 'seg-core', type: 'circle', source: 'seg',
        paint: {
          // capped: a cluster of thousands of detections must stay a marker, not a disc that hides the fires
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['min', 7, ['+', 2.2, ['*', 0.9, ['sqrt', ['get', 'n']]]]], 8, ['min', 12, ['+', 5, ['*', 2.0, ['sqrt', ['get', 'n']]]]]],
          'circle-color': 'rgba(255,255,255,0.85)', 'circle-stroke-color': '#1C1917', 'circle-stroke-width': 1,
          'circle-opacity': 0.9,
        },
      });
      map.on('click', 'seg-fill', (ev) => {
        // click-priority: a click that lands on an individual fire detection
        // inside the hull belongs to the per-hotspot AI popup (fires-core
        // handler) — the cluster popup stays reachable on hull areas / centroid
        // where no single detection sits.
        if (map.getLayer('fires-core') && map.queryRenderedFeatures(ev.point, { layers: ['fires-core'] }).length) return;
        const f = ev.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string | number>;
        const popup = ignisPopup(map, ev.lngLat, clusterPopupHTML({
            id: p.id, cls: String(p.cls), n: Number(p.n), frpSum: Number(p.frp), meanFrp: Number(p.meanFrp),
            spreadKm: Number(p.spreadKm), areaKm2: Number(p.areaKm2), elongation: Number(p.elongation),
            nightPct: Number(p.nightPct), sensors: String(p.sensors),
            modelCls: p.modelCls !== undefined ? String(p.modelCls) : undefined,
            modelClsPct: p.modelClsPct !== undefined ? Number(p.modelClsPct) : undefined,
            centroidLat: p.flat !== undefined ? Number(p.flat) : undefined,
            centroidLon: p.flon !== undefined ? Number(p.flon) : undefined,
          } as ClusterCtx, { regionKey, day: displayDay }));
        wireHotspotAI(popup.getElement(), askRef.current);
      });
      map.on('mouseenter', 'seg-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'seg-fill', () => { map.getCanvas().style.cursor = pickRef.current ? 'crosshair' : ''; });
    }
  }, [seg, showSeg, ready]);

  // ---------- ML next-day footprint forecast overlay (ignis-fire-footprint-forecaster) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!forecast || !forecast.cells.length) {
      for (const l of ['fc-line', 'fc-fill']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('ignis-forecast')) map.removeSource('ignis-forecast');
      return;
    }
    const half = forecast.cellDeg / 2;
    const fc = {
      type: 'FeatureCollection' as const,
      features: forecast.cells.map((c) => ({
        type: 'Feature' as const,
        properties: { p: c.p },
        geometry: { type: 'Polygon' as const, coordinates: [[[c.lon - half, c.lat - half], [c.lon + half, c.lat - half], [c.lon + half, c.lat + half], [c.lon - half, c.lat + half], [c.lon - half, c.lat - half]]] },
      })),
    };
    if (map.getSource('ignis-forecast')) (map.getSource('ignis-forecast') as maplibregl.GeoJSONSource).setData(fc as unknown as GeoJSON.FeatureCollection);
    else {
      map.addSource('ignis-forecast', { type: 'geojson', data: fc as unknown as maplibregl.GeoJSONSourceSpecification['data'] });
      // insert UNDER the segmentation hulls so real boundaries stay readable
      const before = map.getLayer('seg-fill') ? 'seg-fill' : map.getLayer('fires-glow') ? 'fires-glow' : undefined;
      map.addLayer({
        id: 'fc-fill', type: 'fill', source: 'ignis-forecast',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'p'], 0.5, '#FDE047', 0.7, '#FB923C', 0.85, '#EF4444', 1, '#B91C1C'] as unknown as maplibregl.ExpressionSpecification,
          'fill-opacity': ['interpolate', ['linear'], ['get', 'p'], 0.5, 0.06, 0.7, 0.16, 0.85, 0.34, 1, 0.55] as unknown as maplibregl.ExpressionSpecification,
        },
      }, before);
      map.addLayer({
        id: 'fc-line', type: 'line', source: 'ignis-forecast',
        paint: { 'line-color': 'rgba(254,215,170,0.55)', 'line-width': 0.6 },
      }, before);
    }
  }, [forecast, ready]);

  // ---- v7.1 RainViewer live weather overlays (GL renderer) ----
  // radar = precipitation nowcast tiles · clouds = IR satellite — keyless,
  // refreshed every 5 min; standard Web-Mercator XYZ so no GIBS plumbing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const kinds: Array<[string, 'radar' | 'cloud']> = [['rainviewer-radar', 'radar'], ['rainviewer-clouds', 'cloud']];
    for (const [srcId, kind] of kinds) {
      const want = kind === 'radar' ? overlays.radar : overlays.clouds;
      const layerId = srcId;
      if (want && rain) {
        const path = kind === 'radar' ? rain.radarPath : rain.cloudPath;
        if (!path) continue;
        const url = rainTileUrl(path, kind);
        const src = map.getSource(srcId) as maplibregl.RasterTileSource | undefined;
        if (!src) {
          map.addSource(srcId, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 10, attribution: 'RainViewer' });
          map.addLayer({ id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': kind === 'radar' ? 0.65 : 0.45 } });
          if (map.getLayer('fires-halo')) map.moveLayer(layerId, 'fires-halo'); // under fire marks
        } else {
          try { (src as unknown as { setTiles: (t: string[]) => void }).setTiles([url]); } catch { /* noop */ }
          try { map.setPaintProperty(layerId, 'raster-opacity', kind === 'radar' ? 0.65 : 0.45); } catch { /* noop */ }
        }
      } else if (!want && map.getLayer(layerId)) {
        map.removeLayer(layerId);
        map.removeSource(srcId);
      }
    }
  }, [overlays.radar, overlays.clouds, rain, ready]);

  // ---- AOI interactions: click-pick + shift-drag ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let start: maplibregl.LngLat | null = null;
    let box: HTMLDivElement | null = null;

    const down = (e: maplibregl.MapMouseEvent) => {
      if (!e.originalEvent.shiftKey || pickRef.current) return;
      start = e.lngLat;
      map.dragPan.disable();
      box = document.createElement('div');
      box.style.cssText = 'position:absolute;border:1.5px dashed #38BDF8;background:rgba(56,189,248,0.08);pointer-events:none;z-index:20';
      map.getContainer().appendChild(box);
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      if (!start || !box) return;
      const minX = Math.min(start.lng, e.lngLat.lng), maxX = Math.max(start.lng, e.lngLat.lng);
      const minY = Math.min(start.lat, e.lngLat.lat), maxY = Math.max(start.lat, e.lngLat.lat);
      const p1 = map.project([minX, maxY]), p2 = map.project([maxX, minY]);
      box.style.left = `${p1.x}px`; box.style.top = `${p1.y}px`;
      box.style.width = `${p2.x - p1.x}px`; box.style.height = `${p2.y - p1.y}px`;
      (box as unknown as { _bbox: number[] })._bbox = [minX, minY, maxX, maxY];
    };
    const up = () => {
      if (!start || !box) return;
      const b = (box as unknown as { _bbox?: number[] })._bbox;
      box.remove(); box = null;
      map.dragPan.enable();
      start = null;
      if (b && Math.abs(b[2] - b[0]) > 0.5 && Math.abs(b[3] - b[1]) > 0.5) onPickRef.current(b.map((v) => +v.toFixed(2)));
    };
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', up);

    const click = (e: maplibregl.MapMouseEvent) => {
      if (!pickRef.current) return;
      const { lng, lat } = e.lngLat;
      onPickRef.current([+(lng - 2.25).toFixed(2), +(lat - 2).toFixed(2), +(lng + 2.25).toFixed(2), +(lat + 2).toFixed(2)]);
    };
    map.on('click', click);

    map.on('click', 'eonet-ring', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string>;
      ignisPopup(map, e.lngLat, `<div style="font:12px/1.5 ui-sans-serif"><div style="font-weight:700;color:#7DD3FC">🌐 EONET wildfire event</div><div>${p.title}</div><div style="color:#94A3B8">${p.date?.slice(0, 10)}</div><a href="${p.link}" target="_blank" rel="noreferrer" style="color:#38BDF8">NASA EONET details →</a></div>`, '260px');
    });

    return () => { map.off('mousedown', down); map.off('mousemove', move); map.off('mouseup', up); map.off('click', click); };
  }, [ready]);

  // ---- animation playback ----
  useEffect(() => {
    if (!playing || !dayKeys.length) return;
    const idx = animDay ? dayKeys.indexOf(animDay) : -1;
    const t = setTimeout(() => {
      const next = dayKeys[(idx + 1) % dayKeys.length];
      setAnimDay(next);
      setHudDay(next);
    }, speed);
    return () => clearTimeout(t);
  }, [playing, animDay, dayKeys, speed]);

  // reset animation when the selected day changes (React "adjust state during render" pattern)
  const [prevDay, setPrevDay] = useState(day);
  if (prevDay !== day) {
    setPrevDay(day);
    setHudDay(day);
    setAnimDay(null);
    setPlaying(false);
  }

  const stats = useMemo(() => {
    if (!displayData) return null;
    let count = 0, frpSum = 0, hi = 0, night = 0, maxFrp = 0;
    for (const [k, s] of Object.entries(displayData.sensors)) {
      if (!visible[k]) continue;
      count += s.count; frpSum += s.points.reduce((a, p) => a + (p.frp || 0), 0);
      hi += s.hiConf; night += Math.round((s.nightPct / 100) * s.count);
      maxFrp = Math.max(maxFrp, s.maxFrp);
    }
    return { count, meanFrp: count ? frpSum / count : 0, hiPct: count ? (hi / count) * 100 : 0, nightPct: count ? (night / count) * 100 : 0, maxFrp };
  }, [displayData, visible]);

  const perSensor = useMemo(() => {
    const m: Record<string, number> = {};
    if (displayData) for (const [k, s] of Object.entries(displayData.sensors)) m[k] = s.count;
    return m;
  }, [displayData]);

  // per-hotspot early-warning rollup (client heuristic — zero network)
  const threat = useMemo(() => {
    if (!displayData) return { hi: 0, ext: 0 };
    let hi = 0, ext = 0;
    for (const [k, s] of Object.entries(displayData.sensors)) {
      if (!visible[k]) continue;
      for (const p of s.points) {
        const sc = threatBadge(p.frp || 0, typeof p.conf === 'number' ? p.conf : 60, p.night).score;
        if (sc >= 80) ext += 1;
        else if (sc >= 62) hi += 1;
      }
    }
    return { hi, ext };
  }, [displayData, visible]);

  const playIdx = animDay ? Math.max(0, dayKeys.indexOf(animDay)) : 0;

  const bm = GIBS_BASEMAPS[basemapKey];

  return (
    <div className={`overflow-hidden ${focus ? 'fixed inset-0 z-[70] rounded-none border-0 bg-[#050A14]' : 'relative h-full w-full rounded-xl border border-[#14273F]'}`}>
      {/* shared pulse-halo CSS — EXTREME hotspots breathe on both renderers */}
      <style>{`
        .ignis-pulse-wrap { position: relative; display: block; width: 30px; height: 30px; margin: -15px 0 0 -15px; }
        .ignis-pulse { display: block; width: 100%; height: 100%; border-radius: 9999px; border: 2px solid rgba(248,113,113,0.85); background: rgba(239,68,68,0.12); box-shadow: 0 0 14px rgba(239,68,68,0.65), inset 0 0 8px rgba(239,68,68,0.35); animation: ignis-pulse 1.9s ease-out infinite; }
        @keyframes ignis-pulse { 0% { transform: scale(0.32); opacity: 1; } 72% { transform: scale(1.12); opacity: 0; } 100% { transform: scale(1.12); opacity: 0; } }
        .ignis-range { accent-color: #f97316; height: 12px; }
      `}</style>
      {gpuBlocked && !useBasicMap ? (
        <div className="flex h-full w-full items-center justify-center bg-[#050A14] p-6" role="alert">
          <div className="max-w-xl rounded-xl border border-amber-500/40 bg-[#1A1206]/90 p-5 text-[12px] leading-relaxed text-amber-100">
            <div className="text-sm font-bold text-amber-200">The map could not start</div>
            <p className="mt-1 text-amber-100/90">{gpuWhy || 'WebGL2 is not available in this browser.'}</p>
            <p className="mt-3 font-semibold text-amber-200">How to fix it</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-amber-100/90">
              <li>Chrome or Edge: open <b>Settings → System</b>, switch on <b>&ldquo;Use graphics acceleration when available&rdquo;</b>, then click <b>Relaunch</b>.</li>
              <li>Open <b>chrome://gpu</b> (or <b>edge://gpu</b>) and check that <b>WebGL2</b> says &ldquo;Hardware accelerated&rdquo;.</li>
              <li>If it is still off: update the graphics driver, close remote-desktop sessions, or try another browser.</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={retryInteractive} className="rounded border border-amber-400/60 bg-amber-500/20 px-3 py-1.5 font-bold text-amber-50 hover:bg-amber-500/30">↻ Try again</button>
              <button onClick={() => setUseBasicMap(true)} className="rounded border border-[#1E3A5F] px-3 py-1.5 text-slate-300 hover:text-slate-100">Open the basic map instead</button>
            </div>
          </div>
        </div>
      ) : gpuBlocked ? (
        <LeafletFireMap
          bbox={bbox}
          regionKey={regionKey}
          day={displayDay}
          displayData={displayData}
          visible={visible}
          styleMode={styleMode}
          basemapKey={basemapKey}
          overlays={overlays}
          weather={weather}
          showHex={showHex}
          showSeg={showSeg}
          seg={seg}
          forecast={forecast}
          eonet={eonet}
          pickMode={pickMode}
          onPick={onPick}
          onAskAi={onAskAi}
          flyTarget={flyTarget}
          resizeNonce={resizeNonce}
          onCursor={onCursorLeaflet}
          worldPts={worldPtsShown}
        />
      ) : (
        <div ref={containerRef} className={`h-full w-full ${pickMode ? 'cursor-crosshair' : ''}`} />
      )}

      {/* v7.1 WORLDVIEW — nullschool wind streamlines (GL branch; Leaflet branch mounts its own) */}
      {!gpuBlocked && (
        <WindCanvas enabled={!!overlays.wind} bbox={bbox} getProjector={glProjector} />
      )}

      {/* Top-left HUD — compact by default (map visibility first); click to expand the full telemetry */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(20rem,calc(100vw-8rem))] flex-col gap-1.5 rounded-lg border border-[#14273F] bg-[#050A14]/88 text-[11px] leading-4 text-slate-300 backdrop-blur md:max-w-[300px]">
        <button onClick={() => setHudOpen((o) => !o)}
          aria-expanded={hudOpen}
          className="pointer-events-auto flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[#0C1A2E]/60"
          title={hudOpen ? 'Collapse detection telemetry' : 'Expand detection telemetry'}>
          <span className="font-mono text-[15px] font-bold leading-none text-orange-300">{stats ? stats.count.toLocaleString() : '—'}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${displayData?.source === 'firms-api' ? 'bg-emerald-900/70 text-emerald-300' : displayData?.source === 'mixed' ? 'bg-amber-900/70 text-amber-300' : 'bg-sky-900/70 text-sky-300'}`}>
            {displayData?.source === 'firms-api' ? 'FIRMS LIVE' : displayData?.source === 'mixed' ? 'FIRMS+GIBS' : 'GIBS MVT'}
          </span>
          {threat.ext + threat.hi > 0 && (
            <span className="rounded bg-rose-950/70 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">⚠ {threat.ext + threat.hi}</span>
          )}
          <span className="ml-auto pl-1 text-[9px] text-slate-500">{hudOpen ? '▴' : `▾ ${hudDay}`}</span>
        </button>
        {hudOpen && (
          <div className="flex flex-col gap-1.5 px-3 pb-2.5">
            <div className="text-[10px] text-slate-400"><b className="text-slate-200">{hudDay}</b> · active fire detections{stats ? ` · max FRP ${stats.maxFrp.toFixed(0)} MW` : ''}</div>
            {stats && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                <span>mean FRP <b className="text-slate-200">{stats.meanFrp.toFixed(1)} MW</b></span>
                <span>max FRP <b className="text-slate-200">{stats.maxFrp.toFixed(0)} MW</b></span>
                <span>hi-conf <b className="text-slate-200">{stats.hiPct.toFixed(0)}%</b></span>
                <span>night <b className="text-slate-200">{stats.nightPct.toFixed(0)}%</b></span>
              </div>
            )}
            {threat.ext + threat.hi > 0 && (
              <div className="rounded bg-rose-950/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-200">
                ⚠ live threat rollup: {threat.ext} EXTREME · {threat.hi} high-threat hotspot{threat.hi === 1 ? '' : 's'}
              </div>
            )}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {Object.keys(SENSOR_COLORS).map((k) => (
                <button key={k} onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
                  title={`${k}: ${perSensor[k]?.toLocaleString() ?? 0} detections`}
                  className={`pointer-events-auto flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] transition-opacity ${visible[k] ? 'border-[#1E3A5F]' : 'border-[#1E3A5F] opacity-35'}`}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SENSOR_COLORS[k] }} />{k.replace('VIIRS-', 'V-')}{perSensor[k] ? <b className="font-mono text-[8.5px] text-slate-400">{perSensor[k] > 999 ? `${(perSensor[k] / 1000).toFixed(1)}k` : perSensor[k]}</b> : null}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-slate-500">renderer: {gpuBlocked ? 'Leaflet DOM · GPU-free' : 'MapLibre GL · WebGL2'}</div>
          </div>
        )}
      </div>

      {/* Right controls — shared by both renderers (MapLibre GL / Leaflet DOM) */}
      <div className="absolute right-2 top-12 z-10 flex max-w-[56vw] flex-col items-end gap-1.5 text-[10.5px] md:right-3 md:top-16 md:max-w-none">
        <select value={basemapKey} onChange={(e) => setBasemapKey(e.target.value)}
          aria-label="Basemap imagery"
          className="max-w-full rounded border border-[#1E3A5F] bg-[#050A14]/90 px-2 py-1.5 text-[10px] text-slate-200 backdrop-blur outline-none md:text-[10.5px]">
          {Object.entries(GIBS_BASEMAPS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {basemapKey === 'truecolor_pace' && displayDay > new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10) && (
          <div role="status" className="max-w-[250px] rounded border border-amber-500/50 bg-[#1A1206]/90 px-2 py-1 text-right text-[10px] leading-snug text-amber-200">
            <b>No PACE picture for {displayDay}.</b> NASA publishes PACE imagery about 5 days late. Pick an earlier Map date, or choose another imagery layer.
          </div>
        )}
        <button onClick={toggleWorldView} aria-pressed={worldView}
          title="Whole-world view like NASA Worldview: every fire detected that day (VIIRS NOAA-20, NOAA-21, MODIS Terra, MODIS combined) as dots over the true-color satellite photo"
          className={`rounded border px-2.5 py-1.5 text-[10.5px] font-semibold backdrop-blur transition-colors ${worldView ? 'border-[#F87171] bg-[#EF4444]/25 text-[#FECACA]' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-200 hover:border-[#F87171]'}`}>
          🌍 {worldView ? 'Exit world fire view' : 'World fire view'}
        </button>
        {worldView && (
          <div role="status" className="max-w-[260px] rounded border border-[#1E3A5F] bg-[#050A14]/90 px-2 py-1 text-right text-[9.5px] text-slate-300 backdrop-blur">
            {worldError ? <span className="text-amber-300">{worldError}</span>
              : worldPts ? <><b className="text-slate-100">{(worldPts.length / 3).toLocaleString()}</b> fire detections worldwide · {displayDay} · source NASA GIBS</>
                : 'Loading the world fire layers from NASA…'}
          </div>
        )}
        {worldView && worldPts && worldFires && worldFires.layers.length > 0 && (
          <div className="w-[260px] rounded border border-[#1E3A5F] bg-[#050A14]/90 p-1.5 text-left backdrop-blur" role="group" aria-label="Fires and thermal anomalies layers">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Fires and thermal anomalies</div>
            {worldFires.layers.map((l, i) => {
              const off = !!worldHidden[i];
              const viirs = i < 2;
              return (
                <button key={l.id} onClick={() => setWorldHidden((h) => ({ ...h, [i]: !h[i] }))} aria-pressed={!off}
                  title={`${l.id} — click to ${off ? 'show' : 'hide'}`}
                  className={`mb-0.5 flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-[9.5px] transition-opacity ${off ? 'border-[#13253D] opacity-45' : 'border-[#1E3A5F]'}`}>
                  <span aria-hidden>{off ? '🚫' : '👁'}</span>
                  <span className="inline-block h-2 w-2 shrink-0" style={{ backgroundColor: viirs ? '#FF1F1F' : '#FF7A00' }} />
                  <span className="flex-1 text-left text-slate-200">
                    {viirs ? 'Day and Night, 375 m' : 'Day and Night, 1 km'}
                    <span className="block text-[8.5px] italic text-slate-400">{['NOAA-20 / VIIRS', 'NOAA-21 / VIIRS', 'Terra / MODIS', 'Terra and Aqua / MODIS'][i] ?? l.label}</span>
                  </span>
                  <b className="font-mono text-[9px] text-slate-300">{l.count.toLocaleString()}</b>
                </button>
              );
            })}
          </div>
        )}
        {/* Zoom-Earth-style quick windows — one tap reframes the temporal lens */}
        <div className="flex overflow-hidden rounded border border-[#1E3A5F] bg-[#050A14]/90 backdrop-blur" role="group" aria-label="Quick time window">
          {([['24H', 1], ['48H', 2], ['7D', 7]] as [string, number][]).map(([label, d]) => {
            const active = d === 1 ? dayKeys.length <= 1 : dayKeys.length === d;
            return (
              <button key={label} onClick={() => onSetWindow?.(d)}
                className={`px-2.5 py-1.5 text-[10px] font-bold tracking-wide ${active ? 'bg-[#F97316] text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}>{label}</button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded border border-[#1E3A5F] bg-[#050A14]/90 backdrop-blur md:flex">
          {(['intensity', 'sensor', 'confidence', 'heatmap'] as StyleMode[]).map((m, i) => (
            <button key={m} onClick={() => setStyleMode(m)} title={`${m} mode (key ${i + 1})`} className={`px-2 py-1.5 text-[9.5px] capitalize md:text-[10px] ${styleMode === m ? 'bg-[#38BDF8] text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}>{m}</button>
          ))}
        </div>
        {/* primary actions stay one tap away; everything else lives in the Layers popover */}
        <div className="flex items-center gap-1">
          <button onClick={() => setLayersOpen((o) => !o)}
            title="Overlays: GIBS imagery, fire pixels, hexbin, segmentation, ML forecast, 3D towers (L)"
            aria-expanded={layersOpen}
            className={`flex items-center gap-1 rounded border px-2 py-1.5 font-semibold backdrop-blur transition-colors ${layersOpen ? 'border-[#38BDF8] bg-[#38BDF8]/20 text-[#7DD3FC]' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-300 hover:text-slate-100'}`}>
            <Layers className="h-3.5 w-3.5" aria-hidden /> Layers {layersOpen ? '▴' : '▾'}
          </button>
          <button onClick={() => setShow3D((s) => !s)}
            title="3D Fire Field — isometric extruded fire towers (GPU-free canvas, works everywhere); click a tower to fly + AI-assess (G)"
            className={`flex items-center gap-1 rounded border px-2 py-1.5 backdrop-blur transition-colors ${show3D ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-300 hover:text-slate-100'}`}>
            <Boxes className="h-3.5 w-3.5" aria-hidden /> 3D
          </button>
          {!gpuBlocked && (
            <button onClick={() => setShowTerrainScene((t) => !t)}
              title="3D Terrain Scene — Three.js: real DEM elevation + NASA satellite drape + precision fire columns (WebGL renderer)"
              className={`flex items-center gap-1 rounded border px-2 py-1.5 font-semibold backdrop-blur transition-colors ${showTerrainScene ? 'border-orange-400 bg-orange-500/20 text-orange-200' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-300 hover:text-slate-100'}`}>
              <Globe className="h-3.5 w-3.5" aria-hidden /> 3D
            </button>
          )}
          {!gpuBlocked && (
            <button onClick={() => setTerrain3D((t) => !t)}
              title="3D terrain — AWS Terrarium DEM elevation + hillshade relief (WebGL renderer only) (T)"
              aria-pressed={terrain3D}
              className={`rounded border px-2 py-1.5 backdrop-blur transition-colors ${terrain3D ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-300 hover:text-slate-100'}`}>
              <Mountain className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button onClick={() => setShortcutsOpen((o) => !o)}
            title="Keyboard shortcuts (K)"
            aria-expanded={shortcutsOpen}
            className={`rounded border px-2 py-1.5 backdrop-blur transition-colors ${shortcutsOpen ? 'border-[#38BDF8] bg-[#38BDF8]/20 text-[#7DD3FC]' : 'border-[#1E3A5F] bg-[#050A14]/90 text-slate-300 hover:text-slate-100'}`}>
            <Keyboard className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button onClick={() => { setFocus((f) => !f); setResizeNonce((n) => n + 1); }}
            title={focus ? 'Exit fullscreen map (Esc)' : 'Fullscreen map — maximize the view (F)'}
            className="rounded border border-[#1E3A5F] bg-[#050A14]/90 px-2 py-1.5 text-slate-300 backdrop-blur transition-colors hover:text-slate-100">
            {focus ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
        {layersOpen && (
          <div className="w-[min(13rem,calc(100vw-5rem))] rounded-lg border border-[#1E3A5F] bg-[#050A14]/95 p-2 shadow-2xl backdrop-blur md:w-52">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">GIBS imagery</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(GIBS_OVERLAYS).map(([k, v]) => (
                <button key={k} onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}
                  title={v.note}
                  className={`rounded border px-1.5 py-1 transition-colors ${overlays[k] ? 'border-[#38BDF8] bg-[#38BDF8]/20 text-[#7DD3FC]' : 'border-[#1E3A5F] text-slate-400'}`}>
                  {v.label.split('(')[0].trim()}
                </button>
              ))}
            </div>
            <div className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">Analysis layers</div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setShowHex((h) => !h)}
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${showHex ? 'border-[#38BDF8] bg-[#38BDF8]/20 text-[#7DD3FC]' : 'border-[#1E3A5F] text-slate-400'}`}>
                <Hexagon className="h-3 w-3" aria-hidden /> Hexbin density
              </button>
              <button onClick={() => setShowSeg((s) => !s)}
                title="DBSCAN segmentation + convex-hull fire boundaries — organized fire objects from raw hotspots (S)"
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${showSeg ? 'border-orange-400 bg-orange-500/20 text-orange-200' : 'border-[#1E3A5F] text-slate-400'}`}>
                <Scan className="h-3 w-3" aria-hidden /> Segmentation
              </button>
              <button onClick={() => onToggleForecast?.()}
                title="ignis-fire-footprint-forecaster — predicted next-day fire-complex footprint (0.05° probability field)"
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${(forecast || forecastLoading) ? 'border-violet-400 bg-violet-500/20 text-violet-200' : 'border-[#1E3A5F] text-slate-400'}`}>
                <Sparkles className="h-3 w-3" aria-hidden /> {forecastLoading ? 'computing…' : 'ML forecast'}
              </button>
              {!gpuBlocked && (
                <button onClick={() => setShow3DTowers((s) => !s)}
                  title="3D fire towers extruded on the map — height = detections, color = mean FRP (WebGL renderer) (B)"
                  className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${show3DTowers ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200' : 'border-[#1E3A5F] text-slate-400'}`}>
                  <Boxes className="h-3 w-3" aria-hidden /> 3D towers on map
                </button>
              )}
            </div>
            <div className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">Live weather · keyless feeds</div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setOverlays((o) => ({ ...o, gibsfires: !o.gibsfires }))} aria-pressed={!!overlays.gibsfires}
                title="Fires detected in the selected area on the chosen Map date — NASA layers VIIRS NOAA-20, VIIRS NOAA-21 (red) and MODIS Terra, MODIS Terra+Aqua (orange). Click a dot for details."
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${overlays.gibsfires ? 'border-[#F87171] bg-[#EF4444]/20 text-[#FCA5A5]' : 'border-[#1E3A5F] text-slate-400'}`}>
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#FF1F1F' }} /> Fire dots (map date)
              </button>
              <button onClick={() => setOverlays((o) => ({ ...o, eonet: !o.eonet }))} aria-pressed={!!overlays.eonet}
                title="Reported wildfires. Yellow rings = GDACS alerts (EU/UN, worldwide). Blue rings = NASA EONET incidents (US only, from IRWIN). Click a ring for details."
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${overlays.eonet ? 'border-[#7DD3FC] bg-[#38BDF8]/20 text-[#BAE6FD]' : 'border-[#1E3A5F] text-slate-400'}`}>
                <span aria-hidden className="inline-block h-2 w-2 rounded-full border border-[#38BDF8]" /> Reported wildfires
              </button>
              <button onClick={() => setOverlays((o) => ({ ...o, wind: !o.wind }))}
                title="earth.nullschool-style wind streamlines — Open-Meteo 10 m wind, animated particles (W)"
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${overlays.wind ? 'border-[#7DD3FC] bg-[#38BDF8]/20 text-[#BAE6FD]' : 'border-[#1E3A5F] text-slate-400'}`}>
                <Wind className="h-3 w-3" aria-hidden /> Wind streamlines
              </button>
              <button onClick={() => setOverlays((o) => ({ ...o, radar: !o.radar }))}
                title="RainViewer live precipitation radar — latest past frame, refreshed every 5 min"
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${overlays.radar ? 'border-[#60A5FA] bg-[#3B82F6]/20 text-[#BFDBFE]' : 'border-[#1E3A5F] text-slate-400'}`}>
                <CloudLightning className="h-3 w-3" aria-hidden /> Rain radar
              </button>
              <button onClick={() => setOverlays((o) => ({ ...o, clouds: !o.clouds }))}
                title="RainViewer infrared satellite clouds — live weather-context layer"
                className={`flex items-center gap-1 rounded border px-1.5 py-1 transition-colors ${overlays.clouds ? 'border-slate-300 bg-slate-400/20 text-slate-100' : 'border-[#1E3A5F] text-slate-400'}`}>
                <Cloudy className="h-3 w-3" aria-hidden /> IR clouds
              </button>
            </div>
            {/* Windy-style master overlay opacity */}
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-slate-500">
                <span>Overlay strength</span>
                <span className="font-mono text-slate-400">{Math.round(ovOpacity * 100)}%</span>
              </div>
              <input type="range" min={20} max={100} value={Math.round(ovOpacity * 100)}
                onChange={(e) => setOvOpacity(Number(e.target.value) / 100)}
                className="ignis-range w-full" aria-label="Overlay opacity" />
            </div>
          </div>
        )}
        {dayKeys.length > 1 && (
          <div className="pointer-events-none w-[min(11rem,calc(100vw-5rem))] rounded border border-[#14273F] bg-[#050A14]/85 px-2 py-1.5 backdrop-blur md:w-44">
            <button onClick={() => setPlaying((p) => !p)}
              className={`pointer-events-auto mb-1 w-full rounded border px-2.5 py-1.5 font-bold ${playing ? 'border-orange-400 bg-orange-500/20 text-orange-300' : 'border-[#38BDF8] bg-[#38BDF8]/15 text-[#7DD3FC]'}`}>
              {playing ? '❚❚ Pause replay' : `▶ Replay ${dayKeys.length} days`}
            </button>
            <input type="range" min={0} max={Math.max(0, dayKeys.length - 1)} value={playIdx}
              onChange={(e) => { const i = Number(e.target.value); setAnimDay(dayKeys[i]); setHudDay(dayKeys[i]); setPlaying(false); }}
              className="ignis-range w-full" aria-label="Replay timeline scrubber" />
            <div className="mt-0.5 flex items-center justify-between text-[9px] text-slate-500">
              <span>{playIdx + 1}/{dayKeys.length} · {animDay ?? day}</span>
              <button onClick={() => setSpeed((sp) => (sp === 1600 ? 900 : sp === 900 ? 450 : 1600))}
                className="pointer-events-auto rounded px-1 text-[#7DD3FC] hover:bg-[#0F1D31]" title="replay speed">
                {(speed / 1000).toFixed(speed % 1000 !== 0 ? 1 : 0)}s/day
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend — collapsed to a one-tap chip by default (map visibility first) */}
      {legendOpen ? (
      <div className={`pointer-events-none absolute left-3 z-10 rounded-lg border border-[#14273F] bg-[#050A14]/88 px-3 py-2 text-[10px] text-slate-300 backdrop-blur ${gpuBlocked ? 'bottom-24' : 'bottom-10'}`}>
        {styleMode === 'heatmap' ? (
          <>
            <div className="mb-1 font-semibold text-slate-200">Detection density (FRP-weighted)</div>
            <div className="h-2 w-40 rounded" style={{ backgroundImage: 'linear-gradient(90deg,#1D4ED8,#0891B2,#FDE047,#F97316,#DC2626,#FECACA)' }} />
            <div className="mt-0.5 flex w-40 justify-between text-[9px] text-slate-500"><span>sparse</span><span>dense</span></div>
          </>
        ) : styleMode === 'sensor' ? (
          <>
            <div className="mb-1 font-semibold text-slate-200">Sensor · size = FRP</div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {Object.entries(SENSOR_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />{k}</span>
              ))}
            </div>
          </>
        ) : styleMode === 'confidence' ? (
          <>
            <div className="mb-1 font-semibold text-slate-200">Detection confidence</div>
            <div className="h-2 w-40 rounded" style={{ backgroundImage: CONF_GRADIENT }} />
            <div className="mt-0.5 flex w-40 justify-between text-[9px] text-slate-500"><span>0 (VIIRS low ≈30)</span><span>90+</span></div>
          </>
        ) : (
          <>
            <div className="mb-1 font-semibold text-slate-200">Fire radiative power (MW)</div>
            <div className="h-2 w-40 rounded" style={{ backgroundImage: FRP_GRADIENT }} />
            <div className="mt-0.5 flex w-40 justify-between text-[9px] text-slate-500"><span>0</span><span>25</span><span>120</span><span>500+</span></div>
            <div className="mt-1 text-[9px] text-slate-500">white core = FRP ≥ 150 MW · radius ∝ √FRP</div>
          </>
        )}
        {(overlays.lst_day || overlays.lst_night) && (
          <>
            <div className="mb-1 mt-2 font-semibold text-slate-200">Land surface temperature (MOD11, °C)</div>
            <div className="h-2 w-40 rounded" style={{ backgroundImage: `linear-gradient(90deg,${LST_RAMP.map(([, c]) => c).join(',')})` }} />
            <div className="mt-0.5 flex w-40 justify-between text-[9px] text-slate-500"><span>-25°</span><span>0°</span><span>25°</span><span>50°+</span></div>
            <div className="mt-1 text-[9px] text-slate-500">LP DAAC MOD11: K = raw × 0.02 · ε = raw × 0.02 + 0.49 · fill = 0</div>
          </>
        )}
        {overlays.gibsfires && (
          <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#FF2A12' }} />
            Fires on {displayDay}: red = VIIRS (NOAA-20, NOAA-21) · orange = MODIS{nasaDots && nasaDots.day === displayDay && !nasaDots.error ? ` · ${nasaDots.count.toLocaleString()} in this area` : ''}
          </div>
        )}
        {overlays.gibsfires && !worldView && nasaDots && nasaDots.day === displayDay && (nasaDots.error || nasaDots.count === 0) && (
          <div role="status" className="pointer-events-auto mt-1 max-w-[250px] rounded border border-amber-500/50 bg-[#1A1206]/90 px-2 py-1 text-[10px] leading-snug text-amber-200">
            {nasaDots.error
              ? <>Could not load NASA&rsquo;s fire layers for {displayDay}. Check the internet connection and reload.</>
              : <><b>No fire dots for {displayDay}.</b> NASA has published no detections in this area for that date. If it is today&rsquo;s date, the data and the satellite photo are not out yet: set <b>Map date</b> to yesterday or earlier.</>}
          </div>
        )}
        {showSeg && seg && seg.clusters.length > 0 && (
          <>
            <div className="mb-1 mt-2 font-semibold text-slate-200">Fire segmentation · {seg.clusters.length} clusters</div>
            {(['MEGAFIRE', 'ESTABLISHED', 'EMERGING', 'SCATTERED'] as ClusterClass[]).map((c) => {
              const n = seg.clusters.filter((x) => x.cls === c).length;
              if (!n) return null;
              return (
                <div key={c} className="mt-0.5 flex items-center gap-1.5 text-[9px] text-slate-500">
                  <span className="inline-block h-2 w-2.5 rounded-sm" style={{ border: `1.5px solid ${CLASS_STYLE[c].stroke}`, background: CLASS_STYLE[c].fill }} />
                  {CLASS_STYLE[c].label} × {n}
                </div>
              );
            })}
            <div className="mt-1 text-[9px] text-slate-500">DBSCAN ε={seg.epsDeg}° · minPts {seg.minPts} · {seg.clusteredPct.toFixed(0)}% of points clustered · white dot = cluster core</div>
          </>
        )}
        {forecast && (
          <>
            <div className="mb-1 mt-2 font-semibold text-violet-200">🔮 Next-day risk field (ML) · {forecast.targetDay}</div>
            <div className="h-2 w-40 rounded" style={{ backgroundImage: 'linear-gradient(90deg,#FDE047,#FB923C,#EF4444,#B91C1C)' }} />
            <div className="mt-0.5 flex w-40 justify-between text-[9px] text-slate-500"><span>P=0.5</span><span>0.7</span><span>0.85</span><span>1.0</span></div>
            <div className="mt-1 text-[9px] leading-relaxed text-slate-500">
              relative probability envelope · {forecast.stats.predicted.toLocaleString()} cells (p≥0.5) · {forecast.stats.hiConfCells.toLocaleString()} high-confidence (p≥0.85) ·
              top-2k alignment {forecast.stats.topAlignedPct}% · {FORECASTER_META.name} {forecast.modelVersion} · {forecast.domain}
            </div>
          </>
        )}
        <div className="mt-1 text-[9px] text-slate-500">basemap: {bm.label}{bm.daily ? ` · ${displayDay}` : ''}</div>
      </div>
      ) : (
        <button onClick={() => setLegendOpen(true)} title="Show map legend"
          className={`pointer-events-auto absolute left-3 z-10 flex items-center gap-1.5 rounded-lg border border-[#14273F] bg-[#050A14]/88 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 backdrop-blur transition-colors hover:text-slate-100 ${gpuBlocked ? 'bottom-24' : 'bottom-10'}`}>
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundImage: FRP_GRADIENT }} />
          ⓘ Legend
        </button>
      )}

      {show3D && (
        <div className="absolute inset-x-3 bottom-3 z-20 flex justify-center">
          <div className={`w-full ${focus ? 'max-w-4xl' : 'max-w-2xl'}`}>
            <FireField3D
              bbox={bbox}
              day={displayDay}
              regionKey={regionKey}
              displayData={displayData}
              visible={visible}
              onFlyTo={flyToCell}
              onAskAi={onAskAi}
              onClose={() => setShow3D(false)}
            />
          </div>
        </div>
      )}
      {showTerrainScene && !gpuBlocked && (
        <TerrainScene3D
          bbox={bbox}
          day={displayDay}
          regionKey={regionKey}
          displayData={displayData}
          visible={visible}
          onAskAi={onAskAi}
          onFlyTo={flyToCell}
          onClose={() => setShowTerrainScene(false)}
        />
      )}
      {/* Nullschool-style cursor probe — what is under the crosshair right now */}
      {probe && !pickMode && (
        <div className="ignis-probe pointer-events-none absolute bottom-3 left-1/2 z-10 hidden max-w-[92%] -translate-x-1/2 truncate rounded border border-[#14273F] bg-[#050A14]/85 px-2.5 py-1 backdrop-blur sm:block">
          <b>{probe.lat.toFixed(3)}°, {probe.lon.toFixed(3)}°</b>
          {probe.src === 'gl' ? (
            probe.hits > 0 ? (
              <span> · <b>{probe.hits}</b> fire pixel{probe.hits === 1 ? '' : 's'} · max <b>{Math.round(probe.maxFrp)} MW</b> · {probe.sensor}{probe.conf ? ` · conf ${Math.round(probe.conf)}%` : ''}</span>
            ) : (
              <span> · no fire pixels under cursor</span>
            )
          ) : (
            <span> · GL renderer adds full cursor telemetry</span>
          )}
        </div>
      )}

      {/* v7.1 cinematic replay chip — Worldview-style temporal playback readout */}
      {playing && dayKeys.length > 1 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-orange-400/50 bg-[#050A14]/90 px-3.5 py-1.5 backdrop-blur elev-ember">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
            </span>
            <span className="font-mono text-[12px] font-bold tracking-wider text-orange-200">▶ REPLAY · {displayDay}</span>
            <span className="text-[10px] text-slate-400">day {playIdx + 1}/{dayKeys.length}</span>
          </div>
        </div>
      )}

      {/* Keyboard cheat-sheet (K) */}
      {shortcutsOpen && (
        <div className="ignis-glass elev-3 absolute bottom-14 right-3 z-20 w-64 rounded-lg p-3 text-[10.5px] text-slate-300">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Keyboard shortcuts</span>
            <button onClick={() => setShortcutsOpen(false)} className="text-slate-500 hover:text-slate-200" aria-label="close shortcuts">✕</button>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
            {([
              ['F', 'fullscreen map'], ['L', 'layers panel'], ['T', '3D terrain'], ['G', '3D fire field'],
              ['B', '3D towers on map'], ['R', 'replay window'], ['W', 'wind streamlines'], ['H', 'hexbin density'], ['S', 'segmentation'],
              ['1-4', 'style modes'], ['K', 'this cheat sheet'], ['Esc', 'exit fullscreen'],
            ] as [string, string][]).map(([k, d]) => (
              <div key={k} className="contents">
                <span className="ignis-kbd">{k}</span>
                <span className="text-slate-400">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {pickMode && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-cyan-500/40 bg-cyan-950/80 px-3 py-1.5 text-[11px] text-cyan-200 backdrop-blur">
          AOI pick mode — click anywhere to define a ±2° box (or hold Shift and drag to draw any rectangle)
        </div>
      )}
      {showHint && !pickMode && !focus && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded border border-[#14273F] bg-[#050A14]/70 px-2 py-1 text-[9.5px] text-slate-500 backdrop-blur sm:block">
          Shift + drag = custom AOI · click any fire for threat + AI
        </div>
      )}
      {gpuBlocked && useBasicMap && !bannerOff && (
        <div className="absolute bottom-12 left-1/2 z-10 flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-[#1A1206]/92 px-2.5 py-1.5 text-[10px] text-amber-200 backdrop-blur sm:flex-nowrap sm:whitespace-nowrap">
          <span className="font-bold">Basic map (WebGL is off)</span>
          <span className="hidden text-amber-100/70 sm:inline">you opened this manually</span>
          <button
            onClick={retryInteractive}
            className="rounded border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-100 transition-colors hover:bg-amber-500/25"
          >
            ↻ WebGL
          </button>
          <button onClick={() => setBannerOff(true)} title="Dismiss" className="px-0.5 text-amber-200/60 hover:text-amber-100">✕</button>
        </div>
      )}
    </div>
  );
}
