#!/usr/bin/env python3
"""Overlay-fs healer: force the corrected content for TopBrief.tsx and verify
it persists across repeated reads (the kata overlay flips views per read)."""
import time

P = 'src/components/ignis/TopBrief.tsx'
BAD_A = 'useMemo(() => earlyAlert(hotspots), otspots]);'
BAD_B = '}, otspots, day, regionName, loading]);'
FIX_A = 'useMemo(() => earlyAlert(hotspots), [hotspots]);'
FIX_B = '}, [hotspots, day, regionName, loading]);'

for attempt in range(12):
    src = open(P, encoding='utf-8').read()
    if BAD_A not in src and BAD_B not in src:
        if FIX_A in src and FIX_B in src:
            print(f'attempt {attempt}: view already correct — verifying stability...')
            stable = all(FIX_A in open(P, encoding='utf-8').read() for _ in range(3))
            print('stable:', stable)
            break
        print(f'attempt {attempt}: unexpected content — no bad markers, no fix markers')
        break
    fixed = src.replace(BAD_A, FIX_A).replace(BAD_B, FIX_B)
    with open(P, 'w', encoding='utf-8') as f:
        f.write(fixed)
    time.sleep(0.2)
else:
    print('FAILED to converge after 12 attempts')
    raise SystemExit(1)

# final verification: 5 consecutive reads must all be correct
reads = [open(P, encoding='utf-8').read() for _ in range(5)]
ok = all(('otspots]' not in r) and (FIX_A in r) and (FIX_B in r) for r in reads)
print('final verification:', 'OK — all reads correct' if ok else 'STILL FLIPPING')
raise SystemExit(0 if ok else 1)
