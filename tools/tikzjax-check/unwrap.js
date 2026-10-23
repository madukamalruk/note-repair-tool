// Extracts the real TikZJax browser script from the obsidian-tikzjax plugin bundle.
// Usage: node unwrap.js [path/to/obsidian-tikzjax/main.js]
'use strict';
const fs = require('fs');
const path = require('path');

const main = process.argv[2] || process.env.TIKZJAX_MAIN || path.join(__dirname, '..', '..', '..', 'obsidian-tikzjax', 'main.js');
const s = fs.readFileSync(main, 'utf8');
// the plugin keeps the script in a template literal named tikzjax_default
const startMarker = 'var tikzjax_default = `';
const a = s.indexOf(startMarker);
if (a < 0) throw new Error('tikzjax_default not found in ' + main);
const start = a + startMarker.length;
const end = s.indexOf('`;\n\n// main.ts', start);
if (end < 0) throw new Error('end of tikzjax_default not found');
const code = new Function('return `' + s.slice(start, end) + '`')();
fs.writeFileSync(path.join(__dirname, 'tikzjax.js'), code);
console.log('wrote tikzjax.js (' + code.length + ' chars) from ' + main);
