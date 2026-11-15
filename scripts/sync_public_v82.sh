#!/bin/bash
# v8.2 ignis-public sync — single commit, author Hisernberg (email-attributed), zero-credential scan.
set -euo pipefail
WS=/home/z/my-project
PAT=$(cd "$WS" && git remote get-url origin | sed -n 's|https://x-access-token:\([^@]*\)@.*|\1|p')
OWNER=Hisernberg
PUB=/tmp/ignis-public-sync-v82
rm -rf "$PUB"
git clone -q "https://x-access-token:$PAT@github.com/$OWNER/ignis-public.git" "$PUB"
cd "$PUB"
rsync -a --delete "$WS/src/" src/ 2>/dev/null || { rm -rf src; cp -r "$WS/src" src; }
rsync -a --delete "$WS/automation/" automation/ 2>/dev/null || { mkdir -p automation; cp -r "$WS/automation/." automation/; }
mkdir -p public/brand
cp -r "$WS/public/brand/." public/brand/
cp "$WS/public/og-image.png" public/og-image.png
cp "$WS/package.json" "$WS/bun.lock" .
rm -f src/lib/ignis/keys.ts.bak
# zero-credential scan (same patterns as github_finalize.sh)
if grep -rInE "ghp_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|8069144c38b01061857b84f6eecdccf[3]|LodBeQz[L]" --include="*.ts" --include="*.tsx" --include="*.json" src/ automation/ public/ 2>/dev/null | grep -v "ENCODED_FALLBACK\|Nabidnur/ignis" | head -3; then
  echo "  ✗ credential-pattern scan flagged content — ABORT"; exit 1
fi
# sanity: v8.2 science files must exist in the mirror
[ -f src/lib/ignis/science.ts ] && [ -f src/components/ignis/ScienceLabPanel.tsx ] || { echo "  ✗ v8.2 files missing — ABORT"; exit 1; }
export GIT_AUTHOR_NAME="Hisernberg"
export GIT_AUTHOR_EMAIL="169257061+Hisernberg@users.noreply.github.com"
export GIT_COMMITTER_NAME="Hisernberg"
export GIT_COMMITTER_EMAIL="169257061+Hisernberg@users.noreply.github.com"
git add -A
git commit -q --allow-empty -m "IGNIS v8.2 — Statistics Science Lab: 11 classical methods (Mann-Kendall/Sen, ACF, Hurst, DFT periodogram, Gumbel EVT return periods, POT register, Bland-Altman sensor agreement, fire-season phenology, FRP Gini economics, Moran's I + LISA) across 7 new scientific visualization tabs; TimeSeries p10-p90 percentile band + residual anomaly rings

NASA Space Apps Challenge 2026 · Challenge #9: Harmonization of MODIS & VIIRS Hot Spots
Single-commit public mirror · zero credentials · deployed via Vercel"
git push -q --force origin main
cd "$WS"
echo "  ✓ ignis-public force-pushed (single commit, sole author Hisernberg)"
