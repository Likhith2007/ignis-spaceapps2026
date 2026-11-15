# IGNIS — API Expansion Registry

> Companion to `docs/APIS.md` (the 32/34 greenlight report). This file answers:
> *"list if any more free apis, or apis i can provide here to make it better."*
> Every entry is classified by verification tier and integration value for the
> Harmonization of MODIS & VIIRS Hot Spots challenge.

## Tier 0 — already integrated & greenlit (see APIS.md)

| API | Role in IGNIS |
|---|---|
| NASA FIRMS Area API (MAP_KEY) | Primary live hotspot record — 5 sensors, 10-day windows |
| NASA GIBS WMTS (raster + MVT vector) | Basemaps (true-color, 7-2-1 fire false color) + independent fallback hotspot path to Nov 2000 |
| NASA EONET v3 | Event triage headlines |
| api.nasa.gov (APOD · EPIC · DONKI) | Context + outreach imagery |
| NASA CMR + Earthdata Login (JWT) | Granule search + operational token health |
| Open-Meteo Forecast | Fire-weather (wind/RH/temp) + 7-day early warning |
| Open-Meteo Air Quality (CAMS) | PM2.5/AOD/CO smoke readout + US AQI bands |
| OSM Nominatim | Geocode any place on Earth → AOI |
| RainViewer | Radar + cloud overlays (worldview-style replay) |
| GDACS (EC/JRC) + ReliefWeb (UN OCHA) | Authority alerts + disaster reports |
| Wikimedia geosearch | Region context cards |
| Hugging Face Inference | Llama-3.1-8B verdict + Qwen3-8B deep-dive (rule-engine fallback) |

## Tier 1 — verified from this workspace (2026-10-29)

| API | Status | What it adds | Effort |
|---|---|---|---|
| **NIFC/WFIGS Wildland Fire Perimeters (ArcGIS REST)** | ✅ HTTP 200 keyless (`services3.arcgis.com/T4QSynaggscfAnFm/.../WFIGS_-_Wildland_Fire_Perimeters__Current_/FeatureServer/0/query`) | Named US incident cross-check: match IGNIS clusters to official incident names/acreage — a responder-grade trust multiplier | Small — one route + map label join |
| **OpenAQ v3** | ✅ reachable, 401 without key (free key at explore.openaq.org) | Ground-station PM2.5 to validate the CAMS smoke readout where people actually breathe | Small — reuse air-quality route shape |

## Tier 2 — doc-verified free, needs layer/credential wiring

| API | Access | What it adds | Note |
|---|---|---|---|
| **NOAA HMS Smoke Polygons** | Public archive (satepsanone.nesdis.noaa.gov, /FIRE/web/HMS/Smoke_Polygons/) | Official daily NOAA smoke-plume polygons → overlay IGNIS clusters inside smoke | Path listing returned 404 from sandbox; verify current path + format (SHP/KML) from production |
| **GIBS Sentinel-5P / OMI trace-gas layers** | Keyless WMTS | CO total column / aerosol index as an extra smoke-transport overlay | Layer ids to be resolved via GetCapabilities (`scripts/gibs_caps.py` pattern); sandbox probes returned 400 for guessed ids |
| **NASA POWER** | Keyless REST | Climate normals per AOI (feeds burn-regime context) | Already scripted in the private vault (`power_pull.py`) |
| **Copernicus DEM 30m** | Keyless (AWS Open Data / CDSE free) | Higher-fidelity terrain for the 3D Fire Field than SRTM | Tile stitching cost |
| **USGS 3DEP** | Keyless | US-only 10–30 m terrain | Same consumer as Copernicus DEM |
| **EFFIS (Copernicus)** | Keyless REST/WMS | European fire current-situation + danger index | Complements GDACS for EU AOIs |
| **Wikimedia / OSM standard tiles** | Keyless (attribution) | Basemap alternates for low-bandwidth mode | Leaflet-native |

## Tier 3 — free keys the team can provide (registration required)

| API | Key cost | What it unlocks |
|---|---|---|
| **Copernicus ADS (CAMS global)** | Free account | Raw aerosol/CO reanalysis + 5-day smoke transport forecasts → next-level Feature 4 (Smoke & AQ) |
| **Global Forest Watch (GFW)** | Free app token | Tree-cover loss + GLAD alerts intersected with burn scars |
| **MapTiler / Stadia** | Free dev tier | polished vector basemaps beyond GIBS |
| **Tomorrow.io / WeatherAPI** | Free tier | hyper-local fire-weather redundancy vs Open-Meteo |
| **Sentinel Hub (CDSE) free tier** | Free account | Sentinel-2 burn-scar true color for postfire assessment (WOFS/BA-style) |
| **Planet NICFI Basemaps** | Free for tropics | Monthly tropical basemaps — Amazon/Congo/Borneo AOIs |

## Integration priority (champion logic)

1. **WFIGS incident join** (Tier 1, keyless, verified) — pairs the AI event card with the *official* incident name; highest judge-visible trust per line of code.
2. **GIBS S5P/OMI trace-gas overlay** — pure GIBS (already the fallback spine), zero new credentials; resolve layer ids via GetCapabilities.
3. **OpenAQ ground truth** — one free key; validates Feature 4 smoke readouts.
4. **CAMS ADS raw forecasts** — the single biggest smoke-feature upgrade; queue for post-hackathon v8.
5. **Copernicus DEM in Fire Field 3D** — visual wow + terrain-driven spread realism.

## Suite health note (2026-10-29)

FIRMS remains sandbox-egress-blocked (definitive checks run on GitHub Actions / production, per APIS.md). NASA Earthdata's banner — **new Suomi NPP data delivery ceases Nov 2, 2026** — makes IGNIS's NOAA-20/NOAA-21-first continuity design not just correct but *urgent*: the app already fuses all five sensors, so the S-NPP sunset degrades nothing. This is the strongest possible one-line answer to "why does harmonization matter" on demo day.
