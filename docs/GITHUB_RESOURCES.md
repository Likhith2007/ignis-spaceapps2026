# IGNIS — GitHub Resource Inventory (v7.1)

> Purpose: the curated catalogue of GitHub repositories / open-source assets that
> power IGNIS today, plus vetted candidates for the next iterations — gathered
> from the five reference repos the project was directed to (`daisyUI`,
> `ui-ux-pro-max-skill`, `Awesome-Design-Tools`, `vuetify`, `react-bits`) and
> the API/automation sources (`public-apis`, `n8n`), extended with a world-view
> sweep (NASA Worldview/EOSDIS, FIRMS, Zoom Earth, Windy, earth.nullschool).
>
> Status legend: **IN USE** — shipped in the production app · **RECOMMENDED** —
> vetted, highest-value next addition · **CONSIDERED** — evaluated, not
> adopted (with the reason).

---

## 1. UI / UX systems & component layers

| Repo | License | Status | How IGNIS uses it |
|---|---|---|---|
| `saadeghi/daisyUI` | MIT | **IN USE** | Tailwind v4 plugin with a custom `ignis` mission-control theme (built-ins off). Component classes in production: `skeleton`, `swap` (EXPERT/SIMPLE toggle), `radial-progress` (detection-confidence rings inside every AI event card), plus theme role tokens (`text-success/warning/info`) in popups. |
| `DavidHDev/react-bits` | MIT | **IN USE** (pattern-ported) | Local FX library under `src/components/ignis/fx/`: `CountUp`, `SplitText`, `SpotlightCard`, `EmberCanvas`, `Ticker`, `RippleLayer` (v7) + `ShinyText`, `GradientText`, `AnimatedList` (v7.1). Ported as tiny dependency-free components instead of installing the package — smaller bundle, full dark-theme control. |
| `vuetifyjs/vuetify` | MIT | **IN USE** (design language only — Vue≠React) | Material-3 conventions adapted to React: `.elev-0..4` elevation ladder, delegated ripple (`[data-ripple]`), motion tokens, 8/12/16px rhythm. |
| `nextlevelbuilder/ui-ux-pro-max-skill` | — | **IN USE** (methodology) | Heuristics enforced codebase-wide: Lucide SVG icons instead of emoji-as-icons, `:focus-visible` rings, `cursor-pointer` on interactive elements, ≥4.5:1 contrast, `prefers-reduced-motion` kill-switch, 375/768/1024/1440 responsive checks. |
| `goabstract/Awesome-Design-Tools` | — | **IN USE** (selection tooling) | Used to curate the palette ramp (Leonardo-style contrast-checked ember ramp), icon set choice (Lucide), and typography stack. |
| `shadcn/ui` + Radix primitives | MIT | **IN USE** | Full `src/components/ui` set (dialog, tabs, tooltip, slider, …) under the IGNIS dark tokens. |
| `pmndrs/react-three-fiber` | MIT | CONSIDERED | Three.js already used directly (`TerrainScene3D`) with full manual disposal; R3F adds reconciler weight for one scene. |
| `mantine`, `chakra-ui`, `ant-design` | MIT | CONSIDERED | Would collide with the shadcn/daisyUI layer already in place. |
| `tremorlabs/tremor` | MIT | RECOMMENDED (dashboards) | If the analytics tabs grow into a dedicated dashboard page, Tremor's chart+KPI blocks match the mission-control look. |
| `framer-motion/motion` | MIT | **IN USE** | Tab transitions, SplitText/AnimatedList, alert flash. |

## 2. Mapping, globe & geospatial rendering

| Repo | License | Status | How IGNIS uses it |
|---|---|---|---|
| `maplibre/maplibre-gl-js` | BSD-3 | **IN USE** | Primary WebGL renderer: GIBS raster basemaps, heat/circle fire layers, fill-extrusion 3D towers, custom sources, TerrainRGB DEM. |
| `Leaflet/Leaflet` | BSD-2 | **IN USE** | GPU-free DOM/canvas renderer (Brave/VM/headless path): same basemaps, 25k+ hotspots, popups, AOI pick. |
| `mrdoob/three.js` | MIT | **IN USE** | `TerrainScene3D`: GIBS satellite drape + Terrarium DEM displacement + instanced fire columns + shader glow field. |
| `visgl/deck.gl` | MIT | RECOMMENDED | If point volumes grow past ~100k detections (country-scale windows), deck's GPU point/hex layers scale further than canvas circles. |
| `kepler.gl/kepler.gl` | MIT | CONSIDERED | Whole-app footprint; IGNIS already owns its map chrome. |
| `CesiumGS/cesium` | Apache-2 | CONSIDERED | True-globe view is compelling but heavy; the Three.js scene covers the 3D need. |
| `protomaps/PMTiles` + `protomaps/basemaps` | BSD/Apache | RECOMMENDED | Single-file planet basemap for a fully offline demo / judge-kit USB build. |
| `mapbox/tilebelt`, `mapbox/vector-tile` | ISC/BSD | **IN USE** | `/api/gibsfires` parses GIBS MVT tiles server-side (vector-tile + pbf). |
| `danelkhen/terra-draw` | MIT | CONSIDERED | AOI picking is custom shift-drag already; adopt if polygon AOIs are added. |
| `turfjs/turf` | MIT | CONSIDERED | Hexbin/convex-hull/DBSCAN are hand-rolled and dependency-free; turf adds heft for marginal gain. |

## 3. Earth-observation data sources & APIs (all keyless unless noted)

| Source / repo | Status | Role in IGNIS |
|---|---|---|
| NASA FIRMS area API (MAP_KEY) | **IN USE** | Primary NRT hotspots (MODIS C6.1 + VIIRS V2, 5 sensors). |
| NASA GIBS WMTS | **IN USE** | Basemaps (true-color, 7-2-1, VIIRS), LST overlays, MVT fire pixels — independent FIRMS cross-check. |
| NASA EONET v3 | **IN USE** | Open wildfire events, MiniLM semantic ranking. |
| NASA APOD / api.nasa.gov | **IN USE** | Health pipeline probe (elevated key, 10k/day). |
| `public-apis/public-apis` — **Open-Meteo** | **IN USE** | Fire weather (FKI inputs), CAMS air quality (PM2.5/PM10/CO/AOD/dust), and the v7.1 wind grid for particle streamlines — one keyless provider, three features. |
| `public-apis` — **RainViewer** | **IN USE (v7.1)** | Live precipitation radar + IR satellite clouds (`/public/weather-maps.json`, tile cache). |
| GDACS (EC/JRC) RSS | **IN USE** | Authority alerts with alert levels, parsed server-side (`/api/gdacs`). |
| ReliefWeb (UN OCHA) RSS | **IN USE** | On-the-ground disaster reports (`/api/reliefweb`). |
| Wikipedia REST search+summary | **IN USE** | Region context placard (`/api/context`). |
| OSM Nominatim | **IN USE** | Place search / geocoding (`/api/geocode`). |
| AWS/Mapzen Terrain Tiles (Terrarium) | **IN USE** | Global DEM for 3D terrain & scene elevation. |
| `openaq/openaq-api-v3` | RECOMMENDED | Ground-station PM2.5 to validate CAMS smoke suspicion (needs free API key — keep in vault). |
| `google/earthengine-catalog` (GEE) | CONSIDERED | Auth + batch model too heavy for a hackathon app. |
| `sentinel-hub/eo-browser` / Copernicus Browser | CONSIDERED | Sentinel-2 burn scars would enrich post-fire views; adds account + quota complexity. |

## 4. Automation & pipeline

| Repo | License | Status | How IGNIS uses it |
|---|---|---|---|
| `n8n-io/n8n` | fair-code (Sustainable Use) | **IN USE** | Importable workflows: `automation/ignis-n8n-workflow.json` (daily 21:00 UTC 8-region digest → Email/Telegram) and `automation/ignis-n8n-red-spike.json` (v7.1 — 15-min RED-spike watch). App-side endpoint: `/api/hooks/digest` (+ optional bearer token), `vercel.json` cron fallback. |
| `vercel/vercel` cron | **IN USE** | `vercel.json` schedules the digest without any external host. |
| `activepieces/activepieces`, `windmill-labs/windmill`, `huginn/huginn` | MIT/agpl | CONSIDERED | n8n already covers the trigger→filter→notify chain. |
| `formspree`/FormSubmit relay | **IN USE** | Keyless email relay for personal watchlist alerts (feature 8). |

## 5. On-device & server AI (Hugging Face family)

| Asset | Status | Role |
|---|---|---|
| `huggingface/transformers.js` (`@huggingface/transformers`) | **IN USE** | all-MiniLM-L6-v2 on-device semantic triage of EONET events — zero backend cost. |
| HF Inference — `Llama-3.1-8B-Instruct` | **IN USE** | 🤖 verdict cards, physics-clamped by the rule engine. |
| HF Inference — `Qwen3-8B` | **IN USE** | 💬 Analyst deep-dive. |
| IGNIS private model family (`Nabidnur/*`) | **IN USE** | fire-type · fire-spread · fire-classifier · event-detector · footprint-forecaster · regime-model — TS twins run zero-latency in-app; `segmenter` powers hulls. |
| `onnx/onnxruntime-web` | RECOMMENDED | If models graduate from TS-tree twins to ONNX, web runtime gives exact parity with sklearn. |
| `Xenova/modular-ts` examples | CONSIDERED | Covered by transformers.js directly. |

## 6. Quality, verification & ops

| Repo | Status | Role |
|---|---|---|
| `vercel/next.js` 16 | **IN USE** | App framework (App Router, standalone build). |
| `microsoft/Playwright` / agent-browser | **IN USE** | Every feature verified E2E (Leaflet `?nogpu=1` path + GL path). |
| `eslint` + `eslint-config-next` | **IN USE** | Gate before every push. |
| `prisma/prisma` | **IN USE** | SQLite client for watchlist persistence options. |
| `storybookjs/storybook` | CONSIDERED | Single-app focus; the docs/UI_UX_SYSTEM.md plays the living-style-guide role. |
| `GoogleChrome/lighthouse-ci` | RECOMMENDED | Add to CI for perf/a11y budgets on every deploy. |

## 7. World-view inspiration → implemented features (traceability)

| Inspiration | Feature shipped |
|---|---|
| earth.nullschool (wind particle field) | **v7.1** `WindCanvas` — Open-Meteo wind grid, geo-anchored Canvas2D streamlines, dim-on-popup, HUD readout, `W` shortcut, both renderers. |
| Zoom Earth (live radar/clouds) | **v7.1** RainViewer rain radar + IR clouds overlays, 5-min refresh, both renderers. |
| NASA Worldview (temporal animation) | Replay engine + timeline scrubber + speed control (v5.11) + **v7.1** cinematic REPLAY date chip. |
| Zoom Earth (24H/48H/7D lens) | Quick-window preset chips (v7). |
| Windy (layer opacity) | Master overlay-strength slider (v7). |
| FIRMS/Worldview (layer catalog) | Layers popover: GIBS imagery, fire pixels, hexbin, segmentation, ML forecast, 3D towers + v7.1 live-weather group. |
| Nullschool (cursor probe) | Live crosshair telemetry readout (v7). |

## 8. Next-up shortlist (highest value first)

1. **deck.gl** point/hex layers for country-scale windows (>100k detections).
2. **Lighthouse CI** budget gate in GitHub Actions.
3. **OpenAQ** ground-truth AQ cross-check (key → vault).
4. **PMTiles offline demo kit** — judges without network see the full app.
5. **react-bits** `DecayCard`/`Dock` if a command-dock for map modes is added.
