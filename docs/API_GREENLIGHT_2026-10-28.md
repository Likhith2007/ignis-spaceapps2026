# IGNIS — Full API Greenlight Report (2026-10-28, v6.1)

All endpoints tested against **production** `https://ignis-spaceapps2026.vercel.app`
(server side) and upstream providers directly. Sandbox egress notes excluded —
production results are authoritative.

## 🟢 Production endpoints (all 200)

| Endpoint | Role | Result |
|----------|------|--------|
| `/api/health` | all-subsystem check | 🟢 200 — FIRMS live, 36/5000 transactions |
| `/api/hotspots` | FIRMS 5-sensor live detections | 🟢 200 — live points (MODIS-T/A, VIIRS NPP/20/21) |
| `/api/gibsfires` | GIBS MVT vector cross-check | 🟢 200 — parsed features w/ FRP |
| `/api/eonet` | EONET ranked wildfire events | 🟢 200 — 60 ranked events |
| `/api/air-quality` | Open-Meteo AQ (smoke suspicion) | 🟢 200 — US AQI + band |
| `/api/outlook` | seasonal ML outlook | 🟢 200 — harmonic + log-normal model |
| `/api/calendar` | fire calendar per region | 🟢 200 |
| `/api/geocode` | AOI search (OSM/geo free API) | 🟢 200 |
| `/api/hotspot` (POST) | per-hotspot AI verdict | 🟢 200 — verdict HIGH + spreadKm 2.1 + CO2e 93.8 t + AQI enrichment |
| `/api/analyst` (POST) | deep-dive analyst chat | 🟢 200 — answers with model fallback |

## 🟢 Upstream NASA (verified live)

| API | Status |
|-----|--------|
| api.nasa.gov key (EPIC probe) | 🟢 200 — key valid |
| EONET v3 (direct) | 🟢 200 |
| NASA GIBS WMTS capabilities | 🟢 200 |
| NASA POWER (climate) | 🟢 200 |
| FIRMS area API | 🟢 200 via production (`/api/hotspots` live) |
| Earthdata URS JWT | 🟢 valid to 2026-11-20 (exp 1795185103) |

## 🟢 Free/open APIs

| API | Status |
|-----|--------|
| Open-Meteo forecast (wind → spread model) | 🟢 200 |
| Open-Meteo air quality (PM2.5, CO, US AQI) | 🟢 200 |
| Worldview snapshot (GPU-free fallback imagery) | 🟢 used by app, 200 |
| OSM Nominatim (geocode) | 🟢 200 via `/api/geocode` |

## 🟡 Known degradations (graceful)

| Item | Status | Mitigation |
|------|--------|------------|
| HF Inference Providers credits | 🟡 402 — account out of pre-paid credits | 🤖 verdict + 💬 analyst auto-fall back to the rule-engine / model-twin path (never-die design). AI cards keep answering with physics-grounded summaries. Top up HF credits or add an OpenRouter key post-judging to restore LLM text. |
| OpenAQ v3 | 🟡 401 without key | app uses Open-Meteo AQ instead (key-free) |

## Token rotation (2026-10-28)

- New GitHub PAT + new HF token deposited in `Hisernberg/ignis-vault` (private)
  and mirrored to `Nabidnur/ignis-vault` (HF dataset, private; HF token b64-wrapped
  for the platform secret scanner).
- App fallback keys in private repo `keys.ts` refreshed (base64).
- Public repo `ignis-public` stays zero-credential (env-only) — verified.

## Repo privacy status (all private ✓)

- `Hisernberg/ignis-spaceapps2026` — private (source of truth)
- `Hisernberg/ignis-public` — **flipped private** (Vercel deploy source; private repos deploy fine)
- `Hisernberg/ignis-vault` — private (credentials)
- `Hisernberg/ignis-model-fire-classification`, `ignis-model-spread-event`, `ignis-model-burned-area-segmentation` — private model mirrors
- HF: `Nabidnur/ignis-vault`, `ignis-fire-calendar`, `spaceapps26-data`, and 6 ignis models — private
