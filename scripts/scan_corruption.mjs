// Corruption oracle: parse EVERY src ts/tsx with Bun's transpiler on the raw
// bash-visible bytes. Syntax errors = corrupted file (overlay-fs byte loss).
// Bun.transpiler parses the actual bytes we read — no caching layer in between.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/home/z/my-project/src';
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(ROOT);

const t = new Bun.Transpiler({ loader: 'tsx' });
const bad = [];
let ok = 0;
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  try {
    t.transformSync(code);
    ok++;
  } catch (e) {
    bad.push({ f: f.replace(ROOT + '/', ''), msg: String(e.message).split('\n')[0].slice(0, 160) });
  }
}
console.log(`parsed ok: ${ok}/${files.length}`);
// sanity: print what THIS process sees of the known-suspect file
const tb = readFileSync(join(ROOT, 'components/ignis/TopBrief.tsx'), 'utf8').split('\n');
console.log('scan-view TopBrief L45:', JSON.stringify(tb[44]));
if (bad.length) {
  console.log('CORRUPTED FILES:');
  for (const b of bad) console.log(' ✗', b.f, '→', b.msg);
} else {
  console.log('no syntax corruption detected in src/');
}
