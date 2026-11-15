// SHA-ANCHORED full audit: for every src/**.ts(x) blob in HEAD's tree, fetch
// the blob, VERIFY sha1(received) == tree.sha (kills stale-view artifacts),
// then swc-parse. Any parse failure on a hash-verified blob = true corruption.
// Repairs listed to scripts/tmp_repair.json.
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const swc = require('/home/z/my-project/node_modules/@swc/core');

const REPO = process.argv[2] || 'Hisernberg/ignis-spaceapps2026';
const REF = process.argv[3]; // optional sha

function api(path, token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit', Accept: 'application/vnd.github+json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${path}`));
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}
const blobSha = (s) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s, 'utf8')}\0${s}`, 'utf8').digest('hex');

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' }).toString().match(/x-access-token:([^@]+)@/)[1];
  const refSha = REF || execSync('git rev-parse HEAD', { cwd: '/home/z/my-project' }).toString().trim();
  const tree = await api(`/repos/${REPO}/git/trees/${refSha}?recursive=1`, token);
  const files = tree.tree.filter((t) => t.type === 'blob' && /^src\/.+\.(ts|tsx)$/.test(t.path));
  console.log(`repo ${REPO} @ ${refSha.slice(0, 10)} — src files: ${files.length}`);

  const bad = [];
  let ok = 0, verified = 0;
  const queue = [...files];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try {
        const blob = await api(`/repos/${REPO}/git/blobs/${t.sha}`, token);
        const content = Buffer.from(blob.content, 'base64').toString('utf8');
        const hashOk = blobSha(content) === t.sha;
        if (hashOk) verified++;
        let p = 'ok';
        try { swc.parseSync(content, { syntax: 'typescript', tsx: t.path.endsWith('.tsx') }); } catch (e) { p = String(e.message).split('\n')[0].slice(0, 130); }
        if (p !== 'ok') bad.push({ path: t.path, sha: t.sha, hashOk, parse: p });
        else ok++;
      } catch (e) {
        bad.push({ path: t.path, sha: t.sha, hashOk: null, parse: `FETCH_FAIL ${String(e.message).slice(0, 80)}` });
      }
    }
  }));
  console.log(`parse ok: ${ok} · sha-verified: ${verified}/${files.length} · CORRUPT: ${bad.length}`);
  for (const b of bad) console.log(' ✗', b.path, `shaVerified=${b.hashOk}`, '→', b.parse);
  fs.writeFileSync('/home/z/my-project/scripts/tmp_repair.json', JSON.stringify({ repo: REPO, ref: refSha, bad }, null, 2));
})();
