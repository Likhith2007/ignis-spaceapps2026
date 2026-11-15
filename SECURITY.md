# Security Policy

IGNIS handles only **open NASA / UN / community data** — no personal data, no user
accounts, no third-party secrets exposed to the client. The full policy lives in
[docs/SECURITY.md](docs/SECURITY.md); this file summarizes what you need to act on it.

## Supported versions

| Version | Supported |
|---|---|
| `main` (production: [ignis-spaceapps2026.vercel.app](https://ignis-spaceapps2026.vercel.app)) | ✅ during the NASA Space Apps 2026 judging period |
| older tags / branches | ❌ |

## Reporting a vulnerability

- **Private repos (judging period):** open a GitHub *Security Advisory* (**Security →
  Report a vulnerability**) or contact the team lead directly — **do not open a public
  issue** for anything credential- or injection-related.
- After the public release: use GitHub private vulnerability reporting on this repo.

## What we protect

1. **Credentials** (`FIRMS_MAP_KEY`, `NASA_API_KEY`, `HF_TOKEN`, Earthdata JWT) live only
   in environment variables / the private vault — never in source, never in git history,
   never in issue text. Rotation runbook: [docs/SECURITY.md](docs/SECURITY.md).
2. **Client inputs** — AOI boxes, coordinates, search strings — are validated server-side
   (Zod) and clamped before they reach upstream APIs.
3. **Supply chain** — Dependabot watches npm weekly; CI builds from a lockfile.

## Known non-issues

- The app ships base64-encoded *fallback* constants for keyless demo mode — they are not
  secrets and grant only public NASA data access. Policy: [docs/SECURITY.md](docs/SECURITY.md).
- Rate limits on `/api/*` come from Vercel's platform; the digest hook supports an optional
  `IGNIS_HOOK_TOKEN` bearer guard.
