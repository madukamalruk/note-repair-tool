# TikZJax check

Renders every TikZ block of a folder of notes with the **real TikZJax engine** (the one inside your `obsidian-tikzjax` plugin) in a browser, and reports which blocks fail. It is how the TikZ fixes of V38 were validated: a normal LaTeX install is not enough, because TikZJax ships its own circuitikz 1.0 and misses packages such as `textcomp`.

## Run

```bash
cd tools/tikzjax-check
node unwrap.js                      # extract the browser script from ../../../obsidian-tikzjax/main.js
node mktests.js "<notes folder>"    # tests.json, blocks repaired by the plugin (add "raw" to test them as they are)
node server.js                      # serves the harness on http://localhost:8765
```

Open `http://localhost:8765/harness.html` in any browser (3 diagrams render in parallel, about 3 seconds each). When the page says `ALL DONE`, run:

```bash
node report.js                      # prints failures with the TeX error and line
```

`unwrap.js` also accepts the path to `main.js` as an argument or the `TIKZJAX_MAIN` environment variable.

## What it found (V38)

- In TikZJax's circuitikz 1.0 a bare `=` or `,` inside math in an option list breaks the label parser, even inside braces. `\mathrel{=}` and `{,}` work.
- `\textbullet` (textcomp is not bundled) makes the compiler hang.
- `l=R_1` without `$` fails; `top` / `bottom` are not TikZ keys.

The generated files (`tikzjax.js`, `tests.json`, `result_*.json`) are ignored by git.
