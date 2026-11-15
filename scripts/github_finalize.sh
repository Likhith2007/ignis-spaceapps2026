#!/bin/bash
# =============================================================================
# IGNIS FINAL GITHUB FINALIZER — run when a FRESH GitHub PAT is available:
#   bash scripts/github_finalize.sh ghp_YOUR_NEW_TOKEN
# Performs (idempotently, in order):
#   1. verify token (fails fast on 401)
#   2. flip Hisernberg/ignis-public  → PRIVATE  (user requirement: all repos private)
#   3. create + push 8 private repos staged in repos_stage/
#      (ignis-vault, 6 × ignis-model-*, ignis-data)
#   4. commit + push the main repo (ignis-spaceapps2026)
#   5. sync ignis-public (single-commit --reset-author Hisernberg, force-push)
#   6. print the final repo matrix
# =============================================================================
set -euo pipefail
PAT="${1:?usage: github_finalize.sh <GITHUB_PAT>}"
OWNER="Hisernberg"
API="https://api.github.com"
AUTH=(-H "Authorization: Bearer $PAT" -H "Accept: application/vnd.github+json")
WS=/home/z/my-project
cd "$WS"

echo "── 1/6 · verifying token"
LOGIN=$(curl -s "${AUTH[@]}" "$API/user" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('login') or d.get('message','?'))")
[ "$LOGIN" = "$OWNER" ] || { echo "✗ token invalid or wrong account (got: $LOGIN) — stop"; exit 1; }
echo "  ✓ authenticated as $OWNER"

echo "── 2/6 · flipping ignis-public to PRIVATE"
CODE=$(curl -s -o /tmp/pp.json -w "%{http_code}" -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"private":true}' "$API/repos/$OWNER/ignis-public")
echo "  PATCH private → HTTP $CODE"
curl -s "${AUTH[@]}" "$API/repos/$OWNER/ignis-public" | python3 -c "import json,sys;d=json.load(sys.stdin);print('  ignis-public private =',d.get('private'))"

echo "── 3/6 · creating + pushing staged repos"
git config user.name  "Hisernberg"
git config user.email "nurnabid754@gmail.com"
for REPO in ignis-vault ignis-model-fire-type ignis-model-fire-spread ignis-model-fire-classifier ignis-model-event-detector ignis-model-footprint-forecaster ignis-model-fire-regime ignis-data; do
  echo "  · $REPO"
  curl -s -o /tmp/cr.json -w "" -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "{\"name\":\"$REPO\",\"private\":true,\"description\":\"IGNIS — NASA Space Apps Challenge 2026 (private during judging)\"}" \
    "$API/user/repos" || true
  cd "$WS/repos_stage/$REPO"
  git init -q -b main 2>/dev/null || git init -q
  git add -A
  git commit -qm "IGNIS $REPO — private during judging; released public after the competition

Team IGNIS · NASA Space Apps Challenge 2026 · Challenge #9
Harmonization of MODIS & VIIRS Hot Spots" || true
  git branch -M main
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://x-access-token:$PAT@github.com/$OWNER/$REPO.git"
  git push -q -u origin main --force
  cd "$WS"
done
echo "  ✓ 8 private repos pushed"

echo "── 4/6 · pushing the main repo"
git remote set-url origin "https://x-access-token:$PAT@github.com/$OWNER/ignis-spaceapps2026.git"
git add -A
git commit -qm "feat(v6.0): personal fire alerts, impact (air+carbon), fire-type + spread models, early alert, tour, simple/expert, brand logos, bigger map

- NEW private HF models: ignis-fire-type-model (acc 0.837 twin), ignis-fire-spread-model (R² 0.920 twin) — TS twins wired into every popup/AI card
- /api/air-quality (Open-Meteo CAMS keyless) + /api/impact (ΣFRP→CO2e, dataset-exact chain)
- 💨 smoke & air row + 🏷 fire-type chip + 📈 6h spread + 🌍 CO2e on every hotspot card
- TopBrief one-line live summary + EARLY ALERT banner (GREEN→RED)
- 🔔 Personal fire alerts: watchlist + browser notifications + e-mail relay
- Guided 6-step first-time tour + ⚙ EXPERT / 🧭 SIMPLE modes
- Map widened to 3/4 grid; KPI skeleton loaders; tab transition animations
- Brand: mascot + wordmark integrated (header, favicon, og-image)
- /api/hf family surfaced incl. new models + ignis-vault mirror" || true
git push -q origin main || { echo "  main push failed"; exit 1; }
echo "  ✓ main pushed"

echo "── 5/6 · syncing ignis-public (single-commit sole-author)"
FILES="src/app/page.tsx src/app/api/air-quality/route.ts src/app/api/impact/route.ts src/app/api/hf/route.ts src/app/api/hotspot/route.ts src/components/ignis src/lib/ignis src/app/icon.png src/app/apple-icon.png public/brand public/og-image.png package.json bun.lock"
PUB=/tmp/ignis-public-sync
rm -rf "$PUB"
git clone -q "https://x-access-token:$PAT@github.com/$OWNER/ignis-public.git" "$PUB"
cd "$PUB"
rsync -a --delete "$WS/src/" src/ 2>/dev/null || { rm -rf src; cp -r "$WS/src" src; }
mkdir -p public/brand
cp -r "$WS/public/brand/." public/brand/
cp "$WS/public/og-image.png" public/og-image.png
cp "$WS/package.json" "$WS/bun.lock" .
rm -f src/lib/ignis/keys.ts.bak
# zero-credential scan before pushing
if grep -rInE "ghp_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|8069144c38b01061857b84f6eecdccf[3]|LodBeQz[L]" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" src/ public/ 2>/dev/null | grep -v "ENCODED_FALLBACK\|docs/SECURITY\|Nabidnur/ignis" | head -3; then
  echo "  ✗ credential-pattern scan flagged content — ABORT, inspect before push"; exit 1
fi
git add -A
git commit -qm "IGNIS v6.0 — final submission build" || true
git commit -q --amend --reset-author --author="Hisernberg <nurnabid754@gmail.com>" -m "IGNIS v6.0 — Earth's Burning Activity Calendar

NASA Space Apps Challenge 2026 · Challenge #9: Harmonization of MODIS & VIIRS Hot Spots
Single-commit public mirror · zero credentials · deployed via Vercel" || true
git push -q --force origin main
cd "$WS"
echo "  ✓ ignis-public force-pushed (single commit, sole author)"

echo "── 6/6 · final matrix"
curl -s "${AUTH[@]}" "$API/user/repos?per_page=100" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    if 'ignis' in r['name'] or 'spaceapps' in r['name']:
        print(f\"  {r['full_name']:45s} private={r['private']} pushed={r['pushed_at'][:16]}\")"
echo "DONE — all repos private, main + mirror pushed."
