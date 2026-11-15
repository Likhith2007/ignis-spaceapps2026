#!/bin/bash
# IGNIS v6.0 E2E part 2 — data load, fire dot click → full AI card, tabs, modes
cd /home/z/my-project
echo "── waiting for live data (GIBS fallback path ~40s)"
for i in $(seq 1 24); do
  n=$(agent-browser eval "document.querySelector('[data-tour=\\'summary\\']')?.textContent.length || 0" 2>/dev/null)
  txt=$(agent-browser get text "[data-tour='summary']" 2>/dev/null | tr -d '\n' | head -c 220)
  echo "$txt" | grep -q "Syncing live" || break
  sleep 5
done
agent-browser get text "[data-tour='summary']" | head -c 260; echo
agent-browser eval "document.querySelector('.ignis-pulse-wrap') ? 'pulse-halos-live' : 'no-halos'"

echo "── HUD chip (data loaded?)"
agent-browser eval "(() => { const el=[...document.querySelectorAll('button,div')].find(e=>/detections/.test(e.textContent)&&e.textContent.length<120); return el?el.textContent.slice(0,90):'hud-not-found' })()"

echo "── clicking a fire dot via Leaflet canvas (real click at a detection position)"
# use the debug handle to find a detection's screen point and click it
agent-browser eval "
(() => {
  const m = window.__ignisLeaflet; if (!m) return 'no-map';
  const layers = []; 
  m.eachLayer(l => { if (l instanceof L.CircleMarker && l._pt) layers.push(l); });
  if (!layers.length) return 'no-dots';
  const target = layers.sort((a,b)=>b._pt.frp-a._pt.frp)[Math.min(30, layers.length-1)];
  const p = m.latLngToContainerPoint(target.getLatLng());
  const r = m.getContainer().getBoundingClientRect();
  window.__ignisClick = { x: r.left + p.x, y: r.top + p.y, frp: target._pt.frp, type: target._pt.type, spread: target._pt.spreadKm };
  return JSON.stringify(window.__ignisClick);
})()"
CLICK=$(agent-browser eval "JSON.stringify(window.__ignisClick)")
echo "target: $CLICK"
X=$(echo "$CLICK" | python3 -c "import json,sys; print(json.load(sys.stdin)['x'])")
Y=$(echo "$CLICK" | python3 -c "import json,sys; print(json.load(sys.stdin)['y'])")
agent-browser mouse move "$X" "$Y"
agent-browser mouse down left; agent-browser mouse up left
sleep 2
echo "── popup content check"
agent-browser eval "(() => { const p=document.querySelector('.leaflet-popup-content'); return p? p.textContent.slice(0,420).replace(/\s+/g,' ') : 'NO-POPUP' })()"
echo "── AI verdict card streaming (auto-run)…"
sleep 12
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-ai-slot'); return s? s.textContent.slice(0,260).replace(/\s+/g,' ') : 'no-slot' })()"
agent-browser screenshot download/ignis-v6-popup-ai-card.png
echo "── smoke & air row (async AQ)"
sleep 4
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-aq-slot'); return s? s.textContent.slice(0,200).replace(/\s+/g,' ') : 'no-aq' })()"
echo "E2E_PART2_DONE"
