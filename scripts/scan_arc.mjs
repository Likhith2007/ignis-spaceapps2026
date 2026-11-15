// Scan multiple tiles over the Amazon arc for high-redness pixels (burn scars in 7-2-1)
const day = process.argv[2] || '2026-09-17';
const z = 7;
const tiles = [];
for (let y = 65; y <= 68; y++) for (let x = 42; x <= 48; x++) tiles.push([y, x]);
const sharp = (await import('sharp')).default;
for (const [y, x] of tiles) {
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_Bands721/default/${day}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
  try {
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let nodata = 0, n = 0, maxRed = -999, redHi = 0;
    const top = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      n++;
      if (Math.max(r, g, b) < 30) { nodata++; continue; }
      const redness = r - ((g + b) >> 1);
      if (redness > maxRed) maxRed = redness;
      if (redness > 40) {
        redHi++;
        if (top.length < 6) top.push([r, g, b, redness]);
      }
    }
    const lonL = (x / 2 ** z) * 360 - 180, lonR = ((x + 1) / 2 ** z) * 360 - 180;
    const latT = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
    const latB = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / 2 ** z))) * 180) / Math.PI;
    console.log(`tile ${y}/${x} (${latB.toFixed(1)}..${latT.toFixed(1)}N ${lonL.toFixed(1)}..${lonR.toFixed(1)}E): nodata ${(nodata / n * 100).toFixed(0)}% redness>40: ${redHi} (max ${maxRed})`, top.length ? JSON.stringify(top.slice(0, 3)) : '');
  } catch { /* skip */ }
}
