#!/usr/bin/env python3
"""set_ignis_ci_secrets.py — set encrypted Actions secrets on ignis-spaceapps2026.
Values are read from secrets/.env (vault) or environment — never hard-coded."""
import base64, json, os, pathlib, sys, urllib.request
from nacl import encoding, public

GH = "https://api.github.com"
TOKEN = os.environ.get("GH_PAT", "")
OWNER, REPO = "Hisernberg", "ignis-spaceapps2026"

# pull values from secrets/.env (untracked vault file)
env = {}
secrets_file = pathlib.Path("/home/z/my-project/secrets/.env")
for line in secrets_file.read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.split("#")[0].strip()

VALUES = {
    "FIRMS_MAP_KEY": os.environ.get("FIRMS_MAP_KEY", env.get("FIRMS_MAP_KEY", "")),
    "NASA_API_KEY": os.environ.get("NASA_API_KEY", env.get("NASA_API_KEY", "")),
    "HF_TOKEN": os.environ.get("HF_TOKEN", env.get("HF_TOKEN", "")),
}
VALUES = {k: v for k, v in VALUES.items() if v}
assert TOKEN, "set GH_PAT env var"


def req(url, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=30) as resp:
        body = resp.read().decode()
        return resp.status, (json.loads(body) if body.strip() else {})


status, pk = req(f"{GH}/repos/{OWNER}/{REPO}/actions/secrets/public-key")
pk_obj = public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
sealed = public.SealedBox(pk_obj)

for name, raw in VALUES.items():
    enc = sealed.encrypt(raw.encode())
    req(f"{GH}/repos/{OWNER}/{REPO}/actions/secrets/{name}", "PUT",
        {"encrypted_value": base64.b64encode(enc).decode(), "key_id": pk["key_id"]})
    print(f"✓ {name} set ({len(raw)} chars)")
print("done")
