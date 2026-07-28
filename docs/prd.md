# Product Requirements Document (PRD)
**Project Name:** Note Repair Tool (Obsidian Plugin)
**Version:** 1.0.0
**Target Audience:** University students and researchers using Obsidian to take complex, AI-generated, or OCR-processed markdown notes.

## 1. Introduction
The "Note Repair Tool" is an Obsidian plugin designed to automatically repair and normalize broken Markdown syntax. AI assistants and OCR tools often produce Markdown that is slightly malformed or incompatible with Obsidian's strict rendering engine (e.g., Mermaid diagrams, Dataview blocks, LaTeX math, and Tables). This plugin aims to instantly clean and fix the currently active note or a selected text block via a single click or command.

## 2. Problem Statement
When generating complex notes containing mathematical equations, diagrams, and tables, large language models and conversion tools often output:
- Broken Markdown tables (split rows, missing separator rows).
- Invalid Mermaid syntax (trailing spaces, unescaped quotes, markdown list markers inside nodes).
- Incorrect LaTeX escaping inside arrays or callouts.
- Broken highlighting (`==`) interfering with Math/Code blocks.
- Bare YouTube links instead of embeds.
Users spend significant manual effort correcting these formatting quirks.

## 3. Core Features (Requirements)

### 3.1. One-Click Repair
- **Requirement:** The plugin must provide a ribbon icon and a command palette option to trigger the repair process on the active note.
- **Requirement:** Support repairing only a text selection without modifying the rest of the document.
- **Requirement:** Operations must be seamlessly integrated into Obsidian's native Undo stack (Ctrl+Z).

### 3.2. Data Cleansing & Normalization
- **Indentation:** Normalize tabs to spaces (4 spaces for standard markdown, 2 spaces for Mermaid blocks).
- **YAML Frontmatter:** Remove duplicate or corrupted YAML blocks, strip empty lines inside YAML, and ensure correct boundary markers (`---`).
- **Whitespace:** Condense multiple consecutive blank lines (4+) down to 3 lines.
- **Bold Text:** Fix spacing issues inside bold markers (e.g., `** text **` -> `**text**`).

### 3.3. Table Repair
- **Row Merging:** Detect and stitch table data rows that have been incorrectly broken into multiple lines.
- **Separator Injection:** Detect table headers that are missing the mandatory separator row (`|---|`) and automatically inject it.
- **Callout Extraction:** Identify Obsidian callouts (e.g., `> [!note]`) incorrectly placed inside table cells and extract them to appear as standard callouts after/before the table.

### 3.4. Diagram & Math Fixes
- **Mermaid Diagrams:**
  - Remove trailing invisible characters.
  - Remove internal double quotes `"` in mindmaps to prevent Obsidian rendering errors.
  - Safely rename bare `+` and `-` operators to `"Add"` and `"Sub"` to prevent them from being parsed as Markdown lists.
  - Convert LaTeX symbols (`\cdot`, `\times`, `\frac`) into compatible ASCII/Unicode equivalents inside node labels.
  - Escape numbered list markers (e.g., `1.`) inside labels.
- **LaTeX Math:** Fix broken pipe (`\|`) escaping in `\begin{array}` blocks.
- **Highlights (`==`):** Repair broken or unclosed highlights (`==`) while explicitly ignoring matches inside code blocks (` ``` `) and math blocks (`$$`).

### 3.5. Advanced Integrations
- **Dataview:** Protect Dataview inline fields (`[field::value]`) by wrapping them in backticks to prevent markdown conflicts.
- **YouTube Embeds:** Detect standard Markdown links pointing to YouTube and automatically convert them into `<iframe>` embeds.

## 4. Non-Functional Requirements
- **Performance:** The repair operation on a 50,000-character note should complete in under 500ms without freezing the UI.
- **Safety:** The repair process must never permanently delete meaningful user content. If a repair fails, it should fallback to the original text.
- **Undo History:** Modifications must push a single transaction to the CodeMirror history stack.

## 5. Success Metrics
- Reduction of manual formatting time per note to 0 seconds.
- 100% successful rendering of AI-generated Mermaid graphs and Tables in Obsidian.
