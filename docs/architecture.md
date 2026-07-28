# System Architecture
**Project Name:** Note Repair Tool (Obsidian Plugin)

## 1. High-Level Overview
The Note Repair Tool is built as a standard Obsidian plugin extending the native `Plugin` class from the `obsidian` module. It heavily utilizes regex-based text processing and modular string manipulation pipelines to parse, detect, and transform malformed markdown text directly within the CodeMirror editor.

## 2. Core Components

### 2.1 Plugin Lifecycle Manager (`main.js: onload / onunload`)
- Registers UI components (Ribbon icons, Editor Context Menus).
- Registers Commands (`repair-current-note`, `repair-selection`, `undo-repair`) for the Command Palette.
- Intercepts and binds to active Markdown views to fetch editor instances.

### 2.2 Text Pipeline Orchestrator (`repairText`)
The main processing pipeline that routes the raw markdown string through a sequential series of focused "fixer" functions.
**Execution Order:**
1. `fixIndentation`: Normalizes structural spacing.
2. `fixYaml`: Cleans metadata.
3. `fixTables`: Reconstructs tables and injects separators.
4. `fixDataviewConflicts`: Sanitizes `==` and inline fields.
5. `fixCallouts`: Repairs broken math/quote boundaries.
6. `fixLatex`: Adjusts `\begin{array}` escaping.
7. `fixMermaid`: Hardens diagram nodes and syntax.
8. `fixBrokenHighlights`: Fixes unclosed highlights globally (skipping protected blocks).
9. `fixSpacing`: Compresses excessive line breaks.
10. `fixBoldFormatting`: Trims whitespaces inside `**`.
11. `fixCalloutsInTables`: Shifts table-bound callouts to block level.
12. `fixYoutubeLinks`: Transpiles links to iframes.

### 2.3 CodeMirror Integration (`repairEditor`)
- Replaces the entire document text using `editor.replaceRange()` instead of `setValue()`.
- **Reasoning:** `setValue()` destroys the native undo history stack. `replaceRange(newText, start, end)` registers as a single bulk operation, allowing the user to immediately trigger `Ctrl+Z` to revert all 12 pipelines cleanly.

## 3. Key Pipeline Modules (Regex & Parsing Strategies)

### 3.1 Table Reconstruction (`fixTables`)
Unlike standard markdown formatters, this module uses a pseudo-state machine:
- Iterates over lines and identifies potential headers (`|...|`).
- Performs a lookahead (up to 5 lines) for the `|---|` separator.
- If a separator is missing entirely, it automatically injects one based on the detected column count.
- Stitching logic merges subsequent broken lines into a single `|...|` row buffer until the target pipe count is met.

### 3.2 Diagram Hardening (`fixMermaid`)
Employs `String.prototype.replace` with callbacks (`/```mermaid([\s\S]*?)```/g`) to isolate the mermaid code from the rest of the document.
Inside the callback, it applies sub-replacements:
- Detects `mindmap` vs `graph/flowchart`.
- Mitigates Obsidian's markdown parser bleed (where Obsidian interprets `+` or `-` as lists inside a diagram) by safely string-replacing specific node signatures (`(("+"))` -> `(("Add"))`).

### 3.3 Protected Block Traversal (`fixBrokenHighlights`)
Uses a boolean state machine (`inCodeBlock`, `inMathBlock`) passing through each line to skip destructive string replacements inside sensitive code and math regions. This guarantees that `==` operators in JavaScript snippets or Equations are not accidentally transformed into highlight markers.
