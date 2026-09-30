# dsh-diff-view

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
plugin: a reusable two-text diff viewer for client plugins, styled after the
harness's native changed-files review. Hunk headers, true line numbers on
both sides, split or unified, word-level highlights, and optional syntax
highlighting through the same engine the native review uses.

There is no UI of its own to visit. Plugins inject the client service
`diffView`:

```js
// consumer client half, inject: ['diffView', …]

// 1. A FileDiff-styled component from two whole texts:
const Diff = ctx.diffView.diffFileComponent({
  path: 'src/a.ts',        // optional; selects the syntax grammar
  before: oldText,         // either before/after strings…
  after: newText,
  // …or pass precomputed hunks at render time instead:
  // hunks: ctx.diffView.hunksOf(oldText, newText)
  initialMode: 'split',    // 'split' (default) | 'unified'
  showToggle: true,        // false hides the Split/Unified pill
  wrap: false,             // true wraps long lines instead of scrolling
  wordHighlights: true,    // false disables per-word marks
})
return React.createElement(Diff, {})

// Controlled mode (the consumer owns the toggle): pass mode/onModeChange
// as render props, or hand hunks in per render:
Diff({ mode: 'unified', hunks })

// 2. Hunks in the native WorkspaceDiffHunk shape:
const hunks = ctx.diffView.hunksOf(oldText, newText)
//   [{ oldStart, oldLines, newStart, newLines, lines: [' ctx', '-old', '+new'] }]

// 3. The raw engine, for custom layouts:
const rows = ctx.diffView.engine.alignedEditRowsOf(beforeLines, afterLines)
//   rows: [{ kind: 'same'|'replace'|'delete'|'insert', removedLine?, addedLine? }]
const spans = ctx.diffView.engine.wordSpansOfLinePair(beforeLine, afterLine)
//   spans: { removedSpans, addedSpans }: arrays of { text, changed }
ctx.diffView.engine.wordSpanElements(spans.removedSpans, 'ddv-w-del')
```

## Contract

- Hunks follow the native `WorkspaceDiffHunk` shape, plus one extension:
  `unnumbered: true` draws no header and no numbers, for changes whose true
  position is unknown. Never lying numbers.
- Line numbers come from the diff itself, before any collapse, so they stay
  true across hunk boundaries.
- Syntax highlighting reuses the `useCodeHighlighter` /
  `languageForPath` primitives from the platform seed module, so colors match
  the native review. Without a path, or without the primitives, lines render
  plain. Word highlights never depend on the primitives.
- View mode is per component instance unless the consumer controls it.
- The `ddv-*` stylesheet is installed once by this plugin; consumers render
  no CSS of their own for diff rows.
- No persistence; no approval coupling; the host half is a stub.

## How to install

Requires a DeepSeek Harness checkout and a profile, here `web`. The plugin
has no dependencies:

```sh
mkdir -p ~/dsh-plugins && cd ~/dsh-plugins
git clone https://github.com/joao-paulo-santos/dsh-diff-view.git

# from the harness checkout
pnpm dsh plugin --profile web add ~/dsh-plugins/dsh-diff-view

# verify the profile still composes
pnpm dsh --profile web --dump-config
```

Restart the harness. Plugins that inject the `diffView` service can now
render diffs.

## Dependencies

*(none)*

## Plugins dependent on this

- [dsh-approval-diff](https://github.com/joao-paulo-santos/dsh-approval-diff) renders its approval-card hunks with `diffFileComponent` and the engine
- [dsh-scratchpad](https://github.com/joao-paulo-santos/dsh-scratchpad) powers its `mode: 'diff'` pads with `diffFileComponent` (optional; degrades to plain text when absent)
- [dsh-wo-github](https://github.com/joao-paulo-santos/dsh-wo-github) renders commit patches with `diffFileComponent` (optional; falls back to the raw patch text)
