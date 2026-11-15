# IGNIS documentation

The full reference set for the project. Start with the [README](../README.md) for the
overview, or the [Complete Feature Guide](FEATURES.md) for every feature in detail.

| Doc | What it covers |
|---|---|
| **[FEATURES.md](FEATURES.md)** | **The complete feature encyclopedia** — every panel, control, method and export: what it is, how to use it, its data source |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design: renderers, API routes, lib modules, data flow |
| [DATA_PIPELINE.md](DATA_PIPELINE.md) | How the 26-year harmonized record is built from the GIBS archive |
| [APIS.md](APIS.md) | Upstream API catalogue + greenlight report |
| [API_EXPANSION.md](API_EXPANSION.md) | Tier-0-4 free-API registry and integration priorities |
| [UI_UX_SYSTEM.md](UI_UX_SYSTEM.md) | Design system: tokens, motifs, motion, the BLAZE map language |
| [SUBMISSION.md](SUBMISSION.md) | NASA Space Apps submission checklist + demo-video script |
| [JUDGE_SCORECARD.md](JUDGE_SCORECARD.md) | Self-scoring against the official rubric, per round |
| [SECURITY.md](SECURITY.md) | Credential policy, vault layout, rotation runbook |
| [BRAND.md](BRAND.md) | Logo, wordmark, color system |
| [AUTOMATION_RUNBOOK.md](AUTOMATION_RUNBOOK.md) | n8n / cron digest-hook operations |
| [hf/DATASET_CARD.md](hf/DATASET_CARD.md) | Model card companion for the Hub dataset |
| [deliverables/](deliverables/) | Challenge analysis + master plan (PDF/HTML) |

## Reading order by role

- **Judge / reviewer:** README → FEATURES.md → JUDGE_SCORECARD.md → live app
- **Scientist:** DATA_PIPELINE.md → Science Lab section of FEATURES.md → `src/lib/ignis/science.ts`
- **Operator / responder:** FEATURES.md §3, §6, §9 (brief, rail, exports) → Watchlist
- **Developer:** ARCHITECTURE.md → CONTRIBUTING.md → lib modules
