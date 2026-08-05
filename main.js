const { Plugin, Notice, MarkdownView } = require('obsidian');

module.exports = class NoteRepairToolPlugin extends Plugin {
  async onload() {
    console.log('Loading Note Repair Tool Plugin V3...');

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
            new Notice(`⚡ Repaired Selection: ${result.summary}`);
          } else {
            new Notice('✨ Selected text is already clean!');
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
          new Notice('↩️ Undid last action');
        } else {
          new Notice('Cannot undo natively in this view.');
        }
      }
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item
            .setTitle('⚡ Repair Note (Fix Formatting)')
            .setIcon('zap')
            .onClick(() => {
              this.repairEditor(editor);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('↩️ Undo Last Action')
            .setIcon('rotate-ccw')
            .onClick(() => {
              if (editor.undo) {
                editor.undo();
                new Notice('↩️ Undid last action');
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
        new Notice('↩️ Undid last action');
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
      
      new Notice(`⚡ Note Repaired!\n${result.summary}`, 5000);
    } else {
      new Notice('✨ Note is already clean! No issues found.', 3000);
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

    // 2. YAML fixes (blank line after YAML, cleanup)
    const yamlRes = this.fixYaml(text);
    if (yamlRes.fixed) { text = yamlRes.text; changes.push('Fixed YAML Frontmatter'); }

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
    text = tikzRes.text;
    if (tikzRes.fixedCount > 0) totalFixed += tikzRes.fixedCount;

    const collapsedMathRes = this.fixCollapsedMath(text);
    text = collapsedMathRes.text;
    if (collapsedMathRes.fixedCount > 0) totalFixed += collapsedMathRes.fixedCount; 
    if (totalFixed > 0) changes.push('Fixed TikZ diagrams'); 

    // 11. Bold marker repair
    const boldRes = this.fixBoldFormatting(text);
    if (boldRes.fixed) { text = boldRes.text; changes.push('Fixed broken bold markers'); }

    // 12. Code block language tagging (Matlab/Python label → ```matlab tag)
    const codeLangRes = this.fixCodeBlockLanguages(text);
    if (codeLangRes.fixed) { text = codeLangRes.text; changes.push('Added syntax highlighting tags'); }

    // 13. YouTube link embedding
    const ytRes = this.fixYoutubeLinks(text);
    if (ytRes.fixed) { text = ytRes.text; changes.push('Converted YouTube links to embeds'); }

    // 18. Global spacing pass (final polish)
    text = this.fixSpacing(text);

    return {
      text: text,
      changed: text !== rawText,
      summary: changes.length > 0 ? changes.join(' | ') : 'No fixes needed'
    };
  }


  // ─── Helpers ───────────────────────────────────────────────────────────────

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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      
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
    let lines = text.split('\n');
    let out = [];
    let mergedRows = 0;
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

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

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

      out.push(line);
    }

    return { text: out.join('\n'), fixedCount };
  }

  fixEmbeddedCallouts(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;
    let inCodeBlock = false;

    const calloutRegex = /^(.*?)\s*\[!(note|info|todo|warning|caution|danger|error|bug|tip|hint|success|check|done|question|help|faq|example|quote|cite)\]\s*(.*)$/i;

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
          let suffix = match[3];

          if (prefix.trim() === '>' || prefix.trim() === '') {
            if (!prefix.includes('>')) {
               out.push(`> [!${type}] ${suffix}`);
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
          out.push(`> [!${type}] ${suffix}`);
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
          return prefix; // Leave just the prefix (essentially an empty line)
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

        return injectedLine + prefix + l;
      });

      return '```mermaid' + fixedLines.join('\n') + '```';
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
    // Capture any prefix (like blockquotes or indentation) before ```tikz
    let tikzRegex = /^([ \t>]*?)```tikz([\s\S]*?)```/gm;

    let fixedText = text.replace(tikzRegex, (match, prefix, code) => {
      let envMatch = code.match(/\\begin\{(tikzpicture|circuitikz)\}([\s\S]*?)(\\end\{\1\})/);
      
      if (envMatch) {
          let envName = envMatch[1];
          let envContent = envMatch[2];
          let envEnd = envMatch[3];
          
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
          
          let p = prefix ? prefix : '';
          
          // V12 Fix: Preserve the user's original preamble if it exists. 
          // Only inject the hardcoded preamble if \begin{document} is completely missing.
          let hasPreamble = code.includes('\\begin{document}');
          let newCode = '';
          
          if (!hasPreamble) {
              newCode = `\n${p}\\usepackage{circuitikz}\n${p}\\usepackage{amsmath}\n${p}\\usetikzlibrary{decorations.markings}\n${p}\\begin{document}\n${p}\\begin{${envName}}${envContent}${envEnd}\n${p}\\end{document}\n${p}`;
          } else {
              // Replace the content inside the environment, preserving the rest of the code
              // Since `code` already contains the original prefixes, we don't need to re-apply them.
              newCode = code.replace(envMatch[2], envContent);
          }
          
          let replacement = `${p}\`\`\`tikz${newCode}\`\`\``;
          
          // Clean up any double prefixes that might have occurred from previous versions
          if (p) replacement = replacement.replace(new RegExp(`^${p}${p}`, 'gm'), p);
          
          // Clean up growing blank lines that might have occurred from previous versions
          if (p) replacement = replacement.replace(new RegExp(`\n${p}\\s*\n${p}\\s*\n`, 'g'), `\n${p}\n`);
          
          if (match !== replacement) {
              fixedCount++;
          }
          return replacement;
      }
      
      return match;
    });

    return { text: fixedText, fixedCount };
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

  fixSpacing(text) {
    return text.replace(/\n{4,}/g, '\n\n\n');
  }
  fixBoldFormatting(text) {
    let oldText = text;
    let newText = text.replace(/\*\*(.*?)\*\*/gs, (match, inner) => {
      let cleaned = inner.trim();
      // Also remove any stray internal newlines that might break bold rendering in obsidian
      cleaned = cleaned.replace(/\s*\n\s*/g, ' ');
      return cleaned ? '**' + cleaned + '**' : '****';
    });
    return { text: newText, fixed: oldText !== newText };
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
