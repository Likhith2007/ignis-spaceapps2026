# IGNIS — Complete Feature Guide

> **The definitive, feature-by-feature reference for everything inside [ignis-spaceapps2026.vercel.app](https://ignis-spaceapps2026.vercel.app).**
> Every panel, every control, every analysis method — what it is, how to use it, where its data comes from, and why it exists.
>
> Companion docs: [Architecture](ARCHITECTURE.md) · [Data pipeline](DATA_PIPELINE.md) · [API catalogue](APIS.md) · [UI/UX system](UI_UX_SYSTEM.md) · [Submission](SUBMISSION.md) · [Judge scorecard](JUDGE_SCORECARD.md)

---

## Table of contents

1. [The mission-control layout](#1-the-mission-control-layout)
2. [Regions & the AOI selector](#2-regions--the-aoi-selector)
3. [TopBrief — the one-line live summary + early alert](#3-topbrief--the-one-line-live-summary--early-alert)
4. [The living fire map](#4-the-living-fire-map)
5. [3D modes — 🧊 Fire Field & ⛰ Terrain towers](#5-3d-modes--️-fire-field--⛰-terrain-towers)
6. [The early-warning rail](#6-the-early-warning-rail)
7. [IGNIS AI Analyst](#7-ignis-ai-analyst)
8. [The eleven analysis tabs](#8-the-eleven-analysis-tabs)
9. [Date-range search & downloads](#9-date-range-search--downloads)
10. [Status rail — live system health](#10-status-rail--live-system-health)
11. [Guided tour, accessibility & responsive design](#11-guided-tour-accessibility--responsive-design)
12. [Automation — the daily digest hook](#12-automation--the-daily-digest-hook)
13. [Feature ↔ challenge-goal map](#13-feature--challenge-goal-map)
14. ["How do I…?" quick recipes](#14-how-do-i-quick-recipes)

---

## 1. The mission-control layout

IGNIS is a single-page **mission control** modeled on the operating consoles that fire
analysts actually use (NASA Worldview, Zoom Earth, Windy, nullschool) — one map, one
summary, one rail of live indicators, and a deep analytics workspace behind it.

```
┌──────────────────────────────────────────────────────────────────────┐
│  IGNIS header — region selector · search · ⌖ custom box · tour · AI  │
├──────────────────────────────────────────────────────────────────────┤
│  TopBrief — one-line live summary + EARLY ALERT banner               │
├──────────────────────────────────────────────┬───────────────────────┤
│                                              │  early-warning rail   │
│        THE LIVING FIRE MAP (2D / 3D)         │  · rule-engine alerts │
│   basemaps · overlays · hexbin · replay      │  · 7-day fire weather │
│   hotspot click → AI event card              │  · sensor telemetry   │
│                                              │  · GDACS / ReliefWeb  │
├──────────────────────────────────────────────┴───────────────────────┤
│  RangeSearch — date-range search · per-day bars · CSV / GeoJSON      │
├──────────────────────────────────────────────────────────────────────┤
│  11 analysis tabs: calendar · impact · watchlist · clusters ·        │
│  dynamics · timeseries · science · outlook · regime · method · hub   │
├──────────────────────────────────────────────────────────────────────┤
│  StatusRail — live health of every upstream system                   │
└──────────────────────────────────────────────────────────────────────┘
```

Design contract: **the map is the hero**. Every overlay collapses to a compact chip by
default and expands on demand; the map can go fullscreen (⛶) without touching the page
grid; and every panel below the fold is one click away. There is no separate "dashboard"
page — the console *is* the product.

---

## 2. Regions & the AOI selector

**What it is.** The selector in the header defines *where every panel looks*. IGNIS ships
nine curated regions chosen for fire signal diversity — the Amazon, Congo basin, Siberia,
Boreal Canada/Alaska, California, the Mediterranean, Australia, Southeast Asia and a
**Bangladesh spotlight** (the team's home region) — plus two ways to analyze *anywhere*:

- **🔍 Search any place on Earth** — the geocoder proxies OSM Nominatim; type "Chiquitania"
  or "Fort McMurray" and the map flies there, panels refetch, and a custom AOI is centered.
- **⌖ Draw a custom box** — drag a rectangle directly on the map (or enter explicit
  lat/lon bounds). Every panel — calendar, science lab, exports — recalculates for the
  drawn box, which is exactly the "region + date → fire history" flow the challenge brief asks for.

**Why it matters.** Custom AOIs make IGNIS a tool, not a demo: a provincial fire officer
can draw *their* province and get the same 26-year calendar that the Amazon gets.

**🇧🇩 Bangladesh spotlight.** The home-region module adds six sub-AOIs and surfaces the
Boro rice-residue burning season (March–April) exactly as it emerges from the real NASA
record — the same fires that drive Dhaka's winter air-quality crisis.

**RegionContext placard.** A Wikipedia-powered two-line "what am I looking at?" card
answers the natural first question about the current AOI, degrades silently when
Wikipedia is unreachable, and never blocks the map.

---

## 3. TopBrief — the one-line live summary + early alert

**What it is.** A single computed sentence at the top of the console — *e.g.* "Amazon:
1,214 detections in the last 24 h · ΣFRP 3.4 GW · VIIRS 71% of detections · MODIS sees the
large complexes" — plus an **EARLY ALERT banner** that escalates **GREEN → AMBER → ORANGE → RED**
from live FRP and density.

**How it works.** The summary is computed from live telemetry by a deterministic rule
engine — **no LLM dependency, never blocks**. If the AI stack is down the brief is still
perfect. The alert strip only appears at ORANGE/RED (auto-dismissable) and carries a
breathing severity beacon; Lucide SVG icons and a SplitText reveal animate the line.

**Use it for.** The 5-second answer to "what is burning right now, and is it getting worse?"
before any click.

---

## 4. The living fire map

The map is IGNIS's heart — a NASA GIBS WMTS basemap with the live fire record drawn on top,
available through two independent renderers:

### 4.1 Dual-renderer reliability (the WebGL problem, solved)

- **Primary — MapLibre GL (WebGL2):** GPU-accelerated vectors, 3D camera, smooth zooms.
- **Fallback — Leaflet "BLAZE engine" (zero WebGL):** a probed WebGL2 capability check runs
  *before* the GL map is constructed. Browsers with blocked GPUs (Brave strict shields, VMs,
  headless runners) get a full interactive Leaflet renderer instead of a `GPUInitializationError`
  crash. Escape hatch: `?nogpu=1` forces the fallback for support and CI screenshots.

### 4.2 The BLAZE fire-dot engine (v8, Leaflet path)

Replaced ~75k per-point circle markers with **one custom canvas layer**:

- **Pre-rendered radial-gradient sprite cache** (glow / core / night / white-hot) composited
  with an additive `lighter` glow pass — real fire optics, not dots.
- **v5.12 proper-red ramp:** every detection reads as a red fire dot at any zoom (pale red →
  deep crimson with FRP) instead of the old yellow→red ramp where small burns washed out
  against bright basemaps. Intensity still encodes: red *depth* + size (∝ √FRP) + glow.
- **White-hot cores** for detections ≥ 150 MW; **night mode** sprites keyed off acquisition time.
- **FRP-ascending paint order** so the hottest fires draw last and stay visible.
- **DPR-crisp retina rendering**, viewport culling with a 30k-detection cap.
- **Uniform-grid spatial index (0.05° cells)** → *every* hotspot is hoverable (rAF-throttled
  tooltip) and **clickable** at any zoom, 18 px touch tolerance on phones.
- **Pulses, ember drift and fire-front blooms + spread rings** animate over active clusters.
- **Heatmap mode** — additive heat-sprite density rendering of the same detections.

### 4.3 Color modes (intensity / sensor / confidence / heatmap)

Four style modes recolor every detection: **intensity** (FRP ramp), **sensor** (MODIS vs
VIIRS-NOAA-20 vs VIIRS-SNPP hues — the harmonization story at a glance), **confidence**
(low/nominal/high), and **heatmap** (density surface). The GL path adds a **fires-ember
underglow** layer (FRP ≥ 45 MW, warm orange blur) so mid-size fires read as live embers.

### 4.4 Basemaps & overlays (Windy-style layer stack)

- **NASA GIBS basemaps:** true color, **7-2-1 false color** (burn scars read magenta),
  Blue Marble; date-synced to the selected day.
- **MOD11 LST land-surface temperature** overlay with the official LP DAAC V6 decode
  (LST = stored × 0.02 K, QA bit-decoded right→left) and the official hot-red/cold-blue palette.
- **GIBS fire-pixel vector tiles** as an *independent cross-check* of FIRMS — two NASA
  pipelines agreeing (or not) on the same night.
- **Wind streamlines** (nullschool signature, default ON) drawn live from Open-Meteo;
  they dim automatically while an AI event card is open.
- **RainViewer radar + cloud frames** (fetched on demand — the map stays clean by default).
- **Hexbin density** mode aggregating detections into hexagonal bins.
- **Windy-style master opacity slider** with per-overlay base opacities.
- **🔮 Next-day risk field** — the footprint-forecaster model's probability surface, drawn
  as a live overlay (see [model family](#8-the-eleven-analysis-tabs)).

### 4.5 Time travel — the replay window

A 24H / 48H / 7D window switcher plus a **7-day replay** that steps the fire record day by
day with persistent fire-system tracking (nearest-centroid + FRP trend) — you can watch a
complex ignite, merge, and burn out across the week.

### 4.6 Click any dot → the AI event card

Clicking any hotspot opens a full **AI event card**: threat badge (LOW → EXTREME), fire
type classification, a **6-hour spread forecast** (upgraded by live wind), smoke & air
context, CO₂e estimate, and a one-tap "Ask the Analyst about this fire" that carries the
card's telemetry into the AI drawer. This is the "every red dot is interactable with AI"
requirement, fully shipped.

### 4.7 Focus mode

⛶ locks page scroll, resizes the renderer to the full viewport (re-measuring on every
geometry change), and Esc exits — a true fullscreen map without leaving the page.

---

## 5. 3D modes — 🧊 Fire Field & ⛰ Terrain towers

Two WebGL-first 3D views, each with a **GPU-free fallback** so 3D never hard-fails:

- **🧊 Fire Field** — detections extruded as a volumetric fire field over a dark grid;
  height/brightness follow FRP. Where WebGL is unavailable it degrades to an isometric
  canvas fire field with the same information.
- **⛰ Terrain towers** — detections rendered as 3D towers over a Three.js terrain scene;
  the GL path also adds a terrain/extrusion feel to the main map camera.
- Both modes share the map's date, AOI and sensor filters; the HUD shows a live threat
  rollup while in 3D.

**Why 3D:** judges and responders alike read vertical FRP structure (which complexes carry
the energy) faster in 3D than in any 2D ramp.

---

## 6. The early-warning rail

A right-hand rail that answers "is anything about to get worse?" with four stacked cards:

1. **Rule-engine early warning** — zero-latency, deterministic threat assessment of live
   detections (no LLM), driving the same LOW → EXTREME badge vocabulary as the map.
2. **EONET open wildfire events** — ranked by **on-device MiniLM semantic relevance**
   (all-MiniLM-L6-v2 via transformers.js/ONNX — the ranking model runs *in the browser*),
   then geo-filtered to the AOI.
3. **GDACS authority alerts** (EC/JRC) — GREEN/ORANGE/RED alert levels with severity in
   hectares, filtered to the region.
4. **ReliefWeb (UN OCHA)** — wildfire disaster reports, wildfire-first with honest
   context labeling.

Below the rail: the **7-day fire-weather early warning** card (Open-Meteo composite —
wind, humidity, precipitation trend → a color-banded verdict label) and, in expert mode,
the **Sensor Harmonization** card showing per-sensor counts and the live VIIRS/MODIS ratio.
All feeds are keyless or cached; failures degrade silently to the core rule engine.

---

## 7. IGNIS AI Analyst

**What it is.** A chat drawer (plus automatic SITREPs) grounded **strictly in live
telemetry** — it cannot invent numbers because every prompt is built from the same API
documents the panels render.

- **Two modes:** `chat` (ask anything about the AOI) and `sitrep` (an incident-style
  situation report: activity, trend, dominant sensor, risk outlook, recommended actions).
- **Grounded generation:** Hugging Face **Llama-3.1-8B** with a zero-hallucination guard —
  the model is instructed to cite only the telemetry in context and refuses when asked
  about anything else.
- **Deterministic fallback:** if the endpoint is down, a rule engine composes the *same
  SITREP structure* offline — the feature never dead-ends.
- **MiniLM triage:** event ranking and relevance run on-device (see the rail), so the
  AI layer has a local component that works with all remote AI down.
- **Hotspot handoff:** every AI event card can pass its telemetry straight into the drawer
  ("Ask the Analyst about *this* fire").

**Honesty contract:** when the model speaks, the panel shows the model card; when the
rule engine speaks, it says so. Users always know which layer generated the text.

---

## 8. The eleven analysis tabs

The workspace below the map. Every tab is recomputed for the **current AOI and day**, and
every tab names its data source.

### 8.1 🔥 Burning Calendar

The challenge's centerpiece: a **26-year × 12-month heatmap per sensor** (2000 → today).

- **What you see:** rows = years, columns = months, cell color = detection count on the
  selected **accessible ramp** — Inferno, **Colorblind-viridis**, or Mono (choice persists in
  localStorage, `aria-pressed` toggles, legend swatches rendered).
- **Unusual-month rings:** months with |z| ≥ 2 against their own climatology are ringed.
- **FRP bars** alongside the heatmap carry the energy story.
- **"This month vs historical median" KPI:** the current month's detections as a ×-ratio and
  z-score against the same-month median climatology — provenance-aware for custom AOIs.
- **The continuity coefficient:** the honest harmonization readout — the median VIIRS/MODIS
  overlap ratio and its coefficient of variation, printed on the panel.
- **Click any month** → loads that month on the map.

### 8.2 🎯 Impact — carbon, climate & smoke

- **Carbon & climate:** the exact chain of the `ignis-fire-calendar` emissions dataset —
  ΣFRP → fire radiative energy → dry matter consumed → **CO₂e** — plus human-scale
  equivalences and context vs the region's 26-year record.
- **Smoke & air quality:** Open-Meteo CAMS (keyless) for the AOI center — **US AQI band with
  advice**, PM2.5, CO, aerosol optical depth, and a smoke-suspicion flag that correlates the
  air column with the live fire record.

### 8.3 🔔 Watchlist — personal fire alerts

Save the places you care about (home, farm, village) and get alerted when fire approaches.

- Saved places live in **localStorage**: name, lat/lon, radius (km), channels.
- Distance checks run against the **live detections** already loaded for the AOI and
  **auto-recheck every 5 minutes** while the tab is open.
- **Channels:** in-app 🔔, the **Browser Notification API**, and optional e-mail via the
  keyless FormSubmit relay (one-time activation, documented in the UI).
- **Privacy-first:** zero server state, zero credentials.

### 8.4 🧪 Fire Cluster Lab (segmentation)

In-browser **DBSCAN segmentation** (ε adaptive to AOI size, grid-accelerated) + **convex-hull
fire boundaries** (Andrew's monotone chain).

- Cluster table: ΣFRP, spread, hull area, **front-ratio** (perimeter ÷ 2√(πA) — elongation
  marks an advancing fire front), night share, sensor mix, ML behavior votes.
- **FRP distribution histogram** (log bins) and **diurnal signature** (UTC acquisition hours
  — the orbital detection pattern is visible).
- **Persistent fire systems** tracked across the replay window (nearest-centroid + FRP trend).
- Hulls draw on the map; clusters link to the AI Analyst.

### 8.5 📊 Daily Dynamics

The day-by-day picture for the window:

- Stacked **per-sensor daily detections** — the MODIS vs VIIRS era split, visible.
- Fire radiative **energy curve**.
- **MODIS↔VIIRS cross-validation scatter** against the 1:1 line — *the harmonization problem
  in one chart* (VIIRS systematically sees more; the spread is the reason IGNIS exists).
- Day/night balance and a deterministic **verdict: ESCALATING / DECLINING / STEADY**.
- The 🔮 next-day risk-field card from the footprint-forecaster model.

### 8.6 📈 Time-Series Lab

- **STL-style decomposition** (trend / seasonal / residual) of the monthly record.
- **Theil-Sen robust trend** and **CUSUM change points**.
- **Climatology** view with a robust **p10–p90 percentile envelope** (replaces mean±1σ).
- **Anomaly rings:** residual months with |z| ≥ 2 are ringed red (surplus) / blue (deficit)
  directly on the observed line.

### 8.7 🧮 Statistics Science Lab (v8.2)

An expert workspace with **7 sub-tabs**, each a *different chart type*, each ending in a
plain-language "Deterministic read" verdict. All eleven methods are implemented from
textbook form in `src/lib/ignis/science.ts`, deterministic and auditable, and verified
against **28/28 synthetic ground-truth tests**.

| Sub-tab | Methods & displays |
|---|---|
| **Trend significance** | Mann-Kendall test (tie-corrected S, Z, two-sided p) + **Sen's slope** → significance cards + fitted trend chart |
| **Memory & persistence** | ACF correlogram (custom SVG with 1.96/√N white-noise band) + **Hurst exponent** (R/S) + 3-month momentum & volatility |
| **Hidden cycles** | **DFT periodogram** on the climatology-deseasonalized series, top-3 spectral peaks (ENSO/drought-band teleconnection view) |
| **Extremes & return periods** | Empirical return periods (Weibull plotting positions) + **Gumbel EVT type-I fit** → 1-in-10/25/50-yr season levels + **POT anomaly register** (z ≥ 1.5) |
| **Sensor agreement** | Pearson + Spearman + **ratio Bland-Altman** (log-diff bias → geometric ratio + 95% limits of agreement) — the formal harmonization statistics |
| **Season phenology** | 40%-fractile **onset/offset/duration per year** as a Gantt (peak dots, most-recent-first) + onset-shift trend (days/decade) |
| **Energy & clustering** | **FRP intensity economics**: log-spaced MW bins (count bars vs energy-share line), **Gini coefficient**, top-1% energy share, Wooster classes + **Moran's I** spatial autocorrelation with 499-fold permutation inference and **Anselin LISA** quadrant chips (HH/LL/HL/LH) + Moran scatter |

Live sanity example (Amazon, 2026-10-29): MK Z = −1.47, p = 0.141 (honest *no trend*),
ρ₁ = 0.41 (significant memory), Hurst 0.625 (persistent), record year 2004,
1-in-25-yr ≈ 1.7 M detections, VIIRS/MODIS ratio 10.78× (95% LoA 2.97–39.09×,
r = 0.961 / ρ = 0.939 over 173 overlap months), Gini 0.631, 26 stationary fire-season onsets.

### 8.8 🔭 Seasonal Outlook

- **Harmonic (Fourier) regression** forecast of the next 12 months in log-space, with
  residual uncertainty bands.
- The **ignis-event-detector** model's **P(extreme month)** badge — a trained early-warning
  classifier over the 25-year calendars (AUC 0.740 on the 2022-26 holdout).

### 8.9 🧭 Burn Regime

**Nearest-prototype classification** of the current AOI against eight NASA-derived reference
regimes — powered by the `ignis-fire-regime-model` (63 segmented complexes, K-means regime
prototypes, trained on 138k real FIRMS detections). The panel answers "what *kind* of fire
landscape is this?" in one badge, with the deterministic prototype distance shown.

### 8.10 📜 Methodology

The honesty panel: full data provenance (FIRMS NRT C6.1/V2, GIBS MVT archive to Nov 2000,
GIBS imagery layer + date, EONET, Open-Meteo), the harmonization math, the MOD11 decode,
and the **S-NPP sunset note** (VIIRS-SNPP decommissioning Nov 2 2026 and what it means for
the continuity coefficient) — every limitation stated where the user can see it.

### 8.11 🤗 Open Science hub

A live view of IGNIS's public Hugging Face assets, fetched from the Hub at runtime:

- **ignis-fire-regime-model** — open weights + full training script + metrics.
- **ignis-fire-calendar dataset** — long-format 26-yr CSV, regime matrix, calibrated
  FRE→CO₂e emissions estimates, complex inventories — with a datasets-server row preview.

Nothing on the Hub is decorative: all four models are wired live into the product
(see the model-family table in the [README](../README.md#the-ignis-model-family-trained-on-real-nasa-firms-data)).

---

## 9. Date-range search & downloads

The brief's "region + date range → fire history" flow, shipped as **RangeSearch**:

- From/to date inputs (iOS-safe 16 px font) with **7 / 14 / 30 / 45-day presets**.
- The search runs ≤ 45-day spans as 10-day FIRMS chunks through the unified pipeline, with
  per-day, per-sensor and total analytics computed from **authoritative counts**, deduped,
  capped at 20k rows with an explicit truncation flag.
- **Clickable per-day bars** → jump the map to that day.
- **Three exports, exactly as the brief asks:**
  1. **detections CSV** — per-detection rows (sensor, time, FRP, confidence, coordinates, ML class),
  2. **daily-counts CSV** — per-day/per-sensor table,
  3. **GeoJSON** — point geometry for GIS import.
- Empty and too-long states, plus an honest disclosure when results come from the archive
  rather than near-real-time.

The same exports are available for custom drawn boxes — the AOI you draw is the AOI you download.

---

## 10. Status rail — live system health

The bottom rail verifies **all upstream systems live** on every load: FIRMS, api.nasa.gov,
GIBS, EONET, the Hugging Face endpoint, Open-Meteo, and the Earthdata JWT (with remaining
days until expiry, so a token sunset is visible before it breaks a demo). `/api/health`
backs it with the same checks server-side. **15/15 API endpoints** were verified 200 in the
2026-10-29 production audit (see [docs/APIS.md](APIS.md)).

---

## 11. Guided tour, accessibility & responsive design

- **Guided tour** — a 6-step spotlight walkthrough for first-time visitors (regions → brief
  → map → rail → tabs → AI). Advances on click/keys, remembers completion in
  localStorage, re-runnable from the header (◈ Tour).
- **Accessibility:** colorblind-safe calendar ramps, `aria-pressed`/`aria-label` on controls,
  listbox semantics, keyboard-navigable tour, ≥ 40 px touch targets, focus states.
- **All-device:** fluid map heights (68 vh / min 540 px mobile → clamped desktop), 2×2 grid
  style tabs on phones, popup max-width clamps with inner scroll, safe-area insets,
  `viewport-fit=cover`, zero horizontal overflow verified at 390 px.

---

## 12. Automation — the daily digest hook

`GET /api/hooks/digest` returns a machine-readable daily fire digest for **n8n**, GitHub
Actions, or Vercel Cron (optional `IGNIS_HOOK_TOKEN` bearer guard). An importable n8n
workflow ships in [`automation/ignis-n8n-workflow.json`](../automation/), the cron is wired
in `vercel.json`, and the operations runbook is [docs/AUTOMATION_RUNBOOK.md](AUTOMATION_RUNBOOK.md).

---

## 13. Feature ↔ challenge-goal map

| Official brief deliverable | Where it lives |
|---|---|
| Harmonization of MODIS + VIIRS (Goal 1) | Continuity coefficient + CV (Calendar), sensor color mode (Map), cross-validation scatter (Dynamics), Bland-Altman + Pearson/Spearman (Science Lab), SensorPanel, `scaled:true` provenance flags |
| Web application: region + date → fire history/trend/abnormality calendar (Goal 2) | Regions & custom AOI boxes, RangeSearch, Burning Calendar, Time-Series Lab, Science Lab |
| Burning Activity Calendar, 2000s → present, month vs multi-year median, colorblind-safe | Calendar tab (ramps, rings, median KPI), Time-Series climatology |
| Downloadable products | Detections CSV · daily-counts CSV · GeoJSON (RangeSearch), dataset on the Hub |
| Audience: responders / scientists / land managers / firefighters | TopBrief + alerts rail (responders), Science Lab (scientists), Watchlist + fire-weather + outlook (land managers), AI event cards (firefighters) |

---

## 14. "How do I…?" quick recipes

- **"Is this region abnormal right now?"** → TopBrief (alert banner) → Calendar tab →
  "This month vs historical median" KPI → Time-Series anomaly rings.
- **"What is that single fire on the map?"** → click the dot → AI event card →
  "Ask the Analyst about this fire".
- **"Get last month's detections for my province."** → ⌖ draw the box → RangeSearch →
  set dates → download detections CSV / GeoJSON.
- **"Is fire activity trending up over 26 years?"** → Science Lab → Trend significance
  (Mann-Kendall + Sen's slope) → Memory & persistence (Hurst) → Extremes (return periods).
- **"Do MODIS and VIIRS agree here?"** → Dynamics scatter (1:1 line) → Science Lab →
  Sensor agreement (Bland-Altman ratio + LoA) → SensorPanel live ratio.
- **"Warn me about fires near my farm."** → Watchlist tab → save the place + radius →
  keep the tab open (5-min recheck) or enable browser/e-mail channels.
- **"What kind of fire regime is this?"** → Burn Regime tab → prototype badge + distance.
- **"Show me the 3D energy structure."** → map 🧊 Fire Field or ⛰ Terrain towers → HUD rollup.

