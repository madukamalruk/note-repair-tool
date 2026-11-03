// Repair every note in memory, write the result to a mirror folder, and check idempotency (2nd pass must change nothing).
const Module = require('module');
const fs = require('fs');
const path = require('path');
const o = Module._load;
Module._load = function (r, ...a) { return r === 'obsidian' ? { Plugin: class {}, Notice: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {} } : o.call(this, r, ...a); };
const p = new (require('../../main.js'))();
const root = process.argv[2];
if (!root) { console.error('usage: node dryrun.js <vault folder>'); process.exit(1); }
const out = path.join(__dirname, 'mirror');
fs.rmSync(out, { recursive: true, force: true });
const SKIP = new Set(['.obsidian', 'node_modules', 'backups', 'Excalidraw', '.git', '.trash']);
function walk(d, o = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name.startsWith('.') || SKIP.has(f.name)) continue; const q = path.join(d, f.name); f.isDirectory() ? walk(q, o) : /\.md$/.test(f.name) && o.push(q); } return o; }
let changed = 0, notIdem = [], stepCounts = {};
for (const f of walk(root)) {
  const text = fs.readFileSync(f, 'utf8');
  const r1 = p.repairText(text);
  const r2 = p.repairText(r1.text);
  if (r1.changed) { changed++; for (const c of r1.summary.split(' | ')) { const k = c.replace(/\d+/g, 'N'); stepCounts[k] = (stepCounts[k] || 0) + 1; } }
  if (r2.changed) notIdem.push(path.relative(root, f) + ' :: ' + r2.summary);
  const dest = path.join(out, path.relative(root, f));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, r1.text);
}
console.log('notes that Repair changes:', changed);
console.log(JSON.stringify(stepCounts));
console.log('NOT idempotent (second pass changed something):', notIdem.length);
for (const n of notIdem.slice(0, 15)) console.log('  ', n);
