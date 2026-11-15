#!/bin/bash
cd /home/z/my-project
( bun run dev > /dev/null 2>&1 & )
for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 5); [ "$code" = "200" ] && break; sleep 2; done
echo "server: $code"
agent-browser open "http://localhost:3000/" 2>&1 | head -1
agent-browser wait --load networkidle --timeout 90000 2>&1 | head -1
agent-browser storage local set "ignis:tour-done" "1" 2>&1 | head -1
agent-browser reload 2>&1 | head -1
agent-browser wait --load networkidle --timeout 90000 2>&1 | head -1
agent-browser wait 9000
echo "== console messages =="
agent-browser console 2>&1 | head -40
echo "== page errors =="
agent-browser errors 2>&1 | head -15
echo "== click science tab, recheck =="
agent-browser find text "🧮 Statistics Science Lab" click 2>&1 | head -1
agent-browser wait 3500
agent-browser console 2>&1 | tail -25
agent-browser close 2>&1 | head -1
echo DONE