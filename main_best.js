const { Plugin, Notice, MarkdownView } = require('obsidian');

module.exports = class NoteRepairToolPlugin extends Plugin {
  async onload() {
    console.log('Loading Note Repair Tool Plugin...');

    this.addRibbonIcon('zap', 'Note Repair Tool: Fix Current Note', (evt) => {
      this.repairCurrentNote();
    });

    this.addCommand({
      id: 'repair-current-note',
      name: 'Repair current note (Fix tables, YAML, Mermaid, Callouts)',
      editorCallback: (editor, view) => {
        this.repairEditor(editor);
      }
    });

    this.addCommand({
      id: 'repair-selection',
      name: 'Repair selected text',
      editorCallback: (editor, view) => {
        const selection = editor.getSelection();
        if (selection && selection.trim()) {
          const result = this.repairText(selection);
          if (result.changed) {
            editor.replaceSelection(result.text);
            new Notice(`⚡ Repaired Selection: ${result.summary}`);
          } else {
            new Notice('✨ Selected text is already clean!');
          }
        } else {
          new Notice('Please select text first!');
        }
      }
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item
            .setTitle('⚡ Repair Note (Fix Tables & Formatting)')
            .setIcon('zap')
            .onClick(() => {
              this.repairEditor(editor);
            });
        });
      })
    );
  }

  onunload() {
    console.log('Unloading Note Repair Tool Plugin...');
  }

  repairCurrentNote() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      this.repairEditor(activeView.editor);
    } else {
      new Notice('No active markdown note open!');
    }
  }

  repairEditor(editor) {
    const content = editor.getValue();
    if (!content || !content.trim()) {
      new Notice('Note is empty!');
      return;
    }

    const result = this.repairText(content);
    if (result.changed) {
      editor.setValue(result.text);
      new Notice(`⚡ Note Repaired!\n${result.summary}`, 5000);
    } else {
      new Notice('✨ Note is already clean! No issues found.', 3000);
    }
  }

  repairText(rawText) {
    let text = rawText;
    let changes = [];

    // NOTE: removePreamble is intentionally excluded to prevent accidental deletion
    // of important content. Manual cleanup is preferred for conversational lines.

    const yamlRes = this.fixYaml(text);
    text = yamlRes.text;
    if (yamlRes.fixed) {
      changes.push('Fixed YAML Frontmatter');
    }

    const tableRes = this.fixTables(text);
    text = tableRes.text;
    if (tableRes.mergedRows > 0) {
      changes.push(`Merged ${tableRes.mergedRows} split table rows`);
    }

    const dataviewRes = this.fixDataviewConflicts(text);
    text = dataviewRes.text;
    if (dataviewRes.fixedCount > 0) {
      changes.push(`Fixed ${dataviewRes.fixedCount} Dataview conflicts in tables`);
    }

    const calloutRes = this.fixCallouts(text);
    text = calloutRes.text;
    if (calloutRes.fixedCount > 0) {
      changes.push(`Fixed ${calloutRes.fixedCount} callout math blocks`);
    }

    const latexRes = this.fixLatex(text);
    text = latexRes.text;
    if (latexRes.fixedCount > 0) {
      changes.push(`Fixed ${latexRes.fixedCount} LaTeX formatting issues`);
    }

    const mermaidRes = this.fixMermaid(text);
    text = mermaidRes.text;
    if (mermaidRes.fixedCount > 0) {
      changes.push(`Fixed ${mermaidRes.fixedCount} Mermaid diagram issues`);
    }

    const highlightRes = this.fixBrokenHighlights(text);
    text = highlightRes.text;
    if (highlightRes.fixedCount > 0) {
      changes.push(`Fixed ${highlightRes.fixedCount} broken highlight marks`);
    }

    text = this.fixSpacing(text);

    const isChanged = text !== rawText;
    const summaryStr = changes.length > 0 ? changes.join(' | ') : 'No fixes needed';

    return {
      text: text,
      changed: isChanged,
      summary: summaryStr
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  countPipes(str) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '|' && (i === 0 || str[i - 1] !== '\\')) {
        count++;
      }
    }
    return count;
  }

  isSeparatorRow(line) {
    let t = line.trim();
    if (!t.startsWith('|')) return false;
    return /^\|?[\s:|-]+\|?$/.test(t) && t.includes('-');
  }

  isHeaderRow(line) {
    let t = line.trim();
    return t.startsWith('|') && this.countPipes(t) >= 2;
  }

  // Splits a table row into cells safely, without dropping last cell
  // when the trailing pipe is missing (common in broken/split rows).
  splitCells(line) {
    let parts = line.split('|');
    if (parts.length && parts[0].trim() === '') parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
    return parts.map(c => c.trim()).filter(c => c !== '');
  }

  // ─── Fixers ────────────────────────────────────────────────────────────────

  /**
   * Fix YAML frontmatter:
   * - Removes heading markers (e.g. "# title:") accidentally placed inside YAML.
   * - Removes empty lines inside the YAML block.
   * - Ensures YAML starts at line 0.
   */
  fixYaml(text) {
    let lines = text.split('\n');
    let openIdx = -1;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      if (lines[i].trim() === '---') {
        openIdx = i;
        break;
      }
    }

    if (openIdx === -1) return { text, fixed: false };

    let closeIdx = -1;
    for (let i = openIdx + 1; i < Math.min(lines.length, 25); i++) {
      if (lines[i].trim() === '---') {
        closeIdx = i;
        break;
      }
    }

    if (closeIdx === -1) return { text, fixed: false };

    let yamlBody = lines.slice(openIdx + 1, closeIdx);
    let changed = false;
    let cleanBody = [];

    for (let l of yamlBody) {
      let t = l.trim();
      if (t === '') { changed = true; continue; }
      let stripped = l.replace(/^#+\s*/, '');
      if (stripped !== l) changed = true;
      cleanBody.push(stripped);
    }

    if (openIdx > 0) changed = true;

    if (!changed) return { text, fixed: false };

    let result = ['---', ...cleanBody, '---', ...lines.slice(closeIdx + 1)].join('\n');
    return { text: result, fixed: true };
  }

  /**
   * Fix broken tables:
   * - Merges split rows (rows whose pipe count is less than the header row).
   * - Removes <br> tags that break table rendering.
   * - Skips fully-empty rows (artefacts).
   */
  fixTables(text) {
    let lines = text.split('\n');
    let out = [];
    let mergedRows = 0;
    let i = 0;

    while (i < lines.length) {
      let line = lines[i];

      if (this.isHeaderRow(line) && lines[i + 1] !== undefined && this.isSeparatorRow(lines[i + 1])) {
        let realHeaders = this.splitCells(line);
        let numCols = realHeaders.length;
        let targetPipeCount = numCols + 1;

        let newHeader = '| ' + realHeaders.join(' | ') + ' |';
        let newSep = '| ' + Array(numCols).fill('---').join(' | ') + ' |';

        out.push(newHeader);
        out.push(newSep);
        i += 2;

        while (i < lines.length) {
          let peek = lines[i];
          let t = peek.trim();

          if (t.startsWith('#') || t.startsWith('```') || t.startsWith('---')) break;

          if (t === '') {
            let nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
            if (!nextLine.startsWith('|')) break;
            i++;
            continue;
          }

          let cells = this.splitCells(t);
          while (cells.length > numCols && cells[cells.length - 1] === '') cells.pop();

          // Skip fully-empty placeholder rows
          if (cells.filter(c => c !== '').length === 0) {
            mergedRows++;
            i++;
            continue;
          }

          let rowBuffer = '| ' + cells.join(' | ') + ' |';
          let j = i + 1;

          // Merge continuation lines until we have enough pipes
          while (this.countPipes(rowBuffer) < targetPipeCount && j < lines.length) {
            let nextT = lines[j].trim();
            if (nextT.startsWith('#') || nextT.startsWith('```') || nextT.startsWith('---')) break;
            if (nextT !== '') {
              let nextTClean = nextT.replace(/<br\s*\/?>$/i, '').trim();
              if (nextTClean.startsWith('|')) {
                if (this.countPipes(nextTClean) >= targetPipeCount) break;
                cells.push(...this.splitCells(nextTClean));
              } else {
                if (cells.length > 0) cells[cells.length - 1] += ' ' + nextTClean;
                else cells.push(nextTClean);
              }
              rowBuffer = '| ' + cells.join(' | ') + ' |';
              mergedRows++;
            }
            j++;
          }

          out.push(rowBuffer);
          i = j > i + 1 ? j : i + 1;
        }
        continue;
      }

      out.push(line);
      i++;
    }

    return { text: out.join('\n'), mergedRows };
  }

  /**
   * Fix Dataview plugin conflicts inside Markdown tables.
   *
   * Obsidian's Dataview plugin interprets certain patterns inside table cells
   * as inline fields and throws a "PARSING FAILED" error if the value is not
   * valid Dataview syntax. The most common offenders are:
   *
   *   ==          (equality operator in a math/comparison table)
   *   [key:: val] (explicit inline field syntax)
   *   (value)     (sometimes misread as a Dataview expression)
   *
   * Fix: wrap the problematic token in a backtick span so Dataview ignores it.
   */
  fixDataviewConflicts(text) {
    let fixedCount = 0;
    let lines = text.split('\n');
    let inTable = false;

    let out = lines.map(line => {
      let t = line.trim();

      // Detect table rows
      if (t.startsWith('|') && this.countPipes(t) >= 2) {
        inTable = true;
      } else if (inTable && !t.startsWith('|')) {
        inTable = false;
      }

      if (!inTable || !t.startsWith('|')) return line;

      // Skip separator rows
      if (this.isSeparatorRow(line)) return line;

      let modified = line;

      // Fix bare == operator (not already in backticks or LaTeX)
      modified = modified.replace(/(?<!`|\\|\$)={2}(?!`|=)/g, (match, offset, str) => {
        // Don't touch if already inside backticks or math
        let before = str.slice(0, offset);
        let backtickCount = (before.match(/`/g) || []).length;
        let dollarCount = (before.match(/\$/g) || []).length;
        if (backtickCount % 2 !== 0 || dollarCount % 2 !== 0) return match;
        fixedCount++;
        return '`==`';
      });

      // Fix explicit Dataview inline field syntax [key:: value] in a cell
      modified = modified.replace(/\[([^\]]+)::([^\]]+)\]/g, (match) => {
        fixedCount++;
        return '`' + match + '`';
      });

      return modified;
    });

    return { text: out.join('\n'), fixedCount };
  }

  /**
   * Fix callout blocks that have math rendered incorrectly.
   * e.g. "$$> ..." and "> $$" patterns that break inside callouts.
   */
  fixCallouts(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.includes('$$>') || line.includes(' >$$')) {
        line = line.replace(/\$\$>\s*/g, '$$\n> ');
        line = line.replace(/\s*>\$\$/g, '\n> $$');
        line = line.replace(/\s*>\s*\\\\/g, ' \\\\');
        fixedCount++;
      }

      // Remove consecutive duplicate blockquote-only lines ("> " spam)
      if (line.trim() === '>' && out.length > 0 && out[out.length - 1].trim() === '>') {
        fixedCount++;
        continue;
      }

      out.push(line);
    }

    return { text: out.join('\n'), fixedCount };
  }

  /**
   * Fix LaTeX issues specific to Obsidian rendering:
   *
   * 1. Escaped pipes inside \begin{array} column specifiers.
   *    Gemini often outputs \begin{array}{ccc\|c} instead of {ccc|c}.
   *    This renders as a double line or fails entirely in MathJax.
   *
   * 2. Bare LaTeX delimiters inside table cells (e.g. a single $ without closing)
   *    which cause the rest of the table to render as math.
   */
  fixLatex(text) {
    let fixedCount = 0;

    // Fix \| inside \begin{array}{...} column specs
    const fixed = text.replace(/\\begin\{array\}\{([^}]*)\}/g, (match, spec) => {
      if (spec.includes('\\|')) {
        fixedCount++;
        return match.replace(/\\\|/g, '|');
      }
      return match;
    });

    return { text: fixed, fixedCount };
  }

  /**
   * Fix Mermaid diagram syntax errors:
   *
   * 1. Unquoted edge labels: -->|text| → -->|"text"|
   *    (Strict renderers crash without quotes on multi-word or special labels.)
   *
   * 2. Bare math operators in node labels: ((+)) → (("+")), ((-)) → (("-"))
   *    (Mermaid crashes on bare +, -, *, / inside double-parenthesis nodes.)
   *
   * 3. LaTeX inside Mermaid (unsupported) — replace with Unicode equivalents:
   *    \cdot → ·, \times → ×, \frac{a}{b} → a/b
   */
  fixMermaid(text) {
    let fixedCount = 0;
    let mermaidRegex = /```mermaid([\s\S]*?)```/g;

    let fixedText = text.replace(mermaidRegex, (match, code) => {
      let lines = code.split('\n');
      let fixedLines = lines.map(line => {
        let l = line;

        // Fix named Sum nodes with operators
        if (/Sum\(\(\s*[\+\-\*\/]\s*\)\)/.test(l)) {
          l = l.replace(/Sum\(\(\s*\+\s*\)\)/g, 'Sum(("Add"))');
          l = l.replace(/Sum\(\(\s*\-\s*\)\)/g, 'Sum(("Sub"))');
          fixedCount++;
        }

        // Fix any node with bare operator: word((+)) → word(("+")))
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*([\+\-\*\/])\s*\)\)/g, '$1(("$2"))');

        // Fix unquoted edge labels
        l = l.replace(/-->\s*\|([^"|\n]+)\|/g, (m, label) => {
          let trimmed = label.trim();
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) return m;
          fixedCount++;
          return `-->|"${trimmed}"|`;
        });

        // Replace LaTeX in Mermaid with Unicode (LaTeX not supported in Mermaid)
        if (l.includes('\\cdot') || l.includes('\\times') || l.includes('\\frac')) {
          l = l.replace(/\\cdot/g, '·');
          l = l.replace(/\\times/g, '×');
          l = l.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2');
          fixedCount++;
        }

        return l;
      });

      return '```mermaid' + fixedLines.join('\n') + '```';
    });

    return { text: fixedText, fixedCount };
  }

  /**
   * Fix broken ==highlight== marks.
   *
   * Obsidian uses ==text== for yellow highlights. Gemini sometimes outputs
   * a single = or mismatched markers which break the highlight and render
   * as raw text or cause unexpected bold/italic bleed-through.
   *
   * Fixes: lone = not part of == in running prose, and unclosed == pairs.
   */
  fixBrokenHighlights(text) {
    let fixedCount = 0;

    // Count == occurrences per line; if odd count (unclosed), close the last one
    let lines = text.split('\n');
    let out = lines.map(line => {
      // Skip code blocks and math
      if (line.trim().startsWith('```') || line.trim().startsWith('$$')) return line;

      // Count standalone == tokens (not === or !==)
      let matches = line.match(/(?<![=!<>])={2}(?!=)/g);
      if (matches && matches.length % 2 !== 0) {
        // Odd number of == means one is unclosed — append closing ==
        line = line + '==';
        fixedCount++;
      }
      return line;
    });

    return { text: out.join('\n'), fixedCount };
  }

  /**
   * General spacing cleanup:
   * - Collapses 4+ consecutive blank lines to 3 max (keeps sections readable).
   *
   * NOTE: The old fixSpacing regex that injected "---" separators before
   * certain Sinhala phrases has been intentionally removed. It was causing
   * sentences to be split mid-word and creating phantom horizontal rules.
   */
  fixSpacing(text) {
    return text.replace(/\n{4,}/g, '\n\n\n');
  }
};
