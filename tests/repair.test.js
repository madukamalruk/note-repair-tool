// Self-contained test suite for Note Repair Tool. Run with: npm test
// Optional: TEST_LATEX=1 also compiles the repaired TikZ blocks with pdflatex (needs a TeX install).
'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// ---- minimal Obsidian stub ----------------------------------------------------------------
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') {
    return {
      Plugin: class {
        constructor() {
          this.cmds = [];
          this.handlers = {};
          this.saved = null;
          this.files = {};      // path -> text (fake vault)
          this.written = {};    // adapter writes (backups)
          this.dirs = new Set();
          this.manifest = { dir: '.obsidian/plugins/note-repair-tool' };
          const self = this;
          this.app = {
            workspace: {
              on: (name, cb) => { self.handlers[name] = cb; return {}; },
              getActiveFile: () => ({ path: 'Sem/Note.md', parent: { path: 'Sem' } }),
            },
            vault: {
              getMarkdownFiles: () => Object.keys(self.files).map(p => ({ path: p })),
              read: async (f) => self.files[f.path],
              modify: async (f, t) => { self.files[f.path] = t; },
              adapter: {
                exists: async (p) => self.dirs.has(p),
                mkdir: async (p) => { self.dirs.add(p); },
                write: async (p, t) => { self.written[p] = t; },
              },
            },
          };
        }
        addCommand(c) { this.cmds.push(c); }
        addRibbonIcon() {}
        addSettingTab() {}
        registerEvent() {}
        async loadData() { return null; }
        async saveData(d) { this.saved = d; }
      },
      Notice: class {},
      MarkdownView: class {},
      Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
      PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
      Setting: class {},
    };
  }
  return origLoad.call(this, request, ...rest);
};
const Plugin = require('../main.js');
const plugin = new Plugin();
const repair = (t) => plugin.repairText(t).text;

let passed = 0;
let failed = 0;
const failures = [];
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}
async function runAll() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed++;
    } catch (e) {
      failed++;
      failures.push(name + ': ' + e.message);
    }
  }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || 'not equal') + '\n  got:  ' + JSON.stringify(a) + '\n  want: ' + JSON.stringify(b)); };
const has = (t, s) => { if (!t.includes(s)) throw new Error('missing ' + JSON.stringify(s) + ' in ' + JSON.stringify(t)); };
const hasNot = (t, s) => { if (t.includes(s)) throw new Error('unexpected ' + JSON.stringify(s) + ' in ' + JSON.stringify(t)); };
const fence = (body) => '```tikz\n\\begin{document}\n' + body + '\n\\end{document}\n```\n';

// ---- plugin wiring ------------------------------------------------------------------------------
test('commands are registered', async () => {
  await plugin.onload();
  for (const id of ['repair-current-note', 'repair-selection', 'next-placeholder', 'audit-note', 'repair-folder']) {
    if (!plugin.cmds.some(c => c.id === id)) throw new Error('missing command ' + id);
  }
  eq(plugin.settings.autoRepairOnPaste, true, 'auto-repair default');
  eq(plugin.settings.pasteThreshold, 400, 'threshold default');
});
test('auto-repair after a large paste (and not after a small one or when switched off)', async () => {
  const h = plugin.handlers['editor-paste'];
  if (!h) throw new Error('paste handler not registered');
  let calls = 0;
  const realRepair = plugin.repairEditor;
  plugin.repairEditor = () => { calls++; };
  const realTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
  try {
    const evt = (text) => ({ clipboardData: { getData: () => text } });
    h(evt('x'.repeat(50)), {});
    eq(calls, 0, 'small paste triggered a repair');
    h(evt('x'.repeat(500)), {});
    eq(calls, 1, 'large paste did not trigger a repair');
    h({ clipboardData: { getData: () => '' } }, {});
    eq(calls, 1, 'image paste (no text) triggered a repair');
    plugin.settings.autoRepairOnPaste = false;
    h(evt('x'.repeat(500)), {});
    eq(calls, 1, 'disabled setting still repaired');
    plugin.settings.autoRepairOnPaste = true;
    h(null, {});   // malformed event must not throw
  } finally {
    plugin.repairEditor = realRepair;
    global.setTimeout = realTimeout;
  }
});
test('folder repair: dry run lists changed notes, apply backs up the originals first', async () => {
  plugin.files = {
    'Sem/A.md': '# A\n\n* one\n\n* two\n',
    'Sem/B.md': '# B\n\ntext\n',
    'Sem/Sub/C.md': '---\ntags: [a]\nDate: {{date:YYYY-MM-DD}}\n---\n# C\n',
    'Other/D.md': '# D\n\n* one\n\n* two\n',
  };
  const orig = { ...plugin.files };
  const { total, plan } = await plugin.planFolderRepair('Sem');
  eq(total, 3, 'files in folder');
  eq(plan.map(p => p.file.path).sort().join(), 'Sem/A.md,Sem/Sub/C.md', 'changed notes');
  eq(plugin.files['Sem/A.md'], orig['Sem/A.md'], 'dry run must not modify notes');
  const r = await plugin.applyFolderRepair(plan);
  eq(r.done, 2, 'applied');
  has(plugin.files['Sem/A.md'], '* one\n* two');
  eq(plugin.files['Other/D.md'], orig['Other/D.md'], 'note outside the folder was touched');
  const backups = Object.keys(plugin.written);
  eq(backups.length, 2, 'backups written');
  for (const b of backups) {
    const rel = b.split('/backups/')[1].split('/').slice(1).join('/');
    eq(plugin.written[b], orig[rel], 'backup of ' + rel + ' differs from the original');
  }
});

// ---- AI leaks and YAML ----------------------------------------------------------------------------
test('[cite] markers are removed', () => {
  const t = repair('# H\n\ntext [cite: 1, 2] more [cite_start]x\n');
  has(t, 'text more x');
  hasNot(t, '[cite');
});
test('[cite: ...] removal never swallows text up to a later ]', () => {
  const t = repair('# H\n\nvalue [cite: 12-14] and [cite: 3, 4]. Then <Q1 [cite:" keep this text] more\n');
  has(t, 'value and.');
  has(t, '[cite:" keep this text] more');
});
test('Source notes and chunk-boundary lines are kept', () => {
  const doc = '# H\n\nbody (Source 8)\n\n---\nSTATUS: Done [a] | Next [b]\nඊළඟ කොටසට යමුද?\n';
  const t = repair(doc);
  has(t, '(Source 8)');
  has(t, 'STATUS: Done');
  has(t, 'ඊළඟ කොටසට යමුද?');
});
test('{{date:YYYY-MM-DD}} is filled with today in the YAML only', () => {
  const d = new Date();
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const t = repair('---\ntags: [a]\nDate: {{date:YYYY-MM-DD}}\n---\n# H\n\n{{date:YYYY-MM-DD}} in body\n');
  has(t, 'Date: ' + iso);
  has(t, '{{date:YYYY-MM-DD}} in body');
});
test('a horizontal rule near the top is NOT frontmatter: no text above it is lost', () => {
  const doc = 'First paragraph of the note.\n\nSecond line.\n\n---\n\n### 1. A heading\n\nBody text\n\n---\n\nMore text\n';
  const t = repair(doc);
  has(t, 'First paragraph of the note.');
  has(t, '### 1. A heading');
  has(t, 'More text');
});
test('frontmatter is still cleaned (leading blank line, ## key:, bold)', () => {
  const t = repair('\n---\n## tags: [a]\n\nSubject: X\n---\n# H\n');
  eq(t.split('\n').slice(0, 4).join('\n'), '---\ntags: [a]\nSubject: X\n---');
});
test('YAML frontmatter loses blank lines and heading marks', () => {
  const t = repair('---\n\n## tags: [a]\n\nSubject: X\n---\n# H\n');
  eq(t.split('\n').slice(0, 4).join('\n'), '---\ntags: [a]\nSubject: X\n---');
});

// ---- math -------------------------------------------------------------------------------------------------
test('\\( \\) and \\[ \\] become $ and $$', () => {
  const t = repair('# H\n\nInline \\(a_n\\) and \\[ x^2 \\] and `\\(code\\)` and \\\\[2pt] stays.\n\n\\[\nE = mc^2\n\\]\n');
  has(t, 'Inline $a_n$ and $$x^2$$');
  has(t, '`\\(code\\)`');
  has(t, '\\\\[2pt]');
  has(t, '\n$$\nE = mc^2\n$$\n');
});
test('NotebookLM-style doubled-backslash delimiters \\\\( \\\\) and \\\\[ \\\\] become $ and $$', () => {
  const t = repair('# H\n\n* **MPV:** mean (\\\\(l_m = \\frac{\\sum l_i}{n}\\\\)) of data\n\n   \\\\[\\text{Ground Limit} = 0.00025 \\times 1000\\\\]\n\n| Area | Small (\\\\(< 250\\text{ km}^2\\\\)) | Large \\\\[x^2\\\\] |\n| --- | --- | --- |\n| a | b | c |\n\n\\\\[\nE = mc^2\n\\\\]\n');
  has(t, '(**MPV:** mean ($l_m = \\frac{\\sum l_i}{n}$) of data'.replace('(**MPV:**', '**MPV:**'));
  has(t, '   $$\\text{Ground Limit} = 0.00025 \\times 1000$$');
  has(t, '| Area | Small ($< 250\\text{ km}^2$) | Large $x^2$ |');
  has(t, '\n$$\nE = mc^2\n$$\n');
  hasNot(t, '\\\\(');
  hasNot(t, '\\\\[');
  eq(repair(t), t, 'not idempotent');
});
test('a real LaTeX line break before a parenthesis inside math is not a delimiter', () => {
  const doc = '# H\n\n$$\n\\begin{aligned} a &= b \\\\\n(c) &= d \\end{aligned}\n$$\n';
  has(repair(doc), '(c) &= d');
});

test('math lines that lost the callout prefix are re-quoted', () => {
  const t = repair('# H\n\n> [!example] X\n> $$\n> a &= b \\\\\nc &= d\n\ne &= f\n> $$\n> after\n');
  has(t, '> c &= d');
  has(t, '> e &= f');
  has(t, '> after');
});
test('an unclosed callout $$ does not swallow the document', () => {
  const t = repair('# H\n\n> [!note] N\n> $$\n> a\n\n## Next heading\n\ntext\n');
  has(t, '\n## Next heading\n');
  hasNot(t, '> ## Next heading');
});

// ---- Markdown structure -------------------------------------------------------------------------------
test('unbalanced ** does not merge blocks', () => {
  const t = repair('# H\n\n**Step 1: Find $a_0$\n\n$$a_0 = 1$$\n\n> [!tip] Trap\n> text\n\n**Step 2**\n');
  has(t, '\n$$a_0 = 1$$\n');
  has(t, '> [!tip] Trap\n> text');
});
test('NotebookLM nested bold inside parentheses no longer leaves the outer bold open', () => {
  const t = repair('# H\n\n* **Staff Reading Impact:** value (**Staff Reading**), too high **appears high (**Staff reading appears too high**).\n\n* a (**Normal to gravity**) fine **bold** text\n');
  has(t, '**appears high (Staff reading appears too high)**.');
  has(repair('# H\n\nplain **opens here (**inner**), then **True angle** more.\n'), '**opens here (inner)**, then **True angle** more.');
  has(t, '* a (**Normal to gravity**) fine **bold** text');
  eq(repair(t), t, 'not idempotent');
});
test('bold spacing is fixed, code and math are untouched', () => {
  const t = repair('# H\n\n** spaced ** and **ok** and `**x**` and $a**b$\n');
  has(t, '**spaced** and **ok**');
  has(t, '`**x**`');
  has(t, '$a**b$');
});
test('at most one blank line outside code; code is untouched', () => {
  const t = repair('# H\n\n\n\n\npara\n\n\n```\ncode\n\n\nmore\n```\n\n\nend\n');
  has(t, '# H\n\npara\n\n```');
  has(t, 'code\n\n\nmore');
  has(t, '```\n\nend');
});
test('lists are tightened, lists split by a block are not', () => {
  has(repair('# H\n\n* one\n\n* two\n\n* three\n\npara\n'), '* one\n* two\n* three\n\npara');
  has(repair('# H\n\n1. a\n\n2. b\n'), '1. a\n2. b');
  has(repair('# H\n\n> [!tip] T\n> - x\n>\n> - y\n'), '> - x\n> - y');
  has(repair('# H\n\n* one\n\n$$x$$\n\n* two\n'), '* one\n\n$$x$$\n\n* two');
});
test('a trailing empty > is removed from callouts', () => {
  const t = repair('# H\n\n> [!note] N\n> text\n>\n\nnext\n');
  if (/^>\s*$/m.test(t)) throw new Error('empty > left: ' + JSON.stringify(t));
});
test('table rows split over several lines are merged', () => {
  const t = repair('# H\n\n| a | b |\n| --- | --- |\n| 1 |\n| 2 |\n');
  has(t, '| 1 | 2 |');
});
test('tables: cells of one row on separate lines are put back together (inside a callout)', () => {
  const t = repair('# H\n\n> | Job | Plants | Reason |\n> | --- | --- | --- |\n> | **Base** |  |  |\n>\n>  | Coal, nuclear\n>\n>  | cheap fuel |\n> | **Peak** |  |  |\n>\n>  | Hydro |\n>\n>  | fast start |\n');
  has(t, '> | **Base** | Coal, nuclear | cheap fuel |');
  has(t, '> | **Peak** | Hydro | fast start |');
  eq(repair(t), t, 'not idempotent');
});
test('tables: rows cut at the wrong pipe are re-chunked to the header width', () => {
  const t = repair('# H\n\n| A | B | C | D |\n| --- | --- | --- | --- |\n| a1 | b1 | c1 |\n| d1 | a2 | b2 |\n| c2 | d2 | a3 | b3 |\n| c3 | d3 |\n');
  has(t, '| a1 | b1 | c1 | d1 |');
  has(t, '| a2 | b2 | c2 | d2 |');
  has(t, '| a3 | b3 | c3 | d3 |');
});
test('tables: a ragged but intentional table is left alone', () => {
  const doc = '# H\n\n| A | B | C |\n| --- | --- | --- |\n| a | b |\n| c | d |\n| e | f | g |\n';
  has(repair(doc), '| a | b |\n| c | d |\n| e | f | g |');
});
test('tables: rows split by a blank line rejoin, a second table gets a blank line, callout prefix is restored', () => {
  has(repair('# H\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |\n'), '| 1 | 2 |\n| 3 | 4 |');
  const two = repair('# H\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| X | Y | Z |\n| --- | --- | --- |\n| p | q | r |\n');
  has(two, '| 1 | 2 |\n\n| X | Y | Z |');
  has(repair('# H\n\n> | A | B |\n| --- | --- |\n| 1 | 2 |\n'), '> | A | B |\n> | --- | --- |\n> | 1 | 2 |');
});
test('tables: a raw | inside real math is replaced, money with | is not', () => {
  has(repair('# H\n\n| A | B |\n| --- | --- |\n| $|x|$ | $a_1$ |\n'), '$\\vert x\\vert$');
  has(repair('# H\n\n| Item | Cost |\n| --- | --- |\n| Plant | $2000 per kW | $8000 per kW |\n'), '$2000 per kW | $8000 per kW');
});
test('MathJax: \\left{ , bare %, bare & and spaces inside $ are fixed', () => {
  has(repair('# H\n\n$\\mathcal{L}\\left{f(t)\\right} = F$ and $\\pm 0.1%$ and $ \\frac{a}{b} $\n'), '$\\mathcal{L}\\left\\{f(t)\\right\\} = F$');
  has(repair('# H\n\n$\\pm 0.1%$\n'), '$\\pm 0.1\\%$');
  has(repair('# H\n\n$ \\frac{a}{b} $\n'), '$\\frac{a}{b}$');
  has(repair('# H\n\n$$\na &= b \\\\\nc &= d\n$$\n'), '\\begin{aligned}');
  const ok = '# H\n\n$$\n\\begin{aligned}\na &= b\\% \\\\\nc &= d\n\\end{aligned}\n$$\n';
  eq(repair(ok), ok, 'valid math was changed');
});
test('MathJax: currency text and \\text{...} are not touched', () => {
  const doc = '# H\n\nIt costs $5 and later $10 in total, 50% done.\n';
  eq(repair(doc), doc);
});
test('plain-text LaTeX in prose is wrapped in $ (and prose stays prose)', () => {
  const t = repair('# H\n\n- I_C = \\beta I_B (කලෙක්ටර් ධාරාව)\n\nFrom x \\cdot y + z = 0, we get file_name.\n');
  has(t, '- $I_C = \\beta I_B$ (කලෙක්ටර් ධාරාව)');
  has(t, '$x \\cdot y + z = 0$');
  has(t, 'file_name');
  hasNot(t, '$file_name$');
  eq(repair(t), t, 'not idempotent');
});
test('repairText reaches a fixed point on a note that needs several passes', () => {
  const doc = '```\n\n## Inventory\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```tikz\n\\begin{document}\n\\begin{circuitikz}\n\\draw (0,0) to[R] (2,0);\n\\end{circuitikz}\n\\end{document}\n```\n\n> [!note] N\n> text\n>\n';
  const r = plugin.repairText(doc);
  eq(plugin.repairText(r.text).changed, false, 'second call changed the text');
});
test('callout fold markers are removed so every callout stays open', () => {
  const t = repair('# H\n\n> [!example]- Title\n> body\n\n> [!question]+ Title\n> body\n\n> > [!note]- Nested\n> > text\n');
  has(t, '> [!example] Title');
  has(t, '> [!question] Title');
  has(t, '[!note] Nested');
  hasNot(t, ']-');
  hasNot(t, ']+');
  eq(repair(t), t, 'not idempotent');
  has(repair('# H\n\n```text\n> [!note]- kept inside code\n```\n'), '> [!note]- kept inside code');
});
test('embedded callouts lose their fold marker and keep new types', () => {
  has(repair('# H\n\n[!example]+ Title here\nbody\n'), '> [!example] Title here');
  has(repair('# H\n\n> [!abstract] Definition 2.1\n> text\n'), '> [!abstract] Definition 2.1\n> text');
});

// ---- Mermaid ----------------------------------------------------------------------------------------------------
test('Mermaid labels become plain text', () => {
  const t = repair('# H\n\n```mermaid\nflowchart TD\n    A["$$a_0, a_n$$ Formulas"] --> B["Even & Odd \\pi"]\n```\n');
  hasNot(t, '$');
  has(t, 'Even and Odd \u03c0');
});
test('Mermaid keeps the \\n line break and numeric HTML entities in labels', () => {
  const t = repair('# H\n\n```mermaid\nflowchart TD\n    A["State one\\nCalculate $x$"] --> B["z&sup2; and &alpha;&sup1;"]\n```\n');
  has(t, 'State one\\nCalculate x');
  has(t, '&sup2;');
  has(t, '&sup1;');
});
test('an untagged fence after a "Code snippet" label becomes mermaid', () => {
  has(repair('# H\n\nCode snippet\n\n```\nflowchart LR\n    A["x"] --> B["y"]\n```\n'), '```mermaid');
});
test('Mermaid repair adds no blank lines on repeated runs', () => {
  const once = repair('# H\n\n```mermaid\nflowchart TD\n    A["x"] --> B["y"]\n```\n');
  eq(repair(once), once, 'not idempotent');
});

// ---- TikZ ----------------------------------------------------------------------------------------------------------
test('pgfplots graph gets the pgfplots package and no circuitikz', () => {
  const t = repair(fence('\\begin{tikzpicture}\n\\begin{axis}[xlabel={t}]\n\\addplot coordinates {(0,1) (1,2)};\n\\end{axis}\n\\end{tikzpicture}'));
  has(t, '\\usepackage{pgfplots}');
  has(t, 'compat=newest');
  hasNot(t, 'usepackage{circuitikz}');
});
test('circuit block keeps circuitikz and gets no pgfplots', () => {
  const t = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R, l=$R_1$] (3,0);\n\\end{circuitikz}'));
  has(t, '\\usepackage{circuitikz}');
  hasNot(t, 'pgfplots');
});
test('libraries the body needs are added automatically', () => {
  const t = repair(fence('\\begin{tikzpicture}[>=Stealth]\n\\node (A) at (0,0) {A};\n\\node (B) at (4,2) {B};\n\\node at ($(A)!0.5!(B)$) {M};\n\\node[right=1cm of B] {C};\n\\draw[decorate, decoration={brace}] (0,-1) -- (4,-1);\n\\end{tikzpicture}'));
  for (const lib of ['calc', 'positioning', 'arrows.meta', 'pathreplacing']) has(t, lib);
});
test('labels l=$R_1$ keep their content (V33 bug) and l=R_2 is wrapped', () => {
  const t = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R, l=$R_1$, i>=$I_1$] (3,0) to[R, l=R_2] (3,2);\n\\end{circuitikz}'));
  has(t, 'l={$R_1$}');
  has(t, 'i>={$I_1$}');
  has(t, 'l={$R_2$}');
  hasNot(t, '{$2$}');
});
test('top/bottom become above/below, top color is untouched', () => {
  const t = repair(fence('\\begin{tikzpicture}\n\\draw (0,0) -- (2,0) node[midway, bottom] {$h$} node[top left] {x};\n\\node[top color=red] at (0,2) {y};\n\\end{tikzpicture}'));
  has(t, 'midway, below');
  has(t, 'above left');
  has(t, 'top color=red');
});
test('math without $, % and & in node text are fixed', () => {
  const t = repair(fence('\\begin{tikzpicture}\n\\node at (0,2) {Shift 90^\\circ, V_s = 5% and A & B, 10 \\Omega};\n\\end{tikzpicture}'));
  has(t, '$90^\\circ$');
  has(t, '$V_{s}$ = 5');
  has(t, '5\\%');
  has(t, 'A \\& B');
  has(t, '$\\Omega$');
});
test('TikZ repair is idempotent', () => {
  const once = repair(fence('\\begin{tikzpicture}\n\\begin{axis}\\addplot{x^2};\\end{axis}\n\\end{tikzpicture}'));
  eq(repair(once), once, 'not idempotent');
});
test('TikZ inside a callout keeps the prefix on every line', () => {
  const t = repair('> [!example] X\n> ```tikz\n> \\begin{document}\n> \\begin{circuitikz}\n> \\draw (0,0) to[R] (2,0);\n> \\end{circuitikz}\n> \\end{document}\n> ```\n');
  for (const line of t.split('\n').filter(l => l.trim() !== '')) if (!line.startsWith('>')) throw new Error('prefix lost: ' + line);
});

test('TikZJax label parser: = and , inside option math are protected (verified in TikZJax)', () => {
  const t = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R, l={$R_s=50\\,\\Omega$}, i=$a,b$] (3,0);\n\\end{circuitikz}'));
  has(t, 'l={$R_s\\mathrel{=}50\\,\\Omega$}');
  has(t, 'i={$a{,}b$}');
  eq(repair(t), t, 'not idempotent');
});
test('= inside node text math is left alone', () => {
  has(repair(fence('\\begin{tikzpicture}\n\\draw (0,0) -- (2,0) node[midway, left] {$h=2$};\n\\end{tikzpicture}')), '{$h=2$}');
});
test('textcomp commands (hang TikZJax) become math', () => {
  const t = repair(fence('\\begin{tikzpicture}\n\\node at (0,0) {\\textbullet};\n\\node at (1,0) {5\\textdegree};\n\\end{tikzpicture}'));
  has(t, '{$\\bullet$}');
  has(t, '5$^\\circ$');
  hasNot(t, 'textbullet');
});

test('V43: empty / env-less tikz blocks (endless spinner) are removed', () => {
  const t = repair('before\n\n```tikz\n```\n\n```tikz\n\\begin{document}\n\\end{document}\n```\n\nafter\n');
  hasNot(t, '```');
  has(t, 'before');
  has(t, 'after');
});
test('V43: elmech / block bipoles become generic', () => {
  const t = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[elmech, l=M] (3,0) to[block, l=F] (5,0);\n\\end{circuitikz}'));
  has(t, 'to[generic, l=');
  hasNot(t, 'elmech');
  hasNot(t, 'to[block');
});
test('V43: mismatched end and nested tikzpicture>circuitikz are normalised', () => {
  const a = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R] (3,0);\n\\end{tikzpicture}'));
  has(a, '\\end{circuitikz}');
  hasNot(a, '\\end{tikzpicture}');
  const b = repair(fence('\\begin{tikzpicture}\n\\begin{circuitikz}\n\\draw (0,0) to[R] (3,0);\n\\end{circuitikz}\n\\end{tikzpicture}'));
  hasNot(b, 'tikzpicture');
  has(b, '\\begin{circuitikz}');
});
test('V43: bare comma in circuitikz label text becomes {,}', () => {
  const t = repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R, l={band-pass, gain -1}] (3,0);\n\\end{circuitikz}'));
  has(t, 'l={band-pass{,} gain -1}');
});
test('V43: a ```html block nested in a ```` fence is left alone', () => {
  const doc = '````text\nprompt\n```html\n<script>\nM = { inlineMath: [[\'$\', \'$\'], [\'\\\\(\', \'\\\\)\']] };\n</script>\n```\n````\n';
  const t = repair(doc);
  has(t, "['\\\\(', '\\\\)']");
  eq((t.match(/`/g) || []).length, 14);
  has(repair(doc.replace(/\n/g, '\r\n')), "['\\\\(', '\\\\)']");
});
test('V44: lone $ fences around block math become $$ and the inside is not wrapped again', () => {
  const t = repair('> [!example] Q\n> text\n> $\n> \\int_C F \\cdot dr = \\int_C P\\,dx + Q\\,dy\n> $\n> more\n');
  has(t, '> $$\n> \\int_C F \\cdot dr = \\int_C P\\,dx + Q\\,dy\n> $$');
  hasNot(t, '$\\int_C F');
  eq(repair(t), t);
});
test('V44: "$$ ... $" mismatch is repaired, an unpaired lone $ is left alone', () => {
  has(repair('> [!note] a\n> $$\n> x = 1\n> $\n'), '> $$\n> x = 1\n> $$');
  const keep = repair('The price\n$\nis five dollars\n');
  has(keep, '\n$\n');
});
test('V44: damaged display math is healed (stray $ inside, rows glued with " > ", lost \\,)', () => {
  const dmg = '> [!example] Worked Example\n> $\n> \\begin{aligned} > x &= \\cos t \\\\ > y &= $\\sin t$ > \\end{aligned}\n> $\n> $$ > \\int_C F \\cdot dr = \\int_C P , dx + Q , dy > $$\n';
  const t = repair(dmg);
  has(t, '> $$\n> \\begin{aligned}\n> x &= \\cos t \\\\\n> y &= \\sin t\n> \\end{aligned}\n> $$');
  has(t, '> $$ \\int_C F \\cdot dr = \\int_C P\\,dx + Q\\,dy $$');
  hasNot(t, ' > x &=');
  eq(repair(t), t);
});
test('V44: valid display math is not touched (x > 0, \\text with a dollar)', () => {
  const ok = '$$\n\\begin{aligned}\nx &> 0 \\\\\n\\text{cost } &= 5\n\\end{aligned}\n$$\n';
  eq(repair(ok), ok);
});
test('V44: STATUS notation is shown literally, damaged $ form is healed, nothing is wrapped as math', () => {
  const raw = 'STATUS: Chunk 3 | Done [5.2] | Progress 3 of 7 | Notation [\\hat{i}, \\text{div}, F_s] | Next [5.3]\n';
  const t = repair(raw);
  has(t, 'Notation [`\\hat{i}, \\text{div}, F_s`]');
  const dmg = repair('STATUS: Chunk 1 | Notation $[\\hat{i}, \\nabla$, \\text{div}, $\\nabla^2, \\phi]$ | Next [x]\n');
  hasNot(dmg, '$');
  eq(repair(t), t);
});
test('V45: multi-line \\\\[ ... \\\\] block with stray $ inside becomes a clean $$ block', () => {
  const raw = 'දැන් ඡේදනය:\n\\\\[\\begin{aligned}\n\\text{Dom} &= $D_x$ \\cap $D_y$ \\\\\n&= [0, $\\infty)$\n\\end{aligned}\\\\]\nඉවරයි\n';
  const t = repair(raw);
  has(t, '$$\n\\begin{aligned}\n\\text{Dom} &= D_x \\cap D_y \\\\\n&= [0, \\infty)\n\\end{aligned}\n$$');
  hasNot(t, '\\\\[');
  eq(repair(t), t);
});
test('V45: mismatched delimiters and "</aligned}" are repaired', () => {
  has(repair('see \\\\(x^2\\\\] here\n'), 'see $x^2$ here');
  const t = repair('$$\n\\begin{aligned}\na &= 1 \\\\\nb &= 2\n</aligned}\n$$\n');
  has(t, '\\end{aligned}');
  hasNot(t, '</aligned}');
});
test('V45: a row spacing \\\\[2pt] is not taken for a display delimiter', () => {
  const ok = '$$\n\\begin{aligned}\na &= 1 \\\\\n\\\\[2pt]\nb &= 2\n\\end{aligned}\n$$\n';
  eq(repair(ok), ok);
});
test('V45: ">" inside wrapped math is rejoined (root level and inside a callout)', () => {
  const root = repair('ඕනෑම $\\epsilon\n> 0$ සඳහා,\n   * $\\text{div } F\n> 0$: පිටතට\n');
  has(root, '$\\epsilon > 0$ සඳහා');
  has(root, '$\\text{div } F > 0$: පිටතට');
  const co = repair('> [!example] Q\n> Let $x^2 = a^2 \\quad (a\n> 0)$ be given.\n');
  has(co, '> Let $x^2 = a^2 \\quad (a > 0)$ be given.');
  // a normal callout block formula with $$ fences must not be joined
  const fence = '> [!note] a\n> $$\n> x > 0\n> $$\n';
  eq(repair(fence), fence);
});
test('V45: \\oiint (not in MathJax) becomes a double contour integral', () => {
  const t = repair('$$\\oiint_\\sigma \\mathbf{F} \\cdot \\mathbf{n} \\, dS$$\n');
  has(t, '\\oint\\!\\!\\!\\!\\oint_\\sigma');
  hasNot(t, '\\oiint');
});
test('V43: tikz normalisation is idempotent', () => {
  const src = fence('\\begin{tikzpicture}\n\\begin{circuitikz}\n\\draw (0,0) to[elmech] (3,0);\n\\end{circuitikz}\n\\end{tikzpicture}');
  const once = repair(src);
  eq(repair(once), once);
});

test('a stray ``` after the YAML is removed so the later fences pair up', () => {
  const doc = '---\ntags: [a]\n---\n\n```\n\n## 1. Inventory\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## 2. Next\n\n```tikz\n\\begin{document}\n\\begin{circuitikz}\n\\draw (0,0) to[R] (2,0);\n\\end{circuitikz}\n\\end{document}\n```\n\ntext\n';
  const t = repair(doc);
  eq((t.match(/^```/gm) || []).length, 2, 'fence count');
  hasNot(t, '```\n\n## 1. Inventory');
  has(t, '## 1. Inventory');
  eq(repair(t), t, 'not idempotent');
});
test('legitimate untagged and four-backtick blocks are left alone', () => {
  const doc = '# H\n\n```\nplain text\nmore text\n```\n\n````text\nPrompt\n\n## Heading in a prompt\n\n| a | b |\n| --- | --- |\n\n```tikz\n\\draw (0,0);\n```\n````\n';
  eq((repair(doc).match(/`{3,}/g) || []).length, (doc.match(/`{3,}/g) || []).length, 'fences changed');
});
test('audit flags an untagged block that contains Markdown', () => {
  const issues = plugin.auditText('```\n\n## A\n\n| a | b |\n| --- | --- |\n\n```tikz\nx\n```\n');
  if (!issues.some(i => /stray/.test(i.msg))) throw new Error(JSON.stringify(issues));
});

// ---- image slots -----------------------------------------------------------------------------------------------------
const slotDoc = [
  '# T', '',
  '[🤖 Image Prompt #1 - Mind Map: "/handwrittennote Create a map of: A, B."]',
  '[🖼️ Paste Mind Map here]', '',
  '[Paste Screenshot here: slide 4]', '',
  '> [Paste Screenshot here: slide 9]', '',
  '```', '[Paste Screenshot here: in code]', '```', '', 'end',
].join('\n');
test('findPlaceholders ignores code blocks', () => {
  eq(plugin.findPlaceholders(slotDoc).map(p => p.kind).join(), 'prompt,paste,paste,paste');
});
test('nextPlaceholder copies the prompt, selects the slot, and wraps around', async () => {
  let sel = null;
  let copied = null;
  let cursorLine = 0;
  const editor = {
    getValue: () => slotDoc,
    getCursor: () => ({ line: cursorLine, ch: 0 }),
    setSelection: (f, t) => { sel = { f, t }; },
    scrollIntoView: () => {},
  };
  plugin.copyToClipboard = async (t) => { copied = t; return true; };
  await plugin.nextPlaceholder(editor);
  eq(copied, '/handwrittennote Create a map of: A, B.');
  eq(sel.f.line, 3);
  cursorLine = 3; await plugin.nextPlaceholder(editor); eq(sel.f.line, 5);
  cursorLine = 5; await plugin.nextPlaceholder(editor); eq(sel.f.line, 7); eq(sel.f.ch, 2, 'prefix skipped');
  cursorLine = 7; await plugin.nextPlaceholder(editor); eq(sel.f.line, 3, 'wrap');
});

// ---- audit ----------------------------------------------------------------------------------------------------------------
test('audit reports the known problem classes', () => {
  const bad = [
    '# H', '',
    '> [!example] X',
    '> $$\\begin{aligned} a &= b \\\\ \\dots &= c \\end{aligned}$$',
    '> ```mermaid', '> flowchart TD', '> ```', '',
    'This is a long English only sentence that keeps going on and on.',
    'Another long English only sentence that keeps going on and on again.',
    'Third long English only sentence that keeps going on and on again too.', '',
    'Unbalanced **bold here', '',
    'Similarly we get the rest.', '',
    '| a | b |', '| --- | --- |', '| 1 | 2 | 3 |', '',
    'text [cite: 4] leftover', '',
    '```functionplot', '---', 'title: T?', '---', 'f(x) = x % 2', '```', '',
    '$$', 'x = 1',
  ].join('\n');
  const msgs = plugin.auditText(bad).map(i => i.msg).join('\n');
  for (const re of [/skipped step/, /mermaid block inside a callout/, /English-only block \(3 lines\)/, /unbalanced \*\*/, /skip-style phrase/, /table row has 4 pipes/, /leftover \[cite\]/, /functionplot expression/, /never closed/]) {
    if (!re.test(msgs)) throw new Error('audit missed ' + re + '\n' + msgs);
  }
  if (plugin.auditText(bad).filter(i => /functionplot expression/.test(i.msg)).length !== 1) throw new Error('title line must not be flagged');
});
test('audit flags "the same way, can be done" skipped proofs (Sinhala)', () => {
  const issues = plugin.auditText('Proof of (b)\n\nProduct සහ Quotient rules වල සාධනයත් මේ ආකාරයෙන්ම සිදු කළ හැක.\n');
  if (!issues.some(i => i.line === 2 && /skip-style/.test(i.msg))) throw new Error(JSON.stringify(issues));
});
test('audit leaves a clean note alone', () => {
  const issues = plugin.auditText('# H\n\nසිංහල වාක්‍යයක්.\n\n$$x=1$$\n\n## 📍 Final Topic Map\n');
  if (issues.some(i => i.sev !== 'info')) throw new Error(JSON.stringify(issues));
});

// ---- whole-document idempotency --------------------------------------------------------------------------------------------
test('repairing a messy composite document twice changes nothing', () => {
  const doc = [
    '---', '', '## tags: [a]', 'Date: {{date:YYYY-MM-DD}}', '---', '# Title', '', '',
    '* one', '', '* two', '',
    '| a | b |', '| 1 |', ' 2 |', '',
    '> [!note] Core', '> text [cite: 2]', '>', '',
    '```mermaid', 'flowchart TD', '    A["x & y"] --> B["$z$"]', '```', '',
    '```tikz', '\\begin{document}', '\\begin{circuitikz}', '\\draw (0,0) to[R, l=$R_1$] (2,0);', '\\end{circuitikz}', '\\end{document}', '```', '',
    'Inline \\(a\\) math and **bold **.', '',
  ].join('\n');
  const once = repair(doc);
  eq(repair(once), once, 'second run changed the text');
  const second = plugin.repairText(once);
  eq(second.changed, false, 'second run reports changes');
  eq(second.summary, 'No fixes needed', 'second run summary');
});
test('repaired TikZ blocks use plain LF line endings', () => {
  hasNot(repair(fence('\\begin{circuitikz}\n\\draw (0,0) to[R] (2,0);\n\\end{circuitikz}')), '\r');
});

// ---- optional: compile the repaired TikZ with pdflatex ----------------------------------------------------------------------------------
if (process.env.TEST_LATEX) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrt-'));
  const compile = (name, body) => {
    const t = repair(fence(body));
    const m = t.match(/```tikz\r?\n([\s\S]*?)\r?\n```/);
    const file = path.join(dir, name + '.tex');
    fs.writeFileSync(file, '\\documentclass[border=2pt]{standalone}\n' + m[1].replace(/\r/g, '') + '\n');
    execSync(`pdflatex -interaction=nonstopmode -halt-on-error -output-directory "${dir}" "${file}"`, { cwd: dir, stdio: 'pipe', timeout: 120000 });
  };
  test('LaTeX: pgfplots graph compiles', () => compile('axis', '\\begin{tikzpicture}\n\\begin{axis}[xlabel={t}]\n\\addplot[blue] coordinates {(0,1) (1,3) (2,2)};\n\\end{axis}\n\\end{tikzpicture}'));
  test('LaTeX: circuit with labels compiles', () => compile('circuit', '\\begin{circuitikz}\n\\draw (0,0) to[V, l=$V_s$] (0,3) to[R, l=$R_1$] (3,3) to[R, l=R_2] (3,0) -- (0,0);\n\\end{circuitikz}'));
  test('LaTeX: library-dependent diagram compiles', () => compile('libs', '\\begin{tikzpicture}[>=Stealth]\n\\node (A) at (0,0) {A};\n\\node (B) at (4,2) {B};\n\\node at ($(A)!0.5!(B)$) {M};\n\\node[right=1cm of B] (C) {C};\n\\draw[->] (A) -- (B) -- (C);\n\\draw[decorate, decoration={brace}] (0,-1) -- (4,-1);\n\\end{tikzpicture}'));
  test('LaTeX: node text with math, % and & compiles', () => compile('nodetext', '\\begin{tikzpicture}\n\\draw (0,0) -- (2,0) node[midway, bottom] {$h$};\n\\node at (0,2) {Shift 90^\\circ, V_s = 5% and A & B, 10 \\Omega};\n\\end{tikzpicture}'));
}

// ---- report -------------------------------------------------------------------------------------------------------------------------------------
(async () => {
  await runAll();
  console.log(`${passed} passed, ${failed} failed`);
  for (const f of failures) console.log('FAIL ' + f);
  process.exit(failed ? 1 : 0);
})();
