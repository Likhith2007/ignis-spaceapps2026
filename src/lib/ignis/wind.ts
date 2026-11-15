// IGNIS wind engine — earth.nullschool-style particle streamlines over the map.
//
// Data: Open-Meteo forecast API (free, keyless) sampled as a lon/lat grid over
// the active AOI in ONE bulk request (comma-separated coordinates). Wind is
// returned as speed (m/s) + direction (meteorological degrees, FROM north,
// clockwise) — converted to u/v (eastward/northward) components.
//
// Simulation: particles are anchored in GEOGRAPHIC space and re-projected every
// frame, so pan/zoom keeps them glued to the wind field (exactly like
// earth.nullschool). Trails fade via destination-out compositing so the canvas
// stays transparent over the map. Zero WebGL — plain Canvas2D, runs everywhere.

export type WindGrid = {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  dlon: number;
  dlat: number;
  u: Float32Array; // m/s eastward
  v: Float32Array; // m/s northward
  maxMs: number;
  meanMs: number;
  fetchedAt: number;
};

const CACHE_TTL = 30 * 60 * 1000; // Open-Meteo updates hourly; 30 min is plenty
const cache = new Map<string, { grid: WindGrid | null; at: number }>();
const inflight = new Map<string, Promise<WindGrid | null>>();

export function windCacheInfo(): { size: number; ageMs: number | null } {
  let newest: number | null = null;
  for (const v of cache.values()) if (v.grid) newest = newest === null ? v.grid.fetchedAt : Math.max(newest, v.grid.fetchedAt);
  return { size: cache.size, ageMs: newest === null ? null : Date.now() - newest };
}

/**
 * Fetch a wind grid covering bbox [w, s, e, n]. Returns null on failure
 * (callers must degrade silently — the map never depends on wind).
 */
export async function fetchWindGrid(bbox: number[], nx = 9, ny = 6): Promise<WindGrid | null> {
  const [w, s, e, n] = bbox;
  const key = `${bbox.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.grid;
  if (inflight.has(key)) return inflight.get(key)!;

  const lats: number[] = [];
  const lons: number[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      lons.push(+(w + ((e - w) * ix) / (nx - 1)).toFixed(3));
      lats.push(+(s + ((n - s) * iy) / (ny - 1)).toFixed(3));
    }
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m&timezone=UTC`;

  const p = (async (): Promise<WindGrid | null> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [data];
      if (rows.length < lats.length) throw new Error('short grid');
      const u = new Float32Array(nx * ny);
      const v = new Float32Array(nx * ny);
      let maxMs = 0, sum = 0;
      for (let i = 0; i < lats.length; i++) {
        const speed = Number(rows[i]?.current?.wind_speed_10m ?? 0);
        const dir = Number(rows[i]?.current?.wind_direction_10m ?? 0); // deg FROM north, clockwise
        const rad = (dir * Math.PI) / 180;
        // meteorological → components: u (east) = -s·sin(dir), v (north) = -s·cos(dir)
        const uu = -speed * Math.sin(rad);
        const vv = -speed * Math.cos(rad);
        u[i] = uu; v[i] = vv;
        const m = Math.hypot(uu, vv);
        maxMs = Math.max(maxMs, m); sum += m;
      }
      const grid: WindGrid = {
        nx, ny,
        lon0: w, lat0: s,
        dlon: (e - w) / (nx - 1), dlat: (n - s) / (ny - 1),
        u, v,
        maxMs, meanMs: sum / lats.length,
        fetchedAt: Date.now(),
      };
      cache.set(key, { grid, at: Date.now() });
      return grid;
    } catch {
      cache.set(key, { grid: null, at: Date.now() }); // negative cache — retry after TTL
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Bilinear wind sample (m/s u,v) at lon/lat — clamped to the grid extent. */
export function sampleWind(g: WindGrid, lon: number, lat: number): [number, number] {
  const fx = Math.min(g.nx - 1, Math.max(0, (lon - g.lon0) / g.dlon));
  const fy = Math.min(g.ny - 1, Math.max(0, (lat - g.lat0) / g.dlat));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const idx = (x: number, y: number) => y * g.nx + x;
  const u00 = g.u[idx(x0, y0)], u10 = g.u[idx(x1, y0)], u01 = g.u[idx(x0, y1)], u11 = g.u[idx(x1, y1)];
  const v00 = g.v[idx(x0, y0)], v10 = g.v[idx(x1, y0)], v01 = g.v[idx(x0, y1)], v11 = g.v[idx(x1, y1)];
  const u = (u00 * (1 - tx) + u10 * tx) * (1 - ty) + (u01 * (1 - tx) + u11 * tx) * ty;
  const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  return [u, v];
}

export type Projector = {
  project: (lon: number, lat: number) => { x: number; y: number } | null;
  unproject: (x: number, y: number) => { lon: number; lat: number } | null;
};

type ParticleOpts = {
  canvas: HTMLCanvasElement;
  grid: WindGrid | null;
  proj: Projector;
  /** viewport sample bounds — particles spawn in this geo box (falls back to unprojected canvas corners) */
  speed?: number; // px per (m/s) per second at base zoom — tuned for readability
  maxParticles?: number;
  color?: [number, number, number]; // rgb base, alpha varies with speed
};

type P = { lon: number; lat: number; age: number; life: number; px: number; py: number; seed: number };

/**
 * Run the streamline animation on `canvas`. Returns a stop() handle.
 * Trails fade with destination-out; particles live in geo space.
 */
export function runParticles(opts: ParticleOpts): () => void {
  const { canvas, proj, grid } = opts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const speedScale = opts.speed ?? 2.2;
  const baseColor = opts.color ?? [125, 211, 252]; // #7DD3FC — nullschool cyan
  let cap = opts.maxParticles ?? 900;

  let raf = 0;
  let stopped = false;
  let last = performance.now();
  let slowFrames = 0;
  const particles: P[] = [];
  let hadDraw = false; // a draw happened at least once — enables jump re-anchoring

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const d = dpr();
    canvas.width = Math.round(r.width * d);
    canvas.height = Math.round(r.height * d);
    ctx!.setTransform(d, 0, 0, d, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // spawn helpers — geo space inside the visible viewport
  const spawn = (p?: P): P => {
    const el = p ?? ({} as P);
    // pick a random screen point and unproject — keeps density tied to the view
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    const g = proj.unproject(Math.random() * w, Math.random() * h);
    el.lon = g?.lon ?? 0;
    el.lat = g?.lat ?? 0;
    el.age = 0;
    el.life = 70 + Math.random() * 90;
    el.px = NaN; el.py = NaN;
    el.seed = Math.random();
    return el;
  };
  for (let i = 0; i < cap; i++) particles.push(spawn());

  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) { raf = requestAnimationFrame(frame); return; }

    // fade previous trails toward transparent (keeps the map visible below)
    ctx!.globalCompositeOperation = 'destination-out';
    ctx!.fillStyle = 'rgba(0,0,0,0.085)';
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalCompositeOperation = 'source-over';
    ctx!.lineWidth = 1.25;
    ctx!.lineCap = 'round';

    const t0 = performance.now();
    let drawn = 0;
    for (const p of particles) {
      p.age += 1;
      if (p.age > p.life) { spawn(p); continue; }
      const [u, v] = grid ? sampleWind(grid, p.lon, p.lat) : [0, 0];
      const ms = Math.hypot(u, v);
      // geo-anchored move: screen delta from wind, then unproject to new geo
      const s = proj.project(p.lon, p.lat);
      if (!s) { spawn(p); continue; }
      const nx = s.x + u * speedScale * dt * 10;
      const ny = s.y - v * speedScale * dt * 10;
      const g2 = proj.unproject(nx, ny);
      if (!g2) { spawn(p); continue; }
      const s2 = proj.project(g2.lon, g2.lat);
      if (!s2) { spawn(p); continue; }
      if (s2.x < -40 || s2.y < -40 || s2.x > w + 40 || s2.y > h + 40) { spawn(p); continue; }
      if (!Number.isNaN(p.px)) {
        const a = grid ? Math.min(0.85, 0.18 + (ms / Math.max(2, grid.maxMs)) * 0.75) : 0.3;
        ctx!.strokeStyle = `rgba(${baseColor[0]},${baseColor[1]},${baseColor[2]},${a.toFixed(2)})`;
        ctx!.beginPath();
        ctx!.moveTo(p.px, p.py);
        ctx!.lineTo(s2.x, s2.y);
        ctx!.stroke();
        drawn++;
      }
      p.px = s2.x; p.py = s2.y;
      p.lon = g2.lon; p.lat = g2.lat;
    }

    // perf guard (mirrors FireField3D): 3 consecutive slow frames → shed load
    const frameMs = performance.now() - t0;
    if (frameMs > 22) {
      slowFrames++;
      if (slowFrames >= 3 && cap > 220) {
        cap = Math.round(cap * 0.7);
        particles.length = Math.min(particles.length, cap);
        slowFrames = 0;
      }
    } else slowFrames = 0;
    // re-anchor after map jumps ONLY once drawing has actually happened —
    // otherwise the initial all-NaN state would re-trigger this every frame
    if (drawn === 0 && hadDraw && grid) {
      for (const p of particles) p.px = NaN;
      hadDraw = false;
    } else if (drawn > 0) hadDraw = true;

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}

/** One-line wind readout for HUD chips, e.g. "6.2 m/s · SW" */
export function windReadout(g: WindGrid, lon: number, lat: number): string {
  const [u, v] = sampleWind(g, lon, lat);
  const ms = Math.hypot(u, v);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const from = (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360;
  return `${ms.toFixed(1)} m/s · ${dirs[Math.round(from / 45) % 8]}`;
}
