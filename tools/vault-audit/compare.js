// Compare the original vault with the repaired mirror: defect categories, lost words, fence counts.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root) { console.error('usage: node compare.js <vault folder>  (after node dryrun.js)'); process.exit(1); }
const mirror = path.join(__dirname, 'mirror');
const SKIP = new Set(['.obsidian', 'node_modules', 'backups', 'Excalidraw', '.git', '.trash']);
function walk(d, o = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name.startsWith('.') || SKIP.has(f.name)) continue; const q = path.join(d, f.name); f.isDirectory() ? walk(q, o) : /\.md$/.test(f.name) && o.push(q); } return o; }
const words = (t) => {
  const m = new Map();
  for (const w of (t.match(/[A-Za-z0-9\u0D80-\u0DFF]{3,}/g) || [])) m.set(w, (m.get(w) || 0) + 1);
  return m;
};
const lostNotes = [];
const fenceDiff = [];
for (const f of walk(root)) {
  const rel = path.relative(root, f);
  const a = fs.readFileSync(f, 'utf8');
  if (!fs.existsSync(path.join(mirror, rel))) continue;
  const b = fs.readFileSync(path.join(mirror, rel), 'utf8');
  if (a === b) continue;
  const wa = words(a), wb = words(b);
  const lost = [];
  for (const [w, n] of wa) { const nb = wb.get(w) || 0; if (nb < n) lost.push(w + (n - nb > 1 ? 'x' + (n - nb) : '')); }
  const ignore = new Set(['date', 'YYYY', 'cite', 'cite_start']);
  const real = lost.filter(w => !ignore.has(w.replace(/x\d+$/, '')));
  if (real.length) lostNotes.push([rel, real.length, real.slice(0, 12).join(' ')]);
  const fa = (a.match(/^[ \t>]*```/gm) || []).length, fb = (b.match(/^[ \t>]*```/gm) || []).length;
  if (fa !== fb) fenceDiff.push([rel, fa, fb]);
}
console.log('notes with words lost after repair:', lostNotes.length);
for (const x of lostNotes.slice(0, 25)) console.log('  ', x[0].split('\\').pop(), '|', x[1], '|', x[2]);
console.log('notes whose fence count changed:', fenceDiff.length);
for (const x of fenceDiff) console.log('  ', x[0].split('\\').pop(), x[1], '->', x[2]);
