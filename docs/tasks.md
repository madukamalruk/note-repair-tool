# Tasks

## Done
- [x] Plugin scaffolding, commands, ribbon icons, context menu, single-step undo.
- [x] Fixers: indentation, YAML, tables, Dataview conflicts, callouts, LaTeX arrays, Mermaid, highlights, bold, spacing, YouTube embeds, code block languages, Functionplot.
- [x] TikZ: safe preamble (V28), `circuitikz` fences (V29), callout prefixes (V32, V34), attribute braces (V33), `latex`/`tex` fences (V35), preamble from content and node-text fixes (V38).
- [x] AI leak cleanup, safe bold fixer, date placeholder, one-blank-line spacing (V36).
- [x] Math delimiter conversion, callout math repair, tight lists, image slot navigator, Audit command (V37).
- [x] Automated tests in the repository (`npm test`, optional `npm run test:latex`).
- [x] README, CHANGELOG and architecture rewritten for V38.

## Backlog
- [ ] Settings tab to toggle individual fixers (for example turn off YouTube embeds or YAML cleaning).
- [ ] Command "Build revision sheet from callouts": collect Exam Trap, Topper's Shortcut, Theorem and Definition callouts into one note.
- [ ] Verify `sequenceDiagram`, `stateDiagram-v2` and `block-beta` against `fixMermaid` (the `<--` rewrite may break sequence arrows).
- [ ] Keep more `\usepgfplotslibrary` entries once TikZJax support is confirmed.
- [ ] Handle `siunitx` markup (`\SI{5}{\volt}`) by rewriting it to plain math, since TikZJax has no `siunitx`.
- [ ] Optimize `fixTables` for deeply nested content (lists inside tables).
- [ ] Choose a license and submit the plugin to the Obsidian community registry.
