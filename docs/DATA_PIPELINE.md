# IGNIS — Data Pipeline

> Reproducible, key-light, archive-first. The full 26-year record is rebuilt from NASA GIBS alone (no FIRMS quota needed); FIRMS NRT powers the live layer at runtime.

## 1. Precompute pipeline (scripts/ignis/)

### build_calendar.mjs → `data/ignis/calendar_<region>.json`

The CLI is a thin wrapper around **`src/lib/ignis/calendarBuilder.ts`** — the same module `/api/calendar?w&s&e&n` uses for on-demand custom-AOI calendars, so preset and custom calendars share one method. Requires Node ≥ 22.18 / 23.6 (native TypeScript type stripping). Paths are resolved relative to the script, so it runs on Windows, macOS and Linux.

```bash
node scripts/ignis/build_calendar.mjs                    # all 9 regions, all 5 sensors, 2 sampled days/month
node scripts/ignis/build_calendar.mjs amazon --samples=6 # denser sampling
node scripts/ignis/build_calendar.mjs bangladesh --full  # every day of every month → exact counts (slow)
node scripts/ignis/build_calendar.mjs --sensors=MODIS-Terra,VIIRS-SNPP --out=./tmp
```

1. **Source**: GIBS WMTS **vector** tiles (epsg4326, z5 = 9°×9° tiles). Same records FIRMS serves — MODIS C6.1 / VIIRS V2 schema (LAT/LON, FRP, CONFIDENCE, DAYNIGHT, SATELLITE).
2. **Sensors**: MODIS Terra (2000-11→), MODIS Aqua (2002-07→), VIIRS S-NPP (2012-01→2026-07), VIIRS NOAA-20 (2020-01→2025-12, GIBS archive), VIIRS NOAA-21 (2024-01→). End months mirror `GIBS_LATEST` in `firms.ts`.
3. **Sampling**: `--samples=N` evenly spaced days per month (N=2 keeps the historical 8th/22nd convention), or `--full` for every day. All z5 tiles intersecting the bbox are fetched; points are bbox-filtered.
4. **Aggregation**: per month per sensor → `MonthRow { ym, sampled, days, est, frp, meanFrp, hiConf, night }`. `hiConf` = MODIS confidence ≥ 80 or VIIRS `h`.
5. **Scaling**: `est = sampled × days-in-month / sampled-days` (= exact count with `--full`).
6. **Harmonization meta**: raw overlap diagnostic (`meanRatioSNPPtoMODIS`, last 6 overlap months). The coefficients actually applied are recomputed in the app — see §1b.
7. Regions: amazon, california, canada, siberia, congo, borneo, australia, mediterranean, **bangladesh** (team home region).

> The calendars currently shipped in `data/ignis/` were built with the earlier 3-sensor (Terra, S-NPP, NOAA-20), 2-day sampling configuration. Re-run the CLI to regenerate them with Aqua + NOAA-21 and/or denser sampling.

### 1b. Harmonization (`buildUnified` in `src/lib/ignis/analytics.ts`)

Reference scale = **VIIRS S-NPP 375 m**.

| Month has… | Harmonized value |
|---|---|
| S-NPP | S-NPP estimate (unscaled) |
| no S-NPP, but NOAA-20 / NOAA-21 | `NOAA-xx × median(S-NPP / NOAA-xx)` over their overlap (≥ 3 months required) |
| MODIS only (pre-2012) | `MODIS-Terra × r(m)` |

`r(m)` is a **seasonal (calendar-month) coefficient**: the median log-ratio S-NPP/MODIS for that calendar month over the 2012+ overlap, shrunk toward the all-months median r̄ (`K0 = 3` pseudo-years), so months with few/noisy overlap years fall back gracefully to r̄. The same is done for FRP. Each unified row records `src` (which sensor it came from); the Calendar tab exports all of it as CSV (harmonized value, source, coefficient, anomaly z, raw per-sensor estimates).

### 1c. Custom-AOI calendars (`GET /api/calendar?w&s&e&n&name`)

Any drawn box, place search or Bangladesh sub-AOI gets its own historical calendar, built on demand with the shared builder (Terra, S-NPP, NOAA-20, NOAA-21; 2 sampled days/month). Capped at 4 z5 archive tiles (≈ a 9°×9° box) to finish inside the 300 s route budget; larger areas get a clear 413 message pointing at the preset regions. Results are cached in memory and in `os.tmpdir()/ignis-calendar-cache`, keyed by the bbox rounded to 0.1°; concurrent requests for the same box share one build. All calendar-driven tabs (Time-Series, Science Lab, Outlook, Regime) then recompute for the custom area.

### build_regimes.mjs → `lib/ignis/regimePrototypes.json`

Feature vectors (peakMonth, seasonality, interannual CV, nightFraction, meanFrp, logMedianCount) computed per region from its calendar → nearest-prototype classification targets for the Burn Regime panel. (z-index bug on first build produced NaN similarities — fixed by aligning feature order between builder and classifier.)

## 2. Runtime layer

| Path | Source | Notes |
|---|---|---|
| `/api/hotspots` | FIRMS area API `area/csv/MODIS_NRT/...` + VIIRS NRT variants | DATE = window **start** (dayRange counts forward — verified empirically on production); satellite column splits Terra/Aqua; 30 s timeout for multi-MB MODIS CSVs |
| `/api/hotspots` fallback | GIBS MVT (server-parsed) | Transparent; response `source: "gibs-mvt"` + note |
| `/api/gibsfires` | GIBS WMTS vector → GeoJSON | Independent cross-check layer on the map |
| LST overlays | GIBS `MODIS_Terra_Land_Surface_Temp_Day/Night` (png @ GoogleMapsCompatible_Level7) | MOD11 V6 scaling: K = raw×0.02, ε = raw×0.02+0.49, fill = 0; legend documents it |

## 3. Known coverage edges (surfaced in UI, not hidden)

- GIBS VIIRS vector archive lags NRT (S-NPP → 2026-07, NOAA-20 → 2025-12) — affects fallback path only; FIRMS NRT is primary and live in production.
- GIBS thermal-anomaly layers are **vector-only** in epsg3857 (raster requests 400 — root cause of the historical tile errors; fixed by serving parsed MVT via `/api/gibsfires`).
- Pre-2012 rows are MODIS-scaled estimates (`scaled: true`, `src: "MODIS-Terra"`); the UI marks them and shows the continuity ratio CV.
- With the default 2-day sampling, monthly values are **estimates**; use `--full` for exact counts. The seasonal coefficient corrects the average sensitivity/resolution gap between sensors but not per-fire differences in overpass timing.

## 4. Hugging Face artifact

All 9 calendars + 9 outlooks + the build scripts ship as a versioned HF dataset with a full dataset card: **[Nabidnur/ignis-fire-calendar](https://huggingface.co/datasets/Nabidnur/ignis-fire-calendar)**. Re-running `build_calendar.mjs` against GIBS reproduces them (dates of sampled days are deterministic).
