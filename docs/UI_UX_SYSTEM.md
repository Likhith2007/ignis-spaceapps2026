# IGNIS v7 "Mission Control" — UI/UX Design System

The v7 interface was synthesized from five open-source design references the
project adopted, plus a study of the world-view websites IGNIS sits alongside
(NASA Worldview, earth.nullschool.net, Windy, Zoom Earth). This document maps
every reference to what it concretely contributed, so future work can extend
the system without breaking its rules.

---

## 1. Source references → what they contributed

### daisyUI 5 (github.com/saadeghi/daisyui)
- Installed as a Tailwind v4 plugin (`@plugin "daisyui"`), built-in themes OFF,
  with a custom **`ignis` theme** (`@plugin "daisyui/theme"`) carrying the
  semantic role palette (base/primary/secondary/accent/success/warning/error).
- Theme vars are duplicated on `:root` as a belt-and-braces fallback so the
  shadcn tokens and daisyUI tokens can coexist without cascade fights.
- Component classes available to all IGNIS markup: `btn`, `badge`, `stat`,
  `skeleton` (repainted via `.skeleton` override to match the dark chrome),
  `radial-progress`, `kbd`, `toast`, `tooltip`, `indicator`.
- `data-theme="ignis"` is pinned on `<html>` in `src/app/layout.tsx`.

### react-bits (github.com/DavidHDev/react-bits)
react-bits ships copy-paste animated components. IGNIS implemented the
high-impact ones locally (zero extra deps, reduced-motion aware) in
`src/components/ignis/fx/`:
| Component | File | Used for |
|---|---|---|
| CountUp | `fx/CountUp.tsx` | KPI telemetry numbers (detections, FRP) |
| SpotlightCard | `fx/SpotlightCard.tsx` | The six KPI cards (pointer-tracked glow) |
| SplitText | `fx/SplitText.tsx` | "Today in brief" staggered reveal |
| Particles → EmberCanvas | `fx/EmberCanvas.tsx` | Header background: drifting embers (canvas 2D, DPR-capped, pauses when tab hidden) |
| Marquee → Ticker | `fx/Ticker.tsx` | Live wire of EONET wildfire headlines |
| (Vuetify ripple) | `fx/RippleLayer.tsx` | Delegated Material ink on `[data-ripple]`/`.btn` |

### Vuetify / Material Design (github.com/vuetifyjs/vuetify)
- **Elevation ladder**: `.elev-0 … .elev-4` + `.elev-glow` / `.elev-ember`
  tuned for a dark control-room surface (in `globals.css`).
- **Ripple**: Material-spec ink origin (pointer position), compositor-only,
  one delegated listener for the whole app, respects reduced-motion.
- **Motion tokens**: 0.2–0.3s ease transitions, hover −translate-y-px lifts,
  tab underline scaleX reveal (`.ignis-tab[data-active]`).
- **Color roles**: every surface/text pair follows Material role thinking
  (container/on-container) rather than ad-hoc hex.

### ui-ux-pro-max-skill (github.com/nextlevelbuilder/ui-ux-pro-max-skill)
The heuristics that gate all v7 markup:
- **No emoji as icons** — replaced across header/KPIs/tabs/map controls/
  alerts with Lucide SVGs (`lucide-react`), all `aria-hidden` with text labels.
- **Visible keyboard focus**: global `:focus-visible` ring (#38bdf8).
- **cursor-pointer** on every interactive element (global rule).
- **Contrast**: body text ≥ 4.5:1 on the #050a14 base (slate-200/300/400 ladder).
- **prefers-reduced-motion** honored globally (animations collapse to 0.01ms).
- **Responsive at 375/768/1024/1440** — verified in QA (390px mobile pass).
- Resilient text: truncation + `title=` on long tokens (regime label, alerts).

### Awesome-Design-Tools (github.com/goabstract/Awesome-Design-Tools)
Used as the curation index for the craft choices: contrast-checked ember
palette (Leonardo-style ramp discipline), Lucide icon system, CSS-only
gradients/texture (no heavy illustration deps), accessibility tooling notes.

---

## 2. World-view inspiration → IGNIS map UX

| Site | Pattern adopted | Where |
|---|---|---|
| earth.nullschool.net | Cursor probe — live "what is under the crosshair" readout | MapPanel probe strip (GL: detection count/max FRP/sensor/conf via `queryRenderedFeatures`; Leaflet: coordinates) |
| NASA Worldview | Layer + imagery switching on a daily cadence | Layers panel (GIBS basemaps/overlays, fire pixels, hexbin, segmentation, forecast) |
| Windy | Layer panel polish + master overlay opacity slider | "Overlay strength" slider in the Layers popover |
| Zoom Earth | Quick temporal presets | 24H / 48H / 7D chips wired to the FIRMS window |
| NASA Worldview timeline | Day scrubbing + replay | Timeline scrubber (`input[type=range]`) + speed cycle |

**Keyboard shortcuts** (press K in the app for the cheat-sheet):
F fullscreen · L layers · T 3D terrain · G 3D fire field · B 3D towers ·
R replay · H hexbin · S segmentation · 1-4 style modes · K cheat-sheet · Esc exit.

---

## 3. New keyless data feeds (public-apis sweep)

| Feed | Route | Role | Fallback |
|---|---|---|---|
| GDACS RSS (EC/JRC + UN) | `/api/gdacs` | Authority wildfire alerts w/ alert level, geo, ISO3, severity (ha) | empty list, UI degrades |
| ReliefWeb RSS (UN OCHA) | `/api/reliefweb` | On-the-ground disaster reports; wildfire-first, honest "context" labeling | empty list, UI degrades |
| Wikipedia REST | `/api/context` | "What am I looking at?" region placard + ask-the-Analyst hook | component returns null |
| Open-Meteo (existing) | client + `/api/air-quality` | fire weather + CAMS smoke | existing |
| IGNIS digest hook | `/api/hooks/digest` | machine-readable daily rollup for n8n / GH Actions / Vercel Cron | optional bearer token via `IGNIS_HOOK_TOKEN` |

Note: the ReliefWeb JSON APIs now require an approved appname (v1 → 410,
v2 → 403), so IGNIS consumes their RSS with a browser-like UA. Their edge may
406/444 unfamiliar datacenter IPs — the route caches 30 min and the panel
degrades silently.

## 4. Automation (n8n)

- `automation/ignis-n8n-workflow.json` — importable workflow: 24h schedule →
  GET `/api/hooks/digest` → filter "needs attention" → format → Email/Telegram.
- `vercel.json` — daily cron (21:00 UTC) invoking the digest endpoint.
- No secrets are required to run the digest; set `IGNIS_HOOK_TOKEN` on both
  sides only if you want it protected.

---

## 5. Rules for extending the system

1. New components consume FX primitives (`SpotlightCard`, `CountUp`) instead
   of re-rolling animations; keep everything reduced-motion-safe.
2. Icons are Lucide, never emoji; every icon-only control gets `aria-label`.
3. New surfaces use `.ignis-glass` + an `.elev-*` token, not raw hex panels.
4. New colors must land in the `ignis` daisyUI theme first, then be referenced.
5. Map additions must keep the probe, presets, and shortcuts functional on
   BOTH renderers (MapLibre GL + Leaflet DOM) or degrade visibly.
6. Every async panel must render skeleton shimmer (`.ignis-shimmer` or daisyUI
   `skeleton`) and fail into a quiet empty state, never a broken layout.

---

## 6. v7.1 "Worldview Engine" additions

**New map layer family — live weather (keyless, both renderers):**

| Layer | Source | Where |
|---|---|---|
| 🌬 Wind streamlines (default ON) | Open-Meteo wind grid (54-pt bulk, 30-min cache) | `WindCanvas` — earth.nullschool-style geo-anchored Canvas2D particles; destination-out trail fade; perf guard sheds particles on slow frames; dims to 14% while any popup is open (`ignis-popup-open/close` window events); readout chip bottom-right; `W` shortcut |
| 🌧 Rain radar | RainViewer `weather-maps.json` (5-min cache) | raster tiles under fire marks, opacity 0.65 |
| ☁ IR clouds | RainViewer satellite.infrared | raster tiles, opacity 0.45 |

Rules learned: the wind canvas is a SIBLING overlay (z-5) — popups on both
renderers dispatch dim events instead of fighting z-index; Leaflet parity is
mandatory (WindCanvas takes a projector accessor, never a map instance).

**react-bits FX additions** (`src/components/ignis/fx/`):
- `ShinyText` — light sweep; used on RED early-alert badge.
- `GradientText` — ember→sky drift; used on the "Today in brief" lead.
- `AnimatedList` — staggered feed entrance; GDACS / ReliefWeb / EONET lists.

**daisyUI deepening:** `swap` (EXPERT/SIMPLE toggle), `radial-progress`
(detection-confidence ring in every AI event card, color via theme roles).
Rule: daisyUI classes may appear in popup HTML strings (`hotspotAI.ts`) —
Tailwind scans them like any source.

**Cinematic replay:** while playing, a centered chip shows
`▶ REPLAY · <date> · day N/M` with a ping beacon.

**Deliverable doc:** `docs/GITHUB_RESOURCES.md` — the full GitHub resource
inventory (IN USE / RECOMMENDED / CONSIDERED across UI, maps, APIs,
automation, AI, QA) and the world-view-inspiration traceability table.
