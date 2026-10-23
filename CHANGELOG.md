# Changelog

Versions are labelled `V<n>`; `manifest.json` uses `1.<n>.0`. Dates are commit dates. Entries before V8 predate the version labels and are grouped by theme.

## V38 (1.38.0), 2026-10-23
- **TikZ preamble from content:** `pgfplots` (plus `\pgfplotsset{compat=newest}`) is added for `\begin{axis}` and `\addplot`; libraries declared by the AI or needed by the body (`calc`, `arrows.meta`, `positioning`, `shapes.geometric`, `decorations.pathreplacing`, ...) are kept or added; only packages and libraries bundled with TikZJax are emitted. Fixes the broken-image icon for pgfplots graphs.
- `top` / `bottom` placement keys become `above` / `below`; math without `$` in node text is wrapped; `%` and `&` in node text are escaped; `l=R_1` labels are wrapped.
- **Fix (introduced in V33):** `key=$math$` was rewritten to `key={$2$}`, losing the label text. Now `key={$math$}`.
- Verified by compiling all 219 TikZ blocks of a real vault with pdflatex: 9 failed before, 0 after, no regressions.
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
