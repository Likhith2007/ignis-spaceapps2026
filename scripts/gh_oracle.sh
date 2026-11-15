#!/bin/bash
# GitHub oracle: download the HEAD tarball, extract, then diff every src file
# against the local working view. Lists files whose local bytes differ from
# what production actually builds from.
set -euo pipefail
cd /home/z/my-project
TOKEN=$(git remote get-url origin | sed -n 's|https://x-access-token:\([^@]*\)@.*|\1|p')
if [ -z "${TOKEN}" ]; then echo "no token in remote"; exit 1; fi
SHA=$(git rev-parse HEAD)
echo "HEAD: $SHA"
rm -rf /tmp/gh_oracle && mkdir -p /tmp/gh_oracle
curl -sL -H "Authorization: Bearer ${TOKEN}" \
  "https://api.github.com/repos/Hisernberg/ignis-spaceapps2026/tarball/${SHA}" \
  -o /tmp/gh_oracle/repo.tgz
mkdir -p /tmp/gh_oracle/x && tar -xzf /tmp/gh_oracle/repo.tgz -C /tmp/gh_oracle/x
REPO_DIR=$(echo /tmp/gh_oracle/x/*/)
echo "extracted: $REPO_DIR"
diffs=0
for f in $(cd src && find . -name '*.ts' -o -name '*.tsx' | sed 's|^\./||'); do
  if ! cmp -s "src/$f" "$REPO_DIR/src/$f" 2>/dev/null; then
    echo "DIFF: src/$f"
    diffs=$((diffs+1))
  fi
done
echo "--- $diffs differing files (src/)"
# also check the oracle's TopBrief lines
sed -n '45p;57p' "$REPO_DIR/src/components/ignis/TopBrief.tsx"
