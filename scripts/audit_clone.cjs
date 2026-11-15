// swc-parse every .ts/.tsx + JSON.parse every .json in the fresh clone
const fs = require('node:fs');
const path = require('node:path');
const swc = require('/home/z/my-project/node_modules/@swc/core');

const ROOT = process.argv[2] || '/tmp/clone_oracle';
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.next') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push(p);
  }
})(ROOT);

let ok = 0;
const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const code = fs.readFileSync(f, 'utf8');
  try {
    if (/\.(ts|tsx)$/.test(rel)) swc.parseSync(code, { syntax: 'typescript', tsx: rel.endsWith('.tsx') });
    else if (/\.json$/.test(rel)) JSON.parse(code);
    else continue;
    ok++;
  } catch (e) {
    bad.push({ f: rel, msg: String(e.message).split('\n')[0].slice(0, 150) });
  }
}
console.log(`clone audit — ok: ${ok}, FAILED: ${bad.length}`);
for (const b of bad) console.log(' ✗', b.f, '→', b.msg);
