#!/bin/bash
# IGNIS prod server start + smoke test (single call — sandbox reaps backgrounds)
cd /home/z/my-project
pkill -f "standalone/server.js" 2>/dev/null; sleep 1
PORT=3000 NODE_ENV=production nohup bun .next/standalone/server.js > server.log 2>&1 &
SRV=$!
# wait for readiness
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://localhost:3000/api/ping 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "server pid $SRV ready after ${i}s (ping=$code)"

echo "=== /api/air-quality (Open-Meteo CAMS, keyless) ==="
curl -s -m 20 "http://localhost:3000/api/air-quality?lat=-3.5&lon=-62" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d.get('ok'), '| US AQI:', d.get('usAqi'), '| band:', (d.get('band') or {}).get('label'), '| PM2.5:', d.get('pm2_5'), '| smoke:', d.get('smokeSuspicion'))"

echo "=== /api/impact (carbon chain) ==="
curl -s -m 20 "http://localhost:3000/api/impact?frp=12500&region=amazon&day=2026-10-27&detections=600" | python3 -c "import json,sys; d=json.load(sys.stdin); print('CO2e Mt:', d.get('co2eMt'), '| DM kt:', d.get('dryMatterKt'), '| FRE TJ:', d.get('freTj'), '| cars-yr:', d['equivalents']['carsYears'], '| share:', d['context']['shareOfMeanYear'], '%')"

echo "=== /api/hotspots (enriched with type+spread?) ==="
curl -s -m 60 "http://localhost:3000/api/hotspots?w=-70&s=-15&e=-45&n=5&day=2026-10-26&days=1" > /tmp/hs.json
python3 - <<'EOF'
import json
d = json.load(open('/tmp/hs.json'))
day0 = list(d['days'].keys())[0] if 'days' in d else None
pts = [p for s in (d['days'][day0]['sensors'] if day0 else d.get('sensors', {})).values() for p in s.get('points', [])]
typed = [p for p in pts if p.get('type')]
spread = [p for p in pts if p.get('spreadKm') is not None]
from collections import Counter
print('detections:', len(pts), '| with type:', len(typed), '| with spread:', len(spread))
print('type mix:', dict(Counter(p['type'] for p in typed)))
if typed: print('sample:', {k: typed[0][k] for k in ('frp','conf','night','type','typeP','spreadKm','dens25')})
EOF

echo "=== /api/hotspot POST (full AI card with enrichment) ==="
python3 - <<'EOF'
import json, urllib.request, datetime
hs = json.load(open('/tmp/hs.json'))
pts = [p for s in hs.get('sensors', {}).values() for p in s.get('points', [])]
big = max(pts, key=lambda p: p.get('frp', 0)) if pts else None
if big:
    payload = {"hotspot": {"kind": "detection", "lat": big['lat'], "lon": big['lon'], "frp": big['frp'], "conf": big.get('conf') or 60, "sensor": "VIIRS-SNPP", "night": big.get('night', False), "day": datetime.date.today().isoformat(), "regionKey": "amazon", "type": big.get('type'), "typeP": big.get('typeP'), "spreadKm": big.get('spreadKm'), "dens25": big.get('dens25'), "weather": {"windMs": 6.2, "rhPct": 38, "tempC": 33}}}
    req = urllib.request.Request('http://localhost:3000/api/hotspot', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    j = json.load(urllib.request.urlopen(req, timeout=90))
    print('verdict:', j.get('verdict'), '| model:', j.get('model'), '| fireType:', j.get('fireType'), '| spreadKm:', j.get('spreadKm'), j.get('spreadBand'), '| CO2e t:', j.get('co2eTons'), '| AQI:', j.get('aqi'), j.get('aqiBand'))
    print('headline:', j.get('headline'))
else:
    print('no detections in window — skipped')
EOF
echo "SMOKE_DONE"