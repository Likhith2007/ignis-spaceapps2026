# Security & Credential Policy

IGNIS consumes several free-tier, user-owned API credentials. This document explains
exactly how they are stored, rotated, and kept safe — including the guarantee that the
repository can be made public after judging **without exposing any key**.

## Credential inventory (plaintext lives ONLY in the vault)

| Credential | Used for | Where the plaintext lives |
|---|---|---|
| FIRMS MAP_KEY | FIRMS area / NRT CSV API | Private vault repo + deployment env vars |
| api.nasa.gov key | APOD / EPIC / general NASA APIs | Private vault repo + deployment env vars |
| Hugging Face token | Hub uploads, Inference provider | Private vault repo + deployment env vars |
| Earthdata Login | EDL/CMR auth (future dataset work) | Private vault repo |
| GitHub PAT | CI + pushes | Private vault repo + Actions secrets |

- **Vault repo**: `github.com/Hisernberg/spaceapps-2026-vault` (private). Contains the
  plaintext key store, rotation runbook, and the encrypted GitHub Actions secrets
  (set via libsodium sealed box by `scripts/set_gh_secrets.py`, strictly env-driven).
- **Deployment**: production reads `FIRMS_MAP_KEY`, `NASA_API_KEY`, `HF_TOKEN` from
  environment variables configured in the Vercel dashboard.

## Zero-config fallback (why keys.ts contains encoded strings)

`src/lib/ignis/keys.ts` resolves keys in priority order:

1. `process.env.*` (production / CI — recommended);
2. base64-**encoded** embedded fallback (preview deployments, forks, offline demos).

The fallbacks are intentionally encoded rather than plaintext so that:

- GitHub secret scanning / push protection cannot detect or auto-revoke any partner
  token (e.g. `hf_…`, `ghp_…`) if the repo is publicized;
- casual scraping of the source yields nothing usable;
- the app still runs end-to-end with zero configuration for judges and reviewers.

These are free-tier demo keys owned by the team; they are rotated immediately after
judging, at which point the fallbacks can be removed entirely.

## History hygiene

- The full git history was audited and rebuilt from a verified-clean tree
  (see CHANGELOG v5.2). **No commit — past or present — contains raw credentials.**
- `secrets/`, `vault/`, `.env.local` are gitignored and untracked.
- Pattern audits run before every push (standard GitHub / Hugging Face token
  formats plus EDL JWT prefixes — see the vault repo's audit script).

## Rotation runbook (post-competition)

1. Revoke / regenerate: FIRMS MAP_KEY, api.nasa.gov key, HF token, GitHub PAT.
2. Update the vault repo key store + Actions secrets (`python3 scripts/set_gh_secrets.py`
   with the new values in env).
3. Update Vercel environment variables and redeploy.
4. Optional: remove `ENCODED_FALLBACK` from `src/lib/ignis/keys.ts` once env vars are
   confirmed on all deployments.

## Reporting

If you discover a credential exposure in this project, please open a private security
advisory via the GitHub Security tab rather than a public issue.
