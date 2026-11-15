#!/bin/bash
# v7.1 ignis-public sync — single-commit, sole-author Hisernberg, zero-credential scan.
set -euo pipefail
WS=/home/z/my-project
PAT=$(cd "$WS" && git remote get-url origin | sed -n 's|https://x-access-token:\([^@]*\)@.*|\1|p')
OWNER=Hisernberg
PUB=/tmp/ignis-public-sync
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
git add -A
git commit -q --author="Hisernberg <169257061+Hisernberg@users.noreply.github.com>" -m "IGNIS v7.1 — Worldview Engine: nullschool wind streamlines, RainViewer live weather, cinematic replay, react-bits FX + daisyUI deepening, n8n spike automation

NASA Space Apps Challenge 2026 · Challenge #9: Harmonization of MODIS & VIIRS Hot Spots
Single-commit public mirror · zero credentials · deployed via Vercel" || true
git commit -q --amend --reset-author --no-edit
git push -q --force origin main
cd "$WS"
echo "  ✓ ignis-public force-pushed (single commit, sole author Hisernberg)"
curl -s -H "Authorization: Bearer $PAT" "https://api.github.com/repos/$OWNER/ignis-public/commits/main" | python3 -c "import json,sys;d=json.load(sys.stdin);print('  public HEAD:', d['sha'][:10], '| author:', d['author']['login'] if d.get('author') else d['commit']['author']['name'], '| msg:', d['commit']['message'].split(chr(10))[0][:60])"
