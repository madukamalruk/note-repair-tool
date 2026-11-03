// Validate TeX strings with the real MathJax 3.2.2 (the version family Obsidian bundles).
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { SerializedMmlVisitor } = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined', 'boldsymbol', 'cancel', 'mhchem'] });
const html = mathjax.document('', { InputJax: tex });
const visitor = new SerializedMmlVisitor();

function check(src, display) {
  let mml;
  try {
    mml = visitor.visitTree(html.convert(src, { display: !!display, end: require('mathjax-full/js/core/MathItem.js').STATE.CONVERT }));
  } catch (e) {
    return { ok: false, msg: 'exception: ' + String(e.message).slice(0, 100) };
  }
  const err = mml.match(/data-mjx-error="([^"]*)"/);
  if (err) return { ok: false, msg: err[1] };
  const undef = mml.match(/<mtext[^>]*mathcolor="red"[^>]*>([^<]*)<\/mtext>/);
  if (undef) return { ok: false, msg: 'undefined: ' + undef[1] };
  return { ok: true };
}
module.exports = { check };
if (require.main === module) {
  for (const t of ['x^2', '\\frac{a}{b', '\\foo', 'a & b', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', '5% of x', 'R=2\\,\\Omega', '\\text{50% done}', '\\text{a & b}']) console.log(JSON.stringify(t), JSON.stringify(check(t, true)));
}
