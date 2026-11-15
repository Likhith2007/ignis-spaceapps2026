(() => {
  const m = window.__ignisLeaflet;
  if (!m) return 'no map';
  let n = 0, best = null;
  m.eachLayer(function (l) {
    if (l && l._layers && typeof l.eachLayer === 'function') {
      l.eachLayer(function (c) {
        if (c && c._pt) {
          n++;
          if (!best || c._pt.frp > best._pt.frp) best = c;
        }
      });
    }
  });
  if (!best) return 'circles=' + n;
  const cp = m.latLngToContainerPoint(best.getLatLng());
  const r = m.getContainer().getBoundingClientRect();
  const cx = r.left + cp.x, cy = r.top + cp.y;
  const t = document.elementFromPoint(cx, cy);
  if (!t) return 'no element';
  ['mousedown', 'mouseup', 'click'].forEach(function (ty) {
    t.dispatchEvent(new MouseEvent(ty, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 0 }));
  });
  return 'circles=' + n + ' clicked frp=' + best._pt.frp.toFixed(0);
})()
