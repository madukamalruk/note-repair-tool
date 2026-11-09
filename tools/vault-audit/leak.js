// Render every note of a folder with markdown-it + the real MathJax and report blocks where raw LaTeX shows up as plain text
// (the symptom of math that Obsidian cannot parse: "\begin{aligned} > $\frac{...}" printed in red).
// Usage: node leak.js <folder> [--repaired]   (--repaired runs the plugin's repairText on each note first)
// Needs: npm install --no-save mathjax-full@3.2.2 markdown-it markdown-it-mathjax3
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = process.argv[2];
const repaired = process.argv.includes('--repaired');
if (!root) { console.error('usage: node leak.js <folder> [--repaired]'); process.exit(1); }

const md = require('markdown-it')({ html: true });
md.use(require('markdown-it-mathjax3'), {});

let plugin = null;
if (repaired) {
  const orig = Module._load;
  Module._load = function (r, ...a) {
    return r === 'obsidian' ? { Plugin: class {}, Notice: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {} } : orig.call(this, r, ...a);
  };
  plugin = new (require(process.env.PLUGIN || '../../main.js'))(); // PLUGIN=<path to another main.js> compares versions
}

function walk(d, o = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name === 'node_modules') continue;
    const p = path.join(d, f.name);
    f.isDirectory() ? walk(p, o) : /\.md$/.test(f.name) && o.push(p);
  }
  return o;
}

const LEAK = /\\begin\{|\\end\{|\\frac\b|\\partial\b|\\left\b|\\right\b|\\int\b|\\sum\b|\\sqrt\b|\\hat\b|\\mathbf\b|\\cdot\b|\\times\b|\\text\{|\\\\|\$[^$\n]{1,80}\$|&=|&\\|\\Delta\b|\\theta\b|\\pi\b|\\infty\b/;

function visibleText(html) {
  return html
    .replace(/<mjx-container[\s\S]*?<\/mjx-container>/g, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

const out = [];
let notes = 0, blocksBad = 0, mjxTotal = 0, errTotal = 0;
for (const file of walk(root)) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (plugin) text = plugin.repairText(text).text;
  notes++;
  const lines = text.split('\n');
  const tokens = md.parse(text, {});
  for (const t of tokens) {
    if (t.level !== 0 || !t.map) continue;
    const slice = lines.slice(t.map[0], t.map[1]).join('\n');
    if (!/[$\\]/.test(slice)) continue;
    let html;
    try { html = md.render(slice); } catch (e) {
      // MathJax itself threw (usually a stray control or surrogate character inside a formula)
      blocksBad++; errTotal++;
      out.push({ file: path.relative(root, file), from: t.map[0] + 1, to: t.map[1], why: 'MathJax crashed: ' + String(e.message).slice(0, 40), head: lines[t.map[0]].slice(0, 70) });
      continue;
    }
    mjxTotal += (html.match(/<mjx-container/g) || []).length;
    const errs = (html.match(/data-mjx-error|<g data-mml-node="merror"/g) || []).length;
    errTotal += errs;
    const vis = visibleText(html);
    // markdown-it (unlike Obsidian) does not parse "$$...$$" inside a table cell: not counted as a leak there
    const isTable = /^\s*\|/.test(lines[t.map[0]]);
    const m = vis.match(isTable ? new RegExp(LEAK.source.replace('|\\$[^$\\n]{1,80}\\$', '')) : LEAK);
    if (m || errs) {
      blocksBad++;
      out.push({ file: path.relative(root, file), from: t.map[0] + 1, to: t.map[1], why: errs ? 'MathJax error' : 'raw LaTeX in text: ' + m[0], head: lines[t.map[0]].slice(0, 70) });
    }
  }
}
console.log(`notes: ${notes} | formulas rendered: ${mjxTotal} | MathJax errors: ${errTotal} | blocks with raw LaTeX or errors: ${blocksBad}${repaired ? '  (after repair)' : ''}`);
const byFile = {};
for (const o of out) (byFile[o.file] = byFile[o.file] || []).push(o);
for (const [f, list] of Object.entries(byFile)) {
  console.log(`\n${f}: ${list.length}`);
  for (const o of list.slice(0, 12)) console.log(`  ${o.from}-${o.to}  ${o.why.slice(0, 50)}  | ${o.head}`);
  if (list.length > 12) console.log(`  ... ${list.length - 12} more`);
}
