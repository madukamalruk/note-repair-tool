# Vault audit

Scripts used to validate the plugin against a real vault. They never modify your notes.

```bash
cd tools/vault-audit
npm install --no-save mathjax-full@3.2.2 markdown-it markdown-it-mathjax3   # real MathJax (the family Obsidian bundles) and a renderer

node leak.js     "<folder>" [--repaired]     # renders every note and lists the exact line ranges where raw LaTeX shows up
                                             # as plain text (math Obsidian cannot parse); --repaired applies the plugin first;
                                             # PLUGIN=<path to another main.js> compares plugin versions
node discover.js "<vault folder>"            # defects found in the notes as they are
node dryrun.js   "<vault folder>"            # repairs every note in memory, writes the result to ./mirror,
                                             # and checks idempotency (a second pass must change nothing)
node compare.js  "<vault folder>"            # words lost, fence counts changed (original vs ./mirror)
node discover.js "$(pwd)/mirror"             # defects left after the repair
```

## What `discover.js` reports

| Category | Meaning |
| --- | --- |
| `math-error` | A formula MathJax cannot render (checked with the real MathJax: yellow error box) |
| `math-percent` | An unescaped `%` in math (a TeX comment: the rest of the line is lost) |
| `inline-space` | A space just inside `$ ... $` |
| `table-cells`, `table-split`, `table-no-separator`, `table-callout-prefix`, `table-pipe-in-math` | Broken, split or ragged tables |
| `empty-callout-tail` | An empty `>` line that leaves a gap box at the end of a callout |
| `callout-math-prefix`, `math-unclosed` | Callout math lines without `> `, unclosed `$$` |

## How V40 was validated (182 notes)

- Second pass over the repaired vault changes nothing (idempotent).
- `compare.js` found two data-loss bugs while building V40 (the YAML fixer deleting the first paragraphs of notes, and the Mermaid `\n` / `&sup2;` handling); both are fixed and covered by tests.
- Remaining differences are intended (for example `\textbullet` replaced by `$\bullet$`, a rebuilt TikZ preamble).

The generated `mirror/` and `findings*.json` are ignored by git.
