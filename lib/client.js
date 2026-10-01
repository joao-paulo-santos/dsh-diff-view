/**
 * dsh-diff-view - browser half.
 *
 * Provides the `diffView` client service: a reusable two-text diff for ANY
 * plugin — the engine (line LCS + intra-line word spans) and a diff
 * component styled after the harness's native FileDiff review surface
 * (hunk headers, per-side line numbers, add/del gutter tints, optional
 * Shiki syntax highlighting). Zero coupling to any consumer.
 *
 *   ctx.diffView.diffFileComponent({ path?, hunks? | before?/after?,
 *                                     initialMode?, showToggle?, wrap?,
 *                                     wordHighlights?, scroll? }) -> Component
 *   ctx.diffView.hunksOf(before, after, context?) -> WorkspaceDiffHunk[]
 *   ctx.diffView.engine.alignedEditRowsOf(beforeLines, afterLines) -> rows
 *   ctx.diffView.engine.wordSpansOfLinePair(beforeLine, afterLine) -> spans
 *   ctx.diffView.engine.wordSpanElements(spans, highlightClass) -> elements
 *
 * Hunks follow the native `WorkspaceDiffHunk` shape ({oldStart, oldLines,
 * newStart, newLines, lines}) plus one extension: `unnumbered: true` marks a
 * hunk whose numbers would be guesses (operands not located on disk); such
 * hunks draw no header and no numbers — never lying numbers.
 *
 * Syntax highlighting reuses the platform seed module
 * '@deepseek-ai/dsh-client-ui-primitives' (useCodeHighlighter /
 * languageForPath) — the exact machinery the native review tab uses. When
 * that module is unavailable the component falls back to plain text.
 */
window.__ModuleLoader__.load({ id: 'dsh-diff-view', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  const React = require('react')

  // Platform primitives are a frozen seed word; a sandbox or older harness
  // without them still gets a working plain-text diff.
  let Primitives = null
  try { Primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch (e) { Primitives = null }

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

  // ---- hunks: the native WorkspaceDiffHunk shape ---------------------------

  const HUNK_CONTEXT_LINES = 3

  /**
   * Flatten aligned rows into unified ops (dels before adds inside each
   * change run) with true old/new numbers on every op.
   */
  const opsOfRows = (rows) => {
    const ops = []
    const dels = []
    const adds = []
    let oldCount = 0
    let newCount = 0
    const flush = () => {
      for (const text of dels) ops.push({ kind: 'del', old: (oldCount += 1), text })
      for (const text of adds) ops.push({ kind: 'add', new: (newCount += 1), text })
      dels.length = 0
      adds.length = 0
    }
    for (const row of rows) {
      if (row.kind === 'same') {
        flush()
        oldCount += 1
        newCount += 1
        ops.push({ kind: 'ctx', old: oldCount, new: newCount, text: row.removedLine })
      } else if (row.kind === 'delete') dels.push(row.removedLine)
      else if (row.kind === 'insert') adds.push(row.addedLine)
      else { dels.push(row.removedLine); adds.push(row.addedLine) }
    }
    flush()
    return ops
  }

  /**
   * Group numbered ops into hunks: every op within `context` lines of a
   * change is kept; runs of kept ops become hunks. Header starts fall back
   * to the old/new line counts consumed before the hunk (git's `-k,0`
   * convention for pure insertions).
   */
  const hunksOfOps = (ops, context) => {
    const keep = new Array(ops.length).fill(false)
    for (let index = 0; index < ops.length; index += 1) {
      if (ops[index].kind === 'ctx') continue
      for (let near = Math.max(0, index - context); near <= Math.min(ops.length - 1, index + context); near += 1) {
        keep[near] = true
      }
    }
    // Prefix counters: old/new lines consumed before each op index.
    const oldBefore = new Array(ops.length + 1)
    const newBefore = new Array(ops.length + 1)
    oldBefore[0] = 0
    newBefore[0] = 0
    for (let index = 0; index < ops.length; index += 1) {
      oldBefore[index + 1] = ops[index].old !== undefined ? ops[index].old : oldBefore[index]
      newBefore[index + 1] = ops[index].new !== undefined ? ops[index].new : newBefore[index]
    }
    const hunks = []
    let index = 0
    while (index < ops.length) {
      if (!keep[index]) { index += 1; continue }
      const start = index
      while (index < ops.length && keep[index]) index += 1
      const slice = ops.slice(start, index)
      const firstOld = slice.find((op) => op.old !== undefined)
      const firstNew = slice.find((op) => op.new !== undefined)
      hunks.push({
        oldStart: firstOld !== undefined ? firstOld.old : oldBefore[start],
        oldLines: slice.filter((op) => op.old !== undefined).length,
        newStart: firstNew !== undefined ? firstNew.new : newBefore[start],
        newLines: slice.filter((op) => op.new !== undefined).length,
        lines: slice.map((op) => (op.kind === 'del' ? '-' : op.kind === 'add' ? '+' : ' ') + op.text),
      })
    }
    return hunks
  }

  /**
   * Hunks between two whole texts: our LCS engine numbered, then grouped
   * with {@link HUNK_CONTEXT_LINES} context. The result matches the native
   * `WorkspaceDiffHunk` contract, so consumers can render or forward it.
   */
  const hunksOf = (before, after, context) => {
    const beforeLines = String(before === undefined || before === null ? '' : before).split('\n')
    const afterLines = String(after === undefined || after === null ? '' : after).split('\n')
    return hunksOfOps(opsOfRows(alignedEditRowsOf(beforeLines, afterLines)),
      context === undefined ? HUNK_CONTEXT_LINES : context)
  }

  // ---- the diff component (native FileDiff look) ---------------------------

  /** Number a hunk's lines: context counts on both sides, del/add on one.
   *  `src` carries the index into hunk.lines so interactive consumers can
   *  map a rendered +/- row back to its patch line. */
  const hunkRows = (hunk) => {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    return hunk.lines.map((line, src) => {
      const text = line.slice(1)
      if (line[0] === '+') return { kind: 'add', old: undefined, new: hunk.unnumbered ? undefined : newNo++, text, src }
      if (line[0] === '-') return { kind: 'del', old: hunk.unnumbered ? undefined : oldNo++, new: undefined, text, src }
      return { kind: 'ctx', old: hunk.unnumbered ? undefined : oldNo++, new: hunk.unnumbered ? undefined : newNo++, text, src }
    })
  }

  /**
   * Pair a hunk's rows for the side-by-side view: each deletion run aligns
   * with the addition run that follows it, row by row; context sits on both
   * sides. Paired del/add rows also carry intra-line word spans.
   */
  const splitRowsOfHunk = (rows, wantWords) => {
    const out = []
    let dels = []
    let adds = []
    const flush = () => {
      const pairs = Math.min(dels.length, adds.length)
      for (let at = 0; at < pairs; at += 1) {
        out.push({
          left: dels[at], right: adds[at],
          words: wantWords ? wordSpansOfLinePair(dels[at].text, adds[at].text) : undefined,
        })
      }
      for (let at = pairs; at < dels.length; at += 1) out.push({ left: dels[at] })
      for (let at = pairs; at < adds.length; at += 1) out.push({ right: adds[at] })
      dels = []
      adds = []
    }
    for (const row of rows) {
      if (row.kind === 'del') dels.push(row)
      else if (row.kind === 'add') adds.push(row)
      else {
        flush()
        out.push({ left: row, right: row })
      }
    }
    flush()
    return out
  }

  /** Pair unified rows for word highlights: i-th del with i-th add of a run. */
  const wordPairsOfHunk = (rows) => {
    const pairs = new Map()
    let dels = []
    let adds = []
    const flush = () => {
      const count = Math.min(dels.length, adds.length)
      for (let at = 0; at < count; at += 1) {
        pairs.set(dels[at], wordSpansOfLinePair(dels[at].text, adds[at].text).removedSpans)
        pairs.set(adds[at], wordSpansOfLinePair(dels[at].text, adds[at].text).addedSpans)
      }
      dels = []
      adds = []
    }
    for (const row of rows) {
      if (row.kind === 'del') dels.push(row)
      else if (row.kind === 'add') adds.push(row)
      else flush()
    }
    flush()
    return pairs
  }

  /** Shiki spans per line number for one side (old or new), or undefined. */
  const sideHighlights = (rows, side, highlighter) => {
    if (highlighter === undefined) return undefined
    const source = []
    for (const row of rows) {
      const no = row[side]
      if (no !== undefined) source.push({ no, text: row.text })
    }
    if (source.length === 0) return new Map()
    const highlighted = highlighter(source.map((line) => line.text).join('\n'))
    if (highlighted === undefined) return undefined
    return new Map(source.map((line, index) => [line.no, highlighted[index] ?? []]))
  }

  /**
   * Intersect syntax spans with word spans: each output piece carries the
   * syntax style of its origin and the changed flag of the word run that
   * covers it, so a recolored token can still show its word-level edit.
   */
  const mergeSpans = (syntax, words, wordClass) => {
    const out = []
    let syntaxIndex = 0
    let wordIndex = 0
    let syntaxOffset = 0
    let wordOffset = 0
    const push = (text, style, changed) => {
      if (text === '') return
      if (changed) out.push(React.createElement('span', { key: 'm' + out.length, className: wordClass, style }, text))
      else if (style !== undefined) out.push(React.createElement('span', { key: 'm' + out.length, style }, text))
      else out.push(text)
    }
    while (syntaxIndex < syntax.length && wordIndex < words.length) {
      const syntaxSpan = syntax[syntaxIndex]
      const wordSpan = words[wordIndex]
      const length = Math.min(syntaxSpan.text.length - syntaxOffset, wordSpan.text.length - wordOffset)
      push(syntaxSpan.text.slice(syntaxOffset, syntaxOffset + length), syntaxSpan.style, wordSpan.changed)
      syntaxOffset += length
      wordOffset += length
      if (syntaxOffset >= syntaxSpan.text.length) { syntaxIndex += 1; syntaxOffset = 0 }
      if (wordOffset >= wordSpan.text.length) { wordIndex += 1; wordOffset = 0 }
    }
    for (; syntaxIndex < syntax.length; syntaxIndex += 1) {
      push(syntaxSpanText(syntax, syntaxIndex, syntaxOffset), syntax[syntaxIndex].style, false)
      syntaxOffset = 0
    }
    for (; wordIndex < words.length; wordIndex += 1) {
      const rest = words[wordIndex].text.slice(wordOffset)
      push(rest, undefined, words[wordIndex].changed)
      wordOffset = 0
    }
    return out
  }
  const syntaxSpanText = (syntax, index, offset) => syntax[index].text.slice(offset)

  /** One diff body cell's content: plain text, word spans, syntax spans, or both intersected. */
  const textElements = (text, syntaxSpans, wordSpans, wordClass) => {
    if (syntaxSpans === undefined && wordSpans === undefined) return text
    if (syntaxSpans === undefined) return wordSpanElements(wordSpans, wordClass)
    if (wordSpans === undefined) {
      return syntaxSpans.map((span, index) => (span.style !== undefined
        ? React.createElement('span', { key: 's' + index, style: span.style }, span.text)
        : span.text))
    }
    return mergeSpans(syntaxSpans, wordSpans, wordClass)
  }

  const hunkHeader = (hunk) => '@@ -' + hunk.oldStart + ',' + hunk.oldLines
    + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'

  const DiffFileView = (props) => {
    const hunks = Array.isArray(props.hunks) ? props.hunks : []
    const wantWords = props.wordHighlights !== false
    const wrap = props.wrap === true
    const scroll = props.scroll !== false
    const showToggle = props.showToggle !== false
    const [innerMode, setInnerMode] = React.useState(props.initialMode === 'unified' ? 'unified' : 'split')
    const mode = props.mode !== undefined ? props.mode : innerMode
    const setMode = props.onModeChange !== undefined ? props.onModeChange : setInnerMode

    const language = Primitives !== null && Primitives.languageForPath !== undefined
      && typeof props.path === 'string' ? Primitives.languageForPath(props.path) : undefined
    const highlighter = Primitives !== null && Primitives.useCodeHighlighter !== undefined
      ? Primitives.useCodeHighlighter(language) : undefined

    const sections = hunks.map((hunk, hunkIndex) => {
      const rows = hunkRows(hunk)
      const oldSide = sideHighlights(rows, 'old', highlighter)
      const newSide = sideHighlights(rows, 'new', highlighter)
      // Optional line picking (interactive staging surfaces): +/− lines
      // become clickable; the consumer decides what a pick means.
      const pickable = typeof props.onLineToggle === 'function'
      const pickProps = (row) => {
        if (!pickable || row.kind === 'ctx') return { className: '', onClick: undefined }
        const isPicked = props.isLinePicked !== undefined && props.isLinePicked(hunkIndex, row.src) === true
        return {
          onClick: () => { props.onLineToggle(hunkIndex, row.src) },
          className: ' ddv-pickable' + (isPicked ? ' ddv-picked' : ''),
        }
      }
      const children = []
      if (hunk.unnumbered !== true) {
        children.push(React.createElement('div', { key: 'hh', className: 'ddv-hunkheader' }, hunkHeader(hunk)))
      }
      if (mode === 'split') {
        for (const paired of splitRowsOfHunk(rows, wantWords)) {
          const left = paired.left
          const right = paired.right
          const leftKind = left === undefined ? 'empty' : left.kind === 'ctx' ? 'ctx' : left.kind
          const rightKind = right === undefined ? 'empty' : right.kind === 'ctx' ? 'ctx' : right.kind
          const leftWords = wantWords && paired.words !== undefined ? paired.words.removedSpans : undefined
          const rightWords = wantWords && paired.words !== undefined ? paired.words.addedSpans : undefined
          const leftPick = left === undefined ? {} : pickProps(left)
          const rightPick = right === undefined ? {} : pickProps(right)
          children.push(React.createElement('div', {
            key: 'r' + children.length,
            className: 'ddv-splitline ddv-srow-' + (leftKind === 'del' ? 'del' : rightKind === 'add' ? 'add' : 'ctx'),
          },
          React.createElement('span', { key: 'l', className: 'ddv-cell ddv-side-' + leftKind + leftPick.className, onClick: leftPick.onClick },
            React.createElement('span', { key: 'n', className: 'ddv-num' }, left === undefined || left.old === undefined ? '' : String(left.old)),
            React.createElement('span', { key: 't', className: 'ddv-text' },
              textElements(left === undefined ? '' : left.text,
                left === undefined || left.old === undefined ? undefined : oldSide?.get(left.old),
                leftWords, 'ddv-w-del'))),
          React.createElement('span', { key: 'r', className: 'ddv-cell ddv-side-' + rightKind + rightPick.className, onClick: rightPick.onClick },
            React.createElement('span', { key: 'n', className: 'ddv-num' }, right === undefined || right.new === undefined ? '' : String(right.new)),
            React.createElement('span', { key: 't', className: 'ddv-text' },
              textElements(right === undefined ? '' : right.text,
                right === undefined || right.new === undefined ? undefined : newSide?.get(right.new),
                rightWords, 'ddv-w-add')))))
        }
      } else {
        const wordPairs = wantWords ? wordPairsOfHunk(rows) : undefined
        for (const row of rows) {
          const words = wordPairs !== undefined ? wordPairs.get(row) : undefined
          const spans = row.kind === 'add'
            ? (row.new === undefined ? undefined : newSide?.get(row.new))
            : (row.old === undefined ? undefined : oldSide?.get(row.old))
          const pick = pickProps(row)
          children.push(React.createElement('div', { key: 'r' + children.length, className: 'ddv-line ddv-row-' + row.kind + pick.className, onClick: pick.onClick },
            React.createElement('span', { key: 'on', className: 'ddv-num' }, row.old === undefined ? '' : String(row.old)),
            React.createElement('span', { key: 'nn', className: 'ddv-num' }, row.new === undefined ? '' : String(row.new)),
            React.createElement('span', { key: 'sg', className: 'ddv-sign' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''),
            React.createElement('span', { key: 'tx', className: 'ddv-text' },
              textElements(row.text, spans, words, row.kind === 'del' ? 'ddv-w-del' : 'ddv-w-add'))))
        }
      }
      return React.createElement('section', { key: 'h' + hunkIndex, className: 'ddv-hunk' }, children)
    })

    const toggle = showToggle
      ? React.createElement('div', { className: 'ddv-togglebar' },
        React.createElement('button', {
          type: 'button',
          className: 'ddv-toggle' + (mode === 'split' ? ' ddv-toggle-active' : ''),
          title: 'Split view: old and new side by side',
          'aria-pressed': mode === 'split' ? 'true' : 'false',
          onClick: () => { setMode('split') },
        }, 'Split'),
        React.createElement('button', {
          type: 'button',
          className: 'ddv-toggle' + (mode === 'unified' ? ' ddv-toggle-active' : ''),
          title: 'Unified view: one column with - and + lines',
          'aria-pressed': mode === 'unified' ? 'true' : 'false',
          onClick: () => { setMode('unified') },
        }, 'Unified'))
      : null

    return React.createElement('div', {
      className: 'ddv-root',
      'data-ddv-mode': mode,
      'data-ddv-wrap': wrap || undefined,
      'data-ddv-scroll': scroll ? undefined : 'off',
    },
    toggle !== null ? React.createElement('div', { className: 'ddv-togglewrap' }, toggle) : null,
    React.createElement('div', { className: 'ddv-body' }, sections))
  }

  const isHunk = (value) => value !== null && typeof value === 'object'
    && Array.isArray(value.lines) && value.lines.every((line) => typeof line === 'string')

  const diffViewService = {
    /** The FileDiff-styled component over precomputed hunks or two texts.
     *  options: { path?, hunks? | before? + after?, initialMode?, mode?,
     *             onModeChange?, showToggle?, wrap?, wordHighlights?, scroll? } */
    diffFileComponent(options) {
      if (options === null || typeof options !== 'object') throw new Error('diffView.diffFileComponent: options object required')
      let hunks = options.hunks
      if (hunks !== undefined && (!Array.isArray(hunks) || !hunks.every(isHunk))) {
        throw new Error('diffView.diffFileComponent: hunks must be WorkspaceDiffHunk[]')
      }
      if (hunks === undefined && (options.before !== undefined || options.after !== undefined)) {
        if (typeof options.before !== 'string' || typeof options.after !== 'string') {
          throw new Error('diffView.diffFileComponent: before and after strings required')
        }
        hunks = hunksOf(options.before, options.after)
      }
      // Render-time props win over creation options, so a consumer can pass
      // fresh hunks or a controlled mode on every render.
      return (props) => {
        const effective = Array.isArray(props.hunks) ? props.hunks : hunks
        if (effective === undefined) {
          throw new Error('diffView.diffFileComponent: hunks required (at creation or render)')
        }
        return DiffFileView({ ...options, ...props, hunks: effective })
      }
    },
    /** Hunks in the native WorkspaceDiffHunk shape between two texts. */
    hunksOf,
    /** The raw engine, for consumers that build rows or hunks themselves
     *  (merged multi-edit reviews, custom layouts). */
    engine: { lcsOperationList, alignedEditRowsOf, wordSpansOfLinePair, wordSpanElements },
  }

  // Diff-render stylesheet mirroring the native review surface: hunk headers,
  // 3.5em number gutters with tinted fills and inset markers, 22px rows.
  const DIFF_CSS = [
    '.ddv-root{display:flex;flex-direction:column;box-sizing:border-box;width:100%;min-width:0;min-height:0;color:var(--dsw-alias-label-primary)}',
    '.ddv-togglewrap{display:flex;flex:0 0 auto;justify-content:flex-end;padding:2px 8px 4px}',
    '.ddv-togglebar{display:inline-flex;border:0.5px solid var(--dsw-alias-border-l3);border-radius:7px;overflow:hidden}',
    '.ddv-toggle{font:inherit;font-size:11px;line-height:1;padding:4px 9px;cursor:pointer;color:var(--dsw-alias-label-tertiary);background:transparent;border:none}',
    '.ddv-toggle:hover{color:var(--dsw-alias-label-primary)}',
    '.ddv-toggle-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
    '.ddv-body{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;min-width:0;overflow:auto;padding:8px 0 12px;font:var(--dsw-font-markdown-code-block)}',
    '.ddv-root[data-ddv-scroll="off"] .ddv-body{overflow:visible}',
    '.ddv-hunk{margin-bottom:8px}',
    '.ddv-hunk:last-child{margin-bottom:0}',
    '.ddv-hunkheader{padding:4px 16px;color:var(--dsw-alias-label-tertiary);white-space:pre;user-select:none}',
    '.ddv-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);box-sizing:border-box;min-height:22px;line-height:22px;white-space:pre}',
    '.ddv-splitline{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre}',
    '.ddv-cell{display:grid;grid-template-columns:3.5em minmax(0,1fr);box-sizing:border-box;min-width:0}',
    '.ddv-cell + .ddv-cell{border-left:0.5px solid var(--dsw-alias-border-l3)}',
    '.ddv-num{padding-right:8px;color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none}',
    '.ddv-sign{text-align:center;user-select:none}',
    '.ddv-text{padding-right:16px;min-width:0}',
    '.ddv-root[data-ddv-wrap] .ddv-line,.ddv-root[data-ddv-wrap] .ddv-splitline{white-space:pre-wrap}',
    '.ddv-root[data-ddv-wrap] .ddv-text{overflow-wrap:anywhere}',
    '.ddv-row-add{--ddv-gutter:var(--dsw-alias-file-diff-added-gutter);--ddv-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}',
    '.ddv-row-del{--ddv-gutter:var(--dsw-alias-file-diff-deleted-gutter);--ddv-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}',
    '.ddv-row-add .ddv-num,.ddv-row-del .ddv-num{background:var(--ddv-gutter);color:var(--ddv-marker)}',
    '.ddv-row-add .ddv-num:first-child,.ddv-row-del .ddv-num:first-child{box-shadow:inset 3px 0 0 var(--ddv-marker)}',
    '.ddv-row-add .ddv-sign,.ddv-row-del .ddv-sign{color:var(--ddv-marker)}',
    '.ddv-side-add{--ddv-gutter:var(--dsw-alias-file-diff-added-gutter);--ddv-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}',
    '.ddv-side-del{--ddv-gutter:var(--dsw-alias-file-diff-deleted-gutter);--ddv-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}',
    '.ddv-side-add .ddv-num,.ddv-side-del .ddv-num{background:var(--ddv-gutter);color:var(--ddv-marker)}',
    '.ddv-side-add .ddv-num:first-child,.ddv-side-del .ddv-num:first-child{box-shadow:inset 3px 0 0 var(--ddv-marker)}',
    '.ddv-row-ctx .ddv-text,.ddv-side-ctx .ddv-text{color:var(--dsw-alias-label-secondary)}',
    '.ddv-side-empty{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 50%,transparent)}',
    '.ddv-w-del{background:rgba(248,81,73,.45);border-radius:3px}',
    '.ddv-w-add{background:rgba(63,185,80,.45);border-radius:3px}',
    // Interactive line picking (optional; only mounted with onLineToggle).
    '.ddv-pickable{cursor:pointer}',
    '.ddv-pickable:hover{filter:brightness(1.08)}',
    '.ddv-picked{box-shadow:inset 3px 0 0 #d29922}',
    '.ddv-line.ddv-picked,.ddv-splitline .ddv-cell.ddv-picked{background:rgba(210,153,34,.16)}',
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
