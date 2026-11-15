// In-memory audit of the GitHub HEAD tarball: parse every .ts/.tsx in src/
// with @swc/core (the exact parser Vercel cold-builds with). Zero disk writes
// for repo content — everything lives in memory between fetch and parse.
const https = require('node:https');
const { execSync } = require('node:child_process');
const zlib = require('node:zlib');
const tar = require('node:child_process'); // placeholder

function curlBuf(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit' } }, (res) => {
      if (res.statusCode >= 300 && res.headers.location) {
        return resolve(curlBuf(res.headers.location, token));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' })
    .toString().match(/x-access-token:([^@]+)@/)[1];
  const sha = execSync('git rev-parse HEAD', { cwd: '/home/z/my-project' }).toString().trim();
  console.log('HEAD:', sha);

  const tgz = await curlBuf(`https://api.github.com/repos/Hisernberg/ignis-spaceapps2026/tarball/${sha}`, token);
  console.log('tarball bytes:', tgz.length);

  // untar in memory
  const tarBuf = zlib.gunzipSync(tgz);
  const entries = [];
  // minimal ustar parser (headers every 512 bytes)
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const name = tarBuf.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tarBuf.subarray(off + 124, off + 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = tarBuf.subarray(off + 156, off + 157).toString('utf8');
    if ((type === '0' || type === '') && size > 0) {
      entries.push({ name, data: tarBuf.subarray(off + 512, off + 512 + size) });
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  console.log('entries:', entries.length);

  const swc = require('@swc/core');
  const bad = [];
  let good = 0;
  for (const e of entries) {
    if (!/^[^/]+\/src\/.+\.(ts|tsx)$/.test(e.name)) continue;
    const code = e.data.toString('utf8');
    const syntax = e.name.endsWith('.tsx') ? 'typescript' : 'typescript';
    try {
      swc.parseSync(code, { syntax, tsx: e.name.endsWith('.tsx') });
      good++;
    } catch (err) {
      bad.push({ f: e.name, msg: String(err.message).split('\n').slice(0, 3).join(' | ').slice(0, 220) });
    }
  }
  console.log(`swc-parse ok: ${good}, FAILED: ${bad.length}`);
  for (const b of bad) console.log(' ✗', b.f, '\n    ', b.msg);
})();
