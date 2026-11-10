const { Plugin, Notice, MarkdownView, Modal, PluginSettingTab, Setting } = require('obsidian');

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

// V39: settings
const DEFAULT_SETTINGS = {
  autoRepairOnPaste: true,
  pasteThreshold: 400,
  showNotices: true,
};

class NoteRepairSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Note Repair Tool' });

    new Setting(containerEl)
      .setName('Repair automatically after pasting')
      .setDesc('When you paste a large block of text (for example a chunk from Gemini), the note is repaired right after the paste. One Ctrl+Z undoes it.')
      .addToggle(t => t
        .setValue(this.plugin.settings.autoRepairOnPaste)
        .onChange(async (v) => { this.plugin.settings.autoRepairOnPaste = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Paste size that triggers the repair')
      .setDesc('Number of characters. Small pastes (a word, a formula) never trigger it.')
      .addText(t => t
        .setValue(String(this.plugin.settings.pasteThreshold))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) { this.plugin.settings.pasteThreshold = n; await this.plugin.saveSettings(); }
        }));

    new Setting(containerEl)
      .setName('Show a notice after each repair')
      .setDesc('The notice lists what was fixed, the image slots left and the audit warnings.')
      .addToggle(t => t
        .setValue(this.plugin.settings.showNotices)
        .onChange(async (v) => { this.plugin.settings.showNotices = v; await this.plugin.saveSettings(); }));
  }
}

// V39: simple confirm dialog
class ConfirmModal extends Modal {
  constructor(app, title, lines, confirmText, onConfirm) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.title });
    for (const l of this.lines) contentEl.createEl('p', { text: l });
    const row = contentEl.createEl('div');
    const ok = row.createEl('button', { text: this.confirmText });
    ok.addEventListener('click', () => { this.close(); this.onConfirm(); });
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class NoteRepairToolPlugin extends Plugin {
  async onload() {
    console.log('Loading Note Repair Tool Plugin V45...');
    await this.loadSettings();
    this.addSettingTab(new NoteRepairSettingTab(this.app, this));

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

    this.addCommand({
      id: 'repair-folder',
      name: 'Repair all notes in this note\'s folder (with backups)',
      callback: () => {
        this.repairFolderCommand();
      }
    });

    // V39: repair right after a large paste (a chunk from Gemini). Never throws into Obsidian.
    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt, editor) => {
        try {
          if (!this.settings.autoRepairOnPaste) return;
          const pasted = evt && evt.clipboardData ? evt.clipboardData.getData('text/plain') : '';
          if (!pasted || pasted.length < this.settings.pasteThreshold) return;
          setTimeout(() => {
            try { this.repairEditor(editor, { auto: true }); } catch (e) { console.error('Note Repair Tool auto-repair failed', e); }
          }, 400);
        } catch (e) {
          console.error('Note Repair Tool paste hook failed', e);
        }
      })
    );

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

  repairEditor(editor, opts = {}) {
    const notify = (msg, ms) => { if (this.settings && this.settings.showNotices === false && opts.auto) return; new Notice(msg, ms); };
    const content = editor.getValue();
    if (!content || !content.trim()) {
      if (!opts.auto) new Notice('Note is empty!');
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
      const cursor = editor.getCursor();
      
      editor.replaceRange(
        result.text,
        { line: 0, ch: 0 },
        { line: lastLine, ch: lastLineLength }
      );
      
      try {
        const lines = editor.lastLine();
        editor.setCursor({ line: Math.min(cursor.line, lines), ch: 0 });
      } catch (e) { /* cursor restore is best effort */ }
      notify(`\u26A1 Note Repaired!\n${result.summary}${this.statusSuffix(editor)}`, 7000);
    } else if (!opts.auto) {
      new Notice(`\u2714 Note is already clean!${this.statusSuffix(editor)}`, 5000);
    }
  }

  // V40: run the pipeline until the text stops changing (fixers feed each other: removing a stray fence
  // exposes a table, splitting a callout leaves an empty '>', ...). This makes repairText idempotent by
  // construction: repairText(repairText(x).text).changed is always false.
  repairText(rawText) {
    // V43: a note that contains a longer fence (````) is a prompt library / documentation that shows other fences
    // and Markdown as examples. The fixers cannot tell example text from real content (and mangled such a file in
    // the vault), so it is left untouched.
    if (/^[ \t>]*`{4,}/m.test(rawText)) return { text: rawText, changed: false, summary: 'Skipped (contains ```` fences: prompt-style note)' };
    let text = rawText;
    let summary = '';
    let extra = 0;
    for (let pass = 0; pass < 6; pass++) {
      const r = this.repairPass(text);
      if (!r.changed) break;
      if (pass === 0) summary = r.summary; else extra++;
      text = r.text;
    }
    if (extra > 0) summary += ' (+' + extra + ' follow-up pass' + (extra > 1 ? 'es' : '') + ')';
    return { text, changed: text !== rawText, summary: summary || 'No fixes needed' };
  }

  repairPass(rawText) {
    let text = rawText;
    let changes = [];

    const track = (label, res, condition) => {
      if (condition) { text = res.text !== undefined ? res.text : text; changes.push(label); }
    };

    // 1. Normalize CRLF → LF
    const indentRes = this.fixIndentation(text);
    text = indentRes.text;
    if (indentRes.fixedCount > 0) changes.push('Fixed Indentation/Spacing');

    // 1a. V39: remove a stray ``` that flips all later code fences
    const strayRes = this.fixStrayFences(text);
    if (strayRes.fixedCount > 0) { text = strayRes.text; changes.push(`Removed ${strayRes.fixedCount} stray code fence(s)`); }

    // 1b. V36: strip AI source/citation leaks and pasted chunk-boundary lines
    const leakRes = this.fixLeaks(text);
    if (leakRes.fixedCount > 0) { text = leakRes.text; changes.push(`Removed ${leakRes.fixedCount} cite/source/chunk leaks`); }

    // 1c. V37: \( \) and \[ \] math delimiters do not render in Obsidian
    const mathDelimRes = this.fixMathDelimiters(text);
    if (mathDelimRes.fixedCount > 0) { text = mathDelimRes.text; changes.push('Converted \\( \\) / \\[ \\] math to $ / $$'); }

    // 1c2. V45: ">" inside wrapped math that Markdown read as a blockquote
    const gtMathRes = this.fixGreaterThanInMath(text);
    if (gtMathRes.fixedCount > 0) { text = gtMathRes.text; changes.push(`Rejoined ${gtMathRes.fixedCount} formulas split at a ">" sign`); }

    // 2. YAML fixes (blank line after YAML, cleanup)
    const yamlRes = this.fixYaml(text);
    if (yamlRes.fixed) { text = yamlRes.text; changes.push('Fixed YAML Frontmatter'); }

    // 2b. V36: fill the literal {{date:YYYY-MM-DD}} placeholder
    const dateRes = this.fixDatePlaceholder(text);
    if (dateRes.fixed) { text = dateRes.text; changes.push('Filled date placeholder'); }

    // 2.5 Horizontal Rules (prevent Setext H2 issues with tables)
    const hrRes = this.fixHorizontalRules(text);
    if (hrRes.fixed) { text = hrRes.text; changes.push('Spaced horizontal rules'); }

    // 2.9 V40: rows split across lines, blank-line splits, lost callout prefixes, | inside math
    const tableStructRes = this.fixTableStructure(text);
    if (tableStructRes.fixedCount > 0) { text = tableStructRes.text; changes.push(`Rebuilt ${tableStructRes.fixedCount} broken tables`); }

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

    // 6c. V40: math that makes MathJax show its error box (\left{, bare %, bare &, spaces inside $)
    const mjRes = this.fixMathJaxErrors(text);
    if (mjRes.fixedCount > 0) { text = mjRes.text; changes.push(`Fixed ${mjRes.fixedCount} MathJax error patterns`); }

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

    // 10c2. V44: heal display math that was damaged (stray $...$ inside, rows glued with ' > ', lost \,)
    const damagedMathRes = this.fixDamagedDisplayMath(text);
    if (damagedMathRes.fixedCount > 0) { text = damagedMathRes.text; changes.push(`Healed ${damagedMathRes.fixedCount} damaged math blocks`); }

    // 10c3. V44: STATUS lines: show the notation list literally
    const statusRes = this.fixStatusLines(text);
    if (statusRes.fixedCount > 0) { text = statusRes.text; changes.push('Protected STATUS notation lists'); }

    // 10d. Fix Obsidian block attribute stripping for \cline
    const blockAttrRes = this.fixMathJaxBlockAttributes(text);
    if (blockAttrRes.fixedCount > 0) { text = blockAttrRes.text; changes.push('Prevented Obsidian from stripping \\cline parameters'); }

    // 10e. V42: nested bold inside parentheses that left the outer bold open
    const nestedBoldRes = this.fixNestedBold(text);
    if (nestedBoldRes.fixedCount > 0) { text = nestedBoldRes.text; changes.push(`Closed ${nestedBoldRes.fixedCount} unbalanced bold spans`); }

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

    // 16. V40: LaTeX written as plain text
    const nakedRes = this.fixNakedLatex(text);
    if (nakedRes.fixedCount > 0) { text = nakedRes.text; changes.push(`Wrapped plain-text math in ${nakedRes.fixedCount} lines`); }

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

  // V40: only a REAL frontmatter block is touched. The old version took any "---" within the first 10 lines
  // (for example a horizontal rule) as the opening, threw away everything above it and stripped the "#" of
  // headings below it, which deleted the first paragraphs of notes without frontmatter.
  fixYaml(text) {
    const lines = text.split('\n');
    let openIdx = 0;
    while (openIdx < lines.length && lines[openIdx].trim() === '') openIdx++;
    if (openIdx >= lines.length || lines[openIdx].trim() !== '---') return { text, fixed: false };

    let closeIdx = -1;
    for (let i = openIdx + 1; i < Math.min(lines.length, openIdx + 31); i++) {
      if (lines[i].trim() === '---') { closeIdx = i; break; }
    }
    if (closeIdx === -1) return { text, fixed: false };

    const yamlBody = lines.slice(openIdx + 1, closeIdx);
    const keyRe = /^\s*(?:#+\s*)?(?:\*\*)?[A-Za-z_][\w\- ]*(?:\*\*)?\s*:/;
    const itemRe = /^\s*-\s+\S/;
    const contRe = /^\s+\S/;
    for (const l of yamlBody) {
      if (l.trim() === '') continue;
      if (!(keyRe.test(l) || itemRe.test(l) || contRe.test(l))) return { text, fixed: false };
    }

    let changed = openIdx > 0;
    const cleanBody = [];
    for (const l of yamlBody) {
      if (l.trim() === '') { changed = true; continue; }
      const stripped = l.replace(/^(\s*)#+\s*/, '$1');
      if (stripped !== l) changed = true;
      cleanBody.push(stripped);
    }
    if (!changed) return { text, fixed: false };

    return { text: ['---', ...cleanBody, '---', ...lines.slice(closeIdx + 1)].join('\n'), fixed: true };
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
            // V40: a row that already ends with a closing pipe is complete (ragged rows are legal); do not glue the next row to it
            const rowTerminated = t.endsWith('|') && !t.endsWith('\\|');
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
                  if (rowTerminated || this.countPipes(nextTClean) >= targetPipeCount) break;
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

      // V41: callouts are never collapsible: [!type]- and [!type]+ become [!type]
      if (!inCode) {
        const unfolded = line.replace(/^([ \t]*(?:>[ \t]*)+)\[!([a-zA-Z0-9_-]+)\][-+](?=\s|$)/, '$1[!$2]');
        if (unfolded !== line) { line = unfolded; fixedCount++; }
      }

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
          let fold = ''; // V41: never foldable
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
            .replace(/\\([a-zA-Z]+)/g, (m, n) => (n in symbols ? symbols[n] : m))
            .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, 'and');
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

    return { text: fixedText, fixedCount: fixedText === text ? 0 : fixedCount };
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
    let tikzRegex = /^([ \t>]*?)```(tikz|circuitikz|latex|tex)([\s\S]*?)```/gm;

    let fixedText = text.replace(tikzRegex, (match, prefix, tag, code0) => {
      // V43: structural problems that make TikZJax hang or fail (verified with the real TikZJax)
      let code = this.normalizeTikzEnvs(code0);
      if ((tag === 'tikz' || tag === 'circuitikz') && !/\\begin\{(?:tikzpicture|circuitikz)\}/.test(code)
          && !/\S/.test(code.replace(/\\(?:usepackage|usetikzlibrary|documentclass)(?:\[[^\]]*\])?\{[^}]*\}|\\(?:begin|end)\{document\}|%[^\n]*/g, ''))) {
        // An empty block (or one with only a preamble / empty document) never finishes compiling: endless spinner.
        fixedCount++;
        return '';
      }
      if (code !== code0) match = prefix + '```' + tag + code + '```';
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
          }).join('\n');

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

          let replacement = lines.join('\n');

          if (match !== replacement || code !== code0) {
              fixedCount++;
          }
          return replacement;
      }
      
      return match;
    });

    return { text: fixedText, fixedCount };
  }

  // V43: structural normalisation of a TikZ block's source.
  //  - circuitikz 1.0 has no 'elmech' / 'block' bipole -> 'generic'
  //  - \begin{circuitikz} ... \end{tikzpicture} (mismatched) -> end matches begin
  //  - tikzpicture that only wraps a circuitikz -> unwrap
  normalizeTikzEnvs(code) {
    let c = code.replace(/(\bto\[\s*)(elmech|block)(?=\s*[,\]])/g, '$1generic');
    c = c.replace(/\\begin\{tikzpicture\}(?:[ \t]*\[[^\]\n]*\])?\s*(\\begin\{circuitikz\}[\s\S]*?\\end\{circuitikz\})\s*\\end\{tikzpicture\}/, (m, inner) => inner);
    const b = c.match(/\\begin\{(tikzpicture|circuitikz)\}/);
    if (b && !new RegExp('\\\\end\\{' + b[1] + '\\}').test(c)) {
      const other = b[1] === 'circuitikz' ? 'tikzpicture' : 'circuitikz';
      const idx = c.lastIndexOf('\\end{' + other + '}');
      if (idx >= 0) c = c.slice(0, idx) + '\\end{' + b[1] + '}' + c.slice(idx + other.length + 6);
    }
    return c;
  }

  // V38: fixes for AI-written TikZ that is valid-looking but does not compile in TikZJax:
  //  - "top" / "bottom" are not TikZ placement keys (above / below are)
  //  - math written without $ inside node text (90^\circ, V_s, \Omega) -> "Missing $ inserted"
  //  - unescaped % and & inside node text (% starts a LaTeX comment and eats the closing brace)
  //  - circuitikz labels such as l=R_1 without $
  //  - bare = and , inside math of option lists (breaks the circuitikz 1.0 label parser)
  fixTikzBody(content) {
    let out = content.replace(/\[[^\[\]\n]*\]/g, opts => opts.replace(
      /(^\[|,)(\s*)(bottom|top)(\s+(?:left|right))?(?=\s*(?:,|\]))/g,
      (m, pre, sp, w, lr) => pre + sp + (w === 'top' ? 'above' : 'below') + (lr || '')
    ));

    // Verified in TikZJax (circuitikz 1.0): a bare '=' or ',' inside math in an option list breaks the key parser
    // even inside braces ("Extra }, or forgotten $"). '\mathrel{=}' and '{,}' are accepted.
    out = out.replace(/\[[^\[\]\n]*\]/g, opts => opts.replace(/\$([^$]*)\$/g, (m, inner) => '$' + inner.replace(
      /\\[^a-zA-Z]|\\mathrel\{=\}|\{,\}|=|,/g,
      t => (t === '=' ? '\\mathrel{=}' : t === ',' ? '{,}' : t)
    ) + '$'));

    // V43 (verified): a bare comma in the TEXT part of a circuitikz label (l={a, b}) is split as a new key
    // ("I do not know the key '/b'"). '{,}' is a safe comma.
    out = out.replace(/\[[^\[\]\n]*\]/g, opts => opts.replace(
      /\b((?:l|a|v|i|f)[_^]?|label)=\{((?:[^{}]|\{[^{}]*\})*)\}/g,
      (m, key, val) => key + '={' + val.split(/(\$[^$]*\$)/).map((seg, i) =>
        i % 2 ? seg : seg.replace(/\{,\}/g, '\u0000').replace(/,/g, '{,}').replace(/\u0000/g, '{,}')).join('') + '}'
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
    // textcomp is not bundled with TikZJax: \textbullet and friends hang the compiler (verified)
    text = text.replace(/\\text(bullet|degree|mu|ohm|times|pm)(?![A-Za-z])/g, (m, n) => ({ bullet: '$\\bullet$', degree: '$^\\circ$', mu: '$\\mu$', ohm: '$\\Omega$', times: '$\\times$', pm: '$\\pm$' })[n]);
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

  // V39: a stray bare ``` (often pasted from the AI chat UI, for example right after the YAML) opens a code
  // block that swallows the note and flips every later fence (diagrams then show as code, text as diagrams).
  // Signature: an UNTAGGED 3-backtick fence whose content looks like Markdown (headings, tables, callouts)
  // and which is followed by a TAGGED fence (```tikz, ```mermaid, ...) before it ever closes.
  fixStrayFences(text) {
    const lines = text.split('\n');
    const fenceRe = /^([ \t>]*)(`{3,})(.*)$/;
    const looksLikeMarkdown = (from, to) => {
      let score = 0;
      for (let i = from + 1; i < to; i++) {
        const l = lines[i].replace(/^[ \t>]*/, '');
        if (/^#{1,6} \S/.test(l) || /^\|.*\|\s*$/.test(lines[i].trim()) || /^\[!\w+\]/.test(l) || /^[*-] \*\*/.test(l)) score++;
      }
      return score >= 2;
    };
    let fixedCount = 0;
    for (let guard = 0; guard < 50; guard++) {
      let openIdx = -1;      // untagged block that is currently open
      let openLen = 0;
      let taggedLen = 0;     // length of the tagged fence that is currently open (0 = none)
      let stray = -1;
      for (let i = 0; i < lines.length && stray < 0; i++) {
        const m = lines[i].match(fenceRe);
        if (!m) continue;
        const len = m[2].length;
        const info = m[3].trim();
        if (taggedLen) { if (info === '' && len >= taggedLen) taggedLen = 0; continue; }
        if (openIdx >= 0) {
          if (info === '' && len >= openLen) { openIdx = -1; continue; }
          if (len === 3 && openLen === 3 && info !== '' && looksLikeMarkdown(openIdx, i)) stray = openIdx;
          continue;
        }
        if (info === '') { openIdx = i; openLen = len; } else { taggedLen = len; }
      }
      if (stray < 0) break;
      lines.splice(stray, 1);
      fixedCount++;
    }
    return { text: lines.join('\n'), fixedCount };
  }

  // ─── V39 ─────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Dry run: which notes of a folder (recursive) would change?
  async planFolderRepair(folderPath) {
    const prefix = folderPath ? folderPath.replace(/\/$/, '') + '/' : '';
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
    const plan = [];
    for (const file of files) {
      const orig = await this.app.vault.read(file);
      const res = this.repairText(orig);
      if (res.changed) plan.push({ file, orig, text: res.text, summary: res.summary });
    }
    return { total: files.length, plan };
  }

  async ensureDir(dir) {
    const adapter = this.app.vault.adapter;
    let cur = '';
    for (const part of dir.split('/')) {
      cur = cur ? cur + '/' + part : part;
      if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
    }
  }

  // Applies a plan. The original of every note is saved first, inside the plugin folder.
  async applyFolderRepair(plan) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pluginDir = (this.manifest && this.manifest.dir) || '.obsidian/plugins/note-repair-tool';
    const base = pluginDir + '/backups/' + stamp;
    let done = 0;
    for (const item of plan) {
      const target = base + '/' + item.file.path;
      await this.ensureDir(target.split('/').slice(0, -1).join('/'));
      await this.app.vault.adapter.write(target, item.orig);
      await this.app.vault.modify(item.file, item.text);
      done++;
    }
    return { done, backupDir: base };
  }

  async repairFolderCommand() {
    const active = this.app.workspace.getActiveFile();
    let folder = active && active.parent ? active.parent.path : '';
    if (folder === '/') folder = '';
    new Notice('Checking notes...');
    const { total, plan } = await this.planFolderRepair(folder);
    if (plan.length === 0) {
      new Notice(`✔ All ${total} notes in "${folder || 'the vault'}" are already clean.`);
      return;
    }
    const names = plan.slice(0, 12).map(p => '• ' + p.file.path.slice(folder ? folder.length + 1 : 0));
    if (plan.length > 12) names.push('... and ' + (plan.length - 12) + ' more');
    new ConfirmModal(
      this.app,
      'Repair notes in "' + (folder || 'the vault') + '"?',
      [plan.length + ' of ' + total + ' notes would change:', ...names, 'The original of every note is saved first in the plugin folder (backups).'],
      'Repair ' + plan.length + ' notes',
      async () => {
        try {
          const r = await this.applyFolderRepair(plan);
          new Notice(`⚡ Repaired ${r.done} notes.\nBackups: ${r.backupDir}`, 10000);
        } catch (e) {
          console.error(e);
          new Notice('Folder repair stopped: ' + e.message, 10000);
        }
      }
    ).open();
  }

  // ─── V40 ─────────────────────────────────────────────────────────────

  // Splits a table row on unescaped pipes (escaped \| stays inside the cell).
  splitRow(content) {
    const t = content.trim();
    const cells = [];
    let cur = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '\\' && t[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    if (cells.length && cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map(c => c.trim());
  }

  // A raw | inside $...$ splits the table cell. \vert renders the same bar.
  fixMathPipesInRow(content) {
    return content.replace(/\$([^$\n]*)\$/g, (m, inner) => ((/[\\^_{}]/.test(inner) || (/^\S+$/.test(inner) && inner.includes('|'))) ? '$' + inner.replace(/(?<!\\)\|/g, '\\vert ') + '$' : m));
  }

  // V40: repairs tables whose rows were broken by earlier tools or by the AI:
  //  - rows split over several lines (cells of one row on separate lines, or rows cut at the wrong pipe)
  //  - rows separated by blank lines (the table "splits")
  //  - rows inside a callout that lost the "> " prefix
  //  - trailing all-empty rows, raw | inside math
  // Well-formed tables are never touched, so the fixer is idempotent.
  fixTableStructure(text) {
    const lines = text.split('\n');
    const out = [];
    let fixedCount = 0;
    let inCode = false;
    const depth = (p) => (p.match(/>/g) || []).length;
    const isSepAt = (k) => k < lines.length && this.isSeparatorRow(this.extractPrefix(lines[k]).content.trim());

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const ext = this.extractPrefix(line);
      const c0 = ext.content.trim();
      if (c0.startsWith('```')) inCode = !inCode;
      if (inCode || !c0.startsWith('|') || !isSepAt(i + 1)) { out.push(line); i++; continue; }

      const prefix = ext.prefix;
      const N = this.splitRow(ext.content).length;
      let gluedToPrevious = false;
      if (out.length > 0) {
        const prev = this.extractPrefix(out[out.length - 1]).content.trim();
        if (prev.startsWith('|')) gluedToPrevious = true;
      }
      const sepExt = this.extractPrefix(lines[i + 1]);
      const sepPrefixOk = depth(sepExt.prefix) === depth(prefix);
      let j = i + 2;
      let gapAbsorbed = false;
      const rows = [];
      while (j < lines.length) {
        const e = this.extractPrefix(lines[j]);
        const c = e.content.trim();
        if (c === '') {
          let k = j;
          while (k < lines.length && this.extractPrefix(lines[k]).content.trim() === '') k++;
          if (k < lines.length) {
            const e2 = this.extractPrefix(lines[k]);
            const c2 = e2.content.trim();
            if (c2.startsWith('|') && !isSepAt(k + 1) && (depth(e2.prefix) === depth(prefix) || depth(e2.prefix) === 0)) { j = k; gapAbsorbed = true; continue; }
          }
          break;
        }
        if (!c.startsWith('|') || isSepAt(j + 1)) break;
        if (depth(e.prefix) !== depth(prefix) && depth(e.prefix) !== 0) break;
        rows.push({ content: e.content, prefix: e.prefix });
        j++;
      }

      let changed = gapAbsorbed;
      let body = rows.map(r => {
        const fixedContent = this.fixMathPipesInRow(r.content);
        if (fixedContent !== r.content) changed = true;
        if (r.prefix.replace(/\s+$/, '') !== prefix.replace(/\s+$/, '')) changed = true;
        return this.splitRow(fixedContent);
      });
      const originalCount = body.length;

      // trailing all-empty rows
      while (body.length && body[body.length - 1].every(c => c === '')) { body.pop(); changed = true; }

      // a row padded with empty cells, followed by one-cell rows: the cells of one row were put on separate lines
      if (N >= 2) {
        for (let r = 0; r < body.length; r++) {
          const padded = body[r].slice();
          while (padded.length < N) padded.push('');
          let need = 0;
          for (let c = padded.length - 1; c >= 0 && padded[c] === ''; c--) need++;
          if (need === 0 || need === padded.length) continue;
          let take = 0;
          while (take < need && r + 1 + take < body.length && body[r + 1 + take].length === 1 && body[r + 1 + take][0] !== '') take++;
          if (take === 0) continue;
          for (let t = 0; t < take; t++) padded[N - need + t] = body[r + 1 + t][0];
          body.splice(r + 1, take);
          body[r] = padded;
          changed = true;
        }
      }

      // rows cut at the wrong pipe: when many rows have the wrong width but all cells together fit the grid, re-chunk
      if (N >= 2 && body.length >= 3) {
        const wrong = body.filter(c => c.length !== N).length;
        const total = body.reduce((s, c) => s + c.length, 0);
        if (wrong >= 3 && wrong * 2 >= body.length && total % N === 0) {
          const stream = [].concat(...body);
          body = [];
          for (let k = 0; k < stream.length; k += N) body.push(stream.slice(k, k + N));
          changed = true;
        }
      }

      if (!changed && body.length === originalCount && !gluedToPrevious && sepPrefixOk) {
        for (let k = i; k < j; k++) out.push(lines[k]);
      } else {
        if (gluedToPrevious) out.push(prefix.replace(/\s+$/, ''));
        out.push(lines[i], sepPrefixOk ? lines[i + 1] : prefix + sepExt.content.trim());
        for (const cells of body) out.push(prefix + '| ' + cells.join(' | ') + ' |');
        fixedCount++;
      }
      i = j;
    }
    return { text: out.join('\n'), fixedCount };
  }

  // ─── V40: MathJax error prevention ───────────────────────────────────

  // Math that makes Obsidian's MathJax show the yellow error box, or silently cuts the formula:
  //   \left{ ... \right}  (needs \left\{ ... \right\}), an unescaped % (a TeX comment: the rest of the line is lost),
  //   a bare & outside any alignment environment ("Misplaced &"), spaces just inside the $ delimiters.
  fixMathJaxErrors(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    const envRe = /\\begin\{(?:aligned|align\*?|alignedat|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|split|gather\*?|gathered|eqnarray\*?|subarray|CD)\}/;
    const mathy = /[\\^_{}=]/;

    const sanitize = (m, hasEnv) => {
      let s = m;
      s = s.replace(/\\left\s*\{/g, '\\left\\{').replace(/\\right\s*\}/g, '\\right\\}');
      s = s.replace(/(?<!\\)%/g, '\\%');
      if (!hasEnv) s = s.replace(/(?<!\\)&/g, '\\&');
      // V45: \oiint / \oiiint (closed surface / volume integral) do not exist in MathJax ("Undefined control sequence")
      s = s.replace(/\\oiiint(?![A-Za-z])/g, () => '\\oint\\!\\!\\!\\!\\oint\\!\\!\\!\\!\\oint').replace(/\\oiint(?![A-Za-z])/g, () => '\\oint\\!\\!\\!\\!\\oint');
      return s;
    };

    let inCode = false;
    let yaml = lines[0] && lines[0].trim() === '---';
    let blockStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const bare = l.replace(/^[ \t>]*/, '');
      if (yaml) { if (i > 0 && l.trim() === '---') yaml = false; continue; }
      if (bare.startsWith('```')) { inCode = !inCode; continue; }
      if (inCode) continue;
      const noCode = bare.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
      const dd = (noCode.match(/\$\$/g) || []).length;

      if (blockStart >= 0) {
        if (dd % 2 === 1) {
          // block lines blockStart..i: the math is everything between the two $$ fences
          const hasEnv = envRe.test(lines.slice(blockStart, i + 1).join('\n'));
          const needsAligned = !hasEnv && lines.slice(blockStart, i + 1).some(x => /(?<!\\)&/.test(x.replace(/^[ \t>]*/, '').replace(/\$\$/g, '')));
          for (let k = blockStart; k <= i; k++) {
            const pre = lines[k].match(/^[ \t>]*/)[0];
            let body = lines[k].slice(pre.length);
            let mathPart = body;
            let head = '', tail = '';
            if (k === blockStart) { const p = body.indexOf('$$'); head = body.slice(0, p + 2); mathPart = body.slice(p + 2); }
            if (k === i) { const p = mathPart.lastIndexOf('$$'); tail = mathPart.slice(p); mathPart = mathPart.slice(0, p); }
            let fixed = sanitize(mathPart, true);
            if (needsAligned && k === blockStart) fixed = '\\begin{aligned}' + (fixed.trim() === '' ? '' : ' ') + fixed;
            if (needsAligned && k === i) fixed = fixed + (fixed.trim() === '' ? '' : ' ') + '\\end{aligned}';
            if (fixed !== mathPart) { lines[k] = pre + head + fixed + tail; fixedCount++; }
          }
          blockStart = -1;
        }
        continue;
      }
      if (dd % 2 === 1) { blockStart = i; if (dd > 1) { /* $$a$$ then an opening $$ on the same line: leave it */ } continue; }

      // single-line $$...$$ and inline $...$
      let line = l;
      let changed = false;
      line = line.replace(/\$\$([^$]+)\$\$/g, (m, inner) => {
        const hasEnv = envRe.test(inner);
        let f = sanitize(inner, true);
        if (!hasEnv && /(?<!\\)&/.test(f)) f = '\\begin{aligned} ' + f.trim() + ' \\end{aligned}';
        if (f !== inner) changed = true;
        return '$$' + f + '$$';
      });
      line = line.replace(/(?<![\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (m, inner) => {
        let f = inner;
        const looksMath = mathy.test(inner) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(inner.replace(/\\text\{[^}]*\}/g, ''));
        if (!looksMath) return m;
        if (/^\s|\s$/.test(f)) f = f.trim();
        f = sanitize(f, envRe.test(f));
        if (f !== inner) changed = true;
        return '$' + f + '$';
      });
      if (changed && line !== l) { lines[i] = line; fixedCount++; }
    }
    return { text: lines.join('\n'), fixedCount };
  }

  // ─── V40: LaTeX written as plain text ────────────────────────────────

  // "I_C = \beta I_B" in prose renders as raw text. Wrap each maximal math run in $...$.
  // Conservative: only lines without any $, outside code/math/YAML, and only runs that contain a known command or a short subscript/superscript.
  fixNakedLatex(text) {
    const cmds = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|frac|sqrt|sum|prod|int|infty|cdot|times|pm|mp|leq|geq|neq|approx|equiv|rightarrow|leftarrow|Rightarrow|Leftarrow|overline|bar|hat|vec|ldots|cdots|partial|nabla|mathrm|circ';
    const cmdRe = new RegExp('\\\\(?:' + cmds + ')(?![A-Za-z])');
    const scriptRe = /^(?:[A-Za-z]{1,2}\d*(?:_\{[^}]+\}|_[A-Za-z0-9]{1,3}|\^\{[^}]+\}|\^[A-Za-z0-9]{1,2})+)+[.,;:)]*$/;
    const opRe = /^[=+\-*/<>]+$/;
    const weakRe = /^(?:[A-Za-z]|\d+(?:\.\d+)?[A-Za-z]{0,2}|\([A-Za-z0-9+\-*/=^_ ]{1,12}\))$/;

    let fixedCount = 0;
    const lines = text.split('\n');
    let inCode = false, inMath = false;
    let yaml = lines[0] && lines[0].trim() === '---';
    const out = lines.map((l, idx) => {
      const pre = l.match(/^[ \t>]*/)[0];
      const bare = l.slice(pre.length);
      if (yaml) { if (idx > 0 && l.trim() === '---') yaml = false; return l; }
      if (bare.startsWith('```')) { inCode = !inCode; return l; }
      if (inCode) return l;
      if (/^STATUS:/.test(bare)) return l; // V44: the progress line is never "math" (its Notation list used to get wrapped in stray $)
      const dd = (bare.replace(/`[^`]*`/g, '').match(/\$\$/g) || []).length;
      if (dd % 2 === 1) { inMath = !inMath; return l; }
      if (inMath || dd > 0) return l;
      if (!/\\/.test(bare) && !/_|\^/.test(bare)) return l;
      if (/\$|\\\(|\\\[|\[\[|https?:\/\/|^\s{4,}|`/.test(bare) || /^\|?[\s:|-]+\|?$/.test(bare)) return l;
      if (!cmdRe.test(bare) && !/(^|\s)[A-Za-z]{1,2}\d*(?:_|\^)/.test(bare)) return l;

      // keep a list marker or heading marker outside the math
      const marker = (bare.match(/^(?:[-*+]|\d+[.)]|#{1,6})\s+/) || [''])[0];
      const body = bare.slice(marker.length);

      // tokens: split on whitespace at brace depth 0
      const tokens = [];
      let depth = 0, start = -1;
      for (let p = 0; p <= body.length; p++) {
        const ch = body[p];
        const ws = p === body.length || (depth === 0 && /\s/.test(ch));
        if (!ws) { if (start < 0) start = p; if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
        else if (start >= 0) { tokens.push({ s: start, e: p, t: body.slice(start, p) }); start = -1; }
      }
      const kind = (t) => {
        const core = t.replace(/[.,;:!?]+$/, '');
        if (cmdRe.test(core) && !/[඀-෿]/.test(core)) return 'strong';
        if (scriptRe.test(t)) return 'strong';
        if (opRe.test(core)) return 'op';
        if (weakRe.test(core)) return 'weak';
        return 'word';
      };
      const kinds = tokens.map(t => kind(t.t));
      let result = '';
      let last = 0;
      let k = 0;
      let did = false;
      while (k < tokens.length) {
        if (kinds[k] === 'word') { k++; continue; }
        let m = k;
        while (m < tokens.length && kinds[m] !== 'word') m++;
        // run is tokens k..m-1; trim leading/trailing operators
        let a = k, z = m - 1;
        while (a <= z && kinds[a] === 'op') a++;
        while (z >= a && kinds[z] === 'op') z--;
        const hasStrong = (() => { for (let q = a; q <= z; q++) if (kinds[q] === 'strong') return true; return false; })();
        if (a <= z && hasStrong) {
          // trailing punctuation stays outside the math
          let endPos = tokens[z].e;
          const trail = tokens[z].t.match(/[.,;:!?]+$/);
          if (trail && !/[{}]$/.test(tokens[z].t.slice(0, -trail[0].length))) endPos -= trail[0].length;
          result += body.slice(last, tokens[a].s) + '$' + body.slice(tokens[a].s, endPos) + '$';
          last = endPos;
          did = true;
        }
        k = m;
      }
      if (!did) return l;
      result += body.slice(last);
      fixedCount++;
      return pre + marker + result;
    });
    return { text: out.join('\n'), fixedCount };
  }

  // V42: NotebookLM writes "**A (**B**) C" : the outer bold is opened but never closed because a nested bold pair sits
  // inside parentheses. Drop the inner pair and close the outer one at the end of the sentence.
  fixNestedBold(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    let inCode = false;
    let inMath = false;
    const out = lines.map(l => {
      const bare = l.replace(/^[ \t>]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; return l; }
      if (inCode) return l;
      if (bare === '$$') { inMath = !inMath; return l; }
      if (inMath || !l.includes('**')) return l;
      const stash = [];
      const masked = l.replace(/`[^`\n]*`|\$\$[^\n]*?\$\$|\$[^$\n]+\$/g, m => { stash.push(m); return '\u0000' + (stash.length - 1) + '\u0000'; });
      const total = (masked.match(/\*\*/g) || []).length;
      if (total % 2 === 0) return l;
      // a parenthesised pair "(**X**)" that sits after an odd number of markers means an outer bold was left open:
      // close it right after the parenthesis.
      const re = /\(\*\*([^*\n]+?)\*\*\)/g;
      let hit = null, m;
      while ((m = re.exec(masked))) {
        if (((masked.slice(0, m.index).match(/\*\*/g) || []).length) % 2 === 1) { hit = m; break; }
      }
      if (!hit) return l;
      const fixed = masked.slice(0, hit.index) + '(' + hit[1] + ')**' + masked.slice(hit.index + hit[0].length);
      fixedCount++;
      return fixed.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
    });
    return { text: out.join('\n'), fixedCount };
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

  // V44: display math fenced by a LONE "$" line ("> $" ... "> $"), which Gemini often writes for block math, is turned into
  // "$$" ... "$$". The old version did replace('$', '$$'), and in a JavaScript replacement string '$$' means ONE '$',
  // so it never changed anything while still reporting a fix. Now it only converts properly PAIRED fences whose content looks
  // like math, in callouts and at the root, and also repairs a "$$" ... "$" mismatch.
  fixSingleDollarMathBlocks(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    const bareOf = l => l.replace(/^[ \t>]*/, '').trim();
    const isFence = b => b === '$' || b === '$$';
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].replace(/^[ \t>]*/, '').startsWith('```')) { inCode = !inCode; continue; }
      if (inCode) continue;
      if (!isFence(bareOf(lines[i]))) continue;
      let j = i + 1, paired = false, mathy = false;
      for (; j < lines.length && j - i <= 60; j++) {
        const b = bareOf(lines[j]);
        if (isFence(b)) { paired = true; break; }
        if (b === '' || /^#{1,6}\s/.test(b) || /^\[!/.test(b) || b.startsWith('```')) break;
        if (/[\\^_=]/.test(b)) mathy = true;
      }
      if (!paired) continue;
      if (bareOf(lines[i]) === '$$' && bareOf(lines[j]) === '$$') { i = j; continue; }
      if (mathy) {
        for (const k of [i, j]) {
          if (bareOf(lines[k]) === '$') { lines[k] = lines[k].replace('$', () => '$$'); fixedCount++; }
        }
      }
      i = j;
    }
    return { text: lines.join('\n'), fixedCount };
  }

  // V44: heals display math that earlier runs (or a lone-"$" fence) damaged: stray "$...$" pieces inside the block
  // ("\begin{aligned} > $\frac{a}{b}$ &= ..."), rows glued together with a literal " > " (a joined quoted line that kept its '>'),
  // and the thin space of "P\,dx" that was reduced to "P , dx". Only "$$" blocks are touched, and only when something is wrong.
  fixDamagedDisplayMath(text) {
    let fixedCount = 0;
    const clean = (s) => {
      const keep = [];
      let t = s.replace(/\\text\{[^{}]*\}/g, m => { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0002'; });
      const before = t;
      t = t.replace(/(\\\\)[ \t]*>[ \t]*/g, (m, a) => a + '\n');
      t = t.replace(/(\\begin\{[A-Za-z*]+\}(?:\{[^{}]*\})?)[ \t]*>[ \t]*/g, (m, a) => a + '\n');
      t = t.replace(/[ \t]*>[ \t]*(\\end\{[A-Za-z*]+\})/g, (m, a) => '\n' + a);
      t = t.replace(/^[ \t]*>[ \t]+/, '').replace(/[ \t]+>[ \t]*$/, '');
      t = t.replace(/(?<!\\)\$/g, '');
      if (t !== before) t = t.replace(/[ \t]+,[ \t]+(d[A-Za-z])(?![A-Za-z])/g, (m, d) => '\\,' + d);
      t = t.replace(/\u0001(\d+)\u0002/g, (m, n) => keep[+n]);
      return t;
    };
    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^([ \t>]*)([^\n]*)$/);
      const prefix = m[1];
      const bare = m[2].trim();
      if (bare.startsWith('```')) { inCode = !inCode; out.push(line); continue; }
      if (inCode) { out.push(line); continue; }
      // single-line display math: $$ ... $$
      if (bare.length > 4 && bare.startsWith('$$') && bare.endsWith('$$') && !bare.slice(2, -2).includes('$$')) {
        const inner = bare.slice(2, -2);
        const c = clean(inner);
        if (c !== inner) {
          fixedCount++;
          if (c.includes('\n')) {
            out.push(prefix + '$$');
            for (const l of c.split('\n')) if (l.trim()) out.push(prefix + l.trim());
            out.push(prefix + '$$');
          } else out.push(prefix + '$$ ' + c.trim() + ' $$');
          continue;
        }
        out.push(line);
        continue;
      }
      // fenced display math: $$ on its own line ... $$ on its own line
      if (bare === '$$') {
        let j = i + 1, closed = false;
        for (; j < lines.length && j - i <= 60; j++) {
          const b = lines[j].replace(/^[ \t>]*/, '').trim();
          if (b === '$$') { closed = true; break; }
          if (b === '' || /^#{1,6}\s/.test(b) || /^\[!/.test(b) || b.startsWith('```')) break;
        }
        if (closed) {
          const body = [];
          let changed = false;
          for (let k = i + 1; k < j; k++) {
            const content = lines[k].replace(/^[ \t>]*/, '');
            const c = clean(content);
            if (c !== content) changed = true;
            for (const l of c.split('\n')) if (l.trim()) body.push(prefix + l.trim());
          }
          out.push(line);
          if (changed) fixedCount++;
          if (changed) out.push(...body); else for (let k = i + 1; k < j; k++) out.push(lines[k]);
          out.push(lines[j]);
          i = j;
          continue;
        }
      }
      out.push(line);
    }
    return { text: out.join('\n'), fixedCount };
  }

  // V44: STATUS lines keep their raw LaTeX in "Notation [\text{lux}, F_s, ...]". Markdown eats the backslashes and italicises
  // the underscores, so the progress line looked like garbage. The notation list is shown literally (inline code).
  fixStatusLines(text) {
    let fixedCount = 0;
    const out = text.split('\n').map(line => {
      // also heals the damaged form  Notation $[\hat{i}, \nabla$, \text{div}, ...]  (stray $ from the old math wrapper)
      const m = line.match(/^([ \t>]*STATUS:[^\n]*?\bNotation )\$?\[([^\n]*?)\]((?: \| Next\b[^\n]*)?)$/);
      if (!m || m[2].includes('`') || !/[\\_^{$]/.test(m[2])) return line;
      fixedCount++;
      return m[1] + '[`' + m[2].replace(/(?<!\\)\$/g, '') + '`]' + m[3];
    });
    return { text: out.join('\n'), fixedCount };
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
    const citeRe = /[ \t]*\[cite(?::\s*[\d\s,\u2013-]*)?\]|\[cite_(?:start|end)\]/g;
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
  // V45: NotebookLM turns a ">" (greater than) inside math into a line break followed by ">" ("n + 1" / "> \frac{...}"),
  // which Markdown reads as a blockquote: the formula breaks and the rest of the paragraph is quoted. A line that starts with
  // ">" while the previous line left a $ or $$ formula OPEN is joined back with " > ", but only when the formula closes within
  // a few lines (never inside a real [!callout]), and the quote marks the break dragged onto the following lines are removed.
  fixGreaterThanInMath(text) {
    let fixedCount = 0;
    const state = (s, start) => {
      let st = start;
      const t = s.replace(/\\\$/g, '  ').replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== '$') continue;
        if (t[i + 1] === '$') { if (st === 2) st = 0; else if (st === 0) st = 2; i++; }
        else if (st === 1) st = 0; else if (st === 0) st = 1;
      }
      return st;
    };
    const unquote = l => l.replace(/^[ \t]*>[ \t]?/, '');
    const isHeader = l => /^[ \t]*>[ \t]*\[!/.test(l);
    const lines = text.split('\n');
    const out = [];
    let inCode = false, st = 0, stray = false, callout = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const t = line.trim();
      if (/^```/.test(t.replace(/^>\s*/, ''))) { inCode = !inCode; st = 0; out.push(line); continue; }
      if (inCode) { out.push(line); continue; }
      if (t === '') { st = 0; stray = false; callout = false; out.push(line); continue; }
      if (isHeader(line)) callout = true;
      if (stray && !callout && /^[ \t]*>/.test(line) && !isHeader(line)) line = unquote(line);
      if (st !== 0 && /^[ \t]*>/.test(lines[i]) && !isHeader(lines[i]) && (!callout || (st === 1 && /^[ \t]*>/.test(out[out.length - 1] || '')))) {
        let combined = out[out.length - 1], cur = st, k = i, ok = false;
        while (k < lines.length && k - i < 6 && /^[ \t]*>/.test(lines[k]) && !isHeader(lines[k])) {
          const piece = unquote(lines[k]).replace(/^\s+/, '');
          combined += ' > ' + piece;
          cur = state(piece, cur);
          k++;
          if (cur === 0) { ok = true; break; }
        }
        if (ok) {
          out[out.length - 1] = combined;
          fixedCount++;
          stray = !callout;
          st = 0;
          i = k - 1;
          continue;
        }
      }
      // a line that is only "$" or "$$" is a fence of a block formula, not an open inline formula
      st = /^[ \t>]*\${1,2}[ \t]*$/.test(line) ? 0 : state(line, st);
      out.push(line);
    }
    return { text: out.join('\n'), fixedCount };
  }

  // V45: a display formula that spans several lines and is delimited by \[ ... \] or \\[ ... \\] with the delimiters
  // glued to the first and last line of content ("\\[\begin{aligned}" ... "\end{aligned}\\]") becomes a real $$ block.
  // Obsidian prints such text raw ("\[\begin{aligned} ..."). Row spacings like \\[2pt] are left alone.
  fixMultilineDelimiters(text) {
    let fixedCount = 0;
    const lines = text.split('\n');
    const out = [];
    let inCode = false, inMath = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pre = line.match(/^[ \t>]*/)[0];
      const bare = line.slice(pre.length);
      if (bare.startsWith('```')) { inCode = !inCode; out.push(line); continue; }
      if (inCode) { out.push(line); continue; }
      const dd = (bare.replace(/`[^`]*`/g, '').match(/\$\$/g) || []).length;
      if (dd % 2 === 1) { inMath = !inMath; out.push(line); continue; }
      const m = !inMath && bare.match(/^(?:\\\\|\\)\[(?!\])([^\n]*)$/);
      if (m && !/(?:\\\\|\\)\]\s*$/.test(m[1]) && !/^\s*-?\d*\.?\d+\s*(?:pt|em|ex|cm|mm)\]/.test(m[1])) {
        let j = i + 1, close = null;
        for (; j < lines.length && j - i <= 60; j++) {
          const bj = lines[j].replace(/^[ \t>]*/, '');
          if (bj.trim() === '') break;
          const c = bj.match(/^([^\n]*?)(?:\\\\|\\)\]\$?\s*$/);
          if (c) { close = c; break; }
        }
        if (close) {
          out.push(pre + '$$');
          if (m[1].trim()) out.push(pre + m[1].trim());
          for (let k = i + 1; k < j; k++) out.push(lines[k]);
          if (close[1].trim()) out.push(pre + close[1].trim());
          out.push(pre + '$$');
          fixedCount++;
          i = j;
          continue;
        }
      }
      out.push(line);
    }
    return { text: out.join('\n'), fixedCount };
  }

  fixMathDelimiters(text) {
    const ml = this.fixMultilineDelimiters(text);
    let fixedCount = ml.fixedCount;
    text = ml.text;
    const lines = text.split('\n');
    let inCode = false;
    const out = lines.map(line => {
      const bare = line.replace(/^[>\s]*/, '');
      if (bare.startsWith('```')) { inCode = !inCode; return line; }
      if (inCode || !(/\\[()\[\]]/.test(line) || /<\/(?:aligned|align\*?|gathered|split|vmatrix|pmatrix|bmatrix|Bmatrix|matrix|cases|array)\}/.test(line))) return line;
      const prefix = (line.match(/^[>\s]*/) || [''])[0];
      // NotebookLM / escaped exports write the delimiters with a doubled backslash: \\( \\) \\[ \\]
      if (bare === '\\[' || bare === '\\]' || bare === '\\\\[' || bare === '\\\\]') { fixedCount++; return prefix + '$$'; }
      const isRow = bare.startsWith('|');

      const stash = [];
      const masked = line.replace(/`[^`\n]*`/g, m => {
        stash.push(m);
        return '\u0000' + (stash.length - 1) + '\u0000';
      });
      let l = masked.replace(/(?<!\\)\\\\\[(.+?)\\\\\]/g, (m, inner) => (isRow ? '$' + inner.trim() + '$' : '$$' + inner.trim() + '$$'));
      l = l.replace(/(?<!\\)\\\\\((.+?)\\\\\)/g, (m, inner) => '$' + inner.trim() + '$');
      l = l.replace(/(?<!\\)\\\[(.+?)(?<!\\)\\\]/g, (m, inner) => (isRow ? '$' + inner.trim() + '$' : '$$' + inner.trim() + '$$'));
      l = l.replace(/(?<!\\)\\\((.+?)(?<!\\)\\\)/g, (m, inner) => '$' + inner.trim() + '$');
      // V45: delimiters of different kinds on one line (NotebookLM mangles them): \\( ... \\]  and  \\[ ... \\)
      l = l.replace(/(?<!\\)(?:\\\\|\\)\((.+?)(?:\\\\|\\)\]/g, (m, inner) => '$' + inner.trim() + '$');
      l = l.replace(/(?<!\\)(?:\\\\|\\)\[(.+?)(?:\\\\|\\)\)/g, (m, inner) => (isRow ? '$' + inner.trim() + '$' : '$$' + inner.trim() + '$$'));
      // V45: "\end{aligned}" mangled into "</aligned}" (also vmatrix, pmatrix, cases, ...)
      l = l.replace(/<\/(aligned|align\*?|gathered|split|vmatrix|pmatrix|bmatrix|Bmatrix|matrix|cases|array)\}/g, (m, env) => '\\end{' + env + '}');
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
          if (codeLang === '') {
            // an untagged block full of Markdown is almost always a stray ``` that swallows the note
            let md = 0;
            for (let j = i + 1; j < lines.length && !/^[ \t>]*```\s*$/.test(lines[j]); j++) {
              if (/^[ \t>]*#{1,6} \S/.test(lines[j]) || /^\|.*\|\s*$/.test(lines[j].trim()) || /^[ \t>]*\[!\w+\]/.test(lines[j])) md++;
            }
            if (md >= 2) add(i, 'warn', 'untagged code block that contains Markdown: stray ``` fence? (run Repair)');
          }
          if (quoted && /^(mermaid|tikz|circuitikz|functionplot)/.test(codeLang)) add(i, 'info', `${codeLang} block inside a callout (renders only while every line keeps its '> ' prefix)`);
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


