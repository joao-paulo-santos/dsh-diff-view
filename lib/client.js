/**
 * dsh-diff-view - browser half.
 *
 * Provides the `diffView` client service: a reusable two-text diff for ANY
 * plugin — the engine (line LCS + intra-line word spans) and a
 * self-contained component (line numbers, context collapse, split/unified
 * toggle, own stylesheet). Zero coupling to any consumer.
 *
 *   ctx.diffView.diffRowsComponent({ title, before, after,
 *                                     initialMode, showToggle }) -> Component
 *   ctx.diffView.engine.alignedEditRowsOf(beforeLines, afterLines) -> rows
 *   ctx.diffView.engine.wordSpansOfLinePair(beforeLine, afterLine) -> spans
 *   ctx.diffView.engine.wordSpanElements(spans, highlightClass) -> elements
 *
 * Numbering contract: line numbers are computed for EVERY row BEFORE the
 * context collapse runs, so numbers stay true across ellipsis bands (the
 * v0.1 standalone view in dsh-approval-diff numbered after collapse and
 * drifted — that defect is what this plugin exists to fix).
 */
window.__ModuleLoader__.load({ id: 'dsh-diff-view', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  const React = require('react')

  // ---- engine: line-level LCS -------------------------------------------
  const lcsOperationList = (beforeItems, afterItems, itemsEqual, areaCap) => {
    const beforeCount = beforeItems.length
    const afterCount = afterItems.length
    if (beforeCount * afterCount > areaCap) return null
    const widths = afterCount + 1
    const table = new Int32Array((beforeCount + 1) * widths)
    for (let beforeIndex = beforeCount - 1; beforeIndex >= 0; beforeIndex--) {
      for (let afterIndex = afterCount - 1; afterIndex >= 0; afterIndex--) {
        table[beforeIndex * widths + afterIndex] = itemsEqual(beforeItems[beforeIndex], afterItems[afterIndex])
          ? table[(beforeIndex + 1) * widths + afterIndex + 1] + 1
          : Math.max(
            table[(beforeIndex + 1) * widths + afterIndex],
            table[beforeIndex * widths + afterIndex + 1])
      }
    }
    const operations = []
    let beforeIndex = 0
    let afterIndex = 0
    while (beforeIndex < beforeCount && afterIndex < afterCount) {
      if (itemsEqual(beforeItems[beforeIndex], afterItems[afterIndex])) {
        operations.push('=')
        beforeIndex += 1
        afterIndex += 1
      } else if (table[(beforeIndex + 1) * widths + afterIndex]
        >= table[beforeIndex * widths + afterIndex + 1]) {
        operations.push('-')
        beforeIndex += 1
      } else {
        operations.push('+')
        afterIndex += 1
      }
    }
    while (beforeIndex < beforeCount) { operations.push('-'); beforeIndex += 1 }
    while (afterIndex < afterCount) { operations.push('+'); afterIndex += 1 }
    return operations
  }

  /**
   * Aligned diff rows between two line arrays:
   *   'same'    identical line -> neutral context on BOTH sides;
   *   'replace' a removed line paired with an added one (intra-line word
   *             diff available via wordSpansOfLinePair);
   *   'delete'  removed only; 'insert' added only (the shorter side pads).
   * Line-level LCS; a size-cap fallback pairs index-wise without word diff
   * (still a real diff: trailing extras become pure delete/insert rows).
   */
  const alignedEditRowsOf = (removedLines, addedLines) => {
    const operations = lcsOperationList(removedLines, addedLines, (a, b) => a === b, 4000000)
    const rows = []
    const removedRun = []
    const addedRun = []
    const flushRun = () => {
      const pairCount = Math.min(removedRun.length, addedRun.length)
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
        rows.push({ kind: 'replace', removedLine: removedRun[pairIndex], addedLine: addedRun[pairIndex] })
      }
      for (let extraIndex = pairCount; extraIndex < removedRun.length; extraIndex++) {
        rows.push({ kind: 'delete', removedLine: removedRun[extraIndex] })
      }
      for (let extraIndex = pairCount; extraIndex < addedRun.length; extraIndex++) {
        rows.push({ kind: 'insert', addedLine: addedRun[extraIndex] })
      }
      removedRun.length = 0
      addedRun.length = 0
    }
    if (operations === null) {
      const pairCount = Math.min(removedLines.length, addedLines.length)
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
        rows.push({ kind: 'replace', removedLine: removedLines[pairIndex], addedLine: addedLines[pairIndex] })
      }
      for (let extraIndex = pairCount; extraIndex < removedLines.length; extraIndex++) {
        rows.push({ kind: 'delete', removedLine: removedLines[extraIndex] })
      }
      for (let extraIndex = pairCount; extraIndex < addedLines.length; extraIndex++) {
        rows.push({ kind: 'insert', addedLine: addedLines[extraIndex] })
      }
      return rows
    }
    let beforeIndex = 0
    let afterIndex = 0
    for (const operation of operations) {
      if (operation === '=') {
        flushRun()
        rows.push({ kind: 'same', removedLine: removedLines[beforeIndex], addedLine: addedLines[afterIndex] })
        beforeIndex += 1
        afterIndex += 1
      } else if (operation === '-') {
        removedRun.push(removedLines[beforeIndex])
        beforeIndex += 1
      } else {
        addedRun.push(addedLines[afterIndex])
        afterIndex += 1
      }
    }
    flushRun()
    return rows
  }

  // ---- engine: intra-line word spans -------------------------------------

  /** One line's word tokens: each word with its trailing whitespace attached. */
  const wordTokensOf = (line) => {
    const tokens = String(line).match(/\S+\s*/g)
    return tokens === null ? [] : tokens
  }

  /**
   * Intra-line word spans for one replaced line pair: tokens outside the
   * sides' word LCS carry `changed` and get the strong word highlight
   * (red on the removed word, green on the added word) while unchanged
   * words stay plain. Size-cap fallback marks the whole line changed.
   * @returns `{ removedSpans, addedSpans }` — arrays of `{ text, changed }`.
   */
  const wordSpansOfLinePair = (removedLine, addedLine) => {
    const removedTokens = wordTokensOf(removedLine)
    const addedTokens = wordTokensOf(addedLine)
    const tokenKey = (token) => token.replace(/\s+$/, '')
    const operations = lcsOperationList(removedTokens, addedTokens, (a, b) => tokenKey(a) === tokenKey(b), 250000)
    if (operations === null) {
      return {
        removedSpans: [{ text: String(removedLine), changed: true }],
        addedSpans: [{ text: String(addedLine), changed: true }],
      }
    }
    const removedSpans = []
    const addedSpans = []
    let beforeIndex = 0
    let afterIndex = 0
    for (const operation of operations) {
      if (operation === '=') {
        removedSpans.push({ text: removedTokens[beforeIndex], changed: false })
        addedSpans.push({ text: addedTokens[afterIndex], changed: false })
        beforeIndex += 1
        afterIndex += 1
      } else if (operation === '-') {
        removedSpans.push({ text: removedTokens[beforeIndex], changed: true })
        beforeIndex += 1
      } else {
        addedSpans.push({ text: addedTokens[afterIndex], changed: true })
        afterIndex += 1
      }
    }
    return { removedSpans, addedSpans }
  }

  /** Render word spans: changed tokens get the strong highlight class, unchanged stay plain text. */
  const wordSpanElements = (spans, highlightClass) => spans.map((span, spanIndex) => (span.changed
    ? React.createElement('span', { key: 'w' + spanIndex, className: highlightClass }, span.text)
    : span.text))

  // ---- the standalone diff component --------------------------------------

  // CONTEXT COLLAPSE: runs of unchanged rows longer than 2*CONTEXT+1
  // collapse to CONTEXT rows on each end with an ellipsis band in the
  // middle; no leading context at the top, no trailing at the bottom.
  // Without this a one-line change in a long text renders as a wall of
  // neutral rows.
  const DIFF_CONTEXT_LINE_COUNT = 3

  const DiffRowsView = (props) => {
    const [mode, setMode] = React.useState(props.initialMode === 'unified' ? 'unified' : 'split')
    const rows = alignedEditRowsOf(
      String(props.before === undefined || props.before === null ? '' : props.before).split('\n'),
      String(props.after === undefined || props.after === null ? '' : props.after).split('\n'),
    )

    // Number EVERY row first (old-side / new-side), then collapse — the
    // collapse skips rows for DISPLAY only and must not skew numbering.
    const oldNumbers = new Array(rows.length)
    const newNumbers = new Array(rows.length)
    let oldCounter = 0
    let newCounter = 0
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      oldNumbers[index] = row.kind === 'insert' ? undefined : (oldCounter += 1)
      newNumbers[index] = row.kind === 'delete' ? undefined : (newCounter += 1)
    }

    const CONTEXT = DIFF_CONTEXT_LINE_COUNT
    const kept = new Array(rows.length).fill(false)
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].kind === 'same') continue
      for (let near = Math.max(0, index - CONTEXT); near <= Math.min(rows.length - 1, index + CONTEXT); near += 1) {
        kept[near] = true
      }
    }

    const cells = []
    let cellRow = 0

    const lineContentWithSpans = (row, side) => {
      if (row.kind !== 'replace') {
        return row.kind === 'same' ? row.removedLine : (row.kind === 'delete' ? row.removedLine : row.addedLine)
      }
      const spans = wordSpansOfLinePair(row.removedLine, row.addedLine)
      return wordSpanElements(side === 'removed' ? spans.removedSpans : spans.addedSpans, side === 'removed' ? 'adf-w-del' : 'adf-w-add')
    }

    const pushSplitRow = (row, index) => {
      cellRow += 1
      const gridRow = String(cellRow)
      cells.push(React.createElement('div', { key: 'ln-l-' + cellRow, className: 'adf-num', style: { gridColumn: '1', gridRow } },
        oldNumbers[index] === undefined ? '' : String(oldNumbers[index])))
      cells.push(React.createElement('div', {
        key: 'lc-l-' + cellRow,
        className: 'adf-cell ' + (row.kind === 'delete' || row.kind === 'replace' ? 'adf-del' : row.kind === 'insert' ? 'adf-dim' : 'adf-ctx'),
        style: { gridColumn: '2', gridRow },
      }, lineContentWithSpans(row, 'removed')))
      cells.push(React.createElement('div', { key: 'ln-r-' + cellRow, className: 'adf-num', style: { gridColumn: '3', gridRow } },
        newNumbers[index] === undefined ? '' : String(newNumbers[index])))
      cells.push(React.createElement('div', {
        key: 'lc-r-' + cellRow,
        className: 'adf-cell ' + (row.kind === 'insert' || row.kind === 'replace' ? 'adf-add' : row.kind === 'delete' ? 'adf-dim' : 'adf-ctx'),
        style: { gridColumn: '4', gridRow },
      }, lineContentWithSpans(row, 'added')))
    }

    const pushUnifiedRow = (row, index) => {
      cellRow += 1
      const gridRow = String(cellRow)
      const isDelete = row.kind === 'delete'
      const isInsert = row.kind === 'insert'
      const number = isDelete ? oldNumbers[index] : newNumbers[index]
      cells.push(React.createElement('div', { key: 'un-' + cellRow, className: 'adf-num', style: { gridColumn: '1', gridRow } },
        row.kind === 'same' ? String(newNumbers[index]) : isDelete ? String(number) : String(newNumbers[index])))
      cells.push(React.createElement('div', { key: 'us-' + cellRow, className: 'adf-sign', style: { gridColumn: '2', gridRow } }, isDelete ? '-' : isInsert ? '+' : ''))
      cells.push(React.createElement('div', {
        key: 'uc-' + cellRow,
        className: 'adf-cell ' + (isDelete ? 'adf-del' : isInsert ? 'adf-add' : 'adf-ctx'),
        style: { gridColumn: '3', gridRow },
      }, lineContentWithSpans(row, isDelete ? 'removed' : 'added')))
    }

    const pushRow = (row, index) => (mode === 'unified' ? pushUnifiedRow(row, index) : pushSplitRow(row, index))

    const pushEllipsis = () => {
      cellRow += 1
      cells.push(React.createElement('div', {
        key: 'gap-' + cellRow, className: 'adf-cell adf-ctx adf-ellipsis',
        style: { gridColumn: '1 / -1', gridRow: String(cellRow) },
      }, '\u22ef'))
    }
    let index = 0
    while (index < rows.length) {
      if (kept[index]) { pushRow(rows[index], index); index += 1; continue }
      while (index < rows.length && !kept[index]) index += 1
      if (index < rows.length) pushEllipsis()
    }

    const grid = React.createElement('div', {
      className: mode === 'unified' ? 'adf-diffview-grid adf-grid-unified' : 'adf-diffview-grid',
    }, cells)

    const showToggle = props.showToggle !== false
    const toggle = showToggle ? React.createElement('div', {
      className: 'adf-viewtoggle',
      role: 'group',
      'aria-label': 'Diff view mode',
    },
    React.createElement('button', {
      type: 'button',
      className: 'adf-viewbtn' + (mode === 'split' ? ' adf-viewbtn-active' : ''),
      title: 'Split view — old and new side by side',
      'aria-pressed': mode === 'split' ? 'true' : 'false',
      onClick: () => { setMode('split') },
    }, 'Split'),
    React.createElement('button', {
      type: 'button',
      className: 'adf-viewbtn' + (mode === 'unified' ? ' adf-viewbtn-active' : ''),
      title: 'Unified view — one column with - and + lines',
      'aria-pressed': mode === 'unified' ? 'true' : 'false',
      onClick: () => { setMode('unified') },
    }, 'Unified')) : null

    return React.createElement('div', { className: 'adf-diffview' },
      toggle !== null ? React.createElement('div', { className: 'adf-diffview-bar' }, toggle) : null,
      grid)
  }

  const diffViewService = {
    /** A component rendering before|after with the shared engine.
     *  options: { title?, before, after, initialMode?, showToggle? }
     *  (title is accepted for interface stability; consumers render their
     *  own header around the component.) */
    diffRowsComponent(options) {
      if (options === null || typeof options !== 'object') throw new Error('diffView.diffRowsComponent: options object required')
      if (typeof options.before !== 'string' || typeof options.after !== 'string') {
        throw new Error('diffView.diffRowsComponent: before and after strings required')
      }
      const before = options.before
      const after = options.after
      const initialMode = options.initialMode
      const showToggle = options.showToggle
      return (props) => DiffRowsView({ ...props, before, after, initialMode, showToggle })
    },
    /** The raw engine, for consumers that render rows themselves
     *  (inline diffs, custom layouts). */
    engine: { lcsOperationList, alignedEditRowsOf, wordSpansOfLinePair, wordSpanElements },
  }

  // Diff-render stylesheet: grid, cells, highlights, toggle. The approval
  // panel's own chrome (composer, tabs, buttons) lives in dsh-approval-diff.
  const DIFF_CSS = [
    '.adf-viewtoggle{display:inline-flex;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;overflow:hidden}',
    '.adf-viewbtn{font:inherit;font-size:11px;line-height:1;padding:5px 9px;cursor:pointer;color:var(--dsw-alias-label-tertiary);background:transparent;border:none}',
    '.adf-viewbtn:hover{color:var(--dsw-alias-label-primary)}',
    '.adf-viewbtn-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
    '.adf-grid{display:grid;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;align-content:start}',
    '.adf-grid-twoside{grid-template-columns:4ch 1fr 4ch 1fr}',
    '.adf-grid-oneside{grid-template-columns:4ch 1fr}',
    '.adf-grid-unified{grid-template-columns:4ch 1.5ch 1fr}',
    '.adf-sign{padding:0 2px 0 4px;text-align:center;color:var(--dsw-alias-label-dimmed);user-select:none}',
    '.adf-num{padding:0 6px 0 10px;text-align:right;color:var(--dsw-alias-label-dimmed);user-select:none;white-space:pre}',
    '.adf-cell{min-width:0;padding:0 16px 0 6px;white-space:pre-wrap;word-break:break-all}',
    '.adf-del{background:rgba(248,81,73,.13)}',
    '.adf-add{background:rgba(63,185,80,.13)}',
    '.adf-pad{background:transparent}',
    '.adf-same{background:transparent}',
    '.adf-ctx{background:transparent;color:var(--dsw-alias-label-tertiary)}',
    '.adf-ellipsis{opacity:.6;text-align:center;user-select:none}',
    '.adf-hunkgap{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-dimmed);border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11px;font-style:italic;padding:2px 0;user-select:none}',
    '.adf-queued{opacity:.62}',
    '.adf-w-del{background:rgba(248,81,73,.45);border-radius:3px}',
    '.adf-w-add{background:rgba(63,185,80,.45);border-radius:3px}',
    '.adf-dim{display:flex;align-items:center;justify-content:center;font-style:italic;color:var(--dsw-alias-label-dimmed)}',
    '.adf-diffview{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
    '.adf-diffview-grid{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;display:grid;grid-template-columns:44px 1fr 44px 1fr;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.55;align-content:start}',
    '.adf-diffview-grid.adf-grid-unified{grid-template-columns:44px 22px 1fr}',
    '.adf-diffview-bar{flex:none;display:flex;justify-content:flex-end;padding:0 10px 8px}',
  ].join('')

  module.exports = {
    name: 'diff-view-client',
    inject: [],
    apply(ctx) {
      ctx.provide('diffView', diffViewService)
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-diff-view'
      tag.textContent = DIFF_CSS
      document.head.appendChild(tag)
      return () => {
        try { tag.remove() } catch (e) {}
      }
    },
  }
  return module.exports
} })
