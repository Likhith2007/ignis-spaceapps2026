// Calibrate burn-scar thresholds on a data-rich 7-2-1 tile (Mato Grosso, Amazon arc)
const day = process.argv[2] || '2026-09-17';
const z = 7, y = 67, x = 44;
const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_Bands721/default/${day}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
const sharp = (await import('sharp')).default;
const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let nodata = 0, red = 0, green = 0, blue = 0, cloud = 0, smoke = 0, other = 0, n = 0;
const redSamples = [];
const hist = new Array(10).fill(0); // redness index buckets 0..9 → i*15
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  n++;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 30) { nodata++; continue; }
  const redness = r - ((g + b) >> 1);
  hist[Math.min(9, Math.floor(Math.max(0, redness) / 15))]++;
  if (mn > 190) { cloud++; continue; }
  if (r > 170 && b > 115 && g < 150 && r - g > 55) { red++; continue; } // active fire (magenta)
  if (b > r + 12 && b > g) { blue++; continue; }
  if (g > r + 8 && g > b - 4 && g > 55) { green++; continue; }
  if (mx > 115 && mx - mn < 26) { smoke++; continue; }
  other++;
  if (redSamples.length < 20) redSamples.push([r, g, b, redness]);
}
console.log(`day ${day} tile ${z}/${y}/${x} — n=${n}`);
console.log(`nodata ${(nodata/n*100).toFixed(1)}%  cloud ${(cloud/n*100).toFixed(1)}%  activefire ${(red/n*100).toFixed(2)}%  water ${(blue/n*100).toFixed(1)}%  veg ${(green/n*100).toFixed(1)}%  smoke ${(smoke/n*100).toFixed(1)}%  other ${(other/n*100).toFixed(1)}%`);
console.log('redness hist (0-15,15-30,...):', hist.join(', '));
console.log('other samples (r,g,b,redness):', JSON.stringify(redSamples.slice(0, 12)));
