// Prints the failures (with the TeX error and line) of the newest result_*.json.
'use strict';
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => /^result_\d+\.json$/.test(f)).sort();
if (!files.length) { console.error('no result file yet'); process.exit(1); }
const results = JSON.parse(fs.readFileSync(path.join(__dirname, files[files.length - 1]), 'utf8'));
const tests = JSON.parse(fs.readFileSync(path.join(__dirname, 'tests.json'), 'utf8'));
const failed = results.filter(r => !r.ok).sort((a, b) => Number(a.id) - Number(b.id));
console.log(results.length + ' blocks, ' + failed.length + ' failed');
for (const r of failed) {
  const t = tests.find(x => String(x.id) === String(r.id));
  const log = r.log.join('\n');
  const err = (log.match(/^! .*$/m) || [''])[0];
  const ctx = (log.match(/^l\.\d+ .*$/m) || [''])[0];
  console.log('FAIL #' + r.id + ' ' + t.file + ':' + t.line + ' (' + r.why + ') ' + err + ' ' + ctx);
}
process.exit(failed.length ? 1 : 0);
