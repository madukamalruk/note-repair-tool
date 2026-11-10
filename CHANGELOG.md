# Changelog

Versions are labelled `V<n>`; `manifest.json` uses `1.<n>.0`. Dates are commit dates. Entries before V8 predate the version labels and are grouped by theme.

## V45 (1.45.0), 2026-11-10
Found by rendering `Calculus By Notebooklm` (a 17,000-line note copied from NotebookLM): 329 blocks showed raw LaTeX and 192 formulas were MathJax errors. After V45 and a hand fix of one corrupted exercise: 0 and 0 (9,441 formulas render).
- **Multi-line `\\[ ... \\]` / `\[ ... \]` blocks** whose delimiters are glued to the first and last line of content (`\\[\begin{aligned}` ... `\end{aligned}\\]`) become real `$$` blocks; the V44 healer then removes the stray `$...$` pieces inside. Row spacings such as `\\[2pt]` are left alone.
- **Mismatched delimiters on one line** (`\\( ... \\]`, `\\[ ... \\)`), a closing `\\]` followed by a stray `$`, and **`</aligned}` / `</vmatrix}`** (a mangled `\end{...}`) are repaired.
- **`>` inside wrapped math:** the exporter turned `n + 1 > \frac{a}{b}` into a line break followed by `> \frac{a}{b}`, which Markdown reads as a blockquote (the formula breaks and the rest of the paragraph is quoted). A line starting with `>` while the previous line left a `$` / `$$` formula open is joined back with ` > ` (only when the formula closes within a few lines; `$$` fences inside real callouts are never joined). 56 formulas of this note were rejoined and checked.
- **`\oiint` / `\oiiint`** (not defined in MathJax, so Obsidian shows an error box) become `\oint\!\!\!\!\oint` (and the triple form).
- `tools/vault-audit/leak.js` gained `--all` and survives a MathJax crash on a bad character.
- Across the other 238 notes of the vault V45 changes nothing compared with V44.

## V44 (1.44.0), 2026-11-09
Found by rendering the 14 notes of `MA2024 Calculus` (copied from the new lecture-note prompt) with real MathJax: Chapter 05 Questions 11-14 showed `\begin{aligned} > $\frac{...}` as raw red text.
- **Root cause, a bug that had been there for many versions:** `fixSingleDollarMathBlocks` did `replace('$', '$$')`, and in a JavaScript replacement string `'$$'` means ONE `$`, so it never changed a thing while still reporting "Fixed ... ($$ instead of $)". Block math that Gemini fenced with a lone `$` line (`> $` ... `> $`) therefore stayed broken, and the plain-text math wrapper then wrapped pieces inside it (`$\int_C F \cdot$ dr`). It now converts properly paired lone-`$` fences (also a `$$` ... `$` mismatch) to `$$`, in callouts and at the root; an unpaired lone `$` is left alone.
- **Healing of already damaged blocks (`fixDamagedDisplayMath`):** inside `$$` blocks stray `$...$` pieces are removed, rows that were glued with a literal ` > ` (after `\\`, around `\begin` / `\end`, or `$$ > ... > $$` on one line) are split again, and `P , dx` gets its `\,` back. Valid math (`x > 0`, `\text{...}`) is untouched.
- **STATUS lines:** the plain-text math wrapper no longer touches them (it had turned `Notation [\hat{i}, ..., \text{div}]` into `Notation $[\hat{i}, \nabla$, \text{div}, ...`), existing damage is healed, and the Notation list is shown literally in inline code.
- New tool `tools/vault-audit/leak.js`: renders every note with real MathJax and lists the exact line ranges where raw LaTeX shows up as plain text (`--repaired` applies the plugin first, `PLUGIN=<main.js>` compares versions).
- Result on the Calculus folder: blocks with raw LaTeX 13 before, 0 after repair (the only remaining hit is a `$$` inside a table cell, which only the test renderer cannot parse); second repair changes nothing.

## V43 (1.43.0), 2026-11-05
Audit of "TikZ diagram spins forever". All 305 ```tikz blocks of the vault were run through the real TikZJax (see `tools/tikzjax-check`): 15 failed raw and 10 after V42; after V43 all 303 remaining blocks compile (0 failures, 0 timeouts).
- **Empty / environment-less ```tikz blocks are removed** (nothing, only blank lines, or only a preamble and an empty `\begin{document}\end{document}`). TikZJax never finishes these, so they stayed an endless spinner.
- **`elmech` and `block` bipoles become `generic`** (they do not exist in the circuitikz 1.0 bundled with TikZJax: "Bipole not defined").
- **Mismatched environments:** `\begin{circuitikz} ... \end{tikzpicture}` gets the matching end; a `tikzpicture` that only wraps a `circuitikz` is unwrapped.
- **Bare commas in circuitikz label text** (`l={MFB band-pass, gain -1}`) become `{,}`; circuitikz 1.0 split them into bogus keys.
- **Prompt-style notes are left untouched:** a note that contains a longer fence (```` ) is a prompt library or documentation showing other fences and Markdown as examples. Repair used to rewrite its examples (for example a JavaScript `'\\('` became `'$'` and inline examples were split across lines in `AI_Workflows/prompts.md`); it is now skipped with a message.
- Verified: a failed block does NOT block the following blocks (a failing block is only itself a spinner), and the "TeX capacity exceeded" seen earlier in one harness run was a harness artefact (the same block renders fine on its own).
- `tools/tikzjax-check/mktests.js` skips blocks the plugin removes and works with the stubbed Obsidian API.

## V42 (1.42.0), 2026-11-04
- **NotebookLM math:** formulas exported with a doubled backslash (`\\( ... \\)` and `\\[ ... \\]`) are converted to `$ ... $` and `$$ ... $$` (inside table rows display math becomes inline). A LaTeX line break before a parenthesis inside real math (`\\` + `(c)`) is not touched.
- **NotebookLM bold:** `**A (**B**) C` (an outer bold left open by a nested pair in parentheses) is closed right after the parenthesis, so the bold no longer runs wild.
- Verified on a 4,852-line NotebookLM note: 0 formulas rendered before, 859 after (real MathJax via markdown-it), 0 MathJax errors, no raw LaTeX left in the visible text; a second repair changes nothing.

## V41 (1.41.0), 2026-11-03
- V41: Auto-unfold collapsible callouts (strip - and + fold markers so all boxes stay permanently expanded). `> [!example]- Title` and `> [!question]+ Title` become `> [!example] Title` and `> [!question] Title`, also when nested; fenced code is untouched. 311 fold markers were removed from 20 notes of the vault (originals saved first).

## V40 (1.40.0), 2026-11-03
Found by auditing a whole real vault (182 notes) and validating every formula with the real MathJax 3.2.2 (the engine family Obsidian bundles).
- **Idempotent by construction:** `repairText` now runs the pipeline until the text stops changing (at most 6 passes). Before, 18 notes needed a second or third Repair (a removed stray fence exposed an empty `>`, a fixed table exposed a callout, ...). Over the whole vault a second pass now changes nothing.
- **Data-loss bug fixed in the YAML fixer:** any `---` within the first 10 lines (a horizontal rule) was taken as the frontmatter opening; everything above it was deleted and the `#` of the headings below it was stripped. Notes without frontmatter lost their first paragraphs. Only a real frontmatter block (first non-blank line, YAML-looking body) is touched now.
- **MathJax error prevention (`fixMathJaxErrors`):** `\left{ ... \right}` becomes `\left\{ ... \right\}` (MathJax error "Missing or unrecognized delimiter"), an unescaped `%` (a TeX comment that silently cuts the formula) becomes `\%`, a bare `&` in display math without an alignment environment is wrapped in `aligned` (inline: `\&`), and spaces just inside `$ ... $` are removed. Currency such as "$5 and $10" and valid math are left alone.
- **Broken tables (`fixTableStructure`):** cells of one row on separate lines (the `| **Base** |  |  |` + orphan lines pattern) are put back together, rows cut at the wrong pipe are re-chunked to the header width, rows split by a blank line rejoin, a table that starts directly under another table gets a blank line, rows and separators inside a callout get their `> ` prefix back, trailing all-empty rows are dropped, and a raw `|` inside real math becomes `\vert` ("$2000 | $8000" money is not touched). Intentionally ragged tables are left alone.
- The old stitching pass no longer glues a complete short row (ending in `|`) to the next row.
- **Plain-text LaTeX (`fixNakedLatex`):** `I_C = \beta I_B` written without `$` in prose is wrapped (`$I_C = \beta I_B$`). Conservative: only lines without any `$`, only runs containing a known command or a short sub/superscript, never snake_case words.
- Mermaid labels: `\n` line breaks and numeric HTML entities (`&sup2;`) are no longer damaged; `[cite: ...]` removal never swallows text up to a later `]`.
- Vault result (182 notes that needed repair): empty callout gaps 1361 to 0, split or separator-less tables 8 to 0, `|` in table math 1 to 0, MathJax errors 7 to 5 (the rest are corrupted OCR formulas), no content lost.

## V39 (1.39.0), 2026-10-23
- **Stray code fence fix:** a lone ``` (for example pasted right after the YAML) opened a code block that swallowed the note and flipped every later fence, so text showed as code and diagrams broke. It is detected (an untagged fence with Markdown inside, followed by a tagged fence) and removed. Found in `EE2034 Power Systems I/22 Paper`.
- **Settings tab:** repair automatically after a large paste (on by default, 400 characters), paste size, notices on or off. One Ctrl+Z undoes an auto-repair; the cursor line is kept.
- **New command "Repair all notes in this note's folder (with backups)":** dry run, a confirmation listing the notes that would change, and a copy of every original saved in `backups/<timestamp>/` inside the plugin folder before anything is modified. A scan of one vault found 141 notes that had never been repaired.
- Audit: warns about an untagged code block that contains Markdown (stray fence); TikZ, Mermaid and Functionplot blocks inside callouts are now info instead of a warning, because they render while every line keeps its `> ` prefix.

## V38 (1.38.0), 2026-10-23
- **TikZ preamble from content:** `pgfplots` (plus `\pgfplotsset{compat=newest}`) is added for `\begin{axis}` and `\addplot`; libraries declared by the AI or needed by the body (`calc`, `arrows.meta`, `positioning`, `shapes.geometric`, `decorations.pathreplacing`, ...) are kept or added; only packages and libraries bundled with TikZJax are emitted. Fixes the broken-image icon for pgfplots graphs.
- `top` / `bottom` placement keys become `above` / `below`; math without `$` in node text is wrapped; `%` and `&` in node text are escaped; `l=R_1` labels are wrapped.
- **Fix (introduced in V33):** `key=$math$` was rewritten to `key={$2$}`, losing the label text. Now `key={$math$}`.
- **Verified against the real TikZJax engine** (circuitikz 1.0, bundled TeX): a bare `=` or `,` inside math of an option list (`l={$t=0$}`, `l={$R_1, R_2$}`) fails with "Extra }, or forgotten $" even inside braces. Such math is now rewritten to `\mathrel{=}` and `{,}`, which TikZJax accepts.
- `\textbullet`, `\textdegree`, `\textmu`, `\textohm`, `\texttimes`, `\textpm` (textcomp is not bundled and the compiler hangs) become `$\bullet$`, `$^\circ$`, `$\mu$`, `$\Omega$`, `$\times$`, `$\pm$`.
- Validation: of the 219 TikZ blocks of a real vault, 18 (in 9 notes) failed in the real TikZJax before the repair; after the repair all 219 render. The failures were pgfplots graphs without the package (3), `=` in label math (7), `decoration={brace}` without its library (4), `top`/`bottom` keys (1), math without `$` in node text (1), `pgfplots` `compat=1.18` (1, TikZJax's pgfplots does not know it, now `compat=newest`) and `\textbullet` (1).
- Repair now reports "No fixes needed" on a note that is already clean: TikZ blocks were re-emitted with CRLF line endings and Mermaid counted its own re-injected init line, so every run claimed to fix something.
- New dev tool `tools/tikzjax-check/` renders every TikZ block of a folder with the real TikZJax in a browser.
- Tests moved into the repository (`npm test`), README and docs rewritten, old recovery copies moved to `archive/`.

## V37 (1.37.0), 2026-10-22
- New command **Next image/screenshot slot**: selects the next paste slot; for ChatGPT image prompts it copies the prompt first.
- New command **Audit note**: clickable report of skipped steps, English-only blocks, leftover leaks, unbalanced bold, table pipe mismatches, unsupported Functionplot syntax, code blocks inside callouts, unclosed `$$` and fences.
- `\( \)` and `\[ \]` converted to `$` and `$$`; math lines that lost their callout prefix are re-quoted; tight lists.
- V37b: `(Source N ...)` notes and chunk-boundary lines are kept; only `[cite]` markers are removed.
- V37c: Audit also flags "same way, can be done" skipped proofs.
- The repair notice shows image slots left and audit warning count.

## V36 (1.36.0), 2026-10-22
- `[cite: ...]` markers removed; literal `{{date:YYYY-MM-DD}}` in the YAML filled with today's date.
- Safe bold fixer: line-local, skips code and math (an unbalanced `**` used to merge paragraphs, math blocks and callouts into one line).
- At most one blank line outside code; trailing empty `>` removed from callouts.
- Mermaid: `$`, bare `&` and LaTeX removed from labels, real arrows converted outside quotes, no blank-line growth on repeated runs.
- Callout regex accepts `abstract`, `important`, `summary`, `tldr`, `attention` and keeps `+` / `-` fold markers.
- Mojibake emoji strings replaced with escapes.

## V35 (1.35.0), 2026-10-20
- ` ```latex ` and ` ```tex ` blocks that contain `tikzpicture` or `circuitikz` are converted to ` ```tikz `.

## V34 (1.34.0), 2026-10-20
- TikZ in callouts: interior blockquote markers are stripped and every line is prefixed uniformly; direction keys (`i>=`, `v<=`, ...) supported in attribute wrapping.

## V33 (1.33.0), 2026-10-05 to 2026-10-06
- Braces around attribute values containing `=` or `,` in math (`l={$V=5V$}`) to stop `pgfkeys` crashes. (V33b: emoji encoding in the success notice.) *Contained the `{$2$}` bug fixed in V38.*

## V32 (1.32.0), 2026-10-04
- Keep the `> ` prefix on every TikZ body line inside callouts (fixes broken circuit images).

## V31 (1.31.0), 2026-09-28 to 2026-10-03
- Prevent Obsidian from stripping `\cline{...}` as a block attribute (V31b: replaced by `\hline`; V31c: syntax error fix).

## V30 (1.30.0), 2026-09-28
- Multi-line math blocks in callouts written with a single `$` are converted to `$$`.

## V29 (1.29.0), 2026-09-16
- ` ```circuitikz ` fences are converted to ` ```tikz `.

## V28 (1.28.0), 2026-09-16
- Always rebuild the TikZ block with a clean preamble (fixes the preamble crash loop). V26/V27 briefly stripped and restored `\usepackage{circuitikz}`.

## V25 (1.25.0), 2026-09-14
- Strip `\usepackage{tikz}` and `\textcircled` (TikZJax crashes).

## V23 to V24, 2026-09-14
- Line-wrapped trailing pipes in blockquoted tables; CRLF handling; early-return bug that discarded table fixes.

## V19 to V22, 2026-09-12 to 2026-09-13
- Functionplot: `#` comments stripped, `<=` and `>=` handled, hallucinated `fn:` / `y =` / `color:` lines normalized.
- Mermaid: unicode arrows converted outside labels (V20).
- `---` inside code blocks is no longer touched (V17/V18).

## V8 to V16, 2026-08-05
- Mermaid: transparent edge-label background (V11/V14), quoted square-bracket labels (V10), stripped `%%{init}`, blockquote prefix on closing fences inside callouts (V16, critical), reversed arrows.
- TikZ: unsupported `pattern` attributes removed, `tdplot_main_coords` replaced, idempotent rebuild (V15).
- Collapsed math arrays repaired (V13); crash caused by an undefined variable removed.

## 2026-07-28 to 2026-08-04
- Initial release (V1.0.0): table repair, YAML cleaning, callouts, Mermaid, highlights, Dataview protection, YouTube embeds.
- TikZ injection: `amsmath`, `decorations.markings`, prefix preservation.
- Embedded callout extraction; smarter table merging.
- Code block language tagging; console-style code block styling in `styles.css`.
