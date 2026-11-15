// DEFINITIVE GitHub HEAD audit — per-file git blobs via API, all in memory.
// 1. git trees API (recursive) → all src/**.ts(x) SHAs
// 2. per-file blob API (base64, in-memory decode) → swc parse (tsx-aware)
// 3. ALSO read the LOCAL file N times, keep majority parse-OK view, compare
//    byte-for-byte with GitHub blob → exact corruption manifest
const https = require('node:https');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const swc = require('@swc/core');

function api(path, token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit', Accept: 'application/vnd.github+json' },
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

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = { error: String(e.message) }; }
    }
  }));
  return out;
}

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' }).toString().match(/x-access-token:([^@]+)@/)[1];
  const sha = execSync('git rev-parse HEAD', { cwd: '/home/z/my-project' }).toString().trim();

  const tree = JSON.parse((await api(`/repos/Hisernberg/ignis-spaceapps2026/git/trees/${sha}?recursive=1`, token)).toString());
  const files = tree.tree.filter((t) => /^src\/.+\.(ts|tsx)$/.test(t.path) && t.type === 'blob');
  console.log(`src files on GitHub: ${files.length}`);

  const results = await pool(files, 8, async (t) => {
    const blob = JSON.parse((await api(`/repos/Hisernberg/ignis-spaceapps2026/git/blobs/${t.sha}`, token)).toString());
    const gh = Buffer.from(blob.content, 'base64').toString('utf8');
    let parse = 'ok';
    try { swc.parseSync(gh, { syntax: 'typescript', tsx: t.path.endsWith('.tsx') }); } catch (e) { parse = String(e.message).split('\n')[0].slice(0, 120); }

    // local: N reads, majority + parse-OK view
    const P = `/home/z/my-project/${t.path}`;
    let localOk = null, localSameCount = 0, localParseErr = '';
    for (let r = 0; r < 9; r++) {
      let v;
      try { v = fs.readFileSync(P, 'utf8'); } catch { continue; }
      let p = 'ok';
      try { swc.parseSync(v, { syntax: 'typescript', tsx: t.path.endsWith('.tsx') }); } catch (e) { p = String(e.message).split('\n')[0]; }
      if (p === 'ok') { localOk = v; localParseErr = ''; break; }
      if (!localParseErr) localParseErr = p;
    }
    const same = localOk !== null && localOk === gh;
    return { path: t.path, parse, same, hasLocal: localOk !== null, localParseErr };
  });

  const corrupt = results.filter((r) => r.parse !== 'ok');
  const mismatch = results.filter((r) => r.parse === 'ok' && !r.same);
  console.log(`\n=== GitHub parse FAILURES: ${corrupt.length}`);
  for (const c of corrupt) console.log(' ✗', c.path, '→', c.parse);
  console.log(`\n=== local-vs-GitHub mismatches (both parse OK): ${mismatch.length}`);
  for (const m of mismatch) console.log(' ≠', m.path);
  console.log(`\nlocal view unavailable/broken for: ${results.filter((r) => !r.hasLocal).length}`);
  fs.writeFileSync('/home/z/my-project/scripts/tmp_manifest.json', JSON.stringify({ corrupt, mismatch }, null, 2));
})();
