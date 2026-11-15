// CRYPTOGRAPHIC ORACLE: git blob SHA is a SHA-1 content hash. Compute the
// blob SHA for (a) the clean candidate content and (b) the corrupted candidate
// content of TopBrief.tsx, in memory, and compare with the SHA the tree API
// reports. Whichever matches IS what GitHub stores — views cannot lie here.
const https = require('node:https');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

function api(path, token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ignis-audit', Accept: 'application/vnd.github+json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      res.on('error', reject);
    }).on('error', reject);
  });
}
const blobSha = (s) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0${s}`, 'utf8').digest('hex');

(async () => {
  const token = execSync('git remote get-url origin', { cwd: '/home/z/my-project' }).toString().match(/x-access-token:([^@]+)@/)[1];
  const tree = await api('/repos/Hisernberg/ignis-spaceapps2026/git/trees/be13475b8cb9a2866a0d068b03593f2c2832f73d?recursive=1', token);
  const entry = tree.tree.find((t) => t.path === 'src/components/ignis/TopBrief.tsx');
  console.log('tree-API blob sha :', entry.sha);

  const blob = await api(`/repos/Hisernberg/ignis-spaceapps2026/git/blobs/${entry.sha}`, token);
  const ghContent = Buffer.from(blob.content, 'base64').toString('utf8');
  console.log('blob-API self-sha :', blob.sha);
  console.log('sha(ghContent)    :', blobSha(ghContent));
  console.log('ghContent L45 tail:', JSON.stringify(ghContent.split('\n')[44].slice(-26)));
  console.log('ghContent corrupted:', ghContent.includes('otspots]'));

  // corrupted candidate: apply the two byte-losses to the clean content
  const clean = ghContent
    .replace('useMemo(() => earlyAlert(hotspots), otspots]);', 'useMemo(() => earlyAlert(hotspots), [hotspots]);')
    .replace('}, otspots, day, regionName, loading]);', '}, [hotspots, day, regionName, loading]);');
  if (clean === ghContent) {
    // ghContent was already clean → corruption lives only in views
    console.log('\nVERDICT: GitHub blob is CLEAN — corrupted reads are view artifacts');
  } else {
    console.log('\nsha(clean candidate):', blobSha(clean));
    // does the corrupted form of clean hash to the tree sha?
    const corrupt = clean
      .replace('useMemo(() => earlyAlert(hotspots), [hotspots]);', 'useMemo(() => earlyAlert(hotspots), otspots]);')
      .replace('}, [hotspots, day, regionName, loading]);', '}, otspots, day, regionName, loading]);');
    console.log('sha(corrupt candidate):', blobSha(corrupt));
    if (blobSha(clean) === entry.sha) console.log('VERDICT: GitHub stores CLEAN content');
    else if (blobSha(corrupt) === entry.sha) console.log('VERDICT: GitHub stores CORRUPTED content — repair push required');
    else console.log('VERDICT: neither candidate matches — investigate further');
  }
})();
