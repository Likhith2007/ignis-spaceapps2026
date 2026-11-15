// Debug: fetch one GIBS 7-2-1 tile over the Amazon arc of deforestation and dump color stats
const TILE = 256;
const day = '2026-09-19';
const z = 7;
// Amazon arc: around (-56, -10) → tile x,y
const lon = -56, lat = -10;
const x = Math.floor(((lon + 180) / 360) * 2 ** z);
const p = (lat * Math.PI) / 180;
const y = Math.floor(((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * 2 ** z);
const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_Bands721/default/${day}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
console.log('tile', z, y, x);
const res = await fetch(url);
console.log('HTTP', res.status);
const buf = Buffer.from(await res.arrayBuffer());
const sharp = (await import('sharp')).default;
const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let stats = { n: 0, rSum: 0, gSum: 0, bSum: 0, redDom: 0, greenDom: 0, blueDom: 0, grayish: 0, bright: 0 };
const samples = [];
for (let i = 0; i < data.length; i += 4 * 97) { // sample every ~97th px
  const r = data[i], g = data[i + 1], b = data[i + 2];
  stats.n++; stats.rSum += r; stats.gSum += g; stats.bSum += b;
  if (r > g && r > b) stats.redDom++;
  if (g > r && g > b) stats.greenDom++;
  if (b > r && b > g) stats.blueDom++;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 25) stats.grayish++;
  if (Math.min(r, g, b) > 190) stats.bright++;
  if (samples.length < 40 && r - g > 15) samples.push([r, g, b]);
}
console.log('mean RGB:', (stats.rSum / stats.n).toFixed(1), (stats.gSum / stats.n).toFixed(1), (stats.bSum / stats.n).toFixed(1));
console.log('redDom %', ((stats.redDom / stats.n) * 100).toFixed(1), 'greenDom %', ((stats.greenDom / stats.n) * 100).toFixed(1), 'blueDom %', ((stats.blueDom / stats.n) * 100).toFixed(1), 'grayish %', ((stats.grayish / stats.n) * 100).toFixed(1), 'bright %', ((stats.bright / stats.n) * 100).toFixed(1));
console.log('sample red-dominant pixels (r,g,b):', JSON.stringify(samples.slice(0, 25)));
