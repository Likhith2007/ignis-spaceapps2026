#!/bin/bash
# IGNIS v6.0 E2E part 2b — click the fire dot properly
cd /home/z/my-project
agent-browser eval "
(() => {
  const m = window.__ignisLeaflet; if (!m) return 'no-map';
  const layers = [];
  m.eachLayer(l => { if (l._pt) layers.push(l); });
  if (!layers.length) return 'no-dots';
  const target = layers.sort((a,b)=>b._pt.frp-a._pt.frp)[Math.min(30, layers.length-1)];
  const p = m.latLngToContainerPoint(target.getLatLng());
  const r = m.getContainer().getBoundingClientRect();
  window.__ix = r.left + p.x; window.__iy = r.top + p.y;
  return 'ok ' + Math.round(window.__ix) + ',' + Math.round(window.__iy) + ' frp=' + target._pt.frp;
})()"
IX=$(agent-browser eval "Math.round(window.__ix)")
IY=$(agent-browser eval "Math.round(window.__iy)")
echo "clicking at $IX,$IY"
agent-browser mouse move "$IX" "$IY"
agent-browser mouse down left; agent-browser mouse up left
sleep 2
echo "── popup content check"
agent-browser eval "(() => { const p=document.querySelector('.leaflet-popup-content'); return p? p.textContent.slice(0,460).replace(/\s+/g,' ') : 'NO-POPUP' })()"
echo "── AI verdict card streaming (auto-run)…"
sleep 14
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-ai-slot'); return s? s.textContent.slice(0,300).replace(/\s+/g,' ') : 'no-slot' })()"
agent-browser screenshot download/ignis-v6-popup-ai-card.png
echo "── smoke & air row (async AQ)"
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-aq-slot'); return s? s.textContent.slice(0,220).replace(/\s+/g,' ') : 'no-aq' })()"
echo "E2E_PART2B_DONE"
