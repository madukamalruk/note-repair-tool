# Note Repair Tool

An [Obsidian](https://obsidian.md) plugin that repairs Markdown produced by AI assistants (Gemini, ChatGPT, Claude), OCR and copy-paste, so complex study notes render correctly: tables, callouts, math, Mermaid diagrams, TikZ circuits and graphs.

It was built for a Sinhala and English engineering study workflow (see [Semester-Workflow](https://github.com/madukamalruk/Semester-Workflow)), but nothing in it is specific to that language.

## Features

| Area | What it repairs |
| --- | --- |
| **Tables** | Rows split over several lines, missing separator rows, line-wrapped pipes inside callouts |
| **Callouts** | Callouts glued to table rows or paragraphs, math lines that lost their `> ` prefix, trailing empty `>` lines, fold markers (`[!example]+`) and the `abstract`, `important`, `summary`, `tldr`, `attention` types |
| **Math** | `\( \)` and `\[ \]` (not rendered by Obsidian) converted to `$` and `$$`, single `$` multi-line blocks, `\cline` stripped by Obsidian, collapsed arrays |
| **Mermaid** | Unquoted labels, `&`, `$` and LaTeX in labels, bare `+` and `-` nodes, reversed arrows, mindmap quotes, no blank-line growth on repeated runs |
| **TikZ / Circuitikz** | Rebuilds the block for [TikZJax](https://github.com/artisticat1/obsidian-tikzjax) with a preamble derived from the diagram: `pgfplots` for `axis` graphs, automatic libraries (`calc`, `arrows.meta`, `positioning`, `decorations.pathreplacing`, ...), braces around attribute values containing `=` or `,`, `top`/`bottom` to `above`/`below`, math in node text, escaped `%` and `&`, `l=R_1` labels |
| **Functionplot** | Hallucinated `fn:` and `color:` lines, `#` comments, `<=` and `>=` |
| **Structure** | YAML frontmatter, `{{date:YYYY-MM-DD}}` filled with today's date, `---` rules, bold markers (line-local, safe), at most one blank line outside code, tight lists, code block language tags |
| **AI leaks** | `[cite: ...]` and `[cite_start]` markers removed |
| **Other** | Dataview field protection, `==highlight==` repair, YouTube links to embeds |

Everything is applied as one editor change, so a single **Ctrl+Z** undoes the whole repair.

## Commands

| Command | What it does |
| --- | --- |
| **Repair current note** (ribbon ⚡, command palette, editor menu) | Runs the full pipeline. The notice shows how many image slots are left and how many audit warnings exist |
| **Repair selected text** | Same pipeline, selection only |
| **Next image/screenshot slot** | Jumps to the next `[Paste Screenshot ...]` or `[🖼️ Paste ... here]` slot and selects it, so `Ctrl+V` replaces it. On a `[🤖 Image Prompt #N - ...: "..."]` line it copies the prompt to the clipboard and selects the paste slot below it |
| **Audit note** | Report only. Lists possible skipped steps, English-only blocks, leftover `[cite]` or date placeholders, unbalanced bold, table pipe mismatches, unsupported Functionplot syntax, code blocks inside callouts and unclosed `$$` or fences. Click an item to jump to its line |
| **Undo last editor action** | Convenience wrapper for undo |

Assign hotkeys in **Settings → Hotkeys** (search "Note Repair Tool").

## Installation

### With BRAT (recommended)

1. Install **BRAT** from Community Plugins.
2. BRAT settings → **Add Beta plugin** → `madukamalruk/note-repair-tool`.
3. Enable **Note Repair Tool**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from this repository.
2. Put them in `<vault>/.obsidian/plugins/note-repair-tool/`.
3. Reload Obsidian and enable the plugin.

## Requirements

- Obsidian 0.15.0 or newer.
- Optional, for the diagrams the plugin repairs: **TikZJax** (`obsidian-tikzjax`) and **Obsidian Functionplot**. Mermaid and MathJax are built into Obsidian.

## TikZJax notes

TikZJax only knows the packages and libraries it bundles, so the plugin only emits those: `circuitikz`, `pgfplots`, `tikz-3dplot`, `tikz-cd`, `chemfig`, `amsmath`, `amssymb`, `array`, and a set of TikZ libraries. Not available: `siunitx` and the `pgfplots` libraries `fillbetween` and `groupplots`. Details are in [docs/architecture.md](docs/architecture.md).

## Development

The plugin is a single dependency-free JavaScript file (`main.js`). A fixer is a function `fixSomething(text)` that returns the new text; `repairText` runs them in a fixed order.

```bash
npm test               # self-contained tests, no vault needed
npm run test:latex     # also compiles repaired TikZ blocks with pdflatex (needs a TeX install)
```

- [CHANGELOG.md](CHANGELOG.md): every version, V1 to V38.
- [docs/architecture.md](docs/architecture.md): pipeline order and design notes.
- [docs/prd.md](docs/prd.md) and [docs/tasks.md](docs/tasks.md): requirements and backlog.
- `archive/`: old recovery copies of `main.js`, kept for reference.

Rules for contributing a fix: add a test that fails without it, keep fixers idempotent (running twice must not change the text again), and never modify the inside of code fences unless the fixer is about that code block.

## Version

Versions are labelled `V<n>` in commit messages and the changelog; `manifest.json` uses `1.<n>.0` (V38 is `1.38.0`).

## License

No license file has been added yet. All rights reserved by the author until one is chosen.

---

Created by Maduk.
