# Contributing to IGNIS

IGNIS is a **NASA Space Apps Challenge 2026** project built by Team IGNIS (Bangladesh 🇧🇩).
During judging the repo is private and maintained by the team; after the competition it
opens up and these rules apply to everyone.

## The short version

1. **Fork → branch → PR.** Branches: `feat/<name>`, `fix/<name>`, `docs/<name>`, `qa/<name>`.
2. **One concern per PR.** A PR that changes both a science method and its panel needs a
   note saying why they can't be split.
3. **No credentials, ever.** Keys live in env vars and the private vault. If your diff
   contains a token, the PR is closed and the token is rotated. See [SECURITY.md](SECURITY.md).
4. **Science changes need verification.** Every method in `src/lib/ignis/science.ts` is
   covered by synthetic ground-truth tests (`scripts/tmp/t_science.ts` pattern: plant a
   known signal, assert the method recovers it). A new statistical method ships with its
   own planted-signal test or it doesn't ship.

## Local setup

```bash
git clone https://github.com/Hisernberg/ignis-spaceapps2026.git
cd ignis-spaceapps2026
npm install
npm run dev          # http://localhost:3000
```

The app runs **out of the box with no keys** (GIBS fallback path). For full FIRMS data add
`FIRMS_MAP_KEY` (free: [firms.modaps.eosdis.nasa.gov/api/area](https://firms.modaps.eosdis.nasa.gov/api/area/)),
`NASA_API_KEY`, `HF_TOKEN` to `.env.local`.

## Before you open a PR

- [ ] `npx tsc --noEmit` — **zero errors under `src/`** (template `examples/` noise is tolerated)
- [ ] `npx eslint src --quiet` — clean
- [ ] `npm run build` — green
- [ ] Checked the feature at **390 px width** (mobile) and with `?nogpu=1` (GPU-free renderer)
- [ ] Every new panel still shows **its data source and uncertainty** — the honesty contract
- [ ] No hard-coded numbers that should come from the live record; no emoji where a Lucide
      icon belongs (ui-ux rule)

## Code conventions

- **Deterministic first:** analysis lives in `src/lib/ignis/*.ts` as pure, auditable
  TypeScript. LLMs must never sit in a critical path — they only decorate.
- **Graceful degradation:** every fetch has an empty/error state; every AI feature has a
  rule-engine fallback producing the same structure.
- **Provenance:** panels name their source (FIRMS NRT C6.1/V2, GIBS MVT archive, EONET,
  Open-Meteo…) and flag scaled/derived rows.
- **Commits:** `feat(scope): …` / `fix(scope): …` / `docs(scope): …`, present tense,
  one line that a judge can read. Update `worklog.md` for substantive changes.

## Reviewing (team)

Two eyes on every PR: one **code** review, one **science/QA** review for anything touching
`lib/ignis/`. The judge scorecard ([docs/JUDGE_SCORECARD.md](docs/JUDGE_SCORECARD.md)) is the
quality bar: relevance, validity, honesty, accessibility.
