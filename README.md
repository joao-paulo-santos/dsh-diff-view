# dsh-diff-view

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
plugin: a reusable two-text diff viewer for client plugins. One engine, one
stylesheet, no coupling to any consumer: line-level LCS with intra-line word
highlights, true line numbers across context collapse, and a split/unified
toggle.

There is no UI of its own to visit. Plugins inject the client service
`diffView`:

```js
// consumer client half, inject: ['diffView', …]

// 1. A self-contained component (scrolls its own body, own grid):
const Diff = ctx.diffView.diffRowsComponent({
  title: 'File.txt',        // optional, for interface symmetry
  before: oldText,          // required string
  after: newText,           // required string
  initialMode: 'split',     // 'split' (default) | 'unified'
  showToggle: true,         // false hides the Split/Unified pill
})
return React.createElement(Diff, {})

// 2. The raw engine, for custom layouts (inline diffs, lists of hunks):
const rows = ctx.diffView.engine.alignedEditRowsOf(beforeLines, afterLines)
//   rows: [{ kind: 'same'|'replace'|'delete'|'insert', removedLine?, addedLine? }]
const spans = ctx.diffView.engine.wordSpansOfLinePair(beforeLine, afterLine)
//   spans: { removedSpans, addedSpans }: arrays of { text, changed }
ctx.diffView.engine.wordSpanElements(spans.removedSpans, 'adf-w-del')
```

## Contract

- `diffRowsComponent` validates at the door: an options object and
  `before`/`after` strings are required; anything else throws.
- Line numbers are computed for every row BEFORE context collapse runs, so
  numbers stay true across ellipsis bands. (The view this plugin extracts
  numbered after collapse and drifted; that defect is why it exists.)
- View mode is per component instance: two diffs on screen toggle
  independently.
- The `adf-*` diff stylesheet is installed once by this plugin; consumers
  render no CSS of their own for diff rows.
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

- [dsh-approval-diff](https://github.com/joao-paulo-santos/dsh-approval-diff) renders its review cards' hunks with the engine and shares the diff stylesheet
- [dsh-scratchpad](https://github.com/joao-paulo-santos/dsh-scratchpad) powers its `mode: 'diff'` pads with `diffRowsComponent` (optional; degrades to plain text when absent)
- [dsh-wo-github](https://github.com/joao-paulo-santos/dsh-wo-github) renders commit patches with word highlights and the diff grid stylesheet (optional; patches render without it)
