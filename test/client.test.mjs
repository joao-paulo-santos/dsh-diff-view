/**
 * dsh-diff-view - client bundle tests against faithful fakes.
 *
 * The centerpiece stays: LINE NUMBERS ARE TRUE. The component now renders
 * native-FileDiff-style hunks (@@ headers, per-side gutters, word
 * highlights, optional Shiki spans), so the pinned regressions assert
 * numbering through the hunk pipeline instead of a collapsed grid.
 *
 * Run: node --test test/   (or node --test test/client.test.mjs)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname as pathDirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_BUNDLE_PATH = pathResolve(pathDirname(fileURLToPath(import.meta.url)), '../lib/client.js')

// Fake React: element builder + initial-state useState.
const mkReact = () => ({
  createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
})

const mkCtx = (injectList) => {
  const declared = new Set(injectList || [])
  const provided = {}
  const ctx = {
    inject: injectList,
    get: (name) => (declared.has(name) ? provided[name] : undefined),
    provide: (name, api) => { provided[name] = api },
    on: () => () => {},
  }
  return { ctx, provided }
}

const mkDocument = () => {
  const head = { children: [] }
  head.appendChild = (tag) => { head.children.push(tag) }
  return {
    head,
    createElement: (tagName) => {
      const tag = { tagName, dataset: {}, textContent: '' }
      tag.remove = () => { const at = head.children.indexOf(tag); if (at >= 0) head.children.splice(at, 1) }
      return tag
    },
  }
}

/** Primitives stub matching the seed module's useCodeHighlighter contract. */
const mkPrimitives = () => ({
  languageForPath: () => 'ts',
  useCodeHighlighter: () => (code) => code.split('\n').map((text) => [{ text, style: { color: '#abc' } }]),
})

const loadBundle = (react, documentObj, primitives = undefined) => {
  let moduleExports
  globalThis.window = { __ModuleLoader__: { load: (handoff) => { moduleExports = handoff.factory((spec) => {
    if (spec === 'react') return react
    if (spec === '@deepseek-ai/dsh-client-ui-primitives' && primitives !== undefined) return primitives
    throw new Error('unexpected require: ' + spec)
  }) } } }
  globalThis.document = documentObj
  ;(0, eval)(readFileSync(CLIENT_BUNDLE_PATH, 'utf8'))
  delete globalThis.window
  return moduleExports
}

// Depth-first flatten preserving child order.
const flatten = (node, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) flatten(child, out)
  return out
}

const textOf = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return String(node)
  return (node.children ?? []).map(textOf).join('')
}

const byClass = (node, cls) => flatten(node).filter((n) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(cls))

test('service provided as diffView; stylesheet installed; dispose removes it', () => {
  const documentObj = mkDocument()
  const client = loadBundle(mkReact(), documentObj)
  assert.equal(client.name, 'diff-view-client')
  assert.deepEqual(client.inject, [])
  const { ctx, provided } = mkCtx(client.inject)
  const disposer = client.apply(ctx)
  assert.equal(typeof provided.diffView.diffFileComponent, 'function')
  assert.equal(typeof provided.diffView.hunksOf, 'function')
  assert.equal(typeof provided.diffView.engine.alignedEditRowsOf, 'function')
  assert.equal(documentObj.head.children.length, 1)
  assert.match(documentObj.head.children[0].textContent, /\.ddv-root/)
  disposer()
  assert.equal(documentObj.head.children.length, 0)
})

test('diffFileComponent validation: bad hunks or half texts rejected; missing hunks defer to render', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  assert.throws(() => provided.diffView.diffFileComponent(null), /options object required/)
  assert.throws(() => provided.diffView.diffFileComponent({ before: 'a' }), /before and after strings required/)
  assert.throws(() => provided.diffView.diffFileComponent({ hunks: [{ lines: 'nope' }] }), /hunks must be WorkspaceDiffHunk\[\]/)
  // Creation without hunks is legal (approval-diff supplies them per render);
  // rendering without any hunks anywhere is the error.
  const deferred = provided.diffView.diffFileComponent({ showToggle: false })
  assert.throws(() => deferred({}), /hunks required/)
})

test('engine: row kinds and order (same/replace/delete/insert)', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const rows = provided.diffView.engine.alignedEditRowsOf(
    ['a', 'b', 'c', 'd'].map((l) => l),
    ['a', 'B1', 'B2', 'c', 'x', 'd'],
  )
  assert.deepEqual(rows.map((r) => r.kind), ['same', 'replace', 'insert', 'same', 'insert', 'same'])
})

test('word spans: unchanged tokens stay plain, changed flagged', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const spans = provided.diffView.engine.wordSpansOfLinePair('const a = 1;', 'const b = 1;')
  assert.deepEqual(spans.removedSpans.filter((s) => s.changed).map((s) => s.text.trim()), ['a'])
  assert.deepEqual(spans.addedSpans.filter((s) => s.changed).map((s) => s.text.trim()), ['b'])
})

test('hunksOf: native shape, context grouping, true header math', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const hunks = provided.diffView.hunksOf('a\nb\nc', 'a\nB\nc')
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0].oldStart, 1)
  assert.equal(hunks[0].oldLines, 3)
  assert.equal(hunks[0].newStart, 1)
  assert.equal(hunks[0].newLines, 3)
  assert.deepEqual(hunks[0].lines, [' a', '-b', '+B', ' c'])
})

test('hunksOf: distant changes split into separate hunks', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const before = Array.from({ length: 40 }, (_, i) => 'line ' + (i + 1)).join('\n')
  const after = before.replace('line 2', 'LINE 2').replace('line 38', 'LINE 38')
  const hunks = provided.diffView.hunksOf(before, after)
  assert.equal(hunks.length, 2)
  assert.equal(hunks[0].oldStart, 1)
  assert.equal(hunks[1].oldStart, 35)
})

test('THE FIX: split-view line numbers stay true with far-away changes', () => {
  const lines = []
  for (let i = 1; i <= 20; i++) lines.push('line ' + i)
  const before = [...lines, 'old tail'].join('\n')
  const after = [...lines, 'new tail'].join('\n')

  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ before, after })
  const tree = Component({})

  // One hunk, starting 3 lines above the change: @@ -18,4 +18,4 @@
  const headers = byClass(tree, 'ddv-hunkheader')
  assert.equal(headers.length, 1)
  assert.match(textOf(headers[0]), /-18,4 \+18,4/)
  // The replace row: del cell numbered 21 on the left, add cell 21 on the right.
  const delCells = byClass(tree, 'ddv-side-del')
  const addCells = byClass(tree, 'ddv-side-add')
  assert.equal(delCells.length, 1)
  assert.equal(addCells.length, 1)
  assert.equal(textOf(byClass(delCells[0], 'ddv-num')[0]), '21', 'old line number after collapsed context')
  assert.equal(textOf(byClass(addCells[0], 'ddv-num')[0]), '21', 'new line number after collapsed context')
  assert.equal(textOf(byClass(delCells[0], 'ddv-text')[0]), 'old tail')
  assert.equal(textOf(byClass(addCells[0], 'ddv-text')[0]), 'new tail')
})

test('unified view keeps numbering true (pure delete)', () => {
  const lines = []
  for (let i = 1; i <= 20; i++) lines.push('line ' + i)
  // A true DELETE: old line 21 ('tail one') is removed, old line 22 remains.
  const before = [...lines, 'tail one', 'tail two'].join('\n')
  const after = [...lines, 'tail two'].join('\n')

  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ before, after, initialMode: 'unified' })
  const tree = Component({})
  const delLines = byClass(tree, 'ddv-line').filter((n) => n.props.className.includes('ddv-row-del'))
  assert.equal(delLines.length, 1)
  const nums = byClass(delLines[0], 'ddv-num')
  assert.equal(textOf(nums[0]), '21', 'old number on the deleted line')
  assert.equal(textOf(nums[1]), '', 'no new number on a pure delete')
  assert.equal(textOf(byClass(delLines[0], 'ddv-text')[0]), 'tail one')
})

test('split view: replace pairs carry word-level highlights', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ before: 'const a = 1;', after: 'const b = 1;' })
  const tree = Component({})
  const delWords = byClass(tree, 'ddv-w-del')
  const addWords = byClass(tree, 'ddv-w-add')
  assert.equal(delWords.map(textOf).join('').trim(), 'a')
  assert.equal(addWords.map(textOf).join('').trim(), 'b')
})

test('unnumbered hunks: no header, blank numbers, real text kept', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old line', '+new line'], unnumbered: true }],
  })
  const tree = Component({})
  assert.equal(byClass(tree, 'ddv-hunkheader').length, 0, 'no header for unnumbered hunks')
  const nums = byClass(tree, 'ddv-num')
  assert.ok(nums.length > 0)
  assert.ok(nums.every((n) => textOf(n) === ''), 'every number blank')
  assert.ok(textOf(tree).includes('old line') && textOf(tree).includes('new line'), 'content intact')
})

test('render-time hunks prop overrides creation options', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ before: 'x', after: 'y', showToggle: false })
  const tree = Component({ hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-q', '+r'] }] })
  assert.ok(textOf(tree).includes('q'))
  assert.equal(byClass(tree, 'ddv-togglebar').length, 0, 'creation options still apply')
})

test('Shiki spans merge with word spans: styled AND word-highlighted pieces', () => {
  const client = loadBundle(mkReact(), mkDocument(), mkPrimitives())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ path: 'a.ts', before: 'const a = 1;', after: 'const b = 1;' })
  const tree = Component({})
  const mergedDel = byClass(tree, 'ddv-w-del')
  assert.ok(mergedDel.length > 0, 'word highlight survived the merge')
  assert.equal(mergedDel[0].props.style?.color, '#abc', 'syntax style carried onto the word piece')
  // Plain (unchanged) pieces keep their syntax style without a word class.
  const styled = flatten(tree).filter((n) => n.props?.style?.color === '#abc' && typeof n.props.className !== 'string')
  assert.ok(styled.length > 0, 'unchanged syntax pieces render styled')
})

test('primitives absent: plain-text fallback still renders the full diff', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffFileComponent({ path: 'a.ts', before: 'const a = 1;', after: 'const b = 1;' })
  const tree = Component({})
  assert.ok(textOf(tree).includes('const a = 1;'))
  assert.ok(byClass(tree, 'ddv-w-del').length > 0, 'word highlights need no primitives')
})

test('showToggle:false renders no toggle bar', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const withToggle = flatten(provided.diffView.diffFileComponent({ before: 'a', after: 'b' })({}))
  assert.ok(withToggle.some((n) => n.props?.className === 'ddv-togglebar'))
  const without = flatten(provided.diffView.diffFileComponent({ before: 'a', after: 'b', showToggle: false })({}))
  assert.ok(!without.some((n) => n.props?.className === 'ddv-togglebar'))
})

test('scrub: window global restored after load', () => {
  loadBundle(mkReact(), mkDocument())
  assert.equal(globalThis.window, undefined)
})

test('line picking: +/- lines clickable and marked via isLinePicked', () => {
  const documentObj = mkDocument()
  const client = loadBundle(mkReact(), documentObj)
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const toggled = []
  const Component = provided.diffView.diffFileComponent({
    hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' ctx', '-old', '+new'] }],
    initialMode: 'unified', showToggle: false,
  })
  const tree = Component({
    onLineToggle: (hunkIndex, src) => { toggled.push({ hunkIndex, src }) },
    isLinePicked: (hunkIndex, src) => hunkIndex === 0 && src === 2,
  })
  const pickables = byClass(tree, 'ddv-pickable')
  assert.equal(pickables.length, 2, 'the del and add rows are pickable, context is not')
  assert.ok(pickables.some((n) => n.props.className.includes('ddv-picked')), 'the picked line is marked')
  const picked = pickables.find((n) => n.props.className.includes('ddv-picked'))
  picked.props.onClick()
  assert.deepEqual(toggled, [{ hunkIndex: 0, src: 2 }], 'toggle reports the hunk and source line index')
  // Without onLineToggle nothing is pickable.
  const plain = Component({})
  assert.equal(byClass(plain, 'ddv-pickable').length, 0)
})
