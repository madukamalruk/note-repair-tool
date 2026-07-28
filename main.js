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

    // 1. Normalize line endings and indentation
    const indentRes = this.fixIndentation(text);
    text = indentRes.text;
    if (indentRes.fixedCount > 0) {
      changes.push(`Fixed Indentation/Spacing`);
    }

    // 2. YAML
    const yamlRes = this.fixYaml(text);
    text = yamlRes.text;
    if (yamlRes.fixed) {
      changes.push('Fixed YAML Frontmatter');
    }

    // 3. Tables
    const tableRes = this.fixTables(text);
    text = tableRes.text;
    if (tableRes.mergedRows > 0) {
      changes.push(`Merged ${tableRes.mergedRows} split table rows`);
    }

    // 4. Dataview
    const dataviewRes = this.fixDataviewConflicts(text);
    text = dataviewRes.text;
    if (dataviewRes.fixedCount > 0) {
      changes.push(`Fixed Dataview conflicts`);
    }

    // 5. Callouts
    const calloutRes = this.fixCallouts(text);
    text = calloutRes.text;
    if (calloutRes.fixedCount > 0) {
      changes.push(`Fixed ${calloutRes.fixedCount} callout math blocks`);
    }

    // 6. LaTeX
    const latexRes = this.fixLatex(text);
    text = latexRes.text;
    if (latexRes.fixedCount > 0) {
      changes.push(`Fixed LaTeX arrays`);
    }

    // 7. Mermaid
    const mermaidRes = this.fixMermaid(text);
    text = mermaidRes.text;
    if (mermaidRes.fixedCount > 0) {
      changes.push(`Fixed Mermaid diagrams`);
    }

    // 8. Highlights
    const highlightRes = this.fixBrokenHighlights(text);
    text = highlightRes.text;
    if (highlightRes.fixedCount > 0) {
      changes.push(`Fixed broken highlights`);
    }

    // 9. TikZ
    const tikzRes = this.fixTikz(text);
    text = tikzRes.text;
    if (tikzRes.fixedCount > 0) {
      changes.push(`Fixed TikZ diagrams`);
    }

    text = this.fixSpacing(text);

    const isChanged = text !== rawText;
    let summaryStr = changes.length > 0 ? changes.join(' | ') : 'No fixes needed';

    // 6. Formatting (Bold)
    const boldRes = this.fixBoldFormatting(text);
    if (boldRes.fixed) {
      text = boldRes.text;
      if (summaryStr.length > 0) summaryStr += ', ';
      summaryStr += 'Fixed broken bold markers';
    }

    // 3. Tables
    const tableResult = this.fixTables(text);
    if (tableResult.mergedRows > 0) {
      text = tableResult.text;
      if (summaryStr.length > 0) summaryStr += ', ';
      summaryStr += `Fixed ${tableResult.mergedRows} broken table rows`;
    }

    // 3.5 Callouts in Tables
    const calloutTableRes = this.fixCalloutsInTables(text);
    if (calloutTableRes.fixed) {
      text = calloutTableRes.text;
      if (summaryStr.length > 0) summaryStr += ', ';
      summaryStr += 'Extracted callouts from tables';
    }

    // 7. Youtube Links
    const ytRes = this.fixYoutubeLinks(text);
    if (ytRes.fixed) {
      text = ytRes.text;
      if (summaryStr.length > 0) summaryStr += ', ';
      summaryStr += 'Converted YouTube links to embeds';
    }

    return {
      text: text,
      changed: text !== rawText,
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

            if (t.startsWith('#') || t.startsWith('```') || t.startsWith('---')) break;

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
              
              if (nextT.startsWith('#') || nextT.startsWith('```') || nextT.startsWith('---')) break;
              
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
                  if (cells.length > 0) {
                    cells[cells.length - 1] += ' ' + newParts[0];
                    if (newParts.length > 1) {
                      cells.push(...newParts.slice(1));
                    }
                  } else {
                    cells.push(...newParts);
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
                if (cells.length > 0) {
                  cells[cells.length - 1] += ' ' + parts[0];
                  if (parts.length > 1) cells.push(...parts.slice(1));
                } else {
                  cells.push(...parts);
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

  fixCalloutsInTables(text) {
    let lines = text.split('\n');
    let out = [];
    let fixedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let t = line.trim();
      
      if (t.startsWith('|')) {
        let parts = line.split('|');
        if (parts.length > 1) {
          let firstCell = parts[1].trim();
          if (firstCell.match(/^\[!(note|info|todo|warning|caution|danger|error|bug|tip|hint|success|check|done|question|help|faq|example|quote|cite)\]/i)) {
            let content = line.replace(/^\s*\|\s*/, '');
            content = content.replace(/(\s*\|\s*)+$/, '');
            out.push(`> ${content}`);
            fixedCount++;
            continue;
          }
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
      let isMindmap = code.trim().startsWith('mindmap');

      let fixedLines = lines.map(line => {
        // V3 Fix: Strip trailing invisible characters (like spaces after quotes) 
        // which cause "Expecting 'SPACELINE', 'NL', 'EOF', got 'NODE_ID'" parsing errors in Mermaid
        let l = line.trimEnd();

        // V5 Fix: Obsidian escapes quotes in mindmap diagrams to &quot; causing render errors
        if (isMindmap && l.includes('"')) {
          l = l.replace(/"/g, '');
          fixedCount++;
        }

        // V6 Fix: Replace bare + and - and "+", "-" nodes to avoid rendering as lists in Obsidian
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*"?\+"?\s*\)\)/g, '$1(("Add"))');
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*"?\-"?\s*\)\)/g, '$1(("Sub"))');
        l = l.replace(/([a-zA-Z0-9_]+)\(\(\s*([\+\-\*\/])\s*\)\)/g, '$1(("$2"))');

        l = l.replace(/-->\s*\|([^"|\n]+)\|/g, (m, label) => {
          let trimmed = label.trim();
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) return m;
          fixedCount++;
          return `-->|"${trimmed}"|`;
        });

        if (l.includes('\\cdot') || l.includes('\\times') || l.includes('\\frac')) {
          l = l.replace(/\\cdot/g, '·');
          l = l.replace(/\\times/g, '×');
          l = l.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2');
          fixedCount++;
        }

        // V4 Fix: Prevent Obsidian from rendering "Unsupported markdown: list" when a node starts with "1. "
        if (l.match(/\["\d+\.\s/)) {
          l = l.replace(/\["(\d+)\.\s/g, '["($1) ');
          fixedCount++;
        }

        return l;
      });

      return '```mermaid\n' + fixedLines.filter(fl => fl !== '').join('\n') + '\n```';
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
      let originalCode = code;
      
      // The obsidian-tikzjax plugin (artisticat1 fork) requires \begin{document}
      let envMatch = code.match(/\\begin\{(tikzpicture|circuitikz)\}([\s\S]*?)(\\end\{\1\})/);
      
      if (envMatch) {
          let envName = envMatch[1];
          let envContent = envMatch[2];
          let envEnd = envMatch[3];
          
          // Fix unsupported pattern attribute by replacing it with a solid fill
          envContent = envContent.replace(/pattern=[^,\]]+/g, 'fill=gray!50');
          
          let p = prefix ? prefix : '';
          let newCode = `\n${p}\\usepackage{circuitikz}\n${p}\\usepackage{amsmath}\n${p}\\begin{document}\n${p}\\begin{${envName}}${envContent}${envEnd}\n${p}\\end{document}\n${p}`;
          
          let replacement = `${p}\`\`\`tikz${newCode}\`\`\``;
          
          if (match !== replacement) {
              fixedCount++;
          }
          return replacement;
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
