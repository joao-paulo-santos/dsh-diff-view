/**
 * dsh-diff-view - host half (stub).
 *
 * The whole plugin lives client-side: the `diffView` service (two-text
 * diff engine + self-contained diff component) is provided by the browser
 * half, mirroring the scratchpad pattern. This stub exists so the bundle
 * serves a host entry; it provides nothing and touches nothing.
 */
export const name = 'diff-view'

export function apply() {
  return () => {}
}
