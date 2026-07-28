# Note Repair Tool (Obsidian Plugin)

An Obsidian plugin that automatically repairs and normalizes broken Markdown syntax, specifically tailored for issues commonly caused by AI assistants, OCR, or copy-pasting complex formats. 

## Features
- **Table Repair:** Fixes broken multiline rows and automatically injects missing table separators (`|---|---|`).
- **Mermaid Diagram Fixes:** Fixes "Unsupported markdown: list" errors in Obsidian by escaping bare `+` and `-` list markers inside nodes. Removes invisible characters and fixes internal quotes in mindmaps.
- **YAML Frontmatter Cleaning:** Cleans duplicate or broken YAML metadata headers.
- **Callout Fixes:** Extracts nested callouts from inside tables to the block level and fixes broken math blocks (`$$>`).
- **Highlight Repair:** Fixes dangling or broken highlights (`==`), explicitly ignoring code and math blocks.
- **Dataview Protection:** Wraps inline Dataview fields (`[field::value]`) in backticks to prevent formatting conflicts.
- **Formatting Cleanup:** Normalizes indentation, trims excessive empty lines, and correctly formats bold text.
- **YouTube Embeds:** Automatically converts standard Markdown YouTube links into embedded `<iframe>` videos.

## How to Install

### Using Obsidian BRAT (Recommended)
1. Install the **BRAT** plugin from the Obsidian Community Plugins.
2. Go to BRAT settings -> **Add Beta plugin**.
3. Enter the URL of this GitHub repository.
4. Enable the plugin in the Obsidian settings.

### Manual Installation
1. Go to the [Releases](#) page of this repository.
2. Download `main.js` and `manifest.json`.
3. Create a folder named `note-repair-tool` inside your `.obsidian/plugins/` directory.
4. Place the downloaded files into that folder.
5. Reload Obsidian and enable the plugin.

## Usage
Once enabled, you can repair your notes in multiple ways:
- Click the **Zap (⚡) icon** on the left ribbon to repair the entire current note.
- Select specific text, open the Command Palette (Ctrl/Cmd+P), and run **"Repair selected text"**.
- Right-click anywhere in the editor and choose **"⚡ Repair Note"**.

*This tool fully supports Obsidian's native Undo (Ctrl+Z).*

## Development
This plugin is developed using Vanilla JavaScript. The core logic relies on heavily optimized regular expressions and state-machine parsing applied across the document lines. Check the `docs/` folder for Architecture and PRD details.

---
*Created by Antigravity AI*
