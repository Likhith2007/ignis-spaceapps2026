#!/bin/bash
# IGNIS v8.2 Science Lab — single-session QA: dev server + agent-browser E2E in ONE call
# (sandbox reaps detached processes between tool calls, so everything runs inside this session)
cd /home/z/my-project
QA=scripts/ignis
mkdir -p "$QA"

echo "== [1] start dev server =="
( bun run dev > /dev/null 2>&1 & )
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 5)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "server probe: $code"
[ "$code" != "200" ] && { echo "FATAL: server did not start"; exit 1; }

echo "== [2] open page =="
agent-browser open "http://localhost:3000/" 2>&1 | head -2
agent-browser wait --load networkidle --timeout 90000 2>&1 | head -1
agent-browser storage local set "ignis:tour-done" "1" 2>&1 | head -1
agent-browser reload 2>&1 | head -1
agent-browser wait --load networkidle --timeout 90000 2>&1 | head -1
agent-browser wait 8000
echo "-- title: $(agent-browser get title 2>&1)"
echo "-- page errors:"
agent-browser errors 2>&1 | head -8

echo "== [3] open Statistics Science Lab tab =="
agent-browser find text "🧮 Statistics Science Lab" click 2>&1 | head -2
agent-browser wait 4000
agent-browser screenshot "$QA/qa_v82_sci_significance.png" 2>&1 | head -1
echo "-- errors after tab open:"
agent-browser errors 2>&1 | head -6

echo "== [4] sub-tab: Memory & persistence =="
agent-browser find text "Memory & persistence" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_sci_memory.png" 2>&1 | head -1

echo "== [5] sub-tab: Hidden cycles =="
agent-browser find text "Hidden cycles" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_sci_cycles.png" 2>&1 | head -1

echo "== [6] sub-tab: Extremes & return periods =="
agent-browser find text "Extremes & return periods" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_sci_extremes.png" 2>&1 | head -1

echo "== [7] sub-tab: Sensor agreement =="
agent-browser find text "Sensor agreement" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_sci_agreement.png" 2>&1 | head -1

echo "== [8] sub-tab: Season phenology =="
agent-browser find text "Season phenology" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_sci_phenology.png" 2>&1 | head -1

echo "== [9] sub-tab: Energy & clustering =="
agent-browser find text "Energy & clustering" click 2>&1 | head -1
agent-browser wait 3000
agent-browser screenshot "$QA/qa_v82_sci_energy.png" 2>&1 | head -1
echo "-- energy tab body sample:"
agent-browser snapshot -s "[class*='rounded-xl']" -c 2>&1 | rg -i "Gini|Moran|detections|loads with" | head -6

echo "== [10] regression: Time-Series Lab (p10-p90 band + anomaly dots) =="
agent-browser find text "📈 Time-Series Lab" click 2>&1 | head -1
agent-browser wait 2500
agent-browser screenshot "$QA/qa_v82_ts_decompose.png" 2>&1 | head -1
agent-browser find text "climatology" click 2>&1 | head -1
agent-browser wait 2000
agent-browser screenshot "$QA/qa_v82_ts_climatology.png" 2>&1 | head -1

echo "== [11] regression: Burning Calendar + Daily Dynamics =="
agent-browser find text "🔥 Burning Calendar" click 2>&1 | head -1
agent-browser wait 2000
agent-browser screenshot "$QA/qa_v82_calendar.png" 2>&1 | head -1

echo "== [12] mobile 390px layout =="
agent-browser set viewport 390 844 2>&1 | head -1
agent-browser wait 2500
overflow=$(agent-browser eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>&1)
echo "-- horizontal overflow px: $overflow"
agent-browser screenshot "$QA/qa_v82_mobile.png" 2>&1 | head -1
agent-browser set viewport 1440 900 2>&1 | head -1

echo "== [13] final error scan =="
agent-browser errors 2>&1 | head -10
agent-browser close 2>&1 | head -1
echo "== QA COMPLETE =="
