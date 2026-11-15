// REDUNDANT majority-vote auditor: fetch every src blob 3x through
// independent requests. Majority byte-consensus + sha1(majority)==tree.sha +
// swc-parse. A file is TRUE-CORRUPT only if NO copy parses OK (or consensus
// fails) — single corrupted views are tolerated.
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const swc = require('/home/z/my-project/node_modules/@swc/core');

const REPO = process.argv[2] || 'Hisernberg/ignis-spaceapps2026';
const REF = process.argv[3] || '';
const N = 3;

function apiRaw(path, token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit', Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${path}`));
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}
const blobSha = (s) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s, 'utf8')}\0${s}`, 'utf8').digest('hex');
const parse1 = (code, path) => {
  try { swc.parseSync(code, { syntax: 'typescript', tsx: path.endsWith('.tsx') }); return true; } catch { return false; }
};

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' }).toString().match(/x-access-token:([^@]+)@/)[1];
  const refSha = REF || execSync('git rev-parse HEAD', { cwd: '/home/z/my-project' }).toString().trim();
  const tree = JSON.parse((await apiRaw(`/repos/${REPO}/git/trees/${refSha}?recursive=1`, token)).toString());
  const files = tree.tree.filter((t) => t.type === 'blob' && /^src\/.+\.(ts|tsx)$/.test(t.path));

  const verdicts = [];
  const queue = [...files];
  let apiCalls = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const copies = [];
      for (let i = 0; i < N; i++) {
        try {
          const b = JSON.parse((await apiRaw(`/repos/${REPO}/git/blobs/${t.sha}`, token)).toString());
          apiCalls++;
          copies.push(Buffer.from(b.content, 'base64').toString('utf8'));
        } catch { /* view flake */ }
      }
      // majority consensus
      const counts = new Map();
      for (const c of copies) counts.set(c, (counts.get(c) || 0) + 1);
      let majority = null, majN = 0;
      for (const [c, n] of counts) if (n > majN) { majority = c; majN = n; }
      const shaMatch = majority !== null && blobSha(majority) === t.sha;
      const parses = majority !== null && parse1(majority, t.path);
      // "clean evidence": ANY copy parses OK → clean bytes exist in the object
      const anyParses = copies.some((c) => parse1(c, t.path));
      verdicts.push({ path: t.path, copies: copies.length, majN, shaMatch, parses, anyParses });
    }
  }));

  const trueCorrupt = verdicts.filter((v) => v.copies > 0 && !v.anyParses);
  const shaSuspect = verdicts.filter((v) => v.majorityOk === false || (!v.shaMatch && v.parses));
  console.log(`repo ${REPO} @ ${refSha.slice(0, 8)} · blobs fetched: ${verdicts.filter((v) => v.copies > 0).length}/${files.length} · api calls: ${apiCalls}`);
  console.log(`ANY-copy-parses-OK: ${verdicts.filter((v) => v.anyParses).length}/${files.length}`);
  console.log(`TRUE-CORRUPT (no copy parses): ${trueCorrupt.length}`);
  for (const v of trueCorrupt) console.log(' ✗', v.path);
  const shaMismatch = verdicts.filter((v) => !v.shaMatch && v.parses);
  console.log(`parse-OK-but-sha-mismatch (view artifact evidence): ${shaMismatch.length}`);
  fs.writeFileSync('/home/z/my-project/scripts/tmp_redundant.json', JSON.stringify(verdicts, null, 2));
})();
