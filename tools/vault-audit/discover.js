// Vault-wide discovery: MathJax errors (validated with real MathJax), split/broken tables, stray fences, empty '>' lines.
const fs = require('fs');
const path = require('path');
const { check } = require('./mjcheck.js');

const root = process.argv[2];
if (!root) { console.error('usage: node discover.js <vault folder>'); process.exit(1); }
const SKIP_DIRS = new Set(['.obsidian', 'node_modules', 'backups', 'Excalidraw', '.git', '.trash']);
function walk(d, o = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name.startsWith('.') || SKIP_DIRS.has(f.name)) continue;
    const p = path.join(d, f.name);
    f.isDirectory() ? walk(p, o) : /\.md$/.test(f.name) && o.push(p);
  }
  return o;
}

const findings = [];
const add = (file, line, cat, msg, snip) => findings.push({ file: path.relative(root, file), line, cat, msg, snip: (snip || '').slice(0, 100) });
const strip = (l) => l.replace(/^[ \t>]*/, '');
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(strip(l));
const isSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(strip(l)) && strip(l).includes('-') && strip(l).includes('|');
const countCells = (l) => { const s = strip(l).trim().replace(/\\\|/g, '').replace(/`[^`]*`/g, ''); let n = 0; for (const c of s) if (c === '|') n++; return n - 1; };

for (const file of walk(root)) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  let inCode = false;
  let inDisplay = false, dispStart = 0, dispBuf = [];
  let yaml = lines[0] === '---';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const b = strip(l);
    if (yaml) { if (i > 0 && l.trim() === '---') yaml = false; continue; }
    if (/^```/.test(b)) { inCode = !inCode; continue; }
    if (inCode) continue;

    // empty trailing '>' (gap box)
    if (/^\s*>\s*$/.test(l)) {
      const nxt = lines[i + 1] || '';
      if (!/^\s*>/.test(nxt)) add(file, i + 1, 'empty-callout-tail', 'empty ">" ends a callout', l);
    }

    // ---- display math ----
    const noInline = b.replace(/`[^`]*`/g, '');
    const dd = (noInline.match(/\$\$/g) || []).length;
    if (inDisplay) {
      if (dd % 2 === 1) {
        const upto = b.slice(0, b.indexOf('$$'));
        dispBuf.push(upto);
        const src = dispBuf.join('\n');
        const r = check(src, true);
        if (!r.ok) add(file, dispStart + 1, 'math-error', r.msg, src.replace(/\s+/g, ' '));
        inDisplay = false; dispBuf = [];
      } else dispBuf.push(b);
      if (!/^\s*>/.test(l) && lines[dispStart] && /^\s*>/.test(lines[dispStart])) add(file, i + 1, 'callout-math-prefix', 'math line without > inside a callout', l);
      continue;
    }
    if (dd >= 1) {
      // handle one or more $$..$$ on this line; an odd count opens a block
      const parts = noInline.split('$$');
      for (let k = 1; k + 1 < parts.length; k += 2) {
        const r = check(parts[k], true);
        if (!r.ok) add(file, i + 1, 'math-error', r.msg, parts[k]);
        if (/(^|[^\\])%/.test(parts[k])) add(file, i + 1, 'math-percent', 'unescaped % in math (comment: rest of the line is lost)', parts[k]);
      }
      if (dd % 2 === 1) { inDisplay = true; dispStart = i; dispBuf = [parts[parts.length - 1]]; }
      continue;
    }

    // ---- inline math ----
    const text = noInline;
    const re = /(?<![\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g;
    let m;
    while ((m = re.exec(text))) {
      const inner = m[1];
      const looksMath = /[\\^_{}=<>+\-*/]|^\s*[A-Za-z]\s*$|^\s*\d+\s*$/.test(inner) && !/^\s*\d[\d,.]*\s*(and|or|to|per)?\s*$/i.test(inner) ;
      if (!looksMath) continue;
      if (/^\s|\s$/.test(inner)) add(file, i + 1, 'inline-space', 'space after opening or before closing $', m[0]);
      const r = check(inner.trim(), false);
      if (!r.ok) add(file, i + 1, 'math-error', r.msg, m[0]);
      if (/(^|[^\\])%/.test(inner)) add(file, i + 1, 'math-percent', 'unescaped % in math', m[0]);
      if (isTableRow(l) && /(^|[^\\])\|/.test(inner)) add(file, i + 1, 'table-pipe-in-math', 'raw | inside math in a table row', m[0]);
    }
  }
  if (inDisplay) add(file, dispStart + 1, 'math-unclosed', 'display math never closed', dispBuf.join(' '));

  // ---- tables ----
  let i = 0;
  inCode = false;
  while (i < lines.length) {
    const b = strip(lines[i]);
    if (/^```/.test(b)) inCode = !inCode;
    if (inCode || !isTableRow(lines[i])) { i++; continue; }
    // table block starts at a row; collect consecutive rows
    let j = i;
    while (j < lines.length && isTableRow(lines[j])) j++;
    const block = lines.slice(i, j);
    const hasSep = block.length >= 2 && isSep(block[1]);
    if (!hasSep) {
      // orphan rows: continuation of a table split by a blank line?
      let k = i - 1, blanks = 0;
      while (k >= 0 && strip(lines[k]).trim() === '') { k--; blanks++; }
      if (k >= 0 && isTableRow(lines[k]) && blanks > 0) add(file, i + 1, 'table-split', 'table rows after a blank line (table split)', lines[i]);
      else if (!block.every(isSep)) add(file, i + 1, 'table-no-separator', 'rows without header separator', lines[i]);
    } else {
      const want = countCells(block[0]);
      block.forEach((r, n) => { if (n > 1 && countCells(r) !== want) add(file, i + n + 1, 'table-cells', `row has ${countCells(r)} cells, header has ${want}`, r); });
      // callout prefix consistency
      const quoted = block.map(r => /^\s*>/.test(r));
      if (quoted.some(Boolean) && !quoted.every(Boolean)) add(file, i + 1, 'table-callout-prefix', 'table rows with and without > prefix', lines[i]);
      // row/pipe-in-math already covered
    }
    // orphan unprefixed rows right after a callout
    if (!/^\s*>/.test(lines[i]) && i > 0 && /^\s*>/.test(lines[i - 1]) && strip(lines[i - 1]).trim() !== '') add(file, i + 1, 'table-callout-prefix', 'table row without > right after a callout line', lines[i]);
    i = j;
  }
}

const cats = {};
for (const f of findings) (cats[f.cat] = cats[f.cat] || []).push(f);
console.log('findings:', findings.length);
for (const [c, arr] of Object.entries(cats).sort((a, b) => b[1].length - a[1].length)) {
  const files = new Set(arr.map(x => x.file));
  console.log(`\n== ${c}: ${arr.length} in ${files.size} notes`);
  const msgs = {};
  for (const a of arr) msgs[a.msg.replace(/\d+/g, 'N')] = (msgs[a.msg.replace(/\d+/g, 'N')] || 0) + 1;
  console.log('   types:', JSON.stringify(msgs).slice(0, 400));
  for (const a of arr.slice(0, 4)) console.log('   ', a.file.split('\\').pop() + ':' + a.line, '|', a.snip.replace(/\s+/g, ' '));
}
fs.writeFileSync(path.join(__dirname, 'findings.json'), JSON.stringify(findings));
