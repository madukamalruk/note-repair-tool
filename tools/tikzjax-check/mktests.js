// Builds tests.json from the ```tikz blocks of a folder of notes.
// Usage: node mktests.js <notes-folder> [raw|repaired] [filename-filter]
//   repaired (default): each block goes through the plugin first, exactly as TikZJax would receive it after "Repair"
//   raw:                the blocks as they are in the notes
'use strict';
const Module = require('module');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: node mktests.js <notes-folder> [raw|repaired] [filter]'); process.exit(1); }
const mode = process.argv[3] || 'repaired';
const filter = process.argv[4];

const orig = Module._load;
Module._load = function (r, ...a) {
  return r === 'obsidian' ? { Plugin: class {}, Notice: class {}, MarkdownView: class {}, Modal: class {} } : orig.call(this, r, ...a);
};
const plugin = new (require('../../main.js'))();

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name === 'node_modules') continue;
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : /\.md$/.test(f.name) && out.push(p);
  }
  return out;
}

const tests = [];
let id = 0;
for (const file of walk(root)) {
  if (filter && !file.includes(filter)) continue;
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const re = /^([ \t>]*)```(tikz|circuitikz)\n([\s\S]*?)^[ \t>]*```/gm;
  let m;
  while ((m = re.exec(text))) {
    id++;
    let code = m[3].split('\n').map(l => l.replace(/^[ \t]*>[ \t]?/, '')).join('\n');
    if (mode === 'repaired') {
      const rep = plugin.repairText('```tikz\n' + code + '\n```\n').text;
      const mm = rep.match(/```tikz\r?\n([\s\S]*?)\r?\n```/);
      if (mm) code = mm[1].replace(/\r/g, '');
    }
    tests.push({ id, file: path.relative(root, file), line: text.slice(0, m.index).split('\n').length, src: code });
  }
}
fs.writeFileSync(path.join(__dirname, 'tests.json'), JSON.stringify(tests));
console.log(tests.length + ' blocks (' + mode + ') written to tests.json');
