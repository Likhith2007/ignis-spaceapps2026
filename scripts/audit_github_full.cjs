// FULL in-memory audit of GitHub HEAD with a CORRECT ustar parser (prefix
// field at 345). swc-parse every .ts/.tsx, JSON.parse every .json under src/,
// prisma/, package*.json. Reports the complete corruption manifest.
const https = require('node:https');
const { execSync } = require('node:child_process');
const zlib = require('node:zlib');
const swc = require('@swc/core');

function curlBuf(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit' } }, (res) => {
      if (res.statusCode >= 300 && res.headers.location) return resolve(curlBuf(res.headers.location, token));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseTar(buf) {
  const entries = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    let name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = header.subarray(156, 157).toString('utf8');
    if ((type === '0' || type === '\0' || type === '') && size > 0) entries.push({ name, data: buf.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' }).toString().match(/x-access-token:([^@]+)@/)[1];
  const sha = execSync('git rev-parse HEAD', { cwd: '/home/z/my-project' }).toString().trim();
  const tgz = await curlBuf(`https://codeload.github.com/Hisernberg/ignis-spaceapps2026/legacy.tar.gz/${sha}`, token);
  const entries = parseTar(zlib.gunzipSync(tgz));
  console.log('entries parsed:', entries.length);

  const bad = [];
  let ok = 0;
  for (const e of entries) {
    const rel = e.name.replace(/^[^/]+\//, '');
    const code = e.data.toString('utf8');
    if (/^src\/.+\.(ts|tsx)$/.test(rel)) {
      try { swc.parseSync(code, { syntax: 'typescript', tsx: rel.endsWith('.tsx') }); ok++; }
      catch (err) { bad.push({ f: rel, kind: 'swc', msg: String(err.message).split('\n')[0].slice(0, 140) }); }
    } else if (/^(src|prisma)\/.+\.json$|^package(-lock)?\.json$|^tsconfig\.json$|^components\.json$/.test(rel)) {
      try { JSON.parse(code); ok++; }
      catch (err) { bad.push({ f: rel, kind: 'json', msg: String(err.message).split('\n')[0].slice(0, 140) }); }
    }
  }
  console.log(`checked OK: ${ok} · FAILED: ${bad.length}`);
  for (const b of bad) console.log(' ✗', b.f, `[${b.kind}]`, b.msg);
})();
