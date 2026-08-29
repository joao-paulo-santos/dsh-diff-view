/**
 * dsh-diff-view - client bundle tests against faithful fakes.
 *
 * The centerpiece: LINE NUMBERS STAY TRUE ACROSS CONTEXT COLLAPSE. The
 * pre-collapse numbering pass is the reason this plugin exists (the
 * standalone view it replaces numbered rows after collapse and drifted).
 *
 * Run: node --test test/   (or node --test test/client.test.mjs)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname as pathDirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_BUNDLE_PATH = pathResolve(pathDirname(fileURLToPath(import.meta.url)), '../lib/client.js')

// Fake React: element builder + initial-state useState (no effects needed
// by DiffRowsView; the view-mode setter is not exercised on first render).
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

const loadBundle = (react, documentObj) => {
  let moduleExports
  globalThis.window = { __ModuleLoader__: { load: (handoff) => { moduleExports = handoff.factory((spec) => {
    if (spec === 'react') return react
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

test('service provided as diffView; stylesheet installed; dispose removes it', () => {
  const react = mkReact()
  const documentObj = mkDocument()
  const client = loadBundle(react, documentObj)
  assert.equal(client.name, 'diff-view-client')
  assert.deepEqual(client.inject, [])
  const { ctx, provided } = mkCtx(client.inject)
  const disposer = client.apply(ctx)
  assert.equal(typeof provided.diffView.diffRowsComponent, 'function')
  assert.equal(typeof provided.diffView.engine.alignedEditRowsOf, 'function')
  assert.equal(documentObj.head.children.length, 1)
  assert.match(documentObj.head.children[0].textContent, /\.adf-diffview-grid/)
  disposer()
  assert.equal(documentObj.head.children.length, 0)
})

test('diffRowsComponent validation: object + before/after strings required', () => {
  const client = loadBundle(mkReact(), mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  assert.throws(() => provided.diffView.diffRowsComponent(null), /options object required/)
  assert.throws(() => provided.diffView.diffRowsComponent({ before: 'a' }), /before and after strings required/)
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

test('THE FIX: split-view line numbers survive context collapse', () => {
  const lines = []
  for (let i = 1; i <= 20; i++) lines.push('line ' + i)
  const before = [...lines, 'old tail'].join('\n')
  const after = [...lines, 'new tail'].join('\n')

  const react = mkReact()
  const client = loadBundle(react, mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffRowsComponent({ before, after })
  const tree = Component({})
  const flat = flatten(tree)

  // 20 unchanged same rows + 1 replace row: the same-run collapses.
  const delCell = flat.find((n) => typeof n.props?.className === 'string' && n.props.className.includes('adf-del'))
  const addCell = flat.find((n) => typeof n.props?.className === 'string' && n.props.className.includes('adf-add'))
  assert.ok(delCell && addCell, 'replace row rendered')
  // True numbers: old line 21 / new line 21 — NOT 4 (kept-run position).
  const delIdx = flat.indexOf(delCell)
  const addIdx = flat.indexOf(addCell)
  assert.equal(textOf(flat[delIdx - 1]), '21', 'old line number after the ellipsis band')
  assert.equal(textOf(flat[addIdx - 1]), '21', 'new line number after the ellipsis band')
  // And an ellipsis band is present (the collapse actually ran).
  assert.ok(flat.some((n) => typeof n.props?.className === 'string' && n.props.className.includes('adf-ellipsis')))
})

test('unified view keeps numbering true across collapse too', () => {
  const lines = []
  for (let i = 1; i <= 20; i++) lines.push('line ' + i)
  // A true DELETE: old line 21 ('tail one') is removed, old line 22 remains.
  const before = [...lines, 'tail one', 'tail two'].join('\n')
  const after = [...lines, 'tail two'].join('\n')

  const react = mkReact()
  const client = loadBundle(react, mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const Component = provided.diffView.diffRowsComponent({ before, after, initialMode: 'unified' })
  const flat = flatten(Component({}))
  const delCell = flat.find((n) => typeof n.props?.className === 'string' && n.props.className.includes('adf-del'))
  assert.ok(delCell, 'delete row rendered')
  const delIdx = flat.indexOf(delCell)
  // Unified rows render number, sign, then cell — scan back for the number.
  let numberText = ''
  for (let back = delIdx - 1; back >= 0; back--) {
    const cls = flat[back].props?.className
    if (typeof cls === 'string' && cls.includes('adf-num')) { numberText = textOf(flat[back]); break }
  }
  assert.equal(numberText, '21')
})

test('showToggle:false renders no toggle bar', () => {
  const react = mkReact()
  const client = loadBundle(react, mkDocument())
  const { ctx, provided } = mkCtx(client.inject)
  client.apply(ctx)
  const withToggle = flatten(provided.diffView.diffRowsComponent({ before: 'a', after: 'b' })({}))
  assert.ok(withToggle.some((n) => n.props?.className === 'adf-viewtoggle'))
  const without = flatten(provided.diffView.diffRowsComponent({ before: 'a', after: 'b', showToggle: false })({}))
  assert.ok(!without.some((n) => n.props?.className === 'adf-viewtoggle'))
})

test('scrub: window global restored after load', () => {
  loadBundle(mkReact(), mkDocument())
  assert.equal(globalThis.window, undefined)
})
