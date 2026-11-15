#!/bin/bash
# IGNIS v6.0 E2E part 2c — popup via direct layer fire + real canvas MouseEvent
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
  window.__t = target;
  window.__pt = target._pt;
  return 'stored frp=' + target._pt.frp + ' type=' + target._pt.type + ' spread=' + target._pt.spreadKm;
})()"

echo "── approach A: dispatch MouseEvent on the canvas at the dot position"
agent-browser eval "
(() => {
  const c = document.querySelector('.leaflet-overlay-pane canvas');
  if (!c) return 'no-canvas';
  const ev = new MouseEvent('click', { clientX: window.__ix, clientY: window.__iy, bubbles: true, cancelable: true, view: window });
  c.dispatchEvent(ev);
  return 'dispatched';
})()"
sleep 2
agent-browser eval "(() => { const p=document.querySelector('.leaflet-popup-content'); return p? 'POPUP-A: '+p.textContent.slice(0,200).replace(/\s+/g,' ') : 'no-popup' })()"

echo "── approach B: Leaflet layer fire (fallback)"
agent-browser eval "(() => { if (window.__t) { window.__t.fire('click', { latlng: window.__t.getLatLng() }); return 'fired'; } return 'no-target'; })()"
sleep 2
agent-browser eval "(() => { const p=document.querySelector('.leaflet-popup-content'); return p? 'POPUP-B: '+p.textContent.slice(0,520).replace(/\s+/g,' ') : 'no-popup' })()"

echo "── AI verdict (auto-run stream)…"
sleep 14
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-ai-slot'); return s? 'VERDICT: '+s.textContent.slice(0,320).replace(/\s+/g,' ') : 'no-slot' })()"
echo "── AQ row"
agent-browser eval "(() => { const s=document.querySelector('.leaflet-popup-content .ignis-aq-slot'); return s? 'AQ: '+s.textContent.slice(0,240).replace(/\s+/g,' ') : 'no-aq' })()"
agent-browser screenshot download/ignis-v6-popup-ai-card.png
echo "E2E_PART2C_DONE"
