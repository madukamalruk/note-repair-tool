const mockObsidian = { Plugin: class {}, Notice: class {}, MarkdownView: class {} };
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
    if (path === 'obsidian') return mockObsidian;
    return originalRequire.apply(this, arguments);
};

const PluginClass = require('./main.js');
const plugin = new PluginClass({ workspace: {} });

// Test 1: Arrow inside label
const test1 = '```mermaid\nflowchart TD\n    D1 --> D2["ADC --> DSP --> DAC"]\n```';
const res1 = plugin.fixMermaid(test1);
console.log("=== Test 1: Arrows inside labels ===");
console.log(res1.text);
console.log("Fixed count:", res1.fixedCount);

// Test 2: Mindmap (should NOT remove empty lines)
const test2 = '```mermaid\nmindmap\n  root(("DSP"))\n    "Media & Tech"\n      "Multimedia (mp3, jpeg)"\n      "Compression"\n```';
const res2 = plugin.fixMermaid(test2);
console.log("\n=== Test 2: Mindmap indentation preserved ===");
console.log(res2.text);

// Test 3: Unquoted edge label
const test3 = '```mermaid\nflowchart LR\n    A -->|Y(z)| B\n```';
const res3 = plugin.fixMermaid(test3);
console.log("\n=== Test 3: Unquoted edge labels ===");
console.log(res3.text);

// Test 4: Table with == (Dataview fix)
const test4 = '| Operator | Meaning |\n| --- | --- |\n| == | Equal to |';
const res4 = plugin.fixDataviewConflicts(test4);
console.log("\n=== Test 4: Dataview == fix ===");
console.log(res4.text);

// Test 5: Full repairText to make sure nothing crashes
const fullTest = test1 + '\n\n' + test4;
const res5 = plugin.repairText(fullTest);
console.log("\n=== Test 5: Full repairText ===");
console.log(res5.summary);
console.log(res5.text);
