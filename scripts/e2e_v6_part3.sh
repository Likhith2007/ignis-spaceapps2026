#!/bin/bash
# IGNIS v6.0 E2E part 3 — Impact tab, Alerts tab, SIMPLE mode, mobile
cd /home/z/my-project
echo "── close popup, open 🌍 Impact tab"
agent-browser press Escape 2>/dev/null
agent-browser find text "Impact · Air & Carbon" click
sleep 6
agent-browser eval "(() => { const el=document.querySelector('[class*=animate-pulse]'); const t=document.body.textContent; return { carbon: /Mt CO|CO₂e today/.test(t), cars: /passenger-car years/.test(t), aqi: /US AQI/.test(t), smoke: /smoke elevated|smoke low|smoke:/.test(t), loading: !!el } })()"
agent-browser screenshot download/ignis-v6-impact-tab.png

echo "── 🔔 My Fire Alerts tab + add a place"
agent-browser find text "My Fire Alerts" click
sleep 2
agent-browser eval "
(() => {
  const inp = document.querySelector('input[placeholder*=\"Place name\"]');
  if (!inp) return 'no-form';
  const set = (ph, v) => { const el = document.querySelector(`input[placeholder*=\"${ph}\"]`); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); };
  set('Place name', 'Home — Mato Grosso farm');
  set('lat (-90', '-10.9');
  set('lon (-180', '-54.0');
  set('e-mail', 'nurnabid754@gmail.com');
  return 'filled';
})()"
agent-browser find text "Watch this place" click
sleep 3
agent-browser eval "(() => { const t=document.body.textContent; return { saved: /Home — Mato Grosso farm/.test(t), alert: /fire .* km away/.test(t), aoiPrefill: /activity center/.test(t) } })()"
agent-browser screenshot download/ignis-v6-watchlist-alert.png

echo "── ⚙ EXPERT → 🧭 SIMPLE mode"
agent-browser find text "EXPERT" click
sleep 2
agent-browser eval "(() => { const t=document.body.textContent; return { simpleBadge: /🧭 SIMPLE/.test(t), clusterLabGone: !/Fire Cluster Lab/.test(t), impactVisible: /Impact · Air & Carbon/.test(t), railSensorGone: !/HARMONIZATION/.test(t) } })()"
agent-browser screenshot download/ignis-v6-simple-mode.png
echo "── back to EXPERT"
agent-browser find text "SIMPLE" click
sleep 1
agent-browser eval "document.body.textContent.includes('Fire Cluster Lab') ? 'expert-restored' : 'still-simple'"

echo "── mobile viewport 390×844"
agent-browser set viewport 390 844
sleep 2
agent-browser eval "(() => ({ noHScroll: document.documentElement.scrollWidth <= 392, brandVisible: !!document.querySelector('img[src*=\"ignis-mascot\"]') }))()"
agent-browser screenshot download/ignis-v6-mobile.png
echo "── console errors total"
agent-browser errors | head -8
echo "E2E_PART3_DONE"
