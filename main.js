const { Plugin, Notice, MarkdownView, Modal } = require('obsidian');

// V37: clickable audit report
class AuditModal extends Modal {
  constructor(app, editor, issues) {
    super(app);
    this.editor = editor;
    this.issues = issues;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Note audit' });
    const real = this.issues.filter(x => x.sev !== 'info').length;
    contentEl.createEl('p', { text: real + ' warnings/errors, ' + (this.issues.length - real) + ' info items. Click a line to jump to it.' });
    const icons = { error: '\u274C', warn: '\u26A0\uFE0F', info: '\u2139\uFE0F' };
    for (const sev of ['error', 'warn', 'info']) {
      const group = this.issues.filter(x => x.sev === sev);
      if (group.length === 0) continue;
      contentEl.createEl('h4', { text: icons[sev] + ' ' + sev.toUpperCase() + ' (' + group.length + ')' });
      for (const it of group) {
        const row = contentEl.createEl('div', { text: 'Line ' + (it.line + 1) + ': ' + it.msg + (it.snippet ? '  \u2014  ' + it.snippet : '') });
        row.style.cursor = 'pointer';
        row.style.padding = '2px 0';
        row.addEventListener('click', () => {
          const pos = { line: it.line, ch: 0 };
          this.editor.setCursor(pos);
          this.editor.scrollIntoView({ from: pos, to: pos }, true);
          this.close();
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class NoteRepairToolPlugin extends Plugin {
  async onload() {
    console.log('Loading Note Repair Tool Plugin V37...');

    this.addRibbonIcon('zap', 'Note Repair Tool: Fix Current Note', (evt) => {
      this.repairCurrentNote();
    });

    this.addRibbonIcon('rotate-ccw', 'Note Repair Tool: Undo Last Fix', (evt) => {
      this.undoLastAction();
    });

    this.addCommand({
      id: 'repair-current-note',
      name: 'Repair current note (Fix tables, YAML, Mermaid, Callouts, Spacing)',
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
            // Replace selection preserves undo history automatically
            editor.replaceSelection(result.text);
            new Notice(`\u26A1 Repaired Selection: ${result.summary}`);
          } else {
            new Notice('\u2728 Selected text is already clean!');
          }
        } else {
          new Notice('Please select text first!');
        }
      }
    });

    this.addCommand({
      id: 'undo-repair',
      name: 'Undo last editor action',
      editorCallback: (editor, view) => {
        if (editor.undo) {
          editor.undo();
          new Notice('\u21A9\uFE0F Undid last action');
        } else {
          new Notice('Cannot undo natively in this view.');
        }
      }
    });

    this.addCommand({
      id: 'next-placeholder',
      name: 'Next image/screenshot slot (copies the ChatGPT prompt, selects the paste slot)',
      editorCallback: (editor, view) => {
        this.nextPlaceholder(editor);
      }
    });

    this.addCommand({
      id: 'audit-note',
      name: 'Audit note (find skipped steps, language drift, leaks, broken blocks)',
      editorCallback: (editor, view) => {
        this.showAudit(editor);
      }
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item
            .setTitle('\u26A1 Repair Note (Fix Formatting)')
            .setIcon('zap')
            .onClick(() => {
              this.repairEditor(editor);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('\u21A9\uFE0F Undo Last Action')
            .setIcon('rotate-ccw')
            .onClick(() => {
              if (editor.undo) {
                editor.undo();
                new Notice('\u21A9\uFE0F Undid last action');
              }
            });
        });
      })
    );
  }

  onunload() {
    console.log('Unloading Note Repair Tool Plugin...');
  }

  undoLastAction() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      if (activeView.editor.undo) {
        activeView.editor.undo();
        new Notice('\u21A9\uFE0F Undid last action');
      }
    } else {
      new Notice('No active markdown note open!');
    }
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
      // V3 FIX: Instead of editor.setValue() which breaks the undo history,
      // we use replaceRange to replace the entire document content.
      // This pushes the change to the native CodeMirror Undo stack, 
      // allowing Ctrl+Z or our Undo button to revert the whole fix instantly.
      const lastLine = editor.lastLine();
      const lastLineLength = editor.getLine(lastLine).length;
      
      editor.replaceRange(
        result.text,
        { line: 0, ch: 0 },
        { line: lastLine, ch: lastLineLength }
      );
      
      new Notice(`\u26A1 Note Repaired!\n${result.summary}${this.statusSuffix(editor)}`, 7000);
    } else {
      new Notice(`\u2714 Note is already clean!${this.statusSuffix(editor)}`, 5000);
    }
  }

  repairText(rawText) {
    let text = rawText;
    let changes = [];

    const track = (label, res, condition) => {
      if (condition) { text = res.text !== undefined ? res.text : text; changes.push(label); }
    };

    // 1. Normalize CRLF → LF
    const indentRes = this.fixIndentation(text);
    text = indentRes.text;
    if (indentRes.fixedCount > 0) changes.push('Fixed Indentation/Spacing');

    // 1b. V36: strip AI source/citation leaks and pasted chunk-boundary lines
    const leakRes = this.fixLeaks(text);
    if (leakRes.fixedCount > 0) { text = leakRes.text; changes.push(`Removed ${leakRes.fixedCount} cite/source/chunk leaks`); }

    // 1c. V37: \( \) and \[ \] math delimiters do not render in Obsidian
    const mathDelimRes = this.fixMathDelimiters(text);
    if (mathDelimRes.fixedCount > 0) { text = mathDelimRes.text; changes.push('Converted \\( \\) / \\[ \\] math to $ / $$'); }

    // 2. YAML fixes (blank line after YAML, cleanup)
    const yamlRes = this.fixYaml(text);
    if (yamlRes.fixed) { text = yamlRes.text; changes.push('Fixed YAML Frontmatter'); }

    // 2b. V36: fill the literal {{date:YYYY-MM-DD}} placeholder
    const dateRes = this.fixDatePlaceholder(text);
    if (dateRes.fixed) { text = dateRes.text; changes.push('Filled date placeholder'); }

    // 2.5 Horizontal Rules (prevent Setext H2 issues with tables)
    const hrRes = this.fixHorizontalRules(text);
    if (hrRes.fixed) { text = hrRes.text; changes.push('Spaced horizontal rules'); }

    // 3. Tables (ONE pass only — bug fix: was running twice)
    const tableRes = this.fixTables(text);
    if (tableRes.mergedRows > 0) { text = tableRes.text; changes.push(`Merged ${tableRes.mergedRows} split table rows`); }

    // 4. Embedded callouts (extract callouts stuck inside table rows / paragraph prefixes)
    const embedCalloutRes = this.fixEmbeddedCallouts(text);
    if (embedCalloutRes.fixed) { text = embedCalloutRes.text; changes.push('Extracted embedded callouts'); }

    // 5. Dataview inline conflicts
    const dataviewRes = this.fixDataviewConflicts(text);
    if (dataviewRes.fixedCount > 0) { text = dataviewRes.text; changes.push('Fixed Dataview conflicts'); }

    // 6. Callout math/LaTeX prefix repair
    const calloutRes = this.fixCallouts(text);
    if (calloutRes.fixedCount > 0) { text = calloutRes.text; changes.push(`Fixed ${calloutRes.fixedCount} callout math blocks`); }

    // 6b. V37: re-prefix math lines inside callouts that lost their '> '
    const calloutMathRes = this.fixCalloutMath(text);
    if (calloutMathRes.fixedCount > 0) { text = calloutMathRes.text; changes.push(`Re-quoted ${calloutMathRes.fixedCount} math lines inside callouts`); }

    // 7. LaTeX array environments
    const latexRes = this.fixLatex(text);
    if (latexRes.fixedCount > 0) { text = latexRes.text; changes.push('Fixed LaTeX arrays'); }

    // 8. Mermaid diagram prefix repair
    const mermaidRes = this.fixMermaid(text);
    if (mermaidRes.fixedCount > 0) { text = mermaidRes.text; changes.push('Fixed Mermaid diagrams'); }

    // 9. Broken ==highlights==
    const highlightRes = this.fixBrokenHighlights(text);
    if (highlightRes.fixedCount > 0) { text = highlightRes.text; changes.push('Fixed broken highlights'); }

    // 10. TikZ package injection
    const tikzRes = this.fixTikz(text);
    if (tikzRes.fixedCount > 0) { text = tikzRes.text; changes.push('Fixed TikZ diagrams'); }

    // 10b. Collapsed Math arrays (e.g. \cline inside blockquotes collapsed to one line)
    const collapsedMathRes = this.fixCollapsedMath(text);
    if (collapsedMathRes.fixedCount > 0) { text = collapsedMathRes.text; changes.push('Repaired collapsed LaTeX math arrays'); }

    // 10c. Fix single $ used for multiline math blocks inside blockquotes
    const singleDollarRes = this.fixSingleDollarMathBlocks(text);
    if (singleDollarRes.fixedCount > 0) { text = singleDollarRes.text; changes.push('Fixed blockquote multi-line math block enclosures ($$ instead of $)'); }

    // 10d. Fix Obsidian block attribute stripping for \cline
    const blockAttrRes = this.fixMathJaxBlockAttributes(text);
    if (blockAttrRes.fixedCount > 0) { text = blockAttrRes.text; changes.push('Prevented Obsidian from stripping \\cline parameters'); }

    // 11. Bold marker repair
    const boldRes = this.fixBoldFormatting(text);
    if (boldRes.fixed) { text = boldRes.text; changes.push('Fixed broken bold markers'); }

    // 12. Code block language tagging (Matlab/Python label → ```matlab tag)
    const codeLangRes = this.fixCodeBlockLanguages(text);
    if (codeLangRes.fixed) { text = codeLangRes.text; changes.push('Added syntax highlighting tags'); }

    // 13. YouTube link embedding
    const ytRes = this.fixYoutubeLinks(text);
    if (ytRes.fixed) { text = ytRes.text; changes.push('Converted YouTube links to embeds'); }

    // 14. Fix functionplot/chart blocks broken by previous hr fix
    const functionplotRes = this.fixFunctionPlotBlocks(text);
    if (functionplotRes.fixed) { text = functionplotRes.text; changes.push('Fixed graph code blocks'); }

    // 17. V37: tight lists (no blank line between consecutive items)
    const looseRes = this.fixLooseLists(text);
    if (looseRes.fixedCount > 0) { text = looseRes.text; changes.push('Tightened lists'); }

    // 18. Global spacing pass (final polish)
    text = this.fixSpacing(text);

    return {
      text: text,
      changed: text !== rawText,
      summary: changes.length > 0 ? changes.join(' | ') : 'No fixes needed'
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  fixFunctionPlotBlocks(text) {
    let original = text;
    // Auto-heal the bug from V17 that squashed them into ```functionplot---
    // Capture any blockquote prefix (like "> ") to ensure the new line keeps it.
    text = text.replace(/^([\t >]*)```functionplot\s*---/gm, '$1```functionplot\n$1---');

    // Remove blank lines immediately after ```functionplot and before ---
    text = text.replace(/^([\t >]*)```functionplot\s*\n\s*\n\s*---/gm, '$1```functionplot\n$1---');
    
    // In functionplot blocks, we want to remove the blank lines around --- if they were added.
    text = text.replace(/```functionplot([\s\S]*?)```/g, (match, inner) => {
      // Remove blank lines before and after ---
      let newInner = inner.replace(/\n\s*\n\s*---\s*\n\s*\n/g, '\n---\n');
      
      // If it starts with space/newline then --- then space/newline, normalize to just \n---\n
      newInner = newInner.replace(/^\s*---\s*\n\s*\n/g, '\n---\n');
      newInner = newInner.replace(/^\s*---\s*\n/g, '\n---\n');
      
      // If it ends with ---
      newInner = newInner.replace(/\n\s*\n\s*---\s*$/g, '\n---\n');
      
        // V19 & V21 & V22 Fixes: Clean up the function section (everything after the second ---)
        let parts = newInner.split('---');
        if (parts.length >= 3) {
          // parts[0] is before first ---, parts[1] is YAML, parts[2] and beyond is the function section
          let funcSection = parts.slice(2).join('---');
          
          let lines = funcSection.split('\n');
          let fIndex = 0;
          let funcLetters = 'fghpqrst';
          
          let cleanedLines = lines.filter(line => {
            let trimmed = line.replace(/^[\t >]*/, '').trim();
            // Remove comments and hallucinated 'color: red' lines which crash the parser
            if (trimmed.startsWith('#') || trimmed.startsWith('//')) return false;
            if (trimmed.match(/^color\s*:/i)) return false;
            return true;
          }).map(line => {
            // V21 Fix: Prevent parser crash on `<=` and `>=`
            let modLine = line.replace(/<=/g, '< ').replace(/>=/g, '> ');
            
            // V22 Fix: LLMs hallucinate `fn: sin(x)` or `y = sin(x)`. Convert to `f(x) = sin(x)`.
            let trimmed = modLine.replace(/^[\t >]*/, '').trim();
            if (trimmed.match(/^fn\s*:/i) || trimmed.match(/^y\s*=/i)) {
               let expr = trimmed.replace(/^(fn\s*:|y\s*=)\s*/i, '');
               let prefix = modLine.substring(0, modLine.indexOf(trimmed)); // keep blockquote prefix
               let letter = funcLetters[fIndex % funcLetters.length];
               fIndex++;
               return prefix + letter + '(x) = ' + expr;
            }
            
            // Increment fIndex if it's already a valid function like g(x) =
            if (trimmed.match(/^[a-zA-Z]\(x\)\s*=/)) {
               fIndex++;
            }
            
            return modLine;
          });
          
          parts[2] = cleanedLines.join('\n');
          newInner = parts[0] + '---' + parts[1] + '---' + parts.slice(2).join('---');
        }
        
        return '```functionplot' + newInner + '```';
      });
    
    return { text, fixed: text !== original };
  }

  fixCodeBlockLanguages(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;

    // Mermaid diagram first-line keywords
    const mermaidKeywords = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|gantt|pie|erDiagram|journey|gitGraph|mindmap|timeline|quadrantChart|xychart-beta)/i;
    // TikZ / LaTeX diagram indicators
    const tikzKeywords = /^\\begin\{tikzpicture\}|^\\begin\{circuitikz\}/i;

    // Labels that hint the following code block is Matlab
    const matlabLabelRegex = /^(Matlab|Code snippet)$/i;
    // Labels that hint Python
    const pythonLabelRegex = /^Python$/i;
    // Labels that hint C/C++
    const cppLabelRegex = /^C\+\+$/i;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Check if current line is a language hint label
      let hintedLang = null;
      if (matlabLabelRegex.test(line.trim())) hintedLang = 'matlab';
      else if (pythonLabelRegex.test(line.trim())) hintedLang = 'python';
      else if (cppLabelRegex.test(line.trim())) hintedLang = 'cpp';

      if (hintedLang !== null) {
        // Find the next non-empty line
        let nextIdx = i + 1;
        while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;

        // Check if the next non-empty line opens an untagged code block
        if (nextIdx < lines.length && lines[nextIdx].trim() === '```') {
          // Peek at the first content line of the block to detect mermaid/tikz
          let contentIdx = nextIdx + 1;
          let firstContent = contentIdx < lines.length ? lines[contentIdx].trim() : '';

          if (mermaidKeywords.test(firstContent)) {
            // It's a mermaid diagram — tag as mermaid, not matlab
            lines[nextIdx] = '```mermaid';
            fixedCount++;
          } else if (tikzKeywords.test(firstContent)) {
            // It's a TikZ diagram — leave untagged (tikzjax needs no tag)
            // do nothing
          } else {
            // Safe to apply the hinted language
            lines[nextIdx] = '```' + hintedLang;
            fixedCount++;
          }
        }
      }

      out.push(line);
    }

    return { text: out.join('\n'), fixed: fixedCount > 0 };
  }

  // Ensure blank line before and after --- to prevent it from turning previous lines into H2
  fixHorizontalRules(text) {
    const original = text;
    const lines = text.split('\n');
    const out = [];
    let inYaml = false;
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();

      // Track code fences — never modify anything inside a code block
      if (t.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        out.push(line);
        continue;
      }
      if (inCodeBlock) {
        out.push(line);
        continue;
      }
      
      if (i === 0 && t === '---') {
        inYaml = true;
        out.push(line);
        continue;
      }
      if (inYaml && t === '---') {
        inYaml = false;
        out.push(line);
        continue;
      }
      
      if (!inYaml && t === '---') {
        if (out.length > 0 && out[out.length - 1].trim() !== '') {
          out.push(''); // Blank line before
        }
        out.push(line);
        if (i + 1 < lines.length && lines[i + 1].trim() !== '') {
          out.push(''); // Blank line after
        }
      } else {
        out.push(line);
      }
    }
    const result = out.join('\n');
    return { text: result, fixed: result !== original };
  }

  // Ensure blank line before and after $$ ... $$ block math
  fixEmptyLineAroundMath(text) {
    let original = text;
    // Add blank line before $$ if missing (but not if line above is already blank or is YAML ---)
    text = text.replace(/([^\n])\n(\$\$)/g, '$1\n\n$2');
    // Add blank line after closing $$ if next line is not blank
    text = text.replace(/(\$\$)\n([^\n$])/g, '$1\n\n$2');
    return { text, fixed: text !== original };
  }

  // Ensure blank line before and after ``` code fences
  fixEmptyLineAroundCodeFences(text) {
    let original = text;
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isFence = line.trim().startsWith('```');
      if (isFence) {
        // Add blank line before fence if previous line is non-empty non-YAML
        if (i > 0 && out.length > 0 && out[out.length - 1].trim() !== '' && !out[out.length - 1].startsWith('---')) {
          out.push('');
        }
        out.push(line);
        // Add blank line after fence if next line is non-empty
        if (i + 1 < lines.length && lines[i + 1].trim() !== '') {
          out.push('');
        }
      } else {
        out.push(line);
      }
    }
    const result = out.join('\n');
    return { text: result, fixed: result !== original };
  }

  // Remove trailing whitespace from every line
  fixTrailingSpaces(text) {
    const original = text;
    const result = text.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');
    return { text: result, fixed: result !== original };
  }

  // Collapse 3 or more consecutive blank lines into exactly 2
  fixConsecutiveBlankLines(text) {
    const original = text;
    const result = text.replace(/\n{4,}/g, '\n\n\n');
    return { text: result, fixed: result !== original };
  }

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

  splitCells(line) {
    let parts = line.split('|');
    if (parts.length && parts[0].trim() === '') parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
    return parts.map(c => c.trim());
  }

  // ─── Fixers ────────────────────────────────────────────────────────────────

  fixIndentation(text) {
    let fixedCount = 0;
    let lines = text.split(/\r?\n/); // Normalize \r\n to \n array
    let inCodeBlock = false;

    let out = lines.map(line => {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }

      // Strip trailing whitespaces globally to avoid parse errors later
      let l = line.trimEnd();

      // Convert leading tabs to 4 spaces (Obsidian standard) outside of codeblocks
      // Inside codeblocks (like Mermaid), Mermaid prefers spaces over tabs. We convert tabs to 2 spaces.
      const leadingTabs = l.match(/^\t+/);
      if (leadingTabs) {
        let spaceLen = inCodeBlock ? 2 : 4;
        l = l.replace(/^\t+/, ' '.repeat(spaceLen * leadingTabs[0].length));
        fixedCount++;
      }

      if (l !== line) fixedCount++;
      return l;
    });

    return { text: out.join('\n'), fixedCount };
  }

  fixYaml(text) {
    let lines = text.split('\n');
    let openIdx = -1;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      if (lines[i].trim() === '---') { openIdx = i; break; }
    }

    if (openIdx === -1) return { text, fixed: false };

    let closeIdx = -1;
    for (let i = openIdx + 1; i < Math.min(lines.length, 25); i++) {
      if (lines[i].trim() === '---') { closeIdx = i; break; }
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

  extractPrefix(line) {
    let m = line.match(/^((?:>[\s]*)*)(.*)/);
    if (m) return { prefix: m[1], content: m[2] };
    return { prefix: '', content: line };
  }

  fixTables(text) {
      let mergedRows = 0;
      let originalText = text;

      // V23 Fix: LLMs sometimes line-wrap trailing pipes in blockquotes as `\n>\n>  |`
      text = text.replace(/(\|[ \t]*)\r?\n>[ \t]*\r?\n>[ \t]*\|[ \t]*(?=\r?\n|$)/g, '$1');
      text = text.replace(/\r?\n>[ \t]*\r?\n>[ \t]*\|[ \t]*(?=\r?\n|$)/g, ' |');
      
      if (text !== originalText) {
          mergedRows++; // Ensure changes are saved
      }

      let lines = text.split(/\r?\n/);
    let out = [];
    let i = 0;

    while (i < lines.length) {
      let line = lines[i];
      let { prefix: p1, content: c1 } = this.extractPrefix(line);

      if (this.isHeaderRow(c1)) {
        let sepIndex = -1;
        let c2 = '';
        let p2 = '';
        for (let k = 1; k <= 5 && i + k < lines.length; k++) {
            let peekExt = this.extractPrefix(lines[i + k]);
            let peekContent = peekExt.content.trim();
            if (peekContent.startsWith('#') || peekContent.startsWith('```') || peekContent.startsWith('---')) break;
            
            if (this.isSeparatorRow(peekContent)) {
                sepIndex = i + k;
                c2 = peekContent;
                p2 = peekExt.prefix;
                break;
            }
        }

        let missingSeparator = false;
        if (sepIndex === -1) {
            let nextExt = this.extractPrefix(lines[i + 1] || '');
            let nextContent = nextExt.content.trim();
            if (this.isHeaderRow(nextContent) && !this.isSeparatorRow(nextContent)) {
                missingSeparator = true;
                sepIndex = i + 1;
                p2 = p1;
            }
        }

        if (sepIndex !== -1) {
          let stitchedHeader = '';
          if (missingSeparator) {
              stitchedHeader = c1;
          } else {
              for (let k = 0; k < sepIndex - i; k++) {
                  let ext = this.extractPrefix(lines[i + k]);
                  stitchedHeader += ' ' + ext.content.trim();
              }
          }
          stitchedHeader = stitchedHeader.trim();
          
          if (out.length > 0) {
            let prevLine = out[out.length - 1];
            let prevExt = this.extractPrefix(prevLine);
            if (prevExt.content.trim() !== '') {
              out.push(p1.replace(/\s+$/, '')); // Insert blank line
              mergedRows++;
            }
          }

          let headers = this.splitCells(stitchedHeader);
          let numCols = headers.length;
          let targetPipeCount = numCols + 1;

          out.push(p1 + '| ' + headers.join(' | ') + ' |');
          out.push(p2 + '| ' + Array(numCols).fill('---').join(' | ') + ' |');
          
          if (!missingSeparator && sepIndex > i + 1) mergedRows++; // We merged a broken header
          if (missingSeparator) mergedRows++; // We injected a separator
          
          i = missingSeparator ? sepIndex : sepIndex + 1;

          while (i < lines.length) {
            let currLine = lines[i];
            let { prefix: p3, content: c3 } = this.extractPrefix(currLine);
            let t = c3.trim();

            if (p3 !== p1 || t.startsWith('#') || t.startsWith('```') || t.startsWith('---')) break;

            if (!t.startsWith('|') && !t.includes('|') && t !== '') break;

            if (t === '') {
              let nextLine = lines[i + 1] ? this.extractPrefix(lines[i + 1]).content.trim() : '';
              if (!nextLine.startsWith('|') && !nextLine.endsWith('|') && nextLine !== '') {
                break;
              }
              i++;
              continue;
            }

            let cells = this.splitCells(t);
            while (cells.length > numCols && cells[cells.length - 1] === '') cells.pop();

            let rowBuffer = p3 + '| ' + cells.join(' | ') + ' |';
            let j = i + 1;

            while (this.countPipes(rowBuffer) < targetPipeCount && j < lines.length) {
              let nextL = lines[j];
              let nextExt = this.extractPrefix(nextL);
              let nextT = nextExt.content.trim();
              
              if (nextExt.prefix !== p1 || nextT.startsWith('#') || nextT.startsWith('```') || nextT.startsWith('---')) break;
              
              if (nextT !== '') {
                let nextTClean = nextT.replace(/<br\s*\/?>$/i, '').trim();
                if (nextTClean.startsWith('<br>')) {
                  nextTClean = nextTClean.replace(/^<br\s*\/?>/i, '').trim();
                }
                
                if (nextTClean.startsWith('|')) {
                  if (this.countPipes(nextTClean) >= targetPipeCount) break;
                  cells.push(...this.splitCells(nextTClean));
                } else {
                  let newParts = this.splitCells(nextTClean);
                  if (newParts.length > 0) {
                    if (cells.length > 0) {
                      cells[cells.length - 1] += ' ' + newParts[0];
                      if (newParts.length > 1) {
                        cells.push(...newParts.slice(1));
                      }
                    } else {
                      cells.push(...newParts);
                    }
                  }
                }
                
                while (cells.length > numCols && cells[cells.length - 1] === '') cells.pop();
                rowBuffer = p3 + '| ' + cells.join(' | ') + ' |';
                mergedRows++;
              }
              j++;
            }

            while (j < lines.length) {
              let checkNextLine = lines[j];
              let checkNextExt = this.extractPrefix(checkNextLine);
              let checkNext = checkNextExt.content.trim();
              
              if (checkNextExt.prefix !== p1) break;
              
              if (checkNext === '') {
                let peek2 = lines[j + 1] ? this.extractPrefix(lines[j + 1]).content.trim() : '';
                if (!peek2.startsWith('|') && peek2.endsWith('|') && !peek2.startsWith('#')) {
                  j++;
                  continue;
                }
                break;
              }
              if (!checkNext.startsWith('|') && checkNext.endsWith('|')) {
                let cleanNext = checkNext.replace(/<br\s*\/?>$/i, '').trim();
                if (cleanNext.startsWith('<br>')) cleanNext = cleanNext.replace(/^<br\s*\/?>/i, '').trim();
                
                let parts = this.splitCells(cleanNext);
                if (parts.length > 0) {
                  if (cells.length > 0) {
                    cells[cells.length - 1] += ' ' + parts[0];
                    if (parts.length > 1) cells.push(...parts.slice(1));
                  } else {
                    cells.push(...parts);
                  }
                }
                
                rowBuffer = p3 + '| ' + cells.join(' | ') + ' |';
                mergedRows++;
                j++;
              } else {
                break;
              }
            }

            if (cells.join('').trim() !== '') {
              while (cells.length < numCols) cells.push('');
              while (cells.length > numCols && cells[cells.length - 1] === '') cells.pop();
              out.push(p3 + '| ' + cells.join(' | ') + ' |');
            }
            i = j;
            continue;
          }
          continue;
        }
      }

      out.push(line);
      i++;
    }

    return { text: out.join('\n'), mergedRows };
  }

  fixDataviewConflicts(text) {
    let fixedCount = 0;
    let lines = text.split('\n');
    let inTable = false;

    let out = lines.map(line => {
      let t = line.trim();

      if (t.startsWith('|') && this.countPipes(t) >= 2) {
        inTable = true;
      } else if (inTable && !t.startsWith('|')) {
        inTable = false;
      }

      if (!inTable || !t.startsWith('|')) return line;
      if (this.isSeparatorRow(line)) return line;

      let modified = line;
      modified = modified.replace(/(?<!`|\\|\$)={2}(?!`|=)/g, (match, offset, str) => {
        let before = str.slice(0, offset);
        let backtickCount = (before.match(/`/g) || []).length;
        let dollarCount = (before.match(/\$/g) || []).length;
        if (backtickCount % 2 !== 0 || dollarCount % 2 !== 0) return match;
        fixedCount++;
        return '`==`';
      });

      modified = modified.replace(/\[([^\]]+)::([^\]]+)\]/g, (match) => {
        fixedCount++;
        return '`' + match + '`';
      });

      return modified;
    });

    return { text: out.join('\n'), fixedCount };
  }

  fixCallouts(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;
    let inCode = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.replace(/^[>\s]*/, '').startsWith('```')) inCode = !inCode;

      if (line.includes('$$>') || line.includes(' >$$')) {
        line = line.replace(/\$\$>\s*/g, '$$\n> ');
        line = line.replace(/\s*>\$\$/g, '\n> $$');
        line = line.replace(/\s*>\s*\\\\/g, ' \\\\');
        fixedCount++;
      }

      if (line.trim() === '>' && out.length > 0 && out[out.length - 1].trim() === '>') {
        fixedCount++;
        continue;
      }

      // V36: an empty '>' line that ends a callout (next line is not quoted) is dropped
      if (!inCode && /^[ \t]*>[ \t]*$/.test(line)) {
        const next = i + 1 < lines.length ? lines[i + 1] : '';
        if (!/^[ \t]*>/.test(next)) {
          fixedCount++;
          out.push('');
          continue;
        }
      }

      out.push(line);
    }

    return { text: out.join('\n'), fixedCount };
  }

  fixEmbeddedCallouts(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;
    let inCodeBlock = false;

    const calloutRegex = /^(.*?)\s*\[!(note|info|todo|warning|caution|danger|error|bug|tip|hint|success|check|done|question|help|faq|example|quote|cite|abstract|summary|tldr|important|attention)\]([+-]?)\s*(.*)$/i;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }

      if (!inCodeBlock) {
        let match = line.match(calloutRegex);
        if (match) {
          let prefix = match[1];
          let type = match[2];
          let fold = match[3];
          let suffix = match[4];

          if (prefix.trim() === '>' || prefix.trim() === '') {
            if (!prefix.includes('>')) {
               out.push(`> [!${type}]${fold} ${suffix}`);
               fixedCount++;
               continue;
            } else {
               out.push(line);
               continue;
            }
          }

          if (prefix.endsWith('`')) {
            out.push(line);
            continue;
          }

          let cleanPrefix = prefix.trimEnd();
          
          if (cleanPrefix.startsWith('|') && !cleanPrefix.endsWith('|')) {
            cleanPrefix += ' |';
          }

          if (cleanPrefix.length > 0) {
            out.push(cleanPrefix);
            out.push('');
          }
          out.push(`> [!${type}]${fold} ${suffix}`);
          fixedCount++;
          continue;
        }
      }
      out.push(line);
    }
    
    return { text: out.join('\n'), fixed: fixedCount > 0 };
  }

  fixLatex(text) {
    let fixedCount = 0;
    const fixed = text.replace(/\\begin\{array\}\{([^}]*)\}/g, (match, spec) => {
      if (spec.includes('\\|')) {
        fixedCount++;
        return match.replace(/\\\|/g, '|');
      }
      return match;
    });
    return { text: fixed, fixedCount };
  }

  fixMermaid(text) {
    let fixedCount = 0;
    let mermaidRegex = /```mermaid([\s\S]*?)```/g;

    let fixedText = text.replace(mermaidRegex, (match, code) => {
      let lines = code.split('\n');
      
      // Check if it's a mindmap by looking at the first non-empty line after stripping prefixes
      let cleanCode = code.replace(/^[\s>]+/gm, '').trim();
      let isMindmap = cleanCode.startsWith('mindmap');
      let injectedInit = false;

      let fixedLines = lines.map(line => {
        // Separate the blockquote/indentation prefix from the actual Mermaid code
        let prefixMatch = line.match(/^([\s>]*)/);
        let prefix = prefixMatch ? prefixMatch[1] : '';
        let l = line.substring(prefix.length).trimEnd();

        // Skip completely empty lines (only whitespace/prefixes)
        if (l === '') return line;

        // V9 Fix: Strip out existing %%{init}%% theme configurations
        if (l.startsWith('%%{init')) {
          fixedCount++;
          return null; // V36: drop the line entirely (was leaving a blank line that grew on every run)
        }

        let injectedLine = '';
        if (!injectedInit && !isMindmap) {
          // V14 Fix: Instead of edgeLabelBackground which Mermaid converts to black (#000000) by dropping the alpha channel,
          // we inject raw CSS to force the rect and span backgrounds to be transparent, keeping text legible.
          injectedLine = prefix + '%%{init: {"themeCSS": ".edgeLabel rect { fill: transparent !important; } .edgeLabel span { background-color: transparent !important; }"}}%%\n';
          injectedInit = true;
          fixedCount++;
        }

        if (isMindmap && l.includes('"')) {
          l = l.replace(/"/g, '');
          fixedCount++;
        }

        // Fix bare +/- nodes
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*"?\+"?\s*\)\)/g, '$1(("Add"))');
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*"?\-"?\s*\)\)/g, '$1(("Sub"))');
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*([\+\-\*\/])\s*\)\)/g, '$1(("$2"))');

        // V20/V36 Fix: LLMs sometimes generate unicode arrows (\u2192) outside quoted labels, which cause Lexical errors
        if (!isMindmap && l.includes('\u2192')) {
          const arrowed = l.replace(/("[^"\n]*")|\u2192/g, (m, q) => (q ? q : '-->'));
          if (arrowed !== l) { l = arrowed; fixedCount++; }
        }

        l = l.replace(/-->\s*\|([^"|\n]+)\|/g, (m, label) => {
          let trimmed = label.trim();
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) return m;
          fixedCount++;
          return `-->|"${trimmed}"|`;
        });

        // V10 Fix: Unquoted node labels with square brackets (e.g. Input[x[n]]) cause SQS parsing errors
        if (l.match(/([a-zA-Z0-9_]+)\[([^"\]]*\[[^\]]*\][^"\]]*)\]/)) {
          l = l.replace(/([a-zA-Z0-9_]+)\[([^"\]]*\[[^\]]*\][^"\]]*)\]/g, '$1["$2"]');
          fixedCount++;
        }

        // V10 Fix: Empty node labels (e.g. Branch[ ]) cause SQS parsing errors
        if (l.match(/([a-zA-Z0-9_]+)\[(\s+)\]/)) {
          l = l.replace(/([a-zA-Z0-9_]+)\[(\s+)\]/g, '$1["$2"]');
          fixedCount++;
        }

        // Math/LaTeX fixes
        if (l.includes('\\cdot') || l.includes('\\times') || l.includes('\\frac')) {
          l = l.replace(/\\cdot/g, '\u00B7');
          l = l.replace(/\\times/g, '\u00D7');
          l = l.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2');
          fixedCount++;
        }

        if (l.match(/\["\d+\.\s/)) {
          l = l.replace(/\["(\d+)\.\s/g, '["($1) ');
          fixedCount++;
        }

        if (l.includes('<--') && !l.includes('<-->')) {
          l = l.replace(/^([a-zA-Z0-9_]+(?:\[.*?\]|\(\(.*?\)\)|\(.*?\))?)\s*<--\s*([a-zA-Z0-9_]+(?:\[.*?\]|\(\(.*?\)\)|\(.*?\))?)(.*)$/, '$2 --> $1$3');
          fixedCount++;
        }

        if (l.includes('math:')) {
          l = l.replace(/math:\s*/g, '');
          fixedCount++;
        }
        if (l.includes('mathcal{F}')) {
          l = l.replace(/\\?mathcal\{F\}/g, '\u2131');
          fixedCount++;
        }
        if (l.includes('z?1')) {
          l = l.replace(/z\?1/g, 'z\u207B\u00B9');
          fixedCount++;
        }
        if (l.includes('geq')) {
          l = l.replace(/\\?geq/g, '\u2265');
          fixedCount++;
        }

        // V36 Fix: Mermaid labels must be plain text. Strip $ math delimiters, convert LaTeX commands
        // and replace a bare '&' (inside quoted labels / mindmap text only) with 'and'.
        if (l.includes('$') || l.includes('\\') || l.includes('&')) {
          const symbols = { pi: '\u03c0', theta: '\u03b8', omega: '\u03c9', alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', sigma: '\u03c3', mu: '\u03bc', lambda: '\u03bb', phi: '\u03c6', infty: '\u221e', sum: '\u03a3', int: '\u222b', sqrt: '\u221a', leq: '\u2264', le: '\u2264', geq: '\u2265', ge: '\u2265', neq: '\u2260', to: '\u2192', rightarrow: '\u2192', Rightarrow: '\u21d2', pm: '\u00b1', approx: '\u2248', in: '\u2208' };
          const plain = (str) => str
            .replace(/\\(?:text|mathrm|mathbf|mathbb)\{([^}]*)\}/g, '$1')
            .replace(/\\([a-zA-Z]+)/g, (m, n) => (n in symbols ? symbols[n] : (n.length > 1 ? n : m)))
            .replace(/&(?!(?:[a-zA-Z]+|#\d+);)/g, 'and');
          let cleaned = l.replace(/\$+/g, '');
          if (isMindmap) cleaned = plain(cleaned);
          else cleaned = cleaned.replace(/"([^"\n]*)"/g, (q, inner) => '"' + plain(inner) + '"');
          if (cleaned !== l) { l = cleaned; fixedCount++; }
        }

        return injectedLine + prefix + l;
      });

      // V36: remove dropped lines, blank lines before the first diagram line, and trailing blank lines
      let started = false;
      fixedLines = fixedLines.filter((ln, idx) => {
        if (ln === null) return false;
        if (idx === 0) return true;
        if (!started) {
          if (ln.replace(/^[s>]*/, '') === '') return false;
          started = true;
        }
        return true;
      });
      while (fixedLines.length > 1 && fixedLines[fixedLines.length - 1].replace(/^[s>]*/, '') === '') fixedLines.pop();

      // V16 FIX: If the code was inside a blockquote/callout (lines start with "> "),
      // the closing ``` must ALSO have the same prefix.
      // Without this, Obsidian sees a bare ``` and opens a NEW code block for everything below.
      let blockPrefix = '';
      for (let line of lines) {
        let m = line.match(/^([\s>]+)/);
        if (m && m[1].trim() !== '') { blockPrefix = m[1]; break; }
      }
      return '```mermaid' + fixedLines.join('\n') + '\n' + blockPrefix + '```';
    });

    return { text: fixedText, fixedCount };
  }

  fixBrokenHighlights(text) {
    let fixedCount = 0;
    let lines = text.split('\n');
    let inCodeBlock = false;
    let inMathBlock = false;
    
    let out = lines.map(line => {
      let t = line.trim();
      if (t.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (t === '$$') {
        inMathBlock = !inMathBlock;
        return line;
      }
      
      if (inCodeBlock || inMathBlock) return line;

      let cleanLine = line.replace(/`[^`]*`/g, '').replace(/\$[^$]*\$/g, '');
      let matches = cleanLine.match(/(?<![=!<>])={2}(?!=)/g);
      
      if (matches && matches.length % 2 !== 0) {
        line = line + '==';
        fixedCount++;
      }
      return line;
    });

    return { text: out.join('\n'), fixedCount };
  }

  fixTikz(text) {
    let fixedCount = 0;
    // Capture any prefix (like blockquotes or indentation) before ```tikz or ```circuitikz
    // V35 Fix: Support ```latex and ```tex blocks that contain tikz/circuitikz
    let tikzRegex = /^([ \t>]*?)```(?:tikz|circuitikz|latex|tex)([\s\S]*?)```/gm;

    let fixedText = text.replace(tikzRegex, (match, prefix, code) => {
      let envMatch = code.match(/\\begin\{(tikzpicture|circuitikz)\}([\s\S]*?)(\\end\{\1\})/);
      
      if (envMatch) {
          let envName = envMatch[1];
          let rawEnvContent = envMatch[2];
          let envEnd = envMatch[3];

          // Determine prefix p (e.g. '> ' if inside a callout, or '' if at root)
          let p = prefix ? prefix : '';
          if (p.includes('>') && !p.endsWith(' ')) {
              p += ' ';
          }

          // V34 Fix: Strip any blockquote markers ('> ' or '>') from lines inside envContent
          // to prevent LaTeX parsing crash (! LaTeX Error: Missing \\begin{document} on '>')
          let envContent = rawEnvContent.replace(/^[ \t]*>[ \t]?/gm, '');

          // V33/V34 Fix: Wrap pgfkeys attributes containing math in braces to prevent pgfkeys parser crash
          // when the math contains an equals sign '=' or comma ','
          // Supports standard keys as well as current/voltage direction keys: i>, i<, i^>, i_>, v>, etc.
          // Example: to[R, l=$R_G=g_0=1$] -> to[R, l={$R_G=g_0=1$}]
          // Example: to[R, i>=$I_c$] -> to[R, i>={$I_c$}]
          envContent = envContent.replace(/([a-zA-Z0-9_<>^_]+)=\$([^$]+)\$/g, (m, key, inner) => key + '={$' + inner + '$}');
          
          // V38: placement keys, unwrapped math/%/& in node text, circuitikz labels
          envContent = this.fixTikzBody(envContent);

          // V12 Fix: TikZJax doesn't support the patterns library. 
          // Remove any pattern or pattern color attributes to prevent broken images.
          if (envContent.includes('pattern')) {
              envContent = envContent.replace(/pattern[a-zA-Z\s]*=[^,\]]+/g, '');
              // Clean up any trailing/duplicate commas left behind
              envContent = envContent.replace(/,\s*,/g, ',');
              envContent = envContent.replace(/\[\s*,/g, '[');
              envContent = envContent.replace(/,\s*\]/g, ']');
          }
          
          // Fix unsupported tdplot_main_coords (tikz-3dplot) by replacing with explicit 3D axes
          envContent = envContent.replace(/tdplot_main_coords/g, 'x={(-0.5cm,-0.4cm)}, y={(1cm,0cm)}, z={(0cm,1cm)}');

          // Strip standalone \\usepackage{tikz} since TikZJax does not support it.
          envContent = envContent.replace(/\\usepackage\{tikz\}\r?\n?/g, '');
          // Replace \\textcircled{} which requires the textcomp package (not in TikZJax).
          envContent = envContent.replace(/\\textcircled\{([^}]+)\}/g, '$1');

          // Separate environment options e.g. [x=2cm, y=2cm] from the body
          let optMatch = envContent.match(/^(\s*\[[\s\S]*?\])?([\s\S]*)$/);
          let envOpts = optMatch && optMatch[1] ? optMatch[1].trim() : '';
          let envBody = optMatch && optMatch[2] ? optMatch[2] : envContent;

          // Clean body lines and apply prefix p cleanly to each line
          let bodyLines = envBody.replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '').split(/\r?\n/).map(line => {
              if (p) {
                  return line.trim() === '' ? p.trimEnd() : p + line;
              }
              return line;
          }).join('\r\n');

          // Rebuild clean TikZ code block with standardized preamble
          let lines = [
              p + "```tikz",
              ...this.buildTikzPreamble(code, envName, envContent).map(l => p + l),
              p + "\\begin{document}",
              p + '\\begin{' + envName + '}' + (envOpts ? ' ' + envOpts : ''),
              bodyLines,
              p + envEnd,
              p + "\\end{document}",
              p + "```"
          ];

          let replacement = lines.join('\r\n');

          if (match !== replacement) {
              fixedCount++;
          }
          return replacement;
      }
      
      return match;
    });

    return { text: fixedText, fixedCount };
  }

  // V38: fixes for AI-written TikZ that is valid-looking but does not compile in TikZJax:
  //  - "top" / "bottom" are not TikZ placement keys (above / below are)
  //  - math written without $ inside node text (90^\circ, V_s, \Omega) -> "Missing $ inserted"
  //  - unescaped % and & inside node text (% starts a LaTeX comment and eats the closing brace)
  //  - circuitikz labels such as l=R_1 without $
  fixTikzBody(content) {
    let out = content.replace(/\[[^\[\]\n]*\]/g, opts => opts.replace(
      /(^\[|,)(\s*)(bottom|top)(\s+(?:left|right))?(?=\s*(?:,|\]))/g,
      (m, pre, sp, w, lr) => pre + sp + (w === 'top' ? 'above' : 'below') + (lr || '')
    ));

    out = out.replace(/(\bnode\b[^;{}]*)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (m, head, text) => head + '{' + this.fixTikzText(text) + '}');

    out = out.replace(
      /\b((?:l|a|v|i|f)[_^]?|label)=\{?([A-Za-z0-9\\.]+(?:[_^](?:\{[^{}]*\}|[A-Za-z0-9\\]+))+)\}?(?=\s*[,\]])/g,
      (m, key, val) => key + '={$' + val + '$}'
    );
    return out;
  }

  fixTikzText(text) {
    const mathToken = /([A-Za-z0-9.]+)?((?:[\^_](?:\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9]+))+)|\\(circ|Omega|omega|mu|pi|theta|phi|alpha|beta|gamma|delta|sigma|lambda|epsilon|varepsilon|rho|tau|infty|times|pm|leq|geq|approx|neq|cdot|rightarrow|to)(?![A-Za-z])/g;
    return text.split(/(\$[^$]*\$)/).map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg
        .replace(/(^|[^\\])%/g, '$1\\%')
        .replace(/(^|[^\\])&/g, '$1\\&')
        .replace(mathToken, (m, base, scripts, cmd) => {
          if (cmd) return '$\\' + cmd + '$';
          const braced = scripts.replace(/([\^_])([A-Za-z0-9]+)/g, '$1{$2}');
          return '$' + (base || '') + braced + '$';
        });
    }).join('');
  }

  // V38: build the TikZJax preamble from what the diagram really needs instead of a fixed one.
  // A pgfplots graph (\begin{axis}) used to be rebuilt WITHOUT pgfplots and failed with
  // "Environment axis undefined" (broken image icon). Libraries declared by the AI (calc, arrows.meta,
  // positioning...) were also thrown away. Only packages/libraries bundled with TikZJax are emitted.
  buildTikzPreamble(code, envName, body) {
    const SUPPORTED_PKGS = ['circuitikz', 'pgfplots', 'tikz-3dplot', 'tikz-cd', 'chemfig', 'array', 'amssymb', 'amsfonts'];
    const SUPPORTED_LIBS = new Set(['3d', 'angles', 'arrows', 'arrows.meta', 'automata', 'backgrounds', 'bending', 'calc', 'chains', 'circuits', 'circuits.ee', 'circuits.ee.IEC', 'circuits.logic.US', 'circuits.logic.IEC', 'decorations', 'decorations.markings', 'decorations.pathmorphing', 'decorations.pathreplacing', 'decorations.text', 'fit', 'intersections', 'matrix', 'mindmap', 'patterns', 'perspective', 'plothandlers', 'plotmarks', 'positioning', 'quotes', 'scopes', 'shadows', 'shapes', 'shapes.geometric', 'shapes.misc', 'shapes.symbols', 'shapes.arrows', 'shapes.callouts', 'shapes.multipart', 'through', 'trees']);
    const pkgs = new Set();
    const libs = new Set(['decorations.markings']);

    for (const m of code.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
      for (const n of m[1].split(',')) { const k = n.trim(); if (SUPPORTED_PKGS.includes(k)) pkgs.add(k); }
    }
    for (const m of code.matchAll(/\\usetikzlibrary\{([^}]*)\}/g)) {
      for (const n of m[1].split(',')) { const k = n.trim(); if (SUPPORTED_LIBS.has(k)) libs.add(k); }
    }

    const needsPgfplots = /\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis)\}|\\addplot|\\pgfplotsset/.test(body);
    const circuitish = envName === 'circuitikz' || /\\ctikzset|\bto\[\s*[A-Za-z]|\bnode\[[^\]]*(?:ground|vcc|vee|npn|pnp|nmos|pmos|op amp)/.test(body);
    if (needsPgfplots) pkgs.add('pgfplots');
    if (!needsPgfplots || circuitish) pkgs.add('circuitikz');
    else pkgs.delete('circuitikz');

    // libraries the body obviously relies on (added even if the AI forgot the \usetikzlibrary line)
    if (/\(\s*\$|\$\s*\(/.test(body)) libs.add('calc');
    if (/Stealth|Latex\b|Triangle|Straight Barb|Hooks|\{To\b|>\s*=\s*\{/.test(body)) libs.add('arrows.meta');
    if (/(?:above|below|left|right)[a-z ]*=\s*[^,\]]*\bof\b/.test(body)) libs.add('positioning');
    if (/shape\s*=\s*(?:diamond|ellipse|trapezium|star|semicircle|regular polygon|kite|dart|cylinder)|[\[,]\s*(?:diamond|ellipse|trapezium|star|semicircle|cylinder)\s*[,\]]/.test(body)) libs.add('shapes.geometric');
    if (/brace|decoration\s*=\s*\{?\s*(?:ticks|border)/.test(body)) libs.add('decorations.pathreplacing');
    if (/snake|zigzag|coil|random steps/.test(body)) libs.add('decorations.pathmorphing');
    if (/name path|intersection of|name intersections/.test(body)) libs.add('intersections');
    if (/on background layer|background rectangle/.test(body)) libs.add('backgrounds');
    if (/\bfit\s*=/.test(body)) libs.add('fit');
    if (/\\matrix|matrix of nodes/.test(body)) libs.add('matrix');
    if (/pic\s*[\[{][^}]*angle|angle eccentricity/.test(body)) { libs.add('angles'); libs.add('quotes'); }

    const order = ['circuitikz', 'pgfplots', 'tikz-3dplot', 'tikz-cd', 'chemfig', 'array', 'amssymb', 'amsfonts'];
    const out = [];
    for (const k of order) if (pkgs.has(k)) out.push('\\usepackage{' + k + '}');
    out.push('\\usepackage{amsmath}');
    if (pkgs.has('pgfplots')) out.push('\\pgfplotsset{compat=newest}');
    out.push('\\usetikzlibrary{' + [...libs].join(',') + '}');
    return out;
  }

  fixCollapsedMath(text) {
    let fixedCount = 0;
    // V13 Fix: Sometimes copy-pasting collapses LaTeX array environments inside blockquotes into a single line with literal ' > ' separators.
    // e.g. \begin{array}{r|l} >  & 1 ... \cline{2-2} > ...
    let fixedText = text.replace(/\\begin\{(array|pmatrix|bmatrix|vmatrix|cases)\}([\s\S]*?)\\end\{\1\}/g, (match) => {
        if (match.includes(' > ')) {
            fixedCount++;
            return match.replace(/ > /g, '\n> ');
        }
        return match;
    });
    return { text: fixedText, fixedCount };
  }

  fixSingleDollarMathBlocks(text) {
    let fixedCount = 0;
    // Replace lines that consist of exactly "> $" (or similar spacing) with "> $$"
    // This fixes multi-line math blocks in blockquotes that AI generated with single $, which breaks markdown parsing
    let lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^[ \t]*>[ \t]*\$[ \t]*$/)) {
            lines[i] = lines[i].replace('$', '$$');
            fixedCount++;
        }
    }
    return { text: lines.join('\n'), fixedCount };
  }

  fixMathJaxBlockAttributes(text) {
    let fixedCount = 0;
    // V31 Fix (Updated): Obsidian strips { } as a block attribute before MathJax renders.
    // The only working fix: replace \cline{...} with \hline entirely.
    let oldText = text;
    text = text.replace(/\\cline\{[^}]+\}/g, '\\hline');
    if (text !== oldText) fixedCount++;
    return { text, fixedCount };
  }

  fixSpacing(text) {
    // V36: at most ONE blank line between elements (code fences are left untouched)
    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let blank = 0;
    for (const line of lines) {
      const bare = line.replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) inCode = !inCode;
      if (!inCode && line.trim() === '') {
        blank++;
        if (blank > 1) continue;
      } else {
        blank = 0;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  fixBoldFormatting(text) {
    // V36: strictly line-local. The old global regex merged paragraphs, math blocks and callouts
    // into one line whenever a single '**' was unbalanced.
    const lines = text.split('\n');
    let inCode = false;
    let inMath = false;
    const out = lines.map(line => {
      const bare = line.trim().replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; return line; }
      if (inCode) return line;
      if (bare === '$$') { inMath = !inMath; return line; }
      if (inMath || !line.includes('**')) return line;

      const stash = [];
      const masked = line.replace(/`[^`\n]*`|\$\$[^\n]*?\$\$|\$[^$\n]+\$/g, m => {
        stash.push(m);
        return '\u0000' + (stash.length - 1) + '\u0000';
      });
      const fixed = masked.replace(/\*\*((?:(?!\*\*)[^\n])+?)\*\*/g, (m, inner) => {
        const cleaned = inner.trim();
        return cleaned ? '**' + cleaned + '**' : m;
      });
      return fixed.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
    });
    const newText = out.join('\n');
    return { text: newText, fixed: newText !== text };
  }

  // V36/V37: remove [cite: ...] markers only (Source notes and chunk lines are kept on purpose)
  fixLeaks(text) {
    // Only [cite: ...] markers are removed. "(Source N ...)" notes and the chunk-boundary
    // lines (STATUS / next-section question / ---) are intentionally kept.
    let fixedCount = 0;
    const lines = text.split('\n');
    let inCode = false;
    const citeRe = /[ \t]*\[(?:cite(?:_start|_end)?(?::[^\]\n]*)?|Sources?\s*\d+[^\]\n]*)\]/g;
    const out = lines.map(line => {
      if (line.replace(/^[>\s]*/, '').startsWith('```')) { inCode = !inCode; return line; }
      if (inCode) return line;
      const cleaned = line.replace(citeRe, '');
      if (cleaned !== line) fixedCount++;
      return cleaned;
    });
    return { text: out.join('\n'), fixedCount };
  }

  // V36: Obsidian only expands {{date}} when a template is inserted, so the AI's literal
  // "Date: {{date:YYYY-MM-DD}}" stays as text. Fill it with today's date inside the YAML only.
  fixDatePlaceholder(text) {
    const lines = text.split('\n');
    if (!lines[0] || lines[0].trim() !== '---') return { text, fixed: false };
    let close = -1;
    for (let i = 1; i < Math.min(lines.length, 30); i++) {
      if (lines[i].trim() === '---') { close = i; break; }
    }
    if (close === -1) return { text, fixed: false };

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    let fixed = false;
    for (let i = 1; i < close; i++) {
      lines[i] = lines[i].replace(/\{\{\s*date\s*(?::\s*YYYY-MM-DD\s*)?\}\}/i, () => { fixed = true; return iso; });
    }
    return { text: lines.join('\n'), fixed };
  }

  // ─── V37 ─────────────────────────────────────────────────────────────

  // V37: Obsidian does not render \( \) and \[ \]. Convert them to $ and $$.
  fixMathDelimiters(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    let inCode = false;
    const out = lines.map(line => {
      const bare = line.replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; return line; }
      if (inCode || !/\\[()\[\]]/.test(line)) return line;
      const prefix = (line.match(/^[>\s]*/) || [''])[0];
      if (bare === '\\[' || bare === '\\]') { fixedCount++; return prefix + '$$'; }

      const stash = [];
      const masked = line.replace(/`[^`\n]*`/g, m => {
        stash.push(m);
        return '\u0000' + (stash.length - 1) + '\u0000';
      });
      let l = masked.replace(/(?<!\\)\\\[(.+?)(?<!\\)\\\]/g, (m, inner) => '$$' + inner.trim() + '$$');
      l = l.replace(/(?<!\\)\\\((.+?)(?<!\\)\\\)/g, (m, inner) => '$' + inner.trim() + '$');
      if (l !== masked) fixedCount++;
      return l.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
    });
    return { text: out.join('\n'), fixedCount };
  }

  // V37: inside a callout, a $$ block whose middle lines lost the '> ' prefix ends the callout
  // early and breaks the equation. Re-prefix those lines (only when the closing $$ is found).
  fixCalloutMath(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    const out = [];
    const dollars = s => (s.replace(/`[^`]*`/g, '').match(/\$\$/g) || []).length;
    const isQuote = s => /^\s*>/.test(s);
    let inCode = false;
    let mathOpen = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bare = line.replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; mathOpen = false; out.push(line); continue; }
      if (inCode) { out.push(line); continue; }

      if (isQuote(line)) {
        if (dollars(bare) % 2 === 1) mathOpen = !mathOpen;
        out.push(line);
        continue;
      }
      if (!mathOpen) { out.push(line); continue; }

      let close = -1;
      let closeQuoted = false;
      for (let j = i; j < Math.min(lines.length, i + 40); j++) {
        if (/^#{1,6}\s/.test(lines[j])) break;
        if (dollars(lines[j].replace(/^[>\s]*/, '')) % 2 === 1) { close = j; closeQuoted = isQuote(lines[j]); break; }
      }
      if (close === -1) { mathOpen = false; out.push(line); continue; }

      const last = closeQuoted ? close - 1 : close;
      for (let j = i; j <= last; j++) {
        const raw = lines[j];
        if (isQuote(raw)) { out.push(raw); continue; }
        out.push(raw.trim() === '' ? '>' : '> ' + raw);
        fixedCount++;
      }
      i = last;
      mathOpen = closeQuoted;
    }
    return { text: out.join('\n'), fixedCount };
  }

  // V37: remove the blank line between two consecutive list items (tight, textbook-style lists)
  fixLooseLists(text) {
    const lines = text.split('\n');
    const itemRe = /^([ \t]*(?:>[ \t]*)*)([*+-]|\d+[.)])[ \t]+\S/;
    const depth = s => (s.match(/>/g) || []).length;
    const out = [];
    let inCode = false;
    let fixedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bare = line.replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) inCode = !inCode;
      if (!inCode && bare === '' && out.length > 0 && i + 1 < lines.length) {
        const prev = out[out.length - 1].match(itemRe);
        let j = i + 1;
        while (j < lines.length && lines[j].replace(/^[>\s]*/, '') === '') j++;
        const next = j < lines.length ? lines[j].match(itemRe) : null;
        if (prev && next && depth(prev[1]) === depth(next[1]) && depth(prev[1]) === depth(line)) {
          fixedCount++;
          continue;
        }
      }
      out.push(line);
    }
    return { text: out.join('\n'), fixedCount };
  }

  // ─── V37: placeholders (screenshots / ChatGPT images) ────────────────

  isPlaceholderLine(bare) {
    return bare.startsWith('[Paste Screenshot') || bare.startsWith('[\u{1F5BC}') || bare.startsWith('[\u{1F916}');
  }

  findPlaceholders(text) {
    const res = [];
    const lines = text.split('\n');
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
      const bare = lines[i].replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; continue; }
      if (inCode || !this.isPlaceholderLine(bare)) continue;
      res.push({ line: i, kind: bare.startsWith('[\u{1F916}') ? 'prompt' : 'paste' });
    }
    return res;
  }

  async copyToClipboard(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  // One hotkey: jump to the next image slot. For a ChatGPT image prompt it copies the prompt and
  // selects the paste slot that follows, so Ctrl+V of the generated image replaces the placeholder.
  async nextPlaceholder(editor) {
    const text = editor.getValue();
    const all = this.findPlaceholders(text);
    if (all.length === 0) {
      new Notice('✅ No image/screenshot placeholders left!');
      return;
    }
    const lines = text.split('\n');
    const cur = editor.getCursor('to').line;
    let idx = all.findIndex(p => p.line > cur);
    if (idx === -1) idx = 0;
    let target = all[idx];
    let copied = false;
    let isPrompt = false;

    if (target.kind === 'prompt') {
      isPrompt = true;
      const raw = lines[target.line].replace(/^[>\s]*/, '');
      const a = raw.indexOf('"');
      const b = raw.lastIndexOf('"');
      copied = await this.copyToClipboard(a >= 0 && b > a ? raw.slice(a + 1, b) : raw);
      const pair = all.find(p => p.kind === 'paste' && p.line > target.line && p.line <= target.line + 4);
      if (pair) target = pair;
    }

    const line = lines[target.line];
    const ch0 = line.length - line.replace(/^[>\s]*/, '').length;
    const from = { line: target.line, ch: ch0 };
    const to = { line: target.line, ch: line.length };
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);

    const left = all.filter(p => p.kind === 'paste').length;
    if (isPrompt && copied) new Notice(`\u{1F4CB} Image prompt copied. Generate it in ChatGPT, then press Ctrl+V here. (${left} slots left)`, 6000);
    else if (isPrompt) new Notice(`⚠ Could not copy the prompt automatically. Copy it from the line above. (${left} slots left)`, 6000);
    else new Notice(`\u{1F4F7} Paste your screenshot with Ctrl+V. (${left} slots left)`, 4000);
  }

  // ─── V37: audit (report only) ────────────────────────────────────────

  auditText(text) {
    const issues = [];
    const lines = text.split('\n');
    const add = (i, sev, msg) => issues.push({ line: i, sev, msg, snippet: lines[i].replace(/^[>\s]*/, '').trim().slice(0, 90) });
    const sinhala = /[඀-෿]/;
        const leakRe = /\[cite|\{\{\s*date/;
    const skipRe = /(?:&=|=)\s*\\(?:dots|ldots|cdots)\s*(?:&=|=)|\\(?:dots|ldots)\s*&\s*=/;
    const proseSkipRe = new RegExp('\\bsimilarly\\b|\\band so on\\b|after simplification|\u0dc3\u0dd4\u0dc5\u0dd4 \u0d9a\u0dd2\u0dbb\u0dd3\u0db8\u0dd9\u0db1\u0dca.{0,40}\u0dbd\u0db6\u0dcf\u0d9c\u0dad \u0dc4\u0dd0\u0d9a|\u0db8\u0dda \u0d86\u0d9a\u0dcf\u0dbb\u0dba\u0da7\u0db8|\u0db8\u0dda \u0d86\u0d9a\u0dcf\u0dbb\u0dba\u0dd9\u0db1\u0dca\u0db8|\u0d92 \u0d86\u0d9a\u0dcf\u0dbb\u0dba\u0da7\u0db8|\u0d92 \u0d86\u0d9a\u0dcf\u0dbb\u0dba\u0dd9\u0db1\u0dca\u0db8|\u0dc3\u0dcf\u0db0\u0db1\u0dba.{0,80}\u0d9a\u0dc5 \u0dc4\u0dd0\u0d9a', 'i');

    let inCode = false;
    let codeLang = '';
    let inMath = false;
    let mathStart = 0;
    let tableCols = -1;
    let engRun = [];
    const flushRun = () => {
      if (engRun.length >= 3) add(engRun[0], 'warn', `English-only block (${engRun.length} lines): language drift?`);
      engRun = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const quoted = /^\s*>/.test(raw);
      const bare = raw.replace(/^[>\s]*/, '');

      if (bare.startsWith('```')) {
        flushRun();
        if (!inCode) {
          inCode = true;
          codeLang = bare.slice(3).trim().toLowerCase();
          if (quoted && /^(mermaid|tikz|circuitikz|functionplot)/.test(codeLang)) add(i, 'warn', `${codeLang} block inside a callout: it will not render`);
        } else {
          inCode = false;
          codeLang = '';
        }
        continue;
      }
      if (inCode) {
        if (codeLang.startsWith('functionplot') && !/^(title|xLabel|yLabel|bounds|disableZoom|grid)\s*:|^---/.test(bare) && /%|&&|\|\||\?|\bmod\s*\(/.test(bare)) {
          add(i, 'warn', 'functionplot expression uses %, ?, &&, || or mod and may fail to render');
        }
        continue;
      }

      const noCode = bare.replace(/`[^`]*`/g, '');
      const dollars = (noCode.match(/\$\$/g) || []).length;
      const wasMath = inMath;
      if (dollars % 2 === 1) {
        if (!inMath) mathStart = i;
        inMath = !inMath;
      }
      const isMathLine = wasMath || inMath || dollars > 0;

      if (skipRe.test(bare)) add(i, 'warn', 'possible skipped step (\\dots between equal signs)');
      if (leakRe.test(bare)) add(i, 'warn', 'leftover [cite] or {{date}} text: run Repair');

      if (this.isPlaceholderLine(bare)) {
        add(i, 'info', bare.startsWith('[\u{1F916}') ? 'ChatGPT image prompt' : 'image/screenshot still to paste');
        flushRun();
        continue;
      }

      if (bare.startsWith('|')) {
        const c = this.countPipes(bare);
        if (tableCols === -1) tableCols = c;
        else if (c !== tableCols) add(i, 'warn', `table row has ${c} pipes, the header has ${tableCols}`);
        flushRun();
        continue;
      }
      tableCols = -1;

      if (isMathLine) { flushRun(); continue; }
      if (bare === '') continue;
      if (/^#{1,6}\s/.test(bare) || bare.startsWith('[!')) { flushRun(); continue; }

      if (proseSkipRe.test(bare)) add(i, 'warn', 'skip-style phrase: every step must be written out');

      const masked = noCode.replace(/\$[^$]*\$/g, '');
      if ((masked.match(/\*\*/g) || []).length % 2 === 1) add(i, 'warn', 'unbalanced ** (bold) on this line');

      const stripped = masked.replace(/https?:\/\/\S+/g, '').replace(/[*_]/g, ' ');
      if (!sinhala.test(stripped) && (stripped.match(/[A-Za-z]{2,}/g) || []).length >= 8) {
        engRun.push(i);
        continue;
      }
      flushRun();
    }
    flushRun();
    if (inMath) add(mathStart, 'error', '$$ block is never closed');
    if (inCode) add(lines.length - 1, 'error', 'code fence is never closed');
    if (!/Final Topic Map/.test(text) && lines.length > 0) add(0, 'info', 'no "Final Topic Map" yet (fine if more chunks are coming)');

    issues.sort((a, b) => a.line - b.line);
    return issues;
  }

  statusSuffix(editor) {
    const t = editor.getValue();
    const warn = this.auditText(t).filter(x => x.sev !== 'info').length;
    const left = this.findPlaceholders(t).filter(p => p.kind === 'paste').length;
    return `\n\u{1F4CC} ${left} image slots to fill · ⚠ ${warn} warnings` + (warn ? ' (run "Audit note")' : '');
  }

  showAudit(editor) {
    const issues = this.auditText(editor.getValue());
    if (issues.length === 0) {
      new Notice('✅ Audit clean: no issues found.');
      return;
    }
    new AuditModal(this.app, editor, issues).open();
  }

  fixYoutubeLinks(text) {
    const ytRegex = /\[([^\]]+)\]\((?:https?:\/\/www\.google\.com\/search\?q=)?(?:https?:\/\/(?:www\.youtube\.com\/watch\?v=|youtu\.be\/))([\w-]+)[^\)]*\)/g;
    let oldText = text;
    let newText = text.replace(ytRegex, (match, title, id) => {
        return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    });
    return { text: newText, fixed: oldText !== newText };
  }
}


