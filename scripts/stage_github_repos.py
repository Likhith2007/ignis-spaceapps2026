#!/usr/bin/env python3
"""Stage ALL private GitHub repos for the IGNIS final submission (run once now;
pushed later by scripts/github_finalize.sh when a fresh PAT is provided).

Repos staged under /home/z/my-project/repos_stage/ (gitignored):
  ignis-vault                    — plaintext credential vault (PRIVATE)
  ignis-model-fire-type          — fire-TYPE model (train script, weights, metrics)
  ignis-model-fire-spread        — 6h spread model
  ignis-model-fire-classifier    — fire-behavior classifier
  ignis-model-event-detector     — extreme-month early warning
  ignis-model-footprint-forecaster — next-day footprint segmentation
  ignis-model-fire-regime        — DBSCAN+KMeans regime model
  ignis-data                     — harmonized calendars + analysis CSVs
"""
import json, pathlib, shutil, os

WS = pathlib.Path('/home/z/my-project')
STAGE = WS / 'repos_stage'
if STAGE.exists():
    shutil.rmtree(STAGE)
STAGE.mkdir(parents=True)
OUT = WS / 'scripts/models/out'
HFOUT = WS / 'scripts/hf_model/out'

MIT = """MIT License

Copyright (c) 2026 Team IGNIS — NASA Space Apps Challenge 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

def stage(name, files, readme, extra=None):
    d = STAGE / name
    d.mkdir(parents=True)
    (d / 'README.md').write_text(readme)
    (d / 'LICENSE').write_text(MIT)
    for src, dst in files:
        src = pathlib.Path(src)
        dstp = d / dst
        dstp.parent.mkdir(parents=True, exist_ok=True)
        if src.exists():
            shutil.copy(src, dstp)
        else:
            print(f'  !! missing {src}')
    if extra:
        extra(d)
    print(f'✓ staged {name} ({sum(1 for _ in d.iterdir())} files)')
    return d

# ---------------------------------------------------------------- vault ----
GH_PAT = os.environ.get('GITHUB_TOKEN', '')  # from env — never hard-coded (SECURITY.md)
vault_env = (WS / 'secrets/.env').read_text() + os.environ.get('VAULT_CREDENTIALS_EXTRA', '')
stage('ignis-vault', [
    (WS / 'vault/rotation_map.md', 'rotation_map.md'),
], """# 🔐 IGNIS Vault — private credential store

**PRIVATE repository — never publish.** Holds the IGNIS platform's API
credentials (`api_keys.env`) and the rotation map. Mirrored (base64-encoded)
at huggingface.co/datasets/Nabidnur/ignis-vault.

The deployed app NEVER reads this repo at runtime — credentials live in
Vercel environment variables, and the code fallbacks are base64-encoded.
Rotate everything after judging (see rotation_map.md).
""", extra=lambda d: (d / 'api_keys.env').write_text(vault_env))

# rotation map
(STAGE / 'ignis-vault/rotation_map.md').write_text("""# Credential rotation map

| key | used by | set in | rotate at |
|---|---|---|---|
| FIRMS_MAP_KEY | FIRMS area API | Vercel env `FIRMS_MAP_KEY` + keys.ts fallback | firms.modaps.eosdis.nasa.gov account |
| NASA_API_KEY | api.nasa.gov (EONET, etc.) | Vercel env `NASA_API_KEY` + keys.ts fallback | api.nasa.gov profile |
| EDL_TOKEN | CMR / EDL privileged endpoints | Vercel env `EDL_TOKEN` + keys.ts fallback | urs.earthdata.nasa.gov — EXPIRES 2026-11-20 |
| HF_TOKEN | Inference router + Hub reads + model family | Vercel env `HF_TOKEN` + keys.ts fallback | huggingface.co/settings/tokens |
| GITHUB_TOKEN | CI / vault automation / mirror sync | GitHub Actions secret + this vault | github.com/settings/tokens |

## Status 2026-10-29
- GitHub PAT (round 2026-10-29) → **401 Bad credentials (revoked)** — likely auto-revoked
  by GitHub secret scanning after chat-log exposure. Generate a fresh classic PAT
  (repo scope) and paste it into api_keys.env + `scripts/github_finalize.sh`.
- HF account credits exhausted (router 402) → LLM verdict/analyst fall back to the
  deterministic rule engine until PRO/credits are enabled. All other AI features
  (twins, threat badges, AQ, impact) are credit-free.
""")

# ---------------------------------------------------------------- models ----
def model_stage(repo, out_dir, title, body, artifacts, script):
    stage(repo, [(out_dir / a, a) for a in artifacts] + [(out_dir / script, script)],
          f"""# {title}

{body}

**PRIVATE during judging** · released publicly after the competition.
Strong model lives on Hugging Face: https://huggingface.co/Nabidnur/{repo.replace('ignis-model-', 'ignis-' if 'regime' in repo else 'ignis-')}
(HF repos: `ignis-fire-type-model` → this repo; naming: GitHub `ignis-model-*`, HF `ignis-*`.)

## Contents
{chr(10).join(f'- `{a}`' for a in artifacts)}
- `{script}` — full training script (scikit-learn 1.5, numpy, pandas)

## In-app integration
The IGNIS web app carries a TypeScript portable twin of this model (flat node
arrays) so inference is instant and network-free for end users. See
`src/lib/ignis/` in the main repo.

## License
MIT — see LICENSE. Data: NASA FIRMS/LANCE (public domain).
""")

model_stage('ignis-model-fire-type', OUT / 'ignis-fire-type-model',
    'IGNIS Fire-Type Model — per-detection fire-TYPE classification (5 classes)',
    """Classifies every FIRMS hotspot detection into AGRICULTURAL / FOREST /
GRASS_SAVANNA / URBAN_INTERFACE / INDUSTRIAL_FLARE using FRP, confidence,
diurnal phase, sensor family, multi-scale local density (5/25/100 km) and
biome/season priors. Weak supervision from a documented physics + land-use
rule engine over 5,000 real multi-region FIRMS detections (+180 documented
physics-informed flare augmentations).

Holdout: HGB reference acc 0.993 / macro-F1 0.990 · Extra-Trees TS twin
acc 0.837 / macro-F1 0.839 · TS-export agreement 1.000.

LIVE in IGNIS: fire-type chip on every map popup + AI event card
(`src/lib/ignis/typeWeights.json`).""",
    ['ignis_fire_type_model.joblib', 'type_weights.json', 'metrics.json', 'labeled_sample.csv'],
    'train_fire_type.py')

model_stage('ignis-model-fire-spread', OUT / 'ignis-fire-spread-model',
    'IGNIS Fire Spread Model — 6-hour spread-radius prediction (km)',
    """Predicts how far a hotspot / fire front travels in the next 6 hours from
FRP, confidence, night overpass, 25 km density, wind, RH, temperature and a
latitude fuel-type prior. Generator: literature-anchored head-fire spread
(fuel baselines × FRP × Byram-style wind^1.3 × RH damping × night relaxation),
90k weather-envelope samples, validated for plausibility against the real
IGNIS fire-complex record.

Holdout: HGB reference R² 0.967 / MAE 0.84 km · Extra-Trees TS twin R² 0.920 /
MAE 1.30 km · TS-export agreement 1.0000.

LIVE in IGNIS: 6h spread forecast row on every popup + AI card, weather-upgraded
when live Open-Meteo data is present (`src/lib/ignis/spreadWeights.json`).""",
    ['ignis_fire_spread_model.joblib', 'spread_weights.json', 'metrics.json'],
    'train_spread.py')

model_stage('ignis-model-fire-classifier', OUT / 'ignis-fire-classifier',
    'IGNIS Fire Classifier — weakly-supervised fire-behavior classification',
    """Classifies each FIRMS hotspot detection into ISOLATED / SCATTERED /
EMERGING / ESTABLISHED / MEGAFIRE from per-detection features (FRP, confidence,
diurnal phase, sensor family, multi-scale local density). Labels are weak
supervision from the IGNIS DBSCAN complex segmentation engine. Temporal holdout:
accuracy 0.75, macro-F1 0.55 on the fully held-out day; portable Extra-Trees
twin held-out-day agreement 0.685 (HGB reference 0.763).

LIVE in IGNIS: every detection scored server-side; cluster ML votes in the
Fire Cluster Lab.""",
    ['ignis_fire_classifier.joblib', 'ignis_fire_classifier_logreg.joblib', 'metrics.json', 'labeled_sample.csv'],
    'train_classifier.py')

model_stage('ignis-model-event-detector', OUT / 'ignis-event-detector',
    'IGNIS Event Detector — next-month extreme-fire-month early warning',
    """Predicts whether NEXT month will be an extreme fire month (z ≥ 2 vs the
2000-2021 climatology) from lagged harmonized MODIS+VIIRS calendar features
across 9 regions. HGB reference: AUC 0.740 / PR-AUC 0.606 on the hard
2022-2026 holdout (the record 2023-24 fire years). Ships portable logistic
weights (weights.json) wired into the IGNIS web app for deterministic
in-browser scoring.

LIVE in IGNIS: Seasonal Outlook P(extreme month) badge.""",
    ['weights.json', 'ignis_event_detector.joblib', 'ignis_event_detector_hgb_reference.joblib', 'live_scores.json', 'metrics.json'],
    'train_event_detector.py')

model_stage('ignis-model-footprint-forecaster', OUT / 'ignis-fire-footprint-forecaster',
    'IGNIS Fire-Footprint Forecaster — segmentation-based next-day fire-complex footprint',
    """Cell-wise (0.05°) segmentation model predicting tomorrow's fire-complex
footprint from prior-days detection-density features (multi-bandwidth Gaussian
KDE, FRP-weighted density). Strict forward holdout (train targets 09-17..19,
test target 2026-09-20): Amazon IoU 0.657, Congo 0.549, Borneo 0.500 vs
persistence baseline 0.355/0.388/0.378 — 1.3-1.9× skill.

LIVE in IGNIS: 🔮 next-day footprint probability overlay on the map.""",
    ['ignis_fire_footprint_forecaster.joblib', 'metrics.json'],
    'train_footprint_forecaster.py')

model_stage('ignis-model-fire-regime', HFOUT,
    'IGNIS Fire Regime Model — DBSCAN complex segmentation + K-means regime classifier',
    """The original IGNIS model: StandardScaler→DBSCAN complex segmentation
(63 complexes, silhouette 0.178) + K-means k=6 fire-regime classifier, trained
on 138,118 real FIRMS detections across Amazon, Congo and Borneo.

LIVE in IGNIS: Burn Regime panel.""",
    ['ignis_fire_segmenter.joblib', 'metrics.json', 'complexes_summary.json'],
    'train_segmenter.py')

# ----------------------------------------------------------------- data ----
data_files = [(WS / f'data/ignis/calendar_{r}.json', f'calendars/calendar_{r}.json')
              for r in ['amazon', 'california', 'canada', 'siberia', 'congo', 'borneo', 'australia', 'mediterranean', 'bangladesh']]
data_files += [
    (WS / 'data/ignis/analysis/ignis_calendar_long.csv', 'analysis/ignis_calendar_long.csv'),
    (WS / 'data/ignis/analysis/ignis_complexes_latest.csv', 'analysis/ignis_complexes_latest.csv'),
    (WS / 'data/ignis/analysis/ignis_emissions_estimates.csv', 'analysis/ignis_emissions_estimates.csv'),
    (WS / 'data/ignis/analysis/ignis_regime_matrix.csv', 'analysis/ignis_regime_matrix.csv'),
    (HFOUT / 'complexes_summary.json', 'analysis/complexes_summary.json'),
]
stage('ignis-data', data_files, """# IGNIS Data Store — harmonized 26-year fire calendars (private mirror)

Private mirror of the Hugging Face dataset **Nabidnur/ignis-fire-calendar**:

- `calendars/calendar_<region>.json` — 9 regions × 26-year harmonized
  MODIS+VIIRS monthly burning calendars (detections, FRP, hi-conf share,
  night share, harmonization metadata)
- `analysis/` — fire-complex catalog, long-format calendar, FIRST-ORDER
  emissions estimates (FRE = FRP × 1800 s · DM 0.223 kg/MJ · CO2e 1.61 kg/kg),
  regime prototypes matrix

Source data: NASA FIRMS/LANCE (MODIS C6.1 Terra/Aqua + VIIRS V2 S-NPP/NOAA-20/
NOAA-21) and NASA GIBS. Public domain source; derived artifacts MIT.
**PRIVATE during judging.**
""")

print('\nAll repos staged under', STAGE)
print('Next: scripts/github_finalize.sh $GITHUB_PAT')
