#!/bin/bash
# IGNIS v6.0 browser E2E — Leaflet GPU-free path (= user's Brave path)
cd /home/z/my-project
mkdir -p download
# server up?
code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://localhost:3000/api/ping 2>/dev/null)
if [ "$code" != "200" ]; then
  pkill -f "standalone/server.js" 2>/dev/null; sleep 1
  PORT=3000 NODE_ENV=production nohup bun .next/standalone/server.js > server.log 2>&1 &
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://localhost:3000/api/ping 2>/dev/null)
    [ "$code" = "200" ] && break; sleep 1
  done
fi
echo "server ready (ping=$code)"

agent-browser close 2>/dev/null
agent-browser set viewport 1500 900
agent-browser open "http://localhost:3000/?nogpu=1" --timeout 90000
agent-browser wait --load networkidle --timeout 60000 2>/dev/null || agent-browser wait 6000
sleep 4

echo "── page identity"
agent-browser get title
echo "── header brand (mascot + wordmark)"
agent-browser get count "img[src*='ignis-wordmark']"
agent-browser get count "img[src*='ignis-mascot']"
echo "── TopBrief + EARLY ALERT"
agent-browser get text "[data-tour='summary']" | head -c 300; echo
agent-browser snapshot -i -c 2>/dev/null | grep -iE "EARLY ALERT|EXPERT|Tour|Impact|My Fire Alerts" | head -8
echo "── map renderer (Leaflet GPU-free)"
agent-browser eval "!!document.querySelector('.leaflet-container') && (window.__ignisLeaflet ? 'leaflet-interactive' : 'leaflet-static')"
echo "── fire dot count (canvas circles = render OK)"
agent-browser eval "document.querySelectorAll('.leaflet-overlay-pane canvas').length"
echo "── errors so far"
agent-browser errors | head -6

echo "── dismiss tour if it opened (first visit)"
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Skip')); if(b){b.click(); return 'skipped'} return 'no-tour' })()"
sleep 1
agent-browser screenshot download/ignis-v6-leaflet-overview.png
echo "screenshot 1 saved"
