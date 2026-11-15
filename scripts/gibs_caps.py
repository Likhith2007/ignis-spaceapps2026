#!/usr/bin/env python3
"""Parse GIBS WMTS capabilities for the layers IGNIS uses."""
import re, sys

LAYERS = [
    'MODIS_Terra_Thermal_Anomalies_All', 'MODIS_Aqua_Thermal_Anomalies_All',
    'VIIRS_SNPP_Thermal_Anomalies_375m_All', 'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
    'VIIRS_NOAA21_Thermal_Anomalies_375m_All',
    'MODIS_Terra_Land_Surface_Temp_Day', 'MODIS_Terra_Land_Surface_Temp_Night',
    'MODIS_Terra_CorrectedReflectance_Bands721', 'MODIS_Terra_CorrectedReflectance_TrueColor',
    'VIIRS_SNPP_CorrectedReflectance_TrueColor',
]

def blocks(xml):
    # WMTS layer blocks: start at '<Layer>' and end at '</Layer>' (non-nested in GIBS caps)
    out = []
    for m in re.finditer(r'<Layer>(.*?)</Layer>', xml, re.S):
        out.append(m.group(1))
    return out

for f in sys.argv[1:]:
    xml = open(f, encoding='utf-8').read()
    print('===', f, f'{len(xml)//1000} KB', f'{len(blocks(xml))} layer blocks')
    seen = {}
    for blk in blocks(xml):
        ident = re.search(r'<ows:Identifier>([^<]+)</ows:Identifier>', blk)
        if not ident or ident.group(1) not in LAYERS:
            continue
        name = ident.group(1)
        fmt = re.findall(r'<Format>([^<]+)</Format>', blk)
        tms = re.findall(r'<TileMatrixSet>([^<]+)</TileMatrixSet>', blk)
        # time dimension: <Dimension><ows:Identifier>Time</ows:Identifier>...<Default>..</Default><Value>..</Value>...
        dim = re.search(r'<Dimension>.*?</Dimension>', blk, re.S)
        tval = tdef = None
        if dim:
            d = dim.group(0)
            tdef = re.search(r'<Default>([^<]+)</Default>', d)
            tval = re.findall(r'<Value>([^<]+)</Value>', d)
        seen[name] = (fmt, tms, tdef.group(1) if tdef else None, tval[:2] if tval else None)
    for name in LAYERS:
        if name in seen:
            fmt, tms, tdef, tval = seen[name]
            print(f'  {name}\n    fmt={fmt} tms={tms} default_time={tdef} value_sample={tval}')
        else:
            print(f'  {name}: -- absent --')
