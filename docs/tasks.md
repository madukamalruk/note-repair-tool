# Tasks and TODOs
**Project Name:** Note Repair Tool

## Completed Tasks
- [x] Create project scaffolding (manifest.json, main.js).
- [x] Register Obsidian commands and context menus.
- [x] Implement Undo stack compatibility using `replaceRange`.
- [x] Implement `fixIndentation` (Tab to Spaces).
- [x] Implement `fixYaml` (Clean duplicates and whitespace).
- [x] Implement `fixTables` (Row stitching and missing separator injection).
- [x] Implement `fixDataviewConflicts` (Wrap Dataview fields and skip highlights).
- [x] Implement `fixCallouts` and `fixCalloutsInTables` (Extract nested callouts).
- [x] Implement `fixLatex` (Pipe escaping in arrays).
- [x] Implement `fixMermaid` (Strip quotes, convert math symbols, rename `+`/`-` nodes).
- [x] Implement `fixBrokenHighlights` (Global fix, excluding code/math).
- [x] Implement `fixSpacing` and `fixBoldFormatting`.
- [x] Implement `fixYoutubeLinks` (Markdown links to Iframe embeds).

## Pending Tasks (Backlog)
- [ ] Add settings tab to allow users to toggle individual fixes (e.g., turn off YouTube embeds, or turn off YAML cleaning).
- [ ] Implement automated unit testing for regex matchers against a corpus of broken AI markdown snippets.
- [ ] Support fixing missing image links or downloading external images.
- [ ] Optimize `fixTables` to handle deeply nested markdown content (lists inside tables).
- [ ] Distribute plugin as an Obsidian Community Plugin (Submit to standard registry).
- [ ] Improve `fixMermaid` to detect other forms of markdown list bleeding inside Mermaid nodes (e.g., `*`, `>`).
