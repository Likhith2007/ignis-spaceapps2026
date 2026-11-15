#!/bin/bash
# IGNIS v5.9 E2E — per-hotspot AI interactivity + 3D analysis, BOTH renderers.
# Bundled into ONE script because the sandbox reaps background processes
# between Bash calls (server + browser must live within a single invocation).
set -u
cd /home/z/my-project
PORT=3100
BASE="http://localhost:$PORT"
LOG=/tmp/ignis-prod-v59.log
AB="agent-browser --session v59"
DL=/home/z/my-project/download
mkdir -p "$DL"

# ---------- 1) prod server ----------
(npx next start -p $PORT > "$LOG" 2>&1 &)
for i in $(seq 1 45); do
  sleep 1
  curl -s -o /dev/null "$BASE" && break
done
curl -s -o /dev/null "$BASE" && echo "SERVER_UP" || { echo "SERVER_DOWN"; tail -20 "$LOG"; exit 1; }

# ---------- 2) /api/hotspot direct AI tests ----------
echo "--- API test 1: intense detection (287 MW) ---"
curl -s -X POST "$BASE/api/hotspot" -H 'Content-Type: application/json' \
  -d '{"hotspot":{"kind":"detection","lat":-8.9,"lon":-56.2,"frp":287.4,"conf":96,"sensor":"VIIRS-SNPP","sat":"S-NPP","acq":"2026-09-22 07:42","night":false,"day":"2026-09-22","regionKey":"amazon"}}' \
  | head -c 600
echo
echo "--- API test 2: aggregated night cell (38 det) ---"
curl -s -X POST "$BASE/api/hotspot" -H 'Content-Type: application/json' \
  -d '{"hotspot":{"kind":"cell","lat":-9.1,"lon":-56.0,"frp":142.0,"conf":71,"sensor":"multi-sensor","night":true,"day":"2026-09-22","regionKey":"amazon","cell":{"n":38,"frpSum":1596,"meanConf":74,"nightPct":55,"maxFrp":142}}}' \
  | head -c 600
echo

# ---------- 3) GL renderer path (WebGL2 via SwiftShader) ----------
$AB set viewport 1600 1000 >/dev/null
$AB open "$BASE/" >/dev/null
sleep 10
echo "--- GL: map + handles ---"
$AB eval "window.__ignisMap ? 'GL_MAP_OK' : 'NO_GL_MAP'"

echo "--- GL: open hottest fire popup ---"
for i in $(seq 1 60); do
  POS=$($AB eval "(() => { const m = window.__ignisMap; if (!m) return 'NO_MAP'; const el = m.getContainer(); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); for (let x = 60; x < r.width - 60; x += 44) { for (let y = 60; y < r.height - 60; y += 44) { const fs = m.queryRenderedFeatures([x, y], { layers: ['fires-core'] }); if (fs && fs.length) { fs.sort((a,b)=>(b.properties.frp||0)-(a.properties.frp||0)); const pt = m.project(fs[0].geometry.coordinates); return JSON.stringify({x: Math.round(r.left+pt.x), y: Math.round(r.top+pt.y), frp: Math.round(fs[0].properties.frp||0)}); } } } return 'NO_FEATS'; })()")
  echo "$POS" | grep -q '"x' && break
  sleep 3
done
echo "HOT_POS: $POS"
if echo "$POS" | grep -q '"x'; then
  VX=$(echo "$POS" | tr -d '\\' | sed -E 's/.*"x": ?([0-9]+).*/\1/')
  VY=$(echo "$POS" | tr -d '\\' | sed -E 's/.*"y": ?([0-9]+).*/\1/')
  $AB mouse move "$VX" "$VY" >/dev/null
  $AB mouse down left >/dev/null; $AB mouse up left >/dev/null
  sleep 1.5
  $AB eval "document.querySelector('.maplibregl-popup .ignis-hotspot-ai') ? 'POPUP_BTN_OK' : 'NO_POPUP_BTN'"
  $AB eval "document.querySelector('.maplibregl-popup .ignis-hotspot-ai')?.click(); 'CLICKED'"
  for i in $(seq 1 60); do
    R=$($AB eval "(document.querySelector('.maplibregl-popup .ignis-ai-slot')?.innerHTML || '').match(/EXTREME|HIGH|MODERATE|LOW/) ? 'VERDICT_OK' : 'WAIT'")
    [ "$R" = "VERDICT_OK" ] && break
    sleep 1
  done
  echo "GL_POPUP_AI: $R"
  $AB eval "(document.querySelector('.maplibregl-popup .ignis-ai-slot')?.textContent || '').slice(0, 220)"
  $AB screenshot "$DL/ignis-v59-gl-ai-popup.png" >/dev/null
  $AB eval "document.querySelector('.maplibregl-popup-close-button')?.click(); 'closed'"
fi

echo "--- GL: 3D terrain toggle ---"
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('3D terrain'))?.click(); 'TOGGLED'"
sleep 4
$AB eval "window.__ignisMap ? ('PITCH=' + Math.round(window.__ignisMap.getPitch())) : 'NO_MAP'"

echo "--- GL: 3D fire field + tower AI ---"
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('3D field'))?.click(); 'TOGGLED'"
sleep 3
$AB eval "window.__ignis3D ? 'FIELD_OK (' + window.__ignis3D.hits.length + ' towers)' : 'NO_FIELD'"
TPOS=$($AB eval "(() => { const F = window.__ignis3D; if (!F || !F.hits.length) return 'NO_TOWER'; const h = F.hits[Math.floor(F.hits.length/2)]; const r = F.el.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.left+h.x), y: Math.round(r.top+h.y)}); })()")
echo "TOWER_POS: $TPOS"
if echo "$TPOS" | grep -q '"x'; then
  TX=$(echo "$TPOS" | tr -d '\\' | sed -E 's/.*"x": ?([0-9]+).*/\1/')
  TY=$(echo "$TPOS" | tr -d '\\' | sed -E 's/.*"y": ?([0-9]+).*/\1/')
  $AB mouse move "$TX" "$TY" >/dev/null
  $AB mouse down left >/dev/null; $AB mouse up left >/dev/null
  for i in $(seq 1 60); do
    R=$($AB eval "(document.querySelector('.ignis-ai-slot')?.innerHTML || '').match(/EXTREME|HIGH|MODERATE|LOW/) ? 'VERDICT_OK' : 'WAIT'")
    [ "$R" = "VERDICT_OK" ] && break
    sleep 1
  done
  echo "TOWER_AI: $R"
  $AB screenshot "$DL/ignis-v59-3d-field-ai.png" >/dev/null
fi
$AB screenshot "$DL/ignis-v59-gl-3d-terrain.png" >/dev/null

# ---------- 4) Leaflet GPU-free path (?nogpu=1) ----------
$AB open "$BASE/?nogpu=1" >/dev/null
sleep 10
echo "--- LEAFLET: container + handles ---"
$AB eval "document.querySelector('.leaflet-container') ? 'LEAFLET_OK' : 'NO_LEAFLET'"
$AB eval "document.body.textContent.includes('GPU blocked') ? 'GPU_PILL_OK' : 'NO_PILL'"
$AB eval "window.__ignisLeaflet ? 'LEAFLET_MAP_HANDLE_OK' : 'NO_HANDLE'"
$AB eval "document.body.textContent.includes('high-threat hotspot') || document.body.textContent.includes('EXTREME') ? 'THREAT_HUD_OK' : 'NO_THREAT_HUD'"

echo "--- LEAFLET: open hottest fire popup ---"
LPOS=$($AB eval "(() => { const m = window.__ignisLeaflet; if (!m) return 'NO_MAP'; const c = m.getContainer(); c.scrollIntoView({block:'center'}); let found = null; m.eachLayer((l) => { if (found || !l.eachLayer) return; l.eachLayer((cc) => { if (!found && cc._pt && cc._pt.frp > 20) found = cc; }); }); if (!found) return 'NO_PT'; const ll = found.getLatLng(); const pt = m.latLngToContainerPoint(ll); const r = c.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.left+pt.x), y: Math.round(r.top+pt.y), frp: Math.round(found._pt.frp)}); })()")
echo "LEAFLET_POS: $LPOS"
if echo "$LPOS" | grep -q '"x'; then
  LX=$(echo "$LPOS" | tr -d '\\' | sed -E 's/.*"x": ?([0-9]+).*/\1/')
  LY=$(echo "$LPOS" | tr -d '\\' | sed -E 's/.*"y": ?([0-9]+).*/\1/')
  $AB mouse move "$LX" "$LY" >/dev/null
  $AB mouse down left >/dev/null; $AB mouse up left >/dev/null
  sleep 1.5
  $AB eval "document.querySelector('.leaflet-popup .ignis-hotspot-ai') ? 'LEAFLET_POPUP_BTN_OK' : 'NO_BTN'"
  $AB eval "document.querySelector('.leaflet-popup .ignis-hotspot-ai')?.click(); 'CLICKED'"
  for i in $(seq 1 60); do
    R=$($AB eval "(document.querySelector('.leaflet-popup .ignis-ai-slot')?.innerHTML || '').match(/EXTREME|HIGH|MODERATE|LOW/) ? 'VERDICT_OK' : 'WAIT'")
    [ "$R" = "VERDICT_OK" ] && break
    sleep 1
  done
  echo "LEAFLET_POPUP_AI: $R"
  $AB eval "(document.querySelector('.leaflet-popup .ignis-ai-slot')?.textContent || '').slice(0, 220)"
  $AB screenshot "$DL/ignis-v59-leaflet-ai-popup.png" >/dev/null
  $AB eval "document.querySelector('.leaflet-popup-close-button')?.click(); 'closed'"
fi

echo "--- LEAFLET: 3D field (the user's Brave environment) ---"
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('3D field'))?.click(); 'TOGGLED'"
sleep 3
$AB eval "window.__ignis3D ? 'FIELD_OK (' + window.__ignis3D.hits.length + ' towers)' : 'NO_FIELD'"
$AB screenshot "$DL/ignis-v59-leaflet-3d-field.png" >/dev/null

# ---------- 5) error sweep ----------
echo "--- PAGE ERRORS ---"
$AB errors | tail -5
echo "--- CONSOLE (errors only) ---"
$AB console | grep -iE "error" | grep -v "404\|tile\|AJAX\|fingerprint\|net::" | tail -6
$AB close >/dev/null 2>&1
echo "E2E_DONE"
